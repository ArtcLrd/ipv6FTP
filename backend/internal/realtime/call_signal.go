package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const signalKeyTTL = 90 * time.Second

type CallSignalHub struct {
	redis *redis.Client
	mu    sync.Mutex
	rooms map[string]*signalRoom
}

type signalRoom struct {
	clients map[*SignalClient]struct{}
	cancel  context.CancelFunc
}

type SignalClient struct {
	hub           *CallSignalHub
	callSessionID string
	principalID   string
	participantID string
	conn          *websocket.Conn
	send          chan Message
}

type signalEnvelope struct {
	Type          string          `json:"type"`
	CallSessionID string          `json:"call_session_id"`
	SenderID      string          `json:"sender_id"`
	ParticipantID string          `json:"participant_id"`
	Payload       json.RawMessage `json:"payload,omitempty"`
}

func NewCallSignalHub(redisClient *redis.Client) *CallSignalHub {
	return &CallSignalHub{redis: redisClient, rooms: map[string]*signalRoom{}}
}

func NewSignalClient(hub *CallSignalHub, callSessionID, principalID, participantID string, conn *websocket.Conn) *SignalClient {
	return &SignalClient{
		hub:           hub,
		callSessionID: callSessionID,
		principalID:   principalID,
		participantID: participantID,
		conn:          conn,
		send:          make(chan Message, 32),
	}
}

func (h *CallSignalHub) Join(ctx context.Context, client *SignalClient) error {
	h.mu.Lock()
	room := h.rooms[client.callSessionID]
	if room == nil {
		roomCtx, cancel := context.WithCancel(context.Background())
		room = &signalRoom{clients: map[*SignalClient]struct{}{}, cancel: cancel}
		h.rooms[client.callSessionID] = room
		if h.redis != nil {
			go h.subscribe(roomCtx, client.callSessionID)
		}
	}
	room.clients[client] = struct{}{}
	peerCount := len(room.clients)
	h.mu.Unlock()

	if h.redis != nil {
		key := "ipv6ftp:call:" + client.callSessionID + ":participant:" + client.participantID
		_ = h.redis.Set(ctx, key, client.principalID, signalKeyTTL).Err()
		_ = h.redis.SAdd(ctx, "ipv6ftp:call:"+client.callSessionID+":participants", client.participantID).Err()
		_ = h.redis.Expire(ctx, "ipv6ftp:call:"+client.callSessionID+":participants", signalKeyTTL).Err()
	}
	if peerCount >= 2 {
		h.publish(ctx, signalEnvelope{Type: "peer-joined", CallSessionID: client.callSessionID, SenderID: client.principalID, ParticipantID: client.participantID})
	}
	return nil
}

func (h *CallSignalHub) Leave(ctx context.Context, client *SignalClient) {
	h.mu.Lock()
	room := h.rooms[client.callSessionID]
	if room != nil {
		delete(room.clients, client)
		if len(room.clients) == 0 {
			room.cancel()
			delete(h.rooms, client.callSessionID)
		}
	}
	h.mu.Unlock()

	if h.redis != nil {
		key := "ipv6ftp:call:" + client.callSessionID + ":participant:" + client.participantID
		_ = h.redis.Del(ctx, key).Err()
		_ = h.redis.SRem(ctx, "ipv6ftp:call:"+client.callSessionID+":participants", client.participantID).Err()
	}
	h.publish(ctx, signalEnvelope{Type: "peer-left", CallSessionID: client.callSessionID, SenderID: client.principalID, ParticipantID: client.participantID})
}

func (h *CallSignalHub) Relay(ctx context.Context, client *SignalClient, msg Message) {
	switch msg.Type {
	case "offer", "answer", "ice-candidate", "call-ended":
		h.publish(ctx, signalEnvelope{
			Type:          msg.Type,
			CallSessionID: client.callSessionID,
			SenderID:      client.principalID,
			ParticipantID: client.participantID,
			Payload:       msg.Payload,
		})
	}
}

func (h *CallSignalHub) publish(ctx context.Context, envelope signalEnvelope) {
	if h.redis != nil {
		raw, err := json.Marshal(envelope)
		if err == nil {
			_ = h.redis.Publish(ctx, signalChannel(envelope.CallSessionID), raw).Err()
			if envelope.Type != "peer-joined" && envelope.Type != "peer-left" {
				return
			}
		}
	}
	h.deliver(envelope)
}

func (h *CallSignalHub) subscribe(ctx context.Context, callSessionID string) {
	pubsub := h.redis.Subscribe(ctx, signalChannel(callSessionID))
	defer pubsub.Close()
	ch := pubsub.Channel(redis.WithChannelSize(64))
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var envelope signalEnvelope
			if err := json.Unmarshal([]byte(msg.Payload), &envelope); err != nil {
				slog.Warn("invalid redis signal payload", "call_session_id", callSessionID, "error", err)
				continue
			}
			h.deliver(envelope)
		}
	}
}

func (h *CallSignalHub) deliver(envelope signalEnvelope) {
	h.mu.Lock()
	room := h.rooms[envelope.CallSessionID]
	clients := make([]*SignalClient, 0)
	if room != nil {
		for client := range room.clients {
			if client.principalID != envelope.SenderID {
				clients = append(clients, client)
			}
		}
	}
	h.mu.Unlock()

	for _, client := range clients {
		select {
		case client.send <- Message{Type: envelope.Type, Payload: envelope.Payload}:
		default:
		}
	}
}

func (c *SignalClient) ReadPump() {
	defer func() {
		c.hub.Leave(context.Background(), c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Warn("call signal read error", "call_session_id", c.callSessionID, "error", err)
			}
			return
		}
		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			slog.Warn("call signal invalid JSON", "call_session_id", c.callSessionID, "error", err)
			continue
		}
		if msg.Type == "ping" {
			continue
		}
		c.hub.Relay(context.Background(), c, msg)
	}
}

func (c *SignalClient) WritePump() {
	ticker := time.NewTicker(15 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(msg); err != nil {
				slog.Warn("call signal write error", "call_session_id", c.callSessionID, "error", err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
			if c.hub.redis != nil {
				key := "ipv6ftp:call:" + c.callSessionID + ":participant:" + c.participantID
				_ = c.hub.redis.Expire(context.Background(), key, signalKeyTTL).Err()
				_ = c.hub.redis.Expire(context.Background(), "ipv6ftp:call:"+c.callSessionID+":participants", signalKeyTTL).Err()
			}
		}
	}
}

func signalChannel(callSessionID string) string {
	return "ipv6ftp:call:" + callSessionID + ":signals"
}

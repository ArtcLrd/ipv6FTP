package realtime

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 64 * 1024
)

type Event struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

type SSEBroker struct {
	mu   sync.RWMutex
	subs map[string]chan Event
}

func NewSSEBroker() *SSEBroker { return &SSEBroker{subs: map[string]chan Event{}} }

func (b *SSEBroker) Subscribe(userID string) (<-chan Event, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	ch := make(chan Event, 10)
	b.subs[userID] = ch
	cleanup := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if b.subs[userID] == ch {
			delete(b.subs, userID)
			close(ch)
		}
	}
	return ch, cleanup
}

func (b *SSEBroker) Publish(userID string, e Event) {
	b.mu.RLock()
	ch, ok := b.subs[userID]
	b.mu.RUnlock()
	if !ok {
		return
	}
	select {
	case ch <- e:
	default:
	}
}

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

type Room struct {
	peers []*Client
	queue []*Client
}

type Client struct {
	hub    *Hub
	roomID string
	conn   *websocket.Conn
	send   chan Message
}

func NewHub() *Hub { return &Hub{rooms: map[string]*Room{}} }

func NewClient(hub *Hub, roomID string, conn *websocket.Conn) *Client {
	return &Client{hub: hub, roomID: roomID, conn: conn, send: make(chan Message, 32)}
}

func sendMsg(c *Client, msgType string, extra map[string]any) {
	var raw json.RawMessage
	if extra != nil {
		b, _ := json.Marshal(extra)
		raw = json.RawMessage(b)
	}
	select {
	case c.send <- Message{Type: msgType, Payload: raw}:
	default:
	}
}

func (h *Hub) Join(roomID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[roomID]
	if room == nil {
		room = &Room{}
		h.rooms[roomID] = room
	}
	if len(room.peers) < 2 {
		room.peers = append(room.peers, c)
		if len(room.peers) == 2 {
			sendMsg(room.peers[0], "peer-joined", nil)
			sendMsg(room.peers[1], "room-ready", nil)
		}
		return
	}
	room.queue = append(room.queue, c)
	sendMsg(c, "queued", map[string]any{"position": len(room.queue)})
}

func (h *Hub) Leave(roomID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[roomID]
	if room == nil {
		return
	}
	peerIdx := -1
	for i, peer := range room.peers {
		if peer == c {
			peerIdx = i
			break
		}
	}
	if peerIdx >= 0 {
		room.peers = append(room.peers[:peerIdx], room.peers[peerIdx+1:]...)
		for _, peer := range room.peers {
			sendMsg(peer, "peer-left", nil)
		}
		if len(room.queue) > 0 {
			promoted := room.queue[0]
			room.queue = room.queue[1:]
			room.peers = append(room.peers, promoted)
			if len(room.peers) == 2 {
				sendMsg(room.peers[0], "peer-joined", nil)
				sendMsg(room.peers[1], "queue-promoted", nil)
			}
			for i, queued := range room.queue {
				sendMsg(queued, "queue-position", map[string]any{"position": i + 1})
			}
		}
		if len(room.peers) == 0 && len(room.queue) == 0 {
			delete(h.rooms, roomID)
		}
		return
	}
	for i, queued := range room.queue {
		if queued == c {
			room.queue = append(room.queue[:i], room.queue[i+1:]...)
			for j, q := range room.queue {
				sendMsg(q, "queue-position", map[string]any{"position": j + 1})
			}
			break
		}
	}
	if len(room.peers) == 0 && len(room.queue) == 0 {
		delete(h.rooms, roomID)
	}
}

func (h *Hub) Relay(roomID string, sender *Client, msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	room := h.rooms[roomID]
	if room == nil {
		return
	}
	for _, peer := range room.peers {
		if peer != sender {
			select {
			case peer.send <- msg:
			default:
			}
		}
	}
}

func (h *Hub) RoomCount(roomID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	room := h.rooms[roomID]
	if room == nil {
		return 0
	}
	return len(room.peers)
}

func (c *Client) ReadPump() {
	defer func() {
		c.hub.Leave(c.roomID, c)
		c.conn.Close()
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
				slog.Warn("websocket read error", "room", c.roomID, "error", err)
			}
			return
		}
		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			slog.Warn("websocket invalid JSON", "room", c.roomID, "error", err)
			continue
		}
		switch msg.Type {
		case "offer", "answer", "ice-candidate", "call-invite", "call-accepted", "call-rejected", "call-ended":
			c.hub.Relay(c.roomID, c, msg)
		default:
			slog.Warn("websocket unknown message type", "room", c.roomID, "type", msg.Type)
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
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
				slog.Warn("websocket write error", "room", c.roomID, "error", err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
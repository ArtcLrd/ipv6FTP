package main

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 64 * 1024 // 64KB — signaling messages only, no file data
)

// Message is the signaling envelope exchanged between peers.
// Types: "offer", "answer", "ice-candidate", "peer-joined", "room-ready", "peer-left"
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Client represents a single WebSocket connection (one peer in a room).
type Client struct {
	hub    *Hub
	roomID string
	conn   *websocket.Conn
	send   chan Message
}

func NewClient(hub *Hub, roomID string, conn *websocket.Conn) *Client {
	return &Client{
		hub:    hub,
		roomID: roomID,
		conn:   conn,
		send:   make(chan Message, 32),
	}
}

// ReadPump pumps messages from the WebSocket to the hub relay.
// Each connection runs ReadPump in its own goroutine.
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
				log.Printf("[room:%s] read error: %v", c.roomID, err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("[room:%s] invalid JSON: %v", c.roomID, err)
			continue
		}

		// Only relay valid signaling message types
		switch msg.Type {
		case "offer", "answer", "ice-candidate", "call-invite", "call-accepted", "call-rejected", "call-ended":
			c.hub.Relay(c.roomID, c, msg)
		default:
			log.Printf("[room:%s] unknown message type: %s", c.roomID, msg.Type)
		}
	}
}

// WritePump pumps messages from the send channel to the WebSocket connection.
// Each connection runs WritePump in its own goroutine.
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
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(msg); err != nil {
				log.Printf("[room:%s] write error: %v", c.roomID, err)
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

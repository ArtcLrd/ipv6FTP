package main

import (
	"sync"
)

// Hub manages all active rooms.
// A room holds at most 2 clients (peer A and peer B).
type Hub struct {
	mu    sync.RWMutex
	rooms map[string][]*Client
}

func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string][]*Client),
	}
}

// Join adds a client to a room. Returns false if the room is full (>2 peers).
func (h *Hub) Join(roomID string, c *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	peers := h.rooms[roomID]
	if len(peers) >= 2 {
		return false
	}

	h.rooms[roomID] = append(peers, c)

	// If a second peer just joined, notify both that the room is ready
	if len(h.rooms[roomID]) == 2 {
		// Tell the first peer (offerer) that the second peer has arrived
		h.rooms[roomID][0].send <- Message{Type: "peer-joined"}
		// Tell the second peer (answerer) to wait for an offer
		h.rooms[roomID][1].send <- Message{Type: "room-ready"}
	}

	return true
}

// Leave removes a client from a room and notifies the remaining peer.
func (h *Hub) Leave(roomID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	peers := h.rooms[roomID]
	remaining := peers[:0]
	for _, p := range peers {
		if p != c {
			remaining = append(remaining, p)
		}
	}

	if len(remaining) == 0 {
		delete(h.rooms, roomID)
	} else {
		h.rooms[roomID] = remaining
		// Notify the remaining peer that the other disconnected
		for _, p := range remaining {
			p.send <- Message{Type: "peer-left"}
		}
	}
}

// Relay forwards a message from one client to the other peer in the same room.
func (h *Hub) Relay(roomID string, sender *Client, msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, p := range h.rooms[roomID] {
		if p != sender {
			select {
			case p.send <- msg:
			default:
				// Channel full — drop the message (peer has gone away)
			}
		}
	}
}

// RoomCount returns the number of peers in a room.
func (h *Hub) RoomCount(roomID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[roomID])
}

package main

import (
	"encoding/json"
	"sync"
)

// Room holds the two active peers and an unlimited waiting queue.
type Room struct {
	peers []*Client
	queue []*Client
}

// Hub manages all active rooms.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
}

// sendMsg is a helper that encodes extra fields into a Message payload.
func sendMsg(c *Client, msgType string, extra map[string]interface{}) {
	var raw json.RawMessage
	if extra != nil {
		b, _ := json.Marshal(extra)
		raw = json.RawMessage(b)
	}
	select {
	case c.send <- Message{Type: msgType, Payload: raw}:
	default:
		// Client send buffer full — drop silently
	}
}

// Join adds a client to a room.
// If fewer than 2 active peers exist the client becomes active immediately.
// If the room already has 2 active peers the client is placed in the queue
// and receives a "queued" message with their position number.
// Join never rejects a connection.
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
			// Second peer joined — kick off WebRTC handshake.
			// peers[0] is the offerer (created the room first).
			// peers[1] is the answerer (joined second).
			sendMsg(room.peers[0], "peer-joined", nil)
			sendMsg(room.peers[1], "room-ready", nil)
		}
		// If only one peer so far, they just wait silently.
	} else {
		// Room full — add to queue
		room.queue = append(room.queue, c)
		sendMsg(c, "queued", map[string]interface{}{
			"position": len(room.queue),
		})
	}
}

// Leave removes a client from a room (peers or queue).
// If a peer leaves and the queue is non-empty, the first queued client is
// promoted: the surviving peer becomes the Offerer, the promoted peer
// becomes the Answerer, and remaining queue positions are updated.
func (h *Hub) Leave(roomID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[roomID]
	if room == nil {
		return
	}

	// ── Was the client an active peer? ──────────────────────────────────
	peerIdx := -1
	for i, p := range room.peers {
		if p == c {
			peerIdx = i
			break
		}
	}

	if peerIdx >= 0 {
		// Remove from active peers
		room.peers = append(room.peers[:peerIdx], room.peers[peerIdx+1:]...)

		// Notify surviving active peers
		for _, p := range room.peers {
			sendMsg(p, "peer-left", nil)
		}

		// Promote first queued client if available
		if len(room.queue) > 0 {
			promoted := room.queue[0]
			room.queue = room.queue[1:]
			room.peers = append(room.peers, promoted)

			if len(room.peers) == 2 {
				// surviving peer (peers[0]) → becomes Offerer
				// promoted peer (peers[1]) → becomes Answerer
				sendMsg(room.peers[0], "peer-joined", nil)
				sendMsg(room.peers[1], "queue-promoted", nil)
			} else {
				// No surviving peer — promoted is now alone as peers[0]
				// They wait for the next person to join.
			}

			// Update queue position numbers for remaining waiters
			h.broadcastQueuePositions(room)
		}

		// Clean up room if fully empty
		if len(room.peers) == 0 && len(room.queue) == 0 {
			delete(h.rooms, roomID)
		}
		return
	}

	// ── Was the client in the queue? ─────────────────────────────────────
	for i, q := range room.queue {
		if q == c {
			room.queue = append(room.queue[:i], room.queue[i+1:]...)
			h.broadcastQueuePositions(room)
			break
		}
	}

	// Clean up room if fully empty
	if len(room.peers) == 0 && len(room.queue) == 0 {
		delete(h.rooms, roomID)
	}
}

// broadcastQueuePositions sends updated position numbers to all waiting clients.
// Must be called with h.mu held.
func (h *Hub) broadcastQueuePositions(room *Room) {
	for i, q := range room.queue {
		sendMsg(q, "queue-position", map[string]interface{}{
			"position": i + 1,
		})
	}
}

// Relay forwards a message from one client to the other ACTIVE peer in the
// same room. Queued clients never receive relayed messages.
func (h *Hub) Relay(roomID string, sender *Client, msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room := h.rooms[roomID]
	if room == nil {
		return
	}

	for _, p := range room.peers {
		if p != sender {
			select {
			case p.send <- msg:
			default:
				// Channel full — peer has gone away, drop silently
			}
		}
	}
}

// RoomCount returns the number of ACTIVE peers (not queued) in a room.
func (h *Hub) RoomCount(roomID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	room := h.rooms[roomID]
	if room == nil {
		return 0
	}
	return len(room.peers)
}

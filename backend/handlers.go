package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins in development. Restrict to your Railway domain in production.
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// myIPHandler responds with the client's source IP address.
// This is the same mechanism used by whatsmyip.com — the server reads the
// TCP connection's remote address, which carries the client's real IPv6 if they have one.
func myIPHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	remoteAddr := r.RemoteAddr

	// X-Forwarded-For support (Railway/Render proxy headers)
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		// X-Forwarded-For can be a comma-separated list; take the first (original client)
		remoteAddr = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	} else if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		remoteAddr = realIP
	}

	// Strip port if present (e.g. "[2409:40d1::1]:54321" → "2409:40d1::1")
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// SplitHostPort failed — remoteAddr might already be just an IP
		host = remoteAddr
	}

	// Clean up IPv6 bracket notation if still present
	host = strings.Trim(host, "[]")

	isIPv6 := strings.Contains(host, ":")

	resp := map[string]interface{}{
		"ip":     host,
		"isIPv6": isIPv6,
	}
	json.NewEncoder(w).Encode(resp)
}

// wsHandler upgrades an HTTP connection to WebSocket and registers the client with the hub.
// Query param: ?room=<roomID>
// The room ID is provided by the frontend (UUID generated client-side).
func wsHandler(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomID := strings.TrimSpace(r.URL.Query().Get("room"))
		if roomID == "" {
			http.Error(w, "missing ?room= parameter", http.StatusBadRequest)
			return
		}

		// Limit room ID length to prevent abuse
		if len(roomID) > 64 {
			http.Error(w, "room ID too long", http.StatusBadRequest)
			return
		}

		// Check if room is already full before upgrading
		if hub.RoomCount(roomID) >= 2 {
			http.Error(w, "room is full", http.StatusConflict)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade failed: %v", err)
			return
		}

		client := NewClient(hub, roomID, conn)

		if !hub.Join(roomID, client) {
			// Race condition: another client joined between the count check and Join
			conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "room is full"))
			conn.Close()
			return
		}

		log.Printf("[room:%s] peer connected (peers in room: %d)", roomID, hub.RoomCount(roomID))

		// Run pumps in separate goroutines (standard gorilla/websocket pattern)
		go client.WritePump()
		go client.ReadPump()
	}
}

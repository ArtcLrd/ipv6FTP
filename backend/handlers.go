package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

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

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade failed: %v", err)
			return
		}

		client := NewClient(hub, roomID, conn)
		hub.Join(roomID, client)

		log.Printf("[room:%s] client connected (active: %d)", roomID, hub.RoomCount(roomID))

		// Run pumps in separate goroutines (standard gorilla/websocket pattern)
		go client.WritePump()
		go client.ReadPump()
	}
}

// turnCredentialsHandler returns ICE server entries with TURN credentials.
//
// Path A: Metered.ca REST API (Most Secure)
//   Set METERED_API_KEY and optionally METERED_APP_NAME.
//
// Path B: self-hosted coturn with use-auth-secret:
//   Set env TURN_URL and TURN_SECRET.
//
// Path C: Static credentials from environment (fallback):
//   Set env TURN_URL, TURN_USERNAME, and TURN_CREDENTIAL.
func turnCredentialsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// --- Path A: Metered.ca REST API ---
	apiKey := os.Getenv("METERED_API_KEY")
	if apiKey != "" {
		appName := os.Getenv("METERED_APP_NAME")
		if appName == "" {
			appName = "openrelay" 
		}

		domain := os.Getenv("METERED_DOMAIN")
		if domain == "" {
			domain = fmt.Sprintf("%s.metered.live", appName)
		}

		// Try GET /credentials?apiKey=...
		url := fmt.Sprintf("https://%s/api/v1/turn/credentials?apiKey=%s", domain, apiKey)
		
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Get(url)
		
		// If fails, try POST /credential?secretKey=...
		if err != nil || resp.StatusCode != http.StatusOK {
			url = fmt.Sprintf("https://%s/api/v1/turn/credential?secretKey=%s", domain, apiKey)
			resp, err = client.Post(url, "application/json", nil)
		}

		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			var result any
			if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
				switch v := result.(type) {
				case []any:
					json.NewEncoder(w).Encode(map[string]any{"servers": v})
					return
				case map[string]any:
					if servers, ok := v["iceServers"]; ok {
						json.NewEncoder(w).Encode(map[string]any{"servers": servers})
						return
					}
					if _, ok := v["urls"]; ok {
						json.NewEncoder(w).Encode(map[string]any{"servers": []any{v}})
						return
					}
				}
			}
		}
		
		if err != nil {
			log.Printf("Metered API call failed: %v", err)
		} else if resp.StatusCode != http.StatusOK {
			log.Printf("Metered API returned %d", resp.StatusCode)
		}
	}

	turnURL := os.Getenv("TURN_URL")
	if turnURL == "" {
		// TURN not configured — STUN-only fallback
		json.NewEncoder(w).Encode(map[string]any{"servers": []any{}})
		return
	}

	var username, password string

	if secret := os.Getenv("TURN_SECRET"); secret != "" {
		// Path B: HMAC-SHA1 time-limited credentials (coturn use-auth-secret)
		expiry := time.Now().Unix() + 3600 // 1-hour validity window
		username = fmt.Sprintf("%d:user", expiry)
		mac := hmac.New(sha1.New, []byte(secret))
		mac.Write([]byte(username))
		password = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	} else {
		// Path C: static credentials from environment
		username = os.Getenv("TURN_USERNAME")
		password = os.Getenv("TURN_CREDENTIAL")
	}

	// Provide both UDP and TCP TURN entries for maximum NAT traversal
	tcpURL := turnURL + "?transport=tcp"

	json.NewEncoder(w).Encode(map[string]any{
		"servers": []any{
			map[string]any{"urls": turnURL, "username": username, "credential": password},
			map[string]any{"urls": tcpURL, "username": username, "credential": password},
		},
	})
}

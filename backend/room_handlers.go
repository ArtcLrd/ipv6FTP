package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
)

func generateRoomID() string {
	words := []string{"alpha", "beta", "gamma", "delta", "echo", "foxtrot", "sierra", "tango", "victor", "xray", "zebra", "cobalt", "amber", "jade"}
	word := words[rand.Intn(len(words))]
	hex := fmt.Sprintf("%06x", rand.Intn(0xffffff))
	return fmt.Sprintf("%s-%s", word, hex)
}

func createRoomHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	roomID := generateRoomID()
	json.NewEncoder(w).Encode(map[string]string{"room_id": roomID})
}

func roomInviteHandler(broker *SSEBroker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := claimsFromCtx(r.Context())
		var req struct {
			ContactID string `json:"contact_id"`
			RoomID    string `json:"room_id"`
			Type      string `json:"type"` // "room" | "call"
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		broker.Publish(req.ContactID, Event{
			Type: req.Type + "-invite",
			Payload: map[string]string{
				"from_username": claims.Username,
				"from_id":       claims.Sub,
				"room_id":       req.RoomID,
			},
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
	}
}

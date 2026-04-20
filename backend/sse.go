package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Event struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

type SSEBroker struct {
	mu    sync.RWMutex
	subs  map[string]chan Event
}

func NewSSEBroker() *SSEBroker {
	return &SSEBroker{
		subs: make(map[string]chan Event),
	}
}

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

	if ok {
		select {
		case ch <- e:
		default:
			// Buffer full, drop event
		}
	}
}

func (b *SSEBroker) IsOnline(userID string) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	_, ok := b.subs[userID]
	return ok
}

func sseHandler(broker *SSEBroker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := claimsFromCtx(r.Context())
		if claims == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		eventChan, cleanup := broker.Subscribe(claims.Sub)
		defer cleanup()

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
			return
		}

		// Initial connection check
		fmt.Fprintf(w, ": connected\n\n")
		flusher.Flush()

		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				fmt.Fprintf(w, ": ping\n\n")
				flusher.Flush()
			case event := <-eventChan:
				data, err := json.Marshal(event)
				if err != nil {
					continue
				}
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

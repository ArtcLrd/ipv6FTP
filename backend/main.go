package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

//go:embed all:dist
var distFS embed.FS

func main() {
	// Load .env file for local development - ignore error in production
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize Database
	dbURL := os.Getenv("SUPABASE_DB_URL")
	if dbURL == "" {
		log.Fatal("SUPABASE_DB_URL environment variable is required")
	}
	if err := InitDB(dbURL); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Reset any stale online statuses on startup
	if _, err := DB.Exec("UPDATE users SET status = 'offline'"); err != nil {
		log.Printf("Warning: failed to reset user statuses: %v", err)
	}

	broker := NewSSEBroker()
	hub := NewHub()
	mux := http.NewServeMux()

	// Background ticker: every 2 hours, update last_seen for online users
	go func() {
		ticker := time.NewTicker(2 * time.Hour)
		for range ticker.C {
			if _, err := DB.Exec("UPDATE users SET last_seen = NOW() WHERE status = 'online'"); err != nil {
				log.Printf("Ticker error: %v", err)
			}
		}
	}()

	// --- Public API ---
	mux.HandleFunc("/api/myip", myIPHandler)
	mux.HandleFunc("/api/turn-credentials", turnCredentialsHandler)
	mux.HandleFunc("/api/auth/register", registerHandler(broker))
	mux.HandleFunc("/api/auth/login", loginHandler(broker))
	mux.HandleFunc("/api/auth/refresh", refreshHandler)

	// --- Protected API ---
	mux.HandleFunc("/api/auth/logout", AuthMiddleware(logoutHandler(broker)))
	mux.HandleFunc("/api/auth/me", AuthMiddleware(meHandler))
	mux.HandleFunc("/api/ip/update", AuthMiddleware(ipUpdateHandler))
	mux.HandleFunc("/api/users/search", AuthMiddleware(userSearchHandler))
	mux.HandleFunc("/api/contacts", AuthMiddleware(contactsHandler))
	mux.HandleFunc("/api/contacts/", AuthMiddleware(contactDeleteHandler))
	mux.HandleFunc("/api/rooms/create", AuthMiddleware(createRoomHandler))
	mux.HandleFunc("/api/rooms/invite", AuthMiddleware(roomInviteHandler(broker)))
	mux.HandleFunc("/api/events", AuthMiddleware(sseHandler(broker)))

	// WebSocket
	mux.HandleFunc("/ws", wsHandler(hub))

	// Serve React SPA from embedded dist/
	mux.Handle("/", spaHandler(distFS, "dist"))

	log.Printf("ipv6FTP server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func spaHandler(embeddedFS embed.FS, folder string) http.HandlerFunc {
	subFS, err := fs.Sub(embeddedFS, folder)
	if err != nil {
		log.Fatalf("failed to create sub-filesystem from %q: %v", folder, err)
	}

	fileServer := http.FileServer(http.FS(subFS))

	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" {
			http.NotFound(w, r)
			return
		}

		clean := path.Clean(r.URL.Path)
		clean = strings.TrimPrefix(clean, "/")

		if clean == "" {
			clean = "index.html"
		}

		_, err := subFS.Open(clean)
		if err != nil {
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	}
}

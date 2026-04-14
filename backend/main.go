package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	hub := NewHub()
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/myip", myIPHandler)
	mux.HandleFunc("/ws", wsHandler(hub))

	// Serve React SPA from embedded dist/
	mux.Handle("/", spaHandler(distFS, "dist"))

	log.Printf("ipv6FTP server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// spaHandler serves the React SPA from an embedded filesystem.
// Any path that doesn't match a real file falls back to index.html,
// which lets React Router handle client-side routing.
func spaHandler(embeddedFS embed.FS, folder string) http.HandlerFunc {
	// Create a sub-filesystem rooted at `folder` (e.g. "dist")
	// so that dist/index.html is served as /index.html
	subFS, err := fs.Sub(embeddedFS, folder)
	if err != nil {
		log.Fatalf("failed to create sub-filesystem from %q: %v", folder, err)
	}

	fileServer := http.FileServer(http.FS(subFS))

	return func(w http.ResponseWriter, r *http.Request) {
		// Don't intercept API routes
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" {
			http.NotFound(w, r)
			return
		}

		// Clean the path and strip leading slash to check existence in the FS
		clean := filepath.ToSlash(filepath.Clean(r.URL.Path))
		clean = strings.TrimPrefix(clean, "/")

		if clean == "" {
			clean = "index.html"
		}

		_, err := subFS.Open(clean)
		if os.IsNotExist(err) || err != nil {
			// File doesn't exist → serve index.html for React Router to handle
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	}
}

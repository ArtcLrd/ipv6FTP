package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"ipv6ftp/internal/bootstrap"
)

//go:embed all:dist
var distFS embed.FS

func main() {
	_ = godotenv.Load()

	app, err := bootstrap.New(context.Background())
	if err != nil {
		log.Fatalf("bootstrap failed: %v", err)
	}

	server := &http.Server{
		Addr:         ":" + app.Config.Port,
		Handler:      spaFallback(app.Router, distFS),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("ipv6FTP server starting on :%s", app.Config.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-shutdown

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	if err := app.Close(ctx); err != nil {
		log.Printf("app close failed: %v", err)
	}
}

func spaFallback(apiHandler http.Handler, embedded embed.FS) http.Handler {
	assetFS, err := fs.Sub(embedded, "dist")
	if err != nil {
		assetFS = os.DirFS("dist")
	}
	fileHandler := http.FileServer(http.FS(assetFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAPIRoute(r.URL.Path) {
			apiHandler.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "" {
			fileHandler.ServeHTTP(w, r)
			return
		}
		assetPath := strings.TrimPrefix(r.URL.Path, "/")
		if _, err := fs.Stat(assetFS, assetPath); err == nil {
			fileHandler.ServeHTTP(w, r)
			return
		}
		r.URL.Path = "/"
		fileHandler.ServeHTTP(w, r)
	})
}

func isAPIRoute(path string) bool {
	return path == "/healthz" || path == "/ws" || len(path) >= 4 && path[:4] == "/api"
}
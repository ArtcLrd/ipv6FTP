# ipv6FTP Makefile
# Usage:
#   make dev-backend   — run Go server (serves placeholder dist)
#   make dev-frontend  — run Vite dev server with proxy to Go
#   make build         — build everything into a single deployable Go binary
#   make clean         — remove build artifacts

.PHONY: build dev-backend dev-frontend clean

# Build: React → dist → embedded into Go binary
build:
	@echo "▶ Building frontend..."
	cd frontend && npm run build
	@echo "▶ Copying dist to backend..."
	if exist backend\dist rmdir /s /q backend\dist
	xcopy /E /I frontend\dist backend\dist
	@echo "▶ Building Go binary..."
	cd backend && go build -o ..\ipv6ftp.exe .
	@echo "✓ Build complete: ipv6ftp.exe"

# Run Go backend dev server (uses placeholder dist)
dev-backend:
	cd backend && go run .

# Run Vite dev server (proxies /api and /ws to Go on :8080)
dev-frontend:
	cd frontend && npm run dev

clean:
	if exist backend\dist rmdir /s /q backend\dist
	if exist ipv6ftp.exe del ipv6ftp.exe
	if exist frontend\dist rmdir /s /q frontend\dist

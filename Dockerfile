# ─────────────────────────────────────────────────────────────────
# Stage 1: Build the React frontend
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files first (Docker layer cache: only re-runs npm ci 
# if package.json or package-lock.json changed)
COPY frontend/package*.json ./
RUN npm ci --silent

# Copy source and build
COPY frontend/ ./
RUN npm run build
# Output: /app/frontend/dist/

# ─────────────────────────────────────────────────────────────────
# Stage 2: Build the Go binary (with frontend dist embedded)
# ─────────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS backend-builder

WORKDIR /app/backend

# Download Go deps first (Docker layer cache)
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy all backend source
COPY backend/ ./

# Copy the built React app from Stage 1 into backend/dist/
# This is what //go:embed all:dist picks up
COPY --from=frontend-builder /app/frontend/dist ./dist

# Build the binary — dist is now embedded inside it
# CGO_ENABLED=0 ensures a static binary that runs on Alpine
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -a -tags netgo -o ipv6ftp .

# ─────────────────────────────────────────────────────────────────
# Stage 3: Minimal runtime image (~10MB total)
# ─────────────────────────────────────────────────────────────────
FROM alpine:3.21

# Security: don't run as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=backend-builder /app/backend/ipv6ftp ./ipv6ftp

# Ensure it's executable
RUN chmod +x ./ipv6ftp

USER appuser

# Railway injects PORT automatically.
# Go backend reads os.Getenv("PORT"), defaults to 8080.
EXPOSE 8080

CMD ["./ipv6ftp"]

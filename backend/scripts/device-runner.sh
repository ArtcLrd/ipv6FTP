#!/bin/sh
set -eu

# Runs inside the disposable device-backend container. Applies ordered
# migrations to the fresh device database, then execs the API server so it
# receives SIGTERM directly from `docker compose down`/stop for a clean
# graceful shutdown (see cmd/api/main.go).
: "${IPV6FTP_DEVICE_ROLE_PASSWORD:?missing device-backend role password}"
MIGRATOR_DATABASE_URL="postgres://ipv6ftp_device:${IPV6FTP_DEVICE_ROLE_PASSWORD}@postgres:5432/ipv6ftp_device?sslmode=disable" \
  go run ./cmd/migrate up --allow-destructive-reset --isolated-env

exec /usr/local/bin/ipv6ftp-api

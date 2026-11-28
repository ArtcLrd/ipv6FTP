#!/bin/sh
set -eu

# Postgres init script for the disposable device-test backend. Runs once
# inside the throwaway container; never targets a persistent database.
[ "${POSTGRES_USER:-}" = postgres ] || {
  echo 'Refusing unexpected device-backend bootstrap user' >&2
  exit 1
}
[ "${POSTGRES_DB:-}" = postgres ] || {
  echo 'Refusing unexpected device-backend maintenance database' >&2
  exit 1
}
: "${IPV6FTP_DEVICE_ROLE_PASSWORD:?missing device-backend role password}"

psql --username postgres --dbname postgres --set=ON_ERROR_STOP=1 \
  --set=app_password="$IPV6FTP_DEVICE_ROLE_PASSWORD" <<'SQL'
CREATE ROLE ipv6ftp_device LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
CREATE DATABASE ipv6ftp_device OWNER ipv6ftp_device;
COMMENT ON DATABASE ipv6ftp_device IS 'ipv6ftp-disposable-device-backend';
SQL

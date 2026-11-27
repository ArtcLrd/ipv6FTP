#!/bin/sh
set -eu

if [ "${IPV6FTP_SCHEMA_BASELINE_MODE:-}" = 1 ]; then
  : "${IPV6FTP_SCHEMA_BASELINE_CONFIRM:?missing independent baseline confirmation token}"
  : "${IPV6FTP_SCHEMA_BASELINE_SOURCE_SERVICE:?missing source libpq service}"
  : "${IPV6FTP_SCHEMA_BASELINE_RESTORE_SERVICE:?missing restore libpq service}"
  : "${IPV6FTP_SCHEMA_BASELINE_SOURCE_DSN:?missing source migration DSN}"
  export PGSERVICEFILE=/workspace/backend/db/schema/pg_service.conf
  export PGPASSWORD="${IPV6FTP_INTEGRATION_TEST_ROLE_PASSWORD:?missing fixture role password}"
  export DATABASE_URL=
  MIGRATOR_DATABASE_URL="postgres://ipv6ftp_auto_test:${IPV6FTP_INTEGRATION_TEST_ROLE_PASSWORD}@127.0.0.1:5432/ipv6test_schema_source?sslmode=disable" go run ./cmd/migrate up --allow-destructive-reset --isolated-env
  exec go run ./cmd/schema-baseline --generate --confirm-token "$IPV6FTP_SCHEMA_BASELINE_CONFIRM" \
    --source-dsn-env IPV6FTP_SCHEMA_BASELINE_SOURCE_SERVICE \
    --restore-dsn-env IPV6FTP_SCHEMA_BASELINE_RESTORE_SERVICE
fi

# The Go runner owns the disposable ipv6test database lifecycle, migration
# invocation, test selection, and database cleanup.
: "${IPV6FTP_TEST_MAINTENANCE_URL:?missing dedicated integration PostgreSQL DSN}"
exec go run ./cmd/integrationtest "$@"

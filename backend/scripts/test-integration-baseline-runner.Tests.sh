#!/bin/sh
# Offline runner mode tests; fake Go CLI, no Docker or database access.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat >"$tmp/go" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >>"$GO_LOG"
[ "${GO_FAIL_MIGRATION:-}" != 1 ] || { case "$*" in *'cmd/migrate'*) exit 42 ;; esac; }
FAKE
chmod +x "$tmp/go"
export PATH="$tmp:$PATH" GO_LOG="$tmp/go.log"
export IPV6FTP_SCHEMA_BASELINE_MODE=1
export IPV6FTP_SCHEMA_BASELINE_CONFIRM=confirmed-separately
export IPV6FTP_SCHEMA_BASELINE_SOURCE_SERVICE=ipv6ftp_schema_source
export IPV6FTP_SCHEMA_BASELINE_RESTORE_SERVICE=ipv6ftp_schema_restore
export IPV6FTP_SCHEMA_BASELINE_SOURCE_DSN='service=ipv6ftp_schema_source dbname=ipv6test_schema_source'
export IPV6FTP_INTEGRATION_TEST_ROLE_PASSWORD=random-fixture-password
: >"$GO_LOG"
sh "$script_dir/integration-runner.sh"
[ "$(wc -l <"$GO_LOG" | tr -d ' ')" = 2 ] || { echo 'expected migration then baseline generator' >&2; exit 1; }
sed -n '1p' "$GO_LOG" | grep -q '^run ./cmd/migrate up --allow-destructive-reset --isolated-env$' || { echo 'migration was not first or reset flag missing' >&2; exit 1; }
sed -n '2p' "$GO_LOG" | grep -q '^run ./cmd/schema-baseline --generate --confirm-token confirmed-separately ' || { echo 'generator invocation missing' >&2; exit 1; }
: >"$GO_LOG"
set +e
GO_FAIL_MIGRATION=1 sh "$script_dir/integration-runner.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 42 ] || { echo 'migration failure status not propagated' >&2; exit 1; }
[ "$(wc -l <"$GO_LOG" | tr -d ' ')" = 1 ] || { echo 'generator ran after migration failure' >&2; exit 1; }

unset IPV6FTP_SCHEMA_BASELINE_CONFIRM
set +e
sh "$script_dir/integration-runner.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || { echo 'baseline mode accepted missing confirmation token' >&2; exit 1; }
echo 'Baseline runner ordering and confirmation tests passed.'

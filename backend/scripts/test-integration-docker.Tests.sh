#!/bin/sh
# Offline harness tests: fake Docker CLI only; never contacts Docker.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat >"$tmp/docker" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_LOG"
case "$*" in
  *'ps -aq '*|*'network ls -q '*|*'volume ls -q '*)
    if [ "${DOCKER_COLLISION:-}" = "$*" ]; then
      printf 'unrelated-resource-id\n'
    fi
    exit 0
    ;;
  *'compose '*run*) exit "${DOCKER_RUN_STATUS:-0}" ;;
  *'compose '*down*) exit "${DOCKER_DOWN_STATUS:-0}" ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$tmp/docker"
export DOCKER_LOG="$tmp/docker.log"
PATH="$tmp:$PATH"
export PATH
export IPV6FTP_INTEGRATION_PROJECT_SUFFIX=0123456789abcdef
: >"$DOCKER_LOG"
set +e
DOCKER_COLLISION='ps -aq --filter label=com.docker.compose.project=ipv6ftp-it-0123456789abcdef' \
  sh "$script_dir/test-integration-docker.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 3 ] || { echo 'collision was not refused' >&2; exit 1; }
! grep -q 'compose ' "$DOCKER_LOG" || { echo 'collision path mutated Compose resources' >&2; exit 1; }

# A failed runner must invoke down for the exact generated project only.
: >"$DOCKER_LOG"
set +e
DOCKER_RUN_STATUS=42 sh "$script_dir/test-integration-docker.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 42 ] || { echo 'runner failure status was not preserved' >&2; exit 1; }
grep -q 'compose -p ipv6ftp-it-0123456789abcdef -f compose.integration.yaml down --volumes --remove-orphans' "$DOCKER_LOG" || {
  echo 'failure cleanup did not target the owned project' >&2; exit 1;
}

# Simulate TERM while runner is active; trap must clean only the owned project.
cat >"$tmp/docker" <<'SLOW'
#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_LOG"
case "$*" in
  *'ps -aq '*|*'network ls -q '*|*'volume ls -q '*) exit 0 ;;
  *'compose '*run*) kill -TERM "$PPID"; sleep 1; exit 0 ;;
  *'compose '*down*) exit 0 ;;
esac
SLOW
chmod +x "$tmp/docker"
: >"$DOCKER_LOG"
set +e
sh "$script_dir/test-integration-docker.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 143 ] || { echo 'TERM status was not preserved' >&2; exit 1; }
grep -q 'compose -p ipv6ftp-it-0123456789abcdef -f compose.integration.yaml down --volumes --remove-orphans' "$DOCKER_LOG" || {
  echo 'TERM cleanup did not target the owned project' >&2; exit 1;
}
echo 'Docker harness offline lifecycle tests passed.'

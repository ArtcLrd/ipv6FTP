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
  *'compose '*up*)
    case "$*" in
      *'up --build --abort-on-container-exit --exit-code-from api') ;;
      *) echo 'Compose up must abort on exit and report the API status' >&2; exit 91 ;;
    esac
    for key in IPV6FTP_DEVICE_EMAIL_PAYLOAD_KEY IPV6FTP_DEVICE_NOISE_STATIC_KEY; do
      eval "value=\${$key}"
      bytes=$(printf '%s' "$value" | base64 -d 2>/dev/null | wc -c | tr -d '[:space:]')
      [ "$bytes" = 32 ] || { echo "$key is not base64 of 32 bytes" >&2; exit 90; }
    done
    exit "${DOCKER_UP_STATUS:-0}"
    ;; 
  *'compose '*down*) exit "${DOCKER_DOWN_STATUS:-0}" ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$tmp/docker"
export DOCKER_LOG="$tmp/docker.log"
PATH="$tmp:$PATH"
export PATH
export IPV6FTP_DEVICE_PROJECT_SUFFIX=0123456789abcdef
: >"$DOCKER_LOG"
set +e
DOCKER_COLLISION='ps -aq --filter label=com.docker.compose.project=ipv6ftp-dev-0123456789abcdef' \
  sh "$script_dir/test-device-docker.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 3 ] || { echo 'collision was not refused' >&2; exit 1; }
! grep -q 'compose ' "$DOCKER_LOG" || { echo 'collision path mutated Compose resources' >&2; exit 1; }

# A failed `up` must invoke down for the exact generated project only.
# The fake CLI also validates both encoded key values without exposing them.
: >"$DOCKER_LOG"
set +e
DOCKER_UP_STATUS=42 sh "$script_dir/test-device-docker.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 42 ] || { echo 'up failure status was not preserved' >&2; exit 1; }
grep -q 'compose -p ipv6ftp-dev-0123456789abcdef -f compose.device.yaml down --volumes --remove-orphans' "$DOCKER_LOG" || {
  echo 'failure cleanup did not target the owned project' >&2; exit 1;
}

# Simulate TERM while `up` is active; trap must clean only the owned project.
cat >"$tmp/docker" <<'SLOW'
#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_LOG"
case "$*" in
  *'ps -aq '*|*'network ls -q '*|*'volume ls -q '*) exit 0 ;;
  *'compose '*up*) kill -TERM "$PPID"; sleep 1; exit 0 ;;
  *'compose '*down*) exit 0 ;;
esac
SLOW
chmod +x "$tmp/docker"
: >"$DOCKER_LOG"
set +e
sh "$script_dir/test-device-docker.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 143 ] || { echo 'TERM status was not preserved' >&2; exit 1; }
grep -q 'compose -p ipv6ftp-dev-0123456789abcdef -f compose.device.yaml down --volumes --remove-orphans' "$DOCKER_LOG" || {
  echo 'TERM cleanup did not target the owned project' >&2; exit 1;
}
echo 'Device backend harness offline lifecycle tests passed.'

#!/bin/sh
set -eu

# Starts a disposable backend for a USB-connected physical Android phone.
# Never targets host PostgreSQL or a persistent database. Stop with Ctrl+C
# when finished; cleanup always runs.

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backend_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$backend_dir"

# A unique Compose project prevents collisions with unrelated Docker resources.
suffix=${IPV6FTP_DEVICE_PROJECT_SUFFIX:-$(od -An -N8 -tx1 /dev/urandom | tr -d '[:space:]')}
case "$suffix" in
  *[!a-f0-9]*|'') echo "Invalid device project suffix" >&2; exit 2 ;;
esac
project="ipv6ftp-dev-$suffix"
compose_file=compose.device.yaml

# Refuse to adopt or remove any pre-existing resource carrying this exact
# Compose project label. These read-only checks happen before cleanup is armed.
for resource in container network volume; do
  case "$resource" in
    container) matches=$(docker ps -aq --filter "label=com.docker.compose.project=$project") ;;
    network) matches=$(docker network ls -q --filter "label=com.docker.compose.project=$project") ;;
    volume) matches=$(docker volume ls -q --filter "label=com.docker.compose.project=$project") ;;
  esac
  if [ -n "$matches" ]; then
    echo "Refusing existing Compose $resource for project $project; no resources changed" >&2
    exit 3
  fi
done

# Independent per-run credentials. None of these are reused from any other
# environment; the device backend is always a fresh, disposable database.
IPV6FTP_DEVICE_POSTGRES_PASSWORD=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
IPV6FTP_DEVICE_ROLE_PASSWORD=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
IPV6FTP_DEVICE_JWT_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
IPV6FTP_DEVICE_RECOVERY_PEPPER=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
IPV6FTP_DEVICE_EMAIL_PAYLOAD_KEY=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n')
IPV6FTP_DEVICE_NOISE_STATIC_KEY=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n')
export IPV6FTP_DEVICE_POSTGRES_PASSWORD
export IPV6FTP_DEVICE_ROLE_PASSWORD
export IPV6FTP_DEVICE_JWT_SECRET
export IPV6FTP_DEVICE_RECOVERY_PEPPER
export IPV6FTP_DEVICE_EMAIL_PAYLOAD_KEY
export IPV6FTP_DEVICE_NOISE_STATIC_KEY

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if ! docker compose -p "$project" -f "$compose_file" down --volumes --remove-orphans; then
    echo "WARNING: cleanup failed; inspect Compose project $project manually" >&2
    [ "$status" -ne 0 ] || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

echo "Device backend starting under Compose project $project." >&2
echo "Once 'ipv6FTP server starting on :8080' appears below, on the host run:" >&2
echo "  adb reverse tcp:8080 tcp:8080" >&2
echo "Then point the dev build at http://127.0.0.1:8080 (EXPO_PUBLIC_BACKEND_URL)." >&2
echo "Press Ctrl+C here to stop and remove this disposable backend." >&2

docker compose -p "$project" -f "$compose_file" up --build --abort-on-container-exit --exit-code-from api

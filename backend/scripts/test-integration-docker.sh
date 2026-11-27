#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backend_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
cd "$backend_dir"

# A unique Compose project prevents collisions with unrelated Docker resources.
# The project name is retained for cleanup even if startup or tests fail.
suffix=${IPV6FTP_INTEGRATION_PROJECT_SUFFIX:-$(od -An -N8 -tx1 /dev/urandom | tr -d '[:space:]')}
case "$suffix" in
  *[!a-f0-9]*|'') echo "Invalid integration project suffix" >&2; exit 2 ;;
esac
project="ipv6ftp-it-$suffix"
compose_file=compose.integration.yaml

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
# Independent per-run credentials and fixture identity. The identity token is
# never a password and is only used to prove this disposable cluster's origin.
IPV6FTP_INTEGRATION_POSTGRES_PASSWORD=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
IPV6FTP_INTEGRATION_TEST_ROLE_PASSWORD=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
IPV6FTP_INTEGRATION_FIXTURE_TOKEN=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
export IPV6FTP_INTEGRATION_POSTGRES_PASSWORD
export IPV6FTP_INTEGRATION_TEST_ROLE_PASSWORD
export IPV6FTP_INTEGRATION_FIXTURE_TOKEN
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

docker compose -p "$project" -f "$compose_file" run --build --rm runner

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DATA_ROOT="${HMS_LOCAL_DATA_DIR:-/data/hms}"
ENV_FILE="${HMS_LOCAL_ENV_FILE:-$DATA_ROOT/config/local-server.env}"

sudo mkdir -p \
  "$DATA_ROOT/config" \
  "$DATA_ROOT/secrets" \
  "$DATA_ROOT/state" \
  "$DATA_ROOT/uploads" \
  "$DATA_ROOT/caddy/data" \
  "$DATA_ROOT/caddy/config" \
  /data/backups/hms

sudo chown -R "${USER}:${USER}" "$DATA_ROOT" /data/backups/hms
chmod 700 "$DATA_ROOT/secrets"

if [[ ! -f "$ENV_FILE" ]]; then
  cp deploy/local-server/local-server.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE"
fi

echo "Building and starting HMS local stack."
docker compose \
  --env-file "$ENV_FILE" \
  -f deploy/local-server/compose.yml \
  up -d --build

echo "Waiting for local HMS health endpoint."
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1/api/local-server/status >/dev/null; then
    echo "HMS local server is healthy."
    docker compose --env-file "$ENV_FILE" -f deploy/local-server/compose.yml ps
    exit 0
  fi
  sleep 2
done

echo "HMS local server did not become healthy in time." >&2
docker compose --env-file "$ENV_FILE" -f deploy/local-server/compose.yml logs --tail=120
exit 1

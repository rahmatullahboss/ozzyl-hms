#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${HMS_LOCAL_PORT:-8787}"
IP="${HMS_LOCAL_IP:-0.0.0.0}"
STATE_DIR="${HMS_LOCAL_STATE_DIR:-.local-hms/state}"
VARS_FILE="${HMS_LOCAL_VARS_FILE:-.dev.vars.local_server}"

mkdir -p "$STATE_DIR"
mkdir -p "${HMS_LOCAL_UPLOADS_DIR:-/data/hms/uploads}"
mkdir -p "$(dirname "$VARS_FILE")"

if [[ ! -f "$VARS_FILE" ]]; then
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET_VALUE="$(openssl rand -hex 32)"
  else
    JWT_SECRET_VALUE="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  fi

  cat > "$VARS_FILE" <<EOF
JWT_SECRET="$JWT_SECRET_VALUE"
# Optional cloud sync settings. Leave empty until this local server is paired with production.
CLOUD_SYNC_BASE_URL=""
CLOUD_SYNC_TOKEN=""
EOF
  echo "Created $VARS_FILE with a local JWT secret."
fi

WRANGLER_VARS_FILE="$ROOT_DIR/.dev.vars.local_server"
if [[ "$VARS_FILE" != "$WRANGLER_VARS_FILE" ]]; then
  ln -sf "$VARS_FILE" "$WRANGLER_VARS_FILE"
fi

echo "Starting HMS local server on http://$IP:$PORT"
echo "Persistent local storage: $STATE_DIR"
echo "Persistent local object/R2 state: $STATE_DIR (upload export dir: ${HMS_LOCAL_UPLOADS_DIR:-/data/hms/uploads})"
echo "Local secret vars file: $VARS_FILE"
echo "LAN users should open http://<hospital-server-ip>:$PORT"

exec pnpm exec wrangler dev --env local_server --local --ip "$IP" --port "$PORT" --persist-to "$STATE_DIR"

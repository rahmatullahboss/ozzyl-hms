#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

NODE_HOME="${HMS_WORKSTATION_HOME:-$HOME/.ozzyl-hms/workstation}"
STATE_DIR="${HMS_WORKSTATION_STATE_DIR:-$NODE_HOME/state}"
CONFIG_FILE="${HMS_WORKSTATION_CONFIG:-$NODE_HOME/workstation.env}"
VARS_FILE="${HMS_WORKSTATION_VARS_FILE:-$NODE_HOME/.dev.vars.workstation}"
PORT="${HMS_WORKSTATION_PORT:-8787}"
PID_DIR="$NODE_HOME/pids"
NODE_ID_FILE="$NODE_HOME/node-id"
JWT_SECRET_FILE="$NODE_HOME/jwt-secret"

mkdir -p "$NODE_HOME" "$STATE_DIR" "$PID_DIR"
umask 077

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

random_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    node -e "console.log(require('crypto').randomUUID())"
  fi
}

if [[ ! -f "$NODE_ID_FILE" ]]; then
  printf 'hms-workstation-%s\n' "$(random_uuid)" > "$NODE_ID_FILE"
fi
if [[ ! -f "$JWT_SECRET_FILE" ]]; then
  random_hex > "$JWT_SECRET_FILE"
fi

NODE_ID="$(tr -d '\r\n' < "$NODE_ID_FILE")"
JWT_SECRET="$(tr -d '\r\n' < "$JWT_SECRET_FILE")"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

TENANT_ID="${HMS_WORKSTATION_TENANT_ID:-${LOCAL_TENANT_ID:-}}"
TENANT_SUBDOMAIN="${HMS_WORKSTATION_TENANT_SUBDOMAIN:-${LOCAL_TENANT_SUBDOMAIN:-}}"
CLOUD_BASE_URL="${HMS_WORKSTATION_CLOUD_BASE_URL:-${CLOUD_SYNC_BASE_URL:-https://hms.ozzyl.com}}"
CLOUD_TOKEN="${HMS_WORKSTATION_CLOUD_SYNC_TOKEN:-${CLOUD_SYNC_TOKEN:-}}"

if [[ -z "$TENANT_ID" ]]; then
  echo "HMS workstation is not provisioned: tenant ID is missing." >&2
  echo "Set HMS_WORKSTATION_TENANT_ID (and cloud sync credentials) once, then run again." >&2
  exit 2
fi

cat > "$VARS_FILE" <<EOF
JWT_SECRET="$JWT_SECRET"
LOCAL_SERVER_ID="$NODE_ID"
LOCAL_TENANT_ID="$TENANT_ID"
LOCAL_TENANT_SUBDOMAIN="$TENANT_SUBDOMAIN"
CLOUD_SYNC_BASE_URL="$CLOUD_BASE_URL"
CLOUD_SYNC_TOKEN="$CLOUD_TOKEN"
EOF
chmod 600 "$VARS_FILE" 2>/dev/null || true

export HMS_LOCAL_STATE_DIR="$STATE_DIR"
export HMS_LOCAL_VARS_FILE="$VARS_FILE"
export HMS_LOCAL_IP="127.0.0.1"
export HMS_LOCAL_PORT="$PORT"
export HMS_LOCAL_SYNC_INTERVAL_SECONDS="${HMS_WORKSTATION_SYNC_INTERVAL_SECONDS:-30}"
export HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS="${HMS_WORKSTATION_CONNECT_TIMEOUT_SECONDS:-4}"
export HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS="${HMS_WORKSTATION_REQUEST_TIMEOUT_SECONDS:-30}"
export HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS="0"
export HMS_LOCAL_STATUS_URL="http://127.0.0.1:$PORT/api/local-server/status"
export HMS_LOCAL_SYNC_FLUSH_URL="http://127.0.0.1:$PORT/api/sync/outbox/flush"
export HMS_LOCAL_SYNC_PULL_URL="http://127.0.0.1:$PORT/api/sync/cloud-pull/run"

if [[ ! -f "$STATE_DIR/.workstation-schema-ready" ]]; then
  echo "Preparing workstation database..."
  bash scripts/local-server/migrate.sh
  touch "$STATE_DIR/.workstation-schema-ready"
fi

if [[ ! -f web/dist/index.html ]]; then
  echo "Local web bundle not found; building workstation UI..."
  pnpm --filter web build
fi

APP_LOG="$NODE_HOME/app.log"
SYNC_LOG="$NODE_HOME/sync.log"

echo "Starting Ozzyl HMS workstation node: $NODE_ID"
echo "Tenant: $TENANT_ID"
echo "Local URL: http://127.0.0.1:$PORT"
echo "Persistent state: $STATE_DIR"

bash scripts/local-server/start.sh >"$APP_LOG" 2>&1 &
APP_PID=$!
printf '%s\n' "$APP_PID" > "$PID_DIR/app.pid"

cleanup() {
  if [[ -n "${SYNC_PID:-}" ]]; then kill "$SYNC_PID" 2>/dev/null || true; fi
  kill "$APP_PID" 2>/dev/null || true
  rm -f "$PID_DIR/app.pid" "$PID_DIR/sync.pid"
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 60); do
  if curl --connect-timeout 1 --max-time 2 -fsS "$HMS_LOCAL_STATUS_URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "Workstation runtime exited during startup. See $APP_LOG" >&2
    exit 1
  fi
  sleep 1
done

if [[ "$READY" != "1" ]]; then
  echo "Workstation runtime did not become ready. See $APP_LOG" >&2
  exit 1
fi

if [[ -n "$CLOUD_TOKEN" ]]; then
  bash scripts/local-server/sync-worker.sh >"$SYNC_LOG" 2>&1 &
  SYNC_PID=$!
  printf '%s\n' "$SYNC_PID" > "$PID_DIR/sync.pid"
  echo "Automatic cloud sync enabled."
else
  echo "Cloud sync token is not configured; node will remain offline-only until provisioned."
fi

echo "Workstation node is ready. Open http://127.0.0.1:$PORT"
wait "$APP_PID"

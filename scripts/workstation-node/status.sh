#!/usr/bin/env bash
set -euo pipefail

NODE_HOME="${HMS_WORKSTATION_HOME:-$HOME/.ozzyl-hms/workstation}"
CONFIG_FILE="${HMS_WORKSTATION_CONFIG:-$NODE_HOME/workstation.env}"
PORT="${HMS_WORKSTATION_PORT:-8787}"
BASE="http://127.0.0.1:$PORT"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

echo "--- workstation identity ---"
echo "Node ID: $(cat "$NODE_HOME/node-id" 2>/dev/null || echo 'not generated')"
echo "Node code: $(cat "$NODE_HOME/node-code" 2>/dev/null || echo 'not generated')"
if [[ -n "${LAN_COORDINATOR_URL:-}" ]]; then
  echo "LAN coordinator: configured (${LAN_COORDINATOR_URL})"
else
  echo "LAN coordinator: not configured"
fi

echo
echo "--- workstation runtime ---"
if ! curl --connect-timeout 1 --max-time 3 -fsS "$BASE/api/local-server/status"; then
  echo
  echo "Workstation runtime is not reachable on $BASE" >&2
  exit 1
fi

echo
echo "--- cloud pull status ---"
curl --connect-timeout 1 --max-time 5 -fsS "$BASE/api/sync/cloud-pull/status" || true

echo
echo "--- local health ---"
curl --connect-timeout 1 --max-time 3 -fsS "$BASE/api/health" || true
echo

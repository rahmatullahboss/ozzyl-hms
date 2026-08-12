#!/usr/bin/env bash
set -euo pipefail

PORT="${HMS_WORKSTATION_PORT:-8787}"
BASE="http://127.0.0.1:$PORT"

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

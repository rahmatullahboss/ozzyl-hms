#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="${HMS_LOCAL_STATE_DIR:-.local-hms/state}"
SNAPSHOT_FILE="${1:-}"

if [[ -z "$SNAPSHOT_FILE" ]]; then
  echo "Usage: pnpm local-server:import /path/to/tenant-scoped-snapshot.sql" >&2
  exit 2
fi

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "Snapshot file not found: $SNAPSHOT_FILE" >&2
  exit 2
fi

mkdir -p "$STATE_DIR"

echo "Importing tenant-scoped snapshot into the hospital local-server database."
echo "Persistent local storage: $STATE_DIR"

pnpm exec wrangler d1 execute hms-local-server \
  --env local_server \
  --local \
  --persist-to "$STATE_DIR" \
  --file="$SNAPSHOT_FILE"

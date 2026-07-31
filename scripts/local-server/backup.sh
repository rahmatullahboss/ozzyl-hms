#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${HMS_LOCAL_BACKUP_DIR:-/data/backups/hms}"
SOURCE_ROOT="${HMS_LOCAL_DATA_DIR:-/data/hms}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="$BACKUP_ROOT/$STAMP"

if [[ ! -d "$SOURCE_ROOT" ]]; then
  echo "Local HMS data directory not found: $SOURCE_ROOT" >&2
  exit 2
fi

sudo mkdir -p "$DEST_DIR"

echo "Creating HMS local backup: $DEST_DIR"
sudo tar \
  --create \
  --gzip \
  --file "$DEST_DIR/hms-local-data.tgz" \
  --directory "$SOURCE_ROOT" \
  --exclude "caddy/data/caddy/locks" \
  .

sudo sha256sum "$DEST_DIR/hms-local-data.tgz" | sudo tee "$DEST_DIR/SHA256SUMS" >/dev/null
sudo chmod -R go-rwx "$DEST_DIR"

echo "Backup complete:"
sudo ls -lh "$DEST_DIR"

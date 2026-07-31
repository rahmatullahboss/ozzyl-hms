#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

UNIT_SOURCE_DIR="deploy/local-server/systemd"
SERVICE_NAME="hms-local-auto-update.service"
TIMER_NAME="hms-local-auto-update.timer"

if [[ ! -f "$UNIT_SOURCE_DIR/$SERVICE_NAME" || ! -f "$UNIT_SOURCE_DIR/$TIMER_NAME" ]]; then
  echo "Auto-update unit files are missing from $UNIT_SOURCE_DIR" >&2
  exit 2
fi

echo "Installing HMS local server auto-update systemd units."
sudo install -m 0644 "$UNIT_SOURCE_DIR/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
sudo install -m 0644 "$UNIT_SOURCE_DIR/$TIMER_NAME" "/etc/systemd/system/$TIMER_NAME"

sudo systemctl daemon-reload
sudo systemctl enable --now "$TIMER_NAME"

echo "Auto-update timer status:"
sudo systemctl list-timers --all "$TIMER_NAME"

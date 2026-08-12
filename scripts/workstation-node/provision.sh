#!/usr/bin/env bash
set -euo pipefail

NODE_HOME="${HMS_WORKSTATION_HOME:-$HOME/.ozzyl-hms/workstation}"
CONFIG_FILE="${HMS_WORKSTATION_CONFIG:-$NODE_HOME/workstation.env}"

TENANT_ID="${HMS_WORKSTATION_TENANT_ID:-}"
TENANT_SUBDOMAIN="${HMS_WORKSTATION_TENANT_SUBDOMAIN:-}"
CLOUD_BASE_URL="${HMS_WORKSTATION_CLOUD_BASE_URL:-https://hms.ozzyl.com}"
CLOUD_TOKEN="${HMS_WORKSTATION_CLOUD_SYNC_TOKEN:-}"
LAN_COORDINATOR_URL="${HMS_WORKSTATION_LAN_COORDINATOR_URL:-}"
LAN_COORDINATOR_TOKEN="${HMS_WORKSTATION_LAN_COORDINATOR_TOKEN:-}"

if [[ -z "$TENANT_ID" || -z "$CLOUD_TOKEN" ]]; then
  cat >&2 <<'EOF'
Provisioning requires:
  HMS_WORKSTATION_TENANT_ID
  HMS_WORKSTATION_CLOUD_SYNC_TOKEN
Optional:
  HMS_WORKSTATION_TENANT_SUBDOMAIN
  HMS_WORKSTATION_CLOUD_BASE_URL (default: https://hms.ozzyl.com)
  HMS_WORKSTATION_LAN_COORDINATOR_URL
  HMS_WORKSTATION_LAN_COORDINATOR_TOKEN

The tokens are written to a user-private workstation config and are never printed.
The LAN coordinator is an optimization/coordination upstream; the workstation
continues to own its local state when LAN or internet connectivity is absent.
EOF
  exit 2
fi

if [[ -n "$LAN_COORDINATOR_URL" && -z "$LAN_COORDINATOR_TOKEN" ]]; then
  echo "LAN coordinator URL was provided without HMS_WORKSTATION_LAN_COORDINATOR_TOKEN." >&2
  exit 2
fi

mkdir -p "$NODE_HOME"
umask 077

{
  printf 'LOCAL_TENANT_ID=%q\n' "$TENANT_ID"
  printf 'LOCAL_TENANT_SUBDOMAIN=%q\n' "$TENANT_SUBDOMAIN"
  printf 'CLOUD_SYNC_BASE_URL=%q\n' "$CLOUD_BASE_URL"
  printf 'CLOUD_SYNC_TOKEN=%q\n' "$CLOUD_TOKEN"
  printf 'LAN_COORDINATOR_URL=%q\n' "$LAN_COORDINATOR_URL"
  printf 'LAN_COORDINATOR_TOKEN=%q\n' "$LAN_COORDINATOR_TOKEN"
} > "$CONFIG_FILE"

chmod 600 "$CONFIG_FILE" 2>/dev/null || true

echo "Ozzyl HMS workstation provisioning saved."
echo "Tenant: $TENANT_ID"
if [[ -n "$LAN_COORDINATOR_URL" ]]; then
  echo "LAN coordinator: configured"
else
  echo "LAN coordinator: not configured (direct cloud fallback only)"
fi
echo "Config: $CONFIG_FILE"
echo "Next: bash scripts/workstation-node/run.sh"

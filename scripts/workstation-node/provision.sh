#!/usr/bin/env bash
set -euo pipefail

NODE_HOME="${HMS_WORKSTATION_HOME:-$HOME/.ozzyl-hms/workstation}"
CONFIG_FILE="${HMS_WORKSTATION_CONFIG:-$NODE_HOME/workstation.env}"

TENANT_ID="${HMS_WORKSTATION_TENANT_ID:-}"
TENANT_SUBDOMAIN="${HMS_WORKSTATION_TENANT_SUBDOMAIN:-}"
CLOUD_BASE_URL="${HMS_WORKSTATION_CLOUD_BASE_URL:-https://hms.ozzyl.com}"
CLOUD_TOKEN="${HMS_WORKSTATION_CLOUD_SYNC_TOKEN:-}"

if [[ -z "$TENANT_ID" || -z "$CLOUD_TOKEN" ]]; then
  cat >&2 <<'EOF'
Provisioning requires:
  HMS_WORKSTATION_TENANT_ID
  HMS_WORKSTATION_CLOUD_SYNC_TOKEN
Optional:
  HMS_WORKSTATION_TENANT_SUBDOMAIN
  HMS_WORKSTATION_CLOUD_BASE_URL (default: https://hms.ozzyl.com)

The token is written to a user-private workstation config and is never printed.
EOF
  exit 2
fi

mkdir -p "$NODE_HOME"
umask 077

{
  printf 'LOCAL_TENANT_ID=%q\n' "$TENANT_ID"
  printf 'LOCAL_TENANT_SUBDOMAIN=%q\n' "$TENANT_SUBDOMAIN"
  printf 'CLOUD_SYNC_BASE_URL=%q\n' "$CLOUD_BASE_URL"
  printf 'CLOUD_SYNC_TOKEN=%q\n' "$CLOUD_TOKEN"
} > "$CONFIG_FILE"

chmod 600 "$CONFIG_FILE" 2>/dev/null || true

echo "Ozzyl HMS workstation provisioning saved."
echo "Tenant: $TENANT_ID"
echo "Config: $CONFIG_FILE"
echo "Next: bash scripts/workstation-node/run.sh"

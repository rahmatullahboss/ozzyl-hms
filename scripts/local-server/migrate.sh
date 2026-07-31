#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="${HMS_LOCAL_STATE_DIR:-.local-hms/state}"
APPLY_VERSIONED="${HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS:-0}"
CI_BOOTSTRAP="${HMS_LOCAL_CI_BOOTSTRAP:-0}"
FORCE_TENANT_SCHEMA="${HMS_LOCAL_FORCE_TENANT_SCHEMA:-0}"
SKIP_REAGENT_BOOTSTRAP="${HMS_LOCAL_SKIP_REAGENT_BOOTSTRAP:-0}"
mkdir -p "$STATE_DIR"

D1=(pnpm exec wrangler d1 execute hms-local-server --env local_server --local --persist-to "$STATE_DIR")

run_sql() {
  "${D1[@]}" --command "$1"
}

run_file() {
  "${D1[@]}" --file="$1"
}

table_exists() {
  local table="$1"
  run_sql "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '$table';" 2>&1 | grep -q '"n": 1'
}

migration_recorded() {
  local filename="$1"
  run_sql "SELECT COUNT(*) AS n FROM local_schema_migrations WHERE filename = '$filename';" 2>&1 | grep -q '"n": 1'
}

record_migration() {
  local filename="$1"
  local hash
  if command -v shasum >/dev/null 2>&1; then
    hash="sha256:$(shasum -a 256 "$filename" | awk '{print $1}')"
  else
    hash="local-bootstrap"
  fi
  run_sql "INSERT OR REPLACE INTO local_schema_migrations (filename, safety, content_hash, applied_at, duration_ms) VALUES ('$filename', 'safe', '$hash', datetime('now'), 0);" >/dev/null
}

run_file_once() {
  local file="$1"
  if migration_recorded "$file"; then
    echo "Skipping already-applied local bootstrap: $file"
    return 0
  fi
  echo "Applying local bootstrap: $file"
  run_file "$file"
  record_migration "$file"
}

ensure_base_schema() {
  echo "Applying baseline schema files."
  run_file schema.sql

  # local_schema_migrations/local_schema_sync_log are used by the local schema
  # reconciler and by this script to keep additive bootstrap files idempotent.
  if ! table_exists local_schema_migrations; then
    echo "Creating local schema migration tracking tables."
    run_file migrations/0336_local_schema_sync_tables.sql
  fi
}

ensure_tenant_baseline() {
  if table_exists patients; then
    echo "Tenant baseline already exists; skipping tenant-baseline.sql."
    return 0
  fi
  echo "Applying stable tenant baseline."
  run_file tenant-baseline.sql
}

apply_reagent_bootstrap() {
  if [[ "$SKIP_REAGENT_BOOTSTRAP" == "1" ]]; then
    echo "Skipping reagent bootstrap because HMS_LOCAL_SKIP_REAGENT_BOOTSTRAP=1."
    return 0
  fi

  echo "Applying local reagent/inventory bootstrap migrations."
  local files=(
    migrations/0001_fix_schema_add_missing_tables.sql
    migrations/0033_operation_theatre.sql
    migrations/0037_inventory.sql
    migrations/0053_radiology.sql
    migrations/0143_lis_full_upgrade.sql
    migrations/0170_lab_consumables_monitoring.sql
    migrations/0372_lab_consumable_consumption_claims.sql
    migrations/0373_lab_consumable_stock_qc.sql
    migrations/0374_lab_consumable_stock_onboard_expiry.sql
    migrations/0375_lab_consumable_stock_locations.sql
    migrations/0376_lab_consumable_waste_requests.sql
    migrations/0377_lab_operation_logs_stock_lifecycle_types.sql
    migrations/0378_lab_inventory_bridge_links.sql
    migrations/0392_lab_reagent_analyzer_assignments.sql
    migrations/0393_lab_inventory_policy.sql
    migrations/0394_lab_inventory_exception_and_claim_lifecycle.sql
    migrations/0395_lab_inventory_policy_modes.sql
    migrations/0396_lab_test_consumable_map_lifecycle.sql
    migrations/0398_inventory_consumption_automation.sql
  )

  for file in "${files[@]}"; do
    run_file_once "$file"
  done
}

echo "Preparing the hospital local-server database."
echo "Persistent local storage: $STATE_DIR"

ensure_base_schema
ensure_tenant_baseline

if [[ "$CI_BOOTSTRAP" == "1" ]]; then
  echo "CI bootstrap complete."
  exit 0
fi

apply_reagent_bootstrap

if [[ "$APPLY_VERSIONED" == "1" ]]; then
  echo "WARNING: full versioned local D1 migration chain is known to be structurally stale."
  echo "Running it only because HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 was explicitly set."
  pnpm exec wrangler d1 migrations apply hms-local-server \
    --env local_server \
    --local \
    --persist-to "$STATE_DIR"
elif [[ "$FORCE_TENANT_SCHEMA" == "1" ]]; then
  echo "WARNING: tenant-schema.sql contains stale additive ALTER blocks and can fail on fresh local DBs."
  echo "Running it only because HMS_LOCAL_FORCE_TENANT_SCHEMA=1 was explicitly set."
  run_file tenant-schema.sql
else
  echo "Local server schema ready."
  echo "Default path applied baseline + tenant baseline + reagent/inventory bootstrap."
  echo "For a real hospital tenant, import a tenant-scoped cloud snapshot instead of forcing tenant-schema.sql."
fi

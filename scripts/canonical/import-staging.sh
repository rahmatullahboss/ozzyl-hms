#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(
  PRODUCTION_DB_NAME
  PRODUCTION_DB_ID
  CLONE_DB_NAME
  CLONE_DB_ID
  EXPORT_FILE
  EXPORT_SHA256
  CLONE_IMPORT_FILE
  CLONE_IMPORT_SHA256
  CLONE_IMPORT_CONFIRMATION
)

for variable_name in "${required_env[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$variable_name" >&2
    exit 1
  fi
done

if [[ "$CLONE_IMPORT_CONFIRMATION" != "IMPORT_CANONICAL_REHEARSAL_D1" ]]; then
  printf 'Refusing clone import: confirmation token must be IMPORT_CANONICAL_REHEARSAL_D1\n' >&2
  exit 1
fi

if [[ "$PRODUCTION_DB_NAME" == "$CLONE_DB_NAME" || "$PRODUCTION_DB_ID" == "$CLONE_DB_ID" ]]; then
  printf 'Refusing clone import: production and clone identities must differ\n' >&2
  exit 1
fi

if [[ ! "$PRODUCTION_DB_ID" =~ ^[0-9a-fA-F-]{36}$ || ! "$CLONE_DB_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Refusing clone import: production and clone IDs must be UUIDs\n' >&2
  exit 1
fi

protected_target_ids=(
  "9e72382e-0d73-49da-90c8-ad5ff6fc5911"
  "860ffc7b-3add-4b99-9538-1fdb707c9590"
  "a9fbe8cb-3fc0-41cf-9272-e561fe65affd"
)
protected_target_names=(
  "hms-super-admin-staging"
  "hms-restore-drill-20260713"
)

for protected_target_id in "${protected_target_ids[@]}"; do
  if [[ "$CLONE_DB_ID" == "$protected_target_id" ]]; then
    printf 'Refusing clone import: protected target UUID requires separate ownership evidence\n' >&2
    exit 1
  fi
done

for protected_target_name in "${protected_target_names[@]}"; do
  if [[ "$CLONE_DB_NAME" == "$protected_target_name" ]]; then
    printf 'Refusing clone import: protected target name requires a fresh dedicated rehearsal database\n' >&2
    exit 1
  fi
done

if [[ ! -f "$EXPORT_FILE" ]]; then
  printf 'Refusing clone import: export file does not exist: %s\n' "$EXPORT_FILE" >&2
  exit 1
fi

ACTUAL_EXPORT_SHA256="$(shasum -a 256 "$EXPORT_FILE" | awk '{print $1}')"
if [[ "$ACTUAL_EXPORT_SHA256" != "$EXPORT_SHA256" ]]; then
  printf 'Refusing clone import: export checksum mismatch\n' >&2
  exit 1
fi

if [[ ! -f "$CLONE_IMPORT_FILE" ]]; then
  printf 'Refusing clone import: validated import bundle does not exist: %s\n' "$CLONE_IMPORT_FILE" >&2
  exit 1
fi

ACTUAL_CLONE_IMPORT_SHA256="$(shasum -a 256 "$CLONE_IMPORT_FILE" | awk '{print $1}')"
if [[ "$ACTUAL_CLONE_IMPORT_SHA256" != "$CLONE_IMPORT_SHA256" ]]; then
  printf 'Refusing clone import: import bundle checksum mismatch\n' >&2
  exit 1
fi

CLONE_EXPORT_FILE="${CLONE_EXPORT_FILE:-${EXPORT_FILE%.sql}-${CLONE_DB_NAME}.sql}"
CLONE_EXPORT_PARTIAL="${CLONE_EXPORT_FILE}.partial"
RECONCILIATION_FILE="${RECONCILIATION_FILE:-${EXPORT_FILE%.sql}-reconciliation.json}"
IMPORT_METADATA_FILE="${IMPORT_METADATA_FILE:-${EXPORT_FILE%.sql}-clone-import.json}"

for protected_output in \
  "$CLONE_EXPORT_FILE" \
  "$CLONE_EXPORT_PARTIAL" \
  "$RECONCILIATION_FILE" \
  "$IMPORT_METADATA_FILE"; do
  if [[ -e "$protected_output" ]]; then
    printf 'Refusing to overwrite existing clone evidence: %s\n' "$protected_output" >&2
    exit 1
  fi
done

verify_identity() {
  local json_text="$1"
  local expected_name="$2"
  local expected_id="$3"
  local label="$4"
  local expected_table_state="${5:-any}"

  WRANGLER_JSON="$json_text" EXPECTED_DB_NAME="$expected_name" EXPECTED_DB_ID="$expected_id" DB_LABEL="$label" EXPECTED_TABLE_STATE="$expected_table_state" node <<'NODE'
const text = process.env.WRANGLER_JSON ?? '';
const start = text.indexOf('{');
if (start < 0) throw new Error(`${process.env.DB_LABEL} D1 info output did not contain JSON`);
let depth = 0;
let inString = false;
let escaped = false;
let end = -1;
for (let index = start; index < text.length; index += 1) {
  const char = text[index];
  if (inString) {
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') inString = false;
    continue;
  }
  if (char === '"') {
    inString = true;
    continue;
  }
  if (char === '{') depth += 1;
  if (char === '}') depth -= 1;
  if (depth === 0) {
    end = index + 1;
    break;
  }
}
if (end < 0) throw new Error(`${process.env.DB_LABEL} D1 info JSON was incomplete`);
const parsed = JSON.parse(text.slice(start, end));
if (parsed.name !== process.env.EXPECTED_DB_NAME || parsed.uuid !== process.env.EXPECTED_DB_ID) {
  throw new Error(`${process.env.DB_LABEL} D1 name/UUID did not match the explicit identity`);
}
if (process.env.EXPECTED_TABLE_STATE === 'empty' && Number(parsed.num_tables) !== 0) {
  throw new Error(`Refusing clone import: clone is not empty (${parsed.num_tables} tables)`);
}
NODE
}

printf 'Verifying production source identity without SQL execution...\n'
PRODUCTION_INFO="$(pnpm exec wrangler d1 info "$PRODUCTION_DB_NAME" --json)"
verify_identity "$PRODUCTION_INFO" "$PRODUCTION_DB_NAME" "$PRODUCTION_DB_ID" "Production"

printf 'Verifying isolated clone identity...\n'
CLONE_INFO="$(pnpm exec wrangler d1 info "$CLONE_DB_NAME" --json)"
verify_identity "$CLONE_INFO" "$CLONE_DB_NAME" "$CLONE_DB_ID" "Clone" "empty"

IMPORT_STARTED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'Importing validated topological bundle into isolated clone %s...\n' "$CLONE_DB_NAME"
pnpm exec wrangler d1 execute "$CLONE_DB_NAME" \
  --remote \
  --file "$CLONE_IMPORT_FILE" \
  --yes
IMPORT_COMPLETED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf 'Re-verifying clone identity after import...\n'
CLONE_INFO_AFTER="$(pnpm exec wrangler d1 info "$CLONE_DB_NAME" --json)"
verify_identity "$CLONE_INFO_AFTER" "$CLONE_DB_NAME" "$CLONE_DB_ID" "Clone"

printf 'Exporting the imported clone for local count reconciliation...\n'
pnpm exec wrangler d1 export "$CLONE_DB_NAME" \
  --remote \
  --output "$CLONE_EXPORT_PARTIAL" \
  --skip-confirmation
chmod 600 "$CLONE_EXPORT_PARTIAL"
mv "$CLONE_EXPORT_PARTIAL" "$CLONE_EXPORT_FILE"
chmod 600 "$CLONE_EXPORT_FILE"

printf 'Reconciling source and clone exports locally without row content output...\n'
pnpm exec tsx scripts/canonical/reconcile-clone-exports.ts \
  --source "$EXPORT_FILE" \
  --clone "$CLONE_EXPORT_FILE" \
  --output "$RECONCILIATION_FILE"
chmod 600 "$RECONCILIATION_FILE"

CLONE_EXPORT_SHA256="$(shasum -a 256 "$CLONE_EXPORT_FILE" | awk '{print $1}')"
CLONE_EXPORT_SIZE_BYTES="$(wc -c < "$CLONE_EXPORT_FILE" | tr -d '[:space:]')"


PRODUCTION_DB_NAME="$PRODUCTION_DB_NAME" \
PRODUCTION_DB_ID="$PRODUCTION_DB_ID" \
CLONE_DB_NAME="$CLONE_DB_NAME" \
CLONE_DB_ID="$CLONE_DB_ID" \
EXPORT_FILE="$EXPORT_FILE" \
EXPORT_SHA256="$EXPORT_SHA256" \
CLONE_IMPORT_FILE="$CLONE_IMPORT_FILE" \
CLONE_IMPORT_SHA256="$CLONE_IMPORT_SHA256" \
CLONE_EXPORT_FILE="$CLONE_EXPORT_FILE" \
CLONE_EXPORT_SHA256="$CLONE_EXPORT_SHA256" \
CLONE_EXPORT_SIZE_BYTES="$CLONE_EXPORT_SIZE_BYTES" \
RECONCILIATION_FILE="$RECONCILIATION_FILE" \
IMPORT_STARTED_AT_UTC="$IMPORT_STARTED_AT_UTC" \
IMPORT_COMPLETED_AT_UTC="$IMPORT_COMPLETED_AT_UTC" \
node > "$IMPORT_METADATA_FILE" <<'NODE'
const metadata = {
  productionDatabaseName: process.env.PRODUCTION_DB_NAME,
  productionDatabaseId: process.env.PRODUCTION_DB_ID,
  cloneDatabaseName: process.env.CLONE_DB_NAME,
  cloneDatabaseId: process.env.CLONE_DB_ID,
  exportFile: process.env.EXPORT_FILE,
  exportSha256: process.env.EXPORT_SHA256,
  cloneImportFile: process.env.CLONE_IMPORT_FILE,
  cloneImportSha256: process.env.CLONE_IMPORT_SHA256,
  cloneExportFile: process.env.CLONE_EXPORT_FILE,
  cloneExportSha256: process.env.CLONE_EXPORT_SHA256,
  cloneExportSizeBytes: Number(process.env.CLONE_EXPORT_SIZE_BYTES),
  reconciliationFile: process.env.RECONCILIATION_FILE,
  importStartedAtUtc: process.env.IMPORT_STARTED_AT_UTC,
  importCompletedAtUtc: process.env.IMPORT_COMPLETED_AT_UTC,
};
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
NODE
chmod 600 "$IMPORT_METADATA_FILE"

printf 'CLONE_DB_NAME=%s\n' "$CLONE_DB_NAME"
printf 'CLONE_DB_ID=%s\n' "$CLONE_DB_ID"
printf 'EXPORT_SHA256=%s\n' "$EXPORT_SHA256"
printf 'CLONE_IMPORT_FILE=%s\n' "$CLONE_IMPORT_FILE"
printf 'CLONE_IMPORT_SHA256=%s\n' "$CLONE_IMPORT_SHA256"
printf 'CLONE_EXPORT_FILE=%s\n' "$CLONE_EXPORT_FILE"
printf 'CLONE_EXPORT_SHA256=%s\n' "$CLONE_EXPORT_SHA256"
printf 'CLONE_EXPORT_SIZE_BYTES=%s\n' "$CLONE_EXPORT_SIZE_BYTES"
printf 'RECONCILIATION_FILE=%s\n' "$RECONCILIATION_FILE"
printf 'IMPORT_STARTED_AT_UTC=%s\n' "$IMPORT_STARTED_AT_UTC"
printf 'IMPORT_COMPLETED_AT_UTC=%s\n' "$IMPORT_COMPLETED_AT_UTC"
printf 'IMPORT_METADATA_FILE=%s\n' "$IMPORT_METADATA_FILE"

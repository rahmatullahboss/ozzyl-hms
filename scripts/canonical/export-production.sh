#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(
  PRODUCTION_DB_NAME
  PRODUCTION_DB_ID
  EXPORT_DIR
  PRODUCTION_EXPORT_CONFIRMATION
)

for variable_name in "${required_env[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$variable_name" >&2
    exit 1
  fi
done

if [[ "$PRODUCTION_EXPORT_CONFIRMATION" != "EXPORT_PRODUCTION_D1" ]]; then
  printf 'Refusing production export: confirmation token must be EXPORT_PRODUCTION_D1\n' >&2
  exit 1
fi

if [[ ! "$PRODUCTION_DB_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Refusing production export: PRODUCTION_DB_ID is not a UUID\n' >&2
  exit 1
fi

mkdir -p "$EXPORT_DIR"
chmod 700 "$EXPORT_DIR"

EXPORT_TIMESTAMP_UTC="${EXPORT_TIMESTAMP_UTC:-$(date -u +%Y%m%dT%H%M%SZ)}"
TIME_TRAVEL_TIMESTAMP_UTC="${TIME_TRAVEL_TIMESTAMP_UTC:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
EXPORT_FILE="$EXPORT_DIR/${PRODUCTION_DB_NAME}-${EXPORT_TIMESTAMP_UTC}.sql"
PARTIAL_EXPORT_FILE="${EXPORT_FILE}.partial"
TIME_TRAVEL_FILE="$EXPORT_DIR/${PRODUCTION_DB_NAME}-${EXPORT_TIMESTAMP_UTC}-time-travel.json"
METADATA_FILE="$EXPORT_DIR/${PRODUCTION_DB_NAME}-${EXPORT_TIMESTAMP_UTC}-metadata.json"

if [[ -e "$EXPORT_FILE" ]]; then
  printf 'Refusing to overwrite existing export: %s\n' "$EXPORT_FILE" >&2
  exit 1
fi

if [[ -e "$PARTIAL_EXPORT_FILE" || -e "$TIME_TRAVEL_FILE" || -e "$METADATA_FILE" ]]; then
  printf 'Refusing to overwrite an existing partial export or metadata artifact\n' >&2
  exit 1
fi

verify_identity() {
  local json_text="$1"
  local expected_name="$2"
  local expected_id="$3"

  WRANGLER_JSON="$json_text" EXPECTED_DB_NAME="$expected_name" EXPECTED_DB_ID="$expected_id" node <<'NODE'
const text = process.env.WRANGLER_JSON ?? '';
const start = text.indexOf('{');
if (start < 0) throw new Error('Wrangler D1 info output did not contain JSON');
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
if (end < 0) throw new Error('Wrangler D1 info JSON was incomplete');
const parsed = JSON.parse(text.slice(start, end));
if (parsed.name !== process.env.EXPECTED_DB_NAME || parsed.uuid !== process.env.EXPECTED_DB_ID) {
  throw new Error('Production D1 name/UUID did not match the explicit source identity');
}
NODE
}

printf 'Verifying production D1 identity without SQL execution...\n'
PRODUCTION_INFO="$(pnpm exec wrangler d1 info "$PRODUCTION_DB_NAME" --json)"
verify_identity "$PRODUCTION_INFO" "$PRODUCTION_DB_NAME" "$PRODUCTION_DB_ID"

printf 'Recording D1 Time Travel information at %s...\n' "$TIME_TRAVEL_TIMESTAMP_UTC"
pnpm exec wrangler d1 time-travel info "$PRODUCTION_DB_NAME" \
  --timestamp "$TIME_TRAVEL_TIMESTAMP_UTC" \
  --json > "$TIME_TRAVEL_FILE"
chmod 600 "$TIME_TRAVEL_FILE"
TIME_TRAVEL_SHA256="$(shasum -a 256 "$TIME_TRAVEL_FILE" | awk '{print $1}')"

printf 'Exporting production D1 to a protected local artifact...\n'
pnpm exec wrangler d1 export "$PRODUCTION_DB_NAME" \
  --remote \
  --output "$PARTIAL_EXPORT_FILE" \
  --skip-confirmation

chmod 600 "$PARTIAL_EXPORT_FILE"
mv "$PARTIAL_EXPORT_FILE" "$EXPORT_FILE"
chmod 600 "$EXPORT_FILE"

EXPORT_SHA256="$(shasum -a 256 "$EXPORT_FILE" | awk '{print $1}')"
EXPORT_SIZE_BYTES="$(wc -c < "$EXPORT_FILE" | tr -d '[:space:]')"

EXPORT_FILE="$EXPORT_FILE" \
EXPORT_SHA256="$EXPORT_SHA256" \
EXPORT_SIZE_BYTES="$EXPORT_SIZE_BYTES" \
PRODUCTION_DB_NAME="$PRODUCTION_DB_NAME" \
PRODUCTION_DB_ID="$PRODUCTION_DB_ID" \
TIME_TRAVEL_TIMESTAMP_UTC="$TIME_TRAVEL_TIMESTAMP_UTC" \
TIME_TRAVEL_FILE="$TIME_TRAVEL_FILE" \
TIME_TRAVEL_SHA256="$TIME_TRAVEL_SHA256" \
node > "$METADATA_FILE" <<'NODE'
const metadata = {
  productionDatabaseName: process.env.PRODUCTION_DB_NAME,
  productionDatabaseId: process.env.PRODUCTION_DB_ID,
  exportFile: process.env.EXPORT_FILE,
  exportSha256: process.env.EXPORT_SHA256,
  exportSizeBytes: Number(process.env.EXPORT_SIZE_BYTES),
  timeTravelTimestampUtc: process.env.TIME_TRAVEL_TIMESTAMP_UTC,
  timeTravelEvidenceFile: process.env.TIME_TRAVEL_FILE,
  timeTravelEvidenceSha256: process.env.TIME_TRAVEL_SHA256,
  createdAtUtc: new Date().toISOString(),
};
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
NODE
chmod 600 "$METADATA_FILE"

printf 'EXPORT_FILE=%s\n' "$EXPORT_FILE"
printf 'EXPORT_SHA256=%s\n' "$EXPORT_SHA256"
printf 'EXPORT_SIZE_BYTES=%s\n' "$EXPORT_SIZE_BYTES"
printf 'TIME_TRAVEL_TIMESTAMP_UTC=%s\n' "$TIME_TRAVEL_TIMESTAMP_UTC"
printf 'TIME_TRAVEL_FILE=%s\n' "$TIME_TRAVEL_FILE"
printf 'METADATA_FILE=%s\n' "$METADATA_FILE"

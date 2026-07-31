#!/usr/bin/env bash
set -euo pipefail

STATUS_URL="${HMS_LOCAL_STATUS_URL:-http://127.0.0.1:8787/api/local-server/status}"
FLUSH_URL="${HMS_LOCAL_SYNC_FLUSH_URL:-http://hms-app:8787/api/sync/outbox/flush}"
PULL_URL="${HMS_LOCAL_SYNC_PULL_URL:-http://hms-app:8787/api/sync/cloud-pull/run}"
INTERVAL="${HMS_LOCAL_SYNC_INTERVAL_SECONDS:-300}"
CONNECT_TIMEOUT="${HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS:-10}"
REQUEST_TIMEOUT="${HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS:-60}"
STARTUP_JITTER="${HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS:-30}"
VARS_FILE="${HMS_LOCAL_VARS_FILE:-.dev.vars.local_server}"

SCHEMA_ENABLED="${HMS_LOCAL_SCHEMA_SYNC_ENABLED:-0}"
SCHEMA_INTERVAL="${HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS:-900}"
SCHEMA_LAST_RUN_FILE="${HMS_LOCAL_STATE_DIR:-.local-hms/state}/schema-sync.last-run"
SYNC_BASE_URL_INTERNAL="http://hms-app:8787"
CHECKSUM_URL=""

require_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value <= 0 )); then
    echo "$name must be a positive integer; received '$value'." >&2
    exit 1
  fi
}

require_non_negative_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "$name must be a non-negative integer; received '$value'." >&2
    exit 1
  fi
}

require_positive_integer HMS_LOCAL_SYNC_INTERVAL_SECONDS "$INTERVAL"
require_positive_integer HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS "$CONNECT_TIMEOUT"
require_positive_integer HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS "$REQUEST_TIMEOUT"
require_non_negative_integer HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS "$STARTUP_JITTER"
require_positive_integer HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS "$SCHEMA_INTERVAL"

curl_sync() {
  curl --connect-timeout "$CONNECT_TIMEOUT" --max-time "$REQUEST_TIMEOUT" "$@"
}

echo "Starting HMS local sync worker."
echo "Status URL: $STATUS_URL"
echo "Flush URL: $FLUSH_URL"
echo "Pull URL: $PULL_URL"
echo "Interval: ${INTERVAL}s"
echo "Connect timeout: ${CONNECT_TIMEOUT}s"
echo "Request timeout: ${REQUEST_TIMEOUT}s"
echo "Startup jitter ceiling: ${STARTUP_JITTER}s"
echo "Schema sync enabled: $SCHEMA_ENABLED"
echo "Schema sync interval: ${SCHEMA_INTERVAL}s"
echo "Local secret vars file: $VARS_FILE"

mkdir -p "$(dirname "$SCHEMA_LAST_RUN_FILE")"

if (( STARTUP_JITTER > 0 )); then
  STARTUP_DELAY=$(( RANDOM % (STARTUP_JITTER + 1) ))
  if (( STARTUP_DELAY > 0 )); then
    echo "Applying startup jitter: ${STARTUP_DELAY}s"
    sleep "$STARTUP_DELAY"
  fi
fi

load_sync_vars() {
  if [[ -f "$VARS_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$VARS_FILE"
    set +a
  fi
}

flush_cloud_sync() {
  if [[ -z "${CLOUD_SYNC_BASE_URL:-}" || -z "${CLOUD_SYNC_TOKEN:-}" ]]; then
    echo "cloud sync not configured; local server remains offline-operational."
    return 0
  fi

  local http_code
  local response_file
  response_file="$(mktemp)"
  http_code="$(
    curl_sync -sS -o "$response_file" -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "$FLUSH_URL" 2>/dev/null || true
  )"

  if [[ "$http_code" == "200" ]]; then
    echo "cloud sync flush ok: $(cat "$response_file")"
    rm -f "$response_file"
    return 0
  fi

  echo "cloud sync flush unavailable or failed (http ${http_code:-000})."
  rm -f "$response_file"
  return 1
}

pull_cloud_sync() {
  if [[ -z "${CLOUD_SYNC_BASE_URL:-}" || -z "${CLOUD_SYNC_TOKEN:-}" || -z "${LOCAL_TENANT_ID:-}" ]]; then
    echo "cloud pull skipped: cloud sync or local tenant is not configured."
    return 0
  fi

  local http_code
  local response_file
  response_file="$(mktemp)"
  http_code="$(
    curl_sync -sS -o "$response_file" -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "$PULL_URL" 2>/dev/null || true
  )"

  if [[ "$http_code" == "200" ]]; then
    echo "cloud pull ok: $(cat "$response_file")"
  else
    echo "cloud pull unavailable or failed (http ${http_code:-000})."
  fi
  rm -f "$response_file"
}

schema_sync_cycle() {
  if [[ "$SCHEMA_ENABLED" != "1" ]]; then
    return 0
  fi
  if [[ -z "${CLOUD_SYNC_BASE_URL:-}" || -z "${CLOUD_SYNC_TOKEN:-}" ]]; then
    echo "schema sync skipped: cloud not configured."
    return 0
  fi

  local now
  now="$(date +%s)"
  local last_run=0
  if [[ -f "$SCHEMA_LAST_RUN_FILE" ]]; then
    last_run="$(cat "$SCHEMA_LAST_RUN_FILE" 2>/dev/null || echo 0)"
  fi
  if (( now - last_run < SCHEMA_INTERVAL )); then
    return 0
  fi

  echo "schema sync: fetching manifest checksum from cloud."
  local checksum_file
  checksum_file="$(mktemp)"
  local checksum_http
  CHECKSUM_URL="${CLOUD_SYNC_BASE_URL%/}/api/sync/schema/manifest/checksum"
  checksum_http="$(
    curl_sync -sS -o "$checksum_file" -w '%{http_code}' \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "$CHECKSUM_URL" 2>/dev/null || true
  )"

  if [[ "$checksum_http" != "200" ]]; then
    echo "schema sync: cloud unreachable (http ${checksum_http:-000})."
    rm -f "$checksum_file"
    return 0
  fi

  echo "schema sync: fetched checksum ($(cat "$checksum_file"))."
  local manifest_file
  manifest_file="$(mktemp)"
  local manifest_http
  manifest_http="$(
    curl_sync -sS -o "$manifest_file" -w '%{http_code}' \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "${CLOUD_SYNC_BASE_URL%/}/api/sync/schema/manifest" 2>/dev/null || true
  )"

  if [[ "$manifest_http" != "200" ]]; then
    echo "schema sync: manifest fetch failed (http ${manifest_http:-000})."
    rm -f "$checksum_file" "$manifest_file"
    return 0
  fi

  echo "schema sync: posting manifest to local engine."
  local sync_http
  local sync_response
  sync_response="$(mktemp)"
  sync_http="$(
    curl_sync -sS -o "$sync_response" -w '%{http_code}' \
      -X POST \
      -H "Content-Type: application/json" \
      -H "X-Internal-Schema-Sync: 1" \
      --data-binary "@$manifest_file" \
      "${SYNC_BASE_URL_INTERNAL}/api/local-server/schema-sync/sync" 2>/dev/null || true
  )"

  if [[ "$sync_http" == "200" || "$sync_http" == "202" ]]; then
    echo "schema sync: applied (response: $(cat "$sync_response"))."
  else
    echo "schema sync: local apply failed (http ${sync_http:-000})."
  fi

  local apply_http
  local apply_response
  apply_response="$(mktemp)"
  apply_http="$(
    curl_sync -sS -o "$apply_response" -w '%{http_code}' \
      -X POST \
      -H "X-Internal-Schema-Sync: 1" \
      "${SYNC_BASE_URL_INTERNAL}/api/local-server/schema-sync/sync/apply-approved" 2>/dev/null || true
  )"
  if [[ "$apply_http" == "200" ]]; then
    echo "schema sync: apply-approved (response: $(cat "$apply_response"))."
  fi

  date +%s > "$SCHEMA_LAST_RUN_FILE"
  rm -f "$checksum_file" "$manifest_file" "$sync_response" "$apply_response"
}

while true; do
  NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if STATUS_JSON="$(curl_sync -fsS "$STATUS_URL" 2>/dev/null)"; then
    if printf '%s' "$STATUS_JSON" | grep -q '"cloudSyncConfigured":true'; then
      load_sync_vars
      printf '%s ' "$NOW"
      if flush_cloud_sync; then
        printf '%s ' "$NOW"
        pull_cloud_sync
      else
        echo "$NOW cloud pull skipped because local outbox flush did not complete; preserving unsynced local data."
      fi
      schema_sync_cycle
    else
      echo "$NOW cloud sync not configured; local server remains offline-operational."
    fi
  else
    echo "$NOW local status endpoint unavailable" >&2
  fi

  sleep "$INTERVAL"
done

#!/usr/bin/env bash
set -euo pipefail

# Keep a Wrangler live-tail session open and save the output locally.
# Usage:
#   bash scripts/cloudflare-tail.sh production
#   TAIL_STATUS= bash scripts/cloudflare-tail.sh production   # all invocations
#   TAIL_SEARCH='[SERVER_ERROR]' bash scripts/cloudflare-tail.sh production
#
# Required for non-interactive machines:
#   export CLOUDFLARE_API_TOKEN='...'

ENV_NAME="${1:-production}"
TAIL_STATUS_VALUE="${TAIL_STATUS:-error}"
TAIL_FORMAT_VALUE="${TAIL_FORMAT:-json}"
TAIL_LOG_DIR_VALUE="${TAIL_LOG_DIR:-.tmp/cloudflare-tail}"
TAIL_TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
export FORCE_COLOR="${FORCE_COLOR:-0}"

case "$ENV_NAME" in
  production|prod)
    ENV_NAME="production"
    # When --env is passed, Wrangler resolves [env.production].name itself.
    # Passing hms-saas-production here makes Wrangler look for
    # hms-saas-production-production, which does not exist.
    WORKER_NAME="${TAIL_WORKER:-hms-saas}"
    ;;
  staging|stage)
    ENV_NAME="staging"
    # See production note above: keep the base worker name when --env is used.
    WORKER_NAME="${TAIL_WORKER:-hms-saas}"
    ;;
  development|dev|local)
    # Uses the default worker name from wrangler.toml.
    ENV_NAME=""
    WORKER_NAME="${TAIL_WORKER:-hms-saas}"
    ;;
  *)
    WORKER_NAME="${TAIL_WORKER:-hms-saas}"
    ;;
esac

mkdir -p "$TAIL_LOG_DIR_VALUE"
SAFE_STATUS="${TAIL_STATUS_VALUE:-all}"
LOG_FILE="${TAIL_LOG_FILE:-${TAIL_LOG_DIR_VALUE}/${WORKER_NAME}-${SAFE_STATUS}-${TAIL_TIMESTAMP}.ndjson}"

CMD=(pnpm wrangler tail "$WORKER_NAME" --format "$TAIL_FORMAT_VALUE")
if [[ -n "$ENV_NAME" ]]; then
  CMD+=(--env "$ENV_NAME")
fi
if [[ -n "$TAIL_STATUS_VALUE" ]]; then
  CMD+=(--status "$TAIL_STATUS_VALUE")
fi
if [[ -n "${TAIL_SEARCH:-}" ]]; then
  CMD+=(--search "$TAIL_SEARCH")
fi

echo "Starting Cloudflare Worker tail"
echo "  worker: $WORKER_NAME"
echo "  env: ${ENV_NAME:-default}"
echo "  status: ${TAIL_STATUS_VALUE:-all}"
echo "  format: $TAIL_FORMAT_VALUE"
echo "  log_file: $LOG_FILE"
echo "Press Ctrl+C to stop."

"${CMD[@]}" | tee -a "$LOG_FILE"

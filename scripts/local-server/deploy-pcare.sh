#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

SSH_TARGET="${PCARE_SSH_TARGET:-pcare}"
REMOTE_DIR="${PCARE_REMOTE_DIR:-/opt/hms}"
ENV_FILE="${PCARE_ENV_FILE:-/data/hms/config/local-server.env}"
COMPOSE_FILE="deploy/local-server/compose.yml"

remote() {
  ssh -o BatchMode=yes "$SSH_TARGET" "$@"
}

echo "Deploying committed revision to ${SSH_TARGET}:${REMOTE_DIR}"
git --no-pager log -1 --oneline

echo "Copying repository archive..."
git archive --format=tar.gz HEAD | remote "cd '$REMOTE_DIR' && tar -xzpf -"

echo "Rebuilding local-server stack..."
remote "cd '$REMOTE_DIR' && docker compose --env-file '$ENV_FILE' -f '$COMPOSE_FILE' up -d --build --remove-orphans"

echo "Applying local D1 migrations inside hms-app..."
remote "cd '$REMOTE_DIR' && docker compose --env-file '$ENV_FILE' -f '$COMPOSE_FILE' exec -T -e HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 hms-app bash scripts/local-server/migrate.sh"

echo "Verifying local-server health..."
remote "cd '$REMOTE_DIR' && curl -fsS http://127.0.0.1/api/local-server/status && printf '\\n--- compose ps ---\\n' && docker compose --env-file '$ENV_FILE' -f '$COMPOSE_FILE' ps"

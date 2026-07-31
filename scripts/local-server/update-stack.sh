#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${HMS_LOCAL_UPDATE_BRANCH:-main}"
DATA_ROOT="${HMS_LOCAL_DATA_DIR:-/data/hms}"
ENV_FILE="${HMS_LOCAL_ENV_FILE:-$DATA_ROOT/config/local-server.env}"
PREV_FULL_REV="$(git rev-parse HEAD)"
PREV_REV="$(git rev-parse --short=12 HEAD)"

echo "Current revision: $PREV_REV"
echo "Checking HMS local stack updates from origin/$BRANCH"

if ! git diff-index --quiet HEAD --; then
  echo "Local tracked files have uncommitted changes; refusing automatic update." >&2
  exit 1
fi

git fetch origin "$BRANCH"

REMOTE_FULL_REV="$(git rev-parse FETCH_HEAD)"
REMOTE_REV="$(git rev-parse --short=12 FETCH_HEAD)"

if [[ "$PREV_FULL_REV" == "$REMOTE_FULL_REV" ]]; then
  echo "Already current: $PREV_REV"
  if curl -fsS http://127.0.0.1/api/local-server/status >/dev/null; then
    docker compose --env-file "$ENV_FILE" -f deploy/local-server/compose.yml ps
  fi
  exit 0
fi

echo "Updating HMS local stack from $PREV_REV to $REMOTE_REV"

scripts/local-server/backup.sh

git checkout "$BRANCH"
git merge --ff-only FETCH_HEAD

NEW_REV="$(git rev-parse --short=12 HEAD)"
echo "New revision: $NEW_REV"

docker compose \
  --env-file "$ENV_FILE" \
  -f deploy/local-server/compose.yml \
  up -d --build --remove-orphans

echo "Waiting for updated local HMS health endpoint."
for _ in {1..45}; do
  if curl -fsS http://127.0.0.1/api/local-server/status >/dev/null; then
    echo "Update healthy: $NEW_REV"
    docker compose --env-file "$ENV_FILE" -f deploy/local-server/compose.yml ps
    exit 0
  fi
  sleep 2
done

echo "Update failed health check. Rolling back to $PREV_REV." >&2
git checkout "$PREV_REV"
docker compose \
  --env-file "$ENV_FILE" \
  -f deploy/local-server/compose.yml \
  up -d --build --remove-orphans
exit 1

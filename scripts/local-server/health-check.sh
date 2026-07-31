#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${HMS_LOCAL_HEALTH_URL:-http://127.0.0.1/api/local-server/status}"

echo "Checking HMS local server: $BASE_URL"
curl -fsS "$BASE_URL"
echo

echo "Checking Docker services."
docker compose -f deploy/local-server/compose.yml ps

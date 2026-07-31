#!/bin/bash
# ─── Super Admin Production E2E Test Runner ───────────────────────────────
# Fetches a real JWT token first (one login call), then passes it to
# Playwright so no test hits the rate limit.
#
# Usage:
#   SUPER_ADMIN_EMAIL=xxx SUPER_ADMIN_PASSWORD=yyy ./scripts/run-super-admin-tests.sh

set -e

BASE_URL="${BASE_URL:-https://hms-saas-production.rahmatullahzisan.workers.dev}"
EMAIL="${SUPER_ADMIN_EMAIL:-}"
PASSWORD="${SUPER_ADMIN_PASSWORD:-}"

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "❌ Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD"
  exit 1
fi

echo "🔐 Fetching super admin token..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "❌ Login failed (HTTP $HTTP_STATUS): $BODY"
  echo "   If 429: rate limit active — wait 15 minutes or switch IP/VPN"
  exit 1
fi

TOKEN=$(echo "$BODY" | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])" 2>/dev/null)

if [[ -z "$TOKEN" ]]; then
  echo "❌ Could not extract token from response: $BODY"
  exit 1
fi

echo "✅ Token obtained (${#TOKEN} chars)"

echo "🧪 Running production browser E2E tests..."
SUPER_ADMIN_TOKEN="$TOKEN" \
  npx playwright test --project=super-admin-browser --workers=1 --reporter=line

echo "✅ Done!"

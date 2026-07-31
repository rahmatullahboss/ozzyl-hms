#!/bin/bash
# =============================================================================
# HMS Real-DB Integration Test Setup
# Applies schema.sql + all D1 migrations + demo seed to LOCAL D1 database
# Run this ONCE before running `npm run test:real`
# =============================================================================

MIGRATIONS_DIR="./migrations"
WRANGLER="npx wrangler"

echo "🏥 HMS Integration Test Setup"
echo "================================"

echo ""
echo "📐 Step 1: Applying base schema (tenants, users)..."
$WRANGLER d1 execute DB --local --file="schema.sql" 2>&1 | grep -E "(ERROR|✅|✘)" || true

echo ""
echo "🏗️  Step 2: Applying bootstrap schema (patients, bills, doctors, medicines)..."
$WRANGLER d1 execute DB --local --file="test/integration/real-db/bootstrap.sql" 2>&1 | grep -E "(ERROR|✘)" || true

echo ""
echo "📁 Step 3: Applying incremental migrations..."
for file in "$MIGRATIONS_DIR"/0*.sql; do
  filename=$(basename "$file")
  echo "  → $filename"
  $WRANGLER d1 execute DB --local --file="$file" 2>&1 | grep -E "(ERROR|already exists)" || true
done

echo ""
echo "🌱 Step 3: Applying demo seed data..."
$WRANGLER d1 execute DB --local --file="$MIGRATIONS_DIR/seed_demo.sql"
echo "  → Seed applied!"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start wrangler dev:  npm run dev:api"
echo "  2. Run tests:           npm run test:real"
echo ""

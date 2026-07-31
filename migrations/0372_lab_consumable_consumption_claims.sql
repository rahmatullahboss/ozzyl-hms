-- Migration: 0372_lab_consumable_consumption_claims.sql
-- Purpose: Add idempotency guard for automatic lab consumable usage.

CREATE TABLE IF NOT EXISTS lab_consumable_consumption_claims (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL,
  reference_type TEXT    NOT NULL,
  reference_id   INTEGER NOT NULL,
  lab_order_id   INTEGER,
  lab_test_id    INTEGER,
  created_by     INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','committed','failed')),
  attempt_no     INTEGER NOT NULL DEFAULT 1,
  error_message  TEXT,
  updated_at     DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumable_claim_once
  ON lab_consumable_consumption_claims(tenant_id, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_claim_order
  ON lab_consumable_consumption_claims(tenant_id, lab_order_id);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_claim_status
  ON lab_consumable_consumption_claims(tenant_id, status, updated_at);

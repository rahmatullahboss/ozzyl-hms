-- Migration: 0204_payment_idempotency.sql
-- Description: Adds payment retry idempotency controls for POS/mobile gateway submissions.

ALTER TABLE payments ADD COLUMN idempotency_key TEXT;
ALTER TABLE payments ADD COLUMN external_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key
  ON payments(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_external_transaction_id
  ON payments(tenant_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

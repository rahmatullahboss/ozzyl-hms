-- Migration: 0410_ipd_medication_order_idempotency.sql
-- Purpose: make Doctor CPOE order creation retry-safe and allow the order +
-- initial MAR schedule row to be committed atomically in one D1 batch.

ALTER TABLE cln_medication_orders ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cln_med_orders_tenant_idempotency
  ON cln_medication_orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

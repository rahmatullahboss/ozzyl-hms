-- Migration: 0208_billing_invoice_idempotency.sql
-- Description: Adds retry-safe idempotency for Billing Counter invoice creation.

CREATE TABLE IF NOT EXISTS billing_invoice_idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  bill_id INTEGER,
  invoice_no TEXT,
  response_json TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_invoice_idem_tenant_status
  ON billing_invoice_idempotency_keys(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_billing_invoice_idem_bill
  ON billing_invoice_idempotency_keys(tenant_id, bill_id);

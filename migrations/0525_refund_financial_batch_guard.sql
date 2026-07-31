CREATE TABLE IF NOT EXISTS billing_refund_batch_guard (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  step_key TEXT NOT NULL,
  assertion_value INTEGER NOT NULL CHECK (assertion_value = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

CREATE INDEX IF NOT EXISTS idx_refund_batch_guard_created
  ON billing_refund_batch_guard(tenant_id, created_at);

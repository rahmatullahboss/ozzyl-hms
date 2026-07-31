CREATE TABLE IF NOT EXISTS canonical_financial_batch_assertions (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL CHECK (length(trim(operation_key)) > 0),
  step_key TEXT NOT NULL CHECK (length(trim(step_key)) > 0),
  assertion_value INTEGER NOT NULL CHECK (assertion_value = 1),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_financial_batch_assertions_created
  ON canonical_financial_batch_assertions(tenant_id, created_at_utc);

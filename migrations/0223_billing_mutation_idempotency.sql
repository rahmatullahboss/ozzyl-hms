-- Migration: 0223_billing_mutation_idempotency.sql
-- Description: Adds retry-safe idempotency controls for non-invoice billing money mutations.

CREATE TABLE IF NOT EXISTS billing_mutation_idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  mutation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  source_id TEXT,
  response_json TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, mutation_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_mutation_idem_tenant_status
  ON billing_mutation_idempotency_keys(tenant_id, mutation_type, status, created_at);

CREATE INDEX IF NOT EXISTS idx_billing_mutation_idem_source
  ON billing_mutation_idempotency_keys(tenant_id, mutation_type, source_id);

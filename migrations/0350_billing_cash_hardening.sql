-- Migration 0350: fix/billing-cash P0-20 + Phase 6 other-issues hardening.
-- Adds:
--   * bills_idempotency_keys (POST /api/billing idempotency)
--   * cash_variance_approvals (cash variance supervisor approval)
--   * approver_user_id on billing_counter_sessions for variance approver
-- This is a non-destructive, additive migration.

CREATE TABLE IF NOT EXISTS bills_idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','completed','failed')),
  request_hash TEXT,
  response_json TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_idempotency_keys_tenant_key
  ON bills_idempotency_keys(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bills_idempotency_keys_tenant_status
  ON bills_idempotency_keys(tenant_id, status);

ALTER TABLE billing_counter_sessions ADD COLUMN approver_user_id INTEGER;
ALTER TABLE billing_counter_sessions ADD COLUMN variance_approval_required INTEGER DEFAULT 0;
ALTER TABLE billing_counter_sessions ADD COLUMN variance_approval_status TEXT
  CHECK(variance_approval_status IN ('pending','approved','rejected') OR variance_approval_status IS NULL);
ALTER TABLE billing_counter_sessions ADD COLUMN variance_approval_at TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN variance_approval_reason TEXT;

CREATE TABLE IF NOT EXISTS cash_variance_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  variance REAL NOT NULL,
  threshold REAL NOT NULL,
  requested_by INTEGER NOT NULL,
  approver_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  reason TEXT,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_cash_variance_approvals_tenant
  ON cash_variance_approvals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_variance_approvals_session
  ON cash_variance_approvals(tenant_id, counter_session_id);

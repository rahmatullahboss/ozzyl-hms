-- Executed-pending payment void accountability state.
-- The financial reversal is authoritative in payments/canonical payment tables;
-- this table records the operational dispute created when admin rejects it.

CREATE TABLE IF NOT EXISTS billing_payment_void_disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  payment_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  reversal_payment_id INTEGER,
  reversal_receipt_no TEXT NOT NULL,
  requester_user_id INTEGER NOT NULL,
  accountable_employee_id INTEGER NOT NULL,
  counter_id INTEGER,
  counter_session_id INTEGER,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','written_off')),
  rejection_reason TEXT NOT NULL,
  rejected_by INTEGER NOT NULL,
  rejected_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_request_id),
  UNIQUE (tenant_id, payment_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_void_disputes_tenant_status
  ON billing_payment_void_disputes(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_void_disputes_employee_status
  ON billing_payment_void_disputes(tenant_id, accountable_employee_id, status, created_at);

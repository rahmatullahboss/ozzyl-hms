-- Migration 0213: Danphe-style billing counter sessions and cash drawer closeout.
-- Additive only: existing bills/payments continue to work, while Billing Counter
-- can require an activated cashier counter before invoice/payment creation.

ALTER TABLE billing_counters ADD COLUMN counter_type TEXT DEFAULT 'billing'
  CHECK(counter_type IN ('billing','pharmacy','lab','ipd','opd','emergency','general','other'));
ALTER TABLE billing_counters ADD COLUMN location TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counters_code
  ON billing_counters(tenant_id, counter_code)
  WHERE counter_code IS NOT NULL AND is_active = 1;

INSERT INTO billing_counters (tenant_id, counter_name, counter_code, counter_type, description, is_active)
SELECT CAST(t.id AS TEXT), 'Main Billing Counter', 'BILL-1', 'billing', 'Default OPD/IPD billing counter', 1
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM billing_counters bc
  WHERE CAST(bc.tenant_id AS TEXT) = CAST(t.id AS TEXT)
    AND COALESCE(bc.is_active, 1) = 1
);

CREATE TABLE IF NOT EXISTS billing_counter_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  employee_id INTEGER NOT NULL,
  session_no TEXT NOT NULL,
  counter_type TEXT NOT NULL DEFAULT 'billing'
    CHECK(counter_type IN ('billing','pharmacy','lab','ipd','opd','emergency','general','other')),
  opening_cash REAL NOT NULL DEFAULT 0 CHECK(opening_cash >= 0),
  closing_cash_declared REAL,
  expected_cash REAL,
  variance REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','void')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  closed_at TEXT,
  remarks TEXT,
  closed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_sessions_session_no
  ON billing_counter_sessions(tenant_id, session_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_sessions_one_active_employee
  ON billing_counter_sessions(tenant_id, employee_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_counter_sessions_counter
  ON billing_counter_sessions(tenant_id, counter_id, status);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  employee_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','cash_in','cash_out','handover','closing_adjustment')),
  amount REAL NOT NULL CHECK(amount >= 0),
  payment_method TEXT DEFAULT 'cash',
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_session
  ON cash_drawer_movements(tenant_id, counter_session_id, created_at);

ALTER TABLE bills ADD COLUMN counter_session_id INTEGER;
ALTER TABLE payments ADD COLUMN counter_id INTEGER;
ALTER TABLE payments ADD COLUMN counter_session_id INTEGER;
ALTER TABLE emp_cash_transactions ADD COLUMN counter_session_id INTEGER;

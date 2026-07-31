-- Migration 0295: Allow cash drop as a first-class drawer movement.
-- Cash drops are mid-shift transfers from a cashier drawer to a safe/admin cash point.

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS cash_drawer_movements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  employee_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','cash_in','cash_out','handover','closing_adjustment','cash_drop')),
  amount REAL NOT NULL CHECK(amount >= 0),
  payment_method TEXT DEFAULT 'cash',
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

INSERT INTO cash_drawer_movements_new (
  id,
  tenant_id,
  counter_session_id,
  counter_id,
  employee_id,
  movement_type,
  amount,
  payment_method,
  reference_type,
  reference_id,
  description,
  created_by,
  created_at
)
SELECT
  id,
  tenant_id,
  counter_session_id,
  counter_id,
  employee_id,
  movement_type,
  amount,
  payment_method,
  reference_type,
  reference_id,
  description,
  created_by,
  created_at
FROM cash_drawer_movements;

DROP TABLE cash_drawer_movements;
ALTER TABLE cash_drawer_movements_new RENAME TO cash_drawer_movements;

CREATE INDEX IF NOT EXISTS idx_cash_drawer_session
  ON cash_drawer_movements(tenant_id, counter_session_id, created_at);

PRAGMA foreign_keys=ON;

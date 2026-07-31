-- Post-facto approval recovery tracking for reception petty-cash expenses.
-- Drawer-paid expenses may be executed before admin approval. If rejected,
-- cash must either be returned immediately or tracked as a recovery item.

ALTER TABLE expenses ADD COLUMN recovery_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK(recovery_status IN ('not_required', 'required', 'partially_recovered', 'recovered', 'written_off'));
ALTER TABLE expenses ADD COLUMN recovery_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN recovery_cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE expenses ADD COLUMN recovery_requested_at TEXT;
ALTER TABLE expenses ADD COLUMN recovery_closed_at TEXT;
ALTER TABLE expenses ADD COLUMN recovery_note TEXT;

CREATE TABLE IF NOT EXISTS expense_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  expense_id INTEGER NOT NULL REFERENCES expenses(id),
  amount REAL NOT NULL CHECK(amount >= 0),
  recovery_type TEXT NOT NULL CHECK(recovery_type IN ('cash_return', 'employee_receivable', 'manual_adjustment', 'write_off')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'collected', 'partially_collected', 'written_off', 'cancelled')),
  counter_session_id INTEGER REFERENCES billing_counter_sessions(id),
  cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  collected_by INTEGER,
  collected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_expense_recoveries_tenant_expense
  ON expense_recoveries(tenant_id, expense_id, status);

CREATE INDEX IF NOT EXISTS idx_expenses_recovery_status
  ON expenses(tenant_id, recovery_status, approval_status);

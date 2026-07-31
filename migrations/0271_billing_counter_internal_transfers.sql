CREATE TABLE IF NOT EXISTS billing_counter_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  target_counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  transfer_by INTEGER NOT NULL,
  transfer_to INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  received_amount REAL,
  variance REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','disputed','cancelled')),
  remarks TEXT,
  received_remarks TEXT,
  dispute_reason TEXT,
  accepted_by INTEGER,
  accepted_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_counter_transfers_source
  ON billing_counter_transfers(tenant_id, source_counter_session_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_counter_transfers_target
  ON billing_counter_transfers(tenant_id, target_counter_session_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_counter_transfers_recipient
  ON billing_counter_transfers(tenant_id, transfer_to, status, created_at);

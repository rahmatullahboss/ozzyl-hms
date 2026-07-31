-- Add receiver verification + admin final verification evidence for reception cash handovers.
-- Flow: receptionist closes/hands over -> receiver counts -> admin/MD/director/accountant final-verifies.

ALTER TABLE billing_handovers ADD COLUMN receiver_counted_amount REAL;
ALTER TABLE billing_handovers ADD COLUMN receiver_variance REAL NOT NULL DEFAULT 0;
ALTER TABLE billing_handovers ADD COLUMN admin_verification_status TEXT
  CHECK (admin_verification_status IS NULL OR admin_verification_status IN ('pending_admin', 'verified', 'rejected'));
ALTER TABLE billing_handovers ADD COLUMN admin_verified_by INTEGER;
ALTER TABLE billing_handovers ADD COLUMN admin_verified_at TEXT;
ALTER TABLE billing_handovers ADD COLUMN admin_verification_remarks TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_handovers_admin_verification
  ON billing_handovers(tenant_id, admin_verification_status, status, created_at);

CREATE TABLE IF NOT EXISTS cash_handover_verification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  handover_id INTEGER NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('receiver_verified', 'receiver_disputed', 'admin_final_verification', 'admin_rejected')),
  actor_user_id INTEGER NOT NULL,
  actor_role TEXT,
  counted_amount REAL,
  expected_amount REAL,
  variance REAL NOT NULL DEFAULT 0,
  decision TEXT NOT NULL CHECK (decision IN ('verify', 'dispute', 'approve', 'reject')),
  remarks TEXT,
  workstation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  FOREIGN KEY (handover_id) REFERENCES billing_handovers(id)
);

CREATE INDEX IF NOT EXISTS idx_cash_handover_verification_events_handover
  ON cash_handover_verification_events(tenant_id, handover_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_handover_verification_events_actor
  ON cash_handover_verification_events(tenant_id, actor_user_id, created_at);

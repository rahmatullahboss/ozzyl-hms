-- Migration 0193: Operational support tables used by ADT and audit flows.
-- Earlier local/prod databases may have skipped these when mixed CREATE/ALTER
-- migration files rolled back on duplicate-column errors.

CREATE TABLE IF NOT EXISTS bed_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  bed_id INTEGER NOT NULL,
  reserved_from TEXT NOT NULL,
  reserved_to TEXT,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','admitted','cancelled','expired')),
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bed_res_tenant_status ON bed_reservations(tenant_id, status, reserved_from);
CREATE INDEX IF NOT EXISTS idx_bed_res_bed ON bed_reservations(tenant_id, bed_id, status);
CREATE INDEX IF NOT EXISTS idx_bed_res_patient ON bed_reservations(tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN', 'CHECK_IN', 'CANCEL', 'DISCHARGE', 'PAYMENT', 'VIEW'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);

-- Migration 0269: Expand audit_logs action CHECK constraint
-- The current CHECK constraint only allows: CREATE, UPDATE, DELETE, APPROVE, REJECT, LOGIN, CHECK_IN, CANCEL, DISCHARGE, PAYMENT, VIEW
-- But the codebase uses additional actions: ROLE_CHANGE, PASSWORD_CHANGE, LOGIN_FAILED, RESULT, VERIFY, RECOLLECT, UPDATE_STATUS, PRINT, EXPORT, BARCODE_SCAN, PROCESS
-- SQLite cannot ALTER CHECK, so we recreate the table.

CREATE TABLE audit_logs_new (
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
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT',
    'LOGIN', 'LOGIN_FAILED', 'LOGOUT',
    'CHECK_IN', 'CANCEL', 'DISCHARGE', 'PAYMENT', 'VIEW',
    'ROLE_CHANGE', 'PASSWORD_CHANGE',
    'RESULT', 'VERIFY', 'RECOLLECT', 'UPDATE_STATUS',
    'PRINT', 'EXPORT', 'BARCODE_SCAN', 'PROCESS',
    'COLLECT', 'RECEIVE', 'DELIVER', 'ACK_CRITICAL', 'CORRECT', 'VALIDATE'
  ))
);

INSERT INTO audit_logs_new SELECT * FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);

-- Recreate immutability triggers (lost when table was dropped)
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs rows are immutable');
END;

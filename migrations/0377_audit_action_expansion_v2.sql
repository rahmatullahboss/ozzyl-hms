-- Migration 0377: Expand audit_logs.action CHECK constraint (round 2)
-- Migration 0269 added the current CHECK, but the codebase has since grown
-- 16 more action values that are used in src/ but not allowed by the
-- constraint, causing D1 SQLITE_CONSTRAINT_CHECK at runtime:
--
--   ACK_RESULT, APPROVED_CANCEL, APPROVED_CONVERT_TO_CREDIT_NOTE,
--   APPROVED_PAYMENT_REVERSAL, PHARMACY_GRN_CREATE, PHARMACY_INVOICE_CREATE,
--   PHARMACY_INVOICE_REPAIR, PHARMACY_INVOICE_REPAIR_CANCELLED,
--   PHARMACY_INVOICE_RETURN, PROFILE_PHOTO_UPDATE, PROFILE_UPDATE,
--   STOCK_ADJUSTMENT_APPROVED, STOCK_ADJUSTMENT_DIRECT,
--   STOCK_ADJUSTMENT_QUEUED, STOCK_ADJUSTMENT_REJECTED, UPLOAD_RECEIPT
--
-- SQLite cannot ALTER CHECK, so we recreate the table — same pattern as 0269.

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
    -- Original 0269 enum
    'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT',
    'LOGIN', 'LOGIN_FAILED', 'LOGOUT',
    'CHECK_IN', 'CANCEL', 'DISCHARGE', 'PAYMENT', 'VIEW',
    'ROLE_CHANGE', 'PASSWORD_CHANGE',
    'RESULT', 'VERIFY', 'RECOLLECT', 'UPDATE_STATUS',
    'PRINT', 'EXPORT', 'BARCODE_SCAN', 'PROCESS',
    'COLLECT', 'RECEIVE', 'DELIVER', 'ACK_CRITICAL', 'CORRECT', 'VALIDATE',
    -- New values added in 0377
    'ACK_RESULT',
    'APPROVED_CANCEL', 'APPROVED_CONVERT_TO_CREDIT_NOTE', 'APPROVED_PAYMENT_REVERSAL',
    'PHARMACY_GRN_CREATE', 'PHARMACY_INVOICE_CREATE',
    'PHARMACY_INVOICE_REPAIR', 'PHARMACY_INVOICE_REPAIR_CANCELLED', 'PHARMACY_INVOICE_RETURN',
    'PROFILE_UPDATE', 'PROFILE_PHOTO_UPDATE',
    'STOCK_ADJUSTMENT_QUEUED', 'STOCK_ADJUSTMENT_DIRECT',
    'STOCK_ADJUSTMENT_APPROVED', 'STOCK_ADJUSTMENT_REJECTED',
    'UPLOAD_RECEIPT'
  ))
);

INSERT INTO audit_logs_new SELECT * FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

-- Recreate indexes (lost when the table was dropped)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);

-- Recreate immutability triggers (lost when the table was dropped)
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

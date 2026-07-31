-- Migration 0240: Make audit log tables append-only.
-- Audit records are evidence. Corrections must be new records, never edits.

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_audit_logs_no_update
BEFORE UPDATE ON accounting_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Accounting audit logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_audit_logs_no_delete
BEFORE DELETE ON accounting_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Accounting audit logs are immutable');
END;

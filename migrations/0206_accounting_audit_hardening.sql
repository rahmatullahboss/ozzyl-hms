-- Migration: 0206_accounting_audit_hardening.sql
-- Description: Add cryptographic hash-chaining and period locking for audit-grade integrity.

-- Add hash column to vouchers for integrity verification.
ALTER TABLE accounting_vouchers ADD COLUMN verification_hash TEXT;
ALTER TABLE accounting_vouchers ADD COLUMN previous_hash TEXT;

-- Table to track monthly/period closes.
CREATE TABLE IF NOT EXISTS accounting_period_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  fiscal_year_id INTEGER NOT NULL,
  period_name TEXT NOT NULL, -- e.g. '2024-05'
  close_date TEXT NOT NULL,
  closed_at TEXT DEFAULT (datetime('now', '+6 hours')),
  closed_by TEXT NOT NULL,
  closing_voucher_id INTEGER, -- Optional closing entry voucher
  status TEXT NOT NULL DEFAULT 'closed' CHECK(status IN ('open', 'closed', 'audited')),
  UNIQUE(tenant_id, fiscal_year_id, period_name),
  FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id)
);

-- Table for detailed audit trail of financial configuration changes.
CREATE TABLE IF NOT EXISTS accounting_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'mapping', 'voucher', 'account', 'period'
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'void', 'close'
  old_value TEXT,
  new_value TEXT,
  performed_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_audit_logs_entity
  ON accounting_audit_logs(tenant_id, entity_type, entity_id);

-- Immutable posted ledger controls: verified vouchers and their lines are not
-- edited or deleted. Corrections must be entered through reversal vouchers.
CREATE TRIGGER IF NOT EXISTS trg_accounting_vouchers_no_update_verified
BEFORE UPDATE ON accounting_vouchers
WHEN OLD.status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'Verified accounting vouchers are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_vouchers_no_delete_verified
BEFORE DELETE ON accounting_vouchers
WHEN OLD.status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'Verified accounting vouchers are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_lines_no_update_verified
BEFORE UPDATE ON accounting_journal_lines
WHEN EXISTS (
  SELECT 1
  FROM accounting_vouchers v
  WHERE v.id = OLD.voucher_id
    AND v.tenant_id = OLD.tenant_id
    AND v.status = 'verified'
)
BEGIN
  SELECT RAISE(ABORT, 'Verified accounting journal lines are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_lines_no_delete_verified
BEFORE DELETE ON accounting_journal_lines
WHEN EXISTS (
  SELECT 1
  FROM accounting_vouchers v
  WHERE v.id = OLD.voucher_id
    AND v.tenant_id = OLD.tenant_id
    AND v.status = 'verified'
)
BEGIN
  SELECT RAISE(ABORT, 'Verified accounting journal lines are immutable');
END;

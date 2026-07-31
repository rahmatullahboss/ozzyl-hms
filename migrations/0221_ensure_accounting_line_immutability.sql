-- Ensure verified accounting voucher lines are immutable in every environment.
-- Some production-like databases had the voucher triggers from 0206 but missed
-- the line triggers, leaving posted voucher totals editable through line rows.

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

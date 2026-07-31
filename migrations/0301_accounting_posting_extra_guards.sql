-- Extra accounting posting state guards

CREATE TRIGGER IF NOT EXISTS trg_accounting_event_failed_attempts_dead_letter
AFTER UPDATE OF status, attempts ON accounting_posting_events
FOR EACH ROW
WHEN NEW.status = 'failed' AND COALESCE(NEW.attempts, 0) >= 5
BEGIN
  UPDATE accounting_posting_events
  SET status = 'dead_letter',
      last_error = COALESCE(NEW.last_error, 'Exceeded accounting posting retry limit'),
      updated_at = datetime('now', '+6 hours')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_event_posted_voucher_change_requires_balance
BEFORE UPDATE OF posted_voucher_id ON accounting_posting_events
FOR EACH ROW
WHEN NEW.status = 'posted'
  AND (
    NEW.posted_voucher_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM accounting_journal_lines jl
      WHERE jl.tenant_id = NEW.tenant_id
        AND jl.voucher_id = NEW.posted_voucher_id
      GROUP BY jl.voucher_id
      HAVING COUNT(*) >= 2
         AND ABS(COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0)) < 0.01
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot set posted accounting event without voucher id or balanced voucher lines');
END;

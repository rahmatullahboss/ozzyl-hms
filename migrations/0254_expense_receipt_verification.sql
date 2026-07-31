ALTER TABLE expenses ADD COLUMN receipt_status TEXT DEFAULT 'not_uploaded';
ALTER TABLE expenses ADD COLUMN receipt_uploaded_by INTEGER;
ALTER TABLE expenses ADD COLUMN receipt_uploaded_at TEXT;
ALTER TABLE expenses ADD COLUMN receipt_verified_by INTEGER;
ALTER TABLE expenses ADD COLUMN receipt_verified_at TEXT;
ALTER TABLE expenses ADD COLUMN receipt_rejected_by INTEGER;
ALTER TABLE expenses ADD COLUMN receipt_rejected_at TEXT;
ALTER TABLE expenses ADD COLUMN receipt_rejection_reason TEXT;

UPDATE expenses
SET receipt_status = CASE WHEN receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END
WHERE receipt_status IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_expenses_receipt_status_insert
BEFORE INSERT ON expenses
FOR EACH ROW
WHEN NEW.receipt_status IS NOT NULL
  AND NEW.receipt_status NOT IN ('not_uploaded', 'uploaded', 'verified', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'Invalid expense receipt status');
END;

CREATE TRIGGER IF NOT EXISTS trg_expenses_receipt_status_update
BEFORE UPDATE OF receipt_status ON expenses
FOR EACH ROW
WHEN NEW.receipt_status IS NOT NULL
  AND NEW.receipt_status NOT IN ('not_uploaded', 'uploaded', 'verified', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'Invalid expense receipt status');
END;

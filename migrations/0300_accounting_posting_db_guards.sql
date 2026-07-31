-- Accounting posting DB guards
-- Goal: prevent silent missing/false-posted accounting from production flows.

-- 1) If a bill row is inserted but the application side-effect fails before
-- creating the bill_created accounting event, the database creates the event.
-- This is idempotent because source_event_key is unique from migration 0299.
CREATE TRIGGER IF NOT EXISTS trg_bills_insert_accounting_event
AFTER INSERT ON bills
FOR EACH ROW
WHEN (COALESCE(NEW.total, 0) > 0 OR COALESCE(NEW.discount, 0) > 0)
BEGIN
  INSERT OR IGNORE INTO accounting_posting_events
    (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
  VALUES (
    NEW.tenant_id,
    'billing:' || NEW.id || ':bill_created',
    'billing',
    CAST(NEW.id AS TEXT),
    'bill_created',
    COALESCE(date(NEW.created_at), date('now', '+6 hours')),
    json_object(
      'billId', NEW.id,
      'invoiceNo', NEW.invoice_no,
      'patientId', NEW.patient_id,
      'visitId', NEW.visit_id,
      'subtotal', COALESCE(NEW.subtotal, 0),
      'discount', COALESCE(NEW.discount, 0),
      'total', COALESCE(NEW.total, 0),
      'testBill', COALESCE(NEW.test_bill, 0),
      'doctorVisitBill', COALESCE(NEW.doctor_visit_bill, 0),
      'admissionBill', COALESCE(NEW.admission_bill, 0),
      'operationBill', COALESCE(NEW.operation_bill, 0),
      'medicineBill', COALESCE(NEW.medicine_bill, 0),
      'counterId', NEW.counter_id,
      'counterSessionId', NEW.counter_session_id,
      'recovered', 0,
      'source', 'db_trigger'
    ),
    COALESCE(CAST(NEW.created_by AS TEXT), 'system')
  );
END;

-- 2) Do not allow an accounting posting event to be marked posted unless the
-- linked voucher has at least two lines and balanced debit/credit totals.
CREATE TRIGGER IF NOT EXISTS trg_accounting_event_posted_requires_balanced_voucher
BEFORE UPDATE OF status ON accounting_posting_events
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
  SELECT RAISE(ABORT, 'Cannot mark accounting event posted without voucher id or balanced voucher lines');
END;

-- 3) Keep retry accounting deterministic; failed events that cross the retry
-- threshold can be moved out of the live retry queue by application recovery.
CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_retry_queue
ON accounting_posting_events (tenant_id, status, attempts, created_at);

-- Accounting recovery operations
-- Usage examples:
--   pnpm accounting:recovery:local
--   pnpm accounting:recovery:remote
--
-- This script is intentionally idempotent. It can be re-run safely.

-- 1) Backfill missing bill_created accounting events for bills that already exist.
INSERT OR IGNORE INTO accounting_posting_events
  (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
SELECT
  b.tenant_id,
  'billing:' || b.id || ':bill_created',
  'billing',
  CAST(b.id AS TEXT),
  'bill_created',
  COALESCE(date(b.created_at), date('now', '+6 hours')),
  json_object(
    'billId', b.id,
    'invoiceNo', b.invoice_no,
    'patientId', b.patient_id,
    'visitId', b.visit_id,
    'subtotal', COALESCE(b.subtotal, 0),
    'discount', COALESCE(b.discount, 0),
    'total', COALESCE(b.total, 0),
    'testBill', COALESCE(b.test_bill, 0),
    'doctorVisitBill', COALESCE(b.doctor_visit_bill, 0),
    'admissionBill', COALESCE(b.admission_bill, 0),
    'operationBill', COALESCE(b.operation_bill, 0),
    'medicineBill', COALESCE(b.medicine_bill, 0),
    'counterId', b.counter_id,
    'counterSessionId', b.counter_session_id,
    'recovered', 1,
    'source', 'ops_script'
  ),
  COALESCE(CAST(b.created_by AS TEXT), 'system_recovery')
FROM bills b
LEFT JOIN accounting_posting_events e
  ON e.tenant_id = b.tenant_id
 AND e.source_event_key = ('billing:' || b.id || ':bill_created')
WHERE e.id IS NULL
  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'void')
  AND (COALESCE(b.total, 0) > 0 OR COALESCE(b.discount, 0) > 0);

-- 2) Move permanently failing posting events out of the live retry queue.
UPDATE accounting_posting_events
SET status = 'dead_letter',
    last_error = COALESCE(last_error, 'Exceeded accounting posting retry limit'),
    updated_at = datetime('now', '+6 hours')
WHERE status = 'failed'
  AND COALESCE(attempts, 0) >= 5;

-- 3) Diagnostic output: partial vouchers that need manual review.
SELECT
  v.tenant_id,
  v.id AS voucher_id,
  v.voucher_number,
  v.source_event_key,
  e.status AS event_status,
  COUNT(jl.id) AS line_count,
  COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
  COALESCE(SUM(jl.credit_amount), 0) AS total_credit
FROM accounting_vouchers v
LEFT JOIN accounting_journal_lines jl
  ON jl.voucher_id = v.id
 AND jl.tenant_id = v.tenant_id
LEFT JOIN accounting_posting_events e
  ON e.tenant_id = v.tenant_id
 AND e.source_event_key = v.source_event_key
WHERE v.source_event_key IS NOT NULL
GROUP BY v.tenant_id, v.id, v.voucher_number, v.source_event_key, e.status
HAVING COUNT(jl.id) < 2
    OR ABS(COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0)) >= 0.01
    OR COALESCE(e.status, 'missing') != 'posted'
ORDER BY v.tenant_id, v.id DESC;

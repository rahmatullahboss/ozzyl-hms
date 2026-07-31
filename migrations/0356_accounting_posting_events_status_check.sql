-- Fix accounting_posting_events schema drift
--
-- Background:
--   Migration 0201 created `accounting_posting_events` with
--     CHECK(status IN ('pending', 'posted', 'failed'))
--   Migration 0300/0301 added triggers that write status='dead_letter' and
--   the application writes status='processing' (markEventProcessing). These
--   writes fail in production with SQLITE_CONSTRAINT_CHECK.
--   The event_type CHECK list also drifted: 0342 added inventory_return,
--   bank_deposit_custody, bank_deposit_confirmed, cash_handover, etc.
--
-- SQLite does not support ALTER COLUMN, so we rebuild the table in place.
-- Four triggers reference the table and must be dropped before rebuild and
-- recreated after, because D1 re-evaluates trigger bodies during the
-- DROP TABLE + ALTER TABLE RENAME transaction.

PRAGMA foreign_keys = OFF;

-- ─── Drop every trigger that references accounting_posting_events ────────────
DROP TRIGGER IF EXISTS trg_bills_insert_accounting_event;
DROP TRIGGER IF EXISTS trg_accounting_event_posted_requires_balanced_voucher;
DROP TRIGGER IF EXISTS trg_accounting_event_failed_attempts_dead_letter;
DROP TRIGGER IF EXISTS trg_accounting_event_posted_voucher_change_requires_balance;

-- ─── Rebuild the table with the latest schema ───────────────────────────────
CREATE TABLE accounting_posting_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'bill_created',
    'bill_cancelled',
    'credit_note_issued',
    'payment_received',
    'patient_deposit_received',
    'patient_deposit_adjusted',
    'patient_deposit_refunded',
    'settlement_discount',
    'commission_accrued',
    'commission_cancelled',
    'commission_settled',
    'agent_commission_accrued',
    'agent_commission_cancelled',
    'agent_commission_settled',
    'supplier_payment',
    'pharmacy_purchase',
    'pharmacy_sale_cogs',
    'inventory_purchase',
    'inventory_return',
    'inventory_consumption',
    'profit_distribution_declared',
    'shareholder_dividend_paid',
    'direct_income_received',
    'direct_expense_paid',
    'cash_handover',
    'bank_deposit_custody',
    'bank_deposit_confirmed',
    'manual_journal'
  )),
  event_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'processing', 'posted', 'failed', 'dead_letter', 'approved')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  posted_voucher_id INTEGER,
  posted_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, source_event_key),
  FOREIGN KEY (posted_voucher_id) REFERENCES accounting_vouchers(id)
);

INSERT INTO accounting_posting_events_new
  (id, tenant_id, source_event_key, source_type, source_id, event_type,
   event_date, payload_json, status, attempts, last_error, posted_voucher_id,
   posted_at, created_by, created_at, updated_at)
SELECT
  id, tenant_id, source_event_key, source_type, source_id, event_type,
  event_date, payload_json, status, attempts, last_error, posted_voucher_id,
  posted_at, created_by, created_at, updated_at
FROM accounting_posting_events;

DROP TABLE accounting_posting_events;
ALTER TABLE accounting_posting_events_new RENAME TO accounting_posting_events;

-- ─── Recreate indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_status
  ON accounting_posting_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_source
  ON accounting_posting_events(tenant_id, source_type, source_id, event_type);
CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_retry_queue
  ON accounting_posting_events (tenant_id, status, attempts, created_at);

-- ─── Recreate the four triggers (verbatim from 0300/0301) ──────────────────

-- 1) Bills-insert safety net: ensures every bill gets a bill_created event.
CREATE TRIGGER trg_bills_insert_accounting_event
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

-- 2) Posted events must reference a balanced voucher.
CREATE TRIGGER trg_accounting_event_posted_requires_balanced_voucher
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

-- 3) Failed events that exceed the retry threshold go to dead_letter.
CREATE TRIGGER trg_accounting_event_failed_attempts_dead_letter
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

-- 4) Changing posted_voucher_id on a posted event still requires balance.
CREATE TRIGGER trg_accounting_event_posted_voucher_change_requires_balance
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

PRAGMA foreign_keys = ON;
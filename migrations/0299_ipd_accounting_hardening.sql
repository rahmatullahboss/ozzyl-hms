-- IPD manual billing + accounting hardening
-- Safe migration: only adds unique indexes and validation triggers.

-- Idempotency: each source event may only create one posting event and one voucher.
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounting_posting_events_tenant_source_event_key
  ON accounting_posting_events(tenant_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_accounting_vouchers_tenant_source_event_key
  ON accounting_vouchers(tenant_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

-- Race safety for voucher numbering. Application code still generates the next number,
-- but this prevents silent duplicate voucher numbers under concurrent posting.
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounting_vouchers_tenant_fiscal_voucher_number
  ON accounting_vouchers(tenant_id, COALESCE(fiscal_year_id, 0), voucher_number);

CREATE UNIQUE INDEX IF NOT EXISTS ux_voucher_numbering_tenant_type_fiscal
  ON voucher_numbering(tenant_id, voucher_type_id, fiscal_year_id);

-- Guard manual IPD/provisional charges. Catalog-backed rows keep reference_id.
-- Manual rows have reference_id NULL and must be complete + categorized for accounting.
DROP TRIGGER IF EXISTS trg_billing_provisional_manual_category_insert;
CREATE TRIGGER trg_billing_provisional_manual_category_insert
BEFORE INSERT ON billing_provisional_items
WHEN NEW.reference_id IS NULL
  AND COALESCE(NEW.is_active, 1) = 1
  AND COALESCE(NEW.bill_status, 'provisional') IN ('provisional', 'finalized', 'billed')
  AND (
    LENGTH(TRIM(COALESCE(NEW.item_name, ''))) < 3
    OR LOWER(TRIM(COALESCE(NEW.item_category, ''))) NOT IN (
      'admission',
      'bed_charge',
      'consultation',
      'doctor_fee',
      'doctor_visit',
      'lab',
      'medicine',
      'operation',
      'pharmacy',
      'procedure',
      'radiology',
      'service',
      'test',
      'other'
    )
    OR COALESCE(NEW.unit_price, 0) <= 0
    OR COALESCE(NEW.quantity, 0) <= 0
    OR NEW.created_by IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'Invalid manual IPD charge: description, category, price, quantity and creator are required');
END;

DROP TRIGGER IF EXISTS trg_billing_provisional_manual_category_update;
CREATE TRIGGER trg_billing_provisional_manual_category_update
BEFORE UPDATE OF item_name, item_category, unit_price, quantity, reference_id, bill_status, is_active, created_by ON billing_provisional_items
WHEN NEW.reference_id IS NULL
  AND COALESCE(NEW.is_active, 1) = 1
  AND COALESCE(NEW.bill_status, 'provisional') IN ('provisional', 'finalized', 'billed')
  AND (
    LENGTH(TRIM(COALESCE(NEW.item_name, ''))) < 3
    OR LOWER(TRIM(COALESCE(NEW.item_category, ''))) NOT IN (
      'admission',
      'bed_charge',
      'consultation',
      'doctor_fee',
      'doctor_visit',
      'lab',
      'medicine',
      'operation',
      'pharmacy',
      'procedure',
      'radiology',
      'service',
      'test',
      'other'
    )
    OR COALESCE(NEW.unit_price, 0) <= 0
    OR COALESCE(NEW.quantity, 0) <= 0
    OR NEW.created_by IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'Invalid manual IPD charge: description, category, price, quantity and creator are required');
END;

-- Guard journal lines: exactly one side must be positive. This mirrors
-- application-level validateJournalLines and protects the database directly.
DROP TRIGGER IF EXISTS trg_accounting_journal_lines_amount_insert;
CREATE TRIGGER trg_accounting_journal_lines_amount_insert
BEFORE INSERT ON accounting_journal_lines
WHEN NOT (
  (COALESCE(NEW.debit_amount, 0) > 0 AND COALESCE(NEW.credit_amount, 0) = 0)
  OR
  (COALESCE(NEW.credit_amount, 0) > 0 AND COALESCE(NEW.debit_amount, 0) = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'Accounting journal line must contain exactly one positive debit or credit amount');
END;

DROP TRIGGER IF EXISTS trg_accounting_journal_lines_amount_update;
CREATE TRIGGER trg_accounting_journal_lines_amount_update
BEFORE UPDATE OF debit_amount, credit_amount ON accounting_journal_lines
WHEN NOT (
  (COALESCE(NEW.debit_amount, 0) > 0 AND COALESCE(NEW.credit_amount, 0) = 0)
  OR
  (COALESCE(NEW.credit_amount, 0) > 0 AND COALESCE(NEW.debit_amount, 0) = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'Accounting journal line must contain exactly one positive debit or credit amount');
END;

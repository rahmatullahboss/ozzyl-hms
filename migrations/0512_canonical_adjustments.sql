-- =============================================================================
-- HMS Canonical Deposits, Credits, Refunds, and Reversals (D1 / SQLite)
-- Triggerless by design for remote Wrangler compatibility. Cross-row authority
-- is enforced by same-batch conditional updates plus named CHECK guard columns.
-- =============================================================================

PRAGMA foreign_keys = ON;

ALTER TABLE canonical_invoices
  ADD COLUMN credited_minor INTEGER NOT NULL DEFAULT 0
  CHECK (credited_minor BETWEEN 0 AND 9007199254740991);
ALTER TABLE canonical_invoices
  ADD COLUMN net_due_minor INTEGER
  CHECK (net_due_minor BETWEEN 0 AND 9007199254740991);
UPDATE canonical_invoices SET net_due_minor = due_minor;
ALTER TABLE canonical_invoices
  ADD COLUMN adjustment_projection_guard INTEGER NOT NULL DEFAULT 1
  CHECK (
    adjustment_projection_guard = 1
    AND net_due_minor IS NOT NULL
    AND net_due_minor = due_minor - credited_minor
  );

ALTER TABLE canonical_payment_receipts
  ADD COLUMN refunded_minor INTEGER NOT NULL DEFAULT 0
  CHECK (refunded_minor BETWEEN 0 AND 9007199254740991);
ALTER TABLE canonical_payment_receipts
  ADD COLUMN net_received_minor INTEGER
  CHECK (net_received_minor BETWEEN 0 AND 9007199254740991);
UPDATE canonical_payment_receipts SET net_received_minor = total_minor;
ALTER TABLE canonical_payment_receipts
  ADD COLUMN refund_projection_guard INTEGER NOT NULL DEFAULT 1
  CHECK (
    refund_projection_guard = 1
    AND net_received_minor IS NOT NULL
    AND net_received_minor = total_minor - refunded_minor
  );

ALTER TABLE canonical_payment_tenders
  ADD COLUMN reversed_minor INTEGER NOT NULL DEFAULT 0
  CHECK (reversed_minor BETWEEN 0 AND 9007199254740991);
ALTER TABLE canonical_payment_tenders
  ADD COLUMN remaining_minor INTEGER
  CHECK (remaining_minor BETWEEN 0 AND 9007199254740991);
UPDATE canonical_payment_tenders SET remaining_minor = amount_minor;
ALTER TABLE canonical_payment_tenders
  ADD COLUMN reversal_projection_guard INTEGER NOT NULL DEFAULT 1
  CHECK (
    reversal_projection_guard = 1
    AND remaining_minor IS NOT NULL
    AND reversed_minor + remaining_minor = amount_minor
  );

ALTER TABLE canonical_payment_allocations
  ADD COLUMN reversed_minor INTEGER NOT NULL DEFAULT 0
  CHECK (reversed_minor BETWEEN 0 AND 9007199254740991);
ALTER TABLE canonical_payment_allocations
  ADD COLUMN remaining_minor INTEGER
  CHECK (remaining_minor BETWEEN 0 AND 9007199254740991);
UPDATE canonical_payment_allocations SET remaining_minor = amount_minor;
ALTER TABLE canonical_payment_allocations
  ADD COLUMN reversal_projection_guard INTEGER NOT NULL DEFAULT 1
  CHECK (
    reversal_projection_guard = 1
    AND remaining_minor IS NOT NULL
    AND reversed_minor + remaining_minor = amount_minor
  );

CREATE TABLE IF NOT EXISTS canonical_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  deposit_public_id TEXT NOT NULL,
  deposit_number TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  applied_minor INTEGER NOT NULL DEFAULT 0,
  refunded_minor INTEGER NOT NULL DEFAULT 0,
  available_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  received_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  posted_at_utc TEXT NOT NULL,
  reversed_at_utc TEXT,
  reconciliation_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(deposit_number)) > 0),
  CHECK (legacy_patient_id > 0),
  CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (applied_minor BETWEEN 0 AND 9007199254740991),
  CHECK (refunded_minor BETWEEN 0 AND 9007199254740991),
  CHECK (available_minor BETWEEN 0 AND 9007199254740991),
  CHECK (amount_minor = applied_minor + refunded_minor + available_minor),
  CHECK (status IN ('posted','reversed')),
  CHECK (substr(received_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (substr(posted_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'posted' AND reversed_at_utc IS NULL)
    OR (status = 'reversed' AND reversed_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_deposits_reconciliation_guard CHECK (reconciliation_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, deposit_public_id),
  UNIQUE (tenant_id, deposit_number),
  UNIQUE (tenant_id, receipt_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_deposits_patient_status
  ON canonical_deposits(tenant_id, legacy_patient_id, status, received_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_deposits_available
  ON canonical_deposits(tenant_id, status, available_minor, received_at_utc);

CREATE TABLE IF NOT EXISTS canonical_deposit_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  application_public_id TEXT NOT NULL,
  deposit_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  invoice_line_public_id TEXT,
  amount_minor INTEGER NOT NULL,
  deposit_available_before_minor INTEGER NOT NULL,
  deposit_available_after_minor INTEGER NOT NULL,
  invoice_paid_before_minor INTEGER NOT NULL,
  invoice_paid_after_minor INTEGER NOT NULL,
  invoice_due_before_minor INTEGER NOT NULL,
  invoice_due_after_minor INTEGER NOT NULL,
  invoice_net_due_before_minor INTEGER NOT NULL,
  invoice_net_due_after_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  applied_at_utc TEXT NOT NULL,
  reversed_at_utc TEXT,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (deposit_available_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (deposit_available_after_minor = deposit_available_before_minor - amount_minor),
  CHECK (invoice_paid_after_minor = invoice_paid_before_minor + amount_minor),
  CHECK (invoice_due_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (invoice_due_after_minor = invoice_due_before_minor - amount_minor),
  CHECK (invoice_net_due_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (invoice_net_due_after_minor = invoice_net_due_before_minor - amount_minor),
  CHECK (status IN ('active','reversed')),
  CHECK (substr(applied_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'active' AND reversed_at_utc IS NULL)
    OR (status = 'reversed' AND reversed_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_deposit_applications_balance_guard CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, deposit_public_id)
    REFERENCES canonical_deposits(tenant_id, deposit_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_deposit_applications_invoice_line
    FOREIGN KEY (tenant_id, invoice_public_id, invoice_line_public_id)
    REFERENCES canonical_invoice_lines(tenant_id, invoice_public_id, line_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, application_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_deposit_applications_deposit
  ON canonical_deposit_applications(tenant_id, deposit_public_id, status, applied_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_deposit_applications_invoice
  ON canonical_deposit_applications(tenant_id, invoice_public_id, status, applied_at_utc);

CREATE TABLE IF NOT EXISTS canonical_credit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  credit_note_public_id TEXT NOT NULL,
  credit_note_number TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  invoice_credited_before_minor INTEGER NOT NULL,
  invoice_credited_after_minor INTEGER NOT NULL,
  invoice_net_due_before_minor INTEGER NOT NULL,
  invoice_net_due_after_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  issued_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  posted_at_utc TEXT NOT NULL,
  reversed_at_utc TEXT,
  reconciliation_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(credit_note_number)) > 0),
  CHECK (legacy_patient_id > 0),
  CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (total_minor BETWEEN 1 AND 9007199254740991),
  CHECK (invoice_credited_after_minor = invoice_credited_before_minor + total_minor),
  CHECK (invoice_net_due_before_minor BETWEEN total_minor AND 9007199254740991),
  CHECK (invoice_net_due_after_minor = invoice_net_due_before_minor - total_minor),
  CHECK (status IN ('posted','reversed')),
  CHECK (substr(issued_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (substr(posted_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'posted' AND reversed_at_utc IS NULL)
    OR (status = 'reversed' AND reversed_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_credit_notes_reconciliation_guard CHECK (reconciliation_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, credit_note_public_id),
  UNIQUE (tenant_id, credit_note_number)
);

CREATE INDEX IF NOT EXISTS idx_canonical_credit_notes_invoice
  ON canonical_credit_notes(tenant_id, invoice_public_id, status, issued_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_notes_patient
  ON canonical_credit_notes(tenant_id, legacy_patient_id, status, issued_at_utc);

CREATE TABLE IF NOT EXISTS canonical_credit_note_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  credit_line_public_id TEXT NOT NULL,
  credit_note_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  invoice_line_public_id TEXT,
  amount_minor INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, credit_note_public_id)
    REFERENCES canonical_credit_notes(tenant_id, credit_note_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_credit_note_lines_invoice_line
    FOREIGN KEY (tenant_id, invoice_public_id, invoice_line_public_id)
    REFERENCES canonical_invoice_lines(tenant_id, invoice_public_id, line_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, credit_line_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_lines_note
  ON canonical_credit_note_lines(tenant_id, credit_note_public_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_lines_invoice_line
  ON canonical_credit_note_lines(tenant_id, invoice_public_id, invoice_line_public_id)
  WHERE invoice_line_public_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  refund_public_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  deposit_public_id TEXT,
  receipt_public_id TEXT,
  tender_public_id TEXT,
  allocation_public_id TEXT,
  payment_reversal_public_id TEXT,
  amount_minor INTEGER NOT NULL,
  tender_type TEXT NOT NULL,
  method_code TEXT NOT NULL,
  status TEXT NOT NULL,
  refunded_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  reversed_at_utc TEXT,
  source_available_before_minor INTEGER,
  source_available_after_minor INTEGER,
  liability_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (source_type IN ('deposit','payment')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (tender_type IN ('cash','card','mobile_wallet','bank_transfer','gateway','other')),
  CHECK (length(trim(method_code)) > 0),
  CHECK (status IN ('posted','reversed')),
  CHECK (substr(refunded_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'posted' AND reversed_at_utc IS NULL)
    OR (status = 'reversed' AND reversed_at_utc IS NOT NULL)
  ),
  CHECK (
    (source_type = 'deposit'
      AND deposit_public_id IS NOT NULL
      AND receipt_public_id IS NULL
      AND tender_public_id IS NULL
      AND allocation_public_id IS NULL
      AND payment_reversal_public_id IS NULL
      AND source_available_before_minor IS NOT NULL
      AND source_available_after_minor IS NOT NULL
      AND source_available_before_minor >= amount_minor
      AND source_available_after_minor = source_available_before_minor - amount_minor)
    OR (source_type = 'payment'
      AND deposit_public_id IS NULL
      AND receipt_public_id IS NOT NULL
      AND tender_public_id IS NOT NULL
      AND allocation_public_id IS NOT NULL
      AND payment_reversal_public_id IS NOT NULL
      AND source_available_before_minor IS NULL
      AND source_available_after_minor IS NULL)
  ),
  CONSTRAINT canonical_refunds_liability_guard CHECK (liability_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, deposit_public_id)
    REFERENCES canonical_deposits(tenant_id, deposit_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, tender_public_id)
    REFERENCES canonical_payment_tenders(tenant_id, tender_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, allocation_public_id)
    REFERENCES canonical_payment_allocations(tenant_id, allocation_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payment_reversal_public_id)
    REFERENCES canonical_payment_reversals(tenant_id, reversal_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, refund_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_refunds_source
  ON canonical_refunds(tenant_id, source_type, status, refunded_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_refunds_deposit
  ON canonical_refunds(tenant_id, deposit_public_id, status)
  WHERE deposit_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_refunds_payment_reversal
  ON canonical_refunds(tenant_id, payment_reversal_public_id)
  WHERE payment_reversal_public_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_payment_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reversal_public_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  tender_public_id TEXT NOT NULL,
  allocation_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  reversed_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  allocation_reversed_before_minor INTEGER NOT NULL,
  allocation_reversed_after_minor INTEGER NOT NULL,
  tender_reversed_before_minor INTEGER NOT NULL,
  tender_reversed_after_minor INTEGER NOT NULL,
  receipt_refunded_before_minor INTEGER NOT NULL,
  receipt_refunded_after_minor INTEGER NOT NULL,
  invoice_paid_before_minor INTEGER NOT NULL,
  invoice_paid_after_minor INTEGER NOT NULL,
  invoice_due_before_minor INTEGER NOT NULL,
  invoice_due_after_minor INTEGER NOT NULL,
  invoice_net_due_before_minor INTEGER NOT NULL,
  invoice_net_due_after_minor INTEGER NOT NULL,
  compensation_guard INTEGER NOT NULL DEFAULT 1,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (status = 'posted'),
  CHECK (substr(reversed_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (allocation_reversed_after_minor = allocation_reversed_before_minor + amount_minor),
  CHECK (tender_reversed_after_minor = tender_reversed_before_minor + amount_minor),
  CHECK (receipt_refunded_after_minor = receipt_refunded_before_minor + amount_minor),
  CHECK (invoice_paid_before_minor >= amount_minor),
  CHECK (invoice_paid_after_minor = invoice_paid_before_minor - amount_minor),
  CHECK (invoice_due_after_minor = invoice_due_before_minor + amount_minor),
  CHECK (invoice_net_due_after_minor = invoice_net_due_before_minor + amount_minor),
  CONSTRAINT canonical_payment_reversals_compensation_guard CHECK (compensation_guard = 1),
  CONSTRAINT canonical_payment_reversals_balance_guard CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, tender_public_id)
    REFERENCES canonical_payment_tenders(tenant_id, tender_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, allocation_public_id)
    REFERENCES canonical_payment_allocations(tenant_id, allocation_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, reversal_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_payment_reversals_receipt
  ON canonical_payment_reversals(tenant_id, receipt_public_id, reversed_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_payment_reversals_allocation
  ON canonical_payment_reversals(tenant_id, allocation_public_id, reversed_at_utc);

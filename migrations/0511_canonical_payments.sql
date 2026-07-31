-- =============================================================================
-- HMS Canonical Payment Receipts, Tenders, and Allocations (D1 / SQLite)
-- Additive-only collection authority. Deposits, credits, refunds, and reversal
-- commands remain CDB-061. This migration is intentionally triggerless because
-- remote Wrangler/D1 migration execution rejects trigger-containing files with
-- `incomplete input`; atomic command/backfill guards preserve cross-row authority.
-- =============================================================================

PRAGMA foreign_keys = ON;

ALTER TABLE canonical_invoices
  ADD COLUMN paid_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canonical_invoices
  ADD COLUMN due_minor INTEGER NOT NULL DEFAULT 0;

UPDATE canonical_invoices
SET paid_minor = 0,
    due_minor = total_minor;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoice_lines_invoice_line
  ON canonical_invoice_lines(tenant_id, invoice_public_id, line_public_id);

CREATE TABLE IF NOT EXISTS canonical_payment_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  allocated_total_minor INTEGER NOT NULL,
  unallocated_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  received_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  legacy_collector_id INTEGER,
  legacy_counter_id INTEGER,
  legacy_counter_session_id INTEGER,
  external_transaction_id TEXT,
  posted_at_utc TEXT,
  failed_at_utc TEXT,
  reversed_at_utc TEXT,
  reconciliation_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(receipt_number)) > 0),
  CHECK (legacy_patient_id > 0),
  CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  CHECK (total_minor BETWEEN 1 AND 9007199254740991),
  CHECK (allocated_total_minor BETWEEN 0 AND 9007199254740991),
  CHECK (unallocated_minor BETWEEN 0 AND 9007199254740991),
  CHECK (total_minor = allocated_total_minor + unallocated_minor),
  CHECK (status IN ('pending','posted','failed','reversed')),
  CHECK (substr(received_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (posted_at_utc IS NULL OR substr(posted_at_utc, -1) = 'Z'),
  CHECK (failed_at_utc IS NULL OR substr(failed_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'pending'
      AND posted_at_utc IS NULL AND failed_at_utc IS NULL AND reversed_at_utc IS NULL
      AND allocated_total_minor = 0 AND unallocated_minor = total_minor)
    OR (status = 'posted'
      AND posted_at_utc IS NOT NULL AND failed_at_utc IS NULL AND reversed_at_utc IS NULL)
    OR (status = 'failed'
      AND posted_at_utc IS NULL AND failed_at_utc IS NOT NULL AND reversed_at_utc IS NULL
      AND allocated_total_minor = 0 AND unallocated_minor = total_minor)
    OR (status = 'reversed'
      AND posted_at_utc IS NOT NULL AND failed_at_utc IS NULL AND reversed_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_payment_receipts_reconciliation_guard
    CHECK (reconciliation_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  UNIQUE (tenant_id, receipt_public_id),
  UNIQUE (tenant_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_canonical_payment_receipts_patient_time
  ON canonical_payment_receipts(tenant_id, legacy_patient_id, received_at_utc, receipt_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_payment_receipts_status_time
  ON canonical_payment_receipts(tenant_id, status, received_at_utc, receipt_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_payment_receipts_external
  ON canonical_payment_receipts(tenant_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_payment_tenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  tender_public_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  tender_type TEXT NOT NULL,
  method_code TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  external_transaction_id TEXT,
  captured_at_utc TEXT,
  failed_at_utc TEXT,
  reversed_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (tender_type IN ('cash','card','mobile_wallet','bank_transfer','gateway','other')),
  CHECK (length(trim(method_code)) > 0),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (status IN ('verifying','captured','failed','reversed')),
  CHECK (captured_at_utc IS NULL OR substr(captured_at_utc, -1) = 'Z'),
  CHECK (failed_at_utc IS NULL OR substr(failed_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'verifying'
      AND captured_at_utc IS NULL AND failed_at_utc IS NULL AND reversed_at_utc IS NULL)
    OR (status = 'captured'
      AND captured_at_utc IS NOT NULL AND failed_at_utc IS NULL AND reversed_at_utc IS NULL)
    OR (status = 'failed'
      AND captured_at_utc IS NULL AND failed_at_utc IS NOT NULL AND reversed_at_utc IS NULL)
    OR (status = 'reversed'
      AND captured_at_utc IS NOT NULL AND failed_at_utc IS NULL AND reversed_at_utc IS NOT NULL)
  ),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, tender_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_payment_tenders_receipt
  ON canonical_payment_tenders(tenant_id, receipt_public_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_payment_tenders_status
  ON canonical_payment_tenders(tenant_id, status, tender_type, receipt_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payment_tenders_external
  ON canonical_payment_tenders(tenant_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  allocation_public_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  invoice_line_public_id TEXT,
  amount_minor INTEGER NOT NULL,
  invoice_due_before_minor INTEGER NOT NULL,
  invoice_due_after_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  allocated_at_utc TEXT NOT NULL,
  reversed_at_utc TEXT,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (invoice_due_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (invoice_due_after_minor BETWEEN 0 AND 9007199254740991),
  CHECK (invoice_due_after_minor = invoice_due_before_minor - amount_minor),
  CHECK (status IN ('active','reversed')),
  CHECK (substr(allocated_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'active' AND reversed_at_utc IS NULL)
    OR (status = 'reversed' AND reversed_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_payment_allocations_stale_invoice_balance_guard
    CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  CONSTRAINT fk_canonical_payment_allocations_invoice_line
    FOREIGN KEY (tenant_id, invoice_public_id, invoice_line_public_id)
    REFERENCES canonical_invoice_lines(tenant_id, invoice_public_id, line_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, allocation_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_payment_allocations_receipt
  ON canonical_payment_allocations(tenant_id, receipt_public_id, status, id);
CREATE INDEX IF NOT EXISTS idx_canonical_payment_allocations_invoice
  ON canonical_payment_allocations(tenant_id, invoice_public_id, status, id);
CREATE INDEX IF NOT EXISTS idx_canonical_payment_allocations_line
  ON canonical_payment_allocations(tenant_id, invoice_public_id, invoice_line_public_id, status)
  WHERE invoice_line_public_id IS NOT NULL;

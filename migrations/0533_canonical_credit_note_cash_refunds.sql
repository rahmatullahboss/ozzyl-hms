PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_credit_note_cash_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  refund_public_id TEXT NOT NULL,
  credit_note_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  payout_tender_type TEXT NOT NULL,
  payout_method_code TEXT NOT NULL,
  legacy_counter_id INTEGER NOT NULL,
  legacy_counter_session_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  refunded_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  reversed_at_utc TEXT,
  reconciliation_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (payout_tender_type = 'cash'),
  CHECK (length(trim(payout_method_code)) > 0),
  CHECK (legacy_counter_id > 0),
  CHECK (legacy_counter_session_id > 0),
  CHECK (status IN ('posted','reversed')),
  CHECK (substr(refunded_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'posted' AND reversed_at_utc IS NULL)
    OR (status = 'reversed' AND reversed_at_utc IS NOT NULL)
  ),
  CONSTRAINT canonical_credit_note_cash_refunds_reconciliation_guard
    CHECK (reconciliation_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, credit_note_public_id)
    REFERENCES canonical_credit_notes(tenant_id, credit_note_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, refund_public_id),
  UNIQUE (tenant_id, credit_note_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_cash_refunds_invoice
  ON canonical_credit_note_cash_refunds(tenant_id, invoice_public_id, status, refunded_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_cash_refunds_counter
  ON canonical_credit_note_cash_refunds(tenant_id, legacy_counter_session_id, status, refunded_at_utc);

CREATE TABLE IF NOT EXISTS canonical_credit_note_refund_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  receipt_slice_public_id TEXT NOT NULL,
  refund_public_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  receipt_refunded_before_minor INTEGER NOT NULL,
  receipt_refunded_after_minor INTEGER NOT NULL,
  receipt_net_received_before_minor INTEGER NOT NULL,
  receipt_net_received_after_minor INTEGER NOT NULL,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (receipt_refunded_before_minor BETWEEN 0 AND 9007199254740991),
  CHECK (receipt_refunded_after_minor = receipt_refunded_before_minor + amount_minor),
  CHECK (receipt_net_received_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (receipt_net_received_after_minor = receipt_net_received_before_minor - amount_minor),
  CONSTRAINT canonical_credit_note_refund_receipts_balance_guard CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, refund_public_id)
    REFERENCES canonical_credit_note_cash_refunds(tenant_id, refund_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, receipt_slice_public_id),
  UNIQUE (tenant_id, refund_public_id, receipt_public_id),
  UNIQUE (tenant_id, refund_public_id, receipt_slice_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_refund_receipts_refund
  ON canonical_credit_note_refund_receipts(tenant_id, refund_public_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_refund_receipts_source
  ON canonical_credit_note_refund_receipts(tenant_id, receipt_public_id, id);

CREATE TABLE IF NOT EXISTS canonical_credit_note_refund_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  allocation_slice_public_id TEXT NOT NULL,
  refund_public_id TEXT NOT NULL,
  receipt_slice_public_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  allocation_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  allocation_reversed_before_minor INTEGER NOT NULL,
  allocation_reversed_after_minor INTEGER NOT NULL,
  allocation_remaining_before_minor INTEGER NOT NULL,
  allocation_remaining_after_minor INTEGER NOT NULL,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (allocation_reversed_before_minor BETWEEN 0 AND 9007199254740991),
  CHECK (allocation_reversed_after_minor = allocation_reversed_before_minor + amount_minor),
  CHECK (allocation_remaining_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (allocation_remaining_after_minor = allocation_remaining_before_minor - amount_minor),
  CONSTRAINT canonical_credit_note_refund_allocations_balance_guard CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, refund_public_id, receipt_slice_public_id)
    REFERENCES canonical_credit_note_refund_receipts(tenant_id, refund_public_id, receipt_slice_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, allocation_public_id)
    REFERENCES canonical_payment_allocations(tenant_id, allocation_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, allocation_slice_public_id),
  UNIQUE (tenant_id, refund_public_id, allocation_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_refund_allocations_refund
  ON canonical_credit_note_refund_allocations(tenant_id, refund_public_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_refund_allocations_source
  ON canonical_credit_note_refund_allocations(tenant_id, allocation_public_id, id);

CREATE TABLE IF NOT EXISTS canonical_credit_note_refund_tender_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  tender_attribution_public_id TEXT NOT NULL,
  refund_public_id TEXT NOT NULL,
  receipt_slice_public_id TEXT NOT NULL,
  receipt_public_id TEXT NOT NULL,
  tender_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  original_tender_type TEXT NOT NULL,
  original_method_code TEXT NOT NULL,
  attributable_before_minor INTEGER NOT NULL,
  attributable_after_minor INTEGER NOT NULL,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (original_tender_type IN ('cash','card','mobile_wallet','bank_transfer','gateway','other')),
  CHECK (length(trim(original_method_code)) > 0),
  CHECK (attributable_before_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (attributable_after_minor = attributable_before_minor - amount_minor),
  CONSTRAINT canonical_credit_note_refund_tender_attributions_balance_guard CHECK (balance_guard = 1),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, refund_public_id, receipt_slice_public_id)
    REFERENCES canonical_credit_note_refund_receipts(tenant_id, refund_public_id, receipt_slice_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, receipt_public_id)
    REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, tender_public_id)
    REFERENCES canonical_payment_tenders(tenant_id, tender_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, tender_attribution_public_id),
  UNIQUE (tenant_id, refund_public_id, tender_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_refund_tender_attr_refund
  ON canonical_credit_note_refund_tender_attributions(tenant_id, refund_public_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_refund_tender_attr_source
  ON canonical_credit_note_refund_tender_attributions(tenant_id, tender_public_id, id);

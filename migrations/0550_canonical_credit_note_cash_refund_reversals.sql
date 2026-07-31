PRAGMA foreign_keys = ON;

-- Immutable authority for reversing a previously posted canonical credit-note
-- cash refund. The original credit note, refund, receipt/allocation slices and
-- tender attribution rows remain intact for audit and reconciliation.
CREATE TABLE IF NOT EXISTS canonical_credit_note_cash_refund_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reversal_public_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  refund_public_id TEXT NOT NULL,
  credit_note_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  credit_total_minor INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reversed_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL,
  legacy_counter_id INTEGER NOT NULL,
  legacy_counter_session_id INTEGER NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  reconciliation_guard INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(reversal_public_id)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (credit_total_minor BETWEEN amount_minor AND 9007199254740991),
  CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (substr(reversed_at_utc, -1) = 'Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (actor_user_id > 0),
  CHECK (legacy_counter_id > 0),
  CHECK (legacy_counter_session_id > 0),
  CHECK (length(source_evidence_sha256) = 64),
  CONSTRAINT canonical_credit_note_cash_refund_reversals_reconciliation_guard
    CHECK (reconciliation_guard = 1),
  FOREIGN KEY (tenant_id, refund_public_id)
    REFERENCES canonical_credit_note_cash_refunds(tenant_id, refund_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, credit_note_public_id)
    REFERENCES canonical_credit_notes(tenant_id, credit_note_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_credit_note_cash_refund_reversals_public_id
  ON canonical_credit_note_cash_refund_reversals(tenant_id, reversal_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_credit_note_cash_refund_reversals_key
  ON canonical_credit_note_cash_refund_reversals(tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_credit_note_cash_refund_reversals_refund
  ON canonical_credit_note_cash_refund_reversals(tenant_id, refund_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_cash_refund_reversals_invoice
  ON canonical_credit_note_cash_refund_reversals(tenant_id, invoice_public_id, reversed_at_utc);
CREATE INDEX IF NOT EXISTS idx_canonical_credit_note_cash_refund_reversals_counter
  ON canonical_credit_note_cash_refund_reversals(
    tenant_id,
    legacy_counter_session_id,
    reversed_at_utc
  );

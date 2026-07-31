-- Canonical reporting context for practitioner compensation facts.
-- Stores queryable source semantics that cannot be reconstructed from evidence hashes.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_compensation_reporting_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  accrual_public_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  incentive_type TEXT,
  legacy_bill_id INTEGER,
  legacy_invoice_item_id INTEGER,
  legacy_lab_order_item_id INTEGER,
  detail_name TEXT,
  source_reference TEXT,
  waiver_reason TEXT,
  doctor_waiver_minor INTEGER NOT NULL DEFAULT 0,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(source_kind)) > 0),
  CHECK (incentive_type IS NULL OR length(trim(incentive_type)) > 0),
  CHECK (legacy_bill_id IS NULL OR legacy_bill_id > 0),
  CHECK (legacy_invoice_item_id IS NULL OR legacy_invoice_item_id > 0),
  CHECK (legacy_lab_order_item_id IS NULL OR legacy_lab_order_item_id > 0),
  CHECK (detail_name IS NULL OR length(trim(detail_name)) > 0),
  CHECK (source_reference IS NULL OR length(trim(source_reference)) > 0),
  CHECK (waiver_reason IS NULL OR length(trim(waiver_reason)) > 0),
  CHECK (doctor_waiver_minor BETWEEN 0 AND 9007199254740991),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, accrual_public_id)
    REFERENCES canonical_compensation_accruals(tenant_id, accrual_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, accrual_public_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_compensation_reporting_context_source
  ON canonical_compensation_reporting_context(
    tenant_id, source_kind, incentive_type, legacy_bill_id, legacy_invoice_item_id
  );
CREATE INDEX IF NOT EXISTS idx_canonical_compensation_reporting_context_lab_item
  ON canonical_compensation_reporting_context(tenant_id, legacy_lab_order_item_id)
  WHERE legacy_lab_order_item_id IS NOT NULL;

-- =============================================================================
-- HMS Canonical Invoices and Typed Lines (D1 / SQLite)
-- Additive-only financial authority. Payments and allocations remain separate.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  legacy_patient_id INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  adjustment_total_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  issued_at_utc TEXT NOT NULL,
  posted_at_utc TEXT,
  cancelled_at_utc TEXT,
  reversed_at_utc TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(invoice_number)) > 0),
  CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  CHECK (subtotal_minor BETWEEN 0 AND 9007199254740991),
  CHECK (adjustment_total_minor BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  CHECK (total_minor = subtotal_minor + adjustment_total_minor),
  CHECK (status IN ('draft','posted','cancelled','reversed')),
  CHECK (substr(issued_at_utc, -1) = 'Z'),
  CHECK (posted_at_utc IS NULL OR substr(posted_at_utc, -1) = 'Z'),
  CHECK (cancelled_at_utc IS NULL OR substr(cancelled_at_utc, -1) = 'Z'),
  CHECK (reversed_at_utc IS NULL OR substr(reversed_at_utc, -1) = 'Z'),
  CHECK (
    (status = 'draft'
      AND posted_at_utc IS NULL AND cancelled_at_utc IS NULL AND reversed_at_utc IS NULL)
    OR (status = 'posted'
      AND posted_at_utc IS NOT NULL AND cancelled_at_utc IS NULL AND reversed_at_utc IS NULL)
    OR (status = 'cancelled'
      AND posted_at_utc IS NOT NULL AND cancelled_at_utc IS NOT NULL AND reversed_at_utc IS NULL)
    OR (status = 'reversed'
      AND posted_at_utc IS NOT NULL AND cancelled_at_utc IS NULL AND reversed_at_utc IS NOT NULL)
  ),
  CHECK (length(source_evidence_sha256) = 64),
  UNIQUE (tenant_id, invoice_public_id),
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_canonical_invoices_patient_time
  ON canonical_invoices(tenant_id, legacy_patient_id, issued_at_utc, invoice_public_id);
CREATE INDEX IF NOT EXISTS idx_canonical_invoices_status_time
  ON canonical_invoices(tenant_id, status, issued_at_utc, invoice_public_id);

CREATE TABLE IF NOT EXISTS canonical_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  line_public_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  line_type TEXT NOT NULL,
  service_event_public_id TEXT,
  adjustment_code TEXT,
  quantity INTEGER NOT NULL,
  unit_amount_minor INTEGER NOT NULL,
  line_amount_minor INTEGER NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (line_type IN ('service','discount','tax','rounding','surcharge','waiver','other_adjustment')),
  CHECK (quantity BETWEEN 1 AND 9007199254740991),
  CHECK (unit_amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (line_amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (
    (line_type = 'service'
      AND service_event_public_id IS NOT NULL
      AND adjustment_code IS NULL
      AND unit_amount_minor >= 0
      AND (unit_amount_minor = 0 OR quantity <= 9007199254740991 / unit_amount_minor)
      AND line_amount_minor = quantity * unit_amount_minor)
    OR
    (line_type <> 'service'
      AND service_event_public_id IS NULL
      AND adjustment_code IS NOT NULL
      AND quantity = 1
      AND line_amount_minor = unit_amount_minor)
  ),
  CHECK (line_type NOT IN ('discount','waiver') OR line_amount_minor <= 0),
  CHECK (line_type NOT IN ('tax','surcharge') OR line_amount_minor >= 0),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_event_public_id)
    REFERENCES canonical_service_events(tenant_id, event_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, line_public_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoice_lines_service_event
  ON canonical_invoice_lines(tenant_id, service_event_public_id)
  WHERE service_event_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_invoice_lines_invoice
  ON canonical_invoice_lines(tenant_id, invoice_public_id, id);
CREATE INDEX IF NOT EXISTS idx_canonical_invoice_lines_type
  ON canonical_invoice_lines(tenant_id, line_type, adjustment_code, invoice_public_id);

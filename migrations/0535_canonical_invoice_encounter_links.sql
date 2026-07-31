-- =============================================================================
-- Canonical invoice-to-encounter authority for IPD discharge billing.
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_invoice_encounter_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  invoice_public_id TEXT NOT NULL,
  encounter_public_id TEXT NOT NULL,
  legacy_admission_id INTEGER NOT NULL,
  link_type TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (legacy_admission_id > 0),
  CHECK (link_type IN ('discharge_invoice')),
  CHECK (length(source_evidence_sha256) = 64),
  FOREIGN KEY (tenant_id, invoice_public_id)
    REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, encounter_public_id)
    REFERENCES canonical_encounters(tenant_id, encounter_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, invoice_public_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoice_encounter_discharge
  ON canonical_invoice_encounter_links(tenant_id, encounter_public_id)
  WHERE link_type = 'discharge_invoice';

CREATE INDEX IF NOT EXISTS idx_canonical_invoice_encounter_admission
  ON canonical_invoice_encounter_links(tenant_id, legacy_admission_id, encounter_public_id);

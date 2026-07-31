-- =============================================================================
-- HMS Canonical Practitioner Operational Adoption (D1 / SQLite)
-- Additive operational version/evidence fields for the existing practitioner
-- authority. No authentication, contact, marketplace, fee, or scheduling facts
-- are copied into canonical practitioner identity.
-- =============================================================================

PRAGMA foreign_keys = ON;

ALTER TABLE canonical_practitioners
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0);

ALTER TABLE canonical_practitioners
  ADD COLUMN source_evidence_sha256 TEXT NOT NULL
  DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (
    length(source_evidence_sha256) = 64
    AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  );

CREATE INDEX IF NOT EXISTS idx_canonical_practitioners_operational_version
  ON canonical_practitioners(
    tenant_id,
    practitioner_public_id,
    status,
    version
  );

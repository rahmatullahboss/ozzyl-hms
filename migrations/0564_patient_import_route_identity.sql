-- Canonical Core V1 protected patient-import route identity.
-- Adds one stable, tenant-scoped source key for CSV-imported legacy patients so
-- the compatibility row and Canonical tenant-patient relationship can commit in
-- the same batch before an auto-increment id would otherwise be available.
-- Existing rows remain unchanged.

ALTER TABLE patients
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_canonical_source_key
  ON patients(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

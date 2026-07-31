-- Canonical Core V1 practitioner route identity.
-- Adds a stable route-generated source key for legacy doctor profiles so the
-- legacy insert and Canonical practitioner creation can commit atomically before
-- the auto-increment doctor id is known. Existing rows remain unchanged.

ALTER TABLE doctors
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_doctors_canonical_source_key
  ON doctors(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

-- Canonical Core V1 protected appointment route identity.
-- Adds a stable, tenant-scoped source key for legacy appointment mutations so
-- in-place legacy compatibility and immutable Canonical reschedule lineage can
-- coexist without rewriting historical source mappings. Existing rows remain unchanged.

ALTER TABLE appointments
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_canonical_source_key
  ON appointments(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

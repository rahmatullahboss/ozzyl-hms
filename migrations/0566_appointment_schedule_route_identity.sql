-- Canonical Core V1 appointment schedule domain-extension identity.
-- Existing schedule rows remain untouched; route mutations adopt a stable source key lazily.

ALTER TABLE doctor_schedules
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_schedules_canonical_source_key
  ON doctor_schedules(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

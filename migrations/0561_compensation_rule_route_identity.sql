-- Canonical Core V1 protected compensation-rule route identity.
-- Adds a stable route-generated source key for legacy doctor commission rules so
-- legacy compatibility and Canonical rule creation can commit atomically before
-- the auto-increment legacy row id is known. Existing rows remain unchanged.

ALTER TABLE doctor_commission_rules
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_commission_rules_canonical_source_key
  ON doctor_commission_rules(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

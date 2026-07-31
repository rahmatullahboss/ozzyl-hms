-- Canonical Core V1 encounter route identity for legacy visits.
-- Existing visit rows remain untouched and adopt a stable source key lazily.

ALTER TABLE visits
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_canonical_source_key
  ON visits(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

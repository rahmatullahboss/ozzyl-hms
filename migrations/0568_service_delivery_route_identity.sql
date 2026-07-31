-- CDB-V1-030G: stable route identity for protected service-delivery compatibility rows.
-- Existing rows remain nullable and are not rewritten.

ALTER TABLE visit_services
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_services_canonical_source_key
  ON visit_services(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

ALTER TABLE billing_provisional_items
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_provisional_items_canonical_source_key
  ON billing_provisional_items(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

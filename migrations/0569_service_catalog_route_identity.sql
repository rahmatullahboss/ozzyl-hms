-- Stable tenant-scoped source identities for service catalog and effective-price routes.
-- Existing rows remain unchanged; route integration adopts a key only when the row is mutated.

ALTER TABLE billing_service_items
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_service_items_canonical_source_key
  ON billing_service_items(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

ALTER TABLE billing_item_price_category_maps
  ADD COLUMN canonical_source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_item_price_category_maps_canonical_source_key
  ON billing_item_price_category_maps(tenant_id, canonical_source_key)
  WHERE canonical_source_key IS NOT NULL;

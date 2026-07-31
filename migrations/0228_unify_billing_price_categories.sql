-- Migration 0228: unify billing master price categories with Danphe-style price maps.
-- The billing counter, reception catalog, and Danphe gap migrations use
-- price_categories + billing_item_price_category_maps. Older billing master UI
-- routes wrote billing_price_categories + billing_item_price_category_map.

ALTER TABLE price_categories ADD COLUMN updated_at TEXT;

INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active, created_at, updated_at)
SELECT
  CAST(bpc.tenant_id AS TEXT),
  bpc.category_name,
  bpc.category_code,
  bpc.description,
  COALESCE(bpc.is_default, 0),
  COALESCE(bpc.is_active, 1),
  COALESCE(CAST(bpc.created_at AS TEXT), datetime('now', '+6 hours')),
  COALESCE(CAST(bpc.updated_at AS TEXT), datetime('now', '+6 hours'))
FROM billing_price_categories bpc
WHERE NOT EXISTS (
  SELECT 1
  FROM price_categories pc
  WHERE CAST(pc.tenant_id AS TEXT) = CAST(bpc.tenant_id AS TEXT)
    AND (
      (pc.category_code IS NOT NULL AND bpc.category_code IS NOT NULL AND pc.category_code = bpc.category_code)
      OR pc.category_name = bpc.category_name
    )
);

INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
SELECT DISTINCT
  CAST(bsi.tenant_id AS TEXT),
  'Normal',
  'NOR',
  'Standard price',
  1,
  1,
  datetime('now', '+6 hours')
FROM billing_service_items bsi
WHERE NOT EXISTS (
  SELECT 1 FROM price_categories pc
  WHERE CAST(pc.tenant_id AS TEXT) = CAST(bsi.tenant_id AS TEXT)
    AND pc.is_active = 1
);

INSERT OR IGNORE INTO billing_item_price_category_maps
  (tenant_id, service_item_id, price_category_id, price, is_discount_applicable, is_active, created_at, updated_at)
SELECT
  CAST(m.tenant_id AS TEXT),
  m.service_item_id,
  pc.id,
  m.price,
  CASE WHEN COALESCE(m.discount_percent, 0) >= 100 THEN 0 ELSE 1 END,
  COALESCE(m.is_active, 1),
  COALESCE(CAST(m.created_at AS TEXT), datetime('now', '+6 hours')),
  datetime('now', '+6 hours')
FROM billing_item_price_category_map m
JOIN billing_price_categories bpc
  ON bpc.id = m.price_category_id
 AND CAST(bpc.tenant_id AS TEXT) = CAST(m.tenant_id AS TEXT)
JOIN price_categories pc
  ON CAST(pc.tenant_id AS TEXT) = CAST(m.tenant_id AS TEXT)
 AND (
    (pc.category_code IS NOT NULL AND bpc.category_code IS NOT NULL AND pc.category_code = bpc.category_code)
    OR pc.category_name = bpc.category_name
 )
WHERE COALESCE(m.is_active, 1) = 1;

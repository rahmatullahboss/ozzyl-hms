-- Migration 0248: Backfill active diagnostic billing price maps.
-- Active LAB/RAD billing items must be billable through the default price
-- category, even when the operational catalog was seeded before price maps.

INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
SELECT DISTINCT CAST(si.tenant_id AS TEXT), 'Normal', 'NOR', 'Standard price', 1, 1, datetime('now', '+6 hours')
FROM billing_service_items si
JOIN billing_service_departments d
  ON d.id = si.service_department_id
 AND d.tenant_id = si.tenant_id
WHERE COALESCE(si.is_active, 1) = 1
  AND d.department_code IN ('LAB', 'RAD')
  AND CAST(si.tenant_id AS TEXT) != '__seed__'
  AND NOT EXISTS (
    SELECT 1
    FROM price_categories pc
    WHERE pc.tenant_id = CAST(si.tenant_id AS TEXT)
      AND COALESCE(pc.is_active, 1) = 1
  );

INSERT OR IGNORE INTO billing_item_price_category_maps (
  tenant_id, service_item_id, price_category_id, price, is_discount_applicable, is_active, created_at
)
SELECT
  CAST(si.tenant_id AS TEXT),
  si.id,
  pc.id,
  si.price,
  1,
  1,
  datetime('now', '+6 hours')
FROM billing_service_items si
JOIN billing_service_departments d
  ON d.id = si.service_department_id
 AND d.tenant_id = si.tenant_id
JOIN price_categories pc
  ON pc.tenant_id = CAST(si.tenant_id AS TEXT)
 AND COALESCE(pc.is_active, 1) = 1
 AND pc.id = (
   SELECT pc2.id
   FROM price_categories pc2
   WHERE pc2.tenant_id = CAST(si.tenant_id AS TEXT)
     AND COALESCE(pc2.is_active, 1) = 1
   ORDER BY COALESCE(pc2.is_default, 0) DESC, pc2.id ASC
   LIMIT 1
 )
WHERE COALESCE(si.is_active, 1) = 1
  AND d.department_code IN ('LAB', 'RAD')
  AND CAST(si.tenant_id AS TEXT) != '__seed__'
  AND NOT EXISTS (
    SELECT 1
    FROM billing_item_price_category_maps m
    WHERE m.tenant_id = CAST(si.tenant_id AS TEXT)
      AND m.service_item_id = si.id
      AND m.price_category_id = pc.id
  );

UPDATE billing_item_price_category_maps
SET price = (
      SELECT si.price
      FROM billing_service_items si
      WHERE si.id = billing_item_price_category_maps.service_item_id
        AND CAST(si.tenant_id AS TEXT) = billing_item_price_category_maps.tenant_id
    ),
    is_active = 1,
    updated_at = datetime('now', '+6 hours')
WHERE EXISTS (
  SELECT 1
  FROM billing_service_items si
  JOIN billing_service_departments d
    ON d.id = si.service_department_id
   AND d.tenant_id = si.tenant_id
  WHERE si.id = billing_item_price_category_maps.service_item_id
    AND CAST(si.tenant_id AS TEXT) = billing_item_price_category_maps.tenant_id
    AND COALESCE(si.is_active, 1) = 1
    AND d.department_code IN ('LAB', 'RAD')
);

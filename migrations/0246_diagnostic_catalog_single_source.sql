-- Migration 0246: Diagnostic catalog single source of truth
-- Links lab/radiology operational catalogs to billing_service_items so billing,
-- billing counter, direct billing, and diagnostic ordering resolve the same price.

ALTER TABLE lab_test_catalog ADD COLUMN billing_service_item_id INTEGER REFERENCES billing_service_items(id);
ALTER TABLE radiology_imaging_items ADD COLUMN billing_service_item_id INTEGER REFERENCES billing_service_items(id);

CREATE INDEX IF NOT EXISTS idx_lab_test_catalog_billing_item
  ON lab_test_catalog(tenant_id, billing_service_item_id);
CREATE INDEX IF NOT EXISTS idx_rad_items_billing_item
  ON radiology_imaging_items(tenant_id, billing_service_item_id);

-- Ensure the canonical diagnostic billing departments exist.
INSERT INTO billing_service_departments (department_name, department_code, is_active, tenant_id, created_by)
SELECT 'Laboratory', 'LAB', 1, t.tenant_id, 1
FROM (
  SELECT DISTINCT tenant_id FROM lab_test_catalog WHERE CAST(tenant_id AS TEXT) != '__seed__'
  UNION
  SELECT DISTINCT tenant_id FROM billing_service_items WHERE CAST(tenant_id AS TEXT) != '__seed__'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM billing_service_departments d
  WHERE d.tenant_id = t.tenant_id AND d.department_code = 'LAB'
);

INSERT INTO billing_service_departments (department_name, department_code, is_active, tenant_id, created_by)
SELECT 'Radiology', 'RAD', 1, t.tenant_id, 1
FROM (
  SELECT DISTINCT tenant_id FROM radiology_imaging_items WHERE CAST(tenant_id AS TEXT) != '__seed__'
  UNION
  SELECT DISTINCT tenant_id FROM billing_service_items WHERE CAST(tenant_id AS TEXT) != '__seed__'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM billing_service_departments d
  WHERE d.tenant_id = t.tenant_id AND d.department_code = 'RAD'
);

-- Create missing billable items for lab catalog rows.
INSERT INTO billing_service_items (
  item_name, item_code, service_department_id, price, tax_applicable, tax_percent,
  allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by
)
SELECT
  l.name,
  l.code,
  d.id,
  COALESCE(l.price, 0),
  0,
  0,
  1,
  1,
  l.category,
  0,
  COALESCE(l.is_active, 1),
  l.tenant_id,
  1
FROM lab_test_catalog l
JOIN billing_service_departments d
  ON d.tenant_id = l.tenant_id
 AND d.department_code = 'LAB'
WHERE CAST(l.tenant_id AS TEXT) != '__seed__'
  AND l.code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM billing_service_items si
    WHERE si.tenant_id = l.tenant_id
      AND si.service_department_id = d.id
      AND si.item_code = l.code
  );

UPDATE lab_test_catalog
SET billing_service_item_id = (
  SELECT si.id
  FROM billing_service_items si
  JOIN billing_service_departments d
    ON d.id = si.service_department_id
   AND d.tenant_id = si.tenant_id
  WHERE si.tenant_id = lab_test_catalog.tenant_id
    AND d.department_code = 'LAB'
    AND si.item_code = lab_test_catalog.code
  ORDER BY si.id
  LIMIT 1
)
WHERE billing_service_item_id IS NULL
  AND CAST(tenant_id AS TEXT) != '__seed__';

-- Create missing billable items for radiology catalog rows. Radiology keeps
-- price_paisa for RIS display, while billing_service_items.price stores BDT.
INSERT INTO billing_service_items (
  item_name, item_code, service_department_id, price, tax_applicable, tax_percent,
  allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by
)
SELECT
  i.name,
  i.procedure_code,
  d.id,
  ROUND(COALESCE(i.price_paisa, 0) / 100.0, 2),
  0,
  0,
  1,
  1,
  t.name,
  0,
  COALESCE(i.is_active, 1),
  i.tenant_id,
  1
FROM radiology_imaging_items i
JOIN billing_service_departments d
  ON d.tenant_id = i.tenant_id
 AND d.department_code = 'RAD'
LEFT JOIN radiology_imaging_types t
  ON t.id = i.imaging_type_id
 AND t.tenant_id = i.tenant_id
WHERE CAST(i.tenant_id AS TEXT) != '__seed__'
  AND i.procedure_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM billing_service_items si
    WHERE si.tenant_id = i.tenant_id
      AND si.service_department_id = d.id
      AND si.item_code = i.procedure_code
  );

UPDATE radiology_imaging_items
SET billing_service_item_id = (
  SELECT si.id
  FROM billing_service_items si
  JOIN billing_service_departments d
    ON d.id = si.service_department_id
   AND d.tenant_id = si.tenant_id
  WHERE si.tenant_id = radiology_imaging_items.tenant_id
    AND d.department_code = 'RAD'
    AND si.item_code = radiology_imaging_items.procedure_code
  ORDER BY si.id
  LIMIT 1
)
WHERE billing_service_item_id IS NULL
  AND CAST(tenant_id AS TEXT) != '__seed__';

-- Ensure default price categories and price maps exist for linked diagnostic items.
INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
SELECT DISTINCT si.tenant_id, 'Normal', 'NOR', 'Standard price', 1, 1, datetime('now', '+6 hours')
FROM billing_service_items si
WHERE si.id IN (
  SELECT billing_service_item_id FROM lab_test_catalog WHERE billing_service_item_id IS NOT NULL
  UNION
  SELECT billing_service_item_id FROM radiology_imaging_items WHERE billing_service_item_id IS NOT NULL
)
  AND NOT EXISTS (
    SELECT 1 FROM price_categories pc
    WHERE pc.tenant_id = si.tenant_id AND pc.is_active = 1
  );

INSERT OR IGNORE INTO billing_item_price_category_maps (
  tenant_id, service_item_id, price_category_id, price, is_discount_applicable, is_active, created_at
)
SELECT si.tenant_id, si.id, pc.id, si.price, 1, 1, datetime('now', '+6 hours')
FROM billing_service_items si
JOIN price_categories pc
  ON pc.tenant_id = si.tenant_id
 AND pc.is_active = 1
 AND pc.id = (
   SELECT pc2.id
   FROM price_categories pc2
   WHERE pc2.tenant_id = si.tenant_id AND pc2.is_active = 1
   ORDER BY pc2.is_default DESC, pc2.id ASC
   LIMIT 1
 )
WHERE si.id IN (
  SELECT billing_service_item_id FROM lab_test_catalog WHERE billing_service_item_id IS NOT NULL
  UNION
  SELECT billing_service_item_id FROM radiology_imaging_items WHERE billing_service_item_id IS NOT NULL
)
  AND NOT EXISTS (
    SELECT 1
    FROM billing_item_price_category_maps m
    WHERE m.tenant_id = si.tenant_id
      AND m.service_item_id = si.id
      AND m.price_category_id = pc.id
  );


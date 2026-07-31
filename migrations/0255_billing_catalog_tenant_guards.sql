-- Migration: Billing catalog tenant guards
-- Description: Merge exact duplicate active service departments safely and add
-- tenant-scoped active uniqueness guards for departments and service items.

DROP TABLE IF EXISTS _duplicate_billing_departments;
DROP TABLE IF EXISTS _duplicate_billing_items;

CREATE TABLE _duplicate_billing_departments AS
SELECT
  d.tenant_id,
  d.id AS duplicate_department_id,
  c.canonical_department_id
FROM billing_service_departments d
JOIN (
  SELECT tenant_id, lower(trim(department_name)) AS normalized_name, MIN(id) AS canonical_department_id
  FROM billing_service_departments
  WHERE COALESCE(is_active, 1) = 1
  GROUP BY tenant_id, lower(trim(department_name))
  HAVING COUNT(*) > 1
) c
  ON c.tenant_id = d.tenant_id
 AND c.normalized_name = lower(trim(d.department_name))
WHERE COALESCE(d.is_active, 1) = 1
  AND d.id <> c.canonical_department_id;

CREATE TABLE _duplicate_billing_items AS
SELECT
  dup.id AS duplicate_item_id,
  canon.id AS canonical_item_id
FROM billing_service_items dup
JOIN _duplicate_billing_departments dm
  ON dm.duplicate_department_id = dup.service_department_id
 AND dm.tenant_id = dup.tenant_id
JOIN billing_service_items canon
  ON canon.tenant_id = dup.tenant_id
 AND canon.service_department_id = dm.canonical_department_id
 AND COALESCE(canon.is_active, 1) = 1
 AND (
   (dup.item_code IS NOT NULL AND dup.item_code <> '' AND canon.item_code = dup.item_code)
   OR (lower(trim(canon.item_name)) = lower(trim(dup.item_name)))
 );

UPDATE visit_services
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = visit_services.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE radiology_imaging_items
SET billing_service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = radiology_imaging_items.billing_service_item_id
)
WHERE billing_service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE lab_test_catalog
SET billing_service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = lab_test_catalog.billing_service_item_id
)
WHERE billing_service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE procedure_orders
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = procedure_orders.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE billing_item_price_category_map
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = billing_item_price_category_map.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items)
  AND NOT EXISTS (
    SELECT 1
    FROM billing_item_price_category_map existing
    WHERE existing.tenant_id = billing_item_price_category_map.tenant_id
      AND existing.price_category_id = billing_item_price_category_map.price_category_id
      AND existing.service_item_id = (
        SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = billing_item_price_category_map.service_item_id
      )
  );

UPDATE billing_item_price_category_maps
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = billing_item_price_category_maps.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items)
  AND NOT EXISTS (
    SELECT 1
    FROM billing_item_price_category_maps existing
    WHERE existing.tenant_id = billing_item_price_category_maps.tenant_id
      AND existing.price_category_id = billing_item_price_category_maps.price_category_id
      AND existing.service_item_id = (
        SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = billing_item_price_category_maps.service_item_id
      )
  );

UPDATE billing_package_items
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = billing_package_items.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE billing_reporting_item_map
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items WHERE duplicate_item_id = billing_reporting_item_map.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE billing_service_items
SET is_active = 0,
    updated_at = datetime('now', '+6 hours')
WHERE id IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE billing_service_items
SET service_department_id = (
  SELECT canonical_department_id
  FROM _duplicate_billing_departments
  WHERE duplicate_department_id = billing_service_items.service_department_id
)
WHERE service_department_id IN (SELECT duplicate_department_id FROM _duplicate_billing_departments)
  AND id NOT IN (SELECT duplicate_item_id FROM _duplicate_billing_items);

UPDATE billing_service_departments
SET is_active = 0,
    updated_at = datetime('now', '+6 hours')
WHERE id IN (SELECT duplicate_department_id FROM _duplicate_billing_departments);

DROP TABLE IF EXISTS _duplicate_billing_items_by_code;
CREATE TABLE _duplicate_billing_items_by_code AS
SELECT
  dup.id AS duplicate_item_id,
  c.canonical_item_id
FROM billing_service_items dup
JOIN (
  SELECT tenant_id, item_code, MIN(id) AS canonical_item_id
  FROM billing_service_items
  WHERE COALESCE(is_active, 1) = 1
    AND item_code IS NOT NULL
    AND trim(item_code) <> ''
  GROUP BY tenant_id, item_code
  HAVING COUNT(*) > 1
) c
  ON c.tenant_id = dup.tenant_id
 AND c.item_code = dup.item_code
WHERE COALESCE(dup.is_active, 1) = 1
  AND dup.id <> c.canonical_item_id;

UPDATE visit_services
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = visit_services.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

UPDATE radiology_imaging_items
SET billing_service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = radiology_imaging_items.billing_service_item_id
)
WHERE billing_service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

UPDATE lab_test_catalog
SET billing_service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = lab_test_catalog.billing_service_item_id
)
WHERE billing_service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

UPDATE procedure_orders
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = procedure_orders.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

UPDATE billing_item_price_category_map
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = billing_item_price_category_map.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code)
  AND NOT EXISTS (
    SELECT 1
    FROM billing_item_price_category_map existing
    WHERE existing.tenant_id = billing_item_price_category_map.tenant_id
      AND existing.price_category_id = billing_item_price_category_map.price_category_id
      AND existing.service_item_id = (
        SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = billing_item_price_category_map.service_item_id
      )
  );

UPDATE billing_item_price_category_maps
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = billing_item_price_category_maps.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code)
  AND NOT EXISTS (
    SELECT 1
    FROM billing_item_price_category_maps existing
    WHERE existing.tenant_id = billing_item_price_category_maps.tenant_id
      AND existing.price_category_id = billing_item_price_category_maps.price_category_id
      AND existing.service_item_id = (
        SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = billing_item_price_category_maps.service_item_id
      )
  );

UPDATE billing_package_items
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = billing_package_items.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

UPDATE billing_reporting_item_map
SET service_item_id = (
  SELECT canonical_item_id FROM _duplicate_billing_items_by_code WHERE duplicate_item_id = billing_reporting_item_map.service_item_id
)
WHERE service_item_id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

UPDATE billing_service_items
SET is_active = 0,
    updated_at = datetime('now', '+6 hours')
WHERE id IN (SELECT duplicate_item_id FROM _duplicate_billing_items_by_code);

DROP TABLE IF EXISTS _duplicate_billing_items_by_code;
DROP TABLE IF EXISTS _duplicate_billing_items;
DROP TABLE IF EXISTS _duplicate_billing_departments;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_svc_dept_tenant_active_name
  ON billing_service_departments(tenant_id, lower(trim(department_name)))
  WHERE COALESCE(is_active, 1) = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_svc_dept_tenant_active_code
  ON billing_service_departments(tenant_id, department_code)
  WHERE COALESCE(is_active, 1) = 1 AND department_code IS NOT NULL AND trim(department_code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_svc_items_tenant_active_code
  ON billing_service_items(tenant_id, item_code)
  WHERE COALESCE(is_active, 1) = 1 AND item_code IS NOT NULL AND trim(item_code) <> '';

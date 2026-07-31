-- Migration 0247: Enforce active diagnostic catalog uniqueness.
-- Historical inactive rows may remain for old orders, but active catalog rows
-- and active billing items must have a single current source per code.

UPDATE lab_test_catalog
SET is_active = 0
WHERE COALESCE(is_active, 1) = 1
  AND code IS NOT NULL
  AND CAST(tenant_id AS TEXT) != '__seed__'
  AND id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id, code
          ORDER BY id ASC
        ) AS duplicate_rank
      FROM lab_test_catalog
      WHERE COALESCE(is_active, 1) = 1
        AND code IS NOT NULL
        AND CAST(tenant_id AS TEXT) != '__seed__'
    )
    WHERE duplicate_rank > 1
  );

UPDATE radiology_imaging_items
SET is_active = 0,
    updated_at = datetime('now', '+6 hours')
WHERE COALESCE(is_active, 1) = 1
  AND procedure_code IS NOT NULL
  AND CAST(tenant_id AS TEXT) != '__seed__'
  AND id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id, procedure_code
          ORDER BY id ASC
        ) AS duplicate_rank
      FROM radiology_imaging_items
      WHERE COALESCE(is_active, 1) = 1
        AND procedure_code IS NOT NULL
        AND CAST(tenant_id AS TEXT) != '__seed__'
    )
    WHERE duplicate_rank > 1
  );

UPDATE billing_service_items
SET is_active = 0,
    updated_at = datetime('now', '+6 hours')
WHERE COALESCE(is_active, 1) = 1
  AND item_code IS NOT NULL
  AND CAST(tenant_id AS TEXT) != '__seed__'
  AND id IN (
    SELECT id
    FROM (
      SELECT
        si.id,
        ROW_NUMBER() OVER (
          PARTITION BY si.tenant_id, si.service_department_id, si.item_code
          ORDER BY
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM lab_test_catalog ltc
                WHERE ltc.billing_service_item_id = si.id
                  AND ltc.tenant_id = si.tenant_id
                  AND COALESCE(ltc.is_active, 1) = 1
              )
              OR EXISTS (
                SELECT 1
                FROM radiology_imaging_items rii
                WHERE rii.billing_service_item_id = si.id
                  AND rii.tenant_id = si.tenant_id
                  AND COALESCE(rii.is_active, 1) = 1
              )
              THEN 0
              ELSE 1
            END,
            si.id ASC
        ) AS duplicate_rank
      FROM billing_service_items si
      WHERE COALESCE(si.is_active, 1) = 1
        AND si.item_code IS NOT NULL
        AND CAST(si.tenant_id AS TEXT) != '__seed__'
    )
    WHERE duplicate_rank > 1
  );

UPDATE billing_item_price_category_maps
SET is_active = 0,
    updated_at = datetime('now', '+6 hours')
WHERE COALESCE(is_active, 1) = 1
  AND service_item_id IN (
    SELECT id
    FROM billing_service_items
    WHERE COALESCE(is_active, 1) = 0
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_test_catalog_active_code_unique
  ON lab_test_catalog(tenant_id, code)
  WHERE COALESCE(is_active, 1) = 1
    AND code IS NOT NULL
    AND CAST(tenant_id AS TEXT) != '__seed__';

CREATE UNIQUE INDEX IF NOT EXISTS idx_rad_items_active_code_unique
  ON radiology_imaging_items(tenant_id, procedure_code)
  WHERE COALESCE(is_active, 1) = 1
    AND procedure_code IS NOT NULL
    AND CAST(tenant_id AS TEXT) != '__seed__';

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_service_items_active_dept_code_unique
  ON billing_service_items(tenant_id, service_department_id, item_code)
  WHERE COALESCE(is_active, 1) = 1
    AND item_code IS NOT NULL
    AND CAST(tenant_id AS TEXT) != '__seed__';

-- Backfill lab category master rows from the active lab catalog.
-- Lab settings should offer the same categories that existing tests already use.

INSERT INTO lab_test_categories
  (category_name, description, is_active, tenant_id, created_by, created_at, updated_at)
SELECT
  catalog.category,
  'Diagnostic catalog category',
  1,
  catalog.tenant_id,
  NULL,
  datetime('now', '+6 hours'),
  datetime('now', '+6 hours')
FROM (
  SELECT DISTINCT tenant_id, TRIM(category) AS category
  FROM lab_test_catalog
  WHERE COALESCE(is_active, 1) = 1
    AND category IS NOT NULL
    AND TRIM(category) != ''
) catalog
WHERE NOT EXISTS (
  SELECT 1
  FROM lab_test_categories existing
  WHERE existing.tenant_id = catalog.tenant_id
    AND COALESCE(existing.is_active, 1) = 1
    AND LOWER(existing.category_name) = LOWER(catalog.category)
);

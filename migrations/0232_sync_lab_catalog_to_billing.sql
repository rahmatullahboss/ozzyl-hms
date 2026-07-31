-- Migration: Add Laboratory department and sync existing lab tests
-- Creates 'Laboratory' (LAB) service department and syncs lab_test_catalog → billing_service_items

-- Step 1: Insert LAB department for all active tenants (idempotent)
INSERT INTO billing_service_departments (department_name, department_code, is_active, tenant_id, created_by)
SELECT 'Laboratory', 'LAB', 1, tenant_id, 1
FROM (SELECT DISTINCT tenant_id FROM lab_test_catalog UNION SELECT DISTINCT tenant_id FROM billing_service_items) t
WHERE NOT EXISTS (
  SELECT 1 FROM billing_service_departments WHERE department_code = 'LAB' AND billing_service_departments.tenant_id = t.tenant_id
);

-- Step 2: Sync existing lab tests to billing_service_items
-- Maps lab_test_catalog items to billing_service_items via LAB department
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT ltc.name, ltc.code, sd.id, ltc.price, 0, 0, 1, 1, ltc.category, 0, ltc.is_active, ltc.tenant_id, 1
FROM lab_test_catalog ltc
CROSS JOIN billing_service_departments sd
WHERE sd.department_code = 'LAB'
  AND sd.tenant_id = ltc.tenant_id
  AND NOT EXISTS (
    SELECT 1 FROM billing_service_items bsi
    WHERE bsi.item_code = ltc.code
      AND bsi.service_department_id = sd.id
      AND bsi.tenant_id = ltc.tenant_id
  );

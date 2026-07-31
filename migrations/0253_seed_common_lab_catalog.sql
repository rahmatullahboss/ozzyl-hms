-- Seed common OPD quick-order lab tests for tenants that do not yet have them.
-- Doctor workspace quick buttons depend on these names/codes resolving to a lab_test_catalog row.

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT CAST(tenant_id AS TEXT) FROM doctors WHERE tenant_id IS NOT NULL
  UNION
  SELECT CAST(tenant_id AS TEXT) FROM patients WHERE tenant_id IS NOT NULL
  UNION
  SELECT CAST(tenant_id AS TEXT) FROM appointments WHERE tenant_id IS NOT NULL
),
common_tests(code, name, category, price) AS (
  VALUES
    ('CBC', 'Complete Blood Count', 'Hematology', 500),
    ('RBS', 'Random Blood Sugar', 'Biochemistry', 150),
    ('HBA1C', 'HbA1c', 'Biochemistry', 800),
    ('CREAT', 'Serum Creatinine', 'Biochemistry', 400),
    ('LIPID', 'Lipid Profile', 'Biochemistry', 800),
    ('TSH', 'TSH', 'Hormone', 700)
)
INSERT INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
SELECT ct.code, ct.name, ct.category, ct.price, 1, ts.tenant_id
FROM tenant_source ts
CROSS JOIN common_tests ct
WHERE ts.tenant_id IS NOT NULL
  AND ts.tenant_id != ''
  AND NOT EXISTS (
    SELECT 1
    FROM lab_test_catalog existing
    WHERE CAST(existing.tenant_id AS TEXT) = ts.tenant_id
      AND (
        UPPER(existing.code) = ct.code
        OR LOWER(existing.name) = LOWER(ct.name)
        OR (ct.code = 'RBS' AND LOWER(existing.name) LIKE '%random%blood%sugar%')
        OR (ct.code = 'CREAT' AND LOWER(existing.name) LIKE '%creatinine%')
      )
      AND COALESCE(existing.is_active, 1) = 1
  );

-- Seed missing accounting account mappings for all tenants
-- This ensures income/expense posting works for all tenants

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('cash', '1001'),
    ('bank', '1002'),
    ('lab_revenue', '4001'),
    ('doctor_visit_revenue', '4002'),
    ('admission_revenue', '4003'),
    ('operation_revenue', '4004'),
    ('pharmacy_revenue', '4005'),
    ('other_revenue', '4100'),
    ('accounts_receivable', '1200'),
    ('patient_deposit_liability', '2100'),
    ('discount_allowed', '5100'),
    ('doctor_commission_expense', '6100'),
    ('doctor_commission_payable', '2200'),
    ('general_expense', '5990'),
    ('retained_earnings', '3100'),
    ('shareholder_payable', '2300')
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT ct.tenant_id, md.mapping_key, coa.id, 1
FROM coa_tenants ct
JOIN mapping_defaults md
JOIN chart_of_accounts coa
  ON CAST(coa.tenant_id AS TEXT) = ct.tenant_id
 AND coa.code = md.account_code
 AND COALESCE(coa.is_active, 1) = 1
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1;
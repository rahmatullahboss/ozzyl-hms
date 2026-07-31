-- Repair semantic mappings created from legacy global account seeds.
-- This production database still has a global COA code uniqueness constraint,
-- so this migration avoids rebuilding referenced posted-ledger tables. It
-- removes cross-tenant mappings that would post to another tenant's account and
-- maps direct operating expenses to a dedicated account for tenants that already
-- have a chart of accounts.

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
direct_expense_account AS (
  SELECT '5990' AS code, 'General Operating Expense' AS name, 'expense' AS type
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id)
SELECT dea.code, dea.name, dea.type, ct.tenant_id
FROM coa_tenants ct
JOIN direct_expense_account dea
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.code = dea.code
);

DELETE FROM accounting_account_mappings
WHERE EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.id = accounting_account_mappings.account_id
    AND CAST(coa.tenant_id AS TEXT) <> CAST(accounting_account_mappings.tenant_id AS TEXT)
);

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('general_expense', '5990')
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

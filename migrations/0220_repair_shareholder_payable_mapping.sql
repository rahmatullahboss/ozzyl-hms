-- Migration: 0220_repair_shareholder_payable_mapping.sql
-- Description: Move shareholder dividend payable mapping off the salary payable account.

WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM profit_distributions
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id, is_active)
SELECT '8350', 'Shareholder Dividend Payable', 'liability', COALESCE((SELECT MIN(tenant_id) FROM tenant_source), 'system'), 1
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts
  WHERE code = '8350'
);

UPDATE chart_of_accounts
SET name = 'Shareholder Dividend Payable',
    type = 'liability',
    is_active = 1
WHERE code = '8350';

WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM profit_distributions
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT ts.tenant_id, 'shareholder_payable', coa.id, 1
FROM tenant_source ts
JOIN chart_of_accounts coa
  ON coa.code = '8350'
  AND coa.is_active = 1
WHERE ts.tenant_id IS NOT NULL
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1;

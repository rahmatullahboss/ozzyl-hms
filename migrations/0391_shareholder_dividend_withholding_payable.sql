-- Migration 0391: shareholder dividend withholding payable mapping
-- Adds a dedicated liability account and semantic posting mapping for dividend withholding.

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM accounting_posting_events
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id, is_active)
SELECT
  CASE
    WHEN t.tenant_id = (SELECT MIN(tenant_id) FROM tenant_source) THEN '8360'
    ELSE '8360-T' || t.tenant_id
  END AS code,
  'Dividend Withholding Payable' AS name,
  'liability' AS type,
  t.tenant_id,
  1
FROM tenant_source t
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE CAST(coa.tenant_id AS TEXT) = t.tenant_id
    AND (coa.code = '8360' OR coa.code = '8360-T' || t.tenant_id)
);

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM accounting_posting_events
), candidate_accounts AS (
  SELECT
    t.tenant_id,
    coa.id AS account_id,
    ROW_NUMBER() OVER (PARTITION BY t.tenant_id ORDER BY coa.id) AS rn
  FROM tenant_source t
  JOIN chart_of_accounts coa
    ON CAST(coa.tenant_id AS TEXT) = t.tenant_id
   AND COALESCE(coa.is_active, 1) = 1
   AND (coa.code = '8360' OR coa.code = '8360-T' || t.tenant_id)
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT tenant_id, 'withholding_payable', account_id, 1
FROM candidate_accounts
WHERE rn = 1
  AND NOT EXISTS (
    SELECT 1
    FROM accounting_account_mappings existing
    WHERE CAST(existing.tenant_id AS TEXT) = candidate_accounts.tenant_id
      AND existing.mapping_key = 'withholding_payable'
  );

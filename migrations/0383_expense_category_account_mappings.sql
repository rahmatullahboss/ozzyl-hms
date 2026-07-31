-- Migration: 0383_expense_category_account_mappings.sql
-- Description: Adds category-specific expense accounts and mappings for direct expense posting.

PRAGMA foreign_keys = ON;

WITH tenant_scope AS (
  SELECT DISTINCT tenant_id FROM chart_of_accounts
),
expense_accounts(account_code, account_name) AS (
  VALUES
    ('5100', 'Salary Expense'),
    ('5200', 'Rent Expense'),
    ('5310', 'Electricity Expense'),
    ('5320', 'Water Expense'),
    ('5330', 'Communication Expense'),
    ('5400', 'Maintenance Expense'),
    ('5800', 'Marketing Expense'),
    ('5900', 'Bank Charges'),
    ('5991', 'Other Expense')
)
INSERT OR IGNORE INTO chart_of_accounts (code, name, type, tenant_id, is_active)
SELECT ea.account_code, ea.account_name, 'expense', ts.tenant_id, 1
FROM tenant_scope ts
CROSS JOIN expense_accounts ea;

WITH expense_mappings(mapping_key, account_code) AS (
  VALUES
    ('expense_salary', '5100'),
    ('expense_medicine', '5000'),
    ('expense_rent', '5200'),
    ('expense_electricity', '5310'),
    ('expense_water', '5320'),
    ('expense_communication', '5330'),
    ('expense_maintenance', '5400'),
    ('expense_supplies', '5700'),
    ('expense_marketing', '5800'),
    ('expense_bank_charges', '5900')
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT coa.tenant_id, em.mapping_key, coa.id, 1
FROM expense_mappings em
JOIN chart_of_accounts coa
  ON coa.code = em.account_code
 AND COALESCE(coa.is_active, 1) = 1
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1,
  updated_at = datetime('now', '+6 hours');

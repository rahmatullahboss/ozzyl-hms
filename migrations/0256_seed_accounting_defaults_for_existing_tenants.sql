-- Migration: Seed accounting defaults for existing tenants
-- Description: Ensures every existing tenant has fiscal year, voucher types,
-- COA accounts, and semantic posting mappings. Uses tenant-suffixed account
-- codes when an older database has a global chart_of_accounts.code uniqueness
-- constraint.

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM accounting_posting_events
)
INSERT OR IGNORE INTO fiscal_years
  (tenant_id, fiscal_year_name, start_date, end_date, is_active, is_closed, created_at)
SELECT
  tenant_id,
  'FY' || strftime('%Y', 'now'),
  strftime('%Y', 'now') || '-01-01',
  strftime('%Y', 'now') || '-12-31',
  1,
  0,
  datetime('now', '+6 hours')
FROM tenant_source;

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM accounting_posting_events
),
voucher_defaults(code, name) AS (
  VALUES
    ('JV', 'Journal Voucher'),
    ('RCPT', 'Receipt Voucher'),
    ('PMTV', 'Payment Voucher')
)
INSERT OR IGNORE INTO voucher_types (tenant_id, code, name, allow_verification, is_active)
SELECT tenant_id, code, name, 1, 1
FROM tenant_source
CROSS JOIN voucher_defaults;

DROP TABLE IF EXISTS _accounting_default_accounts;
DROP TABLE IF EXISTS _accounting_default_mappings;

CREATE TABLE _accounting_default_accounts (
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

INSERT INTO _accounting_default_accounts (code, name, type) VALUES
  ('1003', 'Admin / Main Cash', 'asset'),
  ('1004', 'Card Settlement Clearing', 'asset'),
  ('1005', 'bKash Wallet Clearing', 'asset'),
  ('1006', 'Nagad Wallet Clearing', 'asset'),
  ('1007', 'Rocket Wallet Clearing', 'asset'),
  ('1008', 'Bank Transfer Clearing', 'asset'),
  ('1009', 'Cheque Clearing', 'asset'),
  ('1010', 'Other Payment Clearing', 'asset'),
  ('1300', 'Pharmacy Inventory', 'asset'),
  ('1350', 'General Inventory', 'asset'),
  ('4000', 'Pharmacy Sales', 'revenue'),
  ('4100', 'Laboratory Income', 'revenue'),
  ('4200', 'Doctor Visit Fees', 'revenue'),
  ('4300', 'Admission Fees', 'revenue'),
  ('4400', 'Operation/OT Income', 'revenue'),
  ('4600', 'Other Income', 'revenue'),
  ('5000', 'Medicine Cost', 'expense'),
  ('5700', 'Medical Supplies', 'expense'),
  ('5850', 'Doctor Commission Expense', 'expense'),
  ('5860', 'Agent / Referral Commission Expense', 'expense'),
  ('5950', 'Discount Allowed', 'expense'),
  ('5990', 'General Operating Expense', 'expense'),
  ('7000', 'Cash', 'asset'),
  ('7100', 'Bank', 'asset'),
  ('7200', 'Accounts Receivable', 'asset'),
  ('8000', 'Accounts Payable', 'liability'),
  ('8250', 'Patient Deposit Liability', 'liability'),
  ('8300', 'Doctor Commission Payable', 'liability'),
  ('8310', 'Agent / Referral Commission Payable', 'liability'),
  ('8350', 'Shareholder Dividend Payable', 'liability'),
  ('9000', 'Retained Earnings', 'equity');

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM accounting_posting_events
),
account_rows AS (
  SELECT
    t.tenant_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM chart_of_accounts existing_same_tenant
        WHERE existing_same_tenant.code = a.code
          AND CAST(existing_same_tenant.tenant_id AS TEXT) = t.tenant_id
      ) THEN a.code
      WHEN NOT EXISTS (
        SELECT 1
        FROM chart_of_accounts existing_global
        WHERE existing_global.code = a.code
      )
        AND t.tenant_id = (SELECT MIN(tenant_id) FROM tenant_source)
      THEN a.code
      ELSE a.code || '-T' || t.tenant_id
    END AS code,
    a.name,
    a.type,
    a.code AS semantic_code
  FROM tenant_source t
  CROSS JOIN _accounting_default_accounts a
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id, is_active)
SELECT code, name, type, tenant_id, 1
FROM account_rows ar
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts existing
  WHERE CAST(existing.tenant_id AS TEXT) = ar.tenant_id
    AND (existing.code = ar.semantic_code OR existing.code = ar.code)
);

CREATE TABLE _accounting_default_mappings (
  mapping_key TEXT NOT NULL,
  account_code TEXT NOT NULL
);

INSERT INTO _accounting_default_mappings (mapping_key, account_code) VALUES
  ('admin_cash', '1003'),
  ('card_clearing', '1004'),
  ('bkash_wallet', '1005'),
  ('nagad_wallet', '1006'),
  ('rocket_wallet', '1007'),
  ('bank_transfer_clearing', '1008'),
  ('cheque_clearing', '1009'),
  ('other_payment_clearing', '1010'),
  ('pharmacy_inventory', '1300'),
  ('general_inventory', '1350'),
  ('pharmacy_revenue', '4000'),
  ('lab_revenue', '4100'),
  ('doctor_visit_revenue', '4200'),
  ('admission_revenue', '4300'),
  ('operation_revenue', '4400'),
  ('other_revenue', '4600'),
  ('pharmacy_cogs', '5000'),
  ('inventory_expense', '5700'),
  ('doctor_commission_expense', '5850'),
  ('agent_commission_expense', '5860'),
  ('discount_allowed', '5950'),
  ('general_expense', '5990'),
  ('cash', '7000'),
  ('bank', '7100'),
  ('accounts_receivable', '7200'),
  ('accounts_payable', '8000'),
  ('patient_deposit_liability', '8250'),
  ('doctor_commission_payable', '8300'),
  ('agent_commission_payable', '8310'),
  ('shareholder_payable', '8350'),
  ('retained_earnings', '9000');

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM accounting_posting_events
),
resolved AS (
  SELECT
    t.tenant_id,
    m.mapping_key,
    coa.id AS account_id
  FROM tenant_source t
  JOIN _accounting_default_mappings m
  JOIN chart_of_accounts coa
    ON CAST(coa.tenant_id AS TEXT) = t.tenant_id
   AND COALESCE(coa.is_active, 1) = 1
   AND (coa.code = m.account_code OR coa.code = m.account_code || '-T' || t.tenant_id)
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT tenant_id, mapping_key, account_id, 1
FROM resolved
WHERE true
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1,
  updated_at = datetime('now', '+6 hours');

DROP TABLE IF EXISTS _accounting_default_mappings;
DROP TABLE IF EXISTS _accounting_default_accounts;

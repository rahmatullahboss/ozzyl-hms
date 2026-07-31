-- Migration: 0236_payment_method_asset_mappings.sql
-- Description: Seed separate asset/clearing ledgers for payment-method-wise accounting.

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
default_accounts(code, name, type) AS (
  VALUES
    ('1004', 'Card Settlement Clearing', 'asset'),
    ('1005', 'bKash Wallet Clearing', 'asset'),
    ('1006', 'Nagad Wallet Clearing', 'asset'),
    ('1007', 'Rocket Wallet Clearing', 'asset'),
    ('1008', 'Bank Transfer Clearing', 'asset'),
    ('1009', 'Cheque Clearing', 'asset'),
    ('1010', 'Other Payment Clearing', 'asset')
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id)
SELECT a.code, a.name, a.type, ct.tenant_id
FROM coa_tenants ct
JOIN default_accounts a
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE CAST(coa.tenant_id AS TEXT) = ct.tenant_id
    AND coa.code = a.code
);

WITH coa_tenants AS (
  SELECT DISTINCT CAST(tenant_id AS TEXT) AS tenant_id
  FROM chart_of_accounts
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('card_clearing', '1004'),
    ('bkash_wallet', '1005'),
    ('nagad_wallet', '1006'),
    ('rocket_wallet', '1007'),
    ('bank_transfer_clearing', '1008'),
    ('cheque_clearing', '1009'),
    ('other_payment_clearing', '1010')
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

-- =============================================================================
-- HMS SaaS — Accounting Module Seed Data (Minimal)
-- Hospital: "City Care General Hospital" | Slug: demo-hospital | Tenant ID: 100
-- Run: npx wrangler d1 execute hms-super-admin-production --remote --file=migrations/seed_accounting_demo.sql
--
-- Seeds Chart of Accounts for the demo-hospital tenant (id=100).
-- Only tables that exist in production are seeded.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- CHART OF ACCOUNTS
-- IDs 1 and 2 are referenced in E2E tests (debit_account_id: 1, credit_account_id: 2)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO chart_of_accounts (id, code, name, type, tenant_id) VALUES
    (1, '7000', 'Cash', 'asset', 100),
    (2, '7100', 'Bank', 'asset', 100);

INSERT OR IGNORE INTO chart_of_accounts (code, name, type, tenant_id) VALUES
    -- Revenue Accounts
    ('4000', 'Pharmacy Sales', 'revenue', 100),
    ('4100', 'Laboratory Income', 'revenue', 100),
    ('4200', 'Doctor Visit Fees', 'revenue', 100),
    ('4300', 'Admission Fees', 'revenue', 100),
    ('4400', 'Operation/OT Income', 'revenue', 100),
    ('4500', 'Ambulance Service', 'revenue', 100),
    ('4600', 'Other Income', 'revenue', 100),
    -- Expense Accounts
    ('5000', 'Medicine Cost', 'expense', 100),
    ('5100', 'Staff Salary', 'expense', 100),
    ('5200', 'Rent Expense', 'expense', 100),
    ('5300', 'Electricity', 'expense', 100),
    ('5400', 'Water Supply', 'expense', 100),
    ('5500', 'Internet & Phone', 'expense', 100),
    ('5600', 'Maintenance', 'expense', 100),
    ('5700', 'Medical Supplies', 'expense', 100),
    ('5800', 'Marketing', 'expense', 100),
    ('5900', 'Bank Charges', 'expense', 100),
    ('6000', 'Miscellaneous Expenses', 'expense', 100),
    -- Asset Accounts (additional)
    ('7200', 'Accounts Receivable', 'asset', 100),
    ('7300', 'Medical Equipment', 'asset', 100),
    ('7400', 'Furniture & Fixtures', 'asset', 100),
    ('7500', 'Building', 'asset', 100),
    ('7600', 'Vehicles', 'asset', 100),
    -- Liability Accounts
    ('8000', 'Accounts Payable', 'liability', 100),
    ('8100', 'Salary Payable', 'liability', 100),
    ('8200', 'Tax Payable', 'liability', 100),
    -- Equity Accounts
    ('9000', 'Retained Earnings', 'equity', 100),
    ('9100', 'Capital Account', 'equity', 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Accounting seed applied for tenant 100 (demo-hospital)' AS status;
SELECT 'Chart of Accounts: ' || COUNT(*) || ' rows' AS coa_count FROM chart_of_accounts WHERE tenant_id = 100;
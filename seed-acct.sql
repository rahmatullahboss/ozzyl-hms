-- Seed accounting data for demo-hospital (tenant_id=100)
-- Chart of Accounts
INSERT OR IGNORE INTO chart_of_accounts (id, code, name, type, tenant_id) VALUES
    (1, '7000', 'Cash', 'asset', 100),
    (2, '7100', 'Bank', 'asset', 100);
INSERT OR IGNORE INTO chart_of_accounts (code, name, type, tenant_id) VALUES
    ('4000', 'Pharmacy Sales', 'revenue', 100),
    ('4100', 'Laboratory Income', 'revenue', 100),
    ('4200', 'Doctor Visit Fees', 'revenue', 100),
    ('5000', 'Medicine Cost', 'expense', 100),
    ('5100', 'Staff Salary', 'expense', 100),
    ('7200', 'Accounts Receivable', 'asset', 100),
    ('8000', 'Accounts Payable', 'liability', 100);

-- Voucher Types
INSERT OR IGNORE INTO voucher_types (tenant_id, code, name, allow_verification) VALUES
    ('100', 'JV', 'Journal Voucher', 1),
    ('100', 'PMTV', 'Payment Voucher', 1),
    ('100', 'RCPT', 'Receipt Voucher', 0),
    ('100', 'CPV', 'Contra Voucher', 0),
    ('100', 'CRV', 'Credit Voucher', 1);

SELECT 'Done' AS status;
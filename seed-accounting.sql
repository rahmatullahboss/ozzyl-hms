-- Seed Data for Accounting Module
-- Run after tenant-schema.sql to populate default data

-- Default Chart of Accounts for Hospital
-- Revenue Accounts (4000-4999)
INSERT INTO chart_of_accounts (code, name, type, tenant_id) VALUES 
    ('4000', 'Pharmacy Sales', 'revenue', 1),
    ('4100', 'Laboratory Income', 'revenue', 1),
    ('4200', 'Doctor Visit Fees', 'revenue', 1),
    ('4300', 'Admission Fees', 'revenue', 1),
    ('4400', 'Operation/OT Income', 'revenue', 1),
    ('4500', 'Ambulance Service', 'revenue', 1),
    ('4600', 'Other Income', 'revenue', 1);

-- Expense Accounts (5000-5999)
INSERT INTO chart_of_accounts (code, name, type, tenant_id) VALUES 
    ('5000', 'Medicine Cost', 'expense', 1),
    ('5100', 'Staff Salary', 'expense', 1),
    ('5200', 'Rent Expense', 'expense', 1),
    ('5300', 'Electricity', 'expense', 1),
    ('5400', 'Water Supply', 'expense', 1),
    ('5500', 'Internet & Phone', 'expense', 1),
    ('5600', 'Maintenance', 'expense', 1),
    ('5700', 'Medical Supplies', 'expense', 1),
    ('5800', 'Marketing', 'expense', 1),
    ('5900', 'Bank Charges', 'expense', 1),
    ('6000', 'Miscellaneous Expenses', 'expense', 1);

-- Asset Accounts (7000-7999)
INSERT INTO chart_of_accounts (code, name, type, tenant_id) VALUES 
    ('7000', 'Cash', 'asset', 1),
    ('7100', 'Bank', 'asset', 1),
    ('7200', 'Accounts Receivable', 'asset', 1);

-- Liability Accounts (8000-8999)
INSERT INTO chart_of_accounts (code, name, type, tenant_id) VALUES 
    ('8000', 'Accounts Payable', 'liability', 1),
    ('8100', 'Salary Payable', 'liability', 1);

-- Default Expense Categories
INSERT INTO expense_categories (name, code, requires_approval, is_recurring_eligible, tenant_id) VALUES
    ('Staff Salary', 'SALARY', 0, 1, 1),
    ('Medicine Purchase', 'MEDICINE', 0, 1, 1),
    ('Rent', 'RENT', 1, 1, 1),
    ('Electricity', 'ELECTRICITY', 0, 1, 1),
    ('Water Supply', 'WATER', 0, 1, 1),
    ('Internet & Phone', 'COMMUNICATION', 0, 1, 1),
    ('Maintenance', 'MAINTENANCE', 1, 0, 1),
    ('Medical Supplies', 'SUPPLIES', 0, 1, 1),
    ('Marketing', 'MARKETING', 1, 0, 1),
    ('Bank Charges', 'BANK', 0, 0, 1),
    ('Miscellaneous', 'MISC', 1, 0, 1);

-- Default Voucher Types
INSERT OR IGNORE INTO voucher_types (tenant_id, code, name, allow_verification) VALUES
    ('demo-hospital', 'JV', 'Journal Voucher', 1),
    ('demo-hospital', 'PMTV', 'Payment Voucher', 1),
    ('demo-hospital', 'RCPT', 'Receipt Voucher', 0),
    ('demo-hospital', 'CPV', 'Contra Voucher', 0),
    ('demo-hospital', 'CRV', 'Credit Voucher', 1);

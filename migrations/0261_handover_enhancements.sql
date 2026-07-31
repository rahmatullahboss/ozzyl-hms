-- Enhance billing_handovers with account type and denomination columns
ALTER TABLE billing_handovers ADD COLUMN bank_name TEXT;
ALTER TABLE billing_handovers ADD COLUMN voucher_number TEXT;
ALTER TABLE billing_handovers ADD COLUMN voucher_date TEXT;
ALTER TABLE billing_handovers ADD COLUMN denomination_details TEXT;

-- Update existing handover_type default (new rows will use 'user' instead of 'cashier')
-- Note: SQLite doesn't support ALTER COLUMN, so existing default stays for old rows

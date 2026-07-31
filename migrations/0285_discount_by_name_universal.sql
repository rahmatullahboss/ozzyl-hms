-- Add discount_by_name to appointments and billing_settlements
-- to track who authorized discounts at every discount point in the system.

ALTER TABLE appointments ADD COLUMN discount_by_name TEXT;
ALTER TABLE billing_settlements ADD COLUMN discount_by_name TEXT;

-- Add discount_by_name column to track who referred/requested the discount
-- This allows admins to see who authorized or requested a discount on a bill

ALTER TABLE bills ADD COLUMN discount_by_name TEXT;
ALTER TABLE bill_versions ADD COLUMN discount_by_name TEXT;

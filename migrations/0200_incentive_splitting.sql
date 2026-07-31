-- migrations/0200_incentive_splitting.sql
-- Add incentive_type to support multi-doctor commission splitting

ALTER TABLE doctor_commission_rules ADD COLUMN incentive_type TEXT DEFAULT 'performer';
ALTER TABLE doctor_commission_accruals ADD COLUMN incentive_type TEXT DEFAULT 'performer';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_dc_rules_incentive_type ON doctor_commission_rules(incentive_type);
CREATE INDEX IF NOT EXISTS idx_dc_accruals_incentive_type ON doctor_commission_accruals(incentive_type);

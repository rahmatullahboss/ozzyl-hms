-- Add admission fee column to admissions table
-- This allows hospitals to charge an admission/registration fee when admitting patients

ALTER TABLE admissions ADD COLUMN admission_fee INTEGER DEFAULT 0;

-- 0284: Add package billing fields to billing_packages and admissions
-- Supports: Package with included bed days, extra bed rate, billing mode at admission

-- Add new columns to billing_packages
ALTER TABLE billing_packages ADD COLUMN included_bed_days INTEGER DEFAULT 0;
ALTER TABLE billing_packages ADD COLUMN extra_bed_rate REAL DEFAULT 0;
ALTER TABLE billing_packages ADD COLUMN package_type TEXT DEFAULT 'standard';
-- package_type: standard | package_plus_bed | package_included_days

-- Add package_id and billing_mode to admissions
ALTER TABLE admissions ADD COLUMN package_id INTEGER REFERENCES billing_packages(id);
ALTER TABLE admissions ADD COLUMN billing_mode TEXT DEFAULT 'regular';
-- billing_mode: regular | package | package_plus_bed | package_included_days | corporate | emergency

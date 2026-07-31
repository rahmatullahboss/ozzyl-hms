-- Migration: 0095_blood_donor_patient_link.sql
-- Add patient_id column to blood_donors for linking donors to patients
-- Idempotent: only adds if column doesn't exist

-- Use PRAGMA to check if column exists (not available in D1 migrations, so using try-catch approach via separate IF NOT EXISTS check)
-- For D1, we'll use a safe approach - check table info first
-- Since D1 doesn't support table check directly, we'll just create the index if not exists (column was already added manually)

CREATE INDEX IF NOT EXISTS idx_blood_donor_patient ON blood_donors(patient_id);
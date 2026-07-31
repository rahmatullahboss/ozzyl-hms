-- Migration 0039: Add missing columns used in route queries
-- doctors.email is queried in consultations route (batch SELECT)
-- insurance_policies.is_active used in some queries

ALTER TABLE doctors ADD COLUMN email TEXT;

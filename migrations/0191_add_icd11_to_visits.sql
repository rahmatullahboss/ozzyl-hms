-- Migration 0191: Add missing icd11_code and icd11_description columns to visits
-- Drizzle ORM generates INSERT with ALL schema columns, but these were missing from the actual DB
ALTER TABLE visits ADD COLUMN icd11_code TEXT;
ALTER TABLE visits ADD COLUMN icd11_description TEXT;

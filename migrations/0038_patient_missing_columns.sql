-- Migration 0038: Add missing columns to patients table
-- These columns are referenced in route queries but were missing from schema

ALTER TABLE patients ADD COLUMN date_of_birth TEXT;
ALTER TABLE patients ADD COLUMN nationality TEXT;
ALTER TABLE patients ADD COLUMN photo_url TEXT;
ALTER TABLE patients ADD COLUMN secondary_contact TEXT;
ALTER TABLE patients ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

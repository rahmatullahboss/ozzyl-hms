-- Migration 0040: Add missing columns to visits table
-- The emergency route inserts visit_date and status but these columns never existed

ALTER TABLE visits ADD COLUMN visit_date TEXT;
ALTER TABLE visits ADD COLUMN status TEXT DEFAULT 'initiated';

-- Add email and date_of_birth columns to patients table
ALTER TABLE patients ADD COLUMN email TEXT;
ALTER TABLE patients ADD COLUMN date_of_birth TEXT;

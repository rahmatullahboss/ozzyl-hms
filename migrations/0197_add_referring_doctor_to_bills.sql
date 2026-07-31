-- Migration: Add referring_doctor_id to bills
-- Description: Adds a reference to the doctor who referred the patient for this bill.

ALTER TABLE bills ADD COLUMN referring_doctor_id INTEGER;

-- Create an index for performance when querying bills by referring doctor
CREATE INDEX idx_bills_referring_doctor_id ON bills (referring_doctor_id);

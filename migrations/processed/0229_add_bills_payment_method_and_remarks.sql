-- Migration 0229: Add payment_method and remarks to bills table.
-- The appointment billing flow (pay-now, due-approval) writes these columns
-- but they were never added to the bills table schema.

ALTER TABLE bills ADD COLUMN payment_method TEXT
  CHECK (payment_method IN ('cash', 'card', 'mobile Banking', 'cheque', 'credit', 'digital_wallet', 'insURANCE'));

ALTER TABLE bills ADD COLUMN remarks TEXT;
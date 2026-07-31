-- Migration: Add approval workflow to credit notes
-- Adds status, approved_by, and approved_at columns
-- Existing credit notes default to 'approved' (already processed)

ALTER TABLE billing_credit_notes ADD COLUMN status TEXT DEFAULT 'approved';
ALTER TABLE billing_credit_notes ADD COLUMN approved_by INTEGER REFERENCES users(id);
ALTER TABLE billing_credit_notes ADD COLUMN approved_at TEXT;

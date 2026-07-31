-- Migration 0367: Add uploaded proof object metadata for bank deposit requests.

ALTER TABLE bank_deposit_requests ADD COLUMN deposit_proof_key TEXT;
ALTER TABLE bank_deposit_requests ADD COLUMN deposit_proof_uploaded_by INTEGER;
ALTER TABLE bank_deposit_requests ADD COLUMN deposit_proof_uploaded_at TEXT;

-- Migration 0366: Store bank deposit proof metadata for reception cash custody deposits.

ALTER TABLE bank_deposit_requests ADD COLUMN deposit_proof_url TEXT;
ALTER TABLE bank_deposit_requests ADD COLUMN deposit_proof_note TEXT;

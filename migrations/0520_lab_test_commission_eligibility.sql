-- Migration: 0520_lab_test_commission_eligibility.sql
-- Description: Add a prospective per-test commission opt-out while preserving the complete lab workflow.

ALTER TABLE lab_test_catalog ADD COLUMN is_commissionable INTEGER NOT NULL DEFAULT 1
  CHECK (is_commissionable IN (0, 1));

-- Cross Matching remains fully billable and operational, but does not create
-- prescriber, referral, verifier, or diagnostic performer payout obligations.
UPDATE lab_test_catalog
SET is_commissionable = 0
WHERE LOWER(REPLACE(REPLACE(TRIM(name), ' ', ''), '-', '')) IN ('crossmatching', 'crossmatch');

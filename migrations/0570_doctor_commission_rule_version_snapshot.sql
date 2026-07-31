-- Begin tracking legacy doctor commission rule revisions from this migration onward.
-- Existing accrual history intentionally remains without a version snapshot because
-- the prior in-place rule update history cannot be reconstructed safely.

ALTER TABLE doctor_commission_rules
  ADD COLUMN rule_version INTEGER NOT NULL DEFAULT 1
  CHECK (rule_version > 0);

ALTER TABLE doctor_commission_accruals
  ADD COLUMN commission_rule_version_snapshot INTEGER
  CHECK (commission_rule_version_snapshot IS NULL OR commission_rule_version_snapshot > 0);

ALTER TABLE doctor_commission_accruals
  ADD COLUMN commission_reason_code TEXT
  CHECK (
    commission_reason_code IS NULL OR commission_reason_code IN (
      'rule_matched',
      'no_matching_rule',
      'doctor_missing',
      'bill_unpaid',
      'cancelled',
      'refunded',
      'eligible_base_zero',
      'doctor_waived',
      'manual_adjustment',
      'reversal',
      'held_for_review'
    )
  );

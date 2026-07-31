-- Doctor/service-specific protected commission floors for legacy and canonical compensation ledgers.
-- Existing rules retain full-earned waiver behavior until explicitly configured otherwise.

ALTER TABLE doctor_commission_rules ADD COLUMN waiver_policy TEXT NOT NULL DEFAULT 'full_earned';
ALTER TABLE doctor_commission_rules ADD COLUMN protected_rate_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_rules ADD COLUMN protected_flat_amount REAL NOT NULL DEFAULT 0;

ALTER TABLE doctor_commission_accruals ADD COLUMN waiver_policy_snapshot TEXT NOT NULL DEFAULT 'full_earned';
ALTER TABLE doctor_commission_accruals ADD COLUMN protected_rate_bps_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN protected_flat_amount_snapshot REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN protected_commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN maximum_waiver_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN requested_waiver_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_accruals ADD COLUMN hospital_funded_overflow_amount REAL NOT NULL DEFAULT 0;

ALTER TABLE canonical_compensation_rules ADD COLUMN waiver_policy TEXT NOT NULL DEFAULT 'full_earned';
ALTER TABLE canonical_compensation_rules ADD COLUMN protected_rate_value INTEGER NOT NULL DEFAULT 0;

ALTER TABLE canonical_compensation_accruals ADD COLUMN protected_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canonical_compensation_accruals ADD COLUMN waiver_capacity_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canonical_compensation_accruals ADD COLUMN requested_waiver_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canonical_compensation_accruals ADD COLUMN hospital_funded_overflow_minor INTEGER NOT NULL DEFAULT 0;

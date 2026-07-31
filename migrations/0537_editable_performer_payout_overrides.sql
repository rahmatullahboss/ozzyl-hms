-- Migration: audited editable performer payout amounts.
-- Keeps calculated reserve/commission values immutable and stores final payout evidence per settlement line.

ALTER TABLE doctor_commission_settlement_items ADD COLUMN calculated_commission_amount REAL;
ALTER TABLE doctor_commission_settlement_items ADD COLUMN override_amount REAL;
ALTER TABLE doctor_commission_settlement_items ADD COLUMN override_reason TEXT;
ALTER TABLE doctor_commission_settlement_items ADD COLUMN overridden_by INTEGER;
ALTER TABLE doctor_commission_settlement_items ADD COLUMN overridden_at TEXT;

UPDATE doctor_commission_settlement_items
SET calculated_commission_amount = commission_amount
WHERE calculated_commission_amount IS NULL;

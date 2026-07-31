-- Normalize unpaid doctor commission accruals to avoid rounding fractional percentage commissions up.
-- Example: 25% of Tk 802 should remain Tk 200, not Tk 201.
-- Do not change already paid/settled/cancelled rows to preserve historical payouts.
UPDATE doctor_commission_accruals
SET commission_amount = CASE
  WHEN COALESCE(commission_rate_bps, 0) > 0
    THEN CAST((COALESCE(gross_amount, 0) * COALESCE(commission_rate_bps, 0)) / 10000 AS INTEGER)
  WHEN COALESCE(commission_flat_amount, 0) > 0
    THEN CAST(COALESCE(commission_flat_amount, 0) AS INTEGER)
  ELSE COALESCE(commission_amount, 0)
END,
updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(status, 'accrued') IN ('accrued', 'approved')
  AND COALESCE(settlement_id, 0) = 0
  AND (
    (COALESCE(commission_rate_bps, 0) > 0 AND commission_amount != CAST((COALESCE(gross_amount, 0) * COALESCE(commission_rate_bps, 0)) / 10000 AS INTEGER))
    OR (COALESCE(commission_rate_bps, 0) = 0 AND COALESCE(commission_flat_amount, 0) > 0 AND commission_amount != CAST(COALESCE(commission_flat_amount, 0) AS INTEGER))
  );

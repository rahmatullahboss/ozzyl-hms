-- Keep percentage-based doctor commissions at currency precision.
-- Previous logic floored every invoice line to a whole Taka, which made a configured
-- 25% rate appear as 24.95% after summing many test lines.
-- Only unsettled accruals with a real value difference are repaired here.
-- Paid/settled history and already-correct rows remain immutable.

WITH eligible AS (
  SELECT
    id,
    ROUND(
      (CASE
        WHEN COALESCE(commission_base_amount, 0) > 0 OR COALESCE(performer_reserve_amount, 0) > 0
          THEN COALESCE(commission_base_amount, 0)
        ELSE COALESCE(gross_amount, 0)
      END) * COALESCE(commission_rate_bps, 0) / 10000.0,
      2
    ) AS new_earned_commission_amount,
    COALESCE(doctor_waiver_amount, 0) AS doctor_waiver_amount,
    COALESCE(paid_amount, 0) AS paid_amount
  FROM doctor_commission_accruals
  WHERE COALESCE(commission_rate_bps, 0) > 0
    AND COALESCE(status, 'accrued') IN ('accrued', 'approved')
    AND COALESCE(settlement_id, 0) = 0
),
recalculated AS (
  SELECT
    id,
    new_earned_commission_amount,
    MAX(0, new_earned_commission_amount - doctor_waiver_amount) AS new_payable_commission_amount,
    MAX(
      0,
      MAX(0, new_earned_commission_amount - doctor_waiver_amount) - paid_amount
    ) AS new_balance_amount
  FROM eligible
)
UPDATE doctor_commission_accruals AS accrual
SET earned_commission_amount = recalculated.new_earned_commission_amount,
    payable_commission_amount = recalculated.new_payable_commission_amount,
    commission_amount = recalculated.new_payable_commission_amount,
    balance_amount = recalculated.new_balance_amount,
    updated_at = datetime('now', '+6 hours')
FROM recalculated
WHERE accrual.id = recalculated.id
  AND (
    ABS(COALESCE(accrual.earned_commission_amount, 0) - recalculated.new_earned_commission_amount) > 0.000001
    OR ABS(COALESCE(accrual.payable_commission_amount, 0) - recalculated.new_payable_commission_amount) > 0.000001
    OR ABS(COALESCE(accrual.commission_amount, 0) - recalculated.new_payable_commission_amount) > 0.000001
    OR ABS(COALESCE(accrual.balance_amount, 0) - recalculated.new_balance_amount) > 0.000001
  );

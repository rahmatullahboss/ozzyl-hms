-- Separate clinical ordering attribution from the user who entered the lab order.
-- `lab_orders.ordered_by` remains the entered-by/audit user identity.

ALTER TABLE lab_orders
ADD COLUMN ordering_clinician_doctor_id INTEGER;

-- Conservative historical backfill: map only when exactly one doctor profile in
-- the same tenant is linked to the entered-by user. Ambiguous or non-clinical
-- users remain unassigned.
UPDATE lab_orders
SET ordering_clinician_doctor_id = (
  SELECT MIN(d.id)
  FROM doctors d
  WHERE d.tenant_id = lab_orders.tenant_id
    AND d.user_id = lab_orders.ordered_by
)
WHERE ordering_clinician_doctor_id IS NULL
  AND ordered_by IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM doctors d
    WHERE d.tenant_id = lab_orders.tenant_id
      AND d.user_id = lab_orders.ordered_by
  ) = 1;

CREATE INDEX IF NOT EXISTS idx_lab_orders_ordering_clinician
ON lab_orders (tenant_id, ordering_clinician_doctor_id, order_date);

-- Runtime guards for IPD doctor-round provisional billing items.
-- Generic provisional cancellation must not mutate doctor_round charges directly;
-- the doctor-round service first cancels ipd_doctor_rounds, then cancels the linked item.

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provisional_doctor_round_ref
  ON billing_provisional_items(tenant_id, item_category, reference_id)
  WHERE item_category = 'doctor_round' AND reference_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_doctor_round_provisional_cancel_requires_round
BEFORE UPDATE OF bill_status ON billing_provisional_items
WHEN OLD.item_category = 'doctor_round'
  AND NEW.bill_status = 'cancelled'
  AND NOT EXISTS (
    SELECT 1
    FROM ipd_doctor_rounds r
    WHERE r.tenant_id = OLD.tenant_id
      AND r.id = OLD.reference_id
      AND r.status = 'cancelled'
  )
BEGIN
  SELECT RAISE(ABORT, 'Cancel doctor rounds through the doctor-round cancellation workflow');
END;

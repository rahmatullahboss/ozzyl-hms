-- Patient Care Hospital doctor-waiver correction for bill 6427 (2026-07-14).
--
-- Business rule:
--   1. Calculate the selected doctor's eligible percentage commission from the
--      pre-discount diagnostic gross amount, after any fixed performer reserve.
--   2. Deduct the explicit doctor-funded discount from that earned commission.
--   3. Preserve historical paid settlements and closed cash drawers. Any missing
--      amount is reopened as a separate unpaid correction accrual.

PRAGMA foreign_keys = ON;

-- The reserve payout itself was correct (BDT 200), but the stored service snapshot
-- deducted the invoice discount a second time. Repair metadata only; paid status,
-- settlement linkage, and payout amount remain unchanged.
UPDATE diagnostic_performer_reserves
SET unit_discount_amount = 0,
    net_unit_service_amount = 724,
    updated_at = datetime('now', '+6 hours')
WHERE tenant_id = '102'
  AND id = 17
  AND bill_id = 6427
  AND status = 'paid'
  AND reserved_amount = 200;

-- Correct aggregate for Dr. Example Three on bill 6427:
--   Gross diagnostic commission base after performer reserve = BDT 1,900
--   Earned at 25%                                      = BDT   475
--   Explicit doctor waiver                            = BDT   200
--   Correct payable                                   = BDT   275
-- Existing immutable paid accruals record earned 294, waiver 88, payable 206.
-- Therefore add earned 181, waiver 112, payable/balance 69 as one correction row.
INSERT INTO doctor_commission_accruals (
  tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id,
  source_type, incentive_type, gross_amount, commission_base_amount,
  performer_reserve_amount, commission_rule_id, commission_rate_bps,
  commission_flat_amount, commission_amount, earned_commission_amount,
  doctor_waiver_amount, payable_commission_amount, paid_amount, balance_amount,
  status, accrued_date, notes, created_by, created_at, updated_at
)
SELECT
  b.tenant_id, 130, b.patient_id, b.visit_id, b.id, NULL,
  'lab_test', 'prescriber', 724, 724,
  0,
  COALESCE((
    SELECT commission_rule_id
    FROM doctor_commission_accruals
    WHERE tenant_id = '102'
      AND bill_id = 6427
      AND doctor_id = 130
      AND commission_rule_id IS NOT NULL
    ORDER BY id ASC
    LIMIT 1
  ), 21),
  2500, 0,
  69.00, 181.00,
  112.00, 69.00, 0, 69.00,
  'accrued', '2026-07-14',
  'doctor-waiver-0506:bill-6427:gross-base-correction',
  NULL, datetime('now', '+6 hours'), datetime('now', '+6 hours')
FROM bills b
WHERE b.tenant_id = '102'
  AND b.id = 6427
  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  AND NOT EXISTS (
    SELECT 1
    FROM doctor_commission_accruals existing
    WHERE existing.tenant_id = '102'
      AND existing.notes = 'doctor-waiver-0506:bill-6427:gross-base-correction'
  );

-- Queue the new BDT 69 liability through the standard accounting outbox.
INSERT OR IGNORE INTO accounting_posting_events (
  tenant_id, source_event_key, source_type, source_id, event_type,
  event_date, payload_json, created_by
)
SELECT
  a.tenant_id,
  'doctor_commission_accrual:' || a.id || ':commission_accrued',
  'doctor_commission_accrual',
  CAST(a.id AS TEXT),
  'commission_accrued',
  a.accrued_date,
  json_object(
    'accrualId', a.id,
    'doctorId', a.doctor_id,
    'patientId', a.patient_id,
    'visitId', a.visit_id,
    'billId', a.bill_id,
    'commissionSourceType', a.source_type,
    'grossAmount', a.gross_amount,
    'amount', a.commission_amount
  ),
  'system:0506'
FROM doctor_commission_accruals a
WHERE a.tenant_id = '102'
  AND a.notes = 'doctor-waiver-0506:bill-6427:gross-base-correction';

INSERT INTO accounting_audit_logs (
  tenant_id, entity_type, entity_id, action, old_value, new_value, performed_by
)
SELECT
  '102', 'doctor_waiver_backfill', '0506', 'BACKFILL',
  json_object(
    'billId', 6427,
    'earnedCommission', 294,
    'doctorWaiver', 88,
    'payableCommission', 206
  ),
  json_object(
    'billId', 6427,
    'earnedCommission', 475,
    'doctorWaiver', 200,
    'payableCommission', 275,
    'correctionPayable', 69,
    'historicalSettlementChanged', 0,
    'cashDrawerChanged', 0
  ),
  'system:0506'
WHERE NOT EXISTS (
  SELECT 1
  FROM accounting_audit_logs
  WHERE tenant_id = '102'
    AND entity_type = 'doctor_waiver_backfill'
    AND entity_id = '0506'
    AND action = 'BACKFILL'
);

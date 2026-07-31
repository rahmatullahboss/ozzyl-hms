-- Patient Care Hospital performer-reserve repair for 2026-07-18.
-- Business rule:
--   1. A flat diagnostic performer reserve is payable in full even after full discount.
--   2. Referrer/prescriber percentage commission is calculated only from
--      MAX(0, post-discount service amount - performer reserve).
--   3. Historical paid settlements and closed cash drawers remain immutable.
--      Corrected reserves/commissions are reopened as unpaid payables.

PRAGMA foreign_keys = ON;

-- invoice_items.line_total is already post-discount. Repair the stored reserve
-- snapshots so reporting and future commission-base reconciliation do not deduct
-- the bill discount a second time.
UPDATE diagnostic_performer_reserves
SET unit_service_amount = COALESCE((
      SELECT ROUND(MAX(0, COALESCE(ii.line_total, 0) - COALESCE(ii.tax_amount, 0)), 2)
      FROM invoice_items ii
      WHERE ii.tenant_id = diagnostic_performer_reserves.tenant_id
        AND ii.id = diagnostic_performer_reserves.invoice_item_id
    ), unit_service_amount),
    unit_discount_amount = 0,
    net_unit_service_amount = COALESCE((
      SELECT ROUND(MAX(0, COALESCE(ii.line_total, 0) - COALESCE(ii.tax_amount, 0)), 2)
      FROM invoice_items ii
      WHERE ii.tenant_id = diagnostic_performer_reserves.tenant_id
        AND ii.id = diagnostic_performer_reserves.invoice_item_id
    ), net_unit_service_amount),
    updated_at = datetime('now', '+6 hours')
WHERE tenant_id = '102'
  AND id IN (41, 42, 43, 44, 45, 46);

-- Keep the old zero-value settlement/accrual rows as immutable history, but detach
-- them from the reserve identity so a corrected payable accrual can be generated.
UPDATE doctor_commission_accruals
SET performer_reserve_id = NULL,
    notes = CASE
      WHEN instr(COALESCE(notes, ''), 'superseded by performer reserve backfill 0505') > 0 THEN notes
      ELSE trim(COALESCE(notes, '') || ' | superseded by performer reserve backfill 0505')
    END,
    updated_at = datetime('now', '+6 hours')
WHERE tenant_id = '102'
  AND performer_reserve_id IN (42, 44, 45)
  AND COALESCE(commission_amount, 0) = 0
  AND status = 'paid';

-- Reopen the three incorrectly zero-paid reserves. Their original performer
-- assignment (Dr. Example One) is retained, but the old settlement/cash link is not.
UPDATE diagnostic_performer_reserves
SET reserved_amount = 200,
    status = 'reserved',
    commission_accrual_id = NULL,
    settlement_id = NULL,
    paid_at = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancel_reason = NULL,
    reversed_at = NULL,
    reversed_by = NULL,
    updated_at = datetime('now', '+6 hours')
WHERE tenant_id = '102'
  AND id IN (42, 44, 45)
  AND rule_rate_type = 'flat'
  AND rule_rate_value = 200
  AND COALESCE(reserved_amount, 0) = 0;

-- Paid history used line-level whole-Taka rounding and the doubly-discounted USG
-- base. Add exact currency-precision deltas as separate unpaid accruals.
INSERT INTO doctor_commission_accruals (
  tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id,
  source_type, incentive_type, gross_amount, commission_base_amount,
  performer_reserve_amount, commission_rule_id, commission_rate_bps,
  commission_flat_amount, commission_amount, earned_commission_amount,
  doctor_waiver_amount, payable_commission_amount, paid_amount, balance_amount,
  status, accrued_date, notes, created_by, created_at, updated_at
)
SELECT
  b.tenant_id, 136, b.patient_id, b.visit_id, b.id, NULL,
  'lab_test', 'prescriber', 116, 116,
  0, (SELECT commission_rule_id FROM doctor_commission_accruals WHERE tenant_id = '102' AND id = 2197), 2500,
  0, 29.00, 29.00,
  0, 29.00, 0, 29.00,
  'accrued', '2026-07-18', 'performer-reserve-0505:noorsali-lamia:29.00', NULL,
  datetime('now', '+6 hours'), datetime('now', '+6 hours')
FROM bills b
WHERE b.tenant_id = '102'
  AND b.id = 6613
  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  AND NOT EXISTS (
    SELECT 1 FROM doctor_commission_accruals a
    WHERE a.tenant_id = '102'
      AND a.notes = 'performer-reserve-0505:noorsali-lamia:29.00'
  );

INSERT INTO doctor_commission_accruals (
  tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id,
  source_type, incentive_type, gross_amount, commission_base_amount,
  performer_reserve_amount, commission_rule_id, commission_rate_bps,
  commission_flat_amount, commission_amount, earned_commission_amount,
  doctor_waiver_amount, payable_commission_amount, paid_amount, balance_amount,
  status, accrued_date, notes, created_by, created_at, updated_at
)
SELECT
  b.tenant_id, 136, b.patient_id, b.visit_id, b.id, NULL,
  'lab_test', 'prescriber', 150, 150,
  0, (SELECT commission_rule_id FROM doctor_commission_accruals WHERE tenant_id = '102' AND id = 2197), 2500,
  0, 37.50, 37.50,
  0, 37.50, 0, 37.50,
  'accrued', '2026-07-18', 'performer-reserve-0505:noorsali-tahmina:37.50', NULL,
  datetime('now', '+6 hours'), datetime('now', '+6 hours')
FROM bills b
WHERE b.tenant_id = '102'
  AND b.id = 6616
  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  AND NOT EXISTS (
    SELECT 1 FROM doctor_commission_accruals a
    WHERE a.tenant_id = '102'
      AND a.notes = 'performer-reserve-0505:noorsali-tahmina:37.50'
  );

INSERT INTO doctor_commission_accruals (
  tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id,
  source_type, incentive_type, gross_amount, commission_base_amount,
  performer_reserve_amount, commission_rule_id, commission_rate_bps,
  commission_flat_amount, commission_amount, earned_commission_amount,
  doctor_waiver_amount, payable_commission_amount, paid_amount, balance_amount,
  status, accrued_date, notes, created_by, created_at, updated_at
)
SELECT
  b.tenant_id, 136, b.patient_id, b.visit_id, b.id, NULL,
  'lab_test', 'prescriber', 150, 150,
  0, (SELECT commission_rule_id FROM doctor_commission_accruals WHERE tenant_id = '102' AND id = 2197), 2500,
  0, 37.50, 37.50,
  0, 37.50, 0, 37.50,
  'accrued', '2026-07-18', 'performer-reserve-0505:noorsali-nipa:37.50', NULL,
  datetime('now', '+6 hours'), datetime('now', '+6 hours')
FROM bills b
WHERE b.tenant_id = '102'
  AND b.id = 6617
  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  AND NOT EXISTS (
    SELECT 1 FROM doctor_commission_accruals a
    WHERE a.tenant_id = '102'
      AND a.notes = 'performer-reserve-0505:noorsali-nipa:37.50'
  );

INSERT INTO doctor_commission_accruals (
  tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id,
  source_type, incentive_type, gross_amount, commission_base_amount,
  performer_reserve_amount, commission_rule_id, commission_rate_bps,
  commission_flat_amount, commission_amount, earned_commission_amount,
  doctor_waiver_amount, payable_commission_amount, paid_amount, balance_amount,
  status, accrued_date, notes, created_by, created_at, updated_at
)
SELECT
  b.tenant_id, 143, b.patient_id, b.visit_id, b.id, NULL,
  'lab_test', 'prescriber', 68, 68,
  0, (SELECT commission_rule_id FROM doctor_commission_accruals WHERE tenant_id = '102' AND id = 2204), 2500,
  0, 17.00, 17.00,
  0, 17.00, 0, 17.00,
  'accrued', '2026-07-18', 'performer-reserve-0505:farhana-halima:17.00', NULL,
  datetime('now', '+6 hours'), datetime('now', '+6 hours')
FROM bills b
WHERE b.tenant_id = '102'
  AND b.id = 6619
  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  AND NOT EXISTS (
    SELECT 1 FROM doctor_commission_accruals a
    WHERE a.tenant_id = '102'
      AND a.notes = 'performer-reserve-0505:farhana-halima:17.00'
  );

-- Use the standard accounting outbox contract. Existing commission-accrual events
-- are normally pending until the accounting poster processes them.
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
  'system:0505'
FROM doctor_commission_accruals a
WHERE a.tenant_id = '102'
  AND a.notes IN (
    'performer-reserve-0505:noorsali-lamia:29.00',
    'performer-reserve-0505:noorsali-tahmina:37.50',
    'performer-reserve-0505:noorsali-nipa:37.50',
    'performer-reserve-0505:farhana-halima:17.00'
  );

-- Immutable audit evidence, including the prior BDT 2.50 overpayment that must be
-- treated as an absorbed historical rounding variance unless explicitly deducted
-- from a future Abdul Khaleq settlement.
INSERT INTO accounting_audit_logs (
  tenant_id, entity_type, entity_id, action, old_value, new_value, performed_by
)
SELECT
  '102', 'performer_reserve_backfill', '0505', 'BACKFILL',
  json_object('zeroPaidReserveIds', json_array(42, 44, 45)),
  json_object(
    'reopenedReserveAmount', 600,
    'pendingUnassignedReserveId', 43,
    'pendingUnassignedReserveAmount', 200,
    'commissionCorrectionAmount', 121,
    'existingFarhanaVisitPayable', 500,
    'abdulHistoricalOverpayment', 2.50,
    'cashDrawerChanged', 0
  ),
  'system:0505'
WHERE NOT EXISTS (
  SELECT 1 FROM accounting_audit_logs
  WHERE tenant_id = '102'
    AND entity_type = 'performer_reserve_backfill'
    AND entity_id = '0505'
    AND action = 'BACKFILL'
);

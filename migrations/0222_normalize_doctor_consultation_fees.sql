-- Normalize legacy doctor consultation fees that were stored in minor units
-- (for example, 500 taka as 50000). Posted vouchers are not edited; where
-- pre-live demo bills/payments had already posted, this migration creates
-- pending manual-journal adjustment events that the accounting posting worker
-- can post as immutable correction vouchers.

DROP TABLE IF EXISTS migration_0222_doctor_fee_bill_totals;

CREATE TABLE migration_0222_doctor_fee_bill_totals AS
SELECT
  b.id AS bill_id,
  b.tenant_id,
  COALESCE((
    SELECT SUM(ii.line_total)
    FROM invoice_items ii
    WHERE ii.bill_id = b.id
      AND COALESCE(ii.status, 'active') = 'active'
  ), 0) AS old_item_total,
  COALESCE((
    SELECT SUM(
      CASE
        WHEN ii.item_category = 'doctor_visit'
          AND ii.unit_price >= 10000
          AND CAST(ii.unit_price AS INTEGER) % 100 = 0
          AND ii.line_total >= 10000
          AND CAST(ii.line_total AS INTEGER) % 100 = 0
        THEN CAST(ROUND(ii.line_total / 100.0) AS INTEGER)
        ELSE ii.line_total
      END
    )
    FROM invoice_items ii
    WHERE ii.bill_id = b.id
      AND COALESCE(ii.status, 'active') = 'active'
  ), 0) AS new_item_total,
  COALESCE((
    SELECT SUM(
      CASE
        WHEN ii.unit_price >= 10000
          AND CAST(ii.unit_price AS INTEGER) % 100 = 0
          AND ii.line_total >= 10000
          AND CAST(ii.line_total AS INTEGER) % 100 = 0
        THEN CAST(ROUND(ii.line_total / 100.0) AS INTEGER)
        ELSE ii.line_total
      END
    )
    FROM invoice_items ii
    WHERE ii.bill_id = b.id
      AND ii.item_category = 'doctor_visit'
      AND COALESCE(ii.status, 'active') = 'active'
  ), 0) AS new_doctor_visit_total,
  COALESCE((
    SELECT SUM(p.amount)
    FROM payments p
    WHERE p.bill_id = b.id
  ), 0) AS old_payment_total,
  COALESCE((
    SELECT SUM(
      CASE
        WHEN p.amount >= 10000
          AND CAST(p.amount AS INTEGER) % 100 = 0
        THEN ROUND(p.amount / 100.0, 2)
        ELSE p.amount
      END
    )
    FROM payments p
    WHERE p.bill_id = b.id
  ), 0) AS new_payment_total
FROM bills b
WHERE EXISTS (
  SELECT 1
  FROM invoice_items ii
  WHERE ii.bill_id = b.id
    AND ii.item_category = 'doctor_visit'
    AND COALESCE(ii.status, 'active') = 'active'
    AND ii.unit_price >= 10000
    AND CAST(ii.unit_price AS INTEGER) % 100 = 0
    AND ii.line_total >= 10000
    AND CAST(ii.line_total AS INTEGER) % 100 = 0
);

INSERT OR IGNORE INTO accounting_posting_events
  (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
SELECT
  totals.tenant_id,
  'doctor_fee_normalization:bill-' || totals.bill_id || ':manual_journal',
  'doctor_fee_normalization',
  'bill-' || totals.bill_id,
  'manual_journal',
  voucher.entry_date,
  json_object(
    'lines',
    json_array(
      json_object(
        'accountId', revenue_line.account_id,
        'debit', ROUND(totals.old_item_total - totals.new_item_total, 2),
        'credit', 0,
        'memo', 'Normalize legacy doctor consultation fee revenue'
      ),
      json_object(
        'accountId', receivable_line.account_id,
        'debit', 0,
        'credit', ROUND(totals.old_item_total - totals.new_item_total, 2),
        'memo', 'Normalize legacy doctor consultation fee receivable'
      )
    )
  ),
  'migration-0222'
FROM migration_0222_doctor_fee_bill_totals totals
JOIN accounting_vouchers voucher
  ON voucher.tenant_id = totals.tenant_id
 AND voucher.source_type = 'billing'
 AND voucher.source_id = CAST(totals.bill_id AS TEXT)
 AND voucher.event_type = 'bill_created'
JOIN accounting_journal_lines receivable_line
  ON receivable_line.voucher_id = voucher.id
 AND receivable_line.debit_amount > 0
JOIN accounting_journal_lines revenue_line
  ON revenue_line.voucher_id = voucher.id
 AND revenue_line.credit_amount > 0
WHERE ROUND(totals.old_item_total - totals.new_item_total, 2) > 0;

INSERT OR IGNORE INTO accounting_posting_events
  (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
SELECT
  p.tenant_id,
  'doctor_fee_normalization:payment-' || p.receipt_no || ':manual_journal',
  'doctor_fee_normalization',
  'payment-' || p.receipt_no,
  'manual_journal',
  voucher.entry_date,
  json_object(
    'lines',
    json_array(
      json_object(
        'accountId', receivable_line.account_id,
        'debit', ROUND(p.amount - ROUND(p.amount / 100.0, 2), 2),
        'credit', 0,
        'memo', 'Normalize legacy consultation payment receivable'
      ),
      json_object(
        'accountId', cash_line.account_id,
        'debit', 0,
        'credit', ROUND(p.amount - ROUND(p.amount / 100.0, 2), 2),
        'memo', 'Normalize legacy consultation cash receipt'
      )
    )
  ),
  'migration-0222'
FROM payments p
JOIN migration_0222_doctor_fee_bill_totals totals
  ON totals.bill_id = p.bill_id
JOIN accounting_vouchers voucher
  ON voucher.tenant_id = p.tenant_id
 AND voucher.source_type = 'payment'
 AND voucher.source_id = p.receipt_no
 AND voucher.event_type = 'payment_received'
JOIN accounting_journal_lines cash_line
  ON cash_line.voucher_id = voucher.id
 AND cash_line.debit_amount > 0
JOIN accounting_journal_lines receivable_line
  ON receivable_line.voucher_id = voucher.id
 AND receivable_line.credit_amount > 0
WHERE p.amount >= 10000
  AND CAST(p.amount AS INTEGER) % 100 = 0
  AND p.receipt_no IS NOT NULL
  AND ROUND(p.amount - ROUND(p.amount / 100.0, 2), 2) > 0;

UPDATE doctors
SET consultation_fee = CAST(ROUND(consultation_fee / 100.0) AS INTEGER),
    updated_at = datetime('now', '+6 hours')
WHERE consultation_fee >= 10000
  AND CAST(consultation_fee AS INTEGER) % 100 = 0;

UPDATE appointments
SET fee = CAST(ROUND(fee / 100.0) AS INTEGER),
    updated_at = datetime('now', '+6 hours')
WHERE fee >= 10000
  AND CAST(fee AS INTEGER) % 100 = 0;

UPDATE marketplace_bookings
SET fee = CAST(ROUND(fee / 100.0) AS INTEGER),
    updated_at = datetime('now', '+6 hours')
WHERE fee >= 10000
  AND CAST(fee AS INTEGER) % 100 = 0;

UPDATE visit_services
SET amount = ROUND(amount / 100.0, 2),
    total_amount = ROUND(total_amount / 100.0, 2),
    updated_at = datetime('now', '+6 hours')
WHERE service_type = 'doctor_visit'
  AND status = 'pending'
  AND bill_id IS NULL
  AND amount >= 10000
  AND CAST(amount AS INTEGER) % 100 = 0
  AND total_amount >= 10000
  AND CAST(total_amount AS INTEGER) % 100 = 0;

UPDATE invoice_items
SET unit_price = CAST(ROUND(unit_price / 100.0) AS INTEGER),
    line_total = CAST(ROUND(line_total / 100.0) AS INTEGER)
WHERE item_category = 'doctor_visit'
  AND COALESCE(status, 'active') = 'active'
  AND unit_price >= 10000
  AND CAST(unit_price AS INTEGER) % 100 = 0
  AND line_total >= 10000
  AND CAST(line_total AS INTEGER) % 100 = 0;

UPDATE payments
SET amount = ROUND(amount / 100.0, 2)
WHERE bill_id IN (SELECT bill_id FROM migration_0222_doctor_fee_bill_totals)
  AND amount >= 10000
  AND CAST(amount AS INTEGER) % 100 = 0;

UPDATE bills
SET subtotal = (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
    total_amount = MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0)),
    paid_amount = MIN(
      (SELECT new_payment_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
      MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0))
    ),
    total = MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0)),
    paid = MIN(
      (SELECT new_payment_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
      MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0))
    ),
    due = MAX(
      0,
      MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0))
      - MIN(
        (SELECT new_payment_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
        MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0))
      )
    ),
    doctor_visit_bill = (SELECT new_doctor_visit_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
    status = CASE
      WHEN MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0)) <= 0 THEN 'paid'
      WHEN MIN(
        (SELECT new_payment_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
        MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0))
      ) >= MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0)) THEN 'paid'
      WHEN MIN(
        (SELECT new_payment_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id),
        MAX(0, (SELECT new_item_total FROM migration_0222_doctor_fee_bill_totals totals WHERE totals.bill_id = bills.id) - COALESCE(discount, 0))
      ) > 0 THEN 'partially_paid'
      ELSE 'open'
    END,
    updated_at = datetime('now', '+6 hours')
WHERE id IN (SELECT bill_id FROM migration_0222_doctor_fee_bill_totals);

DROP TABLE IF EXISTS migration_0222_doctor_fee_bill_totals;

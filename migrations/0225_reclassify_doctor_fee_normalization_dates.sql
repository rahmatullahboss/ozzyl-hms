-- Reclassify doctor-fee normalization adjustment vouchers out of the migration
-- run date. Posted vouchers are not edited or deleted. Instead, this creates
-- pending manual-journal events that reverse the run-date adjustment and repost
-- the same correction on the original bill/payment accounting date.

INSERT OR IGNORE INTO accounting_posting_events
  (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
SELECT
  orig.tenant_id,
  'doctor_fee_normalization_reclass:reverse-voucher-' || orig.id || ':manual_journal',
  'doctor_fee_normalization_reclass',
  'reverse-voucher-' || orig.id,
  'manual_journal',
  date('now', '+6 hours'),
  (
    SELECT json_object(
      'lines',
      json_group_array(
        json_object(
          'accountId', ordered.account_id,
          'debit', ordered.credit_amount,
          'credit', ordered.debit_amount,
          'memo', 'Reverse run-date doctor fee normalization adjustment'
        )
      )
    )
    FROM (
      SELECT account_id, debit_amount, credit_amount
      FROM accounting_journal_lines
      WHERE voucher_id = orig.id
      ORDER BY line_no
    ) ordered
  ),
  'migration-0225'
FROM accounting_vouchers orig
LEFT JOIN accounting_vouchers source_voucher
  ON source_voucher.tenant_id = orig.tenant_id
 AND (
   (
     orig.source_id LIKE 'bill-%'
     AND source_voucher.source_type = 'billing'
     AND source_voucher.event_type = 'bill_created'
     AND source_voucher.source_id = substr(orig.source_id, 6)
   )
   OR (
     orig.source_id LIKE 'payment-%'
     AND source_voucher.source_type = 'payment'
     AND source_voucher.event_type = 'payment_received'
     AND source_voucher.source_id = substr(orig.source_id, 9)
   )
 )
WHERE orig.source_type = 'doctor_fee_normalization'
  AND orig.event_type = 'manual_journal'
  AND source_voucher.id IS NOT NULL
  AND source_voucher.entry_date <> orig.entry_date;

INSERT OR IGNORE INTO accounting_posting_events
  (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
SELECT
  orig.tenant_id,
  'doctor_fee_normalization_reclass:repost-voucher-' || orig.id || ':manual_journal',
  'doctor_fee_normalization_reclass',
  'repost-voucher-' || orig.id,
  'manual_journal',
  COALESCE(source_voucher.entry_date, date(orig.entry_date)),
  (
    SELECT json_object(
      'lines',
      json_group_array(
        json_object(
          'accountId', ordered.account_id,
          'debit', ordered.debit_amount,
          'credit', ordered.credit_amount,
          'memo', 'Repost doctor fee normalization adjustment on source date'
        )
      )
    )
    FROM (
      SELECT account_id, debit_amount, credit_amount
      FROM accounting_journal_lines
      WHERE voucher_id = orig.id
      ORDER BY line_no
    ) ordered
  ),
  'migration-0225'
FROM accounting_vouchers orig
LEFT JOIN accounting_vouchers source_voucher
  ON source_voucher.tenant_id = orig.tenant_id
 AND (
   (
     orig.source_id LIKE 'bill-%'
     AND source_voucher.source_type = 'billing'
     AND source_voucher.event_type = 'bill_created'
     AND source_voucher.source_id = substr(orig.source_id, 6)
   )
   OR (
     orig.source_id LIKE 'payment-%'
     AND source_voucher.source_type = 'payment'
     AND source_voucher.event_type = 'payment_received'
     AND source_voucher.source_id = substr(orig.source_id, 9)
   )
 )
WHERE orig.source_type = 'doctor_fee_normalization'
  AND orig.event_type = 'manual_journal'
  AND source_voucher.id IS NOT NULL
  AND source_voucher.entry_date <> orig.entry_date;

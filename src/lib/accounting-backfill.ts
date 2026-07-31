import type { D1Database } from '@cloudflare/workers-types';
import { ACCOUNTING_EVENT_TYPES } from './accounting-posting';

export interface AccountingBackfillResult {
  bills: number;
  payments: number;
  legacyBillPayments: number;
  deposits: number;
  depositAdjustments: number;
  depositRefunds: number;
  creditNotes: number;
  supplierPayments: number;
  settlementDiscounts: number;
  doctorCommissions: number;
}

async function runInsert(db: D1Database, sql: string, params: unknown[]): Promise<number> {
  const result = await db.prepare(sql).bind(...params).run();
  return Number(result.meta?.changes ?? 0);
}

export async function backfillAccountingPostingEvents(
  db: D1Database,
  tenantId: string,
  createdBy: string,
): Promise<AccountingBackfillResult> {
  const bills = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(b.tenant_id AS TEXT),
      'billing:' || b.id || ':${ACCOUNTING_EVENT_TYPES.billCreated}',
      'billing',
      CAST(b.id AS TEXT),
      '${ACCOUNTING_EVENT_TYPES.billCreated}',
      substr(COALESCE(b.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'billId', b.id,
        'invoiceNo', COALESCE(b.invoice_no, b.invoice_code || '-' || b.id),
        'patientId', b.patient_id,
        'visitId', b.visit_id,
        'branchId', b.branch_id,
        'total', ROUND(COALESCE(NULLIF(b.total, 0), b.total_amount, 0), 2),
        'discount', ROUND(COALESCE(b.discount, 0), 2),
        'testBill', ROUND(COALESCE(b.test_bill, 0), 2),
        'doctorVisitBill', ROUND(COALESCE(b.doctor_visit_bill, 0), 2),
        'admissionBill', ROUND(COALESCE(b.admission_bill, 0), 2),
        'operationBill', ROUND(COALESCE(b.operation_bill, 0), 2),
        'medicineBill', ROUND(COALESCE(b.medicine_bill, 0), 2)
      ),
      CAST(COALESCE(b.created_by, ?) AS TEXT)
    FROM bills b
    WHERE CAST(b.tenant_id AS TEXT) = ?
      AND COALESCE(NULLIF(b.total, 0), b.total_amount, 0) > 0
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'draft')
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(b.tenant_id AS TEXT)
          AND v.source_type = 'billing'
          AND CAST(v.source_id AS REAL) = CAST(b.id AS REAL)
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.billCreated}'
      )
  `, [createdBy, tenantId]);

  const payments = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(p.tenant_id AS TEXT),
      'payment:' || COALESCE(p.receipt_no, 'PAY-' || p.id) || ':${ACCOUNTING_EVENT_TYPES.paymentReceived}',
      'payment',
      COALESCE(p.receipt_no, 'PAY-' || p.id),
      '${ACCOUNTING_EVENT_TYPES.paymentReceived}',
      substr(COALESCE(p.date, p.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'paymentId', p.id,
        'billId', p.bill_id,
        'receiptNo', COALESCE(p.receipt_no, 'PAY-' || p.id),
        'patientId', b.patient_id,
        'branchId', b.branch_id,
        'amount', ROUND(COALESCE(p.amount, 0), 2),
        'paymentMethod', COALESCE(p.payment_method, p.payment_type, 'cash'),
        'paymentType', COALESCE(p.type, p.payment_type, 'current')
      ),
      CAST(COALESCE(p.received_by, ?) AS TEXT)
    FROM payments p
    LEFT JOIN bills b ON b.id = p.bill_id AND CAST(b.tenant_id AS TEXT) = CAST(p.tenant_id AS TEXT)
    WHERE CAST(p.tenant_id AS TEXT) = ?
      AND COALESCE(p.amount, 0) > 0
      AND LOWER(COALESCE(p.payment_method, p.payment_type, '')) <> 'deposit'
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(p.tenant_id AS TEXT)
          AND v.source_type = 'payment'
          AND v.source_id = COALESCE(p.receipt_no, 'PAY-' || p.id)
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.paymentReceived}'
      )
  `, [createdBy, tenantId]);

  const legacyBillPayments = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    WITH payment_totals AS (
      SELECT CAST(tenant_id AS TEXT) AS tenant_id, bill_id, SUM(COALESCE(amount, 0)) AS paid_amount
      FROM payments
      WHERE CAST(tenant_id AS TEXT) = ?
      GROUP BY CAST(tenant_id AS TEXT), bill_id
    ),
    settlement_discounts AS (
      SELECT
        CAST(b.tenant_id AS TEXT) AS tenant_id,
        b.id AS bill_id,
        SUM(COALESCE(s.discount_amount, 0)) AS discount_amount
      FROM bills b
      JOIN billing_settlements s
        ON s.id = b.settlement_id
        AND CAST(s.tenant_id AS TEXT) = CAST(b.tenant_id AS TEXT)
        AND s.is_active = 1
      WHERE CAST(b.tenant_id AS TEXT) = ?
      GROUP BY CAST(b.tenant_id AS TEXT), b.id
    )
    SELECT
      CAST(b.tenant_id AS TEXT),
      'payment:LEGACY-BILL-' || b.id || '-PAID:${ACCOUNTING_EVENT_TYPES.paymentReceived}',
      'payment',
      'LEGACY-BILL-' || b.id || '-PAID',
      '${ACCOUNTING_EVENT_TYPES.paymentReceived}',
      substr(COALESCE(b.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'billId', b.id,
        'receiptNo', 'LEGACY-BILL-' || b.id || '-PAID',
        'patientId', b.patient_id,
        'branchId', b.branch_id,
        'amount', ROUND(COALESCE(NULLIF(b.paid, 0), b.paid_amount, 0) - COALESCE(pt.paid_amount, 0) - COALESCE(sd.discount_amount, 0), 2),
        'paymentMethod', 'cash',
        'paymentType', 'legacy_paid_balance',
        'backfillSource', 'bills.paid'
      ),
      CAST(COALESCE(b.created_by, ?) AS TEXT)
    FROM bills b
    LEFT JOIN payment_totals pt
      ON pt.tenant_id = CAST(b.tenant_id AS TEXT)
      AND pt.bill_id = b.id
    LEFT JOIN settlement_discounts sd
      ON sd.tenant_id = CAST(b.tenant_id AS TEXT)
      AND sd.bill_id = b.id
    WHERE CAST(b.tenant_id AS TEXT) = ?
      AND COALESCE(NULLIF(b.paid, 0), b.paid_amount, 0) - COALESCE(pt.paid_amount, 0) - COALESCE(sd.discount_amount, 0) > 0
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'draft')
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(b.tenant_id AS TEXT)
          AND v.source_type = 'payment'
          AND v.source_id = 'LEGACY-BILL-' || b.id || '-PAID'
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.paymentReceived}'
      )
  `, [tenantId, tenantId, createdBy, tenantId]);

  const deposits = await runDepositBackfill(db, tenantId, createdBy, 'deposit', 'patient_deposit', ACCOUNTING_EVENT_TYPES.patientDepositReceived);
  const depositAdjustments = await runDepositBackfill(db, tenantId, createdBy, 'adjustment', 'patient_deposit_adjustment', ACCOUNTING_EVENT_TYPES.patientDepositAdjusted);
  const depositRefunds = await runDepositBackfill(db, tenantId, createdBy, 'refund', 'patient_deposit_refund', ACCOUNTING_EVENT_TYPES.patientDepositRefunded);

  const creditNotes = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(cn.tenant_id AS TEXT),
      'credit_note:' || cn.id || ':${ACCOUNTING_EVENT_TYPES.creditNoteIssued}',
      'credit_note',
      CAST(cn.id AS TEXT),
      '${ACCOUNTING_EVENT_TYPES.creditNoteIssued}',
      substr(COALESCE(cn.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'creditNoteId', cn.id,
        'creditNoteNo', cn.credit_note_no,
        'billId', cn.bill_id,
        'patientId', cn.patient_id,
        'total', ROUND(COALESCE(cn.total_amount, 0), 2),
        'testBill', 0,
        'doctorVisitBill', 0,
        'admissionBill', 0,
        'operationBill', 0,
        'medicineBill', 0,
        'receivableReduction', ROUND(MAX(COALESCE(cn.total_amount, 0) - COALESCE(cn.refund_amount, 0), 0), 2),
        'cashRefund', ROUND(COALESCE(cn.refund_amount, 0), 2),
        'paymentMethod', COALESCE(cn.payment_mode, 'cash')
      ),
      CAST(COALESCE(cn.created_by, ?) AS TEXT)
    FROM billing_credit_notes cn
    WHERE CAST(cn.tenant_id AS TEXT) = ?
      AND cn.is_active = 1
      AND COALESCE(cn.total_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(cn.tenant_id AS TEXT)
          AND v.source_type = 'credit_note'
          AND v.source_id = CAST(cn.id AS TEXT)
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.creditNoteIssued}'
      )
  `, [createdBy, tenantId]);

  const supplierPayments = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(p.tenant_id AS TEXT),
      'vendor_payment:' || p.id || ':${ACCOUNTING_EVENT_TYPES.supplierPayment}',
      'vendor_payment',
      CAST(p.id AS TEXT),
      '${ACCOUNTING_EVENT_TYPES.supplierPayment}',
      p.payment_date,
      json_object(
        'paymentId', p.id,
        'vendorId', p.vendor_id,
        'supplierId', p.vendor_id,
        'goodsReceiptId', p.goods_receipt_id,
        'amount', ROUND(COALESCE(p.paid_amount, 0), 2),
        'paymentMethod', COALESCE(p.payment_mode, 'cash')
      ),
      CAST(COALESCE(p.created_by, ?) AS TEXT)
    FROM accounting_vendor_payments p
    WHERE CAST(p.tenant_id AS TEXT) = ?
      AND p.status = 'posted'
      AND COALESCE(p.paid_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(p.tenant_id AS TEXT)
          AND v.source_type = 'vendor_payment'
          AND v.source_id = CAST(p.id AS TEXT)
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.supplierPayment}'
      )
  `, [createdBy, tenantId]);

  const settlementDiscounts = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(s.tenant_id AS TEXT),
      'settlement_discount:' || s.settlement_receipt_no || '-DISC-' || s.id || ':${ACCOUNTING_EVENT_TYPES.settlementDiscount}',
      'settlement_discount',
      s.settlement_receipt_no || '-DISC-' || s.id,
      '${ACCOUNTING_EVENT_TYPES.settlementDiscount}',
      substr(COALESCE(s.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'settlementId', s.id,
        'receiptNo', s.settlement_receipt_no || '-DISC-' || s.id,
        'patientId', s.patient_id,
        'amount', ROUND(COALESCE(s.discount_amount, 0), 2)
      ),
      CAST(COALESCE(s.created_by, ?) AS TEXT)
    FROM billing_settlements s
    WHERE CAST(s.tenant_id AS TEXT) = ?
      AND s.is_active = 1
      AND COALESCE(s.discount_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(s.tenant_id AS TEXT)
          AND v.source_type = 'settlement_discount'
          AND v.source_id = s.settlement_receipt_no || '-DISC-' || s.id
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.settlementDiscount}'
      )
  `, [createdBy, tenantId]);

  const doctorCommissions = await runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(a.tenant_id AS TEXT),
      'doctor_commission_accrual:' || a.id || ':${ACCOUNTING_EVENT_TYPES.commissionAccrued}',
      'doctor_commission_accrual',
      CAST(a.id AS TEXT),
      '${ACCOUNTING_EVENT_TYPES.commissionAccrued}',
      substr(COALESCE(a.accrued_date, a.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'accrualId', a.id,
        'doctorId', a.doctor_id,
        'patientId', a.patient_id,
        'visitId', a.visit_id,
        'billId', a.bill_id,
        'commissionSourceType', a.source_type,
        'grossAmount', ROUND(COALESCE(a.gross_amount, 0), 2),
        'amount', ROUND(COALESCE(a.commission_amount, 0), 2)
      ),
      CAST(COALESCE(a.created_by, ?) AS TEXT)
    FROM doctor_commission_accruals a
    WHERE CAST(a.tenant_id AS TEXT) = ?
      AND COALESCE(a.status, 'accrued') NOT IN ('cancelled', 'void')
      AND COALESCE(a.commission_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(a.tenant_id AS TEXT)
          AND v.source_type = 'doctor_commission_accrual'
          AND CAST(v.source_id AS REAL) = CAST(a.id AS REAL)
          AND v.event_type = '${ACCOUNTING_EVENT_TYPES.commissionAccrued}'
      )
  `, [createdBy, tenantId]);

  return {
    bills,
    payments,
    legacyBillPayments,
    deposits,
    depositAdjustments,
    depositRefunds,
    creditNotes,
    supplierPayments,
    settlementDiscounts,
    doctorCommissions,
  };
}

async function runDepositBackfill(
  db: D1Database,
  tenantId: string,
  createdBy: string,
  transactionType: string,
  sourceType: string,
  eventType: string,
): Promise<number> {
  const sourceEventKeySql = `'${sourceType}:' || d.deposit_receipt_no || ':${eventType}'`;

  return runInsert(db, `
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT
      CAST(d.tenant_id AS TEXT),
      ${sourceEventKeySql},
      '${sourceType}',
      d.deposit_receipt_no,
      '${eventType}',
      substr(COALESCE(d.created_at, datetime('now', '+6 hours')), 1, 10),
      json_object(
        'receiptNo', d.deposit_receipt_no,
        'referenceBillId', d.reference_bill_id,
        'patientId', d.patient_id,
        'amount', ROUND(COALESCE(d.amount, 0), 2),
        'paymentMethod', COALESCE(d.payment_method, 'cash')
      ),
      CAST(COALESCE(d.created_by, ?) AS TEXT)
    FROM billing_deposits d
    WHERE CAST(d.tenant_id AS TEXT) = ?
      AND d.is_active = 1
      AND d.transaction_type = ?
      AND COALESCE(d.amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM accounting_vouchers v
        WHERE v.tenant_id = CAST(d.tenant_id AS TEXT)
          AND v.source_type = '${sourceType}'
          AND v.source_id = d.deposit_receipt_no
          AND v.event_type = '${eventType}'
      )
  `, [createdBy, tenantId, transactionType]);
}

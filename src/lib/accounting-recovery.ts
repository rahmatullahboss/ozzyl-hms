import type { D1Database } from '@cloudflare/workers-types';
import { ACCOUNTING_EVENT_TYPES, createPostingEventKey } from './accounting-posting';

export const DEFAULT_ACCOUNTING_EVENT_MAX_ATTEMPTS = 5;

export interface PartialAccountingVoucherRow {
  voucherId: number;
  voucherNumber: string | null;
  sourceEventKey: string;
  eventStatus: string | null;
  lineCount: number;
  totalDebit: number;
  totalCredit: number;
}

export interface MissingBillAccountingEventRow {
  billId: number;
  invoiceNo: string | null;
  patientId: number;
  visitId: number | null;
  createdBy: string | number | null;
  eventDate: string;
  subtotal: number;
  discount: number;
  total: number;
  testBill: number;
  doctorVisitBill: number;
  admissionBill: number;
  operationBill: number;
  medicineBill: number;
  counterId: number | null;
  counterSessionId: number | null;
}

export interface RepairBillsMissingAccountingEventsResult {
  scanned: number;
  inserted: number;
  sourceEventKeys: string[];
}

function toMoney(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function findPartialAccountingVouchers(
  db: D1Database,
  tenantId: string,
  limit = 50,
): Promise<PartialAccountingVoucherRow[]> {
  const { results } = await db.prepare(`
    SELECT
      v.id AS voucher_id,
      v.voucher_number,
      v.source_event_key,
      e.status AS event_status,
      COUNT(jl.id) AS line_count,
      COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
      COALESCE(SUM(jl.credit_amount), 0) AS total_credit
    FROM accounting_vouchers v
    LEFT JOIN accounting_journal_lines jl
      ON jl.voucher_id = v.id
     AND jl.tenant_id = v.tenant_id
    LEFT JOIN accounting_posting_events e
      ON e.tenant_id = v.tenant_id
     AND e.source_event_key = v.source_event_key
    WHERE v.tenant_id = ?
      AND v.source_event_key IS NOT NULL
    GROUP BY v.id, v.voucher_number, v.source_event_key, e.status
    HAVING COUNT(jl.id) < 2
        OR ABS(COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0)) >= 0.01
        OR COALESCE(e.status, 'missing') != 'posted'
    ORDER BY v.id DESC
    LIMIT ?
  `).bind(tenantId, limit).all<any>();

  return (results ?? []).map((row) => ({
    voucherId: Number(row.voucher_id),
    voucherNumber: row.voucher_number ?? null,
    sourceEventKey: String(row.source_event_key),
    eventStatus: row.event_status ?? null,
    lineCount: Number(row.line_count || 0),
    totalDebit: toMoney(row.total_debit),
    totalCredit: toMoney(row.total_credit),
  }));
}

export async function findBillsMissingAccountingEvents(
  db: D1Database,
  tenantId: string,
  limit = 50,
): Promise<MissingBillAccountingEventRow[]> {
  const { results } = await db.prepare(`
    SELECT
      b.id AS bill_id,
      b.invoice_no,
      b.patient_id,
      b.visit_id,
      b.created_by,
      COALESCE(date(b.created_at), date('now', '+6 hours')) AS event_date,
      COALESCE(b.subtotal, 0) AS subtotal,
      COALESCE(b.discount, 0) AS discount,
      COALESCE(b.total, 0) AS total,
      COALESCE(b.test_bill, 0) AS test_bill,
      COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
      COALESCE(b.admission_bill, 0) AS admission_bill,
      COALESCE(b.operation_bill, 0) AS operation_bill,
      COALESCE(b.medicine_bill, 0) AS medicine_bill,
      b.counter_id,
      b.counter_session_id
    FROM bills b
    LEFT JOIN accounting_posting_events e
      ON e.tenant_id = b.tenant_id
     AND e.source_event_key = ('billing:' || b.id || ':bill_created')
    WHERE b.tenant_id = ?
      AND e.id IS NULL
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'void')
      AND (COALESCE(b.total, 0) > 0 OR COALESCE(b.discount, 0) > 0)
    ORDER BY b.id ASC
    LIMIT ?
  `).bind(tenantId, limit).all<any>();

  return (results ?? []).map((row) => ({
    billId: Number(row.bill_id),
    invoiceNo: row.invoice_no ?? null,
    patientId: Number(row.patient_id),
    visitId: row.visit_id == null ? null : Number(row.visit_id),
    createdBy: row.created_by ?? null,
    eventDate: String(row.event_date),
    subtotal: toMoney(row.subtotal),
    discount: toMoney(row.discount),
    total: toMoney(row.total),
    testBill: toMoney(row.test_bill),
    doctorVisitBill: toMoney(row.doctor_visit_bill),
    admissionBill: toMoney(row.admission_bill),
    operationBill: toMoney(row.operation_bill),
    medicineBill: toMoney(row.medicine_bill),
    counterId: row.counter_id == null ? null : Number(row.counter_id),
    counterSessionId: row.counter_session_id == null ? null : Number(row.counter_session_id),
  }));
}

export function buildRecoveredBillCreatedPayload(row: MissingBillAccountingEventRow): Record<string, unknown> {
  return {
    billId: row.billId,
    invoiceNo: row.invoiceNo,
    patientId: row.patientId,
    visitId: row.visitId,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    testBill: row.testBill,
    doctorVisitBill: row.doctorVisitBill,
    admissionBill: row.admissionBill,
    operationBill: row.operationBill,
    medicineBill: row.medicineBill,
    counterId: row.counterId,
    counterSessionId: row.counterSessionId,
    recovered: true,
    recoveredReason: 'missing_bill_created_accounting_event',
  };
}

export async function repairBillsMissingAccountingEvents(
  db: D1Database,
  tenantId: string,
  limit = 50,
): Promise<RepairBillsMissingAccountingEventsResult> {
  const missingBills = await findBillsMissingAccountingEvents(db, tenantId, limit);
  let inserted = 0;
  const sourceEventKeys: string[] = [];

  for (const bill of missingBills) {
    const sourceEventKey = createPostingEventKey('billing', bill.billId, ACCOUNTING_EVENT_TYPES.billCreated);
    const payload = buildRecoveredBillCreatedPayload(bill);
    sourceEventKeys.push(sourceEventKey);
    const result = await db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'billing', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      String(bill.billId),
      ACCOUNTING_EVENT_TYPES.billCreated,
      bill.eventDate,
      JSON.stringify(payload),
      String(bill.createdBy ?? 'system_recovery'),
    ).run();
    inserted += Number(result.meta?.changes ?? 0);
  }

  return { scanned: missingBills.length, inserted, sourceEventKeys };
}

export async function markAccountingEventsDeadLetter(
  db: D1Database,
  tenantId: string,
  maxAttempts = DEFAULT_ACCOUNTING_EVENT_MAX_ATTEMPTS,
): Promise<number> {
  const result = await db.prepare(`
    UPDATE accounting_posting_events
    SET status = 'dead_letter',
        last_error = COALESCE(last_error, 'Exceeded accounting posting retry limit'),
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND status = 'failed'
      AND COALESCE(attempts, 0) >= ?
  `).bind(tenantId, maxAttempts).run();

  return Number(result.meta?.changes ?? 0);
}

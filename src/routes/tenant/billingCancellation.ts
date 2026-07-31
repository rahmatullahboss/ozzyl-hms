import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import {
  cancelLabOrderItemsForBill,
  cancelLabOrderItemsForInvoiceItems,
} from '../../lib/lab-cancellation';
import { cancelBillCommissions, cancelItemCommissions } from '../../lib/lab-finance';
import {
  assertNoPaidPerformerReserves,
  cancelUnpaidPerformerReserves,
} from '../../lib/diagnostic-performer-reserve';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import type { CanonicalPreparedStatement } from '../../lib/canonical/command-batch';
import {
  prepareAcceptedAndCancelledServiceRouteBatch,
  prepareProtectedConsultationService,
  prepareServiceRouteCancellationBatch,
} from '../../lib/canonical/service-delivery-route-integration';
import { prepareCanonicalBillingServiceMapping } from '../../lib/canonical/live-service-catalog-recovery';
import { resolveAppointmentRoutePractitioner } from '../../lib/canonical/appointment-route-integration';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../lib/canonical/financial-batch-assertion';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';


const cancellation = new Hono<{ Bindings: Env; Variables: Variables }>();

cancellation.use('/*', requireRole('hospital_admin', 'md', 'director', 'accountant'));

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post billing cancellation accounting event:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function currentPostingDate(): string {
  return getTodayGMT6();
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

type ProvisionalCancellationRow = {
  id: number;
  patient_id: number;
  visit_id: number | null;
  appointment_id: number | null;
  item_category: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  discount_amount: number | null;
  total_amount: number;
  doctor_id: number | null;
  reference_id: number | null;
  bill_status: string;
  canonical_source_key: string | null;
  created_at: string | null;
};

type CancellationMappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type CancellationEncounterRow = {
  legacy_patient_id: number;
  status: string;
};

function provisionalCreatedAtUtc(value: string | null, fallbackUtc: string): string {
  if (!value) return fallbackUtc;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? new Date(normalized)
    : new Date(`${normalized}+06:00`);
  return Number.isNaN(parsed.getTime()) ? fallbackUtc : parsed.toISOString();
}

async function resolveProvisionalEncounter(
  d1: D1Database,
  tenantId: string,
  patientId: number,
  visitId: number | null,
): Promise<string | null> {
  if (!visitId) return null;
  const mapping = await d1.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, String(visitId)).first<CancellationMappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new HTTPException(409, { message: 'Provisional item visit has no exact Canonical encounter mapping' });
  }
  const encounter = await d1.prepare(`
    SELECT legacy_patient_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, mapping.canonical_public_id).first<CancellationEncounterRow>();
  if (!encounter || Number(encounter.legacy_patient_id) !== patientId) {
    throw new HTTPException(409, { message: 'Provisional item encounter does not match the patient' });
  }
  if (['cancelled', 'entered_in_error'].includes(encounter.status)) {
    throw new HTTPException(409, { message: 'Provisional item encounter is not active' });
  }
  return mapping.canonical_public_id;
}

function cancellationCategoryPayload(items: Array<{ item_category?: string | null; line_total?: number | null }>) {
  const totals = {
    testBill: 0,
    doctorVisitBill: 0,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
  };

  for (const item of items) {
    const amount = Math.max(0, Math.round(Number(item.line_total ?? 0) * 100) / 100);
    const category = String(item.item_category ?? '').toLowerCase();
    if (category === 'test') totals.testBill += amount;
    else if (category === 'doctor_visit') totals.doctorVisitBill += amount;
    else if (category === 'admission') totals.admissionBill += amount;
    else if (category === 'operation') totals.operationBill += amount;
    else if (category === 'medicine') totals.medicineBill += amount;
  }

  return totals;
}

async function recordBillCancellationEvent(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tenantId: string,
  userId: string,
  eventDate: string,
  bill: {
    id: number;
    invoice_no?: string | null;
    patient_id?: number | null;
    visit_id?: number | null;
    total?: number | null;
    discount?: number | null;
    test_bill?: number | null;
    doctor_visit_bill?: number | null;
    admission_bill?: number | null;
    operation_bill?: number | null;
    medicine_bill?: number | null;
  },
  reason: string,
): Promise<void> {
  await recordAccountingPostingEvent(c.env.DB, {
    tenantId,
    sourceType: 'billing',
    sourceId: bill.id,
    eventType: ACCOUNTING_EVENT_TYPES.billCancelled,
    eventDate,
    createdBy: userId,
    payload: {
      billId: bill.id,
      invoiceNo: bill.invoice_no ?? null,
      patientId: bill.patient_id ?? null,
      visitId: bill.visit_id ?? null,
      total: Number(bill.total ?? 0),
      discount: Number(bill.discount ?? 0),
      testBill: Number(bill.test_bill ?? 0),
      doctorVisitBill: Number(bill.doctor_visit_bill ?? 0),
      admissionBill: Number(bill.admission_bill ?? 0),
      operationBill: Number(bill.operation_bill ?? 0),
      medicineBill: Number(bill.medicine_bill ?? 0),
      reason,
    },
  });
  queueAccountingPosting(c, tenantId);
}

async function recordItemCancellationEvent(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tenantId: string,
  userId: string,
  eventDate: string,
  billId: number,
  itemIds: number[],
  items: Array<{ item_category?: string | null; line_total?: number | null }>,
  reason: string,
  patientId?: number | null,
): Promise<void> {
  const total = Math.max(0, Math.round(items.reduce((sum, item) => sum + Number(item.line_total ?? 0), 0) * 100) / 100);
  if (total <= 0) return;

  const sourceId = `${billId}:items:${[...itemIds].sort((a, b) => a - b).join('-')}`;
  await recordAccountingPostingEvent(c.env.DB, {
    tenantId,
    sourceType: 'billing_item_cancellation',
    sourceId,
    eventType: ACCOUNTING_EVENT_TYPES.billCancelled,
    eventDate,
    createdBy: userId,
    payload: {
      billId,
      patientId: patientId ?? null,
      itemIds,
      total,
      discount: 0,
      ...cancellationCategoryPayload(items),
      reason,
    },
  });
  queueAccountingPosting(c, tenantId);
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const cancelBillSchema = z.object({ reason: z.string().min(1, 'Cancel reason required') });
const cancelItemSchema = z.object({ invoice_item_id: z.number().int().positive(), reason: z.string().min(1) });
const cancelBatchSchema = z.object({ invoice_item_ids: z.array(z.number().int().positive()).min(1), reason: z.string().min(1) });
const cancelProvisionalSchema = z.object({ reason: z.string().min(1) });

// ─── GET / — list cancelled bills ────────────────────────────────────────────

cancellation.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  let billWhereSql = "b.tenant_id = ? AND b.status = 'cancelled'";
  const billParams: (string | number)[] = [tenantId];
  if (patientId) { billWhereSql += ' AND b.patient_id = ?'; billParams.push(patientId); }
  if (startDate) { billWhereSql += ' AND date(b.cancelled_at) >= date(?)'; billParams.push(startDate); }
  if (endDate) { billWhereSql += ' AND date(b.cancelled_at) <= date(?)'; billParams.push(endDate); }

  const { results } = await db.$client.prepare(`
    SELECT b.id, b.invoice_no, b.id as bill_id,
      p.name as patient_name,
      b.total as amount,
      b.cancel_reason as reason,
      u.name as cancelled_by,
      b.cancelled_at as created_at
    FROM bills b
    LEFT JOIN patients p ON b.patient_id = p.id AND p.tenant_id = b.tenant_id
    LEFT JOIN users u ON b.cancelled_by = u.id AND u.tenant_id = b.tenant_id
    WHERE ${billWhereSql}
    ORDER BY b.cancelled_at DESC
    LIMIT 200
  `).bind(...billParams).all<any>();

  let eventWhereSql = "e.tenant_id = ? AND e.event_type = 'bill_cancelled'";
  const eventParams: (string | number)[] = [tenantId];
  if (patientId) {
    eventWhereSql += " AND CAST(json_extract(e.payload_json, '$.patientId') AS TEXT) = ?";
    eventParams.push(String(patientId));
  }
  if (startDate) { eventWhereSql += ' AND date(e.event_date) >= date(?)'; eventParams.push(startDate); }
  if (endDate) { eventWhereSql += ' AND date(e.event_date) <= date(?)'; eventParams.push(endDate); }

  const eventSummary = await db.$client.prepare(`
    SELECT
      COUNT(*) AS total_accounting_events,
      COALESCE(SUM(CAST(json_extract(e.payload_json, '$.total') AS REAL)), 0) AS total_accounting_amount,
      COALESCE(SUM(CASE WHEN e.source_type = 'billing' THEN CAST(json_extract(e.payload_json, '$.total') AS REAL) ELSE 0 END), 0) AS total_full_bill_accounting_amount,
      COALESCE(SUM(CASE WHEN e.source_type = 'billing_item_cancellation' THEN CAST(json_extract(e.payload_json, '$.total') AS REAL) ELSE 0 END), 0) AS total_item_cancellation_amount,
      COALESCE(SUM(CASE WHEN e.status = 'posted' THEN 1 ELSE 0 END), 0) AS posted_accounting_events,
      COALESCE(SUM(CASE WHEN e.posted_voucher_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS voucher_linked_events
    FROM accounting_posting_events e
    WHERE ${eventWhereSql}
  `).bind(...eventParams).first<{
    total_accounting_events?: number | null;
    total_accounting_amount?: number | null;
    total_full_bill_accounting_amount?: number | null;
    total_item_cancellation_amount?: number | null;
    posted_accounting_events?: number | null;
    voucher_linked_events?: number | null;
    cnt?: number | null;
    count?: number | null;
  }>();

  const totalCancelledBillAmount = roundMoney((results ?? []).reduce(
    (sum: number, row: any) => sum + Number(row.amount ?? 0),
    0,
  ));

  return c.json({
    cancellations: results,
    summary: {
      totalCancelledBills: results?.length ?? 0,
      totalCancelledBillAmount,
      totalAccountingEvents: Number(eventSummary?.total_accounting_events ?? eventSummary?.cnt ?? eventSummary?.count ?? 0),
      totalAccountingCancellationAmount: roundMoney(Number(eventSummary?.total_accounting_amount ?? 0)),
      totalFullBillAccountingAmount: roundMoney(Number(eventSummary?.total_full_bill_accounting_amount ?? 0)),
      totalItemCancellationAmount: roundMoney(Number(eventSummary?.total_item_cancellation_amount ?? 0)),
      postedAccountingEvents: Number(eventSummary?.posted_accounting_events ?? 0),
      voucherLinkedEvents: Number(eventSummary?.voucher_linked_events ?? 0),
    },
  });
});

// ─── POST / — cancel a bill by ID (frontend form) ───────────────────────────

const cancelByIdSchema = z.object({
  bill_id: z.number().int().positive(),
  reason: z.string().min(1, 'Cancel reason required'),
  remarks: z.string().optional(),
});

cancellation.post('/', zValidator('json', cancelByIdSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { bill_id, reason, remarks } = c.req.valid('json');

  const bill = await db.$client.prepare(`
    SELECT id, invoice_no, patient_id, visit_id, status, paid, total, discount,
           test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill
    FROM bills
    WHERE id = ? AND tenant_id = ?
  `).bind(bill_id, tenantId).first<any>();
  if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
  if (bill.status === 'cancelled') throw new HTTPException(400, { message: 'Bill already cancelled' });
  if (bill.paid > 0) throw new HTTPException(400, { message: 'Cannot cancel a bill with payments. Issue a credit note instead.' });
  await assertNoPaidPerformerReserves(c.env.DB, tenantId, { billId: bill_id });

  const fullReason = remarks ? `${reason} — ${remarks}` : reason;
  const today = currentPostingDate();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Bill cancellation');

  await cancelLabOrderItemsForBill(c.env.DB, {
    tenantId,
    userId,
    billId: bill_id,
    reason: fullReason,
  });

  await cancelBillCommissions(c.env.DB, tenantId, bill_id, fullReason, userId);

  const stmts = [
    db.$client.prepare(`UPDATE bills SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ? WHERE id = ? AND tenant_id = ?`).bind(userId, fullReason, bill_id, tenantId),
    db.$client.prepare(`UPDATE invoice_items SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ? WHERE bill_id = ? AND tenant_id = ?`).bind(userId, fullReason, bill_id, tenantId),
    db.$client.prepare(`
      UPDATE diagnostic_performer_reserves
      SET status = 'cancelled', cancelled_at = datetime('now', '+6 hours'), cancelled_by = ?,
          cancel_reason = ?, updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND bill_id = ? AND status = 'reserved'
    `).bind(userId, fullReason, tenantId, bill_id),
    db.$client.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (date('now', '+6 hours'), 'other', ?, ?, ?, ?, ?)
    `).bind(-(Number(bill.total) || 0), `Bill cancellation reversal: ${fullReason}`, bill_id, tenantId, userId),
  ];
  await db.$client.batch(stmts);
  await recordBillCancellationEvent(c, tenantId, userId, today, bill, fullReason);
  await createAuditLog(c.env, tenantId!, userId!, 'CANCEL', 'bills', bill_id, { status: bill.status, total: bill.total }, { reason: fullReason });

  return c.json({ message: 'Bill cancelled', bill_id });
});

// ─── PUT /bill/:id — cancel entire bill ──────────────────────────────────────

cancellation.put('/bill/:id', zValidator('json', cancelBillSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const { reason } = c.req.valid('json');

  const bill = await db.$client.prepare(`
    SELECT id, invoice_no, patient_id, visit_id, status, paid, total, discount,
           test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill
    FROM bills
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first<any>();
  if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
  if (bill.status === 'cancelled') throw new HTTPException(400, { message: 'Bill already cancelled' });
  if (bill.paid > 0) throw new HTTPException(400, { message: 'Cannot cancel a bill with payments. Issue a credit note instead.' });
  await assertNoPaidPerformerReserves(c.env.DB, tenantId, { billId: id });
  const today = currentPostingDate();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Bill cancellation');

  await cancelLabOrderItemsForBill(c.env.DB, {
    tenantId,
    userId,
    billId: id,
    reason,
  });

  await cancelBillCommissions(c.env.DB, tenantId, id, reason, userId);

  const stmts = [
    db.$client.prepare(`UPDATE bills SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ? WHERE id = ? AND tenant_id = ?`).bind(userId, reason, id, tenantId),
    db.$client.prepare(`UPDATE invoice_items SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ? WHERE bill_id = ? AND tenant_id = ?`).bind(userId, reason, id, tenantId),
    db.$client.prepare(`
      UPDATE diagnostic_performer_reserves
      SET status = 'cancelled', cancelled_at = datetime('now', '+6 hours'), cancelled_by = ?,
          cancel_reason = ?, updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND bill_id = ? AND status = 'reserved'
    `).bind(userId, reason, tenantId, id),
    db.$client.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (date('now', '+6 hours'), 'other', ?, ?, ?, ?, ?)
    `).bind(-(Number(bill.total) || 0), `Bill cancellation reversal: ${reason}`, id, tenantId, userId),
  ];
  await db.$client.batch(stmts);
  await recordBillCancellationEvent(c, tenantId, userId, today, bill, reason);
  await createAuditLog(c.env, tenantId!, userId!, 'CANCEL', 'bills', id, { status: bill.status, total: bill.total }, { reason });

  return c.json({ message: 'Bill cancelled', bill_id: id });
});

// ─── PUT /item — cancel single item ─────────────────────────────────────────

cancellation.put('/item', zValidator('json', cancelItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { invoice_item_id, reason } = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT ii.*, b.paid AS bill_paid, b.status AS bill_status, b.patient_id AS patient_id
    FROM invoice_items ii
    JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    WHERE ii.id = ? AND ii.tenant_id = ?
  `).bind(invoice_item_id, tenantId).first<any>();
  if (!item) throw new HTTPException(404, { message: 'Item not found' });
  if (item.status === 'cancelled') throw new HTTPException(400, { message: 'Item already cancelled' });
  if (Number(item.bill_paid) > 0 || item.bill_status === 'paid') {
    throw new HTTPException(409, { message: 'Cannot cancel items from a bill with payments. Use credit note instead.' });
  }
  await assertNoPaidPerformerReserves(c.env.DB, tenantId, {
    billId: Number(item.bill_id),
    invoiceItemIds: [invoice_item_id],
  });
  const today = currentPostingDate();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Invoice item cancellation');

  await cancelLabOrderItemsForInvoiceItems(c.env.DB, {
    tenantId,
    userId,
    invoiceItemIds: [invoice_item_id],
    reason,
  });

  // Map invoice item category to commission source type
  const commissionSourceType = item.item_category === 'doctor_visit' ? 'consultation_fee' :
                               item.item_category === 'test' ? 'lab_test' : null;

  if (commissionSourceType) {
    await cancelItemCommissions(c.env.DB, tenantId, item.bill_id, [commissionSourceType], reason, userId);
    queueAccountingPosting(c, tenantId);
  }
  await cancelUnpaidPerformerReserves(c.env.DB, tenantId, {
    billId: Number(item.bill_id),
    invoiceItemIds: [invoice_item_id],
    reason,
    userId,
  });

  await db.$client.prepare(`
    UPDATE invoice_items SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, reason, invoice_item_id, tenantId).run();

  // Recalculate bill total
  const { results: activeItems } = await db.$client.prepare(
    "SELECT COALESCE(SUM(line_total), 0) as new_total FROM invoice_items WHERE bill_id = ? AND tenant_id = ? AND COALESCE(status, 'active') = 'active'"
  ).bind(item.bill_id, tenantId).all<any>();

  const newTotal = activeItems[0]?.new_total || 0;
  await db.$client.prepare(`
    UPDATE bills SET total = ?, due = MAX(0, ? - paid), status = CASE WHEN paid >= ? THEN 'paid' WHEN paid > 0 THEN 'partially_paid' ELSE 'open' END
    WHERE id = ? AND tenant_id = ?
  `).bind(newTotal, newTotal, newTotal, item.bill_id, tenantId).run();
  await recordItemCancellationEvent(c, tenantId, userId, today, item.bill_id, [invoice_item_id], [item], reason, item.patient_id);
  await createAuditLog(c.env, tenantId!, userId!, 'CANCEL', 'invoice_items', invoice_item_id, { billId: item.bill_id }, { reason, newTotal });

  return c.json({ message: 'Item cancelled', new_bill_total: newTotal });
});

// ─── PUT /items/batch — cancel multiple items ────────────────────────────────

cancellation.put('/items/batch', zValidator('json', cancelBatchSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { invoice_item_ids, reason } = c.req.valid('json');

  const placeholders = invoice_item_ids.map(() => '?').join(',');
  const { results: paidParentBills } = await db.$client.prepare(`
    SELECT DISTINCT b.id, b.paid, b.status
    FROM invoice_items ii
    JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    WHERE ii.id IN (${placeholders}) AND ii.tenant_id = ? AND (b.paid > 0 OR b.status = 'paid')
  `).bind(...invoice_item_ids, tenantId).all<{ id: number; paid?: number | null; status?: string | null }>();

  if ((paidParentBills ?? []).some((bill) => Number(bill.paid ?? 0) > 0 || bill.status === 'paid')) {
    throw new HTTPException(409, { message: 'Cannot cancel items from a bill with payments. Use credit note instead.' });
  }
  const today = currentPostingDate();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Invoice item cancellation');

  const { results: reserveScopeItems } = await db.$client.prepare(`
    SELECT id, bill_id
    FROM invoice_items
    WHERE tenant_id = ? AND id IN (${placeholders}) AND COALESCE(status, 'active') = 'active'
  `).bind(tenantId, ...invoice_item_ids).all<{ id: number; bill_id: number }>();
  const reserveItemsByBill = new Map<number, number[]>();
  for (const item of reserveScopeItems ?? []) {
    const billItems = reserveItemsByBill.get(Number(item.bill_id)) ?? [];
    billItems.push(Number(item.id));
    reserveItemsByBill.set(Number(item.bill_id), billItems);
  }
  for (const [billId, itemIds] of reserveItemsByBill.entries()) {
    await assertNoPaidPerformerReserves(c.env.DB, tenantId, { billId, invoiceItemIds: itemIds });
  }

  await cancelLabOrderItemsForInvoiceItems(c.env.DB, {
    tenantId,
    userId,
    invoiceItemIds: invoice_item_ids,
    reason,
  });

  const { results: commissionItems } = await db.$client.prepare(`
    SELECT ii.id, ii.bill_id, b.patient_id, ii.item_category, ii.line_total
    FROM invoice_items ii
    JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    WHERE ii.id IN (${placeholders}) AND ii.tenant_id = ? AND COALESCE(ii.status, 'active') = 'active'
  `).bind(...invoice_item_ids, tenantId).all<{
    id: number;
    bill_id: number;
    patient_id?: number | null;
    item_category: string | null;
    line_total: number | null;
  }>();

  const sourceTypesByBill = new Map<number, Set<string>>();
  for (const item of commissionItems ?? []) {
    const sourceType = item.item_category === 'doctor_visit'
      ? 'consultation_fee'
      : item.item_category === 'test'
        ? 'lab_test'
        : null;
    if (!sourceType) continue;
    const existing = sourceTypesByBill.get(item.bill_id) ?? new Set<string>();
    existing.add(sourceType);
    sourceTypesByBill.set(item.bill_id, existing);
  }

  for (const [billId, sourceTypes] of sourceTypesByBill.entries()) {
    await cancelItemCommissions(c.env.DB, tenantId, billId, [...sourceTypes], reason, userId);
  }
  if (sourceTypesByBill.size > 0) {
    queueAccountingPosting(c, tenantId);
  }
  for (const [billId, itemIds] of reserveItemsByBill.entries()) {
    await cancelUnpaidPerformerReserves(c.env.DB, tenantId, {
      billId,
      invoiceItemIds: itemIds,
      reason,
      userId,
    });
  }

  const result = await db.$client.prepare(`
    UPDATE invoice_items SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ?
    WHERE id IN (${placeholders}) AND tenant_id = ?
  `).bind(userId, reason, ...invoice_item_ids, tenantId).run();

  // Recalculate parent bill totals for affected bills
  const { results: affectedBills } = await db.$client.prepare(`
    SELECT DISTINCT bill_id FROM invoice_items WHERE id IN (${placeholders}) AND tenant_id = ?
  `).bind(...invoice_item_ids, tenantId).all<{ bill_id: number }>();

  for (const b of affectedBills || []) {
    const totals = await db.$client.prepare(
      "SELECT COALESCE(SUM(line_total), 0) as new_total FROM invoice_items WHERE bill_id = ? AND tenant_id = ? AND COALESCE(status, 'active') = 'active'"
    ).bind(b.bill_id, tenantId).first<{ new_total: number }>();
    const newTotal = totals?.new_total || 0;
    await db.$client.prepare(`
      UPDATE bills SET total = ?, due = MAX(0, ? - paid), status = CASE WHEN paid >= ? THEN 'paid' WHEN paid > 0 THEN 'partially_paid' ELSE 'open' END
      WHERE id = ? AND tenant_id = ?
    `).bind(newTotal, newTotal, newTotal, b.bill_id, tenantId).run();
  }
  const cancelledItemsByBill = new Map<number, Array<{
    id: number;
    patient_id?: number | null;
    item_category?: string | null;
    line_total?: number | null;
  }>>();
  for (const item of commissionItems ?? []) {
    const group = cancelledItemsByBill.get(item.bill_id) ?? [];
    group.push(item);
    cancelledItemsByBill.set(item.bill_id, group);
  }
  for (const [billId, items] of cancelledItemsByBill.entries()) {
    await recordItemCancellationEvent(
      c,
      tenantId,
      userId,
      today,
      billId,
      items.map((item) => item.id),
      items,
      reason,
      items[0]?.patient_id ?? null,
    );
  }
  await createAuditLog(c.env, tenantId!, userId!, 'CANCEL', 'invoice_items', 0, { itemIds: invoice_item_ids }, { reason, count: result.meta.changes });

  return c.json({ message: `${result.meta.changes} items cancelled` });
});

// ─── PUT /provisional/:id — cancel provisional IPD item ──────────────────────

cancellation.put('/provisional/:id', zValidator('json', cancelProvisionalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const { reason } = c.req.valid('json');
  const today = currentPostingDate();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Provisional item cancellation');

  const row = await db.$client.prepare(`
    SELECT id,patient_id,visit_id,appointment_id,item_category,item_name,unit_price,
           quantity,discount_amount,total_amount,doctor_id,reference_id,bill_status,
           canonical_source_key,created_at
    FROM billing_provisional_items
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(id, tenantId).first<ProvisionalCancellationRow>();
  if (!row || row.bill_status !== 'provisional') {
    throw new HTTPException(404, { message: 'Provisional item not found or already processed' });
  }

  const sourceKey = row.canonical_source_key?.trim()
    || (row.appointment_id
      ? `appointment-service:${row.appointment_id}:${row.id}`
      : `provisional-service:${row.id}`);
  const sourceType = 'legacy_billing_provisional_item_key';
  const cancelledAtUtc = new Date().toISOString();
  const occurredAtUtc = provisionalCreatedAtUtc(row.created_at, cancelledAtUtc);
  const operationKey = `provisional-cancel:${id}`;
  const authoritativeStatements: CanonicalPreparedStatement[] = [
    db.$client.prepare(`
      UPDATE billing_provisional_items
      SET bill_status='cancelled',cancelled_by=?,cancelled_at=datetime('now','+6 hours'),
          cancel_reason=?,canonical_source_key=COALESCE(canonical_source_key,?)
      WHERE id=? AND tenant_id=? AND patient_id=?
        AND COALESCE(visit_id,0)=COALESCE(?,0)
        AND COALESCE(appointment_id,0)=COALESCE(?,0)
        AND item_category=? AND item_name=?
        AND unit_price=? AND quantity=?
        AND COALESCE(discount_amount,0)=? AND total_amount=?
        AND COALESCE(doctor_id,0)=COALESCE(?,0)
        AND COALESCE(reference_id,0)=COALESCE(?,0)
        AND COALESCE(canonical_source_key,'')=COALESCE(?,'')
        AND bill_status='provisional'
    `).bind(
      userId,
      reason,
      sourceKey,
      row.id,
      tenantId,
      row.patient_id,
      row.visit_id,
      row.appointment_id,
      row.item_category,
      row.item_name,
      row.unit_price,
      row.quantity,
      Number(row.discount_amount ?? 0),
      row.total_amount,
      row.doctor_id,
      row.reference_id,
      row.canonical_source_key,
    ),
    prepareFinancialBatchAssertion(c.env.DB, {
      tenantId,
      operationKey,
      stepKey: 'provisional_item_cancel',
      expectedChanges: 1,
    }),
    prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'billing_provisional_items',
      recordId: row.id,
      oldValue: {
        billStatus: row.bill_status,
        patientId: row.patient_id,
        visitId: row.visit_id,
        appointmentId: row.appointment_id,
        itemCategory: row.item_category,
        quantity: row.quantity,
        totalAmount: row.total_amount,
        canonicalSourceKey: row.canonical_source_key,
      },
      newValue: {
        billStatus: 'cancelled',
        reason,
        canonicalSourceKey: sourceKey,
      },
      ...auditRequestMetadata(c),
    }),
    prepareClearFinancialBatchAssertions(c.env.DB, tenantId, operationKey),
  ];

  const mappedEvent = await c.env.DB.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_event'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, sourceType, sourceKey).first<CancellationMappingRow>();

  if (mappedEvent?.mapping_status === 'mapped' && mappedEvent.canonical_public_id) {
    const prepared = await prepareServiceRouteCancellationBatch(c.env.DB, {
      tenantId,
      sourceType,
      sourcePublicId: sourceKey,
      cancelledAtUtc,
      sourceEvidence: {
        boundary: 'provisional_item_cancellation',
        provisionalItemId: row.id,
        sourceKey,
        reason,
        priorStatus: row.bill_status,
      },
      idempotencyKey: `route:provisional-service-cancel:${sourceKey}`,
      businessDate: today,
      authoritativeStatements,
    });
    if (prepared.status === 'prepared') {
      await c.env.DB.batch([...prepared.statements] as D1PreparedStatement[]);
    }
  } else {
    let servicePublicId: string;
    let serviceEvidenceSha256: string;
    let serviceStatements: readonly CanonicalPreparedStatement[];
    if (row.item_category === 'doctor_visit') {
      const service = await prepareProtectedConsultationService(c.env.DB, tenantId);
      servicePublicId = service.servicePublicId;
      serviceEvidenceSha256 = service.sourceEvidenceSha256;
      serviceStatements = service.statements;
    } else {
      const serviceItemId = Number(row.reference_id ?? 0);
      if (!Number.isSafeInteger(serviceItemId) || serviceItemId <= 0) {
        throw new HTTPException(409, { message: 'Provisional item has no exact service identity' });
      }
      const service = await prepareCanonicalBillingServiceMapping(c.env.DB, {
        tenantId,
        billingServiceItemId: serviceItemId,
      });
      if (service.status !== 'active') {
        throw new HTTPException(409, { message: 'Provisional item service is inactive' });
      }
      servicePublicId = service.servicePublicId;
      serviceEvidenceSha256 = service.evidenceSha256;
      serviceStatements = [...service.statements, ...service.reconciliationStatements];
    }

    const practitionerPublicId = row.doctor_id
      ? await resolveAppointmentRoutePractitioner(c.env.DB, tenantId, row.doctor_id)
      : null;
    if (row.item_category === 'doctor_visit' && !practitionerPublicId) {
      throw new HTTPException(409, { message: 'Consultation item has no exact practitioner mapping' });
    }
    const encounterPublicId = await resolveProvisionalEncounter(
      c.env.DB,
      tenantId,
      row.patient_id,
      row.visit_id,
    );
    const prepared = await prepareAcceptedAndCancelledServiceRouteBatch(c.env.DB, {
      tenantId,
      legacyPatientId: row.patient_id,
      encounterPublicId,
      servicePublicId,
      sourceType,
      sourcePublicId: sourceKey,
      sourceTable: 'billing_provisional_items',
      quantity: row.quantity,
      occurredAtUtc,
      acceptedSourceEvidence: {
        boundary: 'provisional_item_acceptance_bootstrap',
        provisionalItemId: row.id,
        sourceKey,
        patientId: row.patient_id,
        visitId: row.visit_id,
        appointmentId: row.appointment_id,
        doctorId: row.doctor_id,
        referenceId: row.reference_id,
        itemCategory: row.item_category,
        quantity: row.quantity,
        unitAmountMinor: Math.round(row.unit_price * 100),
        discountAmountMinor: Math.round(Number(row.discount_amount ?? 0) * 100),
        lineAmountMinor: Math.round(row.total_amount * 100),
        status: 'provisional',
      },
      cancelledAtUtc,
      cancellationSourceEvidence: {
        boundary: 'provisional_item_cancellation',
        provisionalItemId: row.id,
        sourceKey,
        reason,
        priorStatus: row.bill_status,
      },
      participant: practitionerPublicId ? {
        practitionerPublicId,
        role: 'performing',
        evidenceType: row.item_category === 'doctor_visit'
          ? 'legacy_consultation_doctor'
          : 'approved_manual',
      } : null,
      acceptanceIdempotencyKey: `route:provisional-service:${sourceKey}`,
      cancellationIdempotencyKey: `route:provisional-service-cancel:${sourceKey}`,
      businessDate: today,
      preparedService: serviceStatements.length > 0
        ? { servicePublicId, sourceEvidenceSha256: serviceEvidenceSha256 }
        : null,
      acceptanceStatements: serviceStatements,
      cancellationStatements: authoritativeStatements,
    });
    if (prepared.status === 'prepared') {
      await c.env.DB.batch([...prepared.statements] as D1PreparedStatement[]);
    }
  }

  return c.json({ message: 'Provisional item cancelled' });
});

export default cancellation;

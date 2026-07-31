import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { getNextSequence } from '../../lib/sequence';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { getTodayGMT6 } from '../../lib/date-utils';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  postPendingAccountingEvents,
} from '../../lib/accounting-posting';
import { assertNoPaidPerformerReserves } from '../../lib/diagnostic-performer-reserve';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import {
  calculateRefundSelection,
  loadRefundableInvoiceItems,
} from '../../lib/billing-refund';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import {
  isFinancialBatchAssertionError,
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../lib/canonical/financial-batch-assertion';
import { resolveLiveCreditNoteProjection } from '../../lib/canonical/live-credit-note-projection';
import { resolveLiveCreditNoteCashRefundFunding } from '../../lib/canonical/live-credit-note-cash-refund';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';
import { issueCreditNote } from '../../lib/canonical/commands/issue-credit-note';
import { issueCreditNoteWithCashRefund } from '../../lib/canonical/commands/issue-credit-note-cash-refund';
import { prepareCreditNoteCommissionAdjustmentStatements } from '../../lib/billing-refund-commission';

const creditNotes = new Hono<{ Bindings: Env; Variables: Variables }>();
const CREDIT_NOTE_READ_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;
const CREDIT_NOTE_WRITE_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const CREDIT_NOTE_PAYOUT_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isCreditNoteCashRefundConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (
      /canonical invoice mapping not found/i.test(message)
      || /insufficient canonical payment funding/i.test(message)
      || /canonical payment (?:receipt|allocation|tender attribution) authority changed/i.test(message)
      || /canonical invoice (?:not found|is not posted|adjustment projection is inconsistent)/i.test(message)
      || /cash refund exceeds canonical invoice paid balance/i.test(message)
      || /credit note exceeds refundable invoice balance/i.test(message)
      || /paid performer reserve or compensation settlement blocks credit refund/i.test(message)
    ) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post credit note accounting event:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createCreditNoteSchema = z.object({
  bill_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  reason: z.string().min(1),
  payment_mode: z.string().optional(),
  remarks: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  items: z.array(z.object({
    invoice_item_id: z.number().int().positive(),
    return_quantity: z.number().int().positive(),
    remarks: z.string().optional(),
  })).min(1),
});

// ─── GET / — list credit notes ───────────────────────────────────────────────

creditNotes.get('/', requireRole(...CREDIT_NOTE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = Math.min(200, Math.max(1, parseInt(c.req.query('per_page') || '50')));
  const offset = (page - 1) * perPage;

  let whereSql = 'cn.tenant_id = ? AND cn.is_active = 1';
  const params: (string | number)[] = [tenantId];
  const statusFilter = c.req.query('status');
  if (statusFilter && statusFilter !== 'all') { whereSql += ' AND cn.status = ?'; params.push(statusFilter); }
  if (patientId) { whereSql += ' AND cn.patient_id = ?'; params.push(patientId); }
  if (startDate) { whereSql += ' AND date(cn.created_at) >= date(?)'; params.push(startDate); }
  if (endDate) { whereSql += ' AND date(cn.created_at) <= date(?)'; params.push(endDate); }

  const sql = `
    SELECT cn.*, p.name as patient_name, p.patient_code, b.invoice_no
    FROM billing_credit_notes cn
    JOIN patients p ON cn.patient_id = p.id AND p.tenant_id = cn.tenant_id
    JOIN bills b ON cn.bill_id = b.id
    WHERE ${whereSql}
    ORDER BY cn.created_at DESC LIMIT ${perPage} OFFSET ${offset}
  `;
  const summarySql = `
    SELECT
      COUNT(*) AS total_credit_notes,
      COALESCE(SUM(cn.total_amount), 0) AS total_credit_amount,
      COALESCE(SUM(cn.refund_amount), 0) AS total_refund_amount
    FROM billing_credit_notes cn
    WHERE ${whereSql}
  `;

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  const summaryRow = await db.$client.prepare(summarySql).bind(...params).first<{
    total_credit_notes?: number | null;
    total_credit_amount?: number | null;
    total_refund_amount?: number | null;
    cnt?: number | null;
    count?: number | null;
    balance?: number | null;
  }>();
  const totalCreditNotes = Number(summaryRow?.total_credit_notes ?? summaryRow?.cnt ?? summaryRow?.count ?? 0);
  const totalCreditAmount = roundMoney(Number(summaryRow?.total_credit_amount ?? 0));
  const totalRefundAmount = roundMoney(Number(summaryRow?.total_refund_amount ?? 0));

  return c.json({
    credit_notes: results,
    page,
    per_page: perPage,
    summary: {
      totalCreditNotes,
      totalCreditAmount,
      totalRefundAmount,
    },
  });
});

// ─── GET /invoice/:billId — get invoice items for credit note ────────────────

creditNotes.get('/invoice/:billId', requireRole(...CREDIT_NOTE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const billId = parseInt(c.req.param('billId'));

  const bill = await db.$client.prepare(
    'SELECT b.*, p.name as patient_name FROM bills b JOIN patients p ON b.patient_id = p.id WHERE b.id = ? AND b.tenant_id = ?'
  ).bind(billId, tenantId).first();
  if (!bill) throw new HTTPException(404, { message: 'Bill not found' });

  const refundableItems = await loadRefundableInvoiceItems(db.$client, String(tenantId), billId);
  const items = refundableItems.map((item) => ({
    id: item.invoiceItemId,
    description: item.description,
    item_category: item.itemCategory,
    quantity: item.quantity,
    unit_price: item.unitPrice ?? item.refundableUnitAmount,
    line_total: item.lineTotal ?? item.refundableUnitAmount * item.quantity,
    reference_id: item.referenceId ?? null,
    returned_qty: item.approvedReturnedQuantity,
    pending_qty: item.pendingReservedQuantity,
    available_qty: item.availableQuantity,
    refundable_unit_amount: item.refundableUnitAmount,
    clinical_status: item.clinicalStatus,
    eligible: item.eligible,
    block_reason: item.blockReason,
  }));

  return c.json({ bill, items });
});

// ─── POST / — create credit note (pending) ──────────────────────────────────

creditNotes.post('/', requireRole(...CREDIT_NOTE_WRITE_ROLES), zValidator('json', createCreditNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const mutationType = 'credit_note';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different credit note request',
      conflictMessage: 'Credit note request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  // Validate invoice belongs to patient
  const bill = await db.$client.prepare(
    'SELECT * FROM bills WHERE id = ? AND tenant_id = ? AND patient_id = ?'
  ).bind(data.bill_id, tenantId, data.patient_id).first<any>();
  if (!bill) throw new HTTPException(404, { message: 'Bill not found for this patient' });

  const refundableItems = await loadRefundableInvoiceItems(db.$client, String(tenantId), data.bill_id);
  let calculation;
  try {
    calculation = calculateRefundSelection(
      refundableItems,
      data.items.map((item) => ({
        invoiceItemId: item.invoice_item_id,
        returnQuantity: item.return_quantity,
      })),
    );
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid refund selection' });
  }
  const itemMap = new Map(refundableItems.map((item) => [item.invoiceItemId, item]));
  const totalRefund = calculation.totalRefund;
  await assertNoPaidPerformerReserves(c.env.DB, tenantId, {
    billId: data.bill_id,
    invoiceItemIds: data.items.map((item) => item.invoice_item_id),
  });

  const cnNo = await getNextSequence(c.env.DB, String(tenantId), 'credit_note', 'CN');
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different credit note request',
      conflictMessage: 'Credit note request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {

  const creditNoteIdLookup = '(SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1)';
  const paymentMethod = data.payment_mode || 'cash';
  const stmts: any[] = [
    db.$client.prepare(`
      INSERT INTO billing_credit_notes
        (tenant_id, credit_note_no, bill_id, patient_id, reason, total_amount, refund_amount, payment_mode, remarks, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      tenantId, cnNo, data.bill_id, data.patient_id, data.reason, totalRefund, totalRefund,
      paymentMethod, data.remarks || null, userId,
    ),
  ];

  for (const returnItem of data.items) {
    const original = itemMap.get(returnItem.invoice_item_id)!;
    const refundableUnit = original.refundableUnitAmount;
    const itemTotal = Math.round(refundableUnit * returnItem.return_quantity * 100) / 100;
    stmts.push(
      db.$client.prepare(`
        INSERT INTO billing_credit_note_items (tenant_id, credit_note_id, invoice_item_id, item_name, unit_price, return_quantity, total_amount, remarks)
        VALUES (?, ${creditNoteIdLookup}, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        tenantId,
        cnNo,
        returnItem.invoice_item_id,
        original.description,
        refundableUnit,
        returnItem.return_quantity,
        itemTotal,
        returnItem.remarks || null,
      )
    );
  }

  // Audit log for credit note creation
  stmts.push(
    db.$client.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      )
      VALUES (?, ?, 'CREATE', 'billing_credit_notes', ${creditNoteIdLookup}, NULL, ?, NULL, NULL, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      userId,
      tenantId,
      cnNo,
      JSON.stringify({
        action: 'credit_note_created',
        creditNoteNo: cnNo,
        billId: data.bill_id,
        totalRefund,
        status: 'pending',
      }),
    )
  );

  const batchResults = await db.$client.batch(stmts);
  let cnId = Number((batchResults[0] as any).meta?.last_row_id ?? 0);
  if (!cnId) {
    const row = await db.$client.prepare(
      'SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1',
    ).bind(tenantId, cnNo).first<{ id: number }>();
    cnId = Number(row?.id ?? 0);
  }

  const responseBody = { id: cnId, credit_note_no: cnNo, refund_amount: totalRefund, status: 'pending', message: 'Credit note created' };
  if (data.idempotencyKey && requestHash) {
    await completeMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      sourceId: cnId,
      responseBody,
    });
  }

  return c.json(responseBody, 201);
  } catch (error) {
    if (idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark credit note idempotency key failed:', markError);
      });
    }
    throw error;
  }
});

// ─── POST /:id/approve — approve and process refund ─────────────────────────

creditNotes.post('/:id/approve', requireRole(...CREDIT_NOTE_PAYOUT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const cnId = parseInt(c.req.param('id'));

  // Fetch the credit note
  const cn = await db.$client.prepare(
    'SELECT * FROM billing_credit_notes WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(cnId, tenantId).first<any>();
  if (!cn) throw new HTTPException(404, { message: 'Credit note not found' });

  const currentStatus = String(cn.status ?? 'pending');
  const actorRole = String(c.get('role') ?? '');
  const isAdminApproval = currentStatus === 'pending';
  const isCashierPayout = currentStatus === 'ready_for_payout';
  if (!isAdminApproval && !isCashierPayout) {
    throw new HTTPException(400, { message: `Credit note status is already ${currentStatus}. Only pending or ready-for-payout credit notes can be processed.` });
  }
  if (isAdminApproval && !CREDIT_NOTE_WRITE_ROLES.includes(actorRole as any)) {
    throw new HTTPException(403, { message: 'Only admin/accounts can approve pending credit notes.' });
  }

  // Fetch the bill
  const bill = await db.$client.prepare(
    'SELECT * FROM bills WHERE id = ? AND tenant_id = ?'
  ).bind(cn.bill_id, tenantId).first<any>();
  if (!bill) throw new HTTPException(404, { message: 'Associated bill not found' });

  // Phase 6 hardening: bill-state guard. Credit notes may only be
  // approved when the parent bill is in a FINAL state (paid or
  // partially_paid) and not in a terminal state (cancelled / refunded
  // / draft).
  const allowedBillStatuses = new Set(['paid', 'partially_paid', 'final']);
  if (bill.status === 'cancelled' || bill.status === 'refunded' || bill.status === 'draft') {
    throw new HTTPException(400, { message: `Cannot approve credit note: bill is in terminal status '${bill.status}'.` });
  }
  if (!allowedBillStatuses.has(String(bill.status ?? ''))) {
    throw new HTTPException(409, { message: `Credit note approval requires bill to be in a final state. Current status: '${bill.status}'.` });
  }
  if (Number(bill.total ?? 0) <= 0) {
    throw new HTTPException(400, { message: 'Cannot approve credit note for a zero-total bill.' });
  }

  // Fetch credit note items
  const { results: cnItems } = await db.$client.prepare(
    'SELECT * FROM billing_credit_note_items WHERE credit_note_id = ? AND tenant_id = ?'
  ).bind(cnId, tenantId).all<any>();
  const cnInvoiceItemIds = cnItems
    .map((item: any) => Number(item.invoice_item_id ?? 0))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  await assertNoPaidPerformerReserves(c.env.DB, tenantId, {
    billId: Number(cn.bill_id),
    invoiceItemIds: cnInvoiceItemIds,
  });

  // Calculate refund amounts
  const totalRefund = Number(cn.refund_amount || cn.total_amount || 0);
  const originalTotal = Number(bill.total || 0);
  const originalPaid = Number(bill.paid || 0);
  const newTotal = Math.max(0, Math.round((originalTotal - totalRefund) * 100) / 100);
  const newPaid = Math.min(originalPaid, newTotal);
  const cashRefund = Math.max(0, Math.round((originalPaid - newPaid) * 100) / 100);
  const receivableReduction = Math.max(0, Math.round((totalRefund - cashRefund) * 100) / 100);
  const financialBoundary = cashRefund > 0 ? 'credit-note.cash-refund' : 'credit-note.approve';
  await assertStrictFinancialBoundaryDisabledOrSupported(
    c.env.DB,
    String(tenantId),
    financialBoundary,
  );

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, String(tenantId), today, 'Credit note approval');

  const originalPaymentMethod = String(cn.payment_mode || 'cash');
  const payoutPaymentMethod = cashRefund > 0 ? 'cash' : originalPaymentMethod;
  const cnNo = cn.credit_note_no;

  // Calculate category totals from items
  const categoryTotals = {
    testBill: 0,
    doctorVisitBill: 0,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
  };

  // Fetch invoice item categories in a single query (avoids N+1)
  const cnItemIds = cnItems.map((ci: any) => Number(ci.invoice_item_id)).filter((id: number) => id > 0);
  const cnItemPlaceholders = cnItemIds.map(() => '?').join(',');
  if (cnItemIds.length > 0) {
    const { results: invoiceItems } = await db.$client.prepare(
      `SELECT id, item_category FROM invoice_items WHERE tenant_id = ? AND id IN (${cnItemPlaceholders})`
    ).bind(tenantId, ...cnItemIds).all<any>();
    const categoryMap = new Map(invoiceItems.map((ii: any) => [ii.id, ii.item_category]));
    for (const cnItem of cnItems) {
      const category = String(categoryMap.get(cnItem.invoice_item_id) ?? '').toLowerCase();
      const amount = Number(cnItem.total_amount || 0);
      if (category === 'test') categoryTotals.testBill += amount;
      else if (category === 'doctor_visit') categoryTotals.doctorVisitBill += amount;
      else if (category === 'admission') categoryTotals.admissionBill += amount;
      else if (category === 'operation') categoryTotals.operationBill += amount;
      else if (category === 'medicine') categoryTotals.medicineBill += amount;
    }
  }

  const activeCounterSession = cashRefund > 0
    ? await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    })
    : null;
  if (cashRefund > 0 && !activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before refunding credit notes.' });
  }

  const commissionAdjustment = await prepareCreditNoteCommissionAdjustmentStatements(c.env.DB, {
    tenantId,
    creditNoteId: cnId,
    billId: Number(cn.bill_id),
    items: cnItems.map((item: any) => ({
      id: item.id == null ? null : Number(item.id),
      invoice_item_id: Number(item.invoice_item_id),
      return_quantity: Number(item.return_quantity),
    })),
    reason: `Credit note ${cnNo}: ${cn.reason || 'returned service'}`,
    createdBy: userId,
  });

  const creditNoteIdLookup = '(SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1)';
  const sourceEventKey = createPostingEventKey('credit_note', cnNo, ACCOUNTING_EVENT_TYPES.creditNoteIssued);
  const financialOperationKey = `credit-note-approval:${tenantId}:${cnId}:${currentStatus}`;

  const stmts: any[] = [
    db.$client.prepare(`
      UPDATE billing_credit_notes
      SET status = 'approved', approved_by = ?, approved_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = ?
    `).bind(userId, cnId, tenantId, currentStatus),
    prepareFinancialBatchAssertion(db.$client, {
      tenantId: String(tenantId),
      operationKey: financialOperationKey,
      stepKey: 'credit_note_status',
      expectedChanges: 1,
    }),
    db.$client.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      ) VALUES (?, ?, 'APPROVE', 'billing_credit_notes', ?, ?, ?, NULL, NULL, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      userId,
      cnId,
      JSON.stringify({ status: currentStatus }),
      JSON.stringify({
        action: 'credit_note_approved',
        creditNoteNo: cnNo,
        totalRefund,
        receivableReduction,
        cashRefund,
        doctorCommissionReversalAmount: commissionAdjustment.reversalAmount,
        doctorCommissionClawbackAmount: commissionAdjustment.clawbackAmount,
        affectedDoctorCommissionAccrualCount: commissionAdjustment.affectedAccrualCount,
        newTotal,
        newPaid,
      }),
    ),
    prepareFinancialBatchAssertion(db.$client, {
      tenantId: String(tenantId),
      operationKey: financialOperationKey,
      stepKey: 'audit_log',
      expectedChanges: 1,
    }),
    db.$client.prepare(`
      UPDATE bills SET total = ?, paid = ?,
        test_bill = MAX(0, COALESCE(test_bill, 0) - ?),
        doctor_visit_bill = MAX(0, COALESCE(doctor_visit_bill, 0) - ?),
        admission_bill = MAX(0, COALESCE(admission_bill, 0) - ?),
        operation_bill = MAX(0, COALESCE(operation_bill, 0) - ?),
        medicine_bill = MAX(0, COALESCE(medicine_bill, 0) - ?),
        due = MAX(0, ? - ?),
        status = CASE
          WHEN ? <= 0 THEN 'cancelled'
          WHEN ? >= ? THEN 'paid'
          WHEN ? > 0 THEN 'partially_paid'
          ELSE 'open'
        END
      WHERE id = ? AND tenant_id = ?
    `).bind(
      newTotal,
      newPaid,
      roundMoney(categoryTotals.testBill),
      roundMoney(categoryTotals.doctorVisitBill),
      roundMoney(categoryTotals.admissionBill),
      roundMoney(categoryTotals.operationBill),
      roundMoney(categoryTotals.medicineBill),
      newTotal,
      newPaid,
      newTotal,
      newPaid,
      newTotal,
      newPaid,
      cn.bill_id,
      tenantId,
    ),
    prepareFinancialBatchAssertion(db.$client, {
      tenantId: String(tenantId),
      operationKey: financialOperationKey,
      stepKey: 'bill_update',
      expectedChanges: 1,
    }),
    db.$client.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id)
      VALUES (?, 'other', ?, ?, ?, ?)
    `).bind(today, -totalRefund, `Credit note ${cnNo} — refund`, cn.bill_id, tenantId),
    prepareFinancialBatchAssertion(db.$client, {
      tenantId: String(tenantId),
      operationKey: financialOperationKey,
      stepKey: 'income_reversal',
      expectedChanges: 1,
    }),
  ];

  if (cnItemIds.length > 0) {
    stmts.push(db.$client.prepare(`
      UPDATE invoice_items
      SET status = 'cancelled',
          cancelled_by = ?,
          cancelled_at = datetime('now', '+6 hours'),
          cancel_reason = ?
      WHERE tenant_id = ?
        AND id IN (${cnItemPlaceholders})
        AND COALESCE(status, 'active') != 'cancelled'
        AND COALESCE(quantity, 1) <= COALESCE((
          SELECT SUM(cni.return_quantity)
          FROM billing_credit_note_items cni
          JOIN billing_credit_notes approved_cn
            ON approved_cn.id = cni.credit_note_id
           AND approved_cn.tenant_id = cni.tenant_id
          WHERE cni.tenant_id = invoice_items.tenant_id
            AND cni.invoice_item_id = invoice_items.id
            AND approved_cn.status = 'approved'
            AND COALESCE(approved_cn.is_active, 1) = 1
        ), 0)
    `).bind(
      userId,
      `Fully refunded by credit note ${cnNo}`,
      tenantId,
      ...cnItemIds,
    ));
  }
  stmts.push(...commissionAdjustment.statements);

  for (const cnItem of cnItems) {
    const invoiceItemId = Number(cnItem.invoice_item_id ?? 0);
    const returnQuantity = Math.max(0, Math.floor(Number(cnItem.return_quantity ?? 0)));
    if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0 || returnQuantity <= 0) continue;
    stmts.push(db.$client.prepare(`
      UPDATE diagnostic_performer_reserves
      SET status = 'cancelled',
          cancelled_at = datetime('now', '+6 hours'),
          cancelled_by = ?,
          cancel_reason = ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id IN (
        SELECT id
        FROM diagnostic_performer_reserves
        WHERE tenant_id = ?
          AND bill_id = ?
          AND invoice_item_id = ?
          AND status = 'reserved'
        ORDER BY unit_sequence ASC, id ASC
        LIMIT ?
      )
    `).bind(userId, `Credit note ${cnNo} approved`, tenantId, cn.bill_id, invoiceItemId, returnQuantity));
  }

  if (cashRefund > 0) {
    stmts.push(
      db.$client.prepare(`
        INSERT INTO emp_cash_transactions (
          tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount,
          reference_id, reference_type, payment_method, description
        ) VALUES (?, ?, ?, ?, 'SalesReturn', ?, ${creditNoteIdLookup}, 'credit_note', ?, ?)
      `).bind(
        tenantId,
        Number(userId),
        activeCounterSession?.counter_id ?? null,
        activeCounterSession?.id ?? null,
        cashRefund,
        tenantId,
        cnNo,
        payoutPaymentMethod,
        `Credit note ${cnNo}`,
      ),
      prepareFinancialBatchAssertion(db.$client, {
        tenantId: String(tenantId),
        operationKey: financialOperationKey,
        stepKey: 'cash_return',
        expectedChanges: 1,
      }),
      db.$client.prepare(`
        INSERT INTO cash_drawer_movements (
          tenant_id, counter_session_id, counter_id, employee_id,
          movement_type, amount, payment_method, reference_type, reference_id,
          description, created_by
        )
        SELECT ?, ?, ?, ?, 'cash_out', ?, 'cash', 'credit_note_refund', CAST(? AS TEXT), ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM cash_drawer_movements existing
          WHERE existing.tenant_id = ?
            AND existing.reference_type = 'credit_note_refund'
            AND existing.reference_id = CAST(? AS TEXT)
            AND existing.movement_type = 'cash_out'
        )
      `).bind(
        tenantId,
        activeCounterSession?.id ?? null,
        activeCounterSession?.counter_id ?? null,
        Number(userId),
        cashRefund,
        cnId,
        `Credit note ${cnNo} refund`,
        Number(userId),
        tenantId,
        cnId,
      ),
      db.$client.prepare(`
        UPDATE billing_credit_notes
        SET counter_id = ?, counter_session_id = ?
        WHERE id = ? AND tenant_id = ? AND status = 'approved'
      `).bind(
        activeCounterSession?.counter_id ?? null,
        activeCounterSession?.id ?? null,
        cnId,
        tenantId,
      ),
    );
  }

  stmts.push(
    db.$client.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'credit_note', ${creditNoteIdLookup}, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      tenantId,
      cnNo,
      ACCOUNTING_EVENT_TYPES.creditNoteIssued,
      today,
      JSON.stringify({
        creditNoteId: cnId,
        creditNoteNo: cnNo,
        billId: cn.bill_id,
        patientId: cn.patient_id,
        total: totalRefund,
        receivableReduction,
        cashRefund,
        doctorCommissionReversalAmount: commissionAdjustment.reversalAmount,
        doctorCommissionClawbackAmount: commissionAdjustment.clawbackAmount,
        affectedDoctorCommissionAccrualCount: commissionAdjustment.affectedAccrualCount,
        paymentMethod: payoutPaymentMethod,
        originalPaymentMethod,
        ...categoryTotals,
      }),
      String(userId),
    ),
    prepareFinancialBatchAssertion(db.$client, {
      tenantId: String(tenantId),
      operationKey: financialOperationKey,
      stepKey: 'accounting_event',
      expectedChanges: 1,
    }),
    prepareClearFinancialBatchAssertions(db.$client, String(tenantId), financialOperationKey),
  );

  const issuedAtUtc = new Date().toISOString();
  try {
    await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: cashRefund > 0 ? 'credit-note.cash-refund' : 'credit-note.approve',
      legacyStatements: stmts,
      canonical: async (options) => {
        const canonicalInput = await resolveLiveCreditNoteProjection(c.env.DB, {
          tenantId: String(tenantId),
          creditNoteId: cnId,
          creditNoteNo: String(cnNo),
          billId: Number(cn.bill_id),
          billInvoiceNo: String(bill.invoice_no ?? bill.id),
          reason: String(cn.reason ?? 'Credit note approved'),
          issuedAtUtc,
          cashRefund: 0,
          lines: cnItems
            .map((item: any) => ({
              invoiceItemId: Number(item.invoice_item_id ?? 0),
              amount: Number(item.total_amount ?? 0),
              reason: String(item.remarks ?? cn.reason ?? 'Credit note approved'),
            }))
            .filter((line: { invoiceItemId: number; amount: number }) => (
              Number.isInteger(line.invoiceItemId) && line.invoiceItemId > 0 && line.amount > 0
            )),
        });
        if (cashRefund === 0) return issueCreditNote(c.env.DB, canonicalInput, options);
        if (!activeCounterSession) {
          throw new Error('Active billing counter authority missing for credit-note cash refund');
        }
        const funding = await resolveLiveCreditNoteCashRefundFunding(c.env.DB, {
          tenantId: String(tenantId),
          creditNoteNo: String(cnNo),
          billId: Number(cn.bill_id),
          billInvoiceNo: String(bill.invoice_no ?? bill.id),
          cashRefund,
          refundedAtUtc: issuedAtUtc,
        });
        return issueCreditNoteWithCashRefund(c.env.DB, {
          ...canonicalInput,
          idempotencyKey: `legacy_live_credit_note_cash_refund:${cnNo}`,
          refundPublicId: funding.refundPublicId,
          cashRefundMinor: funding.amountMinor,
          payoutMethodCode: 'cash',
          legacyCounterId: Number(activeCounterSession.counter_id),
          legacyCounterSessionId: Number(activeCounterSession.id),
          refundSourceEvidenceSha256: funding.sourceEvidenceSha256,
          receiptSlices: funding.receiptSlices,
          allocationSlices: funding.allocationSlices,
          tenderAttributions: funding.tenderAttributions,
          cashRefundEventPublicId: await createDeterministicSourceId(
            'outevt',
            String(tenantId),
            'legacy_live_credit_note_cash_refund_accounting',
            String(cnNo),
          ),
          cashCustodyEventPublicId: await createDeterministicSourceId(
            'outevt',
            String(tenantId),
            'legacy_live_credit_note_cash_refund_custody',
            String(cnNo),
          ),
        }, options);
      },
    });
  } catch (error) {
    if (isFinancialBatchAssertionError(error)) {
      throw new HTTPException(409, {
        message: 'Credit note approval changed concurrently. Refresh and try again.',
      });
    }
    if (cashRefund > 0 && isCreditNoteCashRefundConflict(error)) {
      throw new HTTPException(409, {
        message: 'Cash refund payment authority is no longer available. Refresh and try again.',
      });
    }
    throw error;
  }

  queueAccountingPosting(c, tenantId);

  return c.json({
    message: 'Credit note approved',
    id: cnId,
    credit_note_no: cnNo,
    refund_amount: totalRefund,
    doctor_commission_reversal_amount: commissionAdjustment.reversalAmount,
    doctor_commission_clawback_amount: commissionAdjustment.clawbackAmount,
  });
});

// ─── POST /:id/reject — reject credit note ──────────────────────────────────

creditNotes.post('/:id/reject', requireRole(...CREDIT_NOTE_WRITE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const cnId = parseInt(c.req.param('id'));

  // Fetch the credit note
  const cn = await db.$client.prepare(
    'SELECT * FROM billing_credit_notes WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(cnId, tenantId).first<any>();
  if (!cn) throw new HTTPException(404, { message: 'Credit note not found' });

  // Only pending credit notes can be rejected
  if (cn.status !== 'pending') {
    throw new HTTPException(400, { message: `Credit note is already ${cn.status}. Only pending credit notes can be rejected.` });
  }

  const cnNo = cn.credit_note_no;

  const stmts: any[] = [
    // Update credit note status (atomic: only if still pending)
    db.$client.prepare(`
      UPDATE billing_credit_notes
      SET status = 'rejected', approved_by = ?, approved_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(userId, cnId, tenantId),

    // Audit log
    db.$client.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      )
      VALUES (?, ?, 'REJECT', 'billing_credit_notes', ?, ?, ?, NULL, NULL, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      userId,
      cnId,
      JSON.stringify({ status: 'pending' }),
      JSON.stringify({
        action: 'credit_note_rejected',
        creditNoteNo: cnNo,
        refundAmount: cn.refund_amount,
      }),
    )
  ];

  const batchResults = await db.$client.batch(stmts);

  // Verify the credit note was actually updated (race condition guard)
  const cnUpdateChanges = Number((batchResults[0] as any)?.meta?.changes ?? 0);
  if (cnUpdateChanges === 0) {
    throw new HTTPException(409, { message: 'Credit note status was changed concurrently. Please refresh and try again.' });
  }

  return c.json({ message: 'Credit note rejected', id: cnId, credit_note_no: cnNo });
});

export default creditNotes;

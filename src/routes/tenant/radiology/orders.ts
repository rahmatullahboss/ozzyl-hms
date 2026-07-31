import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId, parseId } from '../../../lib/context-helpers';
import { requireRole } from '../../../middleware/rbac';
import {
  createRequisitionSchema,
  markScannedSchema,
  cancelRequisitionSchema,
  requisitionQuerySchema,
} from '../../../schemas/radiology';
import { getNextSequence } from '../../../lib/sequence';
import { getNextInvoiceNumber } from '../../../lib/invoice-sequence';
import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from '../../../lib/diagnostic-billing';
import { createAuditLog } from '../../../lib/accounting-helpers';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../../lib/accounting-posting';
import { recordBillFinalizationSideEffects } from '../../../lib/billing-finalization';
import { getTodayGMT6 } from '../../../lib/date-utils';
import { resolveRadiologyBillingRow } from '../../../lib/diagnostic-catalog';
import { executeStrictFinancialMutation } from '../../../lib/canonical/strict-financial-mutation';
import { isFinancialBatchAssertionError } from '../../../lib/canonical/financial-batch-assertion';
import { buildLegacyLiveInvoiceSourceLineId } from '../../../lib/canonical/live-invoice-line-identity';
import { createRadiologyRequisitionBilling } from '../../../lib/canonical/commands/create-radiology-requisition-billing';
import {
  executeRadiologyOrderOriginalLegacy,
  prepareRadiologyOrderStrictContext,
  prepareRadiologyOrderStrictStatements,
  RadiologyOrderBillingError,
  type RadiologyOrderBillingContext,
  type RadiologyOrderBillingInput,
} from '../../../lib/canonical/radiology-order-billing';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  reserveMutationIdempotencyKey,
} from '../../../lib/request-idempotency';
import {
  RIS_CATALOG_MANAGE_ROLES,
  RIS_ORDER_CREATE_ROLES,
  RIS_PACS_MANAGE_ROLES,
  RIS_READ_ROLES,
  RIS_REPORT_DRAFT_ROLES,
  RIS_REPORT_FINALIZE_ROLES,
  RIS_SCAN_PERFORM_ROLES,
} from '../lab/_permissions';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// P0-15: doctors may NOT finalize radiology reports or modify the catalog.
// Use the granular role groupings from lab/_permissions.ts.
const RAD_READ  = RIS_READ_ROLES;
const RAD_WRITE = RIS_ORDER_CREATE_ROLES;       // requisition create
const RAD_SCAN  = RIS_SCAN_PERFORM_ROLES;        // scan performance
const RAD_REPORT_DRAFT = RIS_REPORT_DRAFT_ROLES;
const RAD_REPORT_FINALIZE = RIS_REPORT_FINALIZE_ROLES;
const RAD_CATALOG_MANAGE = RIS_CATALOG_MANAGE_ROLES;

function assertRadiologyBillCleared(row: Record<string, unknown>, workflow: string): void {
  const clearance = getDiagnosticBillingClearance(row);
  if (!clearance.cleared) {
    throw new HTTPException(409, {
      message: `Diagnostic bill payment required before ${workflow}. Bill #${clearance.billId ?? 'unknown'} is ${clearance.paymentStatus}; outstanding ${clearance.outstanding}.`,
    });
  }
}

function queueRadiologyAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post radiology billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}


function isRadiologyOrderCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical|mapping|idempotency|constraint|strict radiology|changed concurrently/i.test(message)) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST REQUISITIONS  (F-06: removed CAST from JOIN)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', requireRole(...RAD_READ), zValidator('query', requisitionQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { page, limit, status, patient_id, from_date, to_date, urgency, search } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let where = 'WHERE r.tenant_id = ? AND r.is_active = 1';
  const binds: unknown[] = [tenantId];

  if (status)     { where += ' AND r.order_status = ?'; binds.push(status); }
  if (patient_id) { where += ' AND r.patient_id = ?';   binds.push(patient_id); }
  if (from_date)  { where += ' AND r.imaging_date >= ?'; binds.push(from_date); }
  if (to_date)    { where += ' AND r.imaging_date <= ?'; binds.push(to_date); }
  if (urgency)    { where += ' AND r.urgency = ?';      binds.push(urgency); }
  // F-12: Server-side search by patient name or imaging item
  if (search)     { where += ' AND (p.name LIKE ? OR r.imaging_item_name LIKE ?)'; binds.push(`%${search}%`, `%${search}%`); }

  // F-12: count must also join patients when search is active
  const countSql   = search
    ? `SELECT COUNT(*) as total FROM radiology_requisitions r LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id ${where}`
    : `SELECT COUNT(*) as total FROM radiology_requisitions r ${where}`;
  const selectSql  = `
    SELECT r.id, r.patient_id, p.name as patient_name, r.imaging_type_name,
           r.imaging_item_name, r.urgency, r.order_status, r.imaging_date,
           r.is_scanned, r.is_report_saved, r.prescriber_name, r.created_at
    FROM radiology_requisitions r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    ${where}
    ORDER BY r.id DESC LIMIT ? OFFSET ?`;

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with c.env.DB.batch() for radiology orders listing.
  // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(countSql).bind(...binds),
    c.env.DB.prepare(selectSql).bind(...binds, limit, offset),
  ]);

  const total = (batchResults[0]?.results?.[0] as { total?: number })?.total ?? 0;
  return c.json({
    requisitions: batchResults[1]?.results ?? [],
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE REQUISITION
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/', requireRole(...RAD_WRITE), zValidator('json', createRequisitionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // ─── P0-17: idempotency key for requisition create ──────────────────────
  const idempotencyKey =
    typeof data.idempotencyKey === 'string' && data.idempotencyKey.length >= 8
      ? data.idempotencyKey
      : `ris-req:${tenantId}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const requestHash = await createIdempotencyRequestHash({
    patient_id: data.patient_id,
    visit_id: data.visit_id ?? null,
    admission_id: data.admission_id ?? null,
    imaging_item_id: data.imaging_item_id ?? null,
    imaging_type_id: data.imaging_type_id ?? null,
    imaging_date: data.imaging_date ?? null,
    urgency: data.urgency ?? 'normal',
  });
  const replay = await reserveMutationIdempotencyKey(c.env.DB, {
    tenantId: String(tenantId),
    mutationType: 'ris_requisition_create',
    idempotencyKey,
    requestHash,
    createdBy: userId,
    mismatchMessage: 'Radiology requisition idempotency key already used with different payload',
    conflictMessage: 'A duplicate radiology requisition is already in progress',
  });
  if (replay) return c.json(replay.responseBody, 200);

  const imagingDate = data.imaging_date ?? getTodayGMT6();
  const preparationInput: RadiologyOrderBillingInput = {
    tenantId: String(tenantId),
    userId: Number(userId),
    patientId: data.patient_id,
    visitId: data.visit_id ?? null,
    admissionId: data.admission_id ?? null,
    imagingTypeId: data.imaging_type_id ?? null,
    submittedImagingTypeName: data.imaging_type_name ?? null,
    imagingItemId: data.imaging_item_id ?? null,
    submittedImagingItemName: data.imaging_item_name ?? null,
    submittedProcedureCode: data.procedure_code ?? null,
    prescriberId: data.prescriber_id ?? null,
    prescriberName: data.prescriber_name ?? null,
    imagingDate,
    requestedAtUtc: new Date(`${imagingDate}T00:00:00+06:00`).toISOString(),
    requisitionRemarks: data.requisition_remarks ?? null,
    urgency: data.urgency ?? 'normal',
    wardName: data.ward_name ?? null,
    hasInsurance: Boolean(data.has_insurance),
    dependencies: {
      resolveBillingRow: (imagingItemId) => resolveRadiologyBillingRow(c.env.DB, tenantId, imagingItemId),
      nextAccessionNo: () => getNextSequence(c.env.DB, tenantId, 'radiology_accession', 'RADACC'),
      nextInvoiceNo: () => getNextInvoiceNumber(c.env.DB, tenantId, 'diagnostic'),
      assertAccountingPeriodOpen: (date) => assertAccountingPeriodOpen(
        c.env.DB,
        tenantId,
        date,
        'Radiology requisition billing',
      ),
    },
  };
  const contextRef: { current: RadiologyOrderBillingContext | null } = { current: null };
  const legacyIdsRef: { requisitionId: number | null; billId: number | null } = {
    requisitionId: null,
    billId: null,
  };

  try {
    const financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'radiology.billing.create',
      legacyExecutor: async () => {
        const legacy = await executeRadiologyOrderOriginalLegacy(c.env.DB, preparationInput);
        contextRef.current = legacy.context;
        legacyIdsRef.requisitionId = legacy.requisitionId;
        legacyIdsRef.billId = legacy.billId;
        return legacy.results;
      },
      strictAuthoritativeStatements: async () => {
        contextRef.current = await prepareRadiologyOrderStrictContext(c.env.DB, preparationInput);
        return prepareRadiologyOrderStrictStatements(c.env.DB, contextRef.current);
      },
      canonical: async (execution) => {
        const context = contextRef.current;
        const item = context?.imagingItem;
        if (!context || !item?.billingServiceItemId || context.total <= 0) {
          throw new Error('Canonical radiology order authority is unavailable');
        }
        return createRadiologyRequisitionBilling(c.env.DB, {
          tenantId: String(tenantId),
          commandIdempotencyKey: `radiology-order:${context.accessionNo}:${context.invoiceNo}`,
          accessionNo: context.accessionNo,
          invoiceNo: context.invoiceNo,
          legacyPatientId: context.patientId,
          imagingItemId: item.id,
          billingServiceItemId: item.billingServiceItemId,
          displayName: context.imagingItemName ?? item.name,
          totalMinor: item.pricePaisa,
          requestedAtUtc: context.requestedAtUtc,
          businessDate: context.imagingDate,
        }, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });

    const context = contextRef.current;
    if (!context) throw new Error('Committed radiology order billing context is unavailable');
    const committed = await c.env.DB.prepare(`
      SELECT
        r.id AS requisition_id,
        b.id AS bill_id,
        ii.id AS invoice_item_id
      FROM radiology_requisitions r
      JOIN bills b
        ON b.id=r.bill_id AND CAST(b.tenant_id AS TEXT)=CAST(r.tenant_id AS TEXT)
      LEFT JOIN invoice_items ii
        ON ii.bill_id=b.id AND ii.reference_id=r.id
       AND CAST(ii.tenant_id AS TEXT)=CAST(r.tenant_id AS TEXT)
      WHERE CAST(r.tenant_id AS TEXT)=? AND r.accession_no=? AND b.invoice_no=?
      ORDER BY ii.id DESC
      LIMIT 1
    `).bind(
      tenantId,
      context.accessionNo,
      context.invoiceNo,
    ).first<{
      requisition_id: number;
      bill_id: number;
      invoice_item_id: number | null;
    }>();
    const requisitionId = Number(committed?.requisition_id ?? legacyIdsRef.requisitionId ?? 0);
    const billId = Number(committed?.bill_id ?? legacyIdsRef.billId ?? 0);
    const invoiceItemId = Number(committed?.invoice_item_id ?? 0);
    if (!(requisitionId > 0) || !(billId > 0)) {
      throw new Error('Committed radiology requisition or bill could not be resolved');
    }
    if (financialExecution.mode === 'strict' && !(invoiceItemId > 0)) {
      throw new Error('Committed radiology invoice item could not be resolved');
    }

    if (context.total > 0) {
      await recordBillFinalizationSideEffects(c.env.DB, {
        tenantId,
        userId,
        patientId: context.patientId,
        visitId: context.visitId,
        billId,
        invoiceNo: context.invoiceNo,
        billDate: context.imagingDate,
        subtotal: context.total,
        discount: 0,
        total: context.total,
        categoryTotals: context.categoryTotals,
        extraPayload: { requisitionId },
        skipBillAccountingEvent: financialExecution.mode === 'strict',
        items: [{
          itemCategory: 'test',
          description: context.imagingItemName ?? context.imagingTypeName ?? 'Radiology service',
          lineTotal: context.total,
          referenceId: requisitionId,
          ...(financialExecution.mode === 'strict' && invoiceItemId > 0 && context.imagingItem?.billingServiceItemId
            ? {
                billItemId: invoiceItemId,
                canonicalSourceLineId: buildLegacyLiveInvoiceSourceLineId({
                  lineNumber: 1,
                  itemCategory: 'test',
                  referenceId: context.imagingItem.billingServiceItemId,
                }),
              }
            : {}),
        }],
      });
      queueRadiologyAccountingPosting(c, tenantId);
    }

    void createAuditLog(c.env, tenantId, userId, 'CREATE', 'radiology_requisitions', requisitionId, null, {
      accessionNo: context.accessionNo,
      imagingItemName: context.imagingItemName,
      total: context.total,
    });

    const responseBody: Record<string, unknown> = {
      id: requisitionId,
      accessionNo: context.accessionNo,
      billId,
      invoiceNo: context.invoiceNo,
      total: context.total,
      message: 'Requisition created',
    };
    await completeMutationIdempotencyKey(c.env.DB, {
      tenantId: String(tenantId),
      mutationType: 'ris_requisition_create',
      idempotencyKey,
      sourceId: requisitionId,
      responseBody,
    });
    return c.json(responseBody, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof RadiologyOrderBillingError) {
      throw new HTTPException(error.status, { message: error.message });
    }
    await markMutationIdempotencyKeyFailed(c.env.DB, {
      tenantId: String(tenantId),
      mutationType: 'ris_requisition_create',
      idempotencyKey,
    });
    if (isFinancialBatchAssertionError(error) || isRadiologyOrderCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'Radiology requisition changed concurrently or canonical authority is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET SINGLE REQUISITION  (F-06: removed CAST from JOIN)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/:id', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Requisition ID');

  const req = await c.env.DB.prepare(`
    SELECT r.*, p.name as patient_name, p.mobile as patient_phone
    FROM radiology_requisitions r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!req) throw new HTTPException(404, { message: 'Requisition not found' });
  return c.json({ requisition: req });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MARK AS SCANNED
// ═══════════════════════════════════════════════════════════════════════════════

app.patch('/:id/scan', requireRole(...RAD_SCAN), zValidator('json', markScannedSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'), 'Requisition ID');
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    `SELECT r.id, r.order_status, ${getDiagnosticBillingColumns('r')}
     FROM radiology_requisitions r
     ${getDiagnosticBillingJoin('r')}
     WHERE r.id = ? AND r.tenant_id = ?`,
  ).bind(id, tenantId).first<{ id: number; order_status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });
  assertRadiologyBillCleared(existing as Record<string, unknown>, 'radiology scan completion');
  if (existing.order_status === 'cancelled') throw new HTTPException(400, { message: 'Cannot scan a cancelled requisition' });
  if (existing.order_status === 'reported') throw new HTTPException(400, { message: 'Cannot scan a reported requisition' });

  await c.env.DB.prepare(`
    UPDATE radiology_requisitions SET
      is_scanned = 1, scanned_by = ?, scanned_on = datetime('now', '+6 hours'),
      scan_remarks = ?, film_type_id = ?, film_quantity = ?,
      order_status = 'scanned', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(
    userId,
    data.scan_remarks  ?? null,
    data.film_type_id  ?? null,
    data.film_quantity ?? null,
    id,
    tenantId,
  ).run();

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'radiology_requisitions', id, null, {
    action: 'scan',
    scan_remarks: data.scan_remarks,
    order_status: 'scanned',
  });

  return c.json({ success: true, message: 'Marked as scanned' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UN-SCAN (F-11: reverse scan marking)
// ═══════════════════════════════════════════════════════════════════════════════

app.patch('/:id/unscan', requireRole(...RAD_WRITE), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Requisition ID');

  const existing = await c.env.DB.prepare(
    'SELECT id, order_status, is_report_saved FROM radiology_requisitions WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first<{ id: number; order_status: string; is_report_saved: number }>();

  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });
  if (existing.order_status !== 'scanned') {
    throw new HTTPException(400, { message: `Cannot un-scan: current status is '${existing.order_status}'` });
  }
  if (existing.is_report_saved) {
    throw new HTTPException(400, { message: 'Cannot un-scan: a report has been saved for this requisition' });
  }

  await c.env.DB.prepare(`
    UPDATE radiology_requisitions SET
      is_scanned = 0, scanned_by = NULL, scanned_on = NULL,
      scan_remarks = NULL, film_type_id = NULL, film_quantity = NULL,
      order_status = 'pending', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ success: true, message: 'Scan marking reversed' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CANCEL REQUISITION  (F-10: save cancel_remarks to DB)
// ═══════════════════════════════════════════════════════════════════════════════

app.patch('/:id/cancel', requireRole(...RAD_WRITE), zValidator('json', cancelRequisitionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'), 'Requisition ID');
  const data = c.req.valid('json');
  const today = getTodayGMT6();

  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Radiology requisition cancellation');

  const existing = await c.env.DB.prepare(`
    SELECT r.id, r.order_status, r.bill_id,
           b.paid AS bill_paid, b.status AS bill_status
    FROM radiology_requisitions r
    LEFT JOIN bills b ON b.id = r.bill_id AND b.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ?
  `).bind(id, tenantId).first<{
    id: number;
    order_status: string;
    bill_id: number | null;
    bill_paid: number | null;
    bill_status: string | null;
  }>();

  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });
  if (existing.order_status === 'reported') throw new HTTPException(400, { message: 'Cannot cancel a reported requisition' });
  if (
    Number(existing.bill_paid ?? 0) > 0 ||
    ['paid', 'partially_paid'].includes(String(existing.bill_status ?? '').toLowerCase())
  ) {
    throw new HTTPException(409, {
      message: 'Cannot cancel radiology requisition after payment. Use credit note/refund workflow instead.',
    });
  }

  let cancelledAmount = 0;
  if (existing.bill_id) {
    const invoiceItem = await c.env.DB.prepare(`
      SELECT id, line_total
      FROM invoice_items
      WHERE bill_id = ?
        AND tenant_id = ?
        AND item_category = 'test'
        AND reference_id = ?
        AND COALESCE(status, 'active') != 'cancelled'
      ORDER BY id ASC
      LIMIT 1
    `).bind(existing.bill_id, tenantId, id).first<{ id: number; line_total: number | null }>();

    if (invoiceItem) {
      cancelledAmount = Math.max(0, Number(invoiceItem.line_total ?? 0));
      await c.env.DB.prepare(`
        UPDATE invoice_items
        SET status = 'cancelled',
            cancelled_by = ?,
            cancelled_at = datetime('now', '+6 hours'),
            cancel_reason = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(userId, data.cancel_remarks ?? 'Radiology requisition cancelled', invoiceItem.id, tenantId).run();

      const totals = await c.env.DB.prepare(
        "SELECT COALESCE(SUM(line_total), 0) as new_total FROM invoice_items WHERE bill_id = ? AND tenant_id = ? AND COALESCE(status, 'active') = 'active'",
      ).bind(existing.bill_id, tenantId).first<{ new_total: number | null }>();
      const newTotal = Math.max(0, Number(totals?.new_total ?? 0));

      await c.env.DB.prepare(`
        UPDATE bills
        SET total = ?,
            due = MAX(0, ? - paid),
            status = CASE
              WHEN ? <= 0 THEN 'cancelled'
              WHEN paid >= ? THEN 'paid'
              WHEN paid > 0 THEN 'partially_paid'
              ELSE 'open'
            END,
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(newTotal, newTotal, newTotal, newTotal, existing.bill_id, tenantId).run();

      if (cancelledAmount > 0) {
        await recordAccountingPostingEvent(c.env.DB, {
          tenantId,
          sourceType: 'billing_item_cancellation',
          sourceId: `${existing.bill_id}:radiology-requisition:${id}`,
          eventType: ACCOUNTING_EVENT_TYPES.billCancelled,
          eventDate: today,
          createdBy: userId,
          payload: {
            billId: existing.bill_id,
            itemIds: [invoiceItem.id],
            requisitionId: id,
            total: cancelledAmount,
            discount: 0,
            testBill: cancelledAmount,
            doctorVisitBill: 0,
            admissionBill: 0,
            operationBill: 0,
            medicineBill: 0,
            reason: data.cancel_remarks ?? 'Radiology requisition cancelled',
          },
        });
        queueRadiologyAccountingPosting(c, tenantId);
      }
    }
  }

  await c.env.DB.prepare(
    `UPDATE radiology_requisitions
     SET order_status = 'cancelled',
         billing_status = CASE WHEN bill_id IS NULL THEN billing_status ELSE 'cancelled' END,
         cancel_remarks = ?,
         is_active = 0,
         updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`,
  ).bind(data.cancel_remarks ?? null, id, tenantId).run();

  void createAuditLog(c.env, tenantId, userId, 'CANCEL', 'radiology_requisitions', id, null, {
    billId: existing.bill_id,
    cancelledAmount,
    reason: data.cancel_remarks,
  });

  return c.json({ success: true, message: 'Requisition cancelled' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE (soft)
// ═══════════════════════════════════════════════════════════════════════════════

app.delete('/:id', requireRole(...RAD_WRITE), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Requisition ID');

  const r = await c.env.DB.prepare(
    `UPDATE radiology_requisitions SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).run();

  if (!r.meta.changes) throw new HTTPException(404, { message: 'Requisition not found' });
  return c.json({ success: true });
});

export default app;

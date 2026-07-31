import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  createInvoiceSchema, createInvoiceReturnSchema,
  createDepositSchema, createReturnDepositSchema, createSettlementSchema,
  invoiceRepairSchema,
} from '../../../schemas/pharmacy';
import { getNextSequence } from '../../../lib/sequence';
import { getNextInvoiceNumber } from '../../../lib/invoice-sequence';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../../lib/pagination';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../../lib/accounting-posting';
import { getDb } from '../../../db';
import { requirePermission } from '../../../middleware/rbac';
import { recordEmpCashTransaction } from '../../../lib/emp-cash';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../../lib/billing-counter-session';
import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../../lib/date-utils';
import {
  createCanonicalPharmacyInvoice,
  CanonicalRefusalError,
} from '../../../lib/pharmacy-canonical';
import { createAuditLog } from '../../../lib/accounting-helpers';
import {
  reserveMutationIdempotencyKey,
  completeMutationIdempotencyKey,
  markMutationIdempotencyKeyFailed,
  createIdempotencyRequestHash,
} from '../../../lib/request-idempotency';

function getRowsWritten(result: { meta?: { rows_written?: number; changes?: number } }): number {
  return Number(result.meta?.rows_written ?? result.meta?.changes ?? 0);
}

const PHARM_READ_PERMISSION = 'pharmacy:read';
const PHARM_WRITE_PERMISSION = 'pharmacy:write';

const invoiceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function queuePharmacyAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post pharmacy accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

invoiceRoutes.get('/invoices', requirePermission(PHARM_READ_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status, from, to } = c.req.query();
  const { page, limit, offset } = getPagination(c);
  try {
    let where = 'WHERE inv.tenant_id = ? AND inv.is_active = 1';
    const params: (string | number)[] = [tenantId];
    if (patientId) { where += ' AND inv.patient_id = ?'; params.push(patientId); }
    if (status)    { where += ' AND inv.is_return = ?';   params.push(status === 'returned' ? 1 : 0); }
    if (from)      { where += ' AND date(inv.created_at) >= ?'; params.push(from); }
    if (to)        { where += ' AND date(inv.created_at) <= ?'; params.push(to); }
    const countResult = await db.$client.prepare(`SELECT COUNT(*) as total FROM pharmacy_invoices inv ${where}`).bind(...params).first<{ total: number }>();
    const { results } = await db.$client.prepare(`
      SELECT inv.* FROM pharmacy_invoices inv ${where} ORDER BY inv.created_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    return c.json({ invoices: results, meta: paginationMeta(page, limit, countResult?.total ?? 0) });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch invoices' }); }
});

invoiceRoutes.get('/invoices/:id', requirePermission(PHARM_READ_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    const inv = await db.$client.prepare(`SELECT * FROM pharmacy_invoices WHERE id = ? AND tenant_id = ?`).bind(id, tenantId).first();
    if (!inv) throw new HTTPException(404, { message: 'Invoice not found' });
    const { results: items } = await db.$client.prepare(`
      SELECT ii.*, i.name as item_name FROM pharmacy_invoice_items ii
      JOIN pharmacy_items i ON ii.item_id = i.id WHERE ii.invoice_id = ? AND ii.tenant_id = ?
    `).bind(id, tenantId).all();
    return c.json({ invoice: inv, items });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to fetch invoice' }); }
});

invoiceRoutes.post('/invoices', requirePermission(PHARM_WRITE_PERMISSION), zValidator('json', createInvoiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const invoiceDate = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, invoiceDate, 'Pharmacy invoice creation');

    let activeCounterSession: Awaited<ReturnType<typeof loadActiveBillingCounterSession>> = null;
    if (data.paidAmount > 0) {
      activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
        workstationId: getBillingWorkstationId(c),
        requireCurrentWorkstation: true,
      });
      if (!activeCounterSession) {
        throw new HTTPException(409, { message: 'Activate a billing/pharmacy counter before collecting pharmacy payment' });
      }
      if (data.counterId && Number(data.counterId) !== Number(activeCounterSession.counter_id)) {
        throw new HTTPException(409, { message: 'Selected pharmacy counter does not match the active counter session' });
      }
    }

    // F1 fix: Validate stock availability for each item before proceeding
    let totalCogs = 0;
    for (const item of data.items) {
      const stock = await db.$client.prepare(
        `SELECT available_qty, expiry_date, cost_price FROM pharmacy_stock WHERE id = ? AND tenant_id = ? AND is_active = 1`
      ).bind(item.stockId, tenantId).first<{ available_qty: number; expiry_date: string | null; cost_price: number | null }>();
      if (!stock) throw new HTTPException(400, { message: `Stock record ${item.stockId} not found` });
      if (stock.expiry_date && stock.expiry_date <= invoiceDate) {
        throw new HTTPException(400, { message: `Stock ID ${item.stockId} has expired (${stock.expiry_date}). Cannot dispense expired medicine.` });
      }
      if (stock.available_qty < item.quantity) {
        throw new HTTPException(400, { message: `Insufficient stock for stock ID ${item.stockId}. Available: ${stock.available_qty}, Requested: ${item.quantity}` });
      }
      totalCogs += item.quantity * Number(stock.cost_price ?? 0);
    }

    let subtotal = 0;
    const processedItems = data.items.map((item) => {
      const lineSubtotal = item.quantity * item.price;
      const discountAmt = Math.round(lineSubtotal * (item.discountPct / 100));
      const vatAmt = Math.round((lineSubtotal - discountAmt) * (item.vatPct / 100));
      const total = Math.round(lineSubtotal - discountAmt + vatAmt);
      subtotal += total;
      return { ...item, lineSubtotal, discountAmt, vatAmt, total };
    });
    const totalAmount = subtotal - data.discountAmount + data.vatAmount;
    const change = data.tender - data.paidAmount;
    const coveredAmount = data.paidAmount + data.creditAmount + data.depositDeductAmount;

    // F12 fix: Validate payment balance
    if (coveredAmount !== totalAmount) {
      throw new HTTPException(400, { message: 'Payment split (paid + credit + deposit) must equal total amount' });
    }
    if (data.paymentMode === 'cash' && data.paidAmount > 0 && data.tender > 0 && data.tender < data.paidAmount) {
      throw new HTTPException(400, { message: 'Tender amount cannot be less than paid cash amount' });
    }

    const invoiceNo = await getNextInvoiceNumber(c.env.DB, tenantId!, 'pharmacy');
    const invoiceStatus = data.creditAmount > 0 ? 'credit' : 'paid';
    const counterId = Number(activeCounterSession?.counter_id ?? data.counterId ?? 0) || null;
    const counterSessionId = activeCounterSession ? Number(activeCounterSession.id) : null;

    // Deduct stock FIRST — if any fails, no invoice is created
    const deductedStock: Array<{ stockId: number; quantity: number }> = [];
    try {
      for (const item of processedItems) {
        if (item.stockId) {
          const stockResult = await db.$client.prepare(
            `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND available_qty >= ?`
          ).bind(item.quantity, item.stockId, tenantId, item.quantity).run();
          if (getRowsWritten(stockResult) === 0) {
            throw new HTTPException(409, { message: `Stock depleted for item ${item.itemId} (concurrent sale). Please retry.` });
          }
          deductedStock.push({ stockId: item.stockId, quantity: item.quantity });
        }
      }
    } catch (stockError) {
      for (const s of deductedStock) {
        await db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
        ).bind(s.quantity, s.stockId, tenantId).run();
      }
      throw stockError;
    }

    // Create invoice AFTER stock deduction succeeds
    const invResult = await db.$client.prepare(`
      INSERT INTO pharmacy_invoices
        (invoice_no, patient_id, patient_visit_id, counter_id, counter_session_id, is_outdoor_patient, visit_type,
         prescriber_id, subtotal, discount_amount, discount_pct, vat_amount, total_amount,
         paid_amount, credit_amount, tender, change_amount, payment_mode, deposit_deduct_amount,
         status, paid_date, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      invoiceNo, data.patientId ?? null, data.patientVisitId ?? null, counterId, counterSessionId,
      data.isOutdoorPatient ? 1 : 0, data.visitType ?? null, data.prescriberId ?? null,
      subtotal, data.discountAmount, data.discountPct, data.vatAmount, totalAmount,
      data.paidAmount, data.creditAmount, data.tender, change > 0 ? change : 0,
      data.paymentMode, data.depositDeductAmount, invoiceStatus, data.paidAmount > 0 || data.depositDeductAmount > 0 ? invoiceDate : null,
      data.remarks ?? null, tenantId, userId,
    ).run();
    const invoiceId = invResult.meta.last_row_id;

    const batchStmts: D1PreparedStatement[] = [];
    for (const item of processedItems) {
      batchStmts.push(db.$client.prepare(`
        INSERT INTO pharmacy_invoice_items
          (invoice_id, item_id, stock_id, batch_no, expiry_date, quantity, mrp, price,
           subtotal, discount_pct, discount_amount, vat_pct, vat_amount, total_amount, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceId, item.itemId, item.stockId, item.batchNo, item.expiryDate ?? null,
        item.quantity, item.mrp, item.price, item.lineSubtotal, item.discountPct, item.discountAmt,
        item.vatPct, item.vatAmt, item.total, tenantId, userId));
      if (item.stockId) {
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, out_qty, price, tenant_id, created_by)
          VALUES (?, ?, 'sale_out', 'invoice', ?, ?, ?, ?, ?, ?)
        `).bind(item.itemId, item.stockId, invoiceId, item.batchNo, item.quantity, item.price, tenantId, userId));
      }
    }

    if (batchStmts.length > 0) await db.$client.batch(batchStmts);

    // Auto-create narcotic register entries for controlled substances
    const narcoticStmts: D1PreparedStatement[] = [];
    for (const item of processedItems) {
      const isNarcotic = await db.$client.prepare(
        `SELECT is_narcotic FROM pharmacy_items WHERE id = ? AND tenant_id = ?`
      ).bind(item.itemId, tenantId).first<{ is_narcotic: number }>();
      if (isNarcotic?.is_narcotic) {
        narcoticStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_narcotic_records
            (item_id, invoice_id, patient_id, prescriber_id, quantity_dispensed, date, remarks, tenant_id, created_by)
          VALUES (?, ?, ?, ?, ?, date('now', '+6 hours'), 'Auto-registered from invoice', ?, ?)
        `).bind(item.itemId, invoiceId, data.patientId ?? null, data.prescriberId ?? null, item.quantity, tenantId, userId));
      }
    }
    if (narcoticStmts.length > 0) await db.$client.batch(narcoticStmts);

    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'pharmacy_invoice',
      sourceId: String(invoiceId),
      eventType: ACCOUNTING_EVENT_TYPES.billCreated,
      eventDate: invoiceDate,
      payload: {
        billId: Number(invoiceId),
        invoiceNo,
        patientId: data.patientId ?? null,
        visitId: data.patientVisitId ?? null,
        total: totalAmount,
        discount: data.discountAmount,
        medicineBill: totalAmount + data.discountAmount,
        testBill: 0,
        doctorVisitBill: 0,
        admissionBill: 0,
        operationBill: 0,
        counterId,
        counterSessionId,
      },
      createdBy: userId,
    });

    if (data.paidAmount > 0) {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'pharmacy_invoice_payment',
        sourceId: String(invoiceId),
        eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
        eventDate: invoiceDate,
        payload: {
          amount: data.paidAmount,
          paymentMethod: data.paymentMode,
          invoiceNo,
          patientId: data.patientId ?? null,
          counterId,
          counterSessionId,
        },
        createdBy: userId,
      });

      await recordEmpCashTransaction(c.env.DB, tenantId, Number(userId), {
        transactionType: 'CashSales',
        amount: data.paidAmount,
        counterId: counterId ?? undefined,
        counterSessionId: counterSessionId ?? undefined,
        referenceId: Number(invoiceId),
        referenceType: 'pharmacy_invoice',
        paymentMethod: data.paymentMode,
        description: `Pharmacy invoice ${invoiceNo}`,
      });
    }

    if (data.depositDeductAmount > 0) {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'pharmacy_invoice_deposit_adjustment',
        sourceId: String(invoiceId),
        eventType: ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
        eventDate: invoiceDate,
        payload: {
          amount: data.depositDeductAmount,
          invoiceNo,
          patientId: data.patientId ?? null,
          counterId,
          counterSessionId,
        },
        createdBy: userId,
      });
    }

    if (totalCogs > 0) {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'pharmacy_invoice_cogs',
        sourceId: String(invoiceId),
        eventType: ACCOUNTING_EVENT_TYPES.pharmacySaleCogs,
        eventDate: invoiceDate,
        payload: {
          cogsAmount: totalCogs,
          invoiceNo,
          patientId: data.patientId ?? null,
        },
        createdBy: userId,
      });
    }
    queuePharmacyAccountingPosting(c, tenantId);

    return c.json({ message: 'Invoice created', id: invoiceId, invoiceNo, counterSessionId }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create invoice' }); }
});

/**
 * Phase 7 (fix/pharmacy-inventory) — Canonical invoice creation (P0-23).
 *
 * Single source of truth for new pharmacy invoice writes. Enforces:
 *   1. Idempotency key — replays return the same invoice
 *   2. Atomic stock decrement + invoice header + items + transactions + COGS
 *   3. "Pending repair" state — if commit fails mid-flight, the request is
 *      queued in `pharmacy_invoice_repair_queue` and a recovery endpoint
 *      (POST /invoices/repair-queue/:id/repair) can complete it.
 */
const canonicalCreateInvoiceSchema = createInvoiceSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

invoiceRoutes.post(
  '/invoices/v2',
  requirePermission(PHARM_WRITE_PERMISSION),
  zValidator('json', canonicalCreateInvoiceSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json');
    const idempotencyKey = c.req.header('Idempotency-Key') ?? data.idempotencyKey;

    if (idempotencyKey) {
      const requestHash = await createIdempotencyRequestHash({
        tenantId, userId, data, idempotencyKey,
      });
      const replay = await reserveMutationIdempotencyKey(c.env.DB, {
        tenantId, mutationType: 'pharmacy_invoice', idempotencyKey, requestHash,
        createdBy: userId,
        mismatchMessage: 'Idempotency key reuse with different invoice payload',
        conflictMessage: 'Pharmacy invoice with this idempotency key is already being processed',
      });
      if (replay) {
        return c.json({ ...(replay.responseBody as Record<string, unknown>), replayed: true }, 200);
      }
    }

    try {
      const result = await createCanonicalPharmacyInvoice(c.env, {
        tenantId, userId,
        patientId: data.patientId,
        patientVisitId: data.patientVisitId,
        counterId: data.counterId ?? null,
        prescriberId: data.prescriberId,
        isOutdoorPatient: data.isOutdoorPatient,
        visitType: data.visitType,
        discountAmount: data.discountAmount,
        discountPct: data.discountPct,
        vatAmount: data.vatAmount,
        paidAmount: data.paidAmount,
        creditAmount: data.creditAmount,
        tender: data.tender,
        paymentMode: data.paymentMode,
        depositDeductAmount: data.depositDeductAmount,
        remarks: data.remarks,
        idempotencyKey,
        items: data.items.map((it) => ({
          itemId: it.itemId,
          stockId: it.stockId,
          batchNo: it.batchNo,
          expiryDate: it.expiryDate,
          quantity: it.quantity,
          price: it.price,
          mrp: it.mrp,
          discountPct: it.discountPct,
          vatPct: it.vatPct,
        })),
      });
      if (idempotencyKey) {
        await completeMutationIdempotencyKey(c.env.DB, {
          tenantId, mutationType: 'pharmacy_invoice', idempotencyKey,
          sourceId: String(result.invoiceId),
          responseBody: { message: 'Invoice created', id: result.invoiceId, invoiceNo: result.invoiceNo, status: result.status },
        });
      }
      void createAuditLog(c.env, tenantId, userId, 'PHARMACY_INVOICE_CREATE', 'pharmacy_invoices', result.invoiceId, {
        invoiceNo: result.invoiceNo, totalAmount: result.totalAmount, status: result.status,
        replayed: result.replayed ?? false, pendingRepairReason: result.pendingRepairReason,
      });
      return c.json({
        message: result.status === 'pending_repair' ? 'Invoice committed partially; queued for repair' : 'Invoice created',
        id: result.invoiceId,
        invoiceNo: result.invoiceNo,
        totalAmount: result.totalAmount,
        status: result.status,
        pendingRepairReason: result.pendingRepairReason,
        replayed: result.replayed ?? false,
      }, result.status === 'pending_repair' ? 202 : 201);
    } catch (err) {
      if (idempotencyKey) {
        await markMutationIdempotencyKeyFailed(c.env.DB, {
          tenantId, mutationType: 'pharmacy_invoice', idempotencyKey,
        }).catch(() => undefined);
      }
      if (err instanceof CanonicalRefusalError) {
        throw new HTTPException(err.statusCode as 400, { message: err.message });
      }
      if (err instanceof HTTPException) throw err;
      console.error('[pharmacy] canonical invoice create failed', err);
      throw new HTTPException(500, { message: 'Failed to create invoice' });
    }
  },
);

/**
 * Repair endpoint — completes a pending_repair row by replaying the original
 * commit. Requires supervisor / admin permission.
 */
invoiceRoutes.get(
  '/invoices/repair-queue',
  requirePermission('pharmacy:invoice_repair'),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const status = c.req.query('status') ?? 'pending';
    const { results } = await db.$client.prepare(`
      SELECT id, invoice_no, reason, status, created_at, created_by
      FROM pharmacy_invoice_repair_queue
      WHERE tenant_id = ? AND status = ?
      ORDER BY created_at ASC LIMIT 200
    `).bind(tenantId, status).all();
    return c.json({ repairs: results, status });
  },
);

invoiceRoutes.post(
  '/invoices/repair-queue/:id/repair',
  requirePermission('pharmacy:invoice_repair'),
  zValidator('json', invoiceRepairSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid repair queue ID' });
    const body = c.req.valid('json');

    const row = await db.$client.prepare(
      `SELECT * FROM pharmacy_invoice_repair_queue WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<{
      id: number; status: string; invoice_no: string; payload_json: string; reason: string;
    }>();
    if (!row) throw new HTTPException(404, { message: 'Repair entry not found' });
    if (row.status !== 'pending') {
      throw new HTTPException(409, { message: `Repair entry already ${row.status}` });
    }

    let payload: any;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new HTTPException(500, { message: 'Repair entry has invalid payload_json; manual intervention required' });
    }
    if (!body.forceFinalize) {
      const claim = await db.$client.prepare(`
        UPDATE pharmacy_invoice_repair_queue
        SET status = 'repaired', repaired_invoice_id = 0, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?
        WHERE id = ? AND tenant_id = ? AND status = 'pending'
      `).bind(userId, body.notes, id, tenantId).run();
      if (Number(claim.meta?.changes ?? 0) === 0) {
        throw new HTTPException(409, { message: 'Repair entry is no longer pending' });
      }
      const result = await createCanonicalPharmacyInvoice(c.env, {
        ...payload,
        tenantId,
        userId,
      });
      if (result.status === 'pending_repair') {
        await db.$client.prepare(`
          UPDATE pharmacy_invoice_repair_queue
          SET status = 'pending', review_notes = ?
          WHERE id = ? AND tenant_id = ?
        `).bind(`Repair replay still failed: ${result.pendingRepairReason}`, id, tenantId).run();
        throw new HTTPException(503, { message: 'Repair replay still failing; manual intervention required' });
      }
      await db.$client.prepare(`
        UPDATE pharmacy_invoice_repair_queue
        SET repaired_invoice_id = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(result.invoiceId, id, tenantId).run();
      void createAuditLog(c.env, tenantId, userId, 'PHARMACY_INVOICE_REPAIR', 'pharmacy_invoice_repair_queue', id, {
        invoiceId: result.invoiceId, invoiceNo: result.invoiceNo, notes: body.notes,
      });
      return c.json({ message: 'Invoice repair completed', invoiceId: result.invoiceId, invoiceNo: result.invoiceNo });
    }
    await db.$client.prepare(`
      UPDATE pharmacy_invoice_repair_queue
      SET status = 'cancelled', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(userId, body.notes, id, tenantId).run();
    void createAuditLog(c.env, tenantId, userId, 'PHARMACY_INVOICE_REPAIR_CANCELLED', 'pharmacy_invoice_repair_queue', id, {
      notes: body.notes,
    });
    return c.json({ message: 'Repair entry force-finalized (cancelled)' });
  },
);

// ─── Invoice Returns ──────────────────────────────────────────────────────────

invoiceRoutes.get('/invoice-returns', requirePermission(PHARM_READ_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT r.*, inv.invoice_no FROM pharmacy_invoice_returns r
      JOIN pharmacy_invoices inv ON r.invoice_id = inv.id
      WHERE r.tenant_id = ? AND r.is_active = 1 ORDER BY r.return_date DESC
    `).bind(tenantId).all();
    return c.json({ returns: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch invoice returns' }); }
});

invoiceRoutes.post('/invoice-returns', requirePermission(PHARM_WRITE_PERMISSION), zValidator('json', createInvoiceReturnSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    // F4 fix: Validate invoice exists and belongs to tenant
    const invoice = await db.$client.prepare(
      `SELECT id, is_return FROM pharmacy_invoices WHERE id = ? AND tenant_id = ? AND is_active = 1`
    ).bind(data.invoiceId, tenantId).first<{ id: number; is_return: number }>();
    if (!invoice) throw new HTTPException(404, { message: 'Original invoice not found' });

    // F4 fix: Validate return quantities don't exceed original sold quantities
    const { results: origItems } = await db.$client.prepare(
      `SELECT id, item_id, quantity FROM pharmacy_invoice_items WHERE invoice_id = ? AND tenant_id = ?`
    ).bind(data.invoiceId, tenantId).all<{ id: number; item_id: number; quantity: number }>();
    const origItemMap = new Map(origItems.map(i => [i.id, i]));

    for (const returnItem of data.items) {
      const orig = origItemMap.get(returnItem.invoiceItemId);
      if (!orig) throw new HTTPException(400, { message: `Invoice item ${returnItem.invoiceItemId} not found in original invoice` });
      const previousReturn = await db.$client.prepare(`
        SELECT COALESCE(SUM(rii.quantity), 0) as returned_qty
        FROM pharmacy_invoice_return_items rii
        JOIN pharmacy_invoice_returns r ON r.id = rii.return_id AND r.tenant_id = rii.tenant_id
        WHERE rii.invoice_item_id = ?
          AND r.invoice_id = ?
          AND rii.tenant_id = ?
          AND r.is_active = 1
      `).bind(returnItem.invoiceItemId, data.invoiceId, tenantId).first<{ returned_qty?: number; amount?: number }>();
      const alreadyReturnedQty = Number(previousReturn?.returned_qty ?? previousReturn?.amount ?? 0);
      const remainingQty = Number(orig.quantity || 0) - alreadyReturnedQty;
      if (returnItem.quantity > remainingQty) {
        throw new HTTPException(400, { message: `Return qty (${returnItem.quantity}) exceeds remaining sold qty (${remainingQty}) for item ${returnItem.invoiceItemId}` });
      }
    }

    let totalReturn = 0;
    const processedItems = data.items.map((item) => {
      const sub = item.quantity * item.price;
      const disc = Math.round(sub * (item.discountPct / 100));
      const vat = Math.round((sub - disc) * (item.vatPct / 100));
      const total = sub - disc + vat;
      totalReturn += total;
      return { ...item, sub, disc, vat, total };
    });
    const creditNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_credit_note', 'CN');
    const retResult = await db.$client.prepare(`
      INSERT INTO pharmacy_invoice_returns (invoice_id, credit_note_no, return_date, total_amount, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(data.invoiceId, creditNo, data.returnDate, totalReturn, data.remarks ?? null, tenantId, userId).run();
    const returnId = retResult.meta.last_row_id;
    const batchStmts: D1PreparedStatement[] = [];
    for (const item of processedItems) {
      batchStmts.push(db.$client.prepare(`
        INSERT INTO pharmacy_invoice_return_items
          (return_id, invoice_item_id, item_id, stock_id, batch_no, quantity, price, subtotal, discount_pct, vat_amount, total_amount, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(returnId, item.invoiceItemId, item.itemId, item.stockId ?? null, item.batchNo ?? null, item.quantity, item.price, item.sub, item.discountPct, item.vat, item.total, item.remarks ?? null, tenantId, userId));
      if (item.stockId) {
        batchStmts.push(db.$client.prepare(`UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`).bind(item.quantity, item.stockId, tenantId));
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, in_qty, price, remarks, tenant_id, created_by)
          VALUES (?, ?, 'return_in', 'invoice_return', ?, ?, ?, ?, 'Customer return', ?, ?)
        `).bind(item.itemId, item.stockId, returnId, item.batchNo ?? null, item.quantity, item.price, tenantId, userId));
      }
    }
    batchStmts.push(db.$client.prepare(`UPDATE pharmacy_invoices SET is_return = 1, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`).bind(data.invoiceId, tenantId));
    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Invoice return created', id: returnId, creditNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create invoice return' }); }
});

/**
 * Phase 7 (fix/pharmacy-inventory) — Canonical invoice return (P0-23).
 *
 * Wraps header + items + stock increment + accounting post in a single
 * batched transaction with idempotency support.
 */
const canonicalReturnSchema = createInvoiceReturnSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

invoiceRoutes.post(
  '/invoice-returns/v2',
  requirePermission(PHARM_WRITE_PERMISSION),
  zValidator('json', canonicalReturnSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json');
    const idempotencyKey = c.req.header('Idempotency-Key') ?? data.idempotencyKey;

    if (idempotencyKey) {
      const requestHash = await createIdempotencyRequestHash({ tenantId, userId, data, idempotencyKey });
      const replay = await reserveMutationIdempotencyKey(c.env.DB, {
        tenantId, mutationType: 'pharmacy_invoice_return', idempotencyKey, requestHash,
        createdBy: userId,
        mismatchMessage: 'Idempotency key reuse with different invoice-return payload',
        conflictMessage: 'Pharmacy invoice return with this idempotency key is already being processed',
      });
      if (replay) return c.json({ ...(replay.responseBody as Record<string, unknown>), replayed: true }, 200);
    }

    const invoice = await db.$client.prepare(
      `SELECT id FROM pharmacy_invoices WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    ).bind(data.invoiceId, tenantId).first<{ id: number }>();
    if (!invoice) throw new HTTPException(404, { message: 'Original invoice not found' });

    const { results: origItems } = await db.$client.prepare(
      `SELECT id, item_id, quantity FROM pharmacy_invoice_items WHERE invoice_id = ? AND tenant_id = ?`,
    ).bind(data.invoiceId, tenantId).all<{ id: number; item_id: number; quantity: number }>();
    const origItemMap = new Map(origItems.map((i) => [i.id, i]));
    for (const returnItem of data.items) {
      const orig = origItemMap.get(returnItem.invoiceItemId);
      if (!orig) throw new HTTPException(400, { message: `Invoice item ${returnItem.invoiceItemId} not found in original invoice` });
      const previousReturn = await db.$client.prepare(`
        SELECT COALESCE(SUM(rii.quantity), 0) as returned_qty
        FROM pharmacy_invoice_return_items rii
        JOIN pharmacy_invoice_returns r ON r.id = rii.return_id AND r.tenant_id = rii.tenant_id
        WHERE rii.invoice_item_id = ? AND r.invoice_id = ? AND rii.tenant_id = ? AND r.is_active = 1
      `).bind(returnItem.invoiceItemId, data.invoiceId, tenantId).first<{ returned_qty: number }>();
      const remainingQty = Number(orig.quantity || 0) - Number(previousReturn?.returned_qty ?? 0);
      if (returnItem.quantity > remainingQty) {
        throw new HTTPException(400, { message: `Return qty (${returnItem.quantity}) exceeds remaining sold qty (${remainingQty})` });
      }
    }

    let totalReturn = 0;
    const processedItems = data.items.map((it) => {
      const sub = it.quantity * it.price;
      const disc = Math.round(sub * (it.discountPct / 100));
      const vat = Math.round((sub - disc) * (it.vatPct / 100));
      const total = sub - disc + vat;
      totalReturn += total;
      return { ...it, sub, disc, vat, total };
    });
    const creditNo = await getNextSequence(c.env.DB, tenantId, 'pharmacy_credit_note', 'CN');
    try {
      const retResult = await db.$client.prepare(`
        INSERT INTO pharmacy_invoice_returns (invoice_id, credit_note_no, return_date, total_amount, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(data.invoiceId, creditNo, data.returnDate, totalReturn, data.remarks ?? null, tenantId, userId).run();
      const returnId = Number(retResult.meta.last_row_id);

      const batchStmts: D1PreparedStatement[] = [];
      for (const item of processedItems) {
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_invoice_return_items
            (return_id, invoice_item_id, item_id, stock_id, batch_no, quantity, price, subtotal, discount_pct, vat_amount, total_amount, remarks, tenant_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(returnId, item.invoiceItemId, item.itemId, item.stockId ?? null, item.batchNo ?? null, item.quantity, item.price, item.sub, item.discountPct, item.vat, item.total, item.remarks ?? null, tenantId, userId));
        if (item.stockId) {
          batchStmts.push(db.$client.prepare(`UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`).bind(item.quantity, item.stockId, tenantId));
          batchStmts.push(db.$client.prepare(`
            INSERT INTO pharmacy_stock_transactions (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, in_qty, price, remarks, tenant_id, created_by)
            VALUES (?, ?, 'return_in', 'invoice_return', ?, ?, ?, ?, 'Customer return', ?, ?)
          `).bind(item.itemId, item.stockId, returnId, item.batchNo ?? null, item.quantity, item.price, tenantId, userId));
        }
      }
      batchStmts.push(db.$client.prepare(`UPDATE pharmacy_invoices SET is_return = 1, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`).bind(data.invoiceId, tenantId));
      await db.$client.batch(batchStmts);

      void createAuditLog(c.env, tenantId, userId, 'PHARMACY_INVOICE_RETURN', 'pharmacy_invoice_returns', returnId, {
        invoiceId: data.invoiceId, creditNo, totalReturn, itemCount: processedItems.length,
      });
      if (idempotencyKey) {
        await completeMutationIdempotencyKey(c.env.DB, {
          tenantId, mutationType: 'pharmacy_invoice_return', idempotencyKey,
          sourceId: String(returnId), responseBody: { id: returnId, creditNo, totalReturn, message: 'Invoice return created' },
        });
      }
      return c.json({ message: 'Invoice return created', id: returnId, creditNo, totalReturn, replayed: false }, 201);
    } catch (err) {
      if (idempotencyKey) {
        await markMutationIdempotencyKeyFailed(c.env.DB, {
          tenantId, mutationType: 'pharmacy_invoice_return', idempotencyKey,
        }).catch(() => undefined);
      }
      if (err instanceof HTTPException) throw err;
      console.error('[pharmacy] canonical return create failed', err);
      throw new HTTPException(500, { message: 'Failed to create invoice return' });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 5 — DEPOSITS & SETTLEMENTS
// ══════════════════════════════════════════════════════════════════════════════

invoiceRoutes.get('/deposits', requirePermission(PHARM_READ_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  try {
    let sql = `SELECT * FROM pharmacy_deposits WHERE tenant_id = ? AND is_active = 1`;
    const params: (string | number)[] = [tenantId];
    if (patientId) { sql += ' AND patient_id = ?'; params.push(patientId); }
    sql += ' ORDER BY created_at DESC';
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ deposits: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch deposits' }); }
});

invoiceRoutes.get('/deposits/balance/:patientId', requirePermission(PHARM_READ_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  try {
    const result = await db.$client.prepare(`
      SELECT COALESCE(SUM(CASE WHEN deposit_type = 'deposit' THEN amount ELSE -amount END), 0) as balance
      FROM pharmacy_deposits WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
    `).bind(patientId, tenantId).first<{ balance: number }>();
    return c.json({ balance: result?.balance ?? 0 });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch deposit balance' }); }
});

invoiceRoutes.post('/deposits', requirePermission(PHARM_WRITE_PERMISSION), zValidator('json', createDepositSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const depositNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_deposit', 'DEP');
    const result = await db.$client.prepare(`
      INSERT INTO pharmacy_deposits (deposit_no, patient_id, deposit_type, amount, payment_mode, remarks, tenant_id, created_by)
      VALUES (?, ?, 'deposit', ?, ?, ?, ?, ?)
    `).bind(depositNo, data.patientId, data.amount, data.paymentMode, data.remarks ?? null, tenantId, userId).run();
    return c.json({ message: 'Deposit recorded', id: result.meta.last_row_id, depositNo }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create deposit' }); }
});

invoiceRoutes.post('/deposits/return', requirePermission(PHARM_WRITE_PERMISSION), zValidator('json', createReturnDepositSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    // F7 fix: Atomic balance check + insert to prevent TOCTOU race
    // First calculate current balance
    const balance = await db.$client.prepare(`
      SELECT COALESCE(SUM(CASE WHEN deposit_type = 'deposit' THEN amount ELSE -amount END), 0) as balance
      FROM pharmacy_deposits WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
    `).bind(data.patientId, tenantId).first<{ balance: number }>();
    if ((balance?.balance ?? 0) < data.amount) throw new HTTPException(400, { message: 'Insufficient deposit balance' });
    const returnNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_deposit_return', 'DR');
    // Use batch to make the check+insert as tight as possible
    const stmts: D1PreparedStatement[] = [
      db.$client.prepare(`
        INSERT INTO pharmacy_deposits (deposit_no, patient_id, deposit_type, amount, payment_mode, remarks, tenant_id, created_by)
        SELECT ?, ?, 'return', ?, ?, ?, ?, ?
        WHERE (SELECT COALESCE(SUM(CASE WHEN deposit_type='deposit' THEN amount ELSE -amount END),0)
               FROM pharmacy_deposits WHERE patient_id=? AND tenant_id=? AND is_active=1) >= ?
      `).bind(returnNo, data.patientId, data.amount, data.paymentMode, data.remarks ?? null, tenantId, userId, data.patientId, tenantId, data.amount),
    ];
    const results = await db.$client.batch(stmts);
    const rowsWritten = results[0]?.meta?.rows_written ?? 0;
    if (rowsWritten === 0) throw new HTTPException(400, { message: 'Insufficient deposit balance (concurrent withdrawal)' });
    return c.json({ message: 'Deposit return recorded', returnNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to return deposit' }); }
});

invoiceRoutes.get('/settlements', requirePermission(PHARM_READ_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  try {
    let sql = `SELECT * FROM pharmacy_settlements WHERE tenant_id = ? AND is_active = 1`;
    const params: (string | number)[] = [tenantId];
    if (patientId) { sql += ' AND patient_id = ?'; params.push(patientId); }
    sql += ' ORDER BY settlement_date DESC';
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ settlements: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch settlements' }); }
});

invoiceRoutes.post('/settlements', requirePermission(PHARM_WRITE_PERMISSION), zValidator('json', createSettlementSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    // F11 fix: Validate patient has outstanding credit before settlement
    const outstandingCredit = await db.$client.prepare(`
      SELECT COALESCE(SUM(credit_amount), 0) as total_credit
      FROM pharmacy_invoices WHERE patient_id = ? AND tenant_id = ? AND is_active = 1 AND credit_amount > 0
    `).bind(data.patientId, tenantId).first<{ total_credit: number }>();
    if ((outstandingCredit?.total_credit ?? 0) <= 0) {
      throw new HTTPException(400, { message: 'Patient has no outstanding credit to settle' });
    }
    const settlementNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_settlement', 'STL');
    const result = await db.$client.prepare(`
      INSERT INTO pharmacy_settlements
        (settlement_no, patient_id, settlement_date, total_amount, paid_amount, refund_amount,
         deposit_deducted, payment_mode, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(settlementNo, data.patientId, data.settlementDate, data.totalAmount, data.paidAmount, data.refundAmount, data.depositDeducted, data.paymentMode, data.remarks ?? null, tenantId, userId).run();
    return c.json({ message: 'Settlement created', id: result.meta.last_row_id, settlementNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create settlement' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 6 — ADVANCED: Provisionals, Prescriptions, Counters, Narcotics, Write-offs, Requisitions
// ══════════════════════════════════════════════════════════════════════════════


export default invoiceRoutes;

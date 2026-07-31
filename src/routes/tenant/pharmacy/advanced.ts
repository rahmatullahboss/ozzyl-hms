import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  createCounterSchema, createProvisionalInvoiceSchema, createPrescriptionSchema,
  createNarcoticRecordSchema, createWriteOffSchema,
  createRequisitionSchema, createDispatchSchema,
  approvalActionSchema,
} from '../../../schemas/pharmacy';
import { getNextSequence } from '../../../lib/sequence';
import { getNextInvoiceNumber } from '../../../lib/invoice-sequence';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../../lib/pagination';
import { getDb } from '../../../db';
import { requireRole } from '../../../middleware/rbac';
import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../../lib/date-utils';
import { executeStrictFinancialMutation } from '../../../lib/canonical/strict-financial-mutation';
import { isFinancialBatchAssertionError } from '../../../lib/canonical/financial-batch-assertion';
import { settlePharmacySale } from '../../../lib/canonical/commands/settle-pharmacy-sale';
import { hydratePharmacySaleCanonicalAuthority } from '../../../lib/canonical/pharmacy-sale-authority';
import {
  executePharmacyProvisionalOriginalLegacy,
  PharmacyFinalizationError,
  preparePharmacyProvisionalStrictContext,
  preparePharmacyProvisionalStrictStatements,
  type PharmacyProvisionalFinalizationInput,
} from '../../../lib/canonical/pharmacy-provisional-finalization';
import {
  executePharmacyPrescriptionOriginalLegacy,
  preparePharmacyPrescriptionStrictContext,
  preparePharmacyPrescriptionStrictStatements,
  type PharmacyPrescriptionFinalizationInput,
} from '../../../lib/canonical/pharmacy-prescription-finalization';
import type { PharmacySaleContext } from '../../../lib/canonical/pharmacy-sale-types';

const PHARM_READ  = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;
const PHARM_WRITE = ['hospital_admin', 'pharmacist'] as const;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getRowsWritten(result: { meta?: { rows_written?: number; changes?: number } }): number {
  return Number(result.meta?.rows_written ?? result.meta?.changes ?? 0);
}

function isPharmacyCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical|mapping|inventory authority|balance|idempotency|constraint|concurrent|strict pharmacy/i.test(message)) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function rethrowPharmacyFinalizationError(error: unknown): never {
  if (error instanceof PharmacyFinalizationError) {
    throw new HTTPException(error.status as 400 | 404 | 409, { message: error.message });
  }
  if (isFinancialBatchAssertionError(error) || isPharmacyCanonicalConflict(error)) {
    throw new HTTPException(409, {
      message: 'Pharmacy finalization changed concurrently or canonical authority is unavailable. Refresh and try again.',
    });
  }
  throw error;
}

const advancedRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Counters ─────────────────────────────────────────────────────────────────

advancedRoutes.get('/counters', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`SELECT * FROM pharmacy_counters WHERE tenant_id = ? AND is_active = 1 ORDER BY name`).bind(tenantId).all();
    return c.json({ counters: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch counters' }); }
});

advancedRoutes.post('/counters', requireRole(...PHARM_WRITE), zValidator('json', createCounterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(`INSERT INTO pharmacy_counters (name, counter_type, tenant_id, created_by) VALUES (?, ?, ?, ?)`).bind(data.name, data.counterType, tenantId, userId).run();
    return c.json({ message: 'Counter created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create counter' }); }
});

// ─── Provisional Invoices ─────────────────────────────────────────────────────

advancedRoutes.get('/provisional-invoices', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  try {
    let sql = `SELECT * FROM pharmacy_provisional_invoices WHERE tenant_id = ? AND is_active = 1`;
    const params: (string | number)[] = [tenantId];
    if (patientId) { sql += ' AND patient_id = ?'; params.push(patientId); }
    sql += ' ORDER BY created_at DESC';
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ provisionalInvoices: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch provisional invoices' }); }
});

advancedRoutes.post('/provisional-invoices', requireRole(...PHARM_WRITE), zValidator('json', createProvisionalInvoiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    let subtotal = 0;
    const processedItems = data.items.map((item) => {
      const lineSub = item.quantity * item.price;
      const disc = Math.round(lineSub * (item.discountPct / 100));
      const vat = Math.round((lineSub - disc) * (item.vatPct / 100));
      const total = lineSub - disc + vat;
      subtotal += total;
      return { ...item, lineSub, disc, vat, total };
    });
    const discountAmount = Math.round(subtotal * (data.discountPct / 100));
    const totalAmount = subtotal - discountAmount;
    const provNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_provisional', 'PROV');

    const provResult = await db.$client.prepare(`
      INSERT INTO pharmacy_provisional_invoices
        (provisional_no, patient_id, patient_visit_id, counter_id, prescriber_id, visit_type,
         subtotal, discount_pct, discount_amount, total_amount, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(provNo, data.patientId, data.patientVisitId ?? null, data.counterId ?? null, data.prescriberId ?? null, data.visitType ?? null, subtotal, data.discountPct, discountAmount, totalAmount, data.remarks ?? null, tenantId, userId).run();
    const provId = provResult.meta.last_row_id;
    const batchStmts = processedItems.map((item) => db.$client.prepare(`
      INSERT INTO pharmacy_provisional_items
        (provisional_id, item_id, stock_id, batch_no, expiry_date, quantity, free_qty,
         price, sale_price, subtotal, discount_pct, discount_amount, vat_pct, vat_amount,
         total_amount, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(provId, item.itemId, item.stockId ?? null, item.batchNo ?? null, item.expiryDate ?? null, item.quantity, item.freeQty, item.price, item.salePrice, item.lineSub, item.discountPct, item.disc, item.vatPct, item.vat, item.total, item.remarks ?? null, tenantId, userId));
    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Provisional invoice created', id: provId, provNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create provisional invoice' }); }
});

// ─── Provisional → Final Invoice Conversion (IPD discharge) ──────────────────

const convertProvisionalSchema = z.object({
  paymentMode: z.enum(['cash', 'card', 'credit', 'mobile', 'deposit']).default('cash'),
  paidAmount: z.number().nonnegative().default(0),
  creditAmount: z.number().nonnegative().default(0),
  depositDeductAmount: z.number().nonnegative().default(0),
  tender: z.number().nonnegative().default(0),
  discountAmount: z.number().nonnegative().default(0),
  remarks: z.string().optional(),
  externalTransactionId: z.string().trim().min(1).optional(),
});

advancedRoutes.post('/provisional-invoices/:id/convert', requireRole(...PHARM_WRITE), zValidator('json', convertProvisionalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const provisionalId = Number.parseInt(c.req.param('id'), 10);
  if (Number.isNaN(provisionalId)) {
    throw new HTTPException(400, { message: 'Invalid provisional invoice ID' });
  }
  const data = c.req.valid('json');
  const businessDate = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, businessDate, 'Pharmacy invoice conversion');

  const preparationInput: PharmacyProvisionalFinalizationInput = {
    tenantId: String(tenantId),
    userId: Number(userId),
    provisionalId,
    businessDate,
    occurredAtUtc: new Date(`${businessDate}T00:00:00+06:00`).toISOString(),
    paymentMode: data.paymentMode,
    externalTransactionId: data.externalTransactionId ?? null,
    paidAmount: data.paidAmount,
    creditAmount: data.creditAmount,
    depositDeductAmount: data.depositDeductAmount,
    tender: data.tender,
    discountAmount: data.discountAmount,
    remarks: data.remarks ?? null,
    dependencies: {
      nextInvoiceNo: () => getNextInvoiceNumber(c.env.DB, tenantId, 'pharmacy'),
      hydrateCanonicalAuthority: (context) => hydratePharmacySaleCanonicalAuthority(c.env.DB, context),
    },
  };
  const contextRef: { current: PharmacySaleContext | null } = { current: null };
  const legacyInvoiceIdRef: { current: number | null } = { current: null };

  try {
    await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'pharmacy.billing.finalize',
      legacyExecutor: async () => {
        const legacy = await executePharmacyProvisionalOriginalLegacy(c.env.DB, preparationInput);
        contextRef.current = legacy.context;
        legacyInvoiceIdRef.current = legacy.invoiceId;
        return [legacy.invoiceId];
      },
      strictAuthoritativeStatements: async () => {
        contextRef.current = await preparePharmacyProvisionalStrictContext(c.env.DB, preparationInput);
        return preparePharmacyProvisionalStrictStatements(c.env.DB, contextRef.current);
      },
      canonical: async (execution) => {
        const context = contextRef.current;
        if (!context) throw new Error('Pharmacy provisional finalization context is unavailable');
        const canonicalContext = await hydratePharmacySaleCanonicalAuthority(c.env.DB, context);
        contextRef.current = canonicalContext;
        return settlePharmacySale(c.env.DB, canonicalContext, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });

    const context = contextRef.current;
    if (!context) throw new Error('Committed pharmacy provisional finalization context is unavailable');
    const invoice = await db.$client.prepare(
      'SELECT id FROM pharmacy_invoices WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1',
    ).bind(tenantId, context.invoiceNo).first<{ id: number }>();
    const invoiceId = Number(invoice?.id ?? legacyInvoiceIdRef.current ?? 0);
    if (!(invoiceId > 0)) throw new Error('Committed pharmacy invoice could not be resolved');

    return c.json({
      message: 'Provisional invoice converted to final invoice',
      invoiceId,
      invoiceNo: context.invoiceNo,
      totalAmount: context.total,
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    try {
      rethrowPharmacyFinalizationError(error);
    } catch (mapped) {
      if (mapped instanceof HTTPException) throw mapped;
    }
    throw new HTTPException(500, { message: 'Failed to convert provisional invoice' });
  }
});

// ─── Prescriptions ────────────────────────────────────────────────────────────

advancedRoutes.get('/prescriptions', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status } = c.req.query();
  try {
    let sql = `SELECT * FROM pharmacy_prescriptions WHERE tenant_id = ? AND is_active = 1`;
    const params: (string | number)[] = [tenantId];
    if (patientId) { sql += ' AND patient_id = ?'; params.push(patientId); }
    if (status)    { sql += ' AND status = ?';      params.push(status); }
    sql += ' ORDER BY created_at DESC';
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ prescriptions: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch prescriptions' }); }
});

advancedRoutes.get('/prescriptions/:id', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    const rx = await db.$client.prepare(`SELECT * FROM pharmacy_prescriptions WHERE id = ? AND tenant_id = ?`).bind(id, tenantId).first();
    if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
    const { results: items } = await db.$client.prepare(`
      SELECT pi.*, i.name as item_name FROM pharmacy_prescription_items pi
      LEFT JOIN pharmacy_items i ON pi.item_id = i.id WHERE pi.prescription_id = ? AND pi.tenant_id = ?
    `).bind(id, tenantId).all();
    return c.json({ prescription: rx, items });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to fetch prescription' }); }
});

advancedRoutes.post('/prescriptions', requireRole(...PHARM_WRITE), zValidator('json', createPrescriptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const rxNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_rx', 'RX');
    const rxResult = await db.$client.prepare(`
      INSERT INTO pharmacy_prescriptions (prescription_no, patient_id, patient_visit_id, prescriber_id, prescriber_name, notes, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(rxNo, data.patientId, data.patientVisitId ?? null, data.prescriberId ?? null, data.prescriberName ?? null, data.notes ?? null, tenantId, userId).run();
    const rxId = rxResult.meta.last_row_id;
    const batchStmts = data.items.map((item) => db.$client.prepare(`
      INSERT INTO pharmacy_prescription_items (prescription_id, item_id, item_name, generic_name, dosage, frequency, duration, quantity, route, instructions, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(rxId, item.itemId, item.itemName ?? null, item.genericName ?? null, item.dosage ?? null, item.frequency ?? null, item.duration ?? null, item.quantity, item.route ?? null, item.instructions ?? null, tenantId, userId));
    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Prescription created', id: rxId, rxNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create prescription' }); }
});

advancedRoutes.put('/prescriptions/:id/dispense', requireRole(...PHARM_WRITE), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    // F10 fix: Validate prescription exists and status
    const rx = await db.$client.prepare(`SELECT status FROM pharmacy_prescriptions WHERE id=? AND tenant_id=?`).bind(id, tenantId).first<{ status: string }>();
    if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
    if (rx.status === 'dispensed') throw new HTTPException(400, { message: 'Prescription already dispensed' });
    if (rx.status === 'cancelled') throw new HTTPException(400, { message: 'Cannot dispense a cancelled prescription' });
    await db.$client.prepare(`UPDATE pharmacy_prescriptions SET status='dispensed', updated_at=datetime('now', '+6 hours') WHERE id=? AND tenant_id=?`).bind(id, tenantId).run();
    return c.json({ message: 'Prescription marked as dispensed' });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to update prescription' }); }
});

// ─── Dispense prescription with invoice creation (full POS flow) ─────────────

const dispenseWithInvoiceSchema = z.object({
  paymentMode: z.enum(['cash', 'card', 'credit', 'mobile', 'deposit']).default('cash'),
  paidAmount: z.number().nonnegative().default(0),
  creditAmount: z.number().nonnegative().default(0),
  depositDeductAmount: z.number().nonnegative().default(0),
  tender: z.number().nonnegative().default(0),
  discountAmount: z.number().nonnegative().default(0),
  remarks: z.string().optional(),
  externalTransactionId: z.string().trim().min(1).optional(),
  stockSelections: z.array(z.object({
    itemId: z.number().int().positive(),
    stockId: z.number().int().positive(),
    quantity: z.number().positive(),
  })).optional(),
});

advancedRoutes.post('/prescriptions/:id/dispense-invoice', requireRole(...PHARM_WRITE), zValidator('json', dispenseWithInvoiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const prescriptionId = Number.parseInt(c.req.param('id'), 10);
  if (Number.isNaN(prescriptionId)) {
    throw new HTTPException(400, { message: 'Invalid prescription ID' });
  }
  const data = c.req.valid('json');
  const businessDate = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, businessDate, 'Pharmacy dispense invoice');

  const preparationInput: PharmacyPrescriptionFinalizationInput = {
    tenantId: String(tenantId),
    userId: Number(userId),
    prescriptionId,
    businessDate,
    occurredAtUtc: new Date(`${businessDate}T00:00:00+06:00`).toISOString(),
    paymentMode: data.paymentMode,
    externalTransactionId: data.externalTransactionId ?? null,
    paidAmount: data.paidAmount,
    creditAmount: data.creditAmount,
    depositDeductAmount: data.depositDeductAmount,
    tender: data.tender,
    discountAmount: data.discountAmount,
    remarks: data.remarks ?? null,
    stockSelections: data.stockSelections ?? null,
    dependencies: {
      nextInvoiceNo: () => getNextInvoiceNumber(c.env.DB, tenantId, 'pharmacy'),
      hydrateCanonicalAuthority: (context) => hydratePharmacySaleCanonicalAuthority(c.env.DB, context),
    },
  };
  const contextRef: { current: PharmacySaleContext | null } = { current: null };
  const legacyInvoiceIdRef: { current: number | null } = { current: null };

  try {
    await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'pharmacy.billing.finalize',
      legacyExecutor: async () => {
        const legacy = await executePharmacyPrescriptionOriginalLegacy(c.env.DB, preparationInput);
        contextRef.current = legacy.context;
        legacyInvoiceIdRef.current = legacy.invoiceId;
        return [legacy.invoiceId];
      },
      strictAuthoritativeStatements: async () => {
        contextRef.current = await preparePharmacyPrescriptionStrictContext(c.env.DB, preparationInput);
        return preparePharmacyPrescriptionStrictStatements(c.env.DB, contextRef.current);
      },
      canonical: async (execution) => {
        const context = contextRef.current;
        if (!context) throw new Error('Pharmacy prescription finalization context is unavailable');
        const canonicalContext = await hydratePharmacySaleCanonicalAuthority(c.env.DB, context);
        contextRef.current = canonicalContext;
        return settlePharmacySale(c.env.DB, canonicalContext, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });

    const context = contextRef.current;
    if (!context) throw new Error('Committed pharmacy prescription finalization context is unavailable');
    const invoice = await db.$client.prepare(
      'SELECT id FROM pharmacy_invoices WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1',
    ).bind(tenantId, context.invoiceNo).first<{ id: number }>();
    const invoiceId = Number(invoice?.id ?? legacyInvoiceIdRef.current ?? 0);
    if (!(invoiceId > 0)) throw new Error('Committed pharmacy invoice could not be resolved');

    return c.json({
      message: 'Prescription dispensed and invoice created',
      invoiceId,
      invoiceNo: context.invoiceNo,
      totalAmount: context.total,
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    try {
      rethrowPharmacyFinalizationError(error);
    } catch (mapped) {
      if (mapped instanceof HTTPException) throw mapped;
    }
    throw new HTTPException(500, { message: 'Failed to dispense prescription' });
  }
});

// ─── Narcotic Records ─────────────────────────────────────────────────────────

advancedRoutes.get('/narcotics', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = c.req.query('itemId');
  try {
    let sql = `SELECT n.*, i.name as item_name FROM pharmacy_narcotic_records n
               JOIN pharmacy_items i ON n.item_id = i.id WHERE n.tenant_id = ?`;
    const params: (string | number)[] = [tenantId];
    if (itemId) { sql += ' AND n.item_id = ?'; params.push(itemId); }
    sql += ' ORDER BY n.created_at DESC';
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ narcoticRecords: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch narcotic records' }); }
});

advancedRoutes.post('/narcotics', requireRole(...PHARM_WRITE), zValidator('json', createNarcoticRecordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(`
      INSERT INTO pharmacy_narcotic_records
        (item_id, invoice_id, patient_id, batch_no, quantity, buyer_name, doctor_name, nmc_number, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(data.itemId, data.invoiceId ?? null, data.patientId ?? null, data.batchNo ?? null, data.quantity, data.buyerName ?? null, data.doctorName ?? null, data.nmcNumber ?? null, data.remarks ?? null, tenantId, userId).run();
    return c.json({ message: 'Narcotic record created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create narcotic record' }); }
});

// ─── Write-offs ───────────────────────────────────────────────────────────────

advancedRoutes.get('/write-offs', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`SELECT * FROM pharmacy_write_offs WHERE tenant_id = ? AND is_active = 1 ORDER BY write_off_date DESC`).bind(tenantId).all();
    return c.json({ writeOffs: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch write-offs' }); }
});

advancedRoutes.post('/write-offs', requireRole(...PHARM_WRITE), zValidator('json', createWriteOffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    // F2 fix: Validate stock availability before write-off
    for (const item of data.items) {
      const stock = await db.$client.prepare(
        `SELECT available_qty FROM pharmacy_stock WHERE id = ? AND tenant_id = ? AND is_active = 1`
      ).bind(item.stockId, tenantId).first<{ available_qty: number }>();
      if (!stock) throw new HTTPException(400, { message: `Stock record ${item.stockId} not found` });
      if (stock.available_qty < item.quantity) {
        throw new HTTPException(400, { message: `Insufficient stock for write-off on stock ${item.stockId}. Available: ${stock.available_qty}` });
      }
    }
    let totalAmount = 0;
    const processedItems = data.items.map((item) => {
      const total = item.quantity * item.itemRate;
      totalAmount += total;
      return { ...item, total };
    });
    const writeOffNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_writeoff', 'WO');
    const woResult = await db.$client.prepare(`
      INSERT INTO pharmacy_write_offs (write_off_no, write_off_date, total_amount, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(writeOffNo, data.writeOffDate, totalAmount, data.remarks ?? null, tenantId, userId).run();
    const woId = woResult.meta.last_row_id;
    const batchStmts: D1PreparedStatement[] = [];
    for (const item of processedItems) {
      batchStmts.push(db.$client.prepare(`
        INSERT INTO pharmacy_write_off_items (write_off_id, stock_id, item_id, batch_no, quantity, item_rate, total_amount, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(woId, item.stockId, item.itemId, item.batchNo ?? null, item.quantity, item.itemRate, item.total, item.remarks ?? null, tenantId, userId));
      // Note: Stock deduction and transaction recording deferred to approval step
    }
    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Write-off created (pending approval)', id: woId, writeOffNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create write-off' }); }
});

// ─── Requisitions ─────────────────────────────────────────────────────────────

advancedRoutes.get('/requisitions', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`SELECT * FROM pharmacy_requisitions WHERE tenant_id = ? AND is_active = 1 ORDER BY requisition_date DESC`).bind(tenantId).all();
    return c.json({ requisitions: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch requisitions' }); }
});

advancedRoutes.post('/requisitions', requireRole(...PHARM_WRITE), zValidator('json', createRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const reqNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_requisition', 'REQ');
    const reqResult = await db.$client.prepare(`
      INSERT INTO pharmacy_requisitions (requisition_no, requesting_store, requisition_date, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(reqNo, data.requestingStore ?? null, data.requisitionDate, data.remarks ?? null, tenantId, userId).run();
    const reqId = reqResult.meta.last_row_id;
    const batchStmts = data.items.map((item) => db.$client.prepare(`
      INSERT INTO pharmacy_requisition_items (requisition_id, item_id, requested_qty, remarks, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(reqId, item.itemId, item.requestedQty, item.remarks ?? null, tenantId));
    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Requisition created', id: reqId, reqNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create requisition' }); }
});

// ─── Dispatches ───────────────────────────────────────────────────────────────

advancedRoutes.get('/dispatches', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`SELECT * FROM pharmacy_dispatches WHERE tenant_id = ? AND is_active = 1 ORDER BY dispatch_date DESC`).bind(tenantId).all();
    return c.json({ dispatches: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch dispatches' }); }
});

advancedRoutes.post('/dispatches', requireRole(...PHARM_WRITE), zValidator('json', createDispatchSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    // F3 fix: Validate stock availability before dispatch
    for (const item of data.items) {
      if (item.stockId) {
        const stock = await db.$client.prepare(
          `SELECT available_qty FROM pharmacy_stock WHERE id = ? AND tenant_id = ? AND is_active = 1`
        ).bind(item.stockId, tenantId).first<{ available_qty: number }>();
        if (!stock) throw new HTTPException(400, { message: `Stock record ${item.stockId} not found` });
        if (stock.available_qty < item.dispatchedQty) {
          throw new HTTPException(400, { message: `Insufficient stock for dispatch on stock ${item.stockId}. Available: ${stock.available_qty}` });
        }
      }
    }
    const dispNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_dispatch', 'DISP');

    // Deduct stock FIRST — if any fails, roll back prior deductions
    const deductedStock: Array<{ stockId: number; quantity: number }> = [];
    try {
      for (const item of data.items) {
        if (item.stockId) {
          const stockResult = await db.$client.prepare(
            `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND available_qty >= ?`
          ).bind(item.dispatchedQty, item.stockId, tenantId, item.dispatchedQty).run();
          if (getRowsWritten(stockResult) === 0) {
            throw new HTTPException(409, { message: `Stock depleted for item ${item.itemId} (concurrent operation). Please retry.` });
          }
          deductedStock.push({ stockId: item.stockId, quantity: item.dispatchedQty });
        }
      }
    } catch (stockError) {
      // Rollback: restore any already-deducted stock
      for (const s of deductedStock) {
        await db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
        ).bind(s.quantity, s.stockId, tenantId).run();
      }
      throw stockError;
    }

    // Create dispatch header + batch — rollback stock on failure
    try {
      const dispResult = await db.$client.prepare(`
        INSERT INTO pharmacy_dispatches (dispatch_no, requisition_id, source_store, target_store, dispatch_date, received_by, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(dispNo, data.requisitionId ?? null, data.sourceStore ?? null, data.targetStore ?? null, data.dispatchDate, data.receivedBy ?? null, data.remarks ?? null, tenantId, userId).run();
      const dispId = dispResult.meta.last_row_id;

      const batchStmts: D1PreparedStatement[] = [];
      for (const item of data.items) {
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_dispatch_items
            (dispatch_id, requisition_item_id, item_id, stock_id, batch_no, expiry_date, dispatched_qty, cost_price, sale_price, remarks, tenant_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(dispId, item.requisitionItemId ?? null, item.itemId, item.stockId ?? null, item.batchNo, item.expiryDate ?? null, item.dispatchedQty, item.costPrice, item.salePrice, item.remarks ?? null, tenantId, userId));
        if (item.stockId) {
          batchStmts.push(db.$client.prepare(`
            INSERT INTO pharmacy_stock_transactions (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, out_qty, price, remarks, tenant_id, created_by)
            VALUES (?, ?, 'dispatch_out', 'dispatch', ?, ?, ?, ?, 'Dispatched to store', ?, ?)
          `).bind(item.itemId, item.stockId, dispId, item.batchNo, item.dispatchedQty, item.costPrice, tenantId, userId));
        }
      }
      // Update requisition status if linked — partial vs full dispatch
      if (data.requisitionId) {
        const reqItems = await db.$client.prepare(
        `SELECT ri.item_id, ri.requested_qty,
                COALESCE((SELECT SUM(di.dispatched_qty) FROM pharmacy_dispatch_items di JOIN pharmacy_dispatches d ON di.dispatch_id = d.id WHERE d.requisition_id = ri.requisition_id AND di.item_id = ri.item_id AND d.tenant_id = ri.tenant_id), 0) as total_dispatched
         FROM pharmacy_requisition_items ri WHERE ri.requisition_id = ? AND ri.tenant_id = ?`
      ).bind(data.requisitionId, tenantId).all<{ requested_qty: number; total_dispatched: number }>();
      const allFulfilled = (reqItems.results || []).every((r) => r.total_dispatched >= r.requested_qty);
      const newStatus = allFulfilled ? 'dispatched' : 'partially_dispatched';
      batchStmts.push(db.$client.prepare(`UPDATE pharmacy_requisitions SET status=?, updated_at=datetime('now', '+6 hours') WHERE id=? AND tenant_id=?`).bind(newStatus, data.requisitionId, tenantId));
    }
    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Dispatch created', id: dispId, dispNo }, 201);
    } catch (batchError) {
      // Rollback: restore deducted stock
      for (const s of deductedStock) {
        await db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
        ).bind(s.quantity, s.stockId, tenantId).run();
      }
      throw batchError;
    }
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create dispatch' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F15 FIX — SOFT-DELETE (DEACTIVATE) ENDPOINTS FOR MASTER DATA
// ══════════════════════════════════════════════════════════════════════════════

const DEACTIVATABLE_TABLES: Record<string, string> = {
  categories: 'pharmacy_categories',
  generics: 'pharmacy_generics',
  'pharmacy-suppliers': 'pharmacy_suppliers',
  uom: 'pharmacy_uom',
  'packing-types': 'pharmacy_packing_types',
  racks: 'pharmacy_racks',
  items: 'pharmacy_items',
  counters: 'pharmacy_counters',
};

for (const [resource, table] of Object.entries(DEACTIVATABLE_TABLES)) {
  advancedRoutes.put(`/${resource}/:id/deactivate`, requireRole(...PHARM_WRITE), async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const id = c.req.param('id');
    try {
      const existing = await db.$client.prepare(
        `SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).first();
      if (!existing) throw new HTTPException(404, { message: `${resource} not found` });
      await db.$client.prepare(
        `UPDATE ${table} SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).run();
      return c.json({ message: `${resource} deactivated` });
    } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: `Failed to deactivate ${resource}` }); }
  });

  advancedRoutes.put(`/${resource}/:id/activate`, requireRole(...PHARM_WRITE), async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const id = c.req.param('id');
    try {
      const existing = await db.$client.prepare(
        `SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).first();
      if (!existing) throw new HTTPException(404, { message: `${resource} not found` });
      await db.$client.prepare(
        `UPDATE ${table} SET is_active = 1, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).run();
      return c.json({ message: `${resource} activated` });
    } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: `Failed to activate ${resource}` }); }
  });
}
// ═══════════════════════════════════════════════════════════════════
// BD Master Drug Database — Search endpoints (shared, no tenant_id)
// ═══════════════════════════════════════════════════════════════════

advancedRoutes.get('/master-drugs/search', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  try {
    const { results } = await db.$client.prepare(`
      SELECT d.id, d.brand_name, d.form, d.strength, d.price, d.pack_size,
             g.name as generic_name, co.name as company_name
      FROM master_drugs d
      LEFT JOIN master_generics g ON d.generic_id = g.id
      LEFT JOIN master_companies co ON d.company_id = co.id
      WHERE d.brand_name LIKE ? || '%'
      ORDER BY d.brand_name ASC
      LIMIT 15
    `).bind(q).all();
    return c.json({ results });
  } catch { throw new HTTPException(500, { message: 'Failed to search master drugs' }); }
});

advancedRoutes.get('/master-generics/search', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  try {
    const { results } = await db.$client.prepare(`
      SELECT id, name, indication, dose, pregnancy_category
      FROM master_generics
      WHERE name LIKE ? || '%'
      ORDER BY name ASC
      LIMIT 15
    `).bind(q).all();
    return c.json({ results });
  } catch { throw new HTTPException(500, { message: 'Failed to search master generics' }); }
});

advancedRoutes.get('/master-companies/search', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  try {
    const { results } = await db.$client.prepare(`
      SELECT id, name
      FROM master_companies
      WHERE name LIKE ? || '%'
      ORDER BY name ASC
      LIMIT 15
    `).bind(q).all();
    return c.json({ results });
  } catch { throw new HTTPException(500, { message: 'Failed to search master companies' }); }
});

// Get master drug database stats
advancedRoutes.get('/master-drugs/stats', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  try {
    const brands = await db.$client.prepare('SELECT COUNT(*) as count FROM master_drugs').first();
    const generics = await db.$client.prepare('SELECT COUNT(*) as count FROM master_generics').first();
    const companies = await db.$client.prepare('SELECT COUNT(*) as count FROM master_companies').first();
    return c.json({
      brands: brands?.count ?? 0,
      generics: generics?.count ?? 0,
      companies: companies?.count ?? 0,
    });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch master drug stats' }); }
});


export default advancedRoutes;

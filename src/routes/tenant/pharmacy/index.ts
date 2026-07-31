import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createMedicineSchema, updateMedicineSchema, createPurchaseSchema,
  createSupplierSchema, updateSupplierSchema, createSaleSchema, createPharmacyBillSchema,
  createTaxConfigSchema, updateTaxConfigSchema,
  createPriceHistorySchema, barcodeSchema,
  createDosageTemplateSchema, updateDosageTemplateSchema,
  approvalActionSchema, itemTypeSchema,
} from '../../../schemas/pharmacy';
import { getNextSequence } from '../../../lib/sequence';
import { calculateBillCategoryTotals } from '../../../lib/billing-category-totals';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../../lib/pagination';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../../lib/accounting-posting';
import { getDb } from '../../../db';
import { requireRole } from '../../../middleware/rbac';
import { recordEmpCashTransaction } from '../../../lib/emp-cash';
import { loadActiveBillingCounterSession } from '../../../lib/billing-counter-session';
import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../../lib/date-utils';

import masterRoutes from './master';
import stockRoutes from './stock';
import purchaseRoutes from './purchase';
import invoiceRoutes from './invoices';
import advancedRoutes from './advanced';
import {
  CanonicalRefusalError,
  emitDeprecationWarning,
  forwardLegacySaleToCanonical,
  forwardLegacyBillToCanonical,
} from '../../../lib/pharmacy-canonical';

const PHARM_READ  = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;
const PHARM_WRITE = ['hospital_admin', 'pharmacist'] as const;

const pharmacyRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routers
pharmacyRoutes.route('/', masterRoutes);
pharmacyRoutes.route('/', stockRoutes);
pharmacyRoutes.route('/', purchaseRoutes);
pharmacyRoutes.route('/', invoiceRoutes);
pharmacyRoutes.route('/', advancedRoutes);

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

// ─── MEDICINES (LEGACY) ──────────────────────────────────────────────────────
// The `medicines` table is the legacy stock model. New writes are FROZEN —
// we keep the routes operational so older clients do not break, but we emit
// a deprecation warning and route inventory reads through the canonical
// pharmacy_items view. P0-21 mandates the canonical model is the single
// source of truth; the legacy model is preserved here for backward-compat.

pharmacyRoutes.get('/medicines', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search') || '';
  const { page, limit, offset } = getPagination(c);

  try {
    let whereClause = 'WHERE m.tenant_id = ? AND m.is_active = 1';
    const params: (string | number)[] = [tenantId];

    if (search) { const escaped = search.replace(/[%_]/g, '\\$&'); whereClause += " AND (m.name LIKE ? ESCAPE '\\' OR m.generic_name LIKE ? ESCAPE '\\')"; params.push(`%${escaped}%`, `%${escaped}%`); }

    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM medicines m ${whereClause}`
    ).bind(...params).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const medicines = await db.$client.prepare(`
      SELECT m.*, COALESCE(SUM(b.quantity_available), 0) as stock_qty
      FROM medicines m
      LEFT JOIN medicine_stock_batches b ON m.id = b.medicine_id AND b.tenant_id = m.tenant_id
      ${whereClause}
      GROUP BY m.id ORDER BY m.name LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({ medicines: medicines.results, meta: paginationMeta(page, limit, total) });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch medicines' });
  }
});

pharmacyRoutes.post('/medicines', requireRole(...PHARM_WRITE), zValidator('json', createMedicineSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'POST /api/pharmacy/medicines',
    mutationType: 'legacy_medicine_create',
    payload: { name: data.name },
  });

  const db = getDb(c.env.DB);
  try {
    const result = await db.$client.prepare(
      `INSERT INTO medicines (name, generic_name, company, unit, price, reorder_level, quantity, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
    ).bind(data.name, data.genericName ?? null, data.company ?? null, data.unit ?? null, data.salePrice, data.reorderLevel, tenantId).run();
    return c.json({ message: 'Medicine added (legacy model — prefer POST /api/pharmacy/items)', id: result.meta.last_row_id }, 201);
  } catch {
    throw new HTTPException(500, { message: 'Failed to add medicine' });
  }
});

pharmacyRoutes.put('/medicines/:id', requireRole(...PHARM_WRITE), zValidator('json', updateMedicineSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'PUT /api/pharmacy/medicines/:id',
    mutationType: 'legacy_medicine_update',
    payload: { id },
  });

  const db = getDb(c.env.DB);
  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM medicines WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Medicine not found' });

    await db.$client.prepare(
      `UPDATE medicines SET name = ?, generic_name = ?, company = ?, unit = ?, price = ?, reorder_level = ?
       WHERE id = ? AND tenant_id = ?`,
    ).bind(
      data.name         ?? existing['name'],
      data.genericName  !== undefined ? data.genericName  : existing['generic_name'],
      data.company      !== undefined ? data.company      : existing['company'],
      data.unit         !== undefined ? data.unit         : existing['unit'],
      data.salePrice    !== undefined ? data.salePrice    : existing['price'],
      data.reorderLevel !== undefined ? data.reorderLevel : existing['reorder_level'],
      id, tenantId,
    ).run();
    return c.json({ message: 'Medicine updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update medicine' });
  }
});

// GET /api/pharmacy/medicines/:id/stock — batch-wise stock for one medicine
pharmacyRoutes.get('/medicines/:id/stock', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const batches = await db.$client.prepare(
      `SELECT * FROM medicine_stock_batches WHERE medicine_id = ? AND tenant_id = ? ORDER BY expiry_date ASC`,
    ).bind(id, tenantId).all();
    return c.json({ batches: batches.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch stock batches' });
  }
});

// ─── SUPPLIERS ────────────────────────────────────────────────────────────────

pharmacyRoutes.get('/suppliers', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const suppliers = await db.$client.prepare(
      'SELECT * FROM suppliers WHERE tenant_id = ? ORDER BY name',
    ).bind(tenantId).all();
    return c.json({ suppliers: suppliers.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch suppliers' });
  }
});

pharmacyRoutes.post('/suppliers', requireRole(...PHARM_WRITE), zValidator('json', createSupplierSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'POST /api/pharmacy/suppliers',
    mutationType: 'legacy_supplier_create',
    payload: { name: data.name },
  });
  const db = getDb(c.env.DB);
  try {
    const result = await db.$client.prepare(
      `INSERT INTO suppliers (name, mobile_number, address, notes, tenant_id) VALUES (?, ?, ?, ?, ?)`,
    ).bind(data.name, data.mobileNumber ?? null, data.address ?? null, data.notes ?? null, tenantId).run();
    return c.json({ message: 'Supplier added (legacy model — prefer POST /api/pharmacy/pharmacy-suppliers)', id: result.meta.last_row_id }, 201);
  } catch {
    throw new HTTPException(500, { message: 'Failed to add supplier' });
  }
});

pharmacyRoutes.put('/suppliers/:id', requireRole(...PHARM_WRITE), zValidator('json', updateSupplierSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'PUT /api/pharmacy/suppliers/:id',
    mutationType: 'legacy_supplier_update',
    payload: { id },
  });
  const db = getDb(c.env.DB);
  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Supplier not found' });

    await db.$client.prepare(
      `UPDATE suppliers SET name = ?, mobile_number = ?, address = ?, notes = ?, updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`,
    ).bind(
      data.name         ?? existing['name'],
      data.mobileNumber !== undefined ? data.mobileNumber : existing['mobile_number'],
      data.address      !== undefined ? data.address      : existing['address'],
      data.notes        !== undefined ? data.notes        : existing['notes'],
      id, tenantId,
    ).run();
    return c.json({ message: 'Supplier updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update supplier' });
  }
});

// ─── PURCHASES ───────────────────────────────────────────────────────────────

pharmacyRoutes.get('/purchases', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { supplierId, from, to } = c.req.query();

  try {
    let query = `
      SELECT mp.*, s.name as supplier_name, COUNT(mpi.id) as item_count
      FROM medicine_purchases mp
      LEFT JOIN suppliers s ON mp.supplier_id = s.id
      LEFT JOIN medicine_purchase_items mpi ON mp.id = mpi.purchase_id
      WHERE mp.tenant_id = ?`;
    const params: (string | number)[] = [tenantId!];

    if (supplierId) { query += ' AND mp.supplier_id = ?'; params.push(supplierId); }
    if (from)       { query += ' AND mp.purchase_date >= ?'; params.push(from); }
    if (to)         { query += ' AND mp.purchase_date <= ?'; params.push(to); }

    query += ' GROUP BY mp.id ORDER BY mp.purchase_date DESC';
    const purchases = await db.$client.prepare(query).bind(...params).all();
    return c.json({ purchases: purchases.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch purchases' });
  }
});

pharmacyRoutes.post('/purchases', requireRole(...PHARM_WRITE), zValidator('json', createPurchaseSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'POST /api/pharmacy/purchases',
    mutationType: 'legacy_purchase_create',
    payload: { supplierId: data.supplierId, itemCount: data.items?.length ?? 0 },
  });

  const db = getDb(c.env.DB);
  try {
    const purchaseNo = await getNextSequence(c.env.DB, tenantId!, 'purchase', 'PUR');

    // Calculate totals
    const subtotal = data.items.reduce((s, i) => s + i.quantity * i.purchasePrice, 0);
    const total = subtotal - data.discount;

    const purchaseResult = await db.$client.prepare(`
      INSERT INTO medicine_purchases
        (purchase_no, supplier_id, purchase_date, subtotal, discount_total, total_amount, paid_amount, due_amount, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(purchaseNo, data.supplierId, data.purchaseDate, subtotal, data.discount, total, total, 0, tenantId, userId).run();

    const purchaseId = purchaseResult.meta.last_row_id;

    // Batch all item inserts + stock updates for atomicity
    const batchStmts: D1PreparedStatement[] = [];

    for (const item of data.items) {
      const lineTotal = item.quantity * item.purchasePrice;

      batchStmts.push(
        db.$client.prepare(`
          INSERT INTO medicine_purchase_items
            (purchase_id, medicine_id, batch_no, expiry_date, quantity, purchase_price, sale_price, line_total, tenant_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(purchaseId, item.medicineId, item.batchNo, item.expiryDate, item.quantity, item.purchasePrice, item.salePrice, lineTotal, tenantId),
      );

      batchStmts.push(
        db.$client.prepare(`
          INSERT INTO medicine_stock_batches
            (medicine_id, batch_no, expiry_date, quantity_received, quantity_available, purchase_price, sale_price, tenant_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(item.medicineId, item.batchNo, item.expiryDate, item.quantity, item.quantity, item.purchasePrice, item.salePrice, tenantId),
      );

      batchStmts.push(
        db.$client.prepare(
          `UPDATE medicines SET price = ?, quantity = quantity + ? WHERE id = ? AND tenant_id = ?`,
        ).bind(item.salePrice, item.quantity, item.medicineId, tenantId),
      );

      batchStmts.push(
        db.$client.prepare(`
          INSERT INTO medicine_stock_movements
            (medicine_id, movement_type, quantity, unit_cost, unit_price, reference_type, reference_id, movement_date, tenant_id, created_by)
          VALUES (?, 'purchase_in', ?, ?, ?, 'purchase', ?, ?, ?, ?)
        `).bind(item.medicineId, item.quantity, item.purchasePrice, item.salePrice, purchaseId, data.purchaseDate, tenantId, userId),
      );
    }

    await db.$client.batch(batchStmts);

    // Record accounting posting
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'pharmacy_purchase',
      sourceId: String(purchaseId),
      eventType: ACCOUNTING_EVENT_TYPES.pharmacyPurchase,
      eventDate: data.purchaseDate,
      payload: {
        totalAmount: total,
        supplierId: data.supplierId,
        paymentMethod: 'cash', // Default to cash for now as per code
        isCredit: false,
      },
      createdBy: userId,
    });
    queuePharmacyAccountingPosting(c, tenantId);

    return c.json({ message: 'Purchase recorded', purchaseId, purchaseNo }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to record purchase' });
  }
});

// ─── SALES (LEGACY — DEPRECATED, P0-22) ───────────────────────────────────────
// POST /api/pharmacy/sales historically wrote to the legacy `medicines` /
// `medicine_stock_batches` / `pharmacy_sales` tables. The canonical model
// (pharmacy_items / pharmacy_stock / pharmacy_invoices) is now the single
// source of truth, so this endpoint forwards writes to the canonical service.
// On refusal it returns 410 Gone. The legacy read surface and historical data
// are kept untouched — only writes are redirected.

pharmacyRoutes.post('/sales', requireRole(...PHARM_WRITE), zValidator('json', createSaleSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'POST /api/pharmacy/sales',
    mutationType: 'legacy_pharmacy_sale',
    payload: { itemCount: data.items?.length ?? 0, patientId: data.patientId ?? null },
  });

  try {
    const result = await forwardLegacySaleToCanonical(c.env, {
      tenantId,
      userId,
      patientId: data.patientId ?? null,
      discount: data.discount ?? 0,
      paymentMode: 'cash',
      items: data.items.map((i) => ({
        medicineId: i.medicineId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      remarks: 'Forwarded from legacy /api/pharmacy/sales',
    });
    return c.json({
      message: 'Sale recorded (forwarded to canonical invoice service)',
      invoiceId: result.invoiceId,
      invoiceNo: result.invoiceNo,
      replayed: result.replayed ?? false,
    }, 201);
  } catch (err) {
    if (err instanceof CanonicalRefusalError) {
      throw new HTTPException(410, { message: `Legacy /sales deprecated: ${err.message}` });
    }
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(500, { message: 'Failed to record sale' });
  }
});

// POST /api/pharmacy/billing — LEGACY (DEPRECATED, P0-22). Same redirect
// semantics as /sales: forward to canonical invoice service; on refusal
// return 410 Gone.
pharmacyRoutes.post('/billing', requireRole(...PHARM_WRITE), zValidator('json', createPharmacyBillSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  emitDeprecationWarning(c.env, {
    tenantId, userId,
    route: 'POST /api/pharmacy/billing',
    mutationType: 'legacy_pharmacy_billing',
    payload: { itemCount: data.items?.length ?? 0, patientId: data.patientId ?? null },
  });

  try {
    const result = await forwardLegacyBillToCanonical(c.env, {
      tenantId,
      userId,
      patientId: data.patientId ?? null,
      discount: data.discount ?? 0,
      paymentMethod: (data.paymentMethod ?? 'cash') as 'cash' | 'bkash' | 'bank' | 'other',
      items: data.items.map((i) => ({
        medicineId: i.medicineId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    });
    return c.json({
      message: 'Pharmacy bill created (forwarded to canonical invoice service)',
      invoiceId: result.invoiceId,
      invoiceNo: result.invoiceNo,
      replayed: result.replayed ?? false,
    }, 201);
  } catch (err) {
    if (err instanceof CanonicalRefusalError) {
      throw new HTTPException(410, { message: `Legacy /billing deprecated: ${err.message}` });
    }
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(500, { message: 'Failed to create pharmacy bill' });
  }
});


// ─── ALERTS ───────────────────────────────────────────────────────────────────

pharmacyRoutes.get('/alerts/low-stock', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const items = await db.$client.prepare(`
      SELECT i.id, i.name, i.reorder_level,
             COALESCE(SUM(s.available_qty), 0) as stock_qty
      FROM pharmacy_items i
      LEFT JOIN pharmacy_stock s ON i.id = s.item_id AND s.tenant_id = i.tenant_id AND s.is_active = 1
      WHERE i.tenant_id = ? AND i.is_active = 1
      GROUP BY i.id
      HAVING stock_qty <= i.reorder_level
      ORDER BY stock_qty ASC
    `).bind(tenantId).all();
    return c.json({ alerts: items.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch low stock alerts' });
  }
});

pharmacyRoutes.get('/alerts/expiring', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const days = Math.max(0, Math.min(365, Number(c.req.query('days') || 30)));
  try {
    const batches = await db.$client.prepare(`
      SELECT s.id, s.item_id, i.name as item_name,
             s.batch_no, s.available_qty, s.expiry_date
      FROM pharmacy_stock s
      JOIN pharmacy_items i ON s.item_id = i.id
      WHERE s.tenant_id = ? AND s.available_qty > 0
        AND s.is_active = 1
        AND s.expiry_date IS NOT NULL
        AND julianday(s.expiry_date) - julianday('now') <= ?
      ORDER BY s.expiry_date ASC
    `).bind(tenantId, days).all();
    return c.json({ alerts: batches.results, daysWindow: days });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch expiring stock alerts' });
  }
});

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

pharmacyRoutes.get('/summary', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  try {
    // Current stock value (investment) = sum of (available_qty × cost_price) from pharmacy_stock
    const stockValue = await db.$client.prepare(`
      SELECT COALESCE(SUM(available_qty * cost_price), 0) as total
      FROM pharmacy_stock WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId).first<{ total: number }>();

    // Total income from invoices (paid invoices, not returns)
    const invoiceIncome = await db.$client.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM pharmacy_invoices WHERE tenant_id = ? AND is_return = 0 AND is_active = 1
    `).bind(tenantId).first<{ total: number }>();

    // Cost of goods sold = sum of (quantity × cost_price) from invoice items joined with stock
    const cogs = await db.$client.prepare(`
      SELECT COALESCE(SUM(ii.quantity * COALESCE(s.cost_price, 0)), 0) as total
      FROM pharmacy_invoice_items ii
      LEFT JOIN pharmacy_stock s ON s.id = ii.stock_id AND s.tenant_id = ?
      WHERE ii.tenant_id = ? AND ii.item_status != 'returned'
    `).bind(tenantId, tenantId).first<{ total: number }>();

    // Count of distinct active medicines/items
    const totalItems = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM pharmacy_items WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId).first<{ count: number }>();

    // Low stock count (items below reorder level)
    const lowStock = await db.$client.prepare(`
      SELECT COUNT(DISTINCT i.id) as count
      FROM pharmacy_items i
      LEFT JOIN pharmacy_stock s ON s.item_id = i.id AND s.tenant_id = i.tenant_id AND s.is_active = 1
      WHERE i.tenant_id = ? AND i.is_active = 1
      GROUP BY i.id
      HAVING COALESCE(SUM(s.available_qty), 0) <= COALESCE(i.reorder_level, 10)
    `).bind(tenantId).all<{ count: number }>();

    // Expiring within 90 days
    const expiring = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM pharmacy_stock
      WHERE tenant_id = ? AND is_active = 1 AND available_qty > 0
        AND expiry_date IS NOT NULL
        AND expiry_date <= date('now', '+90 days')
    `).bind(tenantId).first<{ count: number }>();

    // Today's sales (admin monitor widget)
    const todaySalesRow = await db.$client.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total,
             COUNT(*) as cnt
      FROM pharmacy_invoices
      WHERE tenant_id = ? AND is_return = 0 AND is_active = 1
        AND date(created_at, '+6 hours') = date(?)
    `).bind(tenantId, today).first<{ total: number; cnt: number }>();

    const investment = stockValue?.total ?? 0;
    const income = invoiceIncome?.total ?? 0;
    const costOfGoods = cogs?.total ?? 0;
    const todaySales = todaySalesRow?.total ?? 0;
    const todaySalesCount = todaySalesRow?.cnt ?? 0;
    const grossMargin = todaySales > 0
      ? parseFloat((((todaySales - costOfGoods * (todaySales / Math.max(income, 1))) / todaySales) * 100).toFixed(1))
      : 0;

    return c.json({
      totalInvestment: investment,
      totalIncome: income,
      totalCostOfGoodsSold: costOfGoods,
      grossProfit: income - costOfGoods,
      totalMedicines: totalItems?.count ?? 0,
      lowStockCount: lowStock?.results?.length ?? 0,
      expiringCount: expiring?.count ?? 0,
      todaySales,
      todaySalesCount,
      grossMargin,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch pharmacy summary' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — MASTER DATA (Categories, Generics, Items, UOM, Packing, Racks)
// Suppliers use the enhanced pharmacy_suppliers table
// ══════════════════════════════════════════════════════════════════════════════

// ============================================================
// PATIENT BILLING VIEWS
// ============================================================

// GET /api/pharmacy/patient/:patientId/billing-summary
// Returns totals for invoices, provisional, and deposit balance for a patient
pharmacyRoutes.get('/patient/:patientId/billing-summary', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'), 10);
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid Patient ID' });

  // Patient info
  const patient = await db.$client
    .prepare('SELECT id, name, email, mobile, patient_code FROM patients WHERE id = ? AND tenant_id = ?')
    .bind(patientId, tenantId)
    .first<{ id: number; name: string; email: string; mobile: string; patient_code: string }>();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Invoice totals
  const invoiceSummary = await db.$client
    .prepare(`
      SELECT
        COUNT(*) as total_invoices,
        COALESCE(SUM(total_amount), 0) as total_billed,
        COALESCE(SUM(paid_amount),  0) as total_paid,
        COALESCE(SUM(credit_amount),0) as total_credit
      FROM pharmacy_invoices
      WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
    `)
    .bind(patientId, tenantId)
    .first<{ total_invoices: number; total_billed: number; total_paid: number; total_credit: number }>();

  // Provisional totals
  const provisionalSummary = await db.$client
    .prepare(`
      SELECT
        COUNT(*) as total_provisional,
        COALESCE(SUM(total_amount), 0) as provisional_amount
      FROM pharmacy_provisional_invoices
      WHERE patient_id = ? AND tenant_id = ? AND status = 'active' AND is_active = 1
    `)
    .bind(patientId, tenantId)
    .first<{ total_provisional: number; provisional_amount: number }>();

  // Deposit balance
  const depositSummary = await db.$client
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN deposit_type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposited,
        COALESCE(SUM(CASE WHEN deposit_type = 'return'  THEN amount ELSE 0 END), 0) as total_returned,
        COALESCE(SUM(CASE WHEN deposit_type = 'deduct'  THEN amount ELSE 0 END), 0) as total_deducted
      FROM pharmacy_deposits
      WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
    `)
    .bind(patientId, tenantId)
    .first<{ total_deposited: number; total_returned: number; total_deducted: number }>();

  const depositBalance =
    (depositSummary?.total_deposited || 0) -
    (depositSummary?.total_returned || 0) -
    (depositSummary?.total_deducted || 0);

  return c.json({
    patient,
    billing_summary: {
      total_invoices:     invoiceSummary?.total_invoices    ?? 0,
      total_billed:       invoiceSummary?.total_billed       ?? 0,
      total_paid:         invoiceSummary?.total_paid         ?? 0,
      total_credit:       invoiceSummary?.total_credit       ?? 0,
      total_provisional:  provisionalSummary?.total_provisional  ?? 0,
      provisional_amount: provisionalSummary?.provisional_amount ?? 0,
      deposit_balance:    depositBalance,
      outstanding_amount:
        (invoiceSummary?.total_credit   || 0) +
        (provisionalSummary?.provisional_amount || 0),
    },
  });
});

// GET /api/pharmacy/patient/:patientId/bill-history
// Paginated invoice list for a patient
pharmacyRoutes.get('/patient/:patientId/bill-history', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'), 10);
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid Patient ID' });

  const page  = parseInt(c.req.query('page')  ?? '1',  10);
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = (page - 1) * limit;

  const { results } = await db.$client
    .prepare(`
      SELECT
        id, invoice_no, total_amount, paid_amount, credit_amount,
        status, payment_mode, print_count, created_at, remarks
      FROM pharmacy_invoices
      WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(patientId, tenantId, limit, offset)
    .all();

  const totalRow = await db.$client
    .prepare('SELECT COUNT(*) as total FROM pharmacy_invoices WHERE patient_id = ? AND tenant_id = ? AND is_active = 1')
    .bind(patientId, tenantId)
    .first<{ total: number }>();

  return c.json({
    data: results,
    pagination: { page, limit, total: totalRow?.total ?? 0 },
  });
});

// GET /api/pharmacy/patient/:patientId/provisional
// Open provisional (credit) invoices for a patient
pharmacyRoutes.get('/patient/:patientId/provisional', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'), 10);
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid Patient ID' });

  const { results } = await db.$client
    .prepare(`
      SELECT pi.*, p.name as patient_name
      FROM pharmacy_provisional_invoices pi
      LEFT JOIN patients p ON pi.patient_id = p.id AND p.tenant_id = pi.tenant_id
      WHERE pi.patient_id = ? AND pi.tenant_id = ? AND pi.status = 'active' AND pi.is_active = 1
      ORDER BY pi.created_at DESC
    `)
    .bind(patientId, tenantId)
    .all();

  return c.json({ data: results, total: results.length });
});

// GET /api/pharmacy/patient/:patientId/deposits
// Deposit history + running balance for a patient
pharmacyRoutes.get('/patient/:patientId/deposits', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'), 10);
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid Patient ID' });

  const { results } = await db.$client
    .prepare(`
      SELECT * FROM pharmacy_deposits
      WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `)
    .bind(patientId, tenantId)
    .all();

  const balanceRow = await db.$client
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN deposit_type = 'deposit' THEN amount
                         WHEN deposit_type IN ('return','deduct') THEN -amount
                         ELSE 0 END), 0) as balance
      FROM pharmacy_deposits
      WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
    `)
    .bind(patientId, tenantId)
    .first<{ balance: number }>();

  return c.json({
    data: results,
    deposit_balance: balanceRow?.balance ?? 0,
  });
});

// ============================================================
// INVOICE RECEIPT & PRINT TRACKING
// ============================================================

// GET /api/pharmacy/invoices/:id/receipt
// Full invoice details for receipt printing (joins patient + items + generics)
pharmacyRoutes.get('/invoices/:id/receipt', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid invoice ID' });

  const invoice = await db.$client
    .prepare(`
      SELECT
        inv.*,
        p.name   as patient_name,
        p.patient_code,
        p.mobile as patient_mobile,
        emp.name as prescriber_name
      FROM pharmacy_invoices inv
      LEFT JOIN patients p       ON inv.patient_id     = p.id      AND p.tenant_id   = inv.tenant_id
      LEFT JOIN employees emp    ON inv.prescriber_id  = emp.id    AND emp.tenant_id  = inv.tenant_id
      WHERE inv.id = ? AND inv.tenant_id = ?
    `)
    .bind(id, tenantId)
    .first();

  if (!invoice) throw new HTTPException(404, { message: 'Invoice not found' });

  const { results: items } = await db.$client
    .prepare(`
      SELECT
        ii.*,
        pi.name       as item_name,
        pg.name       as generic_name
      FROM pharmacy_invoice_items ii
      JOIN pharmacy_items pi   ON ii.item_id    = pi.id AND pi.tenant_id = ii.tenant_id
      LEFT JOIN pharmacy_generics pg ON pi.generic_id  = pg.id AND pg.tenant_id = pi.tenant_id
      WHERE ii.invoice_id = ? AND ii.tenant_id = ?
      ORDER BY ii.id
    `)
    .bind(id, tenantId)
    .all();

  return c.json({ invoice, items });
});

// PUT /api/pharmacy/invoices/:id/print-count — increment print tracking
pharmacyRoutes.put('/invoices/:id/print-count', requireRole(...PHARM_WRITE), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid invoice ID' });

  await db.$client
    .prepare('UPDATE pharmacy_invoices SET print_count = print_count + 1 WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .run();

  return c.json({ message: 'Print count updated' });
});

// PUT /api/pharmacy/deposits/:id/print-count — increment deposit print tracking
pharmacyRoutes.put('/deposits/:id/print-count', requireRole(...PHARM_WRITE), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid deposit ID' });

  // ensure print_count column exists (was added in migration 0062)
  await db.$client
    .prepare('UPDATE pharmacy_deposits SET print_count = print_count + 1 WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .run();

  return c.json({ message: 'Print count updated' });
});

// ============================================================
// PURCHASE ORDER EDIT
// ============================================================

// PUT /api/pharmacy/purchase-orders/:id — edit a draft/pending PO
pharmacyRoutes.put('/purchase-orders/:id', requireRole(...PHARM_WRITE), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = (c.get('jwtPayload') as { id: number }).id;
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid PO ID' });

  const body = await c.req.json();

  // Only allow editing pending/active POs
  const existing = await db.$client
    .prepare('SELECT id, status FROM pharmacy_purchase_orders WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Purchase Order not found' });
  if (!['pending', 'active', 'partial'].includes(existing.status)) {
    throw new HTTPException(400, { message: `Cannot edit a PO with status: ${existing.status}` });
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.remarks       !== undefined) { updates.push('remarks = ?');        params.push(body.remarks ?? null); }
  if (body.delivery_date !== undefined) { updates.push('delivery_date = ?');  params.push(body.delivery_date ?? null); }
  if (body.status === 'cancelled') {
    updates.push('status = ?', 'cancelled_by = ?', 'cancelled_at = ?', 'cancel_remarks = ?');
    params.push('cancelled', userId, new Date().toISOString(), body.cancel_remarks ?? null);
  }

  if (updates.length === 0) return c.json({ message: 'No changes provided' }, 400);

  updates.push('updated_at = ?', 'updated_by = ?');
  params.push(new Date().toISOString(), userId, id, tenantId);

  await db.$client
    .prepare(`UPDATE pharmacy_purchase_orders SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
    .bind(...(params as unknown[]))
    .run();

  return c.json({ message: 'Purchase Order updated successfully' });
});

// ============================================================
// PHARMACY REPORTS
// ============================================================

// GET /api/pharmacy/reports/stock — stock value report
pharmacyRoutes.get('/reports/stock', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { search, expiryFilter } = c.req.query();

  let query = `
    SELECT
      s.id,
      pi.name        as item_name,
      pg.name        as generic_name,
      pc.name        as category_name,
      s.batch_no,
      s.expiry_date,
      s.available_qty,
      s.cost_price,
      s.mrp,
      (s.available_qty * s.cost_price) as stock_value
    FROM pharmacy_stock s
    JOIN pharmacy_items pi     ON s.item_id    = pi.id AND pi.tenant_id = s.tenant_id
    LEFT JOIN pharmacy_generics pg ON pi.generic_id = pg.id AND pg.tenant_id = pi.tenant_id
    LEFT JOIN pharmacy_categories pc ON pi.category_id = pc.id AND pc.tenant_id = pi.tenant_id
    WHERE s.tenant_id = ? AND s.available_qty > 0 AND s.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (search) {
    query += ` AND (pi.name LIKE ? OR s.batch_no LIKE ? OR pg.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Expiry filter
  if (expiryFilter === 'expired') {
    query += ` AND s.expiry_date < date('now', '+6 hours')`;
  } else if (expiryFilter === 'expiring30') {
    query += ` AND s.expiry_date BETWEEN date('now', '+6 hours') AND date('now', '+30 days')`;
  } else if (expiryFilter === 'expiring90') {
    query += ` AND s.expiry_date BETWEEN date('now', '+6 hours') AND date('now', '+90 days')`;
  } else if (expiryFilter === 'ok') {
    query += ` AND (s.expiry_date IS NULL OR s.expiry_date > date('now', '+90 days'))`;
  }

  query += ` ORDER BY pi.name, s.expiry_date`;

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Summary aggregations
  const summaryRow = await db.$client
    .prepare(`
      SELECT
        COUNT(DISTINCT pi.id) as items,
        COALESCE(SUM(s.available_qty * s.cost_price), 0) as total_value,
        SUM(CASE WHEN pi.reorder_level IS NOT NULL AND s.available_qty <= pi.reorder_level THEN 1 ELSE 0 END) as low_stock,
        SUM(CASE WHEN s.expiry_date <= date('now', '+90 days') AND s.expiry_date IS NOT NULL THEN 1 ELSE 0 END) as expiring
      FROM pharmacy_stock s
      JOIN pharmacy_items pi ON s.item_id = pi.id AND pi.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.available_qty > 0 AND s.is_active = 1
    `)
    .bind(tenantId)
    .first<{ items: number; total_value: number; low_stock: number; expiring: number }>();

  return c.json({
    data: results,
    summary: summaryRow ?? { items: 0, total_value: 0, low_stock: 0, expiring: 0 },
  });
});

// GET /api/pharmacy/reports/sales — sales report by date range
pharmacyRoutes.get('/reports/sales', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from_date, to_date, payment_mode, status } = c.req.query();

  if (!from_date || !to_date) throw new HTTPException(400, { message: 'from_date and to_date are required' });

  let query = `
    SELECT
      inv.id, inv.invoice_no,
      p.name   as patient_name,
      inv.total_amount, inv.paid_amount, inv.credit_amount,
      inv.discount_amount, inv.payment_mode, inv.status, inv.created_at
    FROM pharmacy_invoices inv
    LEFT JOIN patients p ON inv.patient_id = p.id AND p.tenant_id = inv.tenant_id
    WHERE inv.tenant_id = ? AND inv.is_active = 1
      AND date(inv.created_at) BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [tenantId, from_date, to_date];

  if (payment_mode) { query += ` AND inv.payment_mode = ?`; params.push(payment_mode); }
  if (status)       { query += ` AND inv.status = ?`;        params.push(status); }

  query += ` ORDER BY inv.created_at DESC`;

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Summary
  const summaryRow = await db.$client
    .prepare(`
      SELECT
        COUNT(*) as total_invoices,
        COALESCE(SUM(total_amount),    0) as total_sales,
        COALESCE(SUM(paid_amount),     0) as total_paid,
        COALESCE(SUM(credit_amount),   0) as total_credit,
        COALESCE(SUM(discount_amount), 0) as total_discount,
        COALESCE(SUM(CASE WHEN payment_mode = 'cash'   THEN paid_amount ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN payment_mode = 'card'   THEN paid_amount ELSE 0 END), 0) as card_sales,
        COALESCE(SUM(CASE WHEN payment_mode = 'credit' THEN total_amount ELSE 0 END), 0) as credit_sales
      FROM pharmacy_invoices
      WHERE tenant_id = ? AND is_active = 1
        AND date(created_at) BETWEEN ? AND ?
    `)
    .bind(tenantId, from_date, to_date)
    .first();

  return c.json({ data: results, summary: summaryRow });
});

// GET /api/pharmacy/reports/expiry — expiry report with days-until-expiry
pharmacyRoutes.get('/reports/expiry', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const days   = parseInt(c.req.query('days') ?? '90', 10);
  const search = c.req.query('search');

  let query = `
    SELECT
      s.id,
      pi.name   as item_name,
      pg.name   as generic_name,
      s.batch_no,
      s.expiry_date,
      s.available_qty,
      s.cost_price,
      s.mrp,
      CAST(julianday(s.expiry_date) - julianday('now') AS INTEGER) as days_until_expiry
    FROM pharmacy_stock s
    JOIN pharmacy_items pi     ON s.item_id    = pi.id AND pi.tenant_id = s.tenant_id
    LEFT JOIN pharmacy_generics pg ON pi.generic_id = pg.id AND pg.tenant_id = pi.tenant_id
    WHERE s.tenant_id = ? AND s.available_qty > 0 AND s.is_active = 1
      AND s.expiry_date IS NOT NULL
  `;
  const params: (string | number)[] = [tenantId];

  if (days === 0) {
    query += ` AND s.expiry_date < date('now', '+6 hours')`;
  } else {
    query += ` AND s.expiry_date <= date('now', '+' || ? || ' days')`;
    params.push(days);
  }

  if (search) {
    query += ` AND (pi.name LIKE ? OR s.batch_no LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY s.expiry_date ASC`;

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Summary
  const summaryRow = await db.$client
    .prepare(`
      SELECT
        SUM(CASE WHEN s.expiry_date < date('now', '+6 hours') THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN s.expiry_date BETWEEN date('now', '+6 hours') AND date('now','+30 days') THEN 1 ELSE 0 END) as within_30,
        SUM(CASE WHEN s.expiry_date BETWEEN date('now', '+6 hours') AND date('now','+90 days') THEN 1 ELSE 0 END) as within_90,
        COALESCE(SUM(CASE WHEN s.expiry_date <= date('now','+90 days')
                     THEN s.available_qty * s.cost_price ELSE 0 END), 0) as total_value
      FROM pharmacy_stock s
      WHERE s.tenant_id = ? AND s.available_qty > 0 AND s.is_active = 1 AND s.expiry_date IS NOT NULL
    `)
    .bind(tenantId)
    .first<{ expired: number; within_30: number; within_90: number; total_value: number }>();

  return c.json({ data: results, summary: summaryRow });
});

// ============================================================
// PHASE 2: SUPPLIER LEDGER
// ============================================================

// GET /api/pharmacy/suppliers/:id/ledger
// Payables ledger: all POs and GRNs for a supplier with outstanding balance
pharmacyRoutes.get('/suppliers/:id/ledger', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const supplierId = parseInt(c.req.param('id'), 10);
  if (isNaN(supplierId)) throw new HTTPException(400, { message: 'Invalid supplier ID' });

  const page  = parseInt(c.req.query('page')  ?? '1',  10);
  const limit = parseInt(c.req.query('limit') ?? '30', 10);
  const offset = (page - 1) * limit;
  const { from_date, to_date } = c.req.query();

  // Supplier info
  const supplier = await db.$client
    .prepare('SELECT id, name, contact_no, city, credit_period FROM pharmacy_suppliers WHERE id = ? AND tenant_id = ?')
    .bind(supplierId, tenantId)
    .first<{ id: number; name: string; contact_no: string; city: string; credit_period: number }>();
  if (!supplier) throw new HTTPException(404, { message: 'Supplier not found' });

  // Build ledger entries from GRNs (received items)
  let grn_query = `
    SELECT
      g.id,
      'GRN'                   as entry_type,
      g.grn_print_id          as ref_no,
      g.grn_date              as entry_date,
      g.total_amount          as total_amount,
      g.payment_status        as status
    FROM pharmacy_goods_receipts g
    WHERE g.supplier_id = ? AND g.tenant_id = ? AND g.is_active = 1
  `;
  const params: (string | number)[] = [supplierId, tenantId];

  if (from_date) { grn_query += ` AND date(g.grn_date) >= ?`; params.push(from_date); }
  if (to_date)   { grn_query += ` AND date(g.grn_date) <= ?`; params.push(to_date); }
  grn_query += ` ORDER BY g.grn_date DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.$client.prepare(grn_query).bind(...params).all();

  // Balance summary
  const balanceRow = await db.$client
    .prepare(`
      SELECT
        COALESCE(SUM(total_amount), 0) as total_payable,
        COUNT(*) as total_grn
      FROM pharmacy_goods_receipts
      WHERE supplier_id = ? AND tenant_id = ? AND is_active = 1
    `)
    .bind(supplierId, tenantId)
    .first<{ total_payable: number; total_grn: number }>();

  const totalRow = await db.$client
    .prepare(`SELECT COUNT(*) as total FROM pharmacy_goods_receipts WHERE supplier_id = ? AND tenant_id = ? AND is_active = 1`)
    .bind(supplierId, tenantId)
    .first<{ total: number }>();

  return c.json({
    supplier,
    data: results,
    balance: balanceRow ?? { total_payable: 0, total_grn: 0 },
    pagination: { page, limit, total: totalRow?.total ?? 0 },
  });
});

// GET /api/pharmacy/suppliers/:id/summary  — quick payable summary for a supplier
pharmacyRoutes.get('/suppliers/:id/summary', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const supplierId = parseInt(c.req.param('id'), 10);
  if (isNaN(supplierId)) throw new HTTPException(400, { message: 'Invalid supplier ID' });

  // Replaced Promise.all() with db.$client.batch() to reduce network latency
  // Why: db.$client.batch() sends a single network request to Cloudflare D1 instead of 3
  const results = await db.$client.batch([
    db.$client.prepare('SELECT id, name, contact_no, city, pan_no, credit_period FROM pharmacy_suppliers WHERE id = ? AND tenant_id = ?')
      .bind(supplierId, tenantId),
    db.$client.prepare(`
      SELECT
        COUNT(*) as total_grn,
        COALESCE(SUM(total_amount), 0) as total_value
      FROM pharmacy_goods_receipts WHERE supplier_id = ? AND tenant_id = ? AND is_active = 1
    `).bind(supplierId, tenantId),
    db.$client.prepare(`SELECT COUNT(*) as total FROM pharmacy_purchase_orders WHERE supplier_id = ? AND tenant_id = ? AND is_active = 1`)
      .bind(supplierId, tenantId),
  ]);

  const supplier = results[0]?.results?.[0];
  const balance = results[1]?.results?.[0];
  const orderCount = results[2]?.results?.[0] as { total: number } | undefined;

  if (!supplier) throw new HTTPException(404, { message: 'Supplier not found' });
  return c.json({ supplier, balance, total_orders: orderCount?.total ?? 0 });
});

// ============================================================
// PHASE 2: DISPENSARY STOCK VIEW
// ============================================================

// GET /api/pharmacy/dispensary-stock
// Stock view by counter / dispensary (filter by is_outdoor_patient, counter_id, item search)
pharmacyRoutes.get('/dispensary-stock', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { search, category_id, low_stock_only, page: pg, limit: lm } = c.req.query();

  const page   = parseInt(pg  ?? '1',  10);
  const limit  = parseInt(lm  ?? '50', 10);
  const offset = (page - 1) * limit;

  let query = `
    SELECT
      pi.id         as item_id,
      pi.name       as item_name,
      pi.code       as item_code,
      pi.reorder_level,
      pg.name       as generic_name,
      pc.name       as category_name,
      COALESCE(SUM(s.available_qty), 0) as total_qty,
      MIN(s.expiry_date)    as nearest_expiry,
      MIN(s.mrp)            as mrp,
      MIN(s.cost_price)     as cost_price,
      COUNT(s.id)           as batch_count
    FROM pharmacy_items pi
    LEFT JOIN pharmacy_generics pg   ON pi.generic_id   = pg.id  AND pg.tenant_id  = pi.tenant_id
    LEFT JOIN pharmacy_categories pc ON pi.category_id  = pc.id  AND pc.tenant_id  = pi.tenant_id
    LEFT JOIN pharmacy_stock s       ON pi.id = s.item_id AND s.tenant_id = pi.tenant_id AND s.is_active = 1 AND s.available_qty > 0
    WHERE pi.tenant_id = ? AND pi.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (search) {
    query += ` AND (pi.name LIKE ? OR pi.code LIKE ? OR pg.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category_id) {
    query += ` AND pi.category_id = ?`;
    params.push(parseInt(category_id, 10));
  }

  query += ` GROUP BY pi.id, pi.name, pi.code, pi.reorder_level, pg.name, pc.name`;

  if (low_stock_only === 'true') {
    query += ` HAVING (pi.reorder_level IS NOT NULL AND total_qty <= pi.reorder_level) OR total_qty = 0`;
  }

  query += ` ORDER BY pi.name LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Count
  const countRow = await db.$client
    .prepare(`SELECT COUNT(DISTINCT pi.id) as total FROM pharmacy_items pi WHERE pi.tenant_id = ? AND pi.is_active = 1`)
    .bind(tenantId)
    .first<{ total: number }>();

  return c.json({ data: results, pagination: { page, limit, total: countRow?.total ?? 0 } });
});

// ============================================================
// PHASE 2: TAX CONFIGURATION
// ============================================================

// GET /api/pharmacy/tax-config  — list all tax configs
pharmacyRoutes.get('/tax-config', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client
    .prepare('SELECT * FROM pharmacy_tax_config WHERE tenant_id = ? ORDER BY tax_name')
    .bind(tenantId)
    .all();
  return c.json({ data: results });
});

// POST /api/pharmacy/tax-config
pharmacyRoutes.post('/tax-config', requireRole(...PHARM_WRITE), zValidator('json', createTaxConfigSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = (c.get('jwtPayload') as { id: number }).id;
  const body = c.req.valid('json');

  const result = await db.$client
    .prepare(`INSERT INTO pharmacy_tax_config (tax_name, tax_rate, tax_type, is_active, tenant_id, created_by)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(body.tax_name, body.tax_rate, body.tax_type, body.is_active, tenantId, userId)
    .run();

  return c.json({ id: result.meta?.last_row_id, message: 'Tax config created' }, 201);
});

// PUT /api/pharmacy/tax-config/:id
pharmacyRoutes.put('/tax-config/:id', requireRole(...PHARM_WRITE), zValidator('json', updateTaxConfigSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid tax config ID' });
  const body = c.req.valid('json');

  await db.$client
    .prepare(`UPDATE pharmacy_tax_config SET tax_name = COALESCE(?, tax_name), tax_rate = COALESCE(?, tax_rate), tax_type = COALESCE(?, tax_type), is_active = COALESCE(?, is_active), updated_at = ?
              WHERE id = ? AND tenant_id = ?`)
    .bind(
      body.tax_name ?? null, body.tax_rate ?? null, body.tax_type ?? null,
      body.is_active ?? null, new Date().toISOString(), id, tenantId
    )
    .run();

  return c.json({ message: 'Tax config updated' });
});

// DELETE /api/pharmacy/tax-config/:id
pharmacyRoutes.delete('/tax-config/:id', requireRole(...PHARM_WRITE), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid tax config ID' });

  await db.$client
    .prepare('UPDATE pharmacy_tax_config SET is_active = 0 WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .run();

  return c.json({ message: 'Tax config deactivated' });
});

// ============================================================
// PHASE 2: ITEM TYPE PATCH (set is_narcotic / item_type on items)
// ============================================================

// PATCH /api/pharmacy/items/:id/type  — set item_type and is_narcotic flag
pharmacyRoutes.patch('/items/:id/type', requireRole(...PHARM_WRITE), zValidator('json', itemTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid item ID' });

  const body = c.req.valid('json');

  const updates: string[] = ['updated_at = ?'];
  const params: (string | number)[] = [new Date().toISOString()];

  if (body.item_type   !== undefined) { updates.push('item_type = ?');   params.push(body.item_type); }
  if (body.is_narcotic !== undefined) { updates.push('is_narcotic = ?'); params.push(body.is_narcotic ? 1 : 0); }

  params.push(id, tenantId);

  await db.$client
    .prepare(`UPDATE pharmacy_items SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
    .bind(...params)
    .run();

  return c.json({ message: 'Item type updated' });
});

// ============================================================
// PHASE 3: MRP / PRICE HISTORY
// ============================================================

// GET /api/pharmacy/items/:id/price-history
pharmacyRoutes.get('/items/:id/price-history', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = parseInt(c.req.param('id'), 10);
  if (isNaN(itemId)) throw new HTTPException(400, { message: 'Invalid item ID' });

  const { results } = await db.$client
    .prepare(`
      SELECT h.*, emp.name as created_by_name
      FROM pharmacy_item_price_history h
      LEFT JOIN employees emp ON h.created_by = emp.id AND emp.tenant_id = h.tenant_id
      WHERE h.item_id = ? AND h.tenant_id = ?
      ORDER BY h.created_at DESC
      LIMIT 50
    `)
    .bind(itemId, tenantId)
    .all();

  return c.json({ data: results });
});

// POST /api/pharmacy/items/:id/price-history  — record a price change
pharmacyRoutes.post('/items/:id/price-history', requireRole(...PHARM_WRITE), zValidator('json', createPriceHistorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = (c.get('jwtPayload') as { id: number }).id;
  const itemId = parseInt(c.req.param('id'), 10);
  if (isNaN(itemId)) throw new HTTPException(400, { message: 'Invalid item ID' });

  const body = c.req.valid('json');

  // Record history entry
  const result = await db.$client
    .prepare(`
      INSERT INTO pharmacy_item_price_history
        (item_id, batch_no, old_mrp, new_mrp, old_cost_price, new_cost_price, change_reason, created_by, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      itemId, body.batch_no ?? null, body.old_mrp ?? null, body.new_mrp,
      body.old_cost_price ?? null, body.new_cost_price, body.change_reason ?? null, userId, tenantId
    )
    .run();

  // Update current price on pharmacy_items
  await db.$client
    .prepare('UPDATE pharmacy_items SET mrp = ?, cost_price = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(body.new_mrp, body.new_cost_price, new Date().toISOString(), itemId, tenantId)
    .run();

  // If batch_no provided, update that batch in pharmacy_stock too
  if (body.batch_no) {
    await db.$client
      .prepare('UPDATE pharmacy_stock SET mrp = ?, cost_price = ? WHERE item_id = ? AND batch_no = ? AND tenant_id = ?')
      .bind(body.new_mrp, body.new_cost_price, itemId, body.batch_no, tenantId)
      .run();
  }

  return c.json({ id: result.meta?.last_row_id, message: 'Price history recorded and prices updated' }, 201);
});

// ============================================================
// PHASE 3: BARCODE LOOKUP
// ============================================================

// GET /api/pharmacy/items/barcode/:code — look up an item by barcode
pharmacyRoutes.get('/items/barcode/:code', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const code = c.req.param('code');

  const item = await db.$client
    .prepare(`
      SELECT pi.*,
             pg.name as generic_name,
             pc.name as category_name,
             COALESCE(SUM(s.available_qty), 0) as stock_qty
      FROM pharmacy_items pi
      LEFT JOIN pharmacy_generics pg   ON pi.generic_id  = pg.id AND pg.tenant_id  = pi.tenant_id
      LEFT JOIN pharmacy_categories pc ON pi.category_id = pc.id AND pc.tenant_id  = pi.tenant_id
      LEFT JOIN pharmacy_stock s       ON pi.id = s.item_id AND s.tenant_id = pi.tenant_id AND s.is_active = 1
      WHERE pi.barcode = ? AND pi.tenant_id = ? AND pi.is_active = 1
      GROUP BY pi.id
    `)
    .bind(code, tenantId)
    .first();

  if (!item) throw new HTTPException(404, { message: 'No item found for this barcode' });
  return c.json({ item });
});

// PUT /api/pharmacy/items/:id/barcode — assign / update a barcode
pharmacyRoutes.put('/items/:id/barcode', requireRole(...PHARM_WRITE), zValidator('json', barcodeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = parseInt(c.req.param('id'), 10);
  if (isNaN(itemId)) throw new HTTPException(400, { message: 'Invalid item ID' });

  const { barcode } = c.req.valid('json');

  // F8: Check for duplicate barcode within this tenant
  const existing = await db.$client
    .prepare('SELECT id FROM pharmacy_items WHERE barcode = ? AND tenant_id = ? AND id != ? AND is_active = 1')
    .bind(barcode, tenantId, itemId)
    .first<{ id: number }>();
  if (existing) throw new HTTPException(409, { message: `Barcode '${barcode}' is already assigned to item #${existing.id}` });

  await db.$client
    .prepare('UPDATE pharmacy_items SET barcode = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(barcode, new Date().toISOString(), itemId, tenantId)
    .run();

  return c.json({ message: 'Barcode updated' });
});

// ============================================================
// PHASE 3: DOSAGE TEMPLATES
// ============================================================

// GET /api/pharmacy/dosage-templates
pharmacyRoutes.get('/dosage-templates', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const genericId = c.req.query('generic_id');

  let query = `
    SELECT d.*, pg.name as generic_name
    FROM pharmacy_dosage_templates d
    LEFT JOIN pharmacy_generics pg ON d.generic_id = pg.id AND pg.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (genericId) {
    query += ` AND (d.generic_id = ? OR d.generic_id IS NULL)`;
    params.push(parseInt(genericId, 10));
  }

  query += ` ORDER BY d.generic_id NULLS LAST, d.dosage_label`;

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

// POST /api/pharmacy/dosage-templates
pharmacyRoutes.post('/dosage-templates', requireRole(...PHARM_WRITE), zValidator('json', createDosageTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = (c.get('jwtPayload') as { id: number }).id;
  const body = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO pharmacy_dosage_templates
        (generic_id, dosage_label, frequency, route, duration_days, notes, is_active, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `)
    .bind(
      body.generic_id ?? null, body.dosage_label, body.frequency,
      body.route, body.duration_days ?? null, body.notes ?? null, tenantId, userId
    )
    .run();

  return c.json({ id: result.meta?.last_row_id, message: 'Dosage template created' }, 201);
});

// PUT /api/pharmacy/dosage-templates/:id
pharmacyRoutes.put('/dosage-templates/:id', requireRole(...PHARM_WRITE), zValidator('json', updateDosageTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid template ID' });

  const body = c.req.valid('json');

  await db.$client
    .prepare(`
      UPDATE pharmacy_dosage_templates
      SET dosage_label = COALESCE(?, dosage_label),
          frequency    = COALESCE(?, frequency),
          route        = COALESCE(?, route),
          duration_days = ?,
          notes        = ?,
          is_active    = COALESCE(?, is_active)
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(
      body.dosage_label ?? null, body.frequency ?? null, body.route ?? null,
      body.duration_days ?? null, body.notes ?? null,
      body.is_active != null ? (body.is_active ? 1 : 0) : null,
      id, tenantId
    )
    .run();

  return c.json({ message: 'Dosage template updated' });
});

// DELETE /api/pharmacy/dosage-templates/:id  — soft delete
pharmacyRoutes.delete('/dosage-templates/:id', requireRole(...PHARM_WRITE), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid template ID' });

  await db.$client
    .prepare('UPDATE pharmacy_dosage_templates SET is_active = 0 WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .run();

  return c.json({ message: 'Dosage template deactivated' });
});

// ============================================================
// PHASE 3: APPROVAL WORKFLOW (GRN + Write-offs)
// ============================================================

// GET /api/pharmacy/grn/pending-approval  — GRNs pending approval
pharmacyRoutes.get('/grn/pending-approval', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client
    .prepare(`
      SELECT g.id, g.grn_print_id as grn_no, g.grn_date, g.total_amount, g.approval_status,
             s.name as supplier_name, creator.name as created_by_name
      FROM pharmacy_goods_receipts g
      LEFT JOIN pharmacy_suppliers s ON g.supplier_id = s.id AND s.tenant_id = g.tenant_id
      LEFT JOIN users creator ON g.created_by = creator.id AND creator.tenant_id = g.tenant_id
      WHERE g.tenant_id = ? AND g.approval_status = 'pending' AND g.is_active = 1
      ORDER BY g.grn_date DESC
    `)
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

// PUT /api/pharmacy/grn/:id/approve  — approve or reject a GRN
pharmacyRoutes.put('/grn/:id/approve', requireRole(...PHARM_WRITE), zValidator('json', approvalActionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = (c.get('jwtPayload') as { id: number }).id;
  const grnId = parseInt(c.req.param('id'), 10);
  if (isNaN(grnId)) throw new HTTPException(400, { message: 'Invalid GRN ID' });

  const body = c.req.valid('json');

  // F10: Separation of duties — approver must not be the creator
  const grn = await db.$client
    .prepare('SELECT created_by FROM pharmacy_goods_receipts WHERE id = ? AND tenant_id = ?')
    .bind(grnId, tenantId)
    .first<{ created_by: number }>();
  if (!grn) throw new HTTPException(404, { message: 'GRN not found' });
  if (grn.created_by === userId) {
    throw new HTTPException(403, { message: 'Cannot approve/reject your own GRN — separation of duties required' });
  }

  const status = body.action === 'approve' ? 'approved' : 'rejected';
  await db.$client
    .prepare(`
      UPDATE pharmacy_goods_receipts
      SET approval_status = ?, approved_by = ?, approved_at = ?, approval_notes = ?
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(status, userId, new Date().toISOString(), body.notes ?? null, grnId, tenantId)
    .run();

  return c.json({ message: `GRN ${status} successfully` });
});

// GET /api/pharmacy/write-offs/pending-approval
pharmacyRoutes.get('/write-offs/pending-approval', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client
    .prepare(`
      SELECT w.id, w.id as write_off_no, w.write_off_date, w.total_amount as total_value,
             w.remarks as reason, w.approval_status, creator.name as created_by_name
      FROM pharmacy_write_offs w
      LEFT JOIN users creator ON w.created_by = creator.id AND creator.tenant_id = w.tenant_id
      WHERE w.tenant_id = ? AND w.approval_status = 'pending' AND w.is_active = 1
      ORDER BY w.write_off_date DESC
    `)
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

// PUT /api/pharmacy/write-offs/:id/approve
pharmacyRoutes.put('/write-offs/:id/approve', requireRole(...PHARM_WRITE), zValidator('json', approvalActionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = (c.get('jwtPayload') as { id: number }).id;
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid write-off ID' });

  const body = c.req.valid('json');

  // F10: Separation of duties — approver must not be the creator
  const wo = await db.$client
    .prepare('SELECT created_by FROM pharmacy_write_offs WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<{ created_by: number }>();
  if (!wo) throw new HTTPException(404, { message: 'Write-off not found' });
  if (wo.created_by === userId) {
    throw new HTTPException(403, { message: 'Cannot approve/reject your own write-off — separation of duties required' });
  }

  const status = body.action === 'approve' ? 'approved' : 'rejected';
  await db.$client
    .prepare(`
      UPDATE pharmacy_write_offs
      SET approval_status = ?, approved_by = ?, approved_at = ?, approval_notes = ?
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(status, userId, new Date().toISOString(), body.notes ?? null, id, tenantId)
    .run();

  // Deduct stock only on approval
  if (status === 'approved') {
    const { results: woItems } = await db.$client
      .prepare('SELECT * FROM pharmacy_write_off_items WHERE write_off_id = ? AND tenant_id = ?')
      .bind(id, tenantId)
      .all();

    const stockStmts: D1PreparedStatement[] = [];
    for (const item of woItems) {
      stockStmts.push(
        db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND available_qty >= ?`
        ).bind(item.quantity, item.stock_id, tenantId, item.quantity)
      );
      stockStmts.push(
        db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, out_qty, price, remarks, tenant_id, created_by)
          VALUES (?, ?, 'write_off', 'write_off', ?, ?, ?, ?, 'Write-off (approved)', ?, ?)
        `).bind(item.item_id, item.stock_id, id, item.batch_no ?? null, item.quantity, item.item_rate, tenantId, userId)
      );
    }
    if (stockStmts.length > 0) await db.$client.batch(stockStmts);
  }

  return c.json({ message: `Write-off ${status} successfully` });
});

export default pharmacyRoutes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireTenantId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const PHARM_READ = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, use YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, use YYYY-MM-DD').optional(),
});

const dateRangeWithLimitSchema = dateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const expirySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

const reportPharmacy = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Dispensing Summary ──────────────────────────────────────────────────────
// BUG FIX: Was referencing non-existent columns. Now queries pharmacy_sales correctly.

reportPharmacy.get('/dispensing-summary', requireRole(...PHARM_READ), zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  let sql = `
    SELECT
      date(s.created_at) as sale_date,
      COUNT(s.id) as sale_count,
      COALESCE(SUM(s.total_amount), 0) as revenue,
      COALESCE(SUM(s.discount), 0) as total_discount,
      COUNT(DISTINCT s.patient_id) as unique_patients
    FROM pharmacy_sales s
    WHERE s.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND date(s.created_at) >= ?'; params.push(startDate); }
  if (endDate)   { sql += ' AND date(s.created_at) <= ?'; params.push(endDate); }
  sql += ' GROUP BY sale_date ORDER BY sale_date DESC';

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    const totalRevenue = results.reduce((s: number, r: any) => s + (r.revenue || 0), 0);
    const totalSales   = results.reduce((s: number, r: any) => s + r.sale_count, 0);
    return c.json({ daily: results, totalRevenue, totalSales });
  } catch {
    return c.json({ daily: [], totalRevenue: 0, totalSales: 0 });
  }
});

// ─── Stock Value Report ──────────────────────────────────────────────────────
// BUG FIX: Was referencing m.unit_price and m.quantity which don't exist.
// Now queries pharmacy_stock (batch-level) with item joins.

reportPharmacy.get('/stock-value', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    // Try new pharmacy_items + pharmacy_stock tables first
    const { results: v2Results } = await db.$client.prepare(`
      SELECT
        i.name as medicine_name,
        g.name as generic_name,
        COALESCE(SUM(s.available_qty), 0) as stock_qty,
        COALESCE(AVG(s.cost_price), 0) as unit_cost,
        COALESCE(AVG(s.sale_price), 0) as unit_price,
        COALESCE(SUM(s.available_qty * s.cost_price), 0) as stock_cost_value,
        COALESCE(SUM(s.available_qty * s.sale_price), 0) as stock_sale_value
      FROM pharmacy_items i
      LEFT JOIN pharmacy_generics g ON i.generic_id = g.id
      LEFT JOIN pharmacy_stock s ON i.id = s.item_id AND s.tenant_id = i.tenant_id AND s.is_active = 1 AND s.available_qty > 0
      WHERE i.tenant_id = ? AND i.is_active = 1
      GROUP BY i.id
      HAVING stock_qty > 0
      ORDER BY stock_sale_value DESC
    `).bind(tenantId).all();

    if (v2Results.length > 0) {
      const totalCostValue = v2Results.reduce((s: number, r: any) => s + (r.stock_cost_value || 0), 0);
      const totalSaleValue = v2Results.reduce((s: number, r: any) => s + (r.stock_sale_value || 0), 0);
      return c.json({ items: v2Results, totalCostValue, totalSaleValue, totalItems: v2Results.length });
    }

    // Fallback to legacy medicine_stock_batches
    const { results } = await db.$client.prepare(`
      SELECT
        m.name as medicine_name,
        m.company,
        COALESCE(SUM(b.quantity_available), 0) as stock_qty,
        COALESCE(AVG(b.sale_price), 0) as unit_price,
        COALESCE(SUM(b.quantity_available * b.sale_price), 0) as stock_value
      FROM medicines m
      LEFT JOIN medicine_stock_batches b ON m.id = b.medicine_id AND b.tenant_id = m.tenant_id
      WHERE m.tenant_id = ?
      GROUP BY m.id
      HAVING stock_qty > 0
      ORDER BY stock_value DESC
    `).bind(tenantId).all();

    const totalValue = results.reduce((s: number, r: any) => s + (r.stock_value || 0), 0);
    return c.json({ items: results, totalCostValue: totalValue, totalSaleValue: totalValue, totalItems: results.length });
  } catch {
    return c.json({ items: [], totalCostValue: 0, totalSaleValue: 0, totalItems: 0 });
  }
});

// ─── Expiry Alert List ───────────────────────────────────────────────────────
// BUG FIX: Was querying m.expiry_date which doesn't exist on medicines table.
// Now queries medicine_stock_batches (legacy) or pharmacy_stock (v2).

reportPharmacy.get('/expiry-alerts', requireRole(...PHARM_READ), zValidator('query', expirySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { days } = c.req.valid('query');

  try {
    // Try new pharmacy_stock first
    const { results: v2Results } = await db.$client.prepare(`
      SELECT
        i.name as medicine_name,
        s.batch_no,
        s.available_qty as stock_qty,
        s.expiry_date,
        julianday(s.expiry_date) - julianday('now') as days_until_expiry
      FROM pharmacy_stock s
      JOIN pharmacy_items i ON s.item_id = i.id
      WHERE s.tenant_id = ? AND s.expiry_date IS NOT NULL
        AND julianday(s.expiry_date) <= julianday('now', '+' || ? || ' days')
        AND s.available_qty > 0 AND s.is_active = 1
      ORDER BY s.expiry_date ASC
    `).bind(tenantId, days).all();

    if (v2Results.length > 0) {
      return c.json({
        alerts: v2Results.map((r: any) => ({
          ...r,
          days_until_expiry: Math.round(r.days_until_expiry || 0),
          is_expired: (r.days_until_expiry || 0) <= 0,
        })),
        withinDays: days,
      });
    }

    // Fallback: use legacy medicine_stock_batches
    const { results } = await db.$client.prepare(`
      SELECT
        m.name as medicine_name,
        b.batch_no,
        b.quantity_available as stock_qty,
        b.expiry_date,
        julianday(b.expiry_date) - julianday('now') as days_until_expiry
      FROM medicine_stock_batches b
      JOIN medicines m ON b.medicine_id = m.id
      WHERE b.tenant_id = ? AND b.expiry_date IS NOT NULL
        AND julianday(b.expiry_date) <= julianday('now', '+' || ? || ' days')
        AND b.quantity_available > 0
      ORDER BY b.expiry_date ASC
    `).bind(tenantId, days).all();

    return c.json({
      alerts: results.map((r: any) => ({
        ...r,
        days_until_expiry: Math.round(r.days_until_expiry || 0),
        is_expired: (r.days_until_expiry || 0) <= 0,
      })),
      withinDays: days,
    });
  } catch {
    return c.json({ alerts: [], withinDays: days, note: 'Expiry tracking not configured' });
  }
});

// ─── Top Dispensed Medicines ─────────────────────────────────────────────────

reportPharmacy.get('/top-dispensed', requireRole(...PHARM_READ), zValidator('query', dateRangeWithLimitSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, limit } = c.req.valid('query');

  let sql = `
    SELECT
      si.medicine_name,
      SUM(si.quantity) as total_qty,
      SUM(si.line_total) as total_revenue,
      COUNT(DISTINCT si.sale_id) as sale_count
    FROM pharmacy_sale_items si
    JOIN pharmacy_sales s ON si.sale_id = s.id
    WHERE s.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND date(s.created_at) >= ?'; params.push(startDate); }
  if (endDate)   { sql += ' AND date(s.created_at) <= ?'; params.push(endDate); }
  sql += ` GROUP BY si.medicine_name ORDER BY total_qty DESC LIMIT ?`;
  params.push(limit);

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ medicines: results });
  } catch {
    return c.json({ medicines: [] });
  }
});

// ─── Purchase Report ─────────────────────────────────────────────────────────

reportPharmacy.get('/purchase-summary', requireRole(...PHARM_READ), zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  let sql = `
    SELECT
      date(g.grn_date) as receipt_date,
      COUNT(g.id) as grn_count,
      COALESCE(SUM(g.total_amount), 0) as total_purchase,
      COALESCE(SUM(g.discount_amount), 0) as total_discount,
      COALESCE(SUM(g.vat_amount), 0) as total_vat
    FROM pharmacy_goods_receipts g
    WHERE g.tenant_id = ? AND g.is_cancelled = 0
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND g.grn_date >= ?'; params.push(startDate); }
  if (endDate)   { sql += ' AND g.grn_date <= ?'; params.push(endDate); }
  sql += ' GROUP BY receipt_date ORDER BY receipt_date DESC';

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    const totalPurchase = results.reduce((s: number, r: any) => s + (r.total_purchase || 0), 0);
    return c.json({ daily: results, totalPurchase });
  } catch {
    return c.json({ daily: [], totalPurchase: 0 });
  }
});

// ─── Stock Movement History ───────────────────────────────────────────────────

reportPharmacy.get('/stock-movements', requireRole(...PHARM_READ), zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');
  const itemId = c.req.query('itemId');

  let sql = `
    SELECT t.*, i.name as item_name
    FROM pharmacy_stock_transactions t
    JOIN pharmacy_items i ON t.item_id = i.id
    WHERE t.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];
  if (itemId)    { sql += ' AND t.item_id = ?';             params.push(itemId); }
  if (startDate) { sql += ' AND date(t.created_at) >= ?';  params.push(startDate); }
  if (endDate)   { sql += ' AND date(t.created_at) <= ?';  params.push(endDate); }
  sql += ' ORDER BY t.created_at DESC LIMIT 500';

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ movements: results });
  } catch {
    return c.json({ movements: [] });
  }
});

// ─── Medicine-wise Profit Report ────────────────────────────────────────────

const profitReportSchema = dateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['profit', 'revenue', 'margin']).default('profit'),
});

reportPharmacy.get('/medicine-profit', requireRole(...PHARM_READ), zValidator('query', profitReportSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, limit, sortBy } = c.req.valid('query');

  let sql = `
    SELECT
      pi.id as item_id,
      pi.name as item_name,
      pg.name as generic_name,
      COALESCE(SUM(ii.quantity), 0) as total_qty_sold,
      COALESCE(SUM(ii.total_amount), 0) as revenue,
      COALESCE(SUM(ii.quantity * s.cost_price), 0) as cogs,
      COALESCE(SUM(ii.total_amount), 0) - COALESCE(SUM(ii.quantity * s.cost_price), 0) as profit,
      CASE
        WHEN COALESCE(SUM(ii.total_amount), 0) > 0
        THEN ROUND(
          (COALESCE(SUM(ii.total_amount), 0) - COALESCE(SUM(ii.quantity * s.cost_price), 0)) * 100.0
          / COALESCE(SUM(ii.total_amount), 1), 2
        )
        ELSE 0
      END as margin_pct
    FROM pharmacy_invoice_items ii
    JOIN pharmacy_invoices inv ON ii.invoice_id = inv.id AND inv.tenant_id = ii.tenant_id
    JOIN pharmacy_items pi ON ii.item_id = pi.id AND pi.tenant_id = ii.tenant_id
    LEFT JOIN pharmacy_generics pg ON pi.generic_id = pg.id AND pg.tenant_id = pi.tenant_id
    LEFT JOIN pharmacy_stock s ON ii.stock_id = s.id AND s.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ? AND inv.is_active = 1 AND inv.is_return = 0
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND date(inv.created_at) >= ?'; params.push(startDate); }
  if (endDate)   { sql += ' AND date(inv.created_at) <= ?'; params.push(endDate); }
  sql += ` GROUP BY pi.id`;

  const orderMap: Record<string, string> = {
    profit: 'profit DESC',
    revenue: 'revenue DESC',
    margin: 'margin_pct DESC',
  };
  sql += ` ORDER BY ${orderMap[sortBy]} LIMIT ?`;
  params.push(limit);

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    const totals = results.reduce(
      (acc: { revenue: number; cogs: number; profit: number }, r: any) => ({
        revenue: acc.revenue + (r.revenue || 0),
        cogs: acc.cogs + (r.cogs || 0),
        profit: acc.profit + (r.profit || 0),
      }),
      { revenue: 0, cogs: 0, profit: 0 }
    );
    return c.json({
      items: results,
      totals: { ...totals, margin_pct: totals.revenue > 0 ? Math.round(totals.profit * 10000 / totals.revenue) / 100 : 0 },
    });
  } catch {
    return c.json({ items: [], totals: { revenue: 0, cogs: 0, profit: 0, margin_pct: 0 } });
  }
});

// ─── Batch-wise Stock Report ─────────────────────────────────────────────────

const batchStockSchema = z.object({
  itemId: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  expiryFilter: z.enum(['expired', 'expiring30', 'expiring90', 'ok']).optional(),
});

reportPharmacy.get('/batch-stock', requireRole(...PHARM_READ), zValidator('query', batchStockSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { itemId, search, expiryFilter } = c.req.valid('query');

  let sql = `
    SELECT
      s.id as stock_id,
      pi.id as item_id,
      pi.name as item_name,
      pg.name as generic_name,
      s.batch_no,
      s.expiry_date,
      s.available_qty,
      s.cost_price,
      s.mrp,
      s.sale_price,
      (s.available_qty * s.cost_price) as stock_value,
      CAST(julianday(s.expiry_date) - julianday('now') AS INTEGER) as days_until_expiry
    FROM pharmacy_stock s
    JOIN pharmacy_items pi ON s.item_id = pi.id AND pi.tenant_id = s.tenant_id
    LEFT JOIN pharmacy_generics pg ON pi.generic_id = pg.id AND pg.tenant_id = pi.tenant_id
    WHERE s.tenant_id = ? AND s.available_qty > 0 AND s.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (itemId) { sql += ' AND pi.id = ?'; params.push(itemId); }
  if (search) { sql += ' AND (pi.name LIKE ? OR s.batch_no LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  if (expiryFilter === 'expired') {
    sql += ` AND s.expiry_date < date('now', '+6 hours')`;
  } else if (expiryFilter === 'expiring30') {
    sql += ` AND s.expiry_date BETWEEN date('now', '+6 hours') AND date('now', '+30 days')`;
  } else if (expiryFilter === 'expiring90') {
    sql += ` AND s.expiry_date BETWEEN date('now', '+6 hours') AND date('now', '+90 days')`;
  } else if (expiryFilter === 'ok') {
    sql += ` AND (s.expiry_date IS NULL OR s.expiry_date > date('now', '+90 days'))`;
  }

  sql += ` ORDER BY pi.name, s.expiry_date ASC`;

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    const totalStockValue = results.reduce((s: number, r: any) => s + (r.stock_value || 0), 0);
    const totalBatches = results.length;
    const totalQty = results.reduce((s: number, r: any) => s + (r.available_qty || 0), 0);
    return c.json({ batches: results, summary: { totalStockValue, totalBatches, totalQty } });
  } catch {
    return c.json({ batches: [], summary: { totalStockValue: 0, totalBatches: 0, totalQty: 0 } });
  }
});

// ─── Supplier-wise Purchase Report ────────────────────────────────────────────

const supplierPurchaseSchema = dateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

reportPharmacy.get('/supplier-purchases', requireRole(...PHARM_READ), zValidator('query', supplierPurchaseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, limit } = c.req.valid('query');

  let sql = `
    SELECT
      ps.id as supplier_id,
      ps.name as supplier_name,
      ps.contact_no,
      COUNT(DISTINCT grn.id) as grn_count,
      COALESCE(SUM(grn.total_amount), 0) as total_purchase,
      COALESCE(SUM(grn.discount_amount), 0) as total_discount,
      COALESCE(SUM(grn.vat_amount), 0) as total_vat,
      COALESCE(SUM(grn.total_amount - grn.paid_amount), 0) as outstanding
    FROM pharmacy_suppliers ps
    LEFT JOIN pharmacy_goods_receipts grn ON ps.id = grn.supplier_id AND grn.tenant_id = ps.tenant_id AND grn.is_cancelled = 0
    WHERE ps.tenant_id = ? AND ps.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND grn.grn_date >= ?'; params.push(startDate); }
  if (endDate)   { sql += ' AND grn.grn_date <= ?'; params.push(endDate); }
  sql += ` GROUP BY ps.id HAVING grn_count > 0 ORDER BY total_purchase DESC LIMIT ?`;
  params.push(limit);

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    const totals = results.reduce(
      (acc: { purchase: number; discount: number; vat: number; outstanding: number }, r: any) => ({
        purchase: acc.purchase + (r.total_purchase || 0),
        discount: acc.discount + (r.total_discount || 0),
        vat: acc.vat + (r.total_vat || 0),
        outstanding: acc.outstanding + (r.outstanding || 0),
      }),
      { purchase: 0, discount: 0, vat: 0, outstanding: 0 }
    );
    return c.json({ suppliers: results, totals });
  } catch {
    return c.json({ suppliers: [], totals: { purchase: 0, discount: 0, vat: 0, outstanding: 0 } });
  }
});

export default reportPharmacy;

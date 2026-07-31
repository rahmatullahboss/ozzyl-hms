import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  stockAdjustmentSchema,
  stockAdjustmentRequestSchema,
  reviewStockAdjustmentSchema,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD_PAISA,
} from '../../../schemas/pharmacy';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getPagination } from '../../../lib/pagination';
import { getDb } from '../../../db';
import { requireRole, requirePermission } from '../../../middleware/rbac';
import { getTodayGMT6 } from '../../../lib/date-utils';
import { createAuditLog } from '../../../lib/accounting-helpers';

const PHARM_READ  = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;
const PHARM_WRITE = ['hospital_admin', 'pharmacist'] as const;

const stockRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── STOCK MANAGEMENT ─────────────────────────────────────────────────────────

stockRoutes.get('/stock', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { itemId, expireBefore, expireAfter } = c.req.query();
  try {
    let where = 'WHERE s.tenant_id = ? AND s.is_active = 1 AND s.available_qty > 0';
    const params: (string | number)[] = [tenantId];
    if (itemId)      { where += ' AND s.item_id = ?';                          params.push(itemId); }
    if (expireBefore){ where += ' AND s.expiry_date <= ?';                     params.push(expireBefore); }
    if (expireAfter) { where += ' AND (s.expiry_date >= ? OR s.expiry_date IS NULL)'; params.push(expireAfter); }

    const { results } = await db.$client.prepare(`
      SELECT s.*, i.name as item_name, i.reorder_level, g.name as generic_name
      FROM pharmacy_stock s
      JOIN pharmacy_items i ON s.item_id = i.id
      LEFT JOIN pharmacy_generics g ON i.generic_id = g.id
      ${where}
      ORDER BY s.expiry_date ASC, i.name ASC
    `).bind(...params).all();
    return c.json({ stock: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch stock' }); }
});

stockRoutes.post('/stock/adjustment', requireRole(...PHARM_WRITE), zValidator('json', stockAdjustmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const stock = await db.$client.prepare(
      `SELECT * FROM pharmacy_stock WHERE id = ? AND tenant_id = ?`,
    ).bind(data.stockId, tenantId).first<{ available_qty: number; item_id: number; batch_no: string; cost_price: number }>();
    if (!stock) throw new HTTPException(404, { message: 'Stock record not found' });

    if (data.adjustmentType === 'out' && stock.available_qty < data.quantity) {
      throw new HTTPException(400, { message: 'Insufficient stock for adjustment' });
    }

    const newQty = data.adjustmentType === 'in'
      ? stock.available_qty + data.quantity
      : stock.available_qty - data.quantity;

    await db.$client.batch([
      db.$client.prepare(
        `UPDATE pharmacy_stock SET available_qty = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
      ).bind(newQty, data.stockId, tenantId),
      db.$client.prepare(`
        INSERT INTO pharmacy_stock_transactions
          (stock_id, item_id, transaction_type, reference_type, batch_no,
           in_qty, out_qty, price, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        data.stockId, data.itemId,
        data.adjustmentType === 'in' ? 'adjustment_in' : 'adjustment_out',
        stock.batch_no,
        data.adjustmentType === 'in' ? data.quantity : 0,
        data.adjustmentType === 'out' ? data.quantity : 0,
        stock.cost_price, data.remarks, tenantId, userId,
      ),
    ]);
    return c.json({ message: `Stock adjusted. New qty: ${newQty}`, newQty });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to adjust stock' }); }
});

/**
 * Phase 7 (fix/pharmacy-inventory) — Stock adjustment with supervisor approval.
 *
 * Adjustments whose estimated value exceeds STOCK_ADJUSTMENT_APPROVAL_THRESHOLD_PAISA
 * (5,000 BDT by default), or that touch a narcotic item, are queued for a
 * supervisor / hospital_admin to approve. The stock change is NOT applied
 * until approval. Lower-value, non-narcotic adjustments still apply directly
 * (preserves existing UX) and the audit log captures both paths.
 */
stockRoutes.post(
  '/stock/adjustment/request',
  requireRole(...PHARM_WRITE),
  zValidator('json', stockAdjustmentRequestSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json');

    const stock = await db.$client.prepare(
      `SELECT s.available_qty, s.cost_price, s.batch_no, s.tenant_id,
              i.is_narcotic, i.name as item_name
       FROM pharmacy_stock s
       JOIN pharmacy_items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ?`,
    ).bind(data.stockId, tenantId).first<{
      available_qty: number; cost_price: number; batch_no: string;
      is_narcotic: number; item_name: string;
    }>();
    if (!stock) throw new HTTPException(404, { message: 'Stock record not found' });

    const amountImpact = data.amountImpact
      ?? Math.round(data.quantity * (stock.cost_price ?? 0));
    const requiresApproval =
      data.deferApply ||
      data.isNarcotic ||
      Number(stock.is_narcotic) === 1 ||
      amountImpact >= STOCK_ADJUSTMENT_APPROVAL_THRESHOLD_PAISA;

    if (!requiresApproval) {
      const newQty = data.adjustmentType === 'in'
        ? stock.available_qty + data.quantity
        : stock.available_qty - data.quantity;
      if (data.adjustmentType === 'out' && stock.available_qty < data.quantity) {
        throw new HTTPException(400, { message: 'Insufficient stock for adjustment' });
      }
      await db.$client.batch([
        db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
        ).bind(newQty, data.stockId, tenantId),
        db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (stock_id, item_id, transaction_type, reference_type, batch_no,
             in_qty, out_qty, price, remarks, tenant_id, created_by)
          VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          data.stockId, data.itemId,
          data.adjustmentType === 'in' ? 'adjustment_in' : 'adjustment_out',
          stock.batch_no,
          data.adjustmentType === 'in' ? data.quantity : 0,
          data.adjustmentType === 'out' ? data.quantity : 0,
          stock.cost_price ?? 0, data.remarks, tenantId, userId,
        ),
      ]);
      void createAuditLog(c.env, tenantId, userId, 'STOCK_ADJUSTMENT_DIRECT', 'pharmacy_stock', data.stockId, {
        itemId: data.itemId,
        adjustmentType: data.adjustmentType,
        quantity: data.quantity,
        amountImpact,
        itemName: stock.item_name,
        isNarcotic: Number(stock.is_narcotic) === 1,
      });
      return c.json({ message: `Stock adjusted (direct). New qty: ${newQty}`, newQty, approval: 'not_required' }, 201);
    }

    // Queue for supervisor approval
    const requestNo = `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const result = await db.$client.prepare(`
      INSERT INTO stock_adjustment_approvals
        (tenant_id, request_no, stock_id, item_id, adjustment_type, quantity,
         amount_impact, is_narcotic, remarks, status, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      tenantId, requestNo, data.stockId, data.itemId, data.adjustmentType, data.quantity,
      amountImpact, data.isNarcotic || Number(stock.is_narcotic) === 1 ? 1 : 0, data.remarks, userId,
    ).run();
    void createAuditLog(c.env, tenantId, userId, 'STOCK_ADJUSTMENT_QUEUED', 'stock_adjustment_approvals', Number(result.meta.last_row_id), {
      itemId: data.itemId,
      stockId: data.stockId,
      adjustmentType: data.adjustmentType,
      quantity: data.quantity,
      amountImpact,
      isNarcotic: data.isNarcotic || Number(stock.is_narcotic) === 1,
      requestNo,
    });
    return c.json({
      message: 'Stock adjustment queued for supervisor approval',
      approvalRequestId: Number(result.meta.last_row_id),
      requestNo,
      status: 'pending',
      amountImpact,
    }, 202);
  },
);

/** GET pending stock-adjustment approvals (supervisor view). */
stockRoutes.get(
  '/stock/adjustment/approvals',
  requireRole(...PHARM_READ),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const status = c.req.query('status') ?? 'pending';
    const { results } = await db.$client.prepare(`
      SELECT sa.*, pi.name as item_name, ps.batch_no
      FROM stock_adjustment_approvals sa
      JOIN pharmacy_items pi ON pi.id = sa.item_id AND pi.tenant_id = sa.tenant_id
      JOIN pharmacy_stock ps ON ps.id = sa.stock_id AND ps.tenant_id = sa.tenant_id
      WHERE sa.tenant_id = ? AND sa.status = ?
      ORDER BY sa.created_at DESC LIMIT 100
    `).bind(tenantId, status).all();
    return c.json({ approvals: results, status });
  },
);

/** Approve / reject a queued stock adjustment (supervisor or hospital_admin). */
stockRoutes.put(
  '/stock/adjustment/approvals/:id',
  requirePermission('pharmacy:stock_adjustment_approve'),
  zValidator('json', reviewStockAdjustmentSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid approval ID' });
    const body = c.req.valid('json');

    const adj = await db.$client.prepare(
      `SELECT * FROM stock_adjustment_approvals WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<{
      id: number; status: string; stock_id: number; item_id: number;
      adjustment_type: string; quantity: number; requested_by: number; tenant_id: string;
    }>();
    if (!adj) throw new HTTPException(404, { message: 'Approval request not found' });
    if (adj.status !== 'pending') {
      throw new HTTPException(409, { message: `Approval already ${adj.status}` });
    }
    if (Number(adj.requested_by) === Number(userId)) {
      throw new HTTPException(403, { message: 'Cannot approve your own adjustment — separation of duties required' });
    }

    if (body.action === 'reject') {
      await db.$client.prepare(`
        UPDATE stock_adjustment_approvals
        SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(userId, body.notes ?? null, id, tenantId).run();
      void createAuditLog(c.env, tenantId, userId, 'STOCK_ADJUSTMENT_REJECTED', 'stock_adjustment_approvals', id, {
        notes: body.notes ?? null,
      });
      return c.json({ message: 'Stock adjustment rejected', status: 'rejected' });
    }

    const stock = await db.$client.prepare(
      `SELECT available_qty, cost_price, batch_no FROM pharmacy_stock WHERE id = ? AND tenant_id = ?`,
    ).bind(adj.stock_id, tenantId).first<{ available_qty: number; cost_price: number; batch_no: string }>();
    if (!stock) throw new HTTPException(404, { message: 'Stock record no longer exists' });

    const newQty = adj.adjustment_type === 'in'
      ? stock.available_qty + adj.quantity
      : stock.available_qty - adj.quantity;
    if (adj.adjustment_type === 'out' && stock.available_qty < adj.quantity) {
      throw new HTTPException(409, { message: 'Insufficient stock at approval time' });
    }

    try {
      await db.$client.batch([
        db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
        ).bind(newQty, adj.stock_id, tenantId),
        db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (stock_id, item_id, transaction_type, reference_type, batch_no,
             in_qty, out_qty, price, remarks, tenant_id, created_by)
          VALUES (?, ?, ?, 'adjustment_approved', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          adj.stock_id, adj.item_id,
          adj.adjustment_type === 'in' ? 'adjustment_in' : 'adjustment_out',
          stock.batch_no,
          adj.adjustment_type === 'in' ? adj.quantity : 0,
          adj.adjustment_type === 'out' ? adj.quantity : 0,
          stock.cost_price ?? 0,
          `Approved adjustment #${id}`, tenantId, userId,
        ),
        db.$client.prepare(`
          UPDATE stock_adjustment_approvals
          SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'),
              review_notes = ?, applied_at = datetime('now', '+6 hours')
          WHERE id = ? AND tenant_id = ?
        `).bind(userId, body.notes ?? null, id, tenantId),
      ]);
    } catch (err) {
      console.error('[pharmacy] approval apply failed', err);
      throw new HTTPException(500, { message: 'Failed to apply approved stock adjustment' });
    }

    void createAuditLog(c.env, tenantId, userId, 'STOCK_ADJUSTMENT_APPROVED', 'stock_adjustment_approvals', id, {
      stockId: adj.stock_id,
      itemId: adj.item_id,
      adjustmentType: adj.adjustment_type,
      quantity: adj.quantity,
      newQty,
    });
    return c.json({ message: 'Stock adjustment approved and applied', status: 'approved', newQty });
  },
);

stockRoutes.get('/stock/transactions', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { itemId, type, from, to } = c.req.query();
  const { limit, offset } = getPagination(c);
  try {
    let where = 'WHERE t.tenant_id = ?';
    const params: (string | number)[] = [tenantId];
    if (itemId) { where += ' AND t.item_id = ?'; params.push(itemId); }
    if (type)   { where += ' AND t.transaction_type = ?'; params.push(type); }
    if (from)   { where += ' AND date(t.created_at) >= ?'; params.push(from); }
    if (to)     { where += ' AND date(t.created_at) <= ?'; params.push(to); }

    const { results } = await db.$client.prepare(`
      SELECT t.*, i.name as item_name FROM pharmacy_stock_transactions t
      JOIN pharmacy_items i ON t.item_id = i.id
      ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    return c.json({ transactions: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch stock transactions' }); }
});

// ─── UNIFIED PRODUCTION ALERTS / SUMMARY ──────────────────────────────────────
// These routes intentionally aggregate both pharmacy schemas currently present in
// the product:
//   1. pharmacy_items/pharmacy_stock/pharmacy_invoices
//   2. medicines/medicine_stock_batches/pharmacy_sales
// This keeps dashboards operational while both flows exist in production.

stockRoutes.get('/alerts/low-stock', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT * FROM (
        SELECT 'pharmacy_item' as source, i.id, i.name, COALESCE(i.reorder_level, 10) as reorder_level,
               COALESCE(SUM(s.available_qty), 0) as stock_qty
        FROM pharmacy_items i
        LEFT JOIN pharmacy_stock s ON i.id = s.item_id AND s.tenant_id = i.tenant_id AND s.is_active = 1
        WHERE i.tenant_id = ? AND i.is_active = 1
        GROUP BY i.id
        UNION ALL
        SELECT 'medicine' as source, m.id, m.name, COALESCE(m.reorder_level, 10) as reorder_level,
               COALESCE(SUM(b.quantity_available), 0) as stock_qty
        FROM medicines m
        LEFT JOIN medicine_stock_batches b ON m.id = b.medicine_id AND b.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.is_active = 1
        GROUP BY m.id
      ) stock_view
      WHERE stock_qty <= reorder_level
      ORDER BY stock_qty ASC, name ASC
    `).bind(tenantId, tenantId).all();
    return c.json({ alerts: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch low stock alerts' }); }
});

stockRoutes.get('/alerts/expiring', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const days = Math.max(0, Math.min(365, Number(c.req.query('days') || 30)));
  try {
    const { results } = await db.$client.prepare(`
      SELECT * FROM (
        SELECT 'pharmacy_stock' as source, s.id, s.item_id, i.name as item_name,
               s.batch_no, s.available_qty, s.expiry_date
        FROM pharmacy_stock s
        JOIN pharmacy_items i ON s.item_id = i.id AND i.tenant_id = s.tenant_id
        WHERE s.tenant_id = ? AND s.available_qty > 0 AND s.is_active = 1 AND s.expiry_date IS NOT NULL
        UNION ALL
        SELECT 'medicine_stock_batch' as source, b.id, b.medicine_id as item_id, m.name as item_name,
               b.batch_no, b.quantity_available as available_qty, b.expiry_date
        FROM medicine_stock_batches b
        JOIN medicines m ON b.medicine_id = m.id AND m.tenant_id = b.tenant_id
        WHERE b.tenant_id = ? AND b.quantity_available > 0 AND b.expiry_date IS NOT NULL
      ) expiring_view
      WHERE julianday(expiry_date) - julianday('now') <= ?
      ORDER BY expiry_date ASC, item_name ASC
    `).bind(tenantId, tenantId, days).all();
    return c.json({ alerts: results, daysWindow: days });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch expiring stock alerts' }); }
});

stockRoutes.get('/summary', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  try {
    const stockValue = await db.$client.prepare(`
      SELECT
        (SELECT COALESCE(SUM(available_qty * COALESCE(cost_price, 0)), 0)
         FROM pharmacy_stock WHERE tenant_id = ? AND is_active = 1)
        +
        (SELECT COALESCE(SUM(quantity_available * COALESCE(purchase_price, 0)), 0)
         FROM medicine_stock_batches WHERE tenant_id = ?) as total
    `).bind(tenantId, tenantId).first<{ total: number }>();

    const income = await db.$client.prepare(`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0)
         FROM pharmacy_invoices WHERE tenant_id = ? AND is_return = 0 AND is_active = 1)
        +
        (SELECT COALESCE(SUM(total_amount), 0)
         FROM pharmacy_sales WHERE tenant_id = ? AND status = 'paid') as total
    `).bind(tenantId, tenantId).first<{ total: number }>();

    const cogs = await db.$client.prepare(`
      SELECT
        (SELECT COALESCE(SUM(ii.quantity * COALESCE(s.cost_price, 0)), 0)
         FROM pharmacy_invoice_items ii
         LEFT JOIN pharmacy_stock s ON s.id = ii.stock_id AND s.tenant_id = ?
         WHERE ii.tenant_id = ? AND ii.item_status != 'returned')
        +
        (SELECT COALESCE(SUM(quantity * COALESCE(unit_cost, 0)), 0)
         FROM medicine_stock_movements WHERE tenant_id = ? AND movement_type = 'sale_out') as total
    `).bind(tenantId, tenantId, tenantId).first<{ total: number }>();

    const totalItems = await db.$client.prepare(`
      SELECT
        (SELECT COUNT(*) FROM pharmacy_items WHERE tenant_id = ? AND is_active = 1)
        +
        (SELECT COUNT(*) FROM medicines WHERE tenant_id = ? AND is_active = 1) as count
    `).bind(tenantId, tenantId).first<{ count: number }>();

    const lowStock = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT i.id, COALESCE(i.reorder_level, 10) as reorder_level, COALESCE(SUM(s.available_qty), 0) as stock_qty
        FROM pharmacy_items i
        LEFT JOIN pharmacy_stock s ON i.id = s.item_id AND s.tenant_id = i.tenant_id AND s.is_active = 1
        WHERE i.tenant_id = ? AND i.is_active = 1 GROUP BY i.id
        UNION ALL
        SELECT m.id, COALESCE(m.reorder_level, 10) as reorder_level, COALESCE(SUM(b.quantity_available), 0) as stock_qty
        FROM medicines m
        LEFT JOIN medicine_stock_batches b ON m.id = b.medicine_id AND b.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.is_active = 1 GROUP BY m.id
      ) x WHERE stock_qty <= reorder_level
    `).bind(tenantId, tenantId).first<{ count: number }>();

    const expiring = await db.$client.prepare(`
      SELECT
        (SELECT COUNT(*) FROM pharmacy_stock WHERE tenant_id = ? AND is_active = 1 AND available_qty > 0 AND expiry_date IS NOT NULL AND expiry_date <= date('now', '+90 days'))
        +
        (SELECT COUNT(*) FROM medicine_stock_batches WHERE tenant_id = ? AND quantity_available > 0 AND expiry_date IS NOT NULL AND expiry_date <= date('now', '+90 days')) as count
    `).bind(tenantId, tenantId).first<{ count: number }>();

    const todaySalesRow = await db.$client.prepare(`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM pharmacy_invoices WHERE tenant_id = ? AND is_return = 0 AND is_active = 1 AND date(created_at, '+6 hours') = date(?))
        +
        (SELECT COALESCE(SUM(total_amount), 0) FROM pharmacy_sales WHERE tenant_id = ? AND status = 'paid' AND date(created_at, '+6 hours') = date(?)) as total,
        (SELECT COUNT(*) FROM pharmacy_invoices WHERE tenant_id = ? AND is_return = 0 AND is_active = 1 AND date(created_at, '+6 hours') = date(?))
        +
        (SELECT COUNT(*) FROM pharmacy_sales WHERE tenant_id = ? AND status = 'paid' AND date(created_at, '+6 hours') = date(?)) as cnt
    `).bind(tenantId, today, tenantId, today, tenantId, today, tenantId, today).first<{ total: number; cnt: number }>();

    const totalIncome = income?.total ?? 0;
    const totalCogs = cogs?.total ?? 0;
    const todaySales = todaySalesRow?.total ?? 0;
    const todaySalesCount = todaySalesRow?.cnt ?? 0;
    const grossMargin = todaySales > 0
      ? parseFloat((((todaySales - totalCogs * (todaySales / Math.max(totalIncome, 1))) / todaySales) * 100).toFixed(1))
      : 0;

    return c.json({
      totalInvestment: stockValue?.total ?? 0,
      totalIncome,
      totalCostOfGoodsSold: totalCogs,
      grossProfit: totalIncome - totalCogs,
      totalMedicines: totalItems?.count ?? 0,
      lowStockCount: lowStock?.count ?? 0,
      expiringCount: expiring?.count ?? 0,
      todaySales,
      todaySalesCount,
      grossMargin,
    });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch pharmacy summary' }); }
});

export default stockRoutes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createPurchaseOrderSchema, updatePurchaseOrderSchema, cancelPurchaseOrderSchema,
  createGoodsReceiptSchema, createSupplierReturnSchema,
} from '../../../schemas/pharmacy';
import { getNextSequence } from '../../../lib/sequence';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../../lib/pagination';
import { getDb } from '../../../db';
import { requireRole } from '../../../middleware/rbac';
import { createAuditLog } from '../../../lib/accounting-helpers';
import {
  reserveMutationIdempotencyKey,
  completeMutationIdempotencyKey,
  markMutationIdempotencyKeyFailed,
  createIdempotencyRequestHash,
} from '../../../lib/request-idempotency';
import { recordAccountingPostingEvent, ACCOUNTING_EVENT_TYPES } from '../../../lib/accounting-posting';
import { z } from 'zod';

const PHARM_READ  = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;
const PHARM_WRITE = ['hospital_admin', 'pharmacist'] as const;

const purchaseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── PURCHASE ORDERS (Phase 2) ────────────────────────────────────────────────

purchaseRoutes.get('/purchase-orders', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { supplierId, status, from, to } = c.req.query();
  const { page, limit, offset } = getPagination(c);
  try {
    let where = 'WHERE po.tenant_id = ? AND po.is_active = 1';
    const params: (string | number)[] = [tenantId];
    if (supplierId) { where += ' AND po.supplier_id = ?'; params.push(supplierId); }
    if (status)     { where += ' AND po.status = ?';      params.push(status); }
    if (from)       { where += ' AND po.po_date >= ?';    params.push(from); }
    if (to)         { where += ' AND po.po_date <= ?';    params.push(to); }

    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM pharmacy_purchase_orders po ${where}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await db.$client.prepare(`
      SELECT po.*, s.name as supplier_name, COUNT(poi.id) as item_count
      FROM pharmacy_purchase_orders po
      LEFT JOIN pharmacy_suppliers s ON po.supplier_id = s.id
      LEFT JOIN pharmacy_po_items poi ON po.id = poi.po_id
      ${where} GROUP BY po.id ORDER BY po.created_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    return c.json({ purchaseOrders: results, meta: paginationMeta(page, limit, countResult?.total ?? 0) });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch purchase orders' }); }
});

purchaseRoutes.get('/purchase-orders/:id', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    const po = await db.$client.prepare(`
      SELECT po.*, s.name as supplier_name FROM pharmacy_purchase_orders po
      LEFT JOIN pharmacy_suppliers s ON po.supplier_id = s.id
      WHERE po.id = ? AND po.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!po) throw new HTTPException(404, { message: 'Purchase order not found' });
    const { results: items } = await db.$client.prepare(`
      SELECT poi.*, i.name as item_name FROM pharmacy_po_items poi
      JOIN pharmacy_items i ON poi.item_id = i.id
      WHERE poi.po_id = ? AND poi.tenant_id = ?
    `).bind(id, tenantId).all();
    return c.json({ purchaseOrder: po, items });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to fetch purchase order' }); }
});

purchaseRoutes.post('/purchase-orders', requireRole(...PHARM_WRITE), zValidator('json', createPurchaseOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const poNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_po', 'PO');
    const subtotal = data.items.reduce((s, i) => s + i.quantity * i.standardRate, 0);
    const totalAmount = subtotal - data.discountAmount + data.vatAmount + data.adjustment;

    const poResult = await db.$client.prepare(`
      INSERT INTO pharmacy_purchase_orders
        (po_no, supplier_id, po_date, reference_no, subtotal, discount_amount, discount_pct,
         vat_amount, total_amount, adjustment, delivery_address, delivery_days, delivery_date,
         remarks, terms_conditions, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      poNo, data.supplierId, data.poDate, data.referenceNo ?? null,
      subtotal, data.discountAmount, data.discountPct, data.vatAmount, totalAmount, data.adjustment,
      data.deliveryAddress ?? null, data.deliveryDays ?? 0, data.deliveryDate ?? null,
      data.remarks ?? null, data.termsConditions ?? null, tenantId, userId,
    ).run();

    const poId = poResult.meta.last_row_id;
    const batchStmts = data.items.map((item) => {
      const itemSubtotal = item.quantity * item.standardRate;
      return db.$client.prepare(`
        INSERT INTO pharmacy_po_items
          (po_id, item_id, quantity, standard_rate, pending_qty, subtotal, vat_amount, total_amount, remarks, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(poId, item.itemId, item.quantity, item.standardRate, item.quantity, itemSubtotal, item.vatAmount ?? 0, itemSubtotal + (item.vatAmount ?? 0), item.remarks ?? null, tenantId);
    });

    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Purchase order created', id: poId, poNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create purchase order' }); }
});

purchaseRoutes.put('/purchase-orders/:id/cancel', requireRole(...PHARM_WRITE), zValidator('json', cancelPurchaseOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  try {
    const po = await db.$client.prepare(
      `SELECT * FROM pharmacy_purchase_orders WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<{ status: string }>();
    if (!po) throw new HTTPException(404, { message: 'PO not found' });
    if (po.status === 'complete' || po.status === 'cancelled') {
      throw new HTTPException(400, { message: `Cannot cancel a ${po.status} PO` });
    }
    await db.$client.prepare(`
      UPDATE pharmacy_purchase_orders SET status='cancelled', cancel_remarks=?, cancelled_by=?, cancelled_at=datetime('now', '+6 hours')
      WHERE id=? AND tenant_id=?
    `).bind(data.cancelRemarks, userId, id, tenantId).run();
    return c.json({ message: 'Purchase order cancelled' });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to cancel PO' }); }
});

// ─── GOODS RECEIPTS (Phase 2) ─────────────────────────────────────────────────

purchaseRoutes.get('/goods-receipts', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { supplierId, from, to } = c.req.query();
  const { page, limit, offset } = getPagination(c);
  try {
    let where = 'WHERE g.tenant_id = ? AND g.is_cancelled = 0';
    const params: (string | number)[] = [tenantId];
    if (supplierId) { where += ' AND g.supplier_id = ?'; params.push(supplierId); }
    if (from)   { where += ' AND g.grn_date >= ?'; params.push(from); }
    if (to)     { where += ' AND g.grn_date <= ?'; params.push(to); }

    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM pharmacy_goods_receipts g ${where}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await db.$client.prepare(`
      SELECT g.*, s.name as supplier_name FROM pharmacy_goods_receipts g
      LEFT JOIN pharmacy_suppliers s ON g.supplier_id = s.id
      ${where} ORDER BY g.grn_date DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    return c.json({ goodsReceipts: results, meta: paginationMeta(page, limit, countResult?.total ?? 0) });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch goods receipts' }); }
});

purchaseRoutes.get('/goods-receipts/:id', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    const grn = await db.$client.prepare(`
      SELECT g.*, s.name as supplier_name FROM pharmacy_goods_receipts g
      LEFT JOIN pharmacy_suppliers s ON g.supplier_id = s.id
      WHERE g.id = ? AND g.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!grn) throw new HTTPException(404, { message: 'GRN not found' });

    const { results: items } = await db.$client.prepare(`
      SELECT gi.*, i.name as item_name FROM pharmacy_grn_items gi
      JOIN pharmacy_items i ON gi.item_id = i.id
      WHERE gi.grn_id = ? AND gi.tenant_id = ?
    `).bind(id, tenantId).all();
    return c.json({ grn, items });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to fetch GRN' }); }
});

purchaseRoutes.post('/goods-receipts', requireRole(...PHARM_WRITE), zValidator('json', createGoodsReceiptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    // P0-24: Validate supplier tenant ownership before any insert.
    const supplier = await db.$client.prepare(
      `SELECT id FROM pharmacy_suppliers WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    ).bind(data.supplierId, tenantId).first<{ id: number }>();
    if (!supplier) {
      throw new HTTPException(400, { message: `Supplier ${data.supplierId} does not belong to this tenant` });
    }
    if (data.poId) {
      const po = await db.$client.prepare(
        `SELECT id, supplier_id FROM pharmacy_purchase_orders WHERE id = ? AND tenant_id = ?`,
      ).bind(data.poId, tenantId).first<{ id: number; supplier_id: number }>();
      if (!po) {
        throw new HTTPException(400, { message: `Purchase order ${data.poId} not found for this tenant` });
      }
      if (Number(po.supplier_id) !== Number(data.supplierId)) {
        throw new HTTPException(400, { message: 'PO supplier does not match GRN supplier' });
      }
    }
    // Calculate totals
    let subtotal = 0;
    const processedItems = data.items.map((item) => {
      const lineSubtotal = item.receivedQty * item.itemRate;
      const discountAmt = Math.round(lineSubtotal * (item.discountPct / 100));
      const afterDiscount = lineSubtotal - discountAmt;
      const vatAmt = Math.round(afterDiscount * (item.vatPct / 100));
      const total = afterDiscount + vatAmt;
      const margin = item.salePrice > 0 ? ((item.salePrice - item.itemRate) / item.salePrice) * 100 : 0;
      subtotal += total;
      return { ...item, lineSubtotal, discountAmt, vatAmt, total, costPrice: item.itemRate, margin };
    });

    const headerVatAmount = Math.round(subtotal * ((data.vatPct ?? 0) / 100));
    const totalAmount = subtotal - data.discountAmount + headerVatAmount + data.adjustment;
    const grnPrintId = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_grn', 'GRN');

    const grnResult = await db.$client.prepare(`
      INSERT INTO pharmacy_goods_receipts
        (grn_print_id, po_id, invoice_no, supplier_id, grn_date, supplier_bill_date,
         subtotal, discount_amount, discount_pct, vat_amount, vat_pct, total_amount, adjustment,
         credit_period, is_item_discount_applicable, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      grnPrintId, data.poId ?? null, data.invoiceNo ?? null, data.supplierId,
      data.grnDate, data.supplierBillDate ?? null,
      subtotal, data.discountAmount, data.discountPct, headerVatAmount, data.vatPct,
      totalAmount, data.adjustment, data.creditPeriod,
      data.isItemDiscountApplicable ? 1 : 0, data.remarks ?? null,
      tenantId, userId,
    ).run();

    const grnId = grnResult.meta.last_row_id;
    const batchStmts: D1PreparedStatement[] = [];

    for (const item of processedItems) {
      // Insert GRN item
      const grnItemResult = await db.$client.prepare(`
        INSERT INTO pharmacy_grn_items
          (grn_id, item_id, batch_no, expiry_date, received_qty, free_qty, rejected_qty,
           item_rate, mrp, discount_pct, discount_amount, vat_pct, vat_amount,
           subtotal, total_amount, cost_price, sale_price, margin, manufacture_date, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        grnId, item.itemId, item.batchNo, item.expiryDate ?? null,
        item.receivedQty, item.freeQty ?? 0, item.rejectedQty ?? 0,
        item.itemRate, item.mrp, item.discountPct, item.discountAmt,
        item.vatPct, item.vatAmt, item.lineSubtotal, item.total,
        item.costPrice, item.salePrice, item.margin,
        item.manufactureDate ?? null, tenantId, userId,
      ).run();

      const grnItemId = grnItemResult.meta.last_row_id;

      // Create stock entry
      batchStmts.push(db.$client.prepare(`
        INSERT INTO pharmacy_stock
          (item_id, grn_item_id, batch_no, expiry_date, available_qty, mrp,
           cost_price, sale_price, margin, vat_pct, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.itemId, grnItemId, item.batchNo, item.expiryDate ?? null,
        item.receivedQty + item.freeQty,
        item.mrp, item.costPrice, item.salePrice, item.margin, item.vatPct,
        tenantId, userId,
      ));

      // Stock transaction entry
      batchStmts.push(db.$client.prepare(`
        INSERT INTO pharmacy_stock_transactions
          (item_id, transaction_type, reference_type, reference_id, batch_no, expiry_date,
           in_qty, price, remarks, tenant_id, created_by)
        VALUES (?, 'purchase', 'grn', ?, ?, ?, ?, ?, 'GRN receipt', ?, ?)
      `).bind(item.itemId, grnId, item.batchNo, item.expiryDate ?? null, item.receivedQty + item.freeQty, item.costPrice, tenantId, userId));
    }

    // Update PO received quantities if linked
    if (data.poId) {
      for (const item of data.items) {
        batchStmts.push(db.$client.prepare(`
          UPDATE pharmacy_po_items SET received_qty = received_qty + ?, pending_qty = pending_qty - ?
          WHERE po_id = ? AND item_id = ? AND tenant_id = ?
        `).bind(item.receivedQty, item.receivedQty, data.poId, item.itemId, tenantId));
      }
      // F9 fix: Calculate PO status in JS rather than subquery inside batch
      const { results: poItems } = await db.$client.prepare(
        `SELECT pending_qty, item_id FROM pharmacy_po_items WHERE po_id = ? AND tenant_id = ?`
      ).bind(data.poId, tenantId).all<{ pending_qty: number; item_id: number }>();
      const receivedMap = new Map(data.items.map(i => [i.itemId, i.receivedQty]));
      let totalPendingAfter = 0;
      for (const poItem of poItems) {
        const received = receivedMap.get(poItem.item_id) ?? 0;
        totalPendingAfter += Math.max(0, poItem.pending_qty - received);
      }
      const newStatus = totalPendingAfter <= 0 ? 'complete' : 'partial';
      batchStmts.push(db.$client.prepare(`
        UPDATE pharmacy_purchase_orders SET status=?, updated_at=datetime('now', '+6 hours') WHERE id=? AND tenant_id=?
      `).bind(newStatus, data.poId, tenantId));
    }

    if (batchStmts.length > 0) await db.$client.batch(batchStmts);

    // P0-24: Accounting post (best-effort, queued) + audit log
    try {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'pharmacy_purchase',
        sourceId: String(grnId),
        eventType: ACCOUNTING_EVENT_TYPES.pharmacyPurchase,
        eventDate: data.grnDate,
        payload: {
          totalAmount,
          supplierId: data.supplierId,
          paymentMethod: 'credit',
          isCredit: true,
        },
        createdBy: userId,
      });
    } catch (err) {
      console.error('[pharmacy] GRN accounting enqueue failed (non-fatal):', err);
    }
    void createAuditLog(c.env, tenantId, userId, 'PHARMACY_GRN_CREATE', 'pharmacy_goods_receipts', Number(grnId), {
      grnPrintId, totalAmount, itemCount: processedItems.length, supplierId: data.supplierId,
    });
    return c.json({ message: 'Goods receipt created', id: grnId, grnPrintId, totalAmount }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create goods receipt' }); }
});

/**
 * Phase 7 (fix/pharmacy-inventory) — Canonical GRN (P0-24) with idempotency.
 */
const canonicalGrnSchema = createGoodsReceiptSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

purchaseRoutes.post(
  '/goods-receipts/v2',
  requireRole(...PHARM_WRITE),
  zValidator('json', canonicalGrnSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json');
    const idempotencyKey = c.req.header('Idempotency-Key') ?? data.idempotencyKey;

    if (idempotencyKey) {
      const requestHash = await createIdempotencyRequestHash({ tenantId, userId, data, idempotencyKey });
      const replay = await reserveMutationIdempotencyKey(c.env.DB, {
        tenantId, mutationType: 'pharmacy_grn', idempotencyKey, requestHash,
        createdBy: userId,
        mismatchMessage: 'Idempotency key reuse with different GRN payload',
        conflictMessage: 'Pharmacy GRN with this idempotency key is already being processed',
      });
      if (replay) return c.json({ ...(replay.responseBody as Record<string, unknown>), replayed: true }, 200);
    }

    try {
      // P0-24: Validate supplier + PO ownership
      const supplier = await db.$client.prepare(
        `SELECT id FROM pharmacy_suppliers WHERE id = ? AND tenant_id = ? AND is_active = 1`,
      ).bind(data.supplierId, tenantId).first<{ id: number }>();
      if (!supplier) throw new HTTPException(400, { message: `Supplier ${data.supplierId} does not belong to this tenant` });
      if (data.poId) {
        const po = await db.$client.prepare(
          `SELECT id, supplier_id FROM pharmacy_purchase_orders WHERE id = ? AND tenant_id = ?`,
        ).bind(data.poId, tenantId).first<{ id: number; supplier_id: number }>();
        if (!po) throw new HTTPException(400, { message: `Purchase order ${data.poId} not found for this tenant` });
        if (Number(po.supplier_id) !== Number(data.supplierId)) {
          throw new HTTPException(400, { message: 'PO supplier does not match GRN supplier' });
        }
      }

      let subtotal = 0;
      const processedItems = data.items.map((item) => {
        const lineSubtotal = item.receivedQty * item.itemRate;
        const discountAmt = Math.round(lineSubtotal * (item.discountPct / 100));
        const afterDiscount = lineSubtotal - discountAmt;
        const vatAmt = Math.round(afterDiscount * (item.vatPct / 100));
        const total = afterDiscount + vatAmt;
        const margin = item.salePrice > 0 ? ((item.salePrice - item.itemRate) / item.salePrice) * 100 : 0;
        subtotal += total;
        return { ...item, lineSubtotal, discountAmt, vatAmt, total, costPrice: item.itemRate, margin };
      });
      const headerVatAmount = Math.round(subtotal * ((data.vatPct ?? 0) / 100));
      const totalAmount = subtotal - data.discountAmount + headerVatAmount + data.adjustment;
      const grnPrintId = await getNextSequence(c.env.DB, tenantId, 'pharmacy_grn', 'GRN');

      const grnResult = await db.$client.prepare(`
        INSERT INTO pharmacy_goods_receipts
          (grn_print_id, po_id, invoice_no, supplier_id, grn_date, supplier_bill_date,
           subtotal, discount_amount, discount_pct, vat_amount, vat_pct, total_amount, adjustment,
           credit_period, is_item_discount_applicable, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        grnPrintId, data.poId ?? null, data.invoiceNo ?? null, data.supplierId,
        data.grnDate, data.supplierBillDate ?? null,
        subtotal, data.discountAmount, data.discountPct, headerVatAmount, data.vatPct,
        totalAmount, data.adjustment, data.creditPeriod,
        data.isItemDiscountApplicable ? 1 : 0, data.remarks ?? null,
        tenantId, userId,
      ).run();
      const grnId = Number(grnResult.meta.last_row_id);

      const batchStmts: D1PreparedStatement[] = [];
      for (const item of processedItems) {
        const grnItemResult = await db.$client.prepare(`
          INSERT INTO pharmacy_grn_items
            (grn_id, item_id, batch_no, expiry_date, received_qty, free_qty, rejected_qty,
             item_rate, mrp, discount_pct, discount_amount, vat_pct, vat_amount,
             subtotal, total_amount, cost_price, sale_price, margin, manufacture_date, tenant_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          grnId, item.itemId, item.batchNo, item.expiryDate ?? null,
          item.receivedQty, item.freeQty ?? 0, item.rejectedQty ?? 0,
          item.itemRate, item.mrp, item.discountPct, item.discountAmt,
          item.vatPct, item.vatAmt, item.lineSubtotal, item.total,
          item.costPrice, item.salePrice, item.margin,
          item.manufactureDate ?? null, tenantId, userId,
        ).run();
        const grnItemId = Number(grnItemResult.meta.last_row_id);

        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_stock
            (item_id, grn_item_id, batch_no, expiry_date, available_qty, mrp,
             cost_price, sale_price, margin, vat_pct, tenant_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.itemId, grnItemId, item.batchNo, item.expiryDate ?? null,
          item.receivedQty + (item.freeQty ?? 0),
          item.mrp, item.costPrice, item.salePrice, item.margin, item.vatPct,
          tenantId, userId,
        ));
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (item_id, transaction_type, reference_type, reference_id, batch_no, expiry_date,
             in_qty, price, remarks, tenant_id, created_by)
          VALUES (?, 'purchase', 'grn', ?, ?, ?, ?, ?, 'GRN receipt', ?, ?)
        `).bind(item.itemId, grnId, item.batchNo, item.expiryDate ?? null, item.receivedQty + (item.freeQty ?? 0), item.costPrice, tenantId, userId));
      }

      if (data.poId) {
        for (const item of processedItems) {
          batchStmts.push(db.$client.prepare(`
            UPDATE pharmacy_po_items SET received_qty = received_qty + ?, pending_qty = pending_qty - ?
            WHERE po_id = ? AND item_id = ? AND tenant_id = ?
          `).bind(item.receivedQty, item.receivedQty, data.poId, item.itemId, tenantId));
        }
        const { results: poItems } = await db.$client.prepare(
          `SELECT pending_qty, item_id FROM pharmacy_po_items WHERE po_id = ? AND tenant_id = ?`,
        ).bind(data.poId, tenantId).all<{ pending_qty: number; item_id: number }>();
        const receivedMap = new Map(processedItems.map((i) => [i.itemId, i.receivedQty]));
        let totalPendingAfter = 0;
        for (const poItem of poItems) {
          const received = receivedMap.get(poItem.item_id) ?? 0;
          totalPendingAfter += Math.max(0, poItem.pending_qty - received);
        }
        const newStatus = totalPendingAfter <= 0 ? 'complete' : 'partial';
        batchStmts.push(db.$client.prepare(`
          UPDATE pharmacy_purchase_orders SET status=?, updated_at=datetime('now', '+6 hours') WHERE id=? AND tenant_id=?
        `).bind(newStatus, data.poId, tenantId));
      }

      if (batchStmts.length > 0) await db.$client.batch(batchStmts);

      try {
        await recordAccountingPostingEvent(c.env.DB, {
          tenantId,
          sourceType: 'pharmacy_purchase',
          sourceId: String(grnId),
          eventType: ACCOUNTING_EVENT_TYPES.pharmacyPurchase,
          eventDate: data.grnDate,
          payload: { totalAmount, supplierId: data.supplierId, paymentMethod: 'credit', isCredit: true },
          createdBy: userId,
        });
      } catch (err) {
        console.error('[pharmacy] canonical GRN accounting enqueue failed (non-fatal):', err);
      }
      void createAuditLog(c.env, tenantId, userId, 'PHARMACY_GRN_CREATE', 'pharmacy_goods_receipts', grnId, {
        grnPrintId, totalAmount, itemCount: processedItems.length, supplierId: data.supplierId, replayed: false,
      });
      if (idempotencyKey) {
        await completeMutationIdempotencyKey(c.env.DB, {
          tenantId, mutationType: 'pharmacy_grn', idempotencyKey, sourceId: String(grnId),
          responseBody: { id: grnId, grnPrintId, totalAmount, message: 'Goods receipt created' },
        });
      }
      return c.json({ message: 'Goods receipt created', id: grnId, grnPrintId, totalAmount, replayed: false }, 201);
    } catch (err) {
      if (idempotencyKey) {
        await markMutationIdempotencyKeyFailed(c.env.DB, {
          tenantId, mutationType: 'pharmacy_grn', idempotencyKey,
        }).catch(() => undefined);
      }
      if (err instanceof HTTPException) throw err;
      console.error('[pharmacy] canonical GRN create failed', err);
      throw new HTTPException(500, { message: 'Failed to create goods receipt' });
    }
  },
);

// ─── SUPPLIER RETURNS (Phase 2) ───────────────────────────────────────────────

purchaseRoutes.get('/returns/supplier', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT r.*, s.name as supplier_name FROM pharmacy_supplier_returns r
      LEFT JOIN pharmacy_suppliers s ON r.supplier_id = s.id
      WHERE r.tenant_id = ? AND r.is_active = 1 ORDER BY r.return_date DESC
    `).bind(tenantId).all();
    return c.json({ returns: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch supplier returns' }); }
});

purchaseRoutes.post('/returns/supplier', requireRole(...PHARM_WRITE), zValidator('json', createSupplierReturnSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    let totalAmount = 0;
    const processedItems = data.items.map((item) => {
      const subtotal = item.quantity * item.itemRate;
      const discount = Math.round(subtotal * (item.discountPct / 100));
      const vat = Math.round((subtotal - discount) * (item.vatPct / 100));
      const total = subtotal - discount + vat;
      totalAmount += total;
      return { ...item, subtotal, discountAmt: discount, vatAmt: vat, total };
    });

    // F5 fix: Validate stock availability before supplier return deduction
    for (const item of processedItems) {
      if (item.stockId) {
        const stock = await db.$client.prepare(
          `SELECT available_qty FROM pharmacy_stock WHERE id = ? AND tenant_id = ? AND is_active = 1`
        ).bind(item.stockId, tenantId).first<{ available_qty: number }>();
        if (!stock) throw new HTTPException(400, { message: `Stock record ${item.stockId} not found` });
        if (stock.available_qty < item.quantity) {
          throw new HTTPException(400, { message: `Insufficient stock for return. Available: ${stock.available_qty}, Requested: ${item.quantity}` });
        }
      }
    }

    const returnNo = await getNextSequence(c.env.DB, tenantId!, 'pharmacy_return_supplier', 'RS');
    const returnResult = await db.$client.prepare(`
      INSERT INTO pharmacy_supplier_returns
        (return_no, supplier_id, grn_id, return_date, total_amount, remarks, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(returnNo, data.supplierId, data.grnId ?? null, data.returnDate, totalAmount, data.remarks ?? null, tenantId, userId).run();

    const returnId = returnResult.meta.last_row_id;
    const batchStmts: D1PreparedStatement[] = [];

    for (const item of processedItems) {
      batchStmts.push(db.$client.prepare(`
        INSERT INTO pharmacy_supplier_return_items
          (return_id, item_id, stock_id, batch_no, quantity, item_rate, subtotal, discount_pct, vat_amount, total_amount, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(returnId, item.itemId, item.stockId ?? null, item.batchNo ?? null, item.quantity, item.itemRate, item.subtotal, item.discountPct, item.vatAmt, item.total, tenantId, userId));

      // Deduct stock
      if (item.stockId) {
        batchStmts.push(db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at=datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND available_qty >= ?`,
        ).bind(item.quantity, item.stockId, tenantId, item.quantity));
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (item_id, transaction_type, reference_type, reference_id, batch_no, out_qty, price, remarks, tenant_id, created_by)
          VALUES (?, 'return_out', 'supplier_return', ?, ?, ?, ?, 'Return to supplier', ?, ?)
        `).bind(item.itemId, returnId, item.batchNo ?? null, item.quantity, item.itemRate, tenantId, userId));
      }
    }

    if (batchStmts.length > 0) await db.$client.batch(batchStmts);
    return c.json({ message: 'Supplier return created', id: returnId, returnNo }, 201);
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to create supplier return' }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — INVOICES & RETURNS
// ══════════════════════════════════════════════════════════════════════════════

export default purchaseRoutes;

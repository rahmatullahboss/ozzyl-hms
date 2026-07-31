import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { recordAndPostAccountingEvent, ACCOUNTING_EVENT_TYPES } from '../../lib/accounting-posting';
import { requireRole } from '../../middleware/rbac';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { HTTPException } from 'hono/http-exception';

const inventoryAccountingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const ACCOUNTING_ROLES = ['hospital_admin', 'director', 'accountant'] as const;

inventoryAccountingRoutes.post('/post', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const { goodsReceiptId } = await c.req.json<{ goodsReceiptId: number | string }>();

  const gr = await db.$client.prepare(`
    SELECT GoodsReceiptId, GRDate, VendorId, TotalAmount, PaymentMode, IsPostedToAcc
    FROM InventoryGoodsReceipt
    WHERE GoodsReceiptId = ? AND tenant_id = ? AND (IsActive = 1 OR IsActive IS NULL)
  `).bind(goodsReceiptId, tenantId).first<{
    GoodsReceiptId: number;
    GRDate?: string | null;
    VendorId: number;
    TotalAmount: number;
    PaymentMode?: string | null;
    IsPostedToAcc?: number | null;
  }>();

  if (!gr) throw new HTTPException(404, { message: 'Goods receipt not found' });
  if (Number(gr.IsPostedToAcc || 0) === 1) {
    return c.json({ success: true, message: 'Inventory transaction already posted to accounting' });
  }

  const eventDate = gr.GRDate || getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, eventDate, 'Inventory goods receipt accounting posting');

  const result = await recordAndPostAccountingEvent(c.env.DB, {
    tenantId,
    sourceType: 'inventory_gr',
    sourceId: String(goodsReceiptId),
    eventType: ACCOUNTING_EVENT_TYPES.inventoryPurchase,
    eventDate,
    createdBy: userId,
    payload: {
      totalAmount: Number(gr.TotalAmount || 0),
      supplierId: Number(gr.VendorId),
      paymentMethod: gr.PaymentMode ?? null,
      isCredit: String(gr.PaymentMode || '').toLowerCase() === 'credit'
    }
  });

  if (result.posted) {
    // Sync status back to GR table
    await db.$client.prepare(
      'UPDATE InventoryGoodsReceipt SET IsPostedToAcc = 1 WHERE GoodsReceiptId = ? AND tenant_id = ?'
    ).bind(goodsReceiptId, tenantId).run();
  }

  return c.json({
    success: result.posted,
    voucherId: result.voucherId,
    voucherNumber: result.voucherNumber,
    message: result.posted ? 'Inventory transaction posted to accounting' : 'Posting failed or queued'
  }, result.posted ? 201 : 202);
});

inventoryAccountingRoutes.get('/unposted', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const result = await db.$client.prepare(`
    SELECT gr.GoodsReceiptId as id, gr.GRNumber as reference, gr.GRDate as date,
           gr.TotalAmount as amount, v.VendorName as vendor
    FROM InventoryGoodsReceipt gr
    LEFT JOIN InventoryVendor v ON v.VendorId = gr.VendorId
    WHERE gr.tenant_id = ? AND gr.IsPostedToAcc = 0 AND gr.IsActive = 1
    ORDER BY gr.GRDate DESC
  `).bind(tenantId).all();

  return c.json({ unpostedTransactions: result.results });
});

inventoryAccountingRoutes.put('/mark-posted/:goodsReceiptId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const goodsReceiptId = c.req.param('goodsReceiptId');

  const gr = await db.$client.prepare(`
    SELECT GoodsReceiptId, GRDate, IsPostedToAcc
    FROM InventoryGoodsReceipt
    WHERE GoodsReceiptId = ? AND tenant_id = ? AND (IsActive = 1 OR IsActive IS NULL)
  `).bind(goodsReceiptId, tenantId).first<{ GoodsReceiptId: number; GRDate?: string | null; IsPostedToAcc?: number | null }>();

  if (!gr) throw new HTTPException(404, { message: 'Goods receipt not found' });
  if (Number(gr.IsPostedToAcc || 0) === 1) {
    return c.json({ success: true, message: 'Goods receipt already marked as accounting posted' });
  }

  const eventDate = gr.GRDate || getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, eventDate, 'Inventory goods receipt accounting sync');

  const voucher = await db.$client.prepare(`
    SELECT id
    FROM accounting_vouchers
    WHERE tenant_id = ?
      AND source_type = 'inventory_gr'
      AND source_id = ?
      AND event_type = ?
      AND status = 'verified'
    LIMIT 1
  `).bind(tenantId, String(goodsReceiptId), ACCOUNTING_EVENT_TYPES.inventoryPurchase).first<{ id: number }>();

  if (!voucher) {
    throw new HTTPException(409, { message: 'Cannot mark goods receipt as posted without a verified accounting voucher' });
  }

  await db.$client.prepare(
    'UPDATE InventoryGoodsReceipt SET IsPostedToAcc = 1 WHERE GoodsReceiptId = ? AND tenant_id = ?'
  ).bind(goodsReceiptId, tenantId).run();

  return c.json({ success: true });
});

export default inventoryAccountingRoutes;

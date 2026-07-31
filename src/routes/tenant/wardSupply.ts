import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { makeInventoryQrCode, stockTransactionStatement, upsertQrTag } from './inventory/helpers';
import { getNextSequence } from '../../lib/sequence';
import { requireRole } from '../../middleware/rbac';
import { hasPermission } from '../../lib/ipd-ot-rbac';

const WARD_SUPPLY_ROLES = ['nurse', 'pharmacist', 'hospital_admin', 'md'] as const;

const wardSupplyRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── RBAC: Restrict all ward supply endpoints to authorized roles ───────────
wardSupplyRoutes.use('/*', requireRole(...WARD_SUPPLY_ROLES));

/**
 * Helper: enforce the Phase-8 ward-supply dispatch permission
 * (`ward.supply.dispatch`) on top of the role middleware. Routes that
 * actually dispatch stock should call this in their handler.
 */
function assertWardSupplyDispatch(c: { get: (k: 'role') => unknown }): void {
  const role = c.get('role') as string | undefined;
  if (!hasPermission(role, 'ward.supply.dispatch')) {
    throw new HTTPException(403, { message: 'Not authorized to dispatch ward supplies' });
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const requisitionItemSchema = z.object({
  inventoryItemId: z.number().int().optional(),
  itemName: z.string().min(1).max(200),
  itemCode: z.string().max(50).optional(),
  specification: z.string().max(500).optional(),
  quantityRequested: z.number().int().min(1),
  unit: z.string().max(20).default('pcs'),
  unitPrice: z.number().min(0).optional(),
  remarks: z.string().max(500).optional(),
});

const createRequisitionSchema = z.object({
  wardId: z.number().int().positive(),
  wardName: z.string().max(100).optional(),
  sourceStoreId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
  roomNo: z.string().max(80).optional(),
  patientId: z.number().int().positive().optional(),
  requestedBy: z.string().min(1).max(100),
  priority: z.enum(['routine', 'urgent', 'emergency']).default('routine'),
  remarks: z.string().max(1000).optional(),
  items: z.array(requisitionItemSchema).min(1),
});

const updateRequisitionStatusSchema = z.object({
  status: z.enum(['submitted', 'approved', 'partially_dispatched', 'fully_dispatched', 'rejected', 'cancelled']),
  approvalRemarks: z.string().max(1000).optional(),
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    quantityApproved: z.number().int().min(0),
  })).optional(),
});

const createDispatchSchema = z.object({
  requisitionId: z.number().int().positive(),
  wardId: z.number().int().positive(),
  sourceStoreId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
  roomNo: z.string().max(80).optional(),
  items: z.array(z.object({
    requisitionItemId: z.number().int().positive(),
    inventoryItemId: z.number().int().positive().optional(),
    stockId: z.number().int().positive().optional(),
    locationId: z.number().int().positive().optional(),
    roomNo: z.string().max(80).optional(),
    itemName: z.string().min(1),
    quantityDispatched: z.number().int().min(1),
    unit: z.string().max(20).default('pcs'),
    batchNo: z.string().max(50).optional(),
    expiryDate: z.string().optional(),
    unitPrice: z.number().min(0).optional(),
    remarks: z.string().max(500).optional(),
  })).min(1),
});

const receiptSchema = z.object({
  dispatchId: z.number().int().positive(),
  receivedBy: z.string().min(1).max(100),
  receiptRemarks: z.string().max(1000).optional(),
  items: z.array(z.object({
    dispatchItemId: z.number().int().positive(),
    quantityReceived: z.number().int().min(0),
    locationId: z.number().int().positive().optional(),
    roomNo: z.string().max(80).optional(),
    remarks: z.string().max(500).optional(),
  })).min(1),
});

const consumptionSchema = z.object({
  wardId: z.number().int().positive(),
  locationId: z.number().int().positive().optional(),
  roomNo: z.string().max(80).optional(),
  tagCode: z.string().max(120).optional(),
  inventoryItemId: z.number().int().positive().optional(),
  stockLocationId: z.number().int().positive().optional(),
  itemName: z.string().min(1).max(200),
  quantity: z.number().int().min(1),
  unit: z.string().max(20).default('pcs'),
  patientId: z.number().int().positive().optional(),
  remarks: z.string().max(500).optional(),
});

const pharmacyWardRequisitionSchema = z.object({
  wardId: z.number().int().positive(),
  wardName: z.string().max(100).optional(),
  requestedBy: z.string().min(1).max(100),
  remarks: z.string().max(1000).optional(),
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    requestedQty: z.number().min(1),
    remarks: z.string().max(500).optional(),
  })).min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateReqNo(tenantId: string, seq: number): string {
  const prefix = 'WSR';
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

function generateDispatchNo(tenantId: string, seq: number): string {
  const prefix = 'WSD';
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

async function findDispatchStock(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  itemId: number | undefined,
  stockId: number | undefined,
  sourceStoreId: number | undefined,
  quantity: number,
) {
  if (stockId) {
    const row = await db.$client.prepare(
      'SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ? AND AvailableQuantity >= ? AND IsActive = 1'
    ).bind(tenantId, stockId, quantity).first<any>();
    return row || null;
  }
  if (!itemId) return null;
  const params: (string | number)[] = [tenantId, itemId, quantity];
  let sql = `
    SELECT * FROM InventoryStock
    WHERE tenant_id = ? AND ItemId = ? AND AvailableQuantity >= ? AND IsActive = 1
  `;
  if (sourceStoreId) {
    sql += ' AND StoreId = ?';
    params.push(sourceStoreId);
  }
  sql += " ORDER BY CASE WHEN ExpiryDate IS NULL OR ExpiryDate = '' THEN 1 ELSE 0 END, ExpiryDate ASC, StockId ASC LIMIT 1";
  return db.$client.prepare(sql).bind(...params).first<any>();
}

async function upsertWardLocationStock(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string;
    wardId: number;
    locationId?: number | null;
    roomNo?: string | null;
    inventoryItemId?: number | null;
    stockId?: number | null;
    fixedAssetStockId?: number | null;
    itemName: string;
    itemCode?: string | null;
    unit: string;
    quantity: number;
    minStockLevel?: number;
    transactionType: 'receipt' | 'return' | 'adjustment';
  },
) {
  const now = new Date().toISOString();
  const existing = await db.$client.prepare(`
    SELECT id, current_quantity FROM ward_supply_location_stock
    WHERE tenant_id = ? AND ward_id = ?
      AND IFNULL(location_id, 0) = IFNULL(?, 0)
      AND IFNULL(inventory_item_id, 0) = IFNULL(?, 0)
      AND IFNULL(stock_id, 0) = IFNULL(?, 0)
      AND IFNULL(fixed_asset_stock_id, 0) = IFNULL(?, 0)
  `).bind(
    input.tenantId,
    input.wardId,
    input.locationId || null,
    input.inventoryItemId || null,
    input.stockId || null,
    input.fixedAssetStockId || null,
  ).first<{ id: number; current_quantity: number }>();

  if (existing) {
    await db.$client.prepare(`
      UPDATE ward_supply_location_stock
      SET current_quantity = current_quantity + ?, last_receipt_date = ?, updated_at = ?, room_no = COALESCE(?, room_no)
      WHERE tenant_id = ? AND id = ?
    `).bind(input.quantity, now, now, input.roomNo || null, input.tenantId, existing.id).run();
    return existing.id;
  }

  const result = await db.$client.prepare(`
    INSERT INTO ward_supply_location_stock
      (tenant_id, ward_id, location_id, room_no, inventory_item_id, stock_id, fixed_asset_stock_id,
       item_name, item_code, unit, current_quantity, min_stock_level, is_fixed_asset, last_receipt_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.wardId,
    input.locationId || null,
    input.roomNo || null,
    input.inventoryItemId || null,
    input.stockId || null,
    input.fixedAssetStockId || null,
    input.itemName,
    input.itemCode || null,
    input.unit,
    input.quantity,
    input.minStockLevel || 0,
    input.fixedAssetStockId ? 1 : 0,
    now,
    now,
    now,
  ).run();
  return Number(result.meta.last_row_id);
}

// ─── Requisitions ─────────────────────────────────────────────────────────────

wardSupplyRoutes.get('/requisitions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, wardId, page = '1', limit = '20' } = c.req.query();

  let sql = 'SELECT * FROM ward_supply_requisitions WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (wardId) { sql += ' AND ward_id = ?'; params.push(Number(wardId)); }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM ward_supply_requisitions WHERE tenant_id = ? AND is_active = 1'
    + (status ? ' AND status = ?' : '') + (wardId ? ' AND ward_id = ?' : '')
  ).bind(...[tenantId, ...(status ? [status] : []), ...(wardId ? [Number(wardId)] : [])]).first<{ total: number }>();

  return c.json({
    requisitions: results,
    pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 },
  });
});

wardSupplyRoutes.get('/requisitions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const req = await db.$client.prepare(
    'SELECT * FROM ward_supply_requisitions WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first();

  if (!req) return c.json({ error: 'Requisition not found' }, 404);

  const { results: items } = await db.$client.prepare(
    'SELECT * FROM ward_supply_requisition_items WHERE tenant_id = ? AND requisition_id = ? ORDER BY id'
  ).bind(tenantId, id).all();

  return c.json({ requisition: { ...req, items } });
});

wardSupplyRoutes.post('/requisitions', zValidator('json', createRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as cnt FROM ward_supply_requisitions WHERE tenant_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();
  const reqNo = generateReqNo(tenantId, (countResult?.cnt ?? 0) + 1);

  const totalItems = data.items.length;
  const totalValue = data.items.reduce((s, i) => s + (i.quantityRequested * (i.unitPrice || 0)), 0);

  const result = await db.$client.prepare(`
    INSERT INTO ward_supply_requisitions
    (tenant_id, requisition_no, ward_id, ward_name, source_store_id, location_id, room_no,
     patient_id, requested_by, requested_by_id, status, priority, remarks, total_items, total_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)
  `).bind(
    tenantId,
    reqNo,
    data.wardId,
    data.wardName ?? null,
    data.sourceStoreId ?? null,
    data.locationId ?? null,
    data.roomNo ?? null,
    data.patientId ?? null,
    data.requestedBy,
    userId,
    data.priority,
    data.remarks ?? null,
    totalItems,
    totalValue,
  ).run();

  const reqId = result.meta.last_row_id;

  for (const item of data.items) {
    await db.$client.prepare(`
      INSERT INTO ward_supply_requisition_items
      (tenant_id, requisition_id, inventory_item_id, item_name, item_code, specification, quantity_requested, unit, unit_price, line_total, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, reqId, item.inventoryItemId ?? null, item.itemName, item.itemCode ?? null, item.specification ?? null, item.quantityRequested, item.unit, item.unitPrice ?? null, item.quantityRequested * (item.unitPrice || 0), item.remarks ?? null).run();
  }

  return c.json({ id: reqId, requisitionNo: reqNo }, 201);
});

// ─── Pharmacy Ward Requisitions ──────────────────────────────────────────────
// Danphe parity: nurse requests medicines from ward/sub-store.
wardSupplyRoutes.post('/pharmacy-requisitions', zValidator('json', pharmacyWardRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const reqNo = await getNextSequence(c.env.DB, tenantId, 'pharmacy_requisition', 'REQ');

  const result = await db.$client.prepare(`
    INSERT INTO pharmacy_requisitions
      (requisition_no, requesting_store, requesting_user_id, requisition_date, remarks, tenant_id, created_by)
    VALUES (?, ?, ?, date('now', '+6 hours'), ?, ?, ?)
  `).bind(reqNo, data.wardName ?? `Ward ${data.wardId}`, userId, data.remarks ?? null, tenantId, userId).run();
  const reqId = Number(result.meta.last_row_id);

  const itemStatements = data.items.map((item) => db.$client.prepare(`
    INSERT INTO pharmacy_requisition_items
      (requisition_id, item_id, requested_qty, pending_qty, remarks, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(reqId, item.itemId, item.requestedQty, item.requestedQty, item.remarks ?? null, tenantId, userId));
  if (itemStatements.length > 0) await db.$client.batch(itemStatements);

  return c.json({ id: reqId, requisitionNo: reqNo }, 201);
});

wardSupplyRoutes.patch('/requisitions/:id/status', zValidator('json', updateRequisitionStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT status FROM ward_supply_requisitions WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first<{ status: string }>();

  if (!existing) return c.json({ error: 'Requisition not found' }, 404);
  if (existing.status === 'cancelled' || existing.status === 'rejected') {
    return c.json({ error: 'Cannot change status of cancelled/rejected requisition' }, 400);
  }

  const updates: string[] = ['status = ?'];
  const params: (string | number | null)[] = [data.status];

  if (data.status === 'approved' || data.status === 'rejected') {
    updates.push('approved_by_id = ?', 'approved_at = CURRENT_TIMESTAMP', 'approval_remarks = ?');
    params.push(userId, data.approvalRemarks ?? null);
  }

  if (data.items && data.items.length > 0) {
    for (const item of data.items) {
      await db.$client.prepare(
        'UPDATE ward_supply_requisition_items SET quantity_approved = ?, status = ? WHERE tenant_id = ? AND id = ? AND requisition_id = ?'
      ).bind(item.quantityApproved, item.quantityApproved > 0 ? 'approved' : 'rejected', tenantId, item.itemId, id).run();
    }
  }

  await db.$client.prepare(
    `UPDATE ward_supply_requisitions SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?`
  ).bind(...params, tenantId, id).run();

  return c.json({ success: true });
});

wardSupplyRoutes.delete('/requisitions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    'UPDATE ward_supply_requisitions SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?'
  ).bind(tenantId, id).run();

  return c.json({ success: true });
});

// ─── Dispatches ───────────────────────────────────────────────────────────────

wardSupplyRoutes.get('/dispatches', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { requisitionId, wardId, status, page = '1', limit = '20' } = c.req.query();

  let sql = 'SELECT * FROM ward_supply_dispatches WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (requisitionId) { sql += ' AND requisition_id = ?'; params.push(Number(requisitionId)); }
  if (wardId) { sql += ' AND ward_id = ?'; params.push(Number(wardId)); }
  if (status) { sql += ' AND status = ?'; params.push(status); }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ dispatches: results });
});

wardSupplyRoutes.get('/dispatches/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const dispatch = await db.$client.prepare(
    'SELECT * FROM ward_supply_dispatches WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first();

  if (!dispatch) return c.json({ error: 'Dispatch not found' }, 404);

  const { results: items } = await db.$client.prepare(
    'SELECT * FROM ward_supply_dispatch_items WHERE tenant_id = ? AND dispatch_id = ? ORDER BY id'
  ).bind(tenantId, id).all();

  return c.json({ dispatch: { ...dispatch, items } });
});

wardSupplyRoutes.post('/dispatches', zValidator('json', createDispatchSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  // Phase 8 "Other issues" ward supply: gate the dispatch action on the
  // local permission catalog. Other endpoints (read/list) remain under the
  // role middleware above.
  assertWardSupplyDispatch(c);
  const data = c.req.valid('json');
  const req = await db.$client.prepare(
    'SELECT source_store_id, location_id, room_no, status FROM ward_supply_requisitions WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, data.requisitionId).first<{ source_store_id: number | null; location_id: number | null; room_no: string | null; status: string }>();
  if (!req) return c.json({ error: 'Requisition not found' }, 404);
  if (!['approved', 'partially_dispatched'].includes(req.status)) {
    return c.json({ error: 'Only approved requisitions can be dispatched' }, 400);
  }

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as cnt FROM ward_supply_dispatches WHERE tenant_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();
  const dispatchNo = generateDispatchNo(tenantId, (countResult?.cnt ?? 0) + 1);
  const sourceStoreId = data.sourceStoreId ?? req.source_store_id ?? undefined;
  const locationId = data.locationId ?? req.location_id ?? undefined;
  const roomNo = data.roomNo ?? req.room_no ?? undefined;
  const stockSelections = [];
  for (const item of data.items) {
    const stock = await findDispatchStock(db, tenantId, item.inventoryItemId, item.stockId, sourceStoreId, item.quantityDispatched);
    if (item.inventoryItemId && !stock) {
      return c.json({ error: `Insufficient stock for ${item.itemName}` }, 400);
    }
    stockSelections.push(stock);
  }

  const result = await db.$client.prepare(`
    INSERT INTO ward_supply_dispatches
    (tenant_id, dispatch_no, requisition_id, ward_id, source_store_id, location_id, room_no,
     dispatched_by, dispatched_by_id, total_items)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, dispatchNo, data.requisitionId, data.wardId, sourceStoreId ?? null, locationId ?? null, roomNo ?? null, 'System', userId, data.items.length).run();

  const dispatchId = result.meta.last_row_id;

  for (const [index, item] of data.items.entries()) {
    const stock = stockSelections[index];
    const stockId = stock?.StockId ?? item.stockId ?? null;
    const storeId = stock?.StoreId ?? sourceStoreId ?? null;
    const balance = stock ? Number(stock.AvailableQuantity) - item.quantityDispatched : 0;

    await db.$client.prepare(`
      INSERT INTO ward_supply_dispatch_items
      (tenant_id, dispatch_id, requisition_item_id, inventory_item_id, stock_id, source_store_id, location_id, room_no,
       item_name, quantity_dispatched, unit, batch_no, expiry_date, unit_price, line_total, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      dispatchId,
      item.requisitionItemId,
      item.inventoryItemId ?? null,
      stockId,
      storeId,
      item.locationId ?? locationId ?? null,
      item.roomNo ?? roomNo ?? null,
      item.itemName,
      item.quantityDispatched,
      item.unit,
      item.batchNo ?? stock?.BatchNo ?? null,
      item.expiryDate ?? stock?.ExpiryDate ?? null,
      item.unitPrice ?? stock?.CostPrice ?? null,
      item.quantityDispatched * (item.unitPrice || stock?.CostPrice || 0),
      item.remarks ?? null,
    ).run();

    if (stock && storeId) {
      await db.$client.prepare(`
        UPDATE InventoryStock SET AvailableQuantity = ?, ModifiedBy = ?, ModifiedOn = ?
        WHERE tenant_id = ? AND StockId = ?
      `).bind(balance, userId, new Date().toISOString(), tenantId, stock.StockId).run();
      await stockTransactionStatement(db, {
        tenantId,
        stockId: stock.StockId,
        itemId: stock.ItemId,
        storeId,
        transactionType: 'ward_dispatch',
        referenceNo: dispatchNo,
        referenceId: Number(dispatchId),
        outQuantity: item.quantityDispatched,
        balanceQuantity: balance,
        remarks: `Ward supply dispatch to ward ${data.wardId}`,
        createdBy: userId,
      }).run();
    }

    // Update requisition item dispatched quantity
    await db.$client.prepare(
      'UPDATE ward_supply_requisition_items SET quantity_dispatched = quantity_dispatched + ?, status = CASE WHEN quantity_dispatched + ? >= quantity_approved THEN "fully_dispatched" ELSE "partially_dispatched" END WHERE tenant_id = ? AND id = ?'
    ).bind(item.quantityDispatched, item.quantityDispatched, tenantId, item.requisitionItemId).run();
  }

  // Update requisition status
  const reqItems = await db.$client.prepare(
    'SELECT status FROM ward_supply_requisition_items WHERE tenant_id = ? AND requisition_id = ?'
  ).bind(tenantId, data.requisitionId).all<{ status: string }>();

  const allFullyDispatched = reqItems.results.every(i => i.status === 'fully_dispatched');
  const anyDispatched = reqItems.results.some(i => i.status === 'fully_dispatched' || i.status === 'partially_dispatched');

  await db.$client.prepare(
    'UPDATE ward_supply_requisitions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?'
  ).bind(allFullyDispatched ? 'fully_dispatched' : anyDispatched ? 'partially_dispatched' : 'approved', tenantId, data.requisitionId).run();

  return c.json({ id: dispatchId, dispatchNo }, 201);
});

wardSupplyRoutes.patch('/dispatches/:id/receipt', zValidator('json', receiptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const dispatch = await db.$client.prepare(
    'SELECT * FROM ward_supply_dispatches WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first<{ ward_id: number; location_id: number | null; room_no: string | null }>();

  if (!dispatch) return c.json({ error: 'Dispatch not found' }, 404);

  await db.$client.prepare(
    'UPDATE ward_supply_dispatches SET received_by = ?, received_by_id = ?, received_at = CURRENT_TIMESTAMP, receipt_remarks = ?, status = ? WHERE tenant_id = ? AND id = ?'
  ).bind(data.receivedBy, userId, data.receiptRemarks ?? null, 'fully_received', tenantId, id).run();

  for (const item of data.items) {
    await db.$client.prepare(
      'UPDATE ward_supply_dispatch_items SET quantity_received = ?, remarks = COALESCE(remarks, "") || ? WHERE tenant_id = ? AND id = ?'
    ).bind(item.quantityReceived, item.remarks ? ` | Receipt: ${item.remarks}` : '', tenantId, item.dispatchItemId).run();

    // Record ward stock receipt transaction
    const di = await db.$client.prepare(
      'SELECT * FROM ward_supply_dispatch_items WHERE tenant_id = ? AND id = ?'
    ).bind(tenantId, item.dispatchItemId).first<{
      item_name: string;
      inventory_item_id: number | null;
      stock_id: number | null;
      location_id: number | null;
      room_no: string | null;
      unit: string;
    }>();

    if (di) {
      await db.$client.prepare(`
        INSERT INTO ward_supply_transactions
          (tenant_id, ward_id, location_id, room_no, inventory_item_id, stock_id, item_name, transaction_type,
           quantity, reference_type, reference_id, performed_by, performed_by_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'receipt', ?, 'dispatch', ?, ?, ?, ?)
      `).bind(
        tenantId,
        dispatch.ward_id,
        item.locationId ?? di.location_id ?? dispatch.location_id ?? null,
        item.roomNo ?? di.room_no ?? dispatch.room_no ?? null,
        di.inventory_item_id,
        di.stock_id,
        di.item_name,
        item.quantityReceived,
        id,
        data.receivedBy,
        userId,
        item.remarks ?? null,
      ).run();
      const stockLocationId = await upsertWardLocationStock(db, {
        tenantId,
        wardId: dispatch.ward_id,
        locationId: item.locationId ?? di.location_id ?? dispatch.location_id ?? null,
        roomNo: item.roomNo ?? di.room_no ?? dispatch.room_no ?? null,
        inventoryItemId: di.inventory_item_id,
        stockId: di.stock_id,
        itemName: di.item_name,
        unit: di.unit || 'pcs',
        quantity: item.quantityReceived,
        transactionType: 'receipt',
      });
      await db.$client.prepare(`
        INSERT INTO ward_supply_location_transactions
          (tenant_id, ward_id, location_id, stock_location_id, inventory_item_id, stock_id, item_name,
           transaction_type, quantity, reference_type, reference_id, performed_by, performed_by_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'receipt', ?, 'dispatch', ?, ?, ?, ?)
      `).bind(
        tenantId,
        dispatch.ward_id,
        item.locationId ?? di.location_id ?? dispatch.location_id ?? null,
        stockLocationId,
        di.inventory_item_id,
        di.stock_id,
        di.item_name,
        item.quantityReceived,
        id,
        data.receivedBy,
        userId,
        item.remarks ?? null,
      ).run();
      const tagCode = makeInventoryQrCode(tenantId, 'ward_stock', stockLocationId);
      await db.$client.prepare(
        'UPDATE ward_supply_location_stock SET tag_code = ?, updated_at = ? WHERE tenant_id = ? AND id = ?'
      ).bind(tagCode, new Date().toISOString(), tenantId, stockLocationId).run();
      await upsertQrTag(db, {
        tenantId,
        tagCode,
        entityType: 'ward_stock',
        entityId: stockLocationId,
        humanLabel: `${di.item_name} - Ward ${dispatch.ward_id}`,
        createdBy: userId,
        payload: {
          system: 'hms',
          entityType: 'ward_stock',
          entityId: stockLocationId,
          wardId: dispatch.ward_id,
          locationId: item.locationId ?? di.location_id ?? dispatch.location_id ?? null,
          stockId: di.stock_id,
          itemId: di.inventory_item_id,
          itemName: di.item_name,
        },
      });
    }
  }

  return c.json({ success: true });
});

// ─── Ward Stock ───────────────────────────────────────────────────────────────

wardSupplyRoutes.get('/locations', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { wardId, active = 'true' } = c.req.query();
  const params: (string | number)[] = [tenantId];
  let sql = `
    SELECT * FROM InventoryLocation
    WHERE tenant_id = ? AND LocationType IN ('ward', 'room', 'bed')
  `;
  if (wardId) { sql += ' AND WardId = ?'; params.push(Number(wardId)); }
  if (active !== 'all') { sql += ' AND IsActive = ?'; params.push(active === 'false' ? 0 : 1); }
  sql += ' ORDER BY COALESCE(WardName, ""), COALESCE(RoomNo, ""), LocationName';
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ locations: results });
});

wardSupplyRoutes.get('/stock/:wardId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const wardId = Number(c.req.param('wardId'));
  const { lowStock, locationId, roomNo, detailed } = c.req.query();

  if (detailed === '1' || locationId || roomNo) {
    let locationSql = `
      SELECT LS.*, L.LocationName, L.LocationCode
      FROM ward_supply_location_stock LS
      LEFT JOIN InventoryLocation L ON L.LocationId = LS.location_id AND L.tenant_id = LS.tenant_id
      WHERE LS.tenant_id = ? AND LS.ward_id = ?
    `;
    const locationParams: (string | number)[] = [tenantId, wardId];
    if (locationId) { locationSql += ' AND LS.location_id = ?'; locationParams.push(Number(locationId)); }
    if (roomNo) { locationSql += ' AND LS.room_no = ?'; locationParams.push(roomNo); }
    if (lowStock === '1') { locationSql += ' AND LS.current_quantity <= LS.min_stock_level'; }
    locationSql += ' ORDER BY COALESCE(L.LocationName, LS.room_no, ""), LS.item_name';
    const { results } = await db.$client.prepare(locationSql).bind(...locationParams).all();
    return c.json({ stock: results });
  }

  let sql = 'SELECT * FROM ward_supply_stock WHERE tenant_id = ? AND ward_id = ?';
  const params: (string | number)[] = [tenantId, wardId];

  if (lowStock === '1') {
    sql += ' AND current_quantity <= min_stock_level';
  }

  sql += ' ORDER BY item_name';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ stock: results });
});

wardSupplyRoutes.get('/stock/:wardId/transactions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const wardId = Number(c.req.param('wardId'));
  const { itemId, locationId, limit = '50' } = c.req.query();

  if (locationId) {
    let locationSql = 'SELECT * FROM ward_supply_location_transactions WHERE tenant_id = ? AND ward_id = ? AND location_id = ?';
    const locationParams: (string | number)[] = [tenantId, wardId, Number(locationId)];
    if (itemId) { locationSql += ' AND inventory_item_id = ?'; locationParams.push(Number(itemId)); }
    locationSql += ' ORDER BY created_at DESC LIMIT ?';
    locationParams.push(Number(limit));
    const { results } = await db.$client.prepare(locationSql).bind(...locationParams).all();
    return c.json({ transactions: results });
  }

  let sql = 'SELECT * FROM ward_supply_transactions WHERE tenant_id = ? AND ward_id = ?';
  const params: (string | number)[] = [tenantId, wardId];

  if (itemId) { sql += ' AND inventory_item_id = ?'; params.push(Number(itemId)); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit));

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ transactions: results });
});

wardSupplyRoutes.post('/consumption', zValidator('json', consumptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  let locationStock: { id: number; current_quantity: number; item_name: string; inventory_item_id: number | null; stock_id: number | null; location_id: number | null } | null = null;

  if (data.tagCode) {
    const tag = await db.$client.prepare(
      "SELECT EntityId, EntityType FROM InventoryQrTag WHERE tenant_id = ? AND TagCode = ? AND Status = 'active'"
    ).bind(tenantId, data.tagCode.trim().toUpperCase()).first<{ EntityId: number; EntityType: string }>();
    if (!tag || tag.EntityType !== 'ward_stock') return c.json({ error: 'Invalid ward stock QR tag' }, 400);
    locationStock = await db.$client.prepare(
      'SELECT id, current_quantity, item_name, inventory_item_id, stock_id, location_id FROM ward_supply_location_stock WHERE tenant_id = ? AND id = ?'
    ).bind(tenantId, tag.EntityId).first<any>() || null;
  } else if (data.stockLocationId || data.locationId) {
    const params: (string | number | null)[] = [tenantId, data.wardId];
    let sql = `
      SELECT id, current_quantity, item_name, inventory_item_id, stock_id, location_id
      FROM ward_supply_location_stock
      WHERE tenant_id = ? AND ward_id = ?
    `;
    if (data.stockLocationId) {
      sql += ' AND id = ?';
      params.push(data.stockLocationId);
    } else {
      sql += ' AND location_id = ? AND (inventory_item_id = ? OR (inventory_item_id IS NULL AND item_name = ?))';
      params.push(data.locationId || null, data.inventoryItemId ?? null, data.itemName);
    }
    locationStock = await db.$client.prepare(sql).bind(...params).first<any>() || null;
  }

  if (locationStock) {
    if (locationStock.current_quantity < data.quantity) return c.json({ error: 'Insufficient location stock' }, 400);
    const newQty = locationStock.current_quantity - data.quantity;
    await db.$client.prepare(`
      UPDATE ward_supply_location_stock
      SET current_quantity = ?, last_consumption_date = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `).bind(newQty, new Date().toISOString(), new Date().toISOString(), tenantId, locationStock.id).run();
    await db.$client.prepare(`
      INSERT INTO ward_supply_location_transactions
        (tenant_id, ward_id, location_id, stock_location_id, inventory_item_id, stock_id, item_name,
         transaction_type, quantity, reference_type, reference_id, patient_id, performed_by, performed_by_id, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'consumption', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      data.wardId,
      data.locationId ?? locationStock.location_id ?? null,
      locationStock.id,
      locationStock.inventory_item_id,
      locationStock.stock_id,
      locationStock.item_name,
      data.quantity,
      data.patientId ? 'patient' : 'general',
      data.patientId ?? null,
      data.patientId ?? null,
      'System',
      userId,
      data.remarks ?? null,
    ).run();
  }

  // Check stock availability
  const stock = await db.$client.prepare(
    'SELECT current_quantity FROM ward_supply_stock WHERE tenant_id = ? AND ward_id = ? AND (inventory_item_id = ? OR (inventory_item_id IS NULL AND item_name = ?))'
  ).bind(tenantId, data.wardId, data.inventoryItemId ?? null, data.itemName).first<{ current_quantity: number }>();

  if (!stock || stock.current_quantity < data.quantity) {
    return c.json({ error: 'Insufficient stock' }, 400);
  }

  await db.$client.prepare(`
    INSERT INTO ward_supply_transactions
      (tenant_id, ward_id, location_id, room_no, inventory_item_id, stock_id, item_name,
       transaction_type, quantity, reference_type, reference_id, performed_by, performed_by_id, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'consumption', ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.wardId,
    data.locationId ?? locationStock?.location_id ?? null,
    data.roomNo ?? null,
    data.inventoryItemId ?? locationStock?.inventory_item_id ?? null,
    locationStock?.stock_id ?? null,
    data.itemName,
    data.quantity,
    data.patientId ? 'patient' : 'general',
    data.patientId ?? null,
    'System',
    userId,
    data.remarks ?? null,
  ).run();

  return c.json({ success: true }, 201);
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

wardSupplyRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const pendingReq = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM ward_supply_requisitions WHERE tenant_id = ? AND is_active = 1 AND status IN ('submitted', 'approved')"
  ).bind(tenantId).first<{ cnt: number }>();

  const todayDispatches = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM ward_supply_dispatches WHERE tenant_id = ? AND is_active = 1 AND date(dispatched_at) = date('now', '+6 hours')"
  ).bind(tenantId).first<{ cnt: number }>();

  const lowStock = await db.$client.prepare(
    'SELECT COUNT(*) as cnt FROM ward_supply_stock WHERE tenant_id = ? AND current_quantity <= min_stock_level'
  ).bind(tenantId).first<{ cnt: number }>();

  const totalReqMonth = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM ward_supply_requisitions WHERE tenant_id = ? AND is_active = 1 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
  ).bind(tenantId).first<{ cnt: number }>();

  return c.json({
    pendingRequisitions: pendingReq?.cnt ?? 0,
    todayDispatches: todayDispatches?.cnt ?? 0,
    lowStockItems: lowStock?.cnt ?? 0,
    totalRequisitionsThisMonth: totalReqMonth?.cnt ?? 0,
  });
});

export default wardSupplyRoutes;

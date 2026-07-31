import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import * as schemas from '../../../schemas/inventory';
import type { Env } from '../../../types';
import { generateSequenceNo } from '../../../utils/sequence';
import { getDb } from '../../../db';
import { createInventoryAuditLog } from './helpers';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../../lib/accounting-posting';
import { mirrorInventoryLabReagentReceipt } from '../../../lib/lab-inventory-bridge';
import { scheduleInventoryIntelligenceRecompute } from '../../../lib/inventory-intelligence/triggers';
import { createIdempotencyRequestHash } from '../../../lib/request-idempotency';
import {
  commitGoodsReceiptCore,
  findGoodsReceiptReplay,
  loadGoodsReceiptItemPolicies,
  loadGoodsReceiptProjectionLines,
  markGoodsReceiptProjectionCompleted,
  prepareGoodsReceipt,
  type PreparedGoodsReceiptLine,
} from '../../../lib/inventory-goods-receipt-atomic';

const gr = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();
type GrContext = Context<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>;
type GoodsReceiptBody = schemas.CreateGoodsReceiptInput;

type ProjectionLine = {
  grItemId: number;
  stockId: number;
  itemId: number;
  batchNo: string | null;
  expiryDate: string | null;
  quantity: number;
  costPrice: number;
  remarks: string | null;
};

function resolveGoodsReceiptOperationKey(c: GrContext, body: GoodsReceiptBody): string {
  const key = c.req.header('Idempotency-Key')?.trim()
    || body.IdempotencyKey?.trim()
    || crypto.randomUUID();
  if (key.length < 8 || key.length > 128) {
    throw new HTTPException(400, { message: 'Idempotency key must be between 8 and 128 characters.' });
  }
  return key;
}

function toProjectionLines(lines: PreparedGoodsReceiptLine[]): ProjectionLine[] {
  return lines.map((line) => ({
    grItemId: line.grItemId,
    stockId: line.stockId,
    itemId: line.item.ItemId,
    batchNo: line.item.BatchNo ?? null,
    expiryDate: line.item.ExpiryDate ?? null,
    quantity: line.normalizedReceipt.stockQuantity,
    costPrice: line.normalizedReceipt.costPerIssueUnit,
    remarks: line.item.Remarks ?? null,
  }));
}

async function finalizeGoodsReceiptProjections(
  c: GrContext,
  input: {
    tenantId: string;
    userId: string;
    body: GoodsReceiptBody;
    goodsReceiptId: number;
    grNumber: string;
    totalAmount: number;
    lines: ProjectionLine[];
  },
): Promise<string[]> {
  const warnings: string[] = [];
  const receivedDate = input.body.GRDate || new Date().toISOString().slice(0, 10);

  for (const line of input.lines) {
    try {
      await mirrorInventoryLabReagentReceipt(c.env.DB, {
        tenantId: input.tenantId,
        userId: input.userId,
        itemId: line.itemId,
        inventoryStockId: line.stockId,
        goodsReceiptItemId: line.grItemId,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        purchasePrice: line.costPrice,
        receivedDate,
        remarks: line.remarks ?? input.body.Remarks ?? null,
      });
    } catch (error) {
      warnings.push(`Lab reagent projection pending for item ${line.itemId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId: input.tenantId,
      sourceType: 'inventory_gr',
      sourceId: String(input.goodsReceiptId),
      eventType: ACCOUNTING_EVENT_TYPES.inventoryPurchase,
      eventDate: receivedDate,
      payload: {
        totalAmount: input.totalAmount,
        supplierId: input.body.VendorId,
        paymentMethod: input.body.PaymentMode,
        isCredit: input.body.PaymentMode === 'credit',
      },
      createdBy: input.userId,
    });
  } catch (error) {
    warnings.push(`Accounting projection pending: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (warnings.length > 0) return warnings;

  await createInventoryAuditLog(c, {
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'RECEIVE',
    eventType: 'goods_receipt',
    tableName: 'InventoryGoodsReceipt',
    recordId: input.goodsReceiptId,
    reason: input.body.Remarks ?? null,
    before: null,
    after: {
      GoodsReceiptId: input.goodsReceiptId,
      GRNumber: input.grNumber,
      VendorId: input.body.VendorId,
      StoreId: input.body.StoreId,
      PurchaseOrderId: input.body.PurchaseOrderId ?? null,
      TotalAmount: input.totalAmount,
      itemCount: input.body.Items.length,
    },
    whatChanged: {
      GoodsReceiptId: input.goodsReceiptId,
      GRNumber: input.grNumber,
      VendorId: input.body.VendorId,
      StoreId: input.body.StoreId,
      PurchaseOrderId: input.body.PurchaseOrderId ?? null,
      TotalAmount: input.totalAmount,
      itemCount: input.body.Items.length,
    },
  });

  await markGoodsReceiptProjectionCompleted(c.env.DB, {
    tenantId: input.tenantId,
    goodsReceiptId: input.goodsReceiptId,
  });

  const posting = postPendingAccountingEvents(c.env.DB, input.tenantId, 20).catch((error) => {
    console.error('Failed to post inventory goods receipt accounting event:', error);
  });
  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
    waitUntil(posting);
  } catch {
    void posting;
  }
  scheduleInventoryIntelligenceRecompute({
    dbClient: c.env.DB,
    tenantId: input.tenantId,
    waitUntil,
  });

  return warnings;
}

// GET /gr
gr.get('/', zValidator('query', schemas.listGoodsReceiptsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, VendorId, StoreId, PurchaseOrderId, PaymentStatus, FromDate, ToDate } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const conditions: string[] = ['G.tenant_id = ?'];
  const tenantId = c.get('tenantId');
  const params: unknown[] = [tenantId];

  if (VendorId) { conditions.push('G.VendorId = ?'); params.push(VendorId); }
  if (StoreId) { conditions.push('G.StoreId = ?'); params.push(StoreId); }
  if (PurchaseOrderId) { conditions.push('G.PurchaseOrderId = ?'); params.push(PurchaseOrderId); }
  if (PaymentStatus) { conditions.push('G.PaymentStatus = ?'); params.push(PaymentStatus); }
  if (FromDate) { conditions.push('G.GRDate >= ?'); params.push(FromDate); }
  if (ToDate) { conditions.push('G.GRDate <= ?'); params.push(ToDate); }

  const whereClause = conditions.join(' AND ');
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryGoodsReceipt G WHERE ${whereClause}`,
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT G.*, V.VendorName, P.PONumber
    FROM InventoryGoodsReceipt G
    JOIN InventoryVendor V ON G.VendorId = V.VendorId
    LEFT JOIN InventoryPurchaseOrder P ON G.PurchaseOrderId = P.PurchaseOrderId AND P.tenant_id = G.tenant_id
    WHERE ${whereClause}
    ORDER BY G.GoodsReceiptId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /gr
gr.post('/', zValidator('json', schemas.createGoodsReceiptSchema), async (c) => {
  const body = c.req.valid('json');
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) throw new HTTPException(401, { message: 'Authentication required' });

  const operationKey = resolveGoodsReceiptOperationKey(c, body);
  const hashBody = { ...body, IdempotencyKey: undefined };
  const requestHash = await createIdempotencyRequestHash({ tenantId, body: hashBody });
  const existing = await findGoodsReceiptReplay(c.env.DB, { tenantId, operationKey });

  if (existing) {
    if (existing.RequestHash !== requestHash) {
      throw new HTTPException(409, {
        message: 'This goods receipt idempotency key was already used with a different request.',
      });
    }

    if (existing.OperationStatus === 'core_completed') {
      const projectionLines = await loadGoodsReceiptProjectionLines(c.env.DB, {
        tenantId,
        goodsReceiptId: Number(existing.GoodsReceiptId),
      });
      const warnings = await finalizeGoodsReceiptProjections(c, {
        tenantId,
        userId,
        body,
        goodsReceiptId: Number(existing.GoodsReceiptId),
        grNumber: existing.GRNumber,
        totalAmount: Number(body.Items.reduce((sum, item) => sum + (item.ReceivedQuantity * item.ItemRate), 0)
          - body.DiscountAmount + body.FreightAmount + body.InsuranceAmount + body.OtherCharges
          + body.Items.reduce((sum, item) => sum + (item.ReceivedQuantity * item.ItemRate * item.VATPercent / 100), 0)),
        lines: projectionLines,
      });
      return c.json({
        message: 'Goods Receipt recovered',
        GoodsReceiptId: Number(existing.GoodsReceiptId),
        GRNo: existing.GRNumber,
        OperationKey: operationKey,
        replayed: true,
        projectionPending: warnings.length > 0,
        warnings,
      }, 200);
    }

    return c.json({
      message: 'Goods Receipt created',
      GoodsReceiptId: Number(existing.GoodsReceiptId),
      GRNo: existing.GRNumber,
      OperationKey: operationKey,
      replayed: true,
      projectionPending: false,
      warnings: [],
    }, 200);
  }

  const itemPolicies = await loadGoodsReceiptItemPolicies(c.env.DB, tenantId, body);
  const prepared = prepareGoodsReceipt(body, itemPolicies);
  const today = new Date().toISOString().slice(0, 10);
  const grNumber = await generateSequenceNo(c.env.DB, 'GRN', 'InventoryGoodsReceipt', 'GRNumber', tenantId);

  let core;
  try {
    core = await commitGoodsReceiptCore(c.env.DB, {
      tenantId,
      userId,
      operationKey,
      requestHash,
      grNumber,
      today,
      body,
      prepared,
    });
  } catch (error) {
    const concurrent = await findGoodsReceiptReplay(c.env.DB, { tenantId, operationKey });
    if (concurrent?.RequestHash === requestHash) {
      return c.json({
        message: 'Goods Receipt created',
        GoodsReceiptId: Number(concurrent.GoodsReceiptId),
        GRNo: concurrent.GRNumber,
        OperationKey: operationKey,
        replayed: true,
        projectionPending: concurrent.OperationStatus === 'core_completed',
        warnings: concurrent.OperationStatus === 'core_completed' ? ['Post-commit projections are pending; retry this request to repair them.'] : [],
      }, 200);
    }
    throw error;
  }

  const warnings = await finalizeGoodsReceiptProjections(c, {
    tenantId,
    userId,
    body,
    goodsReceiptId: core.goodsReceiptId,
    grNumber: core.grNumber,
    totalAmount: prepared.totalAmount,
    lines: toProjectionLines(core.lines),
  });

  return c.json({
    message: 'Goods Receipt created',
    GoodsReceiptId: core.goodsReceiptId,
    GRNo: core.grNumber,
    OperationKey: operationKey,
    replayed: false,
    projectionPending: warnings.length > 0,
    warnings,
  }, 201);
});

// PUT /gr/:id/verify
gr.put('/:id/verify', zValidator('json', schemas.verifyGoodsReceiptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const grId = c.req.param('id');
  const body = c.req.valid('json');
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) throw new HTTPException(401, { message: 'Authentication required' });
  const today = new Date().toISOString();

  const goodsReceipt = await db.$client.prepare(
    'SELECT * FROM InventoryGoodsReceipt WHERE GoodsReceiptId = ? AND tenant_id = ?',
  ).bind(grId, tenantId).first<Record<string, unknown>>();
  if (!goodsReceipt) return c.json({ error: 'Goods Receipt not found' }, 404);
  if (goodsReceipt.IsVerified === 1) return c.json({ error: 'Goods Receipt is already verified' }, 400);
  if (goodsReceipt.OperationStatus === 'core_completed') {
    return c.json({ error: 'Goods Receipt projections are pending. Retry the original receipt request before verification.' }, 409);
  }

  const existingRemarks = String(goodsReceipt.Remarks ?? '');
  const remarks = body.Remarks
    ? (existingRemarks ? `${existingRemarks}\n[VERIFIED] ${body.Remarks}` : `[VERIFIED] ${body.Remarks}`)
    : (existingRemarks ? `${existingRemarks}\n[VERIFIED]` : '[VERIFIED]');

  await db.$client.prepare(
    'UPDATE InventoryGoodsReceipt SET IsVerified = 1, VerifiedBy = ?, VerifiedOn = ?, Remarks = ?, ModifiedBy = ?, ModifiedOn = ? WHERE GoodsReceiptId = ? AND tenant_id = ?',
  ).bind(userId, today, remarks, userId, today, grId, tenantId).run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: 'UPDATE',
    eventType: 'goods_receipt_verification',
    tableName: 'InventoryGoodsReceipt',
    recordId: Number(grId),
    reason: body.Remarks ?? null,
    before: { GoodsReceiptId: Number(grId), IsVerified: Boolean(goodsReceipt.IsVerified) },
    after: { GoodsReceiptId: Number(grId), IsVerified: true, VerifiedBy: userId },
    whatChanged: {
      GoodsReceiptId: Number(grId),
      isVerifiedFrom: Boolean(goodsReceipt.IsVerified),
      isVerifiedTo: true,
      VerifiedBy: userId,
    },
  });

  return c.json({ message: 'Goods Receipt verified' });
});

export default gr;

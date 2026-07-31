import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";
import { generateSequenceNo } from "../../../utils/sequence";
import { normalizeInventoryMovementType } from "../../../lib/inventory-core";
import { createInventoryAuditLog, stockTransactionStatement } from "./helpers";
import { recordAccountingPostingEvent, ACCOUNTING_EVENT_TYPES, postPendingAccountingEvents } from "../../../lib/accounting-posting";

type Variables = { tenantId?: string; userId?: string; role?: string };

const adjustmentRequests = new Hono<{ Bindings: Env; Variables: Variables }>();

const adjustmentRequestItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive().optional(),
  BatchNo: z.string().max(120).optional(),
  NewQuantity: z.number().int().min(0),
  Remarks: z.string().max(500).optional(),
});

const createAdjustmentRequestSchema = z.object({
  StoreId: z.number().int().positive(),
  Reason: z.string().min(1).max(300),
  AttachmentKey: z.string().max(500).optional(),
  Remarks: z.string().max(1000).optional(),
  Items: z.array(adjustmentRequestItemSchema).min(1),
});

const decisionSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

const listAdjustmentRequestsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
  Status: z.string().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
});

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return nowIso().slice(0, 10);
}

async function findStock(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  storeId: number,
  item: { ItemId: number; StockId?: number; BatchNo?: string },
): Promise<any | null> {
  if (item.StockId) {
    const stock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
      .bind(tenantId, item.StockId)
      .first<any>();
    if (!stock) throw new HTTPException(400, { message: `Stock not found for item ${item.ItemId}` });
    if (Number(stock.ItemId) !== item.ItemId) throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to item ${item.ItemId}` });
    if (Number(stock.StoreId) !== storeId) throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to store ${storeId}` });
    return stock;
  }

  return db.$client.prepare(`
    SELECT *
    FROM InventoryStock
    WHERE tenant_id = ? AND StoreId = ? AND ItemId = ? AND COALESCE(BatchNo, '') = COALESCE(?, '')
    LIMIT 1
  `).bind(tenantId, storeId, item.ItemId, item.BatchNo || null).first<any>();
}

interface AdjustmentCostImpact {
  adjustmentIn: number;
  adjustmentOut: number;
}

async function postAdjustmentItem(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string;
    userId: string;
    request: any;
    item: any;
    remarks?: string | null;
  },
): Promise<AdjustmentCostImpact> {
  const zeroImpact: AdjustmentCostImpact = { adjustmentIn: 0, adjustmentOut: 0 };

  const currentStock = await findStock(db, input.tenantId, Number(input.request.StoreId), {
    ItemId: Number(input.item.ItemId),
    StockId: input.item.StockId ? Number(input.item.StockId) : undefined,
    BatchNo: input.item.BatchNo || undefined,
  });
  const currentQuantity = Number(currentStock?.AvailableQuantity ?? input.item.CurrentQuantity ?? 0);
  const newQuantity = Number(input.item.NewQuantity ?? 0);
  const difference = newQuantity - currentQuantity;
  if (difference === 0) return zeroImpact;

  const costPrice = Number(currentStock?.CostPrice) || 0;
  const costImpact = costPrice * Math.abs(difference);

  let stockId: number;
  if (currentStock) {
    stockId = Number(currentStock.StockId);
    const stockUpdate = await db.$client.prepare(`
      UPDATE InventoryStock SET AvailableQuantity = ?, ModifiedBy = ?, ModifiedOn = ?
      WHERE tenant_id = ? AND StockId = ? AND AvailableQuantity = ?
    `).bind(newQuantity, input.userId, nowIso(), input.tenantId, stockId, currentQuantity).run();
    const stockUpdateChanges = Number((stockUpdate.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (stockUpdateChanges !== 1) {
      throw new HTTPException(409, { message: `Stock changed while posting adjustment for item ${input.item.ItemId}. Please refresh and retry.` });
    }
  } else {
    if (newQuantity <= 0) return zeroImpact;
    const itemMaster = await db.$client.prepare(
      "SELECT StandardRate FROM InventoryItem WHERE ItemId = ? AND tenant_id = ?"
    ).bind(input.item.ItemId, input.tenantId).first<{ StandardRate: number }>();
    const newItemCostPrice = itemMaster?.StandardRate || 0;
    const newItemCostImpact = newItemCostPrice * newQuantity;

    const created = await db.$client.prepare(`
      INSERT INTO InventoryStock
        (tenant_id, ItemId, StoreId, BatchNo, AvailableQuantity, CostPrice, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.item.ItemId,
      input.request.StoreId,
      input.item.BatchNo || `ADJ-${input.request.AdjustmentRequestId}`,
      newQuantity,
      newItemCostPrice,
      input.userId,
      nowIso(),
    ).run();
    stockId = Number(created.meta.last_row_id);

    await stockTransactionStatement(db, {
      tenantId: input.tenantId,
      stockId,
      itemId: Number(input.item.ItemId),
      storeId: Number(input.request.StoreId),
      transactionType: normalizeInventoryMovementType("adjustment_plus"),
      referenceNo: input.request.AdjustmentNo,
      referenceId: Number(input.request.AdjustmentRequestId),
      inQuantity: newQuantity,
      outQuantity: 0,
      balanceQuantity: newQuantity,
      transactionDate: todayDate(),
      remarks: input.remarks || input.request.Reason || null,
      createdBy: input.userId,
    }).run();

    await db.$client.prepare(`
      INSERT INTO InventoryAuditLog
        (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
         ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
      VALUES (?, 'stock_adjustment_approved', 'InventoryAdjustmentRequest', ?, ?, ?, ?, ?, 'adjustment_request', ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.request.AdjustmentRequestId,
      input.item.ItemId,
      stockId,
      input.item.BatchNo || null,
      input.request.StoreId,
      input.request.AdjustmentRequestId,
      JSON.stringify({ AvailableQuantity: 0 }),
      JSON.stringify({ AvailableQuantity: newQuantity, difference: newQuantity }),
      input.userId,
      nowIso(),
    ).run();

    return { adjustmentIn: newItemCostImpact, adjustmentOut: 0 };
  }

  await stockTransactionStatement(db, {
    tenantId: input.tenantId,
    stockId,
    itemId: Number(input.item.ItemId),
    storeId: Number(input.request.StoreId),
    transactionType: normalizeInventoryMovementType(difference > 0 ? "adjustment_plus" : "adjustment_minus"),
    referenceNo: input.request.AdjustmentNo,
    referenceId: Number(input.request.AdjustmentRequestId),
    inQuantity: difference > 0 ? difference : 0,
    outQuantity: difference < 0 ? Math.abs(difference) : 0,
    balanceQuantity: newQuantity,
    transactionDate: todayDate(),
    remarks: input.remarks || input.request.Reason || null,
    createdBy: input.userId,
  }).run();

  await db.$client.prepare(`
    INSERT INTO InventoryAuditLog
      (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
       ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
    VALUES (?, 'stock_adjustment_approved', 'InventoryAdjustmentRequest', ?, ?, ?, ?, ?, 'adjustment_request', ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.request.AdjustmentRequestId,
    input.item.ItemId,
    stockId,
    input.item.BatchNo || currentStock?.BatchNo || null,
    input.request.StoreId,
    input.request.AdjustmentRequestId,
    JSON.stringify({ AvailableQuantity: currentQuantity }),
    JSON.stringify({ AvailableQuantity: newQuantity, difference }),
    input.userId,
    nowIso(),
  ).run();

  if (difference > 0) {
    return { adjustmentIn: costImpact, adjustmentOut: 0 };
  }
  return { adjustmentIn: 0, adjustmentOut: costImpact };
}

adjustmentRequests.get("/", zValidator("query", listAdjustmentRequestsSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const offset = (query.page - 1) * query.limit;
  const conditions = ["A.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (query.Status) { conditions.push("A.Status = ?"); params.push(query.Status); }
  if (query.StoreId) { conditions.push("A.StoreId = ?"); params.push(query.StoreId); }
  const where = conditions.join(" AND ");
  const count = await db.$client.prepare(`SELECT COUNT(*) AS total FROM InventoryAdjustmentRequest A WHERE ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT A.*, S.StoreName
    FROM InventoryAdjustmentRequest A
    LEFT JOIN InventoryStore S ON S.StoreId = A.StoreId AND S.tenant_id = A.tenant_id
    WHERE ${where}
    ORDER BY A.AdjustmentRequestId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();
  return c.json({ data: rows.results || [], pagination: { page: query.page, limit: query.limit, total: count?.total || 0 } });
});

adjustmentRequests.post("/", zValidator("json", createAdjustmentRequestSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const adjustmentNo = await generateSequenceNo(c.env.DB, "ADJ", "InventoryAdjustmentRequest", "AdjustmentNo", tenantId);

  const header = await db.$client.prepare(`
    INSERT INTO InventoryAdjustmentRequest
      (tenant_id, AdjustmentNo, StoreId, Status, Reason, AttachmentKey, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    adjustmentNo,
    body.StoreId,
    body.Reason,
    body.AttachmentKey || null,
    body.Remarks || null,
    userId,
    nowIso(),
  ).run();
  const requestId = Number(header.meta.last_row_id);

  for (const item of body.Items) {
    const stock = await findStock(db, tenantId, body.StoreId, item);
    const currentQuantity = Number(stock?.AvailableQuantity || 0);
    const difference = item.NewQuantity - currentQuantity;
    await db.$client.prepare(`
      INSERT INTO InventoryAdjustmentRequestItem
        (AdjustmentRequestId, ItemId, StockId, BatchNo, CurrentQuantity, NewQuantity, DifferenceQuantity, Remarks, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      requestId,
      item.ItemId,
      stock?.StockId || item.StockId || null,
      item.BatchNo || stock?.BatchNo || null,
      currentQuantity,
      item.NewQuantity,
      difference,
      item.Remarks || null,
      nowIso(),
    ).run();
  }

  await db.$client.prepare(`
    INSERT INTO InventoryAuditLog
      (tenant_id, Action, EntityType, EntityId, StoreId, ReferenceType, ReferenceId, NewValueJson, UserId, CreatedOn)
    VALUES (?, 'stock_adjustment_requested', 'InventoryAdjustmentRequest', ?, ?, 'adjustment_request', ?, ?, ?, ?)
  `).bind(
    tenantId,
    requestId,
    body.StoreId,
    requestId,
    JSON.stringify({ Reason: body.Reason, itemCount: body.Items.length }),
    userId,
    nowIso(),
  ).run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "CREATE",
    eventType: "inventory_adjustment_request",
    tableName: "InventoryAdjustmentRequest",
    recordId: requestId,
    reason: body.Reason,
    before: null,
    after: {
      AdjustmentRequestId: requestId,
      AdjustmentNo: adjustmentNo,
      StoreId: body.StoreId,
      Status: "submitted",
      Reason: body.Reason,
      itemCount: body.Items.length,
    },
    whatChanged: {
      AdjustmentRequestId: requestId,
      AdjustmentNo: adjustmentNo,
      StoreId: body.StoreId,
      Status: "submitted",
      itemCount: body.Items.length,
    },
  });

  return c.json({ message: "Adjustment request submitted", AdjustmentRequestId: requestId, AdjustmentNo: adjustmentNo }, 201);
});

adjustmentRequests.post("/:id/approve", zValidator("json", decisionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const requestId = Number(c.req.param("id"));
  const request = await db.$client.prepare("SELECT * FROM InventoryAdjustmentRequest WHERE tenant_id = ? AND AdjustmentRequestId = ?")
    .bind(tenantId, requestId)
    .first<any>();
  if (!request) throw new HTTPException(404, { message: "Adjustment request not found" });
  if (!["submitted", "approved"].includes(String(request.Status))) {
    throw new HTTPException(400, { message: "Only submitted adjustment requests can be approved" });
  }

  const today = todayDate();
  let totalAdjustmentInValue = 0;
  let totalAdjustmentOutValue = 0;

  const items = await db.$client.prepare("SELECT * FROM InventoryAdjustmentRequestItem WHERE AdjustmentRequestId = ?")
    .bind(requestId)
    .all<any>();
  for (const item of items.results || []) {
    const impact = await postAdjustmentItem(db, { tenantId, userId, request, item, remarks: body.Remarks || null });
    totalAdjustmentInValue += impact.adjustmentIn;
    totalAdjustmentOutValue += impact.adjustmentOut;
  }

  if (totalAdjustmentOutValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_adjustment_request',
      sourceId: `adjreq-out-${requestId}`,
      eventType: ACCOUNTING_EVENT_TYPES.inventoryConsumption,
      eventDate: today,
      payload: { totalCost: totalAdjustmentOutValue },
      createdBy: userId,
    });
  }

  if (totalAdjustmentInValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_adjustment_request',
      sourceId: `adjreq-in-${requestId}`,
      eventType: ACCOUNTING_EVENT_TYPES.inventoryPurchase,
      eventDate: today,
      payload: { totalAmount: totalAdjustmentInValue, isCredit: false },
      createdBy: userId,
    });
  }

  if (totalAdjustmentOutValue > 0 || totalAdjustmentInValue > 0) {
    const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
      console.error('Failed to post adjustment request accounting event:', error);
    });
    try {
      c.executionCtx.waitUntil(posting);
    } catch {
      void posting;
    }
  }

  await db.$client.prepare("UPDATE InventoryAdjustmentRequest SET Status = 'posted', ApprovedBy = ?, ApprovedOn = ? WHERE tenant_id = ? AND AdjustmentRequestId = ?")
    .bind(userId, nowIso(), tenantId, requestId)
    .run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "APPROVE",
    eventType: "adjustment_approval",
    tableName: "InventoryAdjustmentRequest",
    recordId: requestId,
    reason: body.Remarks || request.Reason || null,
    before: {
      AdjustmentRequestId: requestId,
      Status: request.Status,
    },
    after: {
      AdjustmentRequestId: requestId,
      Status: "posted",
      ApprovedBy: userId,
      totalAdjustmentInValue,
      totalAdjustmentOutValue,
    },
    whatChanged: {
      AdjustmentRequestId: requestId,
      statusFrom: request.Status,
      statusTo: "posted",
      approved: true,
      totalAdjustmentInValue,
      totalAdjustmentOutValue,
    },
  });

  return c.json({ message: "Adjustment request approved and posted", AdjustmentRequestId: requestId, Status: "posted" });
});

adjustmentRequests.post("/:id/reject", zValidator("json", decisionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const requestId = Number(c.req.param("id"));
  const request = await db.$client.prepare("SELECT * FROM InventoryAdjustmentRequest WHERE tenant_id = ? AND AdjustmentRequestId = ?")
    .bind(tenantId, requestId)
    .first<any>();
  if (!request) throw new HTTPException(404, { message: "Adjustment request not found" });
  if (String(request.Status) !== "submitted") {
    throw new HTTPException(400, { message: "Only submitted adjustment requests can be rejected" });
  }

  await db.$client.prepare("UPDATE InventoryAdjustmentRequest SET Status = 'rejected', ApprovedBy = ?, ApprovedOn = ?, Remarks = COALESCE(Remarks, '') || ? WHERE tenant_id = ? AND AdjustmentRequestId = ?")
    .bind(userId, nowIso(), `\nRejected: ${body.Remarks || ""}`, tenantId, requestId)
    .run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "REJECT",
    eventType: "adjustment_rejection",
    tableName: "InventoryAdjustmentRequest",
    recordId: requestId,
    reason: body.Remarks || null,
    before: {
      AdjustmentRequestId: requestId,
      Status: request.Status,
    },
    after: {
      AdjustmentRequestId: requestId,
      Status: "rejected",
      ApprovedBy: userId,
    },
    whatChanged: {
      AdjustmentRequestId: requestId,
      statusFrom: request.Status,
      statusTo: "rejected",
      rejected: true,
    },
  });

  return c.json({ message: "Adjustment request rejected", AdjustmentRequestId: requestId, Status: "rejected" });
});

export default adjustmentRequests;

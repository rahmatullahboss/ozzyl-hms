import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";
import { generateSequenceNo } from "../../../utils/sequence";
import { normalizeInventoryMovementType } from "../../../lib/inventory-core";
import { stockTransactionStatement } from "./helpers";
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from "../../../lib/accounting-posting";

type Variables = { tenantId?: string; userId?: string; role?: string };

const countSessions = new Hono<{ Bindings: Env; Variables: Variables }>();

const createCountSessionSchema = z.object({
  StoreId: z.number().int().positive(),
  CategoryId: z.number().int().positive().optional(),
  CountDate: z.string().optional(),
  AssignedTo: z.number().int().positive().optional(),
  Remarks: z.string().max(1000).optional(),
});

const countItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive(),
  BatchNo: z.string().max(120).optional(),
  CountedQuantity: z.number().int().min(0),
  Remarks: z.string().max(500).optional(),
});

const addCountItemsSchema = z.object({
  Items: z.array(countItemSchema).min(1),
});

const decisionSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

const listCountSessionsSchema = z.object({
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

async function getSession(db: ReturnType<typeof getDb>, tenantId: string, sessionId: number): Promise<any> {
  return db.$client.prepare("SELECT * FROM InventoryStockCountSession WHERE tenant_id = ? AND CountSessionId = ?")
    .bind(tenantId, sessionId)
    .first<any>();
}

async function postCountVariance(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string;
    userId: string;
    session: any;
    item: any;
    remarks?: string | null;
  },
): Promise<number> {
  const stock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
    .bind(input.tenantId, input.item.StockId)
    .first<any>();
  if (!stock) throw new HTTPException(400, { message: `Stock not found for count item ${input.item.CountItemId}` });

  const currentQuantity = Number(stock.AvailableQuantity || 0);
  const systemQuantity = Number(input.item.SystemQuantity ?? currentQuantity);
  if (currentQuantity !== systemQuantity) {
    throw new HTTPException(409, { message: `Stock changed after count entry for item ${input.item.ItemId}. Please recount before approval.` });
  }
  const countedQuantity = Number(input.item.CountedQuantity || 0);
  const difference = countedQuantity - systemQuantity;
  if (difference === 0) return 0;

  const costPrice = Number(stock.CostPrice || 0);
  const costImpact = difference * costPrice;

  const stockUpdate = await db.$client.prepare("UPDATE InventoryStock SET AvailableQuantity = ?, ModifiedBy = ?, ModifiedOn = ? WHERE tenant_id = ? AND StockId = ? AND AvailableQuantity = ?")
    .bind(countedQuantity, input.userId, nowIso(), input.tenantId, stock.StockId, systemQuantity)
    .run();
  const stockUpdateChanges = Number((stockUpdate.meta as { changes?: number } | undefined)?.changes ?? 0);
  if (stockUpdateChanges !== 1) {
    throw new HTTPException(409, { message: `Stock changed while approving count item ${input.item.ItemId}. Please recount before approval.` });
  }

  await stockTransactionStatement(db, {
    tenantId: input.tenantId,
    stockId: Number(stock.StockId),
    itemId: Number(input.item.ItemId),
    storeId: Number(input.session.StoreId || stock.StoreId),
    transactionType: normalizeInventoryMovementType(difference > 0 ? "adjustment_plus" : "adjustment_minus"),
    referenceNo: input.session.CountNo,
    referenceId: Number(input.session.CountSessionId),
    inQuantity: difference > 0 ? difference : 0,
    outQuantity: difference < 0 ? Math.abs(difference) : 0,
    balanceQuantity: countedQuantity,
    transactionDate: todayDate(),
    remarks: input.remarks || input.item.Remarks || input.session.Remarks || "Stock count variance",
    createdBy: input.userId,
  }).run();

  await db.$client.prepare(`
    INSERT INTO InventoryAuditLog
      (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
       ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
    VALUES (?, 'stock_count_approved', 'InventoryStockCountSession', ?, ?, ?, ?, ?, 'stock_count', ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.session.CountSessionId,
    input.item.ItemId,
    stock.StockId,
    input.item.BatchNo || stock.BatchNo || null,
    input.session.StoreId || stock.StoreId,
    input.session.CountSessionId,
    JSON.stringify({ AvailableQuantity: currentQuantity }),
    JSON.stringify({ AvailableQuantity: countedQuantity, difference }),
    input.userId,
    nowIso(),
  ).run();

  return costImpact;
}

countSessions.get("/", zValidator("query", listCountSessionsSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const offset = (query.page - 1) * query.limit;
  const conditions = ["C.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (query.Status) { conditions.push("C.Status = ?"); params.push(query.Status); }
  if (query.StoreId) { conditions.push("C.StoreId = ?"); params.push(query.StoreId); }
  const where = conditions.join(" AND ");
  const count = await db.$client.prepare(`SELECT COUNT(*) AS total FROM InventoryStockCountSession C WHERE ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT C.*, S.StoreName
    FROM InventoryStockCountSession C
    LEFT JOIN InventoryStore S ON S.StoreId = C.StoreId AND S.tenant_id = C.tenant_id
    WHERE ${where}
    ORDER BY C.CountSessionId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();
  return c.json({ data: rows.results || [], pagination: { page: query.page, limit: query.limit, total: count?.total || 0 } });
});

countSessions.post("/", zValidator("json", createCountSessionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const countNo = await generateSequenceNo(c.env.DB, "CNT", "InventoryStockCountSession", "CountNo", tenantId);
  const header = await db.$client.prepare(`
    INSERT INTO InventoryStockCountSession
      (tenant_id, CountNo, StoreId, CategoryId, CountDate, AssignedTo, Status, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).bind(
    tenantId,
    countNo,
    body.StoreId,
    body.CategoryId || null,
    body.CountDate || todayDate(),
    body.AssignedTo || null,
    body.Remarks || null,
    userId,
    nowIso(),
  ).run();
  return c.json({ message: "Stock count session created", CountSessionId: Number(header.meta.last_row_id), CountNo: countNo }, 201);
});

countSessions.post("/:id/items", zValidator("json", addCountItemsSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const sessionId = Number(c.req.param("id"));
  const body = c.req.valid("json");
  const session = await getSession(db, tenantId, sessionId);
  if (!session) throw new HTTPException(404, { message: "Stock count session not found" });
  if (!["draft", "in_progress"].includes(String(session.Status))) {
    throw new HTTPException(400, { message: "Only draft or in-progress counts can be updated" });
  }

  for (const item of body.Items) {
    const stock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
      .bind(tenantId, item.StockId)
      .first<any>();
    if (!stock) throw new HTTPException(400, { message: `Stock not found for item ${item.ItemId}` });
    if (Number(stock.ItemId) !== item.ItemId || Number(stock.StoreId) !== Number(session.StoreId)) {
      throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to this count session` });
    }
    const systemQuantity = Number(stock.AvailableQuantity || 0);
    const difference = item.CountedQuantity - systemQuantity;
    await db.$client.prepare(`
      INSERT INTO InventoryStockCountItem
        (CountSessionId, ItemId, StockId, BatchNo, SystemQuantity, CountedQuantity,
         DifferenceQuantity, Remarks, CountedBy, CountedOn, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId,
      item.ItemId,
      item.StockId,
      item.BatchNo || stock.BatchNo || null,
      systemQuantity,
      item.CountedQuantity,
      difference,
      item.Remarks || null,
      userId,
      nowIso(),
      nowIso(),
    ).run();
  }

  await db.$client.prepare("UPDATE InventoryStockCountSession SET Status = 'in_progress' WHERE tenant_id = ? AND CountSessionId = ? AND Status = 'draft'")
    .bind(tenantId, sessionId)
    .run();

  return c.json({ message: "Stock count items saved", CountSessionId: sessionId });
});

countSessions.post("/:id/submit", zValidator("json", decisionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const sessionId = Number(c.req.param("id"));
  await db.$client.prepare("UPDATE InventoryStockCountSession SET Status = 'submitted', Remarks = COALESCE(Remarks, '') || ? WHERE tenant_id = ? AND CountSessionId = ?")
    .bind(c.req.valid("json").Remarks ? `\n${c.req.valid("json").Remarks}` : "", tenantId, sessionId)
    .run();
  return c.json({ message: "Stock count submitted", CountSessionId: sessionId, Status: "submitted" });
});

countSessions.post("/:id/approve", zValidator("json", decisionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const sessionId = Number(c.req.param("id"));
  const body = c.req.valid("json");
  const session = await getSession(db, tenantId, sessionId);
  if (!session) throw new HTTPException(404, { message: "Stock count session not found" });
  if (!["submitted", "in_progress"].includes(String(session.Status))) {
    throw new HTTPException(400, { message: "Only submitted stock counts can be approved" });
  }

  const items = await db.$client.prepare("SELECT * FROM InventoryStockCountItem WHERE CountSessionId = ?")
    .bind(sessionId)
    .all<any>();
  let netVarianceValue = 0;
  for (const item of items.results || []) {
    netVarianceValue += await postCountVariance(db, { tenantId, userId, session, item, remarks: body.Remarks || null });
  }

  await db.$client.prepare("UPDATE InventoryStockCountSession SET Status = 'approved', ApprovedBy = ?, ApprovedOn = ? WHERE tenant_id = ? AND CountSessionId = ?")
    .bind(userId, nowIso(), tenantId, sessionId)
    .run();

  if (netVarianceValue !== 0) {
    const isGain = netVarianceValue > 0;
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_count',
      sourceId: String(sessionId),
      eventType: isGain ? ACCOUNTING_EVENT_TYPES.inventoryPurchase : ACCOUNTING_EVENT_TYPES.inventoryConsumption,
      eventDate: todayDate(),
      payload: isGain
        ? { totalAmount: Math.abs(netVarianceValue), isCredit: false }
        : { totalCost: Math.abs(netVarianceValue) },
      createdBy: userId,
    });

    const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
      console.error('Failed to post inventory count variance accounting event:', error);
    });
    try {
      c.executionCtx.waitUntil(posting);
    } catch {
      void posting;
    }
  }

  return c.json({ message: "Stock count approved", CountSessionId: sessionId, Status: "approved" });
});

countSessions.post("/:id/reject", zValidator("json", decisionSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const sessionId = Number(c.req.param("id"));
  const body = c.req.valid("json");
  const session = await getSession(db, tenantId, sessionId);
  if (!session) throw new HTTPException(404, { message: "Stock count session not found" });
  if (!["submitted", "in_progress"].includes(String(session.Status))) {
    throw new HTTPException(400, { message: "Only submitted stock counts can be rejected" });
  }

  const rejectionRemarks = body.Remarks
    ? (session.Remarks ? `${session.Remarks}\n[REJECTED] ${body.Remarks}` : `[REJECTED] ${body.Remarks}`)
    : (session.Remarks ? `${session.Remarks}\n[REJECTED]` : `[REJECTED]`);

  await db.$client.prepare(
    "UPDATE InventoryStockCountSession SET Status = 'rejected', Remarks = ?, ApprovedBy = ?, ApprovedOn = ? WHERE tenant_id = ? AND CountSessionId = ?"
  ).bind(rejectionRemarks, userId, nowIso(), tenantId, sessionId).run();

  return c.json({ message: "Stock count rejected", CountSessionId: sessionId, Status: "rejected" });
});

export default countSessions;

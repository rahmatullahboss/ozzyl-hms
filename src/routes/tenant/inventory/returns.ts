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

const returns = new Hono<{ Bindings: Env; Variables: Variables }>();

const returnItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive().optional(),
  BatchNo: z.string().max(120).optional(),
  Quantity: z.number().int().positive(),
  ConsumptionItemId: z.number().int().positive().optional(),
  Remarks: z.string().max(500).optional(),
});

const createReturnSchema = z.object({
  ReturnType: z.enum(["department_return", "patient_return"]).optional(),
  FromDepartment: z.string().max(120).optional(),
  PatientId: z.number().int().positive().optional(),
  ToStoreId: z.number().int().positive(),
  Reason: z.enum(["unused", "wrong_item", "damaged", "expired", "over_issued", "patient_refused", "other"]),
  AdjustPatientBill: z.boolean().default(false),
  Remarks: z.string().max(1000).optional(),
  Items: z.array(returnItemSchema).min(1),
});

const listReturnsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
  ReturnType: z.string().optional(),
  PatientId: z.coerce.number().int().positive().optional(),
  ToStoreId: z.coerce.number().int().positive().optional(),
});

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return nowIso().slice(0, 10);
}

function shouldReturnToUsableStock(reason: string): boolean {
  return !["damaged", "expired"].includes(reason);
}

async function resolveReturnStock(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  toStoreId: number,
  item: z.infer<typeof returnItemSchema>,
): Promise<any | null> {
  if (item.StockId) {
    const stock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
      .bind(tenantId, item.StockId)
      .first<any>();
    if (!stock) throw new HTTPException(400, { message: `Stock not found for item ${item.ItemId}` });
    if (Number(stock.ItemId) !== item.ItemId) throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to item ${item.ItemId}` });
    if (Number(stock.StoreId) !== toStoreId) throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to store ${toStoreId}` });
    return stock;
  }

  return db.$client.prepare(`
    SELECT *
    FROM InventoryStock
    WHERE tenant_id = ? AND ItemId = ? AND StoreId = ? AND COALESCE(BatchNo, '') = COALESCE(?, '')
    LIMIT 1
  `).bind(tenantId, item.ItemId, toStoreId, item.BatchNo || null).first<any>();
}

async function adjustPatientBillIfSafe(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string;
    patientId?: number;
    consumptionItemId?: number;
    returnId: number;
    userId: string;
  },
): Promise<"not_applicable" | "adjusted_provisional" | "requires_billing_review"> {
  if (!input.patientId || !input.consumptionItemId) return "requires_billing_review";

  const consumptionLine = await db.$client.prepare(`
    SELECT CI.*, C.PatientId
    FROM InventoryConsumptionItem CI
    JOIN InventoryConsumption C ON C.ConsumptionId = CI.ConsumptionId
    WHERE CI.ConsumptionItemId = ?
  `).bind(input.consumptionItemId).first<any>();
  if (!consumptionLine || Number(consumptionLine.PatientId) !== input.patientId || !consumptionLine.BillingReferenceId) {
    return "requires_billing_review";
  }

  const billLine = await db.$client.prepare(`
    SELECT id, bill_status, is_active
    FROM billing_provisional_items
    WHERE tenant_id = ? AND id = ?
  `).bind(input.tenantId, consumptionLine.BillingReferenceId).first<any>();

  if (!billLine || billLine.bill_status !== "provisional") {
    return "requires_billing_review";
  }

  await db.$client.prepare(`
    UPDATE billing_provisional_items
    SET is_active = 0,
        bill_status = 'cancelled',
        cancel_reason = COALESCE(cancel_reason, '') || ?
    WHERE tenant_id = ? AND id = ? AND bill_status = 'provisional'
  `).bind(
    `\nCancelled by inventory return ${input.returnId}`,
    input.tenantId,
    consumptionLine.BillingReferenceId,
  ).run();

  return "adjusted_provisional";
}

async function createOperationalReturn(
  c: any,
  routeReturnType: "department_return" | "patient_return",
) {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json") as z.infer<typeof createReturnSchema>;
  const returnType = body.ReturnType || routeReturnType;
  if (returnType === "patient_return" && !body.PatientId) {
    throw new HTTPException(400, { message: "PatientId is required for patient return" });
  }

  const returnNo = await generateSequenceNo(c.env.DB, "DRET", "InventoryDepartmentReturn", "ReturnNo", tenantId);
  const header = await db.$client.prepare(`
    INSERT INTO InventoryDepartmentReturn
      (tenant_id, ReturnNo, ReturnDate, ReturnType, FromDepartment, PatientId, ToStoreId,
       Reason, BillingAdjustmentStatus, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_applicable', ?, ?, ?)
  `).bind(
    tenantId,
    returnNo,
    todayDate(),
    returnType,
    body.FromDepartment || null,
    body.PatientId || null,
    body.ToStoreId,
    body.Reason,
    body.Remarks || null,
    userId,
    nowIso(),
  ).run();
  const returnId = Number(header.meta.last_row_id);
  let billingStatus: "not_applicable" | "adjusted_provisional" | "requires_billing_review" = "not_applicable";
  let totalReturnValue = 0;

  for (const item of body.Items) {
    const usableReturn = shouldReturnToUsableStock(body.Reason);
    let stock = await resolveReturnStock(db, tenantId, body.ToStoreId, item);
    let stockId: number;
    let balanceAfter: number;

    if (!stock) {
      const created = await db.$client.prepare(`
        INSERT INTO InventoryStock
          (tenant_id, ItemId, StoreId, BatchNo, AvailableQuantity, DamagedQuantity, BlockedQuantity,
           StockStatus, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        item.ItemId,
        body.ToStoreId,
        item.BatchNo || `RET-${returnId}`,
        usableReturn ? item.Quantity : 0,
        usableReturn ? 0 : item.Quantity,
        usableReturn ? 0 : item.Quantity,
        usableReturn ? "available" : body.Reason,
        userId,
        nowIso(),
      ).run();
      stockId = Number(created.meta.last_row_id);
      balanceAfter = usableReturn ? item.Quantity : 0;
      stock = { StockId: stockId, AvailableQuantity: 0, BatchNo: item.BatchNo || null, CostPrice: 0 };
    } else {
      stockId = Number(stock.StockId);
      balanceAfter = Number(stock.AvailableQuantity || 0) + (usableReturn ? item.Quantity : 0);
      if (usableReturn) {
        await db.$client.prepare(`
          UPDATE InventoryStock
          SET AvailableQuantity = AvailableQuantity + ?,
              StockStatus = COALESCE(NULLIF(StockStatus, ''), 'available'),
              ModifiedBy = ?, ModifiedOn = ?
          WHERE tenant_id = ? AND StockId = ?
        `).bind(item.Quantity, userId, nowIso(), tenantId, stockId).run();
      } else {
        await db.$client.prepare(`
          UPDATE InventoryStock
          SET DamagedQuantity = COALESCE(DamagedQuantity, 0) + ?,
              BlockedQuantity = COALESCE(BlockedQuantity, 0) + ?,
              StockStatus = ?,
              ModifiedBy = ?, ModifiedOn = ?
          WHERE tenant_id = ? AND StockId = ?
        `).bind(item.Quantity, item.Quantity, body.Reason, userId, nowIso(), tenantId, stockId).run();
      }
    }

    totalReturnValue += (Number(stock.CostPrice || 0)) * item.Quantity;

    if (returnType === "patient_return" && body.AdjustPatientBill) {
      const lineStatus = await adjustPatientBillIfSafe(db, {
        tenantId,
        patientId: body.PatientId,
        consumptionItemId: item.ConsumptionItemId,
        returnId,
        userId,
      });
      if (lineStatus === "requires_billing_review") billingStatus = lineStatus;
      if (lineStatus === "adjusted_provisional" && billingStatus !== "requires_billing_review") billingStatus = lineStatus;
    }

    await db.$client.prepare(`
      INSERT INTO InventoryDepartmentReturnItem
        (ReturnId, ItemId, StockId, BatchNo, Quantity, IsBillAdjusted, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      returnId,
      item.ItemId,
      stockId,
      item.BatchNo || stock.BatchNo || null,
      item.Quantity,
      billingStatus === "adjusted_provisional" ? 1 : 0,
      item.Remarks || null,
      userId,
      nowIso(),
    ).run();

    await stockTransactionStatement(db, {
      tenantId,
      stockId,
      itemId: item.ItemId,
      storeId: body.ToStoreId,
      transactionType: normalizeInventoryMovementType("return_in"),
      referenceNo: returnNo,
      referenceId: returnId,
      inQuantity: item.Quantity,
      balanceQuantity: balanceAfter,
      transactionDate: nowIso(),
      remarks: item.Remarks || body.Remarks || body.Reason,
      createdBy: userId,
    }).run();

    await db.$client.prepare(`
      INSERT INTO InventoryAuditLog
        (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
         ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
      VALUES (?, 'stock_return', 'InventoryDepartmentReturn', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      returnId,
      item.ItemId,
      stockId,
      item.BatchNo || stock.BatchNo || null,
      body.ToStoreId,
      returnType,
      returnId,
      JSON.stringify({ AvailableQuantity: Number(stock.AvailableQuantity || 0) }),
      JSON.stringify({ AvailableQuantity: balanceAfter, returnedQuantity: item.Quantity, reason: body.Reason }),
      userId,
      nowIso(),
    ).run();
  }

  await db.$client.prepare("UPDATE InventoryDepartmentReturn SET BillingAdjustmentStatus = ? WHERE tenant_id = ? AND ReturnId = ?")
    .bind(billingStatus, tenantId, returnId)
    .run();

  if (totalReturnValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_operational_return',
      sourceId: String(returnId),
      eventType: ACCOUNTING_EVENT_TYPES.inventoryPurchase,
      eventDate: todayDate(),
      payload: {
        totalAmount: totalReturnValue,
        reason: body.Reason || 'Operational return',
      },
      createdBy: userId,
    });

    const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
      console.error('Failed to post operational return accounting event:', error);
    });
    try {
      c.executionCtx.waitUntil(posting);
    } catch {
      void posting;
    }
  }

  return c.json({
    message: "Inventory return recorded",
    ReturnId: returnId,
    ReturnNo: returnNo,
    BillingAdjustmentStatus: billingStatus,
  }, 201);
}

returns.get("/", zValidator("query", listReturnsSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const offset = (query.page - 1) * query.limit;
  const conditions = ["R.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (query.ReturnType) { conditions.push("R.ReturnType = ?"); params.push(query.ReturnType); }
  if (query.PatientId) { conditions.push("R.PatientId = ?"); params.push(query.PatientId); }
  if (query.ToStoreId) { conditions.push("R.ToStoreId = ?"); params.push(query.ToStoreId); }
  const where = conditions.join(" AND ");
  const count = await db.$client.prepare(`SELECT COUNT(*) AS total FROM InventoryDepartmentReturn R WHERE ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT R.*, S.StoreName AS ToStoreName
    FROM InventoryDepartmentReturn R
    LEFT JOIN InventoryStore S ON S.StoreId = R.ToStoreId AND S.tenant_id = R.tenant_id
    WHERE ${where}
    ORDER BY R.ReturnId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();
  return c.json({ data: rows.results || [], pagination: { page: query.page, limit: query.limit, total: count?.total || 0 } });
});

returns.post("/department", zValidator("json", createReturnSchema), (c) => createOperationalReturn(c, "department_return"));
returns.post("/patient", zValidator("json", createReturnSchema), (c) => createOperationalReturn(c, "patient_return"));

export default returns;

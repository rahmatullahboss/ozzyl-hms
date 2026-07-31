import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";
import { generateSequenceNo } from "../../../utils/sequence";
import { getStockIssueBlockReason, normalizeInventoryMovementType, selectFefoStockAllocations } from "../../../lib/inventory-core";
import { createInventoryAuditLog, stockTransactionStatement } from "./helpers";

type Variables = { tenantId?: string; userId?: string; role?: string };

const transfers = new Hono<{ Bindings: Env; Variables: Variables }>();

const transferItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive().optional(),
  BatchNo: z.string().optional(),
  Quantity: z.number().int().positive(),
  Remarks: z.string().optional(),
});

const createTransferSchema = z.object({
  FromStoreId: z.number().int().positive(),
  ToStoreId: z.number().int().positive(),
  TransferDate: z.string().optional(),
  Remarks: z.string().optional(),
  Items: z.array(transferItemSchema).min(1),
});

const receiveTransferSchema = z.object({
  Items: z.array(z.object({
    TransferItemId: z.number().int().positive(),
    ReceivedQuantity: z.number().int().min(0),
  })).optional(),
  Remarks: z.string().optional(),
});

const listTransferSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
  Status: z.string().optional(),
  FromStoreId: z.coerce.number().int().positive().optional(),
  ToStoreId: z.coerce.number().int().positive().optional(),
});

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return nowIso().slice(0, 10);
}

async function getTransfer(db: ReturnType<typeof getDb>, tenantId: string, transferId: number): Promise<any> {
  return db.$client.prepare("SELECT * FROM InventoryTransfer WHERE tenant_id = ? AND TransferId = ?")
    .bind(tenantId, transferId)
    .first<any>();
}

transfers.get("/", zValidator("query", listTransferSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const offset = (query.page - 1) * query.limit;
  const conditions = ["T.tenant_id = ?"];
  const params: unknown[] = [tenantId];

  if (query.Status) { conditions.push("T.Status = ?"); params.push(query.Status); }
  if (query.FromStoreId) { conditions.push("T.FromStoreId = ?"); params.push(query.FromStoreId); }
  if (query.ToStoreId) { conditions.push("T.ToStoreId = ?"); params.push(query.ToStoreId); }

  const where = conditions.join(" AND ");
  const count = await db.$client.prepare(`SELECT COUNT(*) AS total FROM InventoryTransfer T WHERE ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT T.*, FS.StoreName AS FromStoreName, TS.StoreName AS ToStoreName
    FROM InventoryTransfer T
    LEFT JOIN InventoryStore FS ON FS.StoreId = T.FromStoreId AND FS.tenant_id = T.tenant_id
    LEFT JOIN InventoryStore TS ON TS.StoreId = T.ToStoreId AND TS.tenant_id = T.tenant_id
    WHERE ${where}
    ORDER BY T.TransferId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();

  return c.json({ data: rows.results || [], pagination: { page: query.page, limit: query.limit, total: count?.total || 0 } });
});

transfers.post("/", zValidator("json", createTransferSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  if (body.FromStoreId === body.ToStoreId) {
    throw new HTTPException(400, { message: "Source and destination stores must be different" });
  }

  const transferNo = await generateSequenceNo(c.env.DB, "TRF", "InventoryTransfer", "TransferNo", tenantId);
  const header = await db.$client.prepare(`
    INSERT INTO InventoryTransfer
      (tenant_id, TransferNo, TransferDate, FromStoreId, ToStoreId, Status, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).bind(
    tenantId,
    transferNo,
    body.TransferDate || todayDate(),
    body.FromStoreId,
    body.ToStoreId,
    body.Remarks || null,
    userId,
    nowIso(),
  ).run();
  const transferId = Number(header.meta.last_row_id);

  for (const item of body.Items) {
    if (item.StockId) {
      // Explicit StockId — use specific batch
      const stock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
        .bind(tenantId, item.StockId)
        .first<any>();
      if (!stock) throw new HTTPException(400, { message: `Stock not found for item ${item.ItemId}` });
      if (Number(stock.ItemId) !== item.ItemId || Number(stock.StoreId) !== body.FromStoreId) {
        throw new HTTPException(400, { message: `Stock ${item.StockId} does not match source store/item` });
      }
      const reason = getStockIssueBlockReason(stock, item.Quantity);
      if (reason) throw new HTTPException(400, { message: `${reason} for item ${item.ItemId}` });

      await db.$client.prepare(`
        INSERT INTO InventoryTransferItem
          (TransferId, ItemId, StockId, BatchNo, ExpiryDate, Quantity, CostPrice, Remarks, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        transferId, item.ItemId, item.StockId, item.BatchNo || stock.BatchNo || null,
        stock.ExpiryDate || null, item.Quantity, Number(stock.CostPrice || 0),
        item.Remarks || null, userId, nowIso(),
      ).run();
    } else {
      // No StockId — use FEFO multi-batch allocation
      const rows = await db.$client.prepare(`
        SELECT StockId, ItemId, StoreId, AvailableQuantity, BatchNo, ExpiryDate, CostPrice, MRP, IsActive
        FROM InventoryStock
        WHERE tenant_id = ? AND ItemId = ? AND StoreId = ?
          AND COALESCE(IsActive, 1) = 1
          AND AvailableQuantity > 0
        ORDER BY CASE WHEN ExpiryDate IS NULL OR ExpiryDate = '' THEN 1 ELSE 0 END, ExpiryDate ASC, StockId ASC
      `).bind(tenantId, item.ItemId, body.FromStoreId).all();

      let allocations;
      try {
        allocations = selectFefoStockAllocations(rows.results || [], item.Quantity);
      } catch (err: any) {
        throw new HTTPException(400, { message: `Insufficient stock for item ${item.ItemId}: ${err.message}` });
      }

      for (const allocation of allocations) {
        const stock = (rows.results || []).find((r: any) => Number(r.StockId) === allocation.stockId) as any;
        if (!stock) continue;

        await db.$client.prepare(`
          INSERT INTO InventoryTransferItem
            (TransferId, ItemId, StockId, BatchNo, ExpiryDate, Quantity, CostPrice, Remarks, CreatedBy, CreatedOn)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          transferId, item.ItemId, allocation.stockId, stock.BatchNo || null,
          stock.ExpiryDate || null, allocation.quantity, Number(stock.CostPrice || 0),
          item.Remarks || null, userId, nowIso(),
        ).run();
      }
    }
  }

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "CREATE",
    eventType: "stock_transfer",
    tableName: "InventoryTransfer",
    recordId: transferId,
    reason: body.Remarks || null,
    before: null,
    after: {
      TransferId: transferId,
      TransferNo: transferNo,
      FromStoreId: body.FromStoreId,
      ToStoreId: body.ToStoreId,
      Status: "draft",
      itemCount: body.Items.length,
    },
    whatChanged: {
      TransferId: transferId,
      TransferNo: transferNo,
      FromStoreId: body.FromStoreId,
      ToStoreId: body.ToStoreId,
      Status: "draft",
      itemCount: body.Items.length,
    },
  });

  return c.json({ message: "Transfer draft created", TransferId: transferId, TransferNo: transferNo }, 201);
});

transfers.post("/:id/send", async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const transferId = Number(c.req.param("id"));
  const db = getDb(c.env.DB);
  const transfer = await getTransfer(db, tenantId, transferId);
  if (!transfer) throw new HTTPException(404, { message: "Transfer not found" });
  if (transfer.Status !== "draft") throw new HTTPException(400, { message: "Only draft transfers can be sent" });

  const items = await db.$client.prepare("SELECT * FROM InventoryTransferItem WHERE TransferId = ?")
    .bind(transferId)
    .all<any>();
  for (const item of items.results || []) {
    const stock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
      .bind(tenantId, item.StockId)
      .first<any>();
    if (!stock) throw new HTTPException(400, { message: `Stock not found for item ${item.ItemId}` });
    const reason = getStockIssueBlockReason(stock, Number(item.Quantity || 0));
    if (reason) throw new HTTPException(400, { message: `${reason} for item ${item.ItemId}` });

    const balanceAfter = Number(stock.AvailableQuantity || 0) - Number(item.Quantity || 0);
    const sourceUpdate = await db.$client.prepare(`
      UPDATE InventoryStock
      SET AvailableQuantity = AvailableQuantity - ?,
          InTransitQuantity = COALESCE(InTransitQuantity, 0) + ?,
          ModifiedBy = ?, ModifiedOn = ?
      WHERE tenant_id = ? AND StockId = ? AND AvailableQuantity = ? AND AvailableQuantity >= ?
    `).bind(
      item.Quantity,
      item.Quantity,
      userId,
      nowIso(),
      tenantId,
      item.StockId,
      Number(stock.AvailableQuantity || 0),
      item.Quantity,
    ).run();
    const sourceUpdateChanges = Number((sourceUpdate.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (sourceUpdateChanges !== 1) {
      throw new HTTPException(409, { message: `Stock changed while sending transfer item ${item.ItemId}. Please refresh and retry.` });
    }

    await stockTransactionStatement(db, {
      tenantId,
      stockId: Number(item.StockId),
      itemId: Number(item.ItemId),
      storeId: Number(transfer.FromStoreId),
      transactionType: normalizeInventoryMovementType("transfer_out"),
      referenceNo: transfer.TransferNo,
      referenceId: transferId,
      outQuantity: Number(item.Quantity),
      balanceQuantity: balanceAfter,
      transactionDate: nowIso(),
      remarks: item.Remarks || transfer.Remarks || null,
      createdBy: userId,
    }).run();
  }

  await db.$client.prepare("UPDATE InventoryTransfer SET Status = 'in_transit', SentBy = ?, SentOn = ? WHERE tenant_id = ? AND TransferId = ?")
    .bind(userId, nowIso(), tenantId, transferId)
    .run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "UPDATE",
    eventType: "stock_transfer",
    tableName: "InventoryTransfer",
    recordId: transferId,
    reason: transfer.Remarks || null,
    before: {
      TransferId: transferId,
      TransferNo: transfer.TransferNo,
      Status: transfer.Status,
      FromStoreId: transfer.FromStoreId,
      ToStoreId: transfer.ToStoreId,
    },
    after: {
      TransferId: transferId,
      TransferNo: transfer.TransferNo,
      Status: "in_transit",
      SentBy: userId,
      FromStoreId: transfer.FromStoreId,
      ToStoreId: transfer.ToStoreId,
    },
    whatChanged: {
      TransferId: transferId,
      TransferNo: transfer.TransferNo,
      statusFrom: transfer.Status,
      statusTo: "in_transit",
      FromStoreId: transfer.FromStoreId,
      ToStoreId: transfer.ToStoreId,
    },
  });

  return c.json({ message: "Transfer sent", TransferId: transferId, Status: "in_transit" });
});

transfers.post("/:id/receive", zValidator("json", receiveTransferSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const transferId = Number(c.req.param("id"));
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const transfer = await getTransfer(db, tenantId, transferId);
  if (!transfer) throw new HTTPException(404, { message: "Transfer not found" });
  if (transfer.Status !== "in_transit" && transfer.Status !== "partially_received") {
    throw new HTTPException(400, { message: "Only in-transit transfers can be received" });
  }

  const requested = new Map((body.Items || []).map(item => [item.TransferItemId, item.ReceivedQuantity]));
  const items = await db.$client.prepare("SELECT * FROM InventoryTransferItem WHERE TransferId = ?")
    .bind(transferId)
    .all<any>();

  let anyReceived = false;
  let allReceived = true;
  for (const item of items.results || []) {
    const remaining = Number(item.Quantity || 0) - Number(item.ReceivedQuantity || 0);
    const receiveQty = requested.has(Number(item.TransferItemId))
      ? Number(requested.get(Number(item.TransferItemId)))
      : remaining;
    if (receiveQty < 0 || receiveQty > remaining) {
      throw new HTTPException(400, { message: `Invalid receive quantity for transfer item ${item.TransferItemId}` });
    }
    if (receiveQty === 0) {
      if (remaining > 0) allReceived = false;
      continue;
    }
    anyReceived = true;
    if (receiveQty < remaining) allReceived = false;

    const sourceStock = await db.$client.prepare("SELECT * FROM InventoryStock WHERE tenant_id = ? AND StockId = ?")
      .bind(tenantId, item.StockId)
      .first<any>();
    if (!sourceStock) throw new HTTPException(400, { message: `Source stock not found for item ${item.ItemId}` });

    const sourceReceiveUpdate = await db.$client.prepare(`
      UPDATE InventoryStock
      SET InTransitQuantity = COALESCE(InTransitQuantity, 0) - ?,
          ModifiedBy = ?, ModifiedOn = ?
      WHERE tenant_id = ? AND StockId = ? AND COALESCE(InTransitQuantity, 0) >= ?
    `).bind(receiveQty, userId, nowIso(), tenantId, item.StockId, receiveQty).run();
    const sourceReceiveChanges = Number((sourceReceiveUpdate.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (sourceReceiveChanges !== 1) {
      throw new HTTPException(409, { message: `Transfer in-transit stock changed for item ${item.ItemId}. Please refresh and retry.` });
    }

    const destStock = await db.$client.prepare(`
      SELECT StockId, AvailableQuantity
      FROM InventoryStock
      WHERE tenant_id = ? AND ItemId = ? AND StoreId = ? AND COALESCE(BatchNo, '') = COALESCE(?, '')
      LIMIT 1
    `).bind(tenantId, item.ItemId, transfer.ToStoreId, item.BatchNo || null).first<any>();

    let destStockId: number;
    let balanceAfter: number;
    if (destStock) {
      destStockId = Number(destStock.StockId);
      balanceAfter = Number(destStock.AvailableQuantity || 0) + receiveQty;
      const destUpdate = await db.$client.prepare(`
        UPDATE InventoryStock
        SET AvailableQuantity = AvailableQuantity + ?, ModifiedBy = ?, ModifiedOn = ?
        WHERE tenant_id = ? AND StockId = ? AND AvailableQuantity = ?
      `).bind(receiveQty, userId, nowIso(), tenantId, destStockId, Number(destStock.AvailableQuantity || 0)).run();
      const destUpdateChanges = Number((destUpdate.meta as { changes?: number } | undefined)?.changes ?? 0);
      if (destUpdateChanges !== 1) {
        throw new HTTPException(409, { message: `Destination stock changed while receiving transfer item ${item.ItemId}. Please refresh and retry.` });
      }
    } else {
      const created = await db.$client.prepare(`
        INSERT INTO InventoryStock
          (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, CostPrice, MRP, AvailableQuantity, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        item.ItemId,
        transfer.ToStoreId,
        item.BatchNo || sourceStock.BatchNo || "NA",
        item.ExpiryDate || sourceStock.ExpiryDate || null,
        Number(item.CostPrice || sourceStock.CostPrice || 0),
        Number(sourceStock.MRP || item.CostPrice || 0),
        receiveQty,
        userId,
        nowIso(),
      ).run();
      destStockId = Number(created.meta.last_row_id);
      balanceAfter = receiveQty;
    }

    const transferItemUpdate = await db.$client.prepare(`
      UPDATE InventoryTransferItem
      SET ReceivedQuantity = ReceivedQuantity + ?
      WHERE TransferItemId = ?
        AND TransferId = ?
        AND ReceivedQuantity = ?
        AND (Quantity - ReceivedQuantity) >= ?
    `).bind(receiveQty, item.TransferItemId, transferId, Number(item.ReceivedQuantity || 0), receiveQty).run();
    const transferItemChanges = Number((transferItemUpdate.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (transferItemChanges !== 1) {
      throw new HTTPException(409, { message: `Transfer item ${item.TransferItemId} was already received or changed. Please refresh and retry.` });
    }

    await stockTransactionStatement(db, {
      tenantId,
      stockId: destStockId,
      itemId: Number(item.ItemId),
      storeId: Number(transfer.ToStoreId),
      transactionType: normalizeInventoryMovementType("transfer_in"),
      referenceNo: transfer.TransferNo,
      referenceId: transferId,
      inQuantity: receiveQty,
      balanceQuantity: balanceAfter,
      transactionDate: nowIso(),
      remarks: body.Remarks || item.Remarks || transfer.Remarks || null,
      createdBy: userId,
    }).run();
  }

  if (!anyReceived) throw new HTTPException(400, { message: "No transfer quantity received" });
  const status = allReceived ? "received" : "partially_received";
  await db.$client.prepare("UPDATE InventoryTransfer SET Status = ?, ReceivedBy = ?, ReceivedOn = ? WHERE tenant_id = ? AND TransferId = ?")
    .bind(status, userId, nowIso(), tenantId, transferId)
    .run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "RECEIVE",
    eventType: "stock_transfer_receipt",
    tableName: "InventoryTransfer",
    recordId: transferId,
    reason: body.Remarks || transfer.Remarks || null,
    before: {
      TransferId: transferId,
      TransferNo: transfer.TransferNo,
      Status: transfer.Status,
      FromStoreId: transfer.FromStoreId,
      ToStoreId: transfer.ToStoreId,
    },
    after: {
      TransferId: transferId,
      TransferNo: transfer.TransferNo,
      Status: status,
      ReceivedBy: userId,
      FromStoreId: transfer.FromStoreId,
      ToStoreId: transfer.ToStoreId,
    },
    whatChanged: {
      TransferId: transferId,
      TransferNo: transfer.TransferNo,
      statusFrom: transfer.Status,
      statusTo: status,
      FromStoreId: transfer.FromStoreId,
      ToStoreId: transfer.ToStoreId,
    },
  });

  return c.json({ message: "Transfer received", TransferId: transferId, Status: status });
});

export default transfers;

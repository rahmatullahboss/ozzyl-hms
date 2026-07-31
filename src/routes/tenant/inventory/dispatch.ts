import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { generateSequenceNo } from "../../../utils/sequence";
import { getDb } from '../../../db';
import { stockTransactionStatement } from "./helpers";
import { getStockIssueBlockReason, selectFefoStockAllocations } from "../../../lib/inventory-core";


const dispatch = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /dispatch
dispatch.get("/", zValidator("query", schemas.listDispatchesSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, RequisitionId, SourceStoreId, DestinationStoreId, IsReceived, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["D.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (RequisitionId) { conditions.push("D.RequisitionId = ?"); params.push(RequisitionId); }
  if (SourceStoreId) { conditions.push("D.SourceStoreId = ?"); params.push(SourceStoreId); }
  if (DestinationStoreId) { conditions.push("D.DestinationStoreId = ?"); params.push(DestinationStoreId); }
  if (IsReceived) { conditions.push("D.ReceivedOn IS " + (IsReceived === 'true' ? "NOT NULL" : "NULL")); }
  if (FromDate) { conditions.push("D.DispatchDate >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("D.DispatchDate <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryDispatch D WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT D.*, S1.StoreName as SourceStoreName, S2.StoreName as DestinationStoreName
    FROM InventoryDispatch D
    JOIN InventoryStore S1 ON D.SourceStoreId = S1.StoreId
    JOIN InventoryStore S2 ON D.DestinationStoreId = S2.StoreId
    WHERE ${whereClause}
    ORDER BY D.DispatchId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /dispatch
dispatch.post("/", zValidator("json", schemas.createDispatchSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  // Check Stock First (with tenant scoping)
  // Map from itemIndex → array of allocations (supports multi-batch FEFO)
  const allocationsByItemIndex = new Map<number, Array<{ stock: any; quantity: number; balanceAfterIssue: number }>>();
  let itemIndex = 0;
  for (const item of body.Items) {
    if (item.StockId) {
      // Explicit StockId — bypass FEFO, use specific batch
      const stock = await db.$client.prepare(
        "SELECT StockId, AvailableQuantity, BatchNo, ExpiryDate, CostPrice, MRP FROM InventoryStock WHERE StockId = ? AND tenant_id = ?"
      ).bind(item.StockId, tenantId).first<any>();
      if (!stock || Number(stock.AvailableQuantity) < item.DispatchedQuantity) {
        return c.json({ error: `Insufficient stock for item ${item.ItemId}` }, 400);
      }
      const blockReason = getStockIssueBlockReason(stock, item.DispatchedQuantity, { today });
      if (blockReason) {
        return c.json({ error: `${blockReason} for item ${item.ItemId}` }, 400);
      }
      allocationsByItemIndex.set(itemIndex, [{ stock, quantity: item.DispatchedQuantity, balanceAfterIssue: Number(stock.AvailableQuantity) - item.DispatchedQuantity }]);
    } else {
      // No StockId — use FEFO multi-batch allocation
      const rows = await db.$client.prepare(`
        SELECT StockId, AvailableQuantity, BatchNo, ExpiryDate, CostPrice, MRP, IsActive
        FROM InventoryStock
        WHERE ItemId = ? AND StoreId = ? AND tenant_id = ?
          AND COALESCE(IsActive, 1) = 1
          AND AvailableQuantity > 0
          AND (? IS NULL OR BatchNo = ?)
        ORDER BY CASE WHEN ExpiryDate IS NULL OR ExpiryDate = '' THEN 1 ELSE 0 END, ExpiryDate ASC, StockId ASC
      `).bind(item.ItemId, body.SourceStoreId, tenantId, item.BatchNo || null, item.BatchNo || null).all();

      try {
        const fefoAllocations = selectFefoStockAllocations(rows.results || [], item.DispatchedQuantity, { today });
        const detailedAllocations = fefoAllocations.map(allocation => {
          const stock = (rows.results || []).find((r: any) => Number(r.StockId) === allocation.stockId);
          return { stock, quantity: allocation.quantity, balanceAfterIssue: allocation.balanceAfterIssue };
        }).filter(a => a.stock);
        allocationsByItemIndex.set(itemIndex, detailedAllocations);
      } catch (err: any) {
        return c.json({ error: `Insufficient stock for item ${item.ItemId}: ${err.message}` }, 400);
      }
    }
    itemIndex += 1;
  }

  const nextDispNo = await generateSequenceNo(c.env.DB, 'DSP', 'InventoryDispatch', 'DispatchNo', tenantId);

  // Insert Header
  const result = await db.$client.prepare(`
    INSERT INTO InventoryDispatch (tenant_id, DispatchNo, DispatchDate, RequisitionId, SourceStoreId, DestinationStoreId, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, nextDispNo, today, body.RequisitionId || null, body.SourceStoreId, body.DestinationStoreId,
    body.Remarks || null, userId ?? null, new Date().toISOString(),
  ).run();

  const dispatchId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];

  // Process Items — each item may have multiple batch allocations
  for (const [index, item] of body.Items.entries()) {
    const allocations = allocationsByItemIndex.get(index);
    if (!allocations || allocations.length === 0) return c.json({ error: `Stock resolution failed for item ${item.ItemId}` }, 400);

    for (const allocation of allocations) {
      const sourceStock = allocation.stock;

      // 1. Dispatch Item (one per batch allocation)
      batchOps.push(db.$client.prepare(`
        INSERT INTO InventoryDispatchItem (DispatchId, RequisitionItemId, ItemId, StockId, BatchNo, ExpiryDate, DispatchedQuantity, CostPrice, Remarks, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        dispatchId, item.RequisitionItemId || null, item.ItemId, sourceStock.StockId, sourceStock.BatchNo || null,
        sourceStock?.ExpiryDate || null, allocation.quantity, sourceStock?.CostPrice || 0,
        item.Remarks || null, userId ?? null, new Date().toISOString(),
      ));

      // 2. Update Source Stock (Deduct) — scoped
      batchOps.push(db.$client.prepare(
        "UPDATE InventoryStock SET AvailableQuantity = AvailableQuantity - ? WHERE StockId = ? AND tenant_id = ?"
      ).bind(allocation.quantity, sourceStock.StockId, tenantId));

      // 3. Stock Transaction
      batchOps.push(stockTransactionStatement(db, {
        tenantId: tenantId!,
        stockId: sourceStock.StockId,
        itemId: item.ItemId,
        storeId: body.SourceStoreId,
        transactionType: 'dispatch-out',
        referenceNo: nextDispNo,
        referenceId: Number(dispatchId),
        outQuantity: allocation.quantity,
        balanceQuantity: allocation.balanceAfterIssue,
        transactionDate: new Date().toISOString(),
        remarks: item.Remarks ?? body.Remarks ?? null,
        createdBy: userId ?? null,
      }));
    }
  }

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  return c.json({ message: "Dispatch created", DispatchId: dispatchId, DispatchNo: nextDispNo }, 201);
});

// PUT /dispatch/:id/receive
dispatch.put("/:id/receive", zValidator("json", schemas.receiveDispatchPayloadSchema), async (c) => {
  const db = getDb(c.env.DB);
  const dispatchId = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString();

  // 1. Get Dispatch Details (tenant-scoped)
  const dispatchRecord = await db.$client.prepare(
    "SELECT * FROM InventoryDispatch WHERE DispatchId = ? AND tenant_id = ?"
  ).bind(dispatchId, tenantId).first<any>();

  if (!dispatchRecord) return c.json({ error: "Dispatch not found" }, 404);
  if (dispatchRecord.ReceivedOn) return c.json({ error: "Already received" }, 400);

  const items = await db.$client.prepare(
    "SELECT * FROM InventoryDispatchItem WHERE DispatchId = ?"
  ).bind(dispatchId).all<any>();

  // Update Header
  await db.$client.prepare(
    "UPDATE InventoryDispatch SET ReceivedBy = ?, ReceivedOn = ?, IsReceived = 1 WHERE DispatchId = ? AND tenant_id = ?"
  ).bind(userId ?? null, today, dispatchId, tenantId).run();

  // Process Items sequentially (need StockId for transaction log)
  for (const item of items.results) {
    const sourceStock = await db.$client.prepare(
      "SELECT * FROM InventoryStock WHERE StockId = ? AND tenant_id = ?"
    ).bind(item.StockId, tenantId).first<any>();
    if (!sourceStock) continue;

    // Find existing stock in Dest Store or create new
    const destStock = await db.$client.prepare(
      "SELECT StockId, AvailableQuantity FROM InventoryStock WHERE ItemId = ? AND StoreId = ? AND BatchNo = ? AND tenant_id = ?"
    ).bind(item.ItemId, dispatchRecord.DestinationStoreId, sourceStock.BatchNo, tenantId).first<any>();

    let finalStockId: number;
    if (destStock) {
      finalStockId = destStock.StockId;
      const newBalance = Number(destStock.AvailableQuantity || 0) + Number(item.DispatchedQuantity || 0);
      await db.$client.prepare(
        "UPDATE InventoryStock SET AvailableQuantity = AvailableQuantity + ? WHERE StockId = ? AND tenant_id = ?"
      ).bind(item.DispatchedQuantity, finalStockId, tenantId).run();
      await stockTransactionStatement(db, {
        tenantId: tenantId!,
        stockId: finalStockId,
        itemId: item.ItemId,
        storeId: dispatchRecord.DestinationStoreId,
        transactionType: 'dispatch-in',
        referenceNo: dispatchRecord.DispatchNo,
        referenceId: Number(dispatchId),
        inQuantity: item.DispatchedQuantity,
        balanceQuantity: newBalance,
        transactionDate: today,
        remarks: body.ReceivedRemarks || null,
        createdBy: userId ?? null,
      }).run();
    } else {
      const res = await db.$client.prepare(`
        INSERT INTO InventoryStock (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, CostPrice, MRP, AvailableQuantity, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId, item.ItemId, dispatchRecord.DestinationStoreId, sourceStock.BatchNo, sourceStock.ExpiryDate,
        sourceStock.CostPrice, sourceStock.MRP, item.DispatchedQuantity, userId ?? null, today,
      ).run();
      finalStockId = res.meta.last_row_id as number;
      await stockTransactionStatement(db, {
        tenantId: tenantId!,
        stockId: finalStockId,
        itemId: item.ItemId,
        storeId: dispatchRecord.DestinationStoreId,
        transactionType: 'dispatch-in',
        referenceNo: dispatchRecord.DispatchNo,
        referenceId: Number(dispatchId),
        inQuantity: item.DispatchedQuantity,
        balanceQuantity: item.DispatchedQuantity,
        transactionDate: today,
        remarks: body.ReceivedRemarks || null,
        createdBy: userId ?? null,
      }).run();
    }
  }

  return c.json({ message: "Dispatch received" });
});

export default dispatch;

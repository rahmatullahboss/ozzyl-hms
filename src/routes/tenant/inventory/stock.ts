import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schemas from "../../../schemas/inventory";
import type { Env } from '../../../types';
import { getDb } from '../../../db';
import { createInventoryAuditLog, stockTransactionStatement } from "./helpers";
import { getInventoryStockStatus } from "../../../lib/inventory-core";
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from "../../../lib/accounting-posting";


const stock = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

const stockOverviewSchema = z.object({
  ...({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(1000).default(20),
  }),
  search: z.string().optional(),
  ItemType: z.string().optional(),
  CategoryId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  SupplierId: z.coerce.number().int().positive().optional(),
  ExpiryFrom: z.string().optional(),
  ExpiryTo: z.string().optional(),
  BatchNo: z.string().optional(),
  RackShelf: z.string().optional(),
  LowStock: z.string().optional(),
  OutOfStock: z.string().optional(),
  Status: z.string().optional(),
});

// GET /stock/overview - Operational batch/location overview for the inventory command center
stock.get("/overview", zValidator("query", stockOverviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const offset = (query.page - 1) * query.limit;
  const tenantId = c.get("tenantId");
  const today = new Date().toISOString().slice(0, 10);

  const conditions: string[] = ["S.tenant_id = ?"];
  const params: any[] = [tenantId];

  if (query.search) {
    conditions.push("(I.ItemName LIKE ? OR I.ItemCode LIKE ? OR S.BatchNo LIKE ?)");
    params.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
  }
  if (query.ItemType) { conditions.push("I.ItemType = ?"); params.push(query.ItemType); }
  if (query.CategoryId) { conditions.push("I.ItemCategoryId = ?"); params.push(query.CategoryId); }
  if (query.StoreId) { conditions.push("S.StoreId = ?"); params.push(query.StoreId); }
  if (query.SupplierId) { conditions.push("I.SupplierId = ?"); params.push(query.SupplierId); }
  if (query.ExpiryFrom) { conditions.push("S.ExpiryDate >= ?"); params.push(query.ExpiryFrom); }
  if (query.ExpiryTo) { conditions.push("S.ExpiryDate <= ?"); params.push(query.ExpiryTo); }
  if (query.BatchNo) { conditions.push("S.BatchNo = ?"); params.push(query.BatchNo); }
  if (query.RackShelf) { conditions.push("(S.RackShelf = ? OR I.RackShelf = ?)"); params.push(query.RackShelf, query.RackShelf); }
  if (query.LowStock === "true") { conditions.push("S.AvailableQuantity > 0 AND S.AvailableQuantity <= I.ReOrderLevel"); }
  if (query.OutOfStock === "true") { conditions.push("S.AvailableQuantity <= 0"); }
  if (query.Status) { conditions.push("COALESCE(S.StockStatus, 'available') = ?"); params.push(query.Status); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(`
    SELECT COUNT(*) as total
    FROM InventoryStock S
    JOIN InventoryItem I ON S.ItemId = I.ItemId AND I.tenant_id = S.tenant_id
    WHERE ${whereClause}
  `).bind(...params).first<{ total: number }>();

  const rows = await db.$client.prepare(`
    SELECT
      S.*, I.ItemName, I.ItemCode, I.ItemType, I.ReOrderLevel, I.MinStockQuantity, I.RackShelf AS ItemRackShelf,
      C.CategoryName, ST.StoreName, V.VendorName
    FROM InventoryStock S
    JOIN InventoryItem I ON S.ItemId = I.ItemId AND I.tenant_id = S.tenant_id
    LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
    LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
    LEFT JOIN InventoryVendor V ON V.VendorId = I.SupplierId AND V.tenant_id = I.tenant_id
    WHERE ${whereClause}
    ORDER BY I.ItemName ASC, CASE WHEN S.ExpiryDate IS NULL THEN 1 ELSE 0 END, S.ExpiryDate ASC, S.StockId ASC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all<any>();

  const data = (rows.results || []).map((row: any) => ({
    ...row,
    RackShelf: row.RackShelf || row.ItemRackShelf || null,
    AvailableQuantity: Number(row.AvailableQuantity || 0),
    ReservedQuantity: Number(row.ReservedQuantity || 0),
    DamagedQuantity: Number(row.DamagedQuantity || 0),
    BlockedQuantity: Number(row.BlockedQuantity || 0),
    StockValue: Number(row.AvailableQuantity || 0) * Number(row.CostPrice || 0),
    Status: getInventoryStockStatus(row, { today }),
  }));

  return c.json({ data, pagination: { page: query.page, limit: query.limit, total: count?.total || 0 } });
});

// GET /stock - List stocks
stock.get("/", zValidator("query", schemas.listStockSchema), async (c) => {
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const { page, limit, search, ItemId, StoreId, ExpiringBefore, BelowReorderLevel, LowStock } = query;
  const offset = (page - 1) * limit;

  const conditions: string[] = ["S.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(I.ItemName LIKE ? OR S.BatchNo LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (ItemId) { conditions.push("S.ItemId = ?"); params.push(ItemId); }
  if (StoreId) { conditions.push("S.StoreId = ?"); params.push(StoreId); }
  if (ExpiringBefore) { conditions.push("S.ExpiryDate <= ?"); params.push(ExpiringBefore); }
  if (BelowReorderLevel === "true" || LowStock === "true") {
    conditions.push("S.AvailableQuantity <= I.ReOrderLevel");
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await db.$client.prepare(`
    SELECT COUNT(*) as total
    FROM InventoryStock S
    JOIN InventoryItem I ON S.ItemId = I.ItemId
    JOIN InventoryStore ST ON S.StoreId = ST.StoreId
    WHERE ${whereClause}
  `).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT S.*, I.ItemName, I.ItemCode, I.ReOrderLevel, ST.StoreName
    FROM InventoryStock S
    JOIN InventoryItem I ON S.ItemId = I.ItemId
    JOIN InventoryStore ST ON S.StoreId = ST.StoreId
    WHERE ${whereClause}
    ORDER BY I.ItemName ASC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({
    data: results.results,
    pagination: { page, limit, total: countResult?.total || 0 },
  });
});

// POST /adjustment - Stock Adjustment
const handleStockAdjustment = async (c: any) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  const batchOps: D1PreparedStatement[] = [];
  const stockUpdateChecks: { batchIndex: number; itemId: number }[] = [];
  const adjustmentAuditItems: Array<Record<string, unknown>> = [];
  let totalAdjustmentInValue = 0;
  let totalAdjustmentOutValue = 0;

  for (const item of body.Items) {
    const storeId = item.StoreId ?? body.StoreId;
    if (!storeId) {
      return c.json({ error: `StoreId is required for item ${item.ItemId}` }, 400);
    }
    const adjustmentType = item.AdjustmentType === 'add' ? 'in'
      : item.AdjustmentType === 'subtract' ? 'out'
      : item.AdjustmentType;
    let stockId = item.StockId;
    let currentStock: any = null;

    // 1. Resolve StockId (with tenant scoping)
    if (stockId) {
      currentStock = await db.$client.prepare(
        "SELECT * FROM InventoryStock WHERE StockId = ? AND tenant_id = ?"
      ).bind(stockId, tenantId).first();
    } else if (item.ItemId && storeId && item.BatchNo) {
      currentStock = await db.$client.prepare(
        "SELECT * FROM InventoryStock WHERE ItemId = ? AND StoreId = ? AND BatchNo = ? AND tenant_id = ?"
      ).bind(item.ItemId, storeId, item.BatchNo, tenantId).first();
      if (currentStock) stockId = currentStock.StockId;
    }

    // 2. Handle Logic
    if (currentStock) {
      // Update existing stock
      let newQty = currentStock.AvailableQuantity;
      if (adjustmentType === 'in') {
        newQty += item.Quantity;
        totalAdjustmentInValue += (Number(currentStock.CostPrice) || 0) * item.Quantity;
      } else {
        newQty -= item.Quantity;
        if (newQty < 0) {
          return c.json({ error: `Insufficient stock for Item ${item.ItemId} Batch ${item.BatchNo}` }, 400);
        }
        totalAdjustmentOutValue += (Number(currentStock.CostPrice) || 0) * item.Quantity;
      }

      adjustmentAuditItems.push({
        ItemId: item.ItemId,
        StockId: Number(stockId),
        StoreId: storeId,
        AdjustmentType: adjustmentType,
        Quantity: item.Quantity,
        reason: item.Remarks ?? body.Remarks ?? null,
        before: { AvailableQuantity: Number(currentStock.AvailableQuantity || 0) },
        after: { AvailableQuantity: newQty },
      });

      const modifiedOn = new Date().toISOString();
      stockUpdateChecks.push({ batchIndex: batchOps.length, itemId: item.ItemId });
      batchOps.push(
        db.$client.prepare(
          "UPDATE InventoryStock SET AvailableQuantity = ?, ModifiedBy = ?, ModifiedOn = ? WHERE StockId = ? AND tenant_id = ? AND AvailableQuantity = ?"
        ).bind(newQty, userId ?? null, modifiedOn, stockId, tenantId, Number(currentStock.AvailableQuantity || 0)),
      );

      // Ledger Transaction — conditional on the optimistic stock update marker so a stale update cannot leave an orphan ledger row.
      batchOps.push(
        db.$client.prepare(`
          INSERT INTO InventoryStockTransaction
            (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
             InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
          SELECT ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1
            FROM InventoryStock
            WHERE StockId = ?
              AND tenant_id = ?
              AND AvailableQuantity = ?
              AND ModifiedBy IS ?
              AND ModifiedOn = ?
          )
        `).bind(
          tenantId!,
          Number(stockId),
          item.ItemId,
          storeId,
          adjustmentType === 'in' ? 'adjustment-in' : 'adjustment-out',
          adjustmentType === 'in' ? item.Quantity : 0,
          adjustmentType === 'out' ? item.Quantity : 0,
          newQty,
          today,
          item.Remarks ?? body.Remarks ?? null,
          userId ?? null,
          today,
          Number(stockId),
          tenantId,
          newQty,
          userId ?? null,
          modifiedOn,
        ),
      );
    } else {
      // Stock not found
      if (adjustmentType === 'out') {
        return c.json({ error: `Cannot deduct stock. Stock not found for Item ${item.ItemId} Batch ${item.BatchNo}` }, 400);
      }

      // Create new stock entry (Adjustment In) — must await for StockId linkage
      const itemMaster = await db.$client.prepare(`
        SELECT StandardRate, ItemType, IsBatchRequired, IsExpiryRequired
        FROM InventoryItem
        WHERE ItemId = ? AND tenant_id = ?
      `).bind(item.ItemId, tenantId).first<{
        StandardRate?: number | null;
        ItemType?: string | null;
        IsBatchRequired?: number | boolean | null;
        IsExpiryRequired?: number | boolean | null;
      }>();
      if (!itemMaster) {
        return c.json({ error: `Inventory item ${item.ItemId} not found` }, 404);
      }

      const batchNo = String(item.BatchNo ?? '').trim() || null;
      const expiryDate = String(item.ExpiryDate ?? '').trim() || null;
      if ((itemMaster.IsBatchRequired === 1 || itemMaster.IsBatchRequired === true || itemMaster.ItemType === 'lab_reagent') && !batchNo) {
        return c.json({ error: `Batch number is required for Item ${item.ItemId}` }, 400);
      }
      if ((itemMaster.IsExpiryRequired === 1 || itemMaster.IsExpiryRequired === true || itemMaster.ItemType === 'lab_reagent') && !expiryDate) {
        return c.json({ error: `Expiry date is required for Item ${item.ItemId}` }, 400);
      }

      const costPrice = Number(itemMaster.StandardRate || 0);
      totalAdjustmentInValue += costPrice * item.Quantity;

      const stockInsert = db.$client.prepare(`
        INSERT INTO InventoryStock
          (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, MRP, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId, item.ItemId, storeId, batchNo,
        expiryDate, item.Quantity, costPrice, costPrice,
        userId ?? null, today,
      );

      const transactionInsert = db.$client.prepare(`
        INSERT INTO InventoryStockTransaction
          (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
           InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
        SELECT ?, last_insert_rowid(), ?, ?, 'adjustment-in', NULL, NULL, ?, 0, ?, ?, ?, ?, ?
        WHERE changes() = 1
      `).bind(
        tenantId,
        item.ItemId,
        storeId,
        item.Quantity,
        item.Quantity,
        today,
        item.Remarks ?? body.Remarks ?? null,
        userId ?? null,
        today,
      );

      const newStockBatch = await db.$client.batch([stockInsert, transactionInsert]);
      const stockInsertChanges = Number((newStockBatch[0]?.meta as { changes?: number } | undefined)?.changes ?? 0);
      const transactionInsertChanges = Number((newStockBatch[1]?.meta as { changes?: number } | undefined)?.changes ?? 0);
      if (stockInsertChanges !== 1 || transactionInsertChanges !== 1) {
        return c.json({ error: `Failed to atomically create stock and ledger for Item ${item.ItemId}` }, 409);
      }

      const newStockId = Number((newStockBatch[0]?.meta as { last_row_id?: number } | undefined)?.last_row_id ?? 0);
      adjustmentAuditItems.push({
        ItemId: item.ItemId,
        StockId: newStockId,
        StoreId: storeId,
        AdjustmentType: "in",
        Quantity: item.Quantity,
        reason: item.Remarks ?? body.Remarks ?? null,
        before: null,
        after: { AvailableQuantity: item.Quantity },
      });
    }
  }

  if (batchOps.length > 0) {
    const batchResults = await db.$client.batch(batchOps);
    for (const check of stockUpdateChecks) {
      const updateChanges = Number((batchResults[check.batchIndex]?.meta as { changes?: number } | undefined)?.changes ?? 0);
      if (updateChanges !== 1) {
        return c.json({ error: `Stock changed while adjusting Item ${check.itemId}. Please refresh and retry.` }, 409);
      }
    }
  }

  if (totalAdjustmentOutValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_adjustment',
      sourceId: `adj-out-${today}`,
      eventType: ACCOUNTING_EVENT_TYPES.inventoryConsumption,
      eventDate: today,
      payload: { totalCost: totalAdjustmentOutValue },
      createdBy: userId,
    });
  }

  if (totalAdjustmentInValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_adjustment',
      sourceId: `adj-in-${today}`,
      eventType: ACCOUNTING_EVENT_TYPES.inventoryPurchase,
      eventDate: today,
      payload: { totalAmount: totalAdjustmentInValue, isCredit: false },
      createdBy: userId,
    });
  }

  if (totalAdjustmentOutValue > 0 || totalAdjustmentInValue > 0) {
    const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
      console.error('Failed to post inventory adjustment accounting event:', error);
    });
    try {
      c.executionCtx.waitUntil(posting);
    } catch {
      void posting;
    }
  }

  if (tenantId && userId) {
    await createInventoryAuditLog(c, {
      tenantId,
      userId,
      action: "UPDATE",
      eventType: "inventory_stock_adjustment",
      tableName: "InventoryStock",
      reason: body.Remarks || null,
      before: {
        items: adjustmentAuditItems.map((item) => ({
          ItemId: item.ItemId,
          StockId: item.StockId,
          StoreId: item.StoreId,
          before: item.before,
        })),
      },
      after: {
        items: adjustmentAuditItems.map((item) => ({
          ItemId: item.ItemId,
          StockId: item.StockId,
          StoreId: item.StoreId,
          after: item.after,
        })),
      },
      whatChanged: {
        itemCount: adjustmentAuditItems.length,
        totalAdjustmentInValue,
        totalAdjustmentOutValue,
        items: adjustmentAuditItems,
      },
    });
  }

  return c.json({ message: "Stock adjustment processed successfully" });
};

stock.post("/adjustment", zValidator("json", schemas.createStockAdjustmentSchema), handleStockAdjustment);
stock.post("/adjustments", zValidator("json", schemas.createStockAdjustmentSchema), handleStockAdjustment);

// GET /transactions - List Stock Transactions
stock.get("/transactions", zValidator("query", schemas.listStockTransactionsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, ItemId, StoreId, TransactionType, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["T.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (ItemId) { conditions.push("T.ItemId = ?"); params.push(ItemId); }
  if (StoreId) { conditions.push("T.StoreId = ?"); params.push(StoreId); }
  if (TransactionType) { conditions.push("T.TransactionType = ?"); params.push(TransactionType); }
  if (FromDate) { conditions.push("T.CreatedOn >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("T.CreatedOn <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryStockTransaction T WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT T.*, I.ItemName, S.StoreName
    FROM InventoryStockTransaction T
    JOIN InventoryItem I ON T.ItemId = I.ItemId
    JOIN InventoryStore S ON T.StoreId = S.StoreId
    WHERE ${whereClause}
    ORDER BY T.TransactionId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

export default stock;

import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { generateSequenceNo } from "../../../utils/sequence";
import { getDb } from '../../../db';
import { stockTransactionStatement } from "./helpers";
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from "../../../lib/accounting-posting";


const ret = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /return
ret.get("/", zValidator("query", schemas.listReturnToVendorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, VendorId, StoreId, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["R.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (VendorId) { conditions.push("R.VendorId = ?"); params.push(VendorId); }
  if (StoreId) { conditions.push("R.StoreId = ?"); params.push(StoreId); }
  if (FromDate) { conditions.push("R.ReturnDate >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("R.ReturnDate <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryReturnToVendor R WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT R.*, V.VendorName
    FROM InventoryReturnToVendor R
    JOIN InventoryVendor V ON R.VendorId = V.VendorId
    WHERE ${whereClause}
    ORDER BY R.ReturnId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /return
ret.post("/", zValidator("json", schemas.createReturnToVendorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  const nextRetNo = await generateSequenceNo(c.env.DB, 'RET', 'InventoryReturnToVendor', 'ReturnNo', tenantId);

  // Insert Header
  const result = await db.$client.prepare(`
    INSERT INTO InventoryReturnToVendor (tenant_id, ReturnNo, ReturnDate, VendorId, StoreId, GoodsReceiptId, Reason, CreditNoteNo, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, nextRetNo, today, body.VendorId, body.StoreId, body.GoodsReceiptId,
    body.Reason, body.CreditNoteNo || null, body.Remarks || null,
    userId ?? null, new Date().toISOString(),
  ).run();

  const retId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];
  let totalReturnValue = 0;

  // Process Items
  for (const item of body.Items) {
    // Find Stock by GRItemId (tenant-scoped)
    const stock = await db.$client.prepare(
      "SELECT StockId, AvailableQuantity, CostPrice FROM InventoryStock WHERE GRItemId = ? AND ItemId = ? AND tenant_id = ?"
    ).bind(item.GRItemId, item.ItemId, tenantId).first<{ StockId: number; AvailableQuantity: number; CostPrice: number }>();

    if (!stock || stock.AvailableQuantity < item.ReturnQuantity) {
      return c.json({ error: `Insufficient stock for Return (Item ${item.ItemId} from GR Item ${item.GRItemId})` }, 400);
    }

    totalReturnValue += (stock.CostPrice || 0) * item.ReturnQuantity;

    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryReturnToVendorItem (ReturnId, ItemId, GRItemId, ReturnQuantity, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(retId, item.ItemId, item.GRItemId, item.ReturnQuantity, item.Remarks || null, userId ?? null, new Date().toISOString()));

    // Deduct Stock (scoped)
    batchOps.push(db.$client.prepare(
      "UPDATE InventoryStock SET AvailableQuantity = AvailableQuantity - ? WHERE StockId = ? AND tenant_id = ?"
    ).bind(item.ReturnQuantity, stock.StockId, tenantId));

    // Transaction
    batchOps.push(stockTransactionStatement(db, {
      tenantId: tenantId!,
      stockId: stock.StockId,
      itemId: item.ItemId,
      storeId: body.StoreId,
      transactionType: 'return-to-vendor',
      referenceNo: nextRetNo,
      referenceId: Number(retId),
      outQuantity: item.ReturnQuantity,
      balanceQuantity: stock.AvailableQuantity - item.ReturnQuantity,
      transactionDate: new Date().toISOString(),
      remarks: item.Remarks ?? body.Remarks ?? null,
      createdBy: userId ?? null,
    }));
  }

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  if (totalReturnValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId: tenantId!,
      sourceType: 'inventory_return',
      sourceId: String(retId),
      eventType: ACCOUNTING_EVENT_TYPES.inventoryReturn,
      eventDate: today,
      payload: {
        totalAmount: totalReturnValue,
        vendorId: body.VendorId,
        reason: body.Reason || 'Return to vendor',
      },
      createdBy: userId!,
    });

    const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
      console.error('Failed to post inventory return accounting event:', error);
    });
    try {
      c.executionCtx.waitUntil(posting);
    } catch {
      void posting;
    }
  }

  return c.json({ message: "Return created", ReturnId: retId, ReturnNo: nextRetNo }, 201);
});

export default ret;

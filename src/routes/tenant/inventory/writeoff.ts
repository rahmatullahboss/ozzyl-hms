import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import * as schemas from "../../../schemas/inventory";
import { generateSequenceNo } from "../../../utils/sequence";
import { getDb } from '../../../db';
import { createInventoryAuditLog, stockTransactionStatement } from "./helpers";
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from "../../../lib/accounting-posting";


const writeoff = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /writeoff
writeoff.get("/", zValidator("query", schemas.listWriteOffsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, StoreId, Reason, IsApproved, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["W.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (StoreId) { conditions.push("W.StoreId = ?"); params.push(StoreId); }
  if (Reason) { conditions.push("W.Reason = ?"); params.push(Reason); }
  if (IsApproved) { conditions.push("W.IsApproved = ?"); params.push(IsApproved === 'true' ? 1 : 0); }
  if (FromDate) { conditions.push("W.WriteOffDate >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("W.WriteOffDate <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryWriteOff W WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT W.*, S.StoreName
    FROM InventoryWriteOff W
    JOIN InventoryStore S ON W.StoreId = S.StoreId
    WHERE ${whereClause}
    ORDER BY W.WriteOffId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /writeoff
writeoff.post("/", zValidator("json", schemas.createWriteOffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  const nextWONo = await generateSequenceNo(c.env.DB, 'WO', 'InventoryWriteOff', 'WriteOffNo', tenantId);

  // Insert Header
  const result = await db.$client.prepare(`
    INSERT INTO InventoryWriteOff (tenant_id, WriteOffNo, WriteOffDate, StoreId, Reason, Description, Remarks, IsApproved, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, nextWONo, today, body.StoreId, body.Reason, body.Description || null, body.Remarks || null,
    0, userId ?? null, new Date().toISOString(),
  ).run();

  const woId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];

  for (const item of body.Items) {
    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryWriteOffItem (WriteOffId, ItemId, StockId, Quantity, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(woId, item.ItemId, item.StockId, item.Quantity, item.Remarks || null, userId ?? null, new Date().toISOString()));
  }

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  if (tenantId && userId) {
    await createInventoryAuditLog(c, {
      tenantId,
      userId,
      action: "CREATE",
      eventType: "write_off",
      tableName: "InventoryWriteOff",
      recordId: Number(woId),
      reason: body.Reason || body.Remarks || null,
      before: null,
      after: {
        WriteOffId: Number(woId),
        WriteOffNo: nextWONo,
        StoreId: body.StoreId,
        Reason: body.Reason,
        IsApproved: 0,
        itemCount: body.Items.length,
      },
      whatChanged: {
        WriteOffId: Number(woId),
        WriteOffNo: nextWONo,
        StoreId: body.StoreId,
        IsApproved: 0,
        itemCount: body.Items.length,
      },
    });
  }

  return c.json({ message: "Write-off created", WriteOffId: woId, WriteOffNo: nextWONo }, 201);
});

// PUT /writeoff/:id/approve
writeoff.put("/:id/approve", zValidator("json", schemas.approveWriteOffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const woId = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  const today = new Date().toISOString();

  if (!body.IsApproved) {
    return c.json({ error: "Only approval supported via this endpoint" }, 400);
  }

  const wo = await db.$client.prepare(
    "SELECT * FROM InventoryWriteOff WHERE WriteOffId = ? AND tenant_id = ?"
  ).bind(woId, tenantId).first<any>();
  if (!wo) return c.json({ error: "Write-off not found" }, 404);
  if (wo.IsApproved) return c.json({ error: "Already approved" }, 400);

  const items = await db.$client.prepare(
    "SELECT * FROM InventoryWriteOffItem WHERE WriteOffId = ?"
  ).bind(woId).all<any>();

  let totalWriteOffValue = 0;
  const batchOps: D1PreparedStatement[] = [];

  for (const item of items.results) {
    const stock = await db.$client.prepare(
      "SELECT AvailableQuantity, CostPrice FROM InventoryStock WHERE StockId = ? AND tenant_id = ?"
    ).bind(item.StockId, tenantId).first<{ AvailableQuantity: number; CostPrice: number }>();
    if (!stock || stock.AvailableQuantity < item.Quantity) {
      return c.json({ error: `Insufficient stock for write-off item ${item.ItemId}` }, 400);
    }
    const newBalance = stock.AvailableQuantity - item.Quantity;
    totalWriteOffValue += (stock.CostPrice || 0) * item.Quantity;

    // Deduct Stock (scoped)
    batchOps.push(db.$client.prepare(
      "UPDATE InventoryStock SET AvailableQuantity = AvailableQuantity - ? WHERE StockId = ? AND tenant_id = ?"
    ).bind(item.Quantity, item.StockId, tenantId));

    // Transaction
    batchOps.push(stockTransactionStatement(db, {
      tenantId: tenantId!,
      stockId: item.StockId,
      itemId: item.ItemId,
      storeId: wo.StoreId,
      transactionType: 'writeoff',
      referenceNo: wo.WriteOffNo,
      referenceId: Number(woId),
      outQuantity: item.Quantity,
      balanceQuantity: newBalance,
      transactionDate: today,
      remarks: item.Remarks || wo.Remarks || null,
      createdBy: userId ?? null,
    }));
  }

  // Update Header (scoped)
  batchOps.push(db.$client.prepare(
    "UPDATE InventoryWriteOff SET IsApproved = 1, ApprovedBy = ?, ApprovedOn = ? WHERE WriteOffId = ? AND tenant_id = ?"
  ).bind(userId ?? null, today, woId, tenantId));

  await db.$client.batch(batchOps);

  // Record accounting posting
  if (totalWriteOffValue > 0) {
    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'inventory_writeoff',
      sourceId: String(woId),
      eventType: ACCOUNTING_EVENT_TYPES.inventoryConsumption,
      eventDate: today,
      payload: {
        totalCost: totalWriteOffValue,
        reason: wo.Reason || 'Write-off',
      },
      createdBy: userId,
    });

    const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
      console.error('Failed to post inventory write-off accounting event:', error);
    });
    try {
      c.executionCtx.waitUntil(posting);
    } catch {
      void posting;
    }
  }

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "APPROVE",
    eventType: "write_off",
    tableName: "InventoryWriteOff",
    recordId: Number(woId),
    reason: body.Remarks || wo.Reason || wo.Remarks || null,
    before: {
      WriteOffId: Number(woId),
      WriteOffNo: wo.WriteOffNo,
      IsApproved: Boolean(wo.IsApproved),
    },
    after: {
      WriteOffId: Number(woId),
      WriteOffNo: wo.WriteOffNo,
      IsApproved: true,
      ApprovedBy: userId,
      totalWriteOffValue,
    },
    whatChanged: {
      WriteOffId: Number(woId),
      WriteOffNo: wo.WriteOffNo,
      isApprovedFrom: Boolean(wo.IsApproved),
      isApprovedTo: true,
      totalWriteOffValue,
    },
  });

  return c.json({ message: "Write-off approved and stock deducted" });
});

// PUT /writeoff/:id/reject
writeoff.put("/:id/reject", zValidator("json", schemas.rejectWriteOffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const woId = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  const wo = await db.$client.prepare(
    "SELECT * FROM InventoryWriteOff WHERE WriteOffId = ? AND tenant_id = ?"
  ).bind(woId, tenantId).first<any>();
  if (!wo) return c.json({ error: "Write-off not found" }, 404);
  if (wo.IsApproved === 1) return c.json({ error: "Cannot reject an already approved write-off" }, 400);
  if (wo.IsApproved === 2) return c.json({ error: "Already rejected" }, 400);

  const rejectionRemarks = body.Remarks
    ? (wo.Remarks ? `${wo.Remarks}\n[REJECTED] ${body.Remarks}` : `[REJECTED] ${body.Remarks}`)
    : (wo.Remarks ? `${wo.Remarks}\n[REJECTED]` : `[REJECTED]`);

  await db.$client.prepare(
    "UPDATE InventoryWriteOff SET IsApproved = 2, Remarks = ?, ApprovedBy = ?, ApprovedOn = ? WHERE WriteOffId = ? AND tenant_id = ?"
  ).bind(rejectionRemarks, userId, new Date().toISOString(), woId, tenantId).run();

  await createInventoryAuditLog(c, {
    tenantId,
    userId,
    action: "REJECT",
    eventType: "write_off",
    tableName: "InventoryWriteOff",
    recordId: Number(woId),
    reason: body.Remarks || null,
    before: {
      WriteOffId: Number(woId),
      WriteOffNo: wo.WriteOffNo,
      IsApproved: wo.IsApproved,
    },
    after: {
      WriteOffId: Number(woId),
      WriteOffNo: wo.WriteOffNo,
      IsApproved: 2,
      ApprovedBy: userId,
    },
    whatChanged: {
      WriteOffId: Number(woId),
      WriteOffNo: wo.WriteOffNo,
      isApprovedFrom: wo.IsApproved,
      isApprovedTo: 2,
      rejected: true,
    },
  });

  return c.json({ message: "Write-off rejected" });
});

export default writeoff;

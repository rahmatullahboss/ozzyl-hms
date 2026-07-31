import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { generateSequenceNo } from "../../../utils/sequence";
import { getDb } from '../../../db';


const req = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /req
req.get("/", zValidator("query", schemas.listRequisitionsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, RequestingStoreId, SourceStoreId, RequisitionStatus, Priority, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["R.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (RequestingStoreId) { conditions.push("R.RequestingStoreId = ?"); params.push(RequestingStoreId); }
  if (SourceStoreId) { conditions.push("R.SourceStoreId = ?"); params.push(SourceStoreId); }
  if (RequisitionStatus) { conditions.push("R.RequisitionStatus = ?"); params.push(RequisitionStatus); }
  if (Priority) { conditions.push("R.Priority = ?"); params.push(Priority); }
  if (FromDate) { conditions.push("R.RequisitionDate >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("R.RequisitionDate <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryRequisition R WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT R.*, S1.StoreName as RequestingStoreName, S2.StoreName as SourceStoreName
    FROM InventoryRequisition R
    JOIN InventoryStore S1 ON R.RequestingStoreId = S1.StoreId
    LEFT JOIN InventoryStore S2 ON R.SourceStoreId = S2.StoreId
    WHERE ${whereClause}
    ORDER BY R.RequisitionId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// GET /req/:id
req.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
  const tenantId = c.get("tenantId");

  const requisition = await db.$client.prepare(`
    SELECT R.*, S1.StoreName as RequestingStoreName, S2.StoreName as SourceStoreName
    FROM InventoryRequisition R
    LEFT JOIN InventoryStore S1 ON R.RequestingStoreId = S1.StoreId
    LEFT JOIN InventoryStore S2 ON R.SourceStoreId = S2.StoreId
    WHERE R.RequisitionId = ? AND R.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!requisition) return c.json({ error: "Requisition not found" }, 404);

  const { results: items } = await db.$client.prepare(`
    SELECT ri.*, i.ItemName FROM InventoryRequisitionItem ri
    LEFT JOIN InventoryItem i ON ri.ItemId = i.ItemId AND i.tenant_id = ?
    WHERE ri.RequisitionId = ?
  `).bind(tenantId, id).all();

  return c.json({ ...requisition, Items: items });
});

// POST /req
req.post("/", zValidator("json", schemas.createRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  const nextReqNo = await generateSequenceNo(c.env.DB, 'REQ', 'InventoryRequisition', 'RequisitionNo', tenantId);

  // Insert Header
  const result = await db.$client.prepare(`
    INSERT INTO InventoryRequisition (tenant_id, RequisitionNo, RequisitionDate, RequestingStoreId, SourceStoreId, DepartmentId, Priority, RequiredDate, Remarks, RequisitionStatus, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, nextReqNo, today, body.RequestingStoreId, body.SourceStoreId || null, body.DepartmentId || null,
    body.Priority, body.RequiredDate || null, body.Remarks || null, 'pending', userId ?? null, new Date().toISOString(),
  ).run();

  const reqId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];

  for (const item of body.Items) {
    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryRequisitionItem (RequisitionId, ItemId, RequestedQuantity, ApprovedQuantity, PendingQuantity, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reqId, item.ItemId, item.RequestedQuantity, 0, item.RequestedQuantity,
      item.Remarks || null, userId ?? null, new Date().toISOString(),
    ));
  }

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  return c.json({ message: "Requisition created", RequisitionId: reqId, RequisitionNo: nextReqNo }, 201);
});

// PUT /req/:id (Approve/Cancel)
req.put("/:id", zValidator("json", schemas.updateRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');

  const updates: string[] = [];
  const params: any[] = [];

  if (body.RequisitionStatus) {
    updates.push("RequisitionStatus = ?");
    params.push(body.RequisitionStatus);

    if (body.RequisitionStatus === 'cancelled') {
      updates.push("CancelledBy = ?", "CancelledOn = ?", "CancelRemarks = ?");
      params.push(userId ?? null, new Date().toISOString(), body.CancelRemarks || null);
    }
  }

  if (updates.length > 0) {
    params.push(id, tenantId);
    await db.$client.prepare(
      `UPDATE InventoryRequisition SET ${updates.join(", ")} WHERE RequisitionId = ? AND tenant_id = ?`
    ).bind(...params).run();
  }

  return c.json({ message: "Requisition updated" });
});

// PUT /req/:id/items/:itemId/approve
req.put("/:id/items/:itemId/approve", zValidator("json", schemas.approveRequisitionItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const reqId = parseInt(c.req.param("id"));
  const itemId = parseInt(c.req.param("itemId"));
  if (isNaN(reqId) || isNaN(itemId)) return c.json({ error: "Invalid ID" }, 400);
  const tenantId = c.get("tenantId");
  const body = c.req.valid("json");

  // Validate approved quantity does not exceed requested quantity
  const reqItem = await db.$client.prepare(
    `SELECT RI.RequestedQuantity
     FROM InventoryRequisitionItem RI
     JOIN InventoryRequisition R ON RI.RequisitionId = R.RequisitionId
     WHERE RI.RequisitionItemId = ? AND RI.RequisitionId = ? AND R.tenant_id = ?`
  ).bind(itemId, reqId, tenantId).first<{ RequestedQuantity: number }>();
  if (!reqItem) throw new HTTPException(404, { message: 'Requisition item not found' });
  if (body.ApprovedQuantity > reqItem.RequestedQuantity) {
    throw new HTTPException(400, { message: `Approved quantity (${body.ApprovedQuantity}) exceeds requested quantity (${reqItem.RequestedQuantity})` });
  }

  await db.$client.prepare(`
    UPDATE InventoryRequisitionItem
    SET ApprovedQuantity = ?, PendingQuantity = ?
    WHERE RequisitionItemId = ? AND RequisitionId = ?
  `).bind(body.ApprovedQuantity, body.ApprovedQuantity, itemId, reqId).run();

  return c.json({ message: "Item approved" });
});

export default req;

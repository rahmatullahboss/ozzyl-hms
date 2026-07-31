import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { getDb } from "../../../db";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { logApproval } from "./helpers";

type Variables = { tenantId?: string; userId?: string; role?: string };

const purchaseRequests = new Hono<{ Bindings: Env; Variables: Variables }>();

const itemSchema = z.object({
  ItemId: z.number().int().positive().optional(),
  ItemName: z.string().max(200).optional(),
  Quantity: z.number().int().positive(),
  EstimatedRate: z.number().min(0).optional(),
  Remarks: z.string().max(500).optional(),
});

const createSchema = z.object({
  RequestingStoreId: z.number().int().positive().optional(),
  DepartmentId: z.number().int().positive().optional(),
  Department: z.string().max(120).optional(),
  Priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  RequiredDate: z.string().optional(),
  Remarks: z.string().max(1000).optional(),
  Submit: z.boolean().default(false),
  Items: z.array(itemSchema).min(1),
});

function prNumber(seq: number): string {
  return `PR-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
}

purchaseRequests.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, storeId, search, page = "1", limit = "50" } = c.req.query();
  const params: (string | number)[] = [tenantId];
  const conditions = ["PR.tenant_id = ?"];

  if (status) {
    conditions.push("PR.Status = ?");
    params.push(status);
  }
  if (storeId) {
    conditions.push("PR.RequestingStoreId = ?");
    params.push(Number(storeId));
  }
  if (search) {
    conditions.push("(PR.PRNumber LIKE ? OR PR.Department LIKE ? OR S.StoreName LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const pageNo = Math.max(1, Number(page));
  const pageSize = Math.min(100, Math.max(1, Number(limit)));
  const where = conditions.join(" AND ");
  const count = await db.$client.prepare(`SELECT COUNT(*) as total FROM InventoryPurchaseRequest PR LEFT JOIN InventoryStore S ON S.StoreId = PR.RequestingStoreId AND S.tenant_id = PR.tenant_id WHERE ${where}`)
    .bind(...params).first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT PR.*, S.StoreName
    FROM InventoryPurchaseRequest PR
    LEFT JOIN InventoryStore S ON S.StoreId = PR.RequestingStoreId AND S.tenant_id = PR.tenant_id
    WHERE ${where}
    ORDER BY PR.CreatedOn DESC
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, (pageNo - 1) * pageSize).all();

  return c.json({ data: rows.results, pagination: { page: pageNo, limit: pageSize, total: count?.total || 0 } });
});

purchaseRequests.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param("id"));
  const pr = await db.$client.prepare(`
    SELECT PR.*, S.StoreName
    FROM InventoryPurchaseRequest PR
    LEFT JOIN InventoryStore S ON S.StoreId = PR.RequestingStoreId AND S.tenant_id = PR.tenant_id
    WHERE PR.tenant_id = ? AND PR.PurchaseRequestId = ?
  `).bind(tenantId, id).first();
  if (!pr) return c.json({ error: "Purchase request not found" }, 404);

  const items = await db.$client.prepare(`
    SELECT PRI.*, I.ItemName as MasterItemName, I.ItemCode
    FROM InventoryPurchaseRequestItem PRI
    LEFT JOIN InventoryItem I ON I.ItemId = PRI.ItemId
    WHERE PRI.PurchaseRequestId = ?
    ORDER BY PRI.PurchaseRequestItemId
  `).bind(id).all();
  return c.json({ ...pr, Items: items.results });
});

purchaseRequests.post("/", zValidator("json", createSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const now = new Date().toISOString();
  const count = await db.$client.prepare("SELECT COUNT(*) as cnt FROM InventoryPurchaseRequest WHERE tenant_id = ?")
    .bind(tenantId).first<{ cnt: number }>();
  const status = body.Submit ? "submitted" : "draft";
  const result = await db.$client.prepare(`
    INSERT INTO InventoryPurchaseRequest
      (tenant_id, PRNumber, PRDate, RequestingStoreId, DepartmentId, Department, RequestedBy, Priority,
       RequiredDate, Status, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    prNumber((count?.cnt || 0) + 1),
    now.slice(0, 10),
    body.RequestingStoreId || null,
    body.DepartmentId || null,
    body.Department || null,
    userId,
    body.Priority,
    body.RequiredDate || null,
    status,
    body.Remarks || null,
    userId,
    now,
  ).run();

  const prId = Number(result.meta.last_row_id);
  for (const item of body.Items) {
    let itemName = item.ItemName || null;
    if (!itemName && item.ItemId) {
      const master = await db.$client.prepare("SELECT ItemName FROM InventoryItem WHERE tenant_id = ? AND ItemId = ?")
        .bind(tenantId, item.ItemId).first<{ ItemName: string }>();
      itemName = master?.ItemName || null;
    }
    await db.$client.prepare(`
      INSERT INTO InventoryPurchaseRequestItem
        (PurchaseRequestId, ItemId, ItemName, Quantity, ApprovedQuantity, EstimatedRate, EstimatedAmount, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).bind(
      prId,
      item.ItemId || null,
      itemName,
      item.Quantity,
      item.EstimatedRate || 0,
      item.Quantity * (item.EstimatedRate || 0),
      item.Remarks || null,
      userId,
      now,
    ).run();
  }

  await logApproval(db, { tenantId, entityType: "purchase_request", entityId: prId, action: "create", toStatus: status, performedBy: userId });
  return c.json({ message: "Purchase request created", id: prId }, 201);
});

purchaseRequests.patch("/:id/status", zValidator("json", z.object({
  Status: z.enum(["submitted", "approved", "rejected", "converted", "cancelled"]),
  ApprovalRemarks: z.string().max(1000).optional(),
  Items: z.array(z.object({
    PurchaseRequestItemId: z.number().int().positive(),
    ApprovedQuantity: z.number().int().min(0),
  })).optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param("id"));
  const body = c.req.valid("json");
  const existing = await db.$client.prepare("SELECT Status FROM InventoryPurchaseRequest WHERE tenant_id = ? AND PurchaseRequestId = ?")
    .bind(tenantId, id).first<{ Status: string }>();
  if (!existing) return c.json({ error: "Purchase request not found" }, 404);
  if (["converted", "cancelled", "rejected"].includes(existing.Status) && existing.Status !== body.Status) {
    return c.json({ error: "Finalized purchase request cannot be changed" }, 400);
  }

  if (body.Items) {
    for (const item of body.Items) {
      await db.$client.prepare(`
        UPDATE InventoryPurchaseRequestItem
        SET ApprovedQuantity = ?
        WHERE PurchaseRequestItemId = ? AND PurchaseRequestId = ?
      `).bind(item.ApprovedQuantity, item.PurchaseRequestItemId, id).run();
    }
  }

  await db.$client.prepare(`
    UPDATE InventoryPurchaseRequest
    SET Status = ?, ApprovedBy = CASE WHEN ? = 'approved' THEN ? ELSE ApprovedBy END,
        ApprovedOn = CASE WHEN ? = 'approved' THEN ? ELSE ApprovedOn END,
        ApprovalRemarks = ?, ModifiedBy = ?, ModifiedOn = ?
    WHERE tenant_id = ? AND PurchaseRequestId = ?
  `).bind(
    body.Status,
    body.Status,
    userId,
    body.Status,
    new Date().toISOString(),
    body.ApprovalRemarks || null,
    userId,
    new Date().toISOString(),
    tenantId,
    id,
  ).run();

  await logApproval(db, {
    tenantId,
    entityType: "purchase_request",
    entityId: id,
    action: body.Status,
    fromStatus: existing.Status,
    toStatus: body.Status,
    remarks: body.ApprovalRemarks || null,
    performedBy: userId,
  });

  return c.json({ message: "Purchase request status updated" });
});

export default purchaseRequests;

import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { getDb } from '../../../db';


const stores = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /stores
stores.get("/", zValidator("query", schemas.listStoresSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, search, StoreType } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(StoreName LIKE ? OR StoreCode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (StoreType) {
    conditions.push("StoreType = ?");
    params.push(StoreType);
  }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryStore WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryStore WHERE ${whereClause} LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({
    data: results.results,
    pagination: { page, limit, total: count?.total || 0 },
  });
});

// POST /stores
stores.post("/", zValidator("json", schemas.createStoreSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryStore (tenant_id, StoreName, StoreCode, StoreType, Address, ContactPerson, ContactPhone, ParentStoreId, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    body.StoreName, body.StoreCode || null, body.StoreType,
    body.Address || null, body.ContactPerson || null, body.ContactPhone || null,
    body.ParentStoreId || null, body.IsActive ? 1 : 0,
    userId ?? null, today,
  ).run();

  return c.json({ message: "Store created", id: result.meta.last_row_id }, 201);
});

export default stores;

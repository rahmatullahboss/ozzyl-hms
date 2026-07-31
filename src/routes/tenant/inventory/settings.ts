import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { getDb } from '../../../db';


const settings = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// ==========================================
// CATEGORIES
// ==========================================
settings.get("/categories", zValidator("query", schemas.listCategoriesSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, search } = c.req.valid("query");
  const offset = (page - 1) * limit;
  const tenantId = c.get('tenantId');

  const conditions: string[] = ["tenant_id = ?", "IsActive = 1"];
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(CategoryName LIKE ? OR CategoryCode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryItemCategory WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryItemCategory WHERE ${whereClause} LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

settings.post("/categories", zValidator("json", schemas.createCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryItemCategory (tenant_id, CategoryName, CategoryCode, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, body.CategoryName, body.CategoryCode || null, body.Description || null, body.IsActive ? 1 : 0, userId ?? null, today).run();

  return c.json({ message: "Category created", id: result.meta.last_row_id }, 201);
});

// ==========================================
// SUB-CATEGORIES
// ==========================================
settings.get("/subcategories", zValidator("query", schemas.listSubCategoriesSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, search, ItemCategoryId } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["tenant_id = ?", "IsActive = 1"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(SubCategoryName LIKE ? OR SubCategoryCode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (ItemCategoryId) {
    conditions.push("ItemCategoryId = ?");
    params.push(ItemCategoryId);
  }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryItemSubCategory WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryItemSubCategory WHERE ${whereClause} LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

settings.post("/subcategories", zValidator("json", schemas.createSubCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryItemSubCategory (tenant_id, ItemCategoryId, SubCategoryName, SubCategoryCode, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, body.ItemCategoryId, body.SubCategoryName, body.SubCategoryCode || null, body.Description || null, body.IsActive ? 1 : 0, userId ?? null, today).run();

  return c.json({ message: "SubCategory created", id: result.meta.last_row_id }, 201);
});

// ==========================================
// UOM (Unit of Measurement)
// ==========================================
settings.get("/uom", zValidator("query", schemas.listUOMSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, search } = c.req.valid("query");
  const offset = (page - 1) * limit;
  const tenantId = c.get('tenantId');

  const conditions: string[] = ["tenant_id = ?", "IsActive = 1"];
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(UOMName LIKE ?)");
    params.push(`%${search}%`);
  }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryUnitOfMeasurement WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryUnitOfMeasurement WHERE ${whereClause} LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

settings.post("/uom", zValidator("json", schemas.createUOMSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryUnitOfMeasurement (tenant_id, UOMName, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, body.UOMName, body.Description || null, body.IsActive ? 1 : 0, userId ?? null, today).run();

  return c.json({ message: "UOM created", id: result.meta.last_row_id }, 201);
});

export default settings;

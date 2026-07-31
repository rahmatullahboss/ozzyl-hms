import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { getDb } from '../../../db';
import { createAuditLog } from '../../../lib/accounting-helpers';
import { seedInventoryVendorDefaults } from '../../../lib/inventory-vendor-defaults';


const vendors = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /vendors
vendors.get("/", zValidator("query", schemas.listVendorsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const { page, limit, search, IsActive } = query;
  const offset = (page - 1) * limit;

  const conditions: string[] = ["tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(VendorName LIKE ? OR VendorCode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (IsActive) {
    conditions.push("IsActive = ?");
    params.push(IsActive === "true" ? 1 : 0);
  }

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryVendor WHERE ${conditions.join(" AND ")}`
  ).bind(...params).first<{ total: number }>();
  const total = countResult?.total || 0;

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryVendor WHERE ${conditions.join(" AND ")} ORDER BY VendorName ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total } });
});

// POST /vendors/defaults/seed — Load professional starter suppliers for the current tenant
vendors.post("/defaults/seed", async (c) => {
  const tenantId = c.get("tenantId");
  if (!tenantId) return c.json({ error: "Tenant context is required" }, 400);

  const summary = await seedInventoryVendorDefaults(c.env.DB, tenantId);
  const userId = c.get("userId") ?? "system";
  void createAuditLog(c.env, String(tenantId), String(userId), "CREATE", "inventory_vendor_defaults", 0, null, summary);
  return c.json({ message: "Default inventory vendors loaded", summary });
});

// POST /vendors
vendors.post("/", zValidator("json", schemas.createVendorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryVendor (tenant_id, VendorName, VendorCode, ContactPerson, ContactPhone, ContactEmail, ContactAddress, City, Country, PANNo, CreditPeriod, IsActive, IsTDSApplicable, TDSPercent, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    body.VendorName, body.VendorCode || null, body.ContactPerson || null,
    body.ContactPhone || null, body.ContactEmail || null, body.ContactAddress || null,
    body.City || null, body.Country || null, body.PANNo || null,
    body.CreditPeriod, body.IsActive ? 1 : 0, body.IsTDSApplicable ? 1 : 0,
    body.TDSPercent, userId ?? null, today
  ).run();

  return c.json({ message: "Vendor created", id: result.meta.last_row_id }, 201);
});

// PUT /vendors/:id — Explicit column allowlist (no dynamic key injection)
const VENDOR_UPDATABLE_COLUMNS = [
  'VendorName', 'VendorCode', 'ContactPerson', 'ContactPhone', 'ContactEmail',
  'ContactAddress', 'City', 'Country', 'PANNo', 'CreditPeriod',
  'IsActive', 'IsTDSApplicable', 'TDSPercent',
] as const;

vendors.put("/:id", zValidator("json", schemas.updateVendorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');

  const updates: string[] = [];
  const params: any[] = [];

  for (const col of VENDOR_UPDATABLE_COLUMNS) {
    if ((body as any)[col] !== undefined) {
      let val = (body as any)[col];
      if (typeof val === 'boolean') val = val ? 1 : 0;
      updates.push(`${col} = ?`);
      params.push(val);
    }
  }

  if (updates.length > 0) {
    params.push(id, tenantId);
    await db.$client.prepare(
      `UPDATE InventoryVendor SET ${updates.join(", ")} WHERE VendorId = ? AND tenant_id = ?`
    ).bind(...params).run();
  }

  return c.json({ message: "Vendor updated" });
});

export default vendors;

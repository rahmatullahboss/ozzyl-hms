import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { getDb } from '../../../db';
import { HTTPException } from "hono/http-exception";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";

const donations = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /donations
donations.get("/", zValidator("query", schemas.listDonationsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const { page, limit, search, FromDate, ToDate } = query;
  const offset = (page - 1) * limit;

  const conditions: string[] = ["tenant_id = ?"];
  const tenantId = requireTenantId(c);
  const params: any[] = [tenantId];

  if (search) {
    conditions.push("(DonationName LIKE ? OR DonorName LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (FromDate) {
    conditions.push("DonationDate >= ?");
    params.push(FromDate);
  }

  if (ToDate) {
    conditions.push("DonationDate <= ?");
    params.push(ToDate);
  }

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryFixedAssetDonation WHERE ${conditions.join(" AND ")}`
  ).bind(...params).first<{ total: number }>();
  const total = countResult?.total || 0;

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryFixedAssetDonation WHERE ${conditions.join(" AND ")} ORDER BY DonationDate DESC, DonationId DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total } });
});

// GET /donations/:id
donations.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const tenantId = requireTenantId(c);

  const donation = await db.$client.prepare(
    `SELECT * FROM InventoryFixedAssetDonation WHERE DonationId = ? AND tenant_id = ?`
  ).bind(id, tenantId).first();

  if (!donation) {
    throw new HTTPException(404, { message: "Donation not found" });
  }

  return c.json(donation);
});

// POST /donations
donations.post("/", zValidator("json", schemas.createDonationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const today = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryFixedAssetDonation (tenant_id, DonationName, DonorName, DonationDate, TotalValue, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    body.DonationName,
    body.DonorName || null,
    body.DonationDate || null,
    body.TotalValue,
    body.Remarks || null,
    userId ?? null,
    today
  ).run();

  return c.json({ message: "Donation created", id: result.meta.last_row_id }, 201);
});

// PUT /donations/:id
const DONATION_UPDATABLE_COLUMNS = [
  'DonationName', 'DonorName', 'DonationDate', 'TotalValue', 'Remarks',
] as const;

donations.put("/:id", zValidator("json", schemas.updateDonationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const updates: string[] = [];
  const params: any[] = [];

  for (const col of DONATION_UPDATABLE_COLUMNS) {
    if ((body as any)[col] !== undefined) {
      updates.push(`${col} = ?`);
      params.push((body as any)[col]);
    }
  }

  if (updates.length > 0) {
    params.push(id, tenantId);
    await db.$client.prepare(
      `UPDATE InventoryFixedAssetDonation SET ${updates.join(", ")} WHERE DonationId = ? AND tenant_id = ?`
    ).bind(...params).run();
  }

  return c.json({ message: "Donation updated" });
});

// DELETE /donations/:id
donations.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const existing = await db.$client.prepare(
    `SELECT DonationId FROM InventoryFixedAssetDonation WHERE DonationId = ? AND tenant_id = ?`
  ).bind(id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: "Donation not found" });
  }

  await db.$client.prepare(
    `DELETE FROM InventoryFixedAssetDonation WHERE DonationId = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();

  return c.json({ message: "Donation deleted" });
});

export default donations;

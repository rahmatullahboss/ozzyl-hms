import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";

type Variables = { tenantId?: string; userId?: string; role?: string };

const reservations = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ────────────────────────────────────────────────────────────────

const createReservationSchema = z.object({
  StockId: z.number().int().positive(),
  ItemId: z.number().int().positive(),
  StoreId: z.number().int().positive(),
  Quantity: z.number().int().positive(),
  ReservedForType: z.enum(["patient", "department", "surgery", "order"]),
  ReservedForId: z.string().max(100).optional(),
  ExpiresAt: z.string().min(1).refine((val) => new Date(val) > new Date(), {
    message: "ExpiresAt must be in the future",
  }),
  Remarks: z.string().max(1000).optional(),
});

const listReservationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
  Status: z.string().optional(),
  ItemId: z.coerce.number().int().positive().optional(),
  StoreId: z.coerce.number().int().positive().optional(),
  ReservedForType: z.string().optional(),
});

const releaseSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

const fulfillSchema = z.object({
  Remarks: z.string().max(1000).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// POST /reservations — create reservation
reservations.post("/", zValidator("json", createReservationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");

  const now = nowIso();

  // Create reservation record
  const insertResult = await db.$client.prepare(`
    INSERT INTO InventoryStockReservation
      (tenant_id, StockId, ItemId, StoreId, Quantity, ReservedForType, ReservedForId,
       ReservedBy, Status, ExpiresAt, Remarks, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    tenantId,
    body.StockId,
    body.ItemId,
    body.StoreId,
    body.Quantity,
    body.ReservedForType,
    body.ReservedForId || null,
    userId,
    body.ExpiresAt,
    body.Remarks || null,
    now,
  ).run();

  const reservationId = Number(insertResult.meta.last_row_id);

  // Atomically decrement available and increment reserved, checking sufficient stock
  const stockUpdate = await db.$client.prepare(`
    UPDATE InventoryStock
    SET AvailableQuantity = AvailableQuantity - ?,
        ReservedQuantity = COALESCE(ReservedQuantity, 0) + ?,
        ModifiedBy = ?, ModifiedOn = ?
    WHERE tenant_id = ? AND StockId = ?
      AND (AvailableQuantity - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0)) >= ?
  `).bind(body.Quantity, body.Quantity, userId, now, tenantId, body.StockId, body.Quantity).run();

  if (stockUpdate.meta.changes === 0) {
    throw new HTTPException(404, { message: "Stock not found or insufficient usable stock" });
  }

  return c.json({
    ReservationId: reservationId,
    Status: "active",
    Quantity: body.Quantity,
    ExpiresAt: body.ExpiresAt,
  }, 201);
});

// GET /reservations — list reservations with filters
reservations.get("/", zValidator("query", listReservationsSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const query = c.req.valid("query");
  const offset = (query.page - 1) * query.limit;

  const conditions = ["R.tenant_id = ?"];
  const params: unknown[] = [tenantId];

  if (query.Status) {
    conditions.push("R.Status = ?");
    params.push(query.Status);
  }
  if (query.ItemId) {
    conditions.push("R.ItemId = ?");
    params.push(query.ItemId);
  }
  if (query.StoreId) {
    conditions.push("R.StoreId = ?");
    params.push(query.StoreId);
  }
  if (query.ReservedForType) {
    conditions.push("R.ReservedForType = ?");
    params.push(query.ReservedForType);
  }

  const where = conditions.join(" AND ");

  const count = await db.$client.prepare(
    `SELECT COUNT(*) AS total FROM InventoryStockReservation R WHERE ${where}`,
  ).bind(...params).first<{ total: number }>();

  const rows = await db.$client.prepare(`
    SELECT R.*, I.ItemName, S.StoreName
    FROM InventoryStockReservation R
    LEFT JOIN InventoryItem I ON I.ItemId = R.ItemId AND I.tenant_id = R.tenant_id
    LEFT JOIN InventoryStore S ON S.StoreId = R.StoreId AND S.tenant_id = R.tenant_id
    WHERE ${where}
    ORDER BY R.ReservationId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();

  return c.json({
    data: rows.results || [],
    pagination: { page: query.page, limit: query.limit, total: count?.total || 0 },
  });
});

// GET /reservations/stats — summary counts by status
reservations.get("/stats", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const rows = await db.$client.prepare(`
    SELECT Status, COUNT(*) AS count
    FROM InventoryStockReservation
    WHERE tenant_id = ?
    GROUP BY Status
  `).bind(tenantId).all<{ Status: string; count: number }>();

  const stats: Record<string, number> = {
    active: 0,
    fulfilled: 0,
    cancelled: 0,
    expired: 0,
  };

  for (const row of rows.results || []) {
    stats[row.Status] = Number(row.count);
  }

  return c.json(stats);
});

// GET /reservations/:id — single reservation detail
reservations.get("/:id", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const reservationId = Number(c.req.param("id"));

  const reservation = await db.$client.prepare(`
    SELECT R.*, I.ItemName, S.StoreName
    FROM InventoryStockReservation R
    LEFT JOIN InventoryItem I ON I.ItemId = R.ItemId AND I.tenant_id = R.tenant_id
    LEFT JOIN InventoryStore S ON S.StoreId = R.StoreId AND S.tenant_id = R.tenant_id
    WHERE R.tenant_id = ? AND R.ReservationId = ?
  `).bind(tenantId, reservationId).first<any>();

  if (!reservation) {
    throw new HTTPException(404, { message: "Reservation not found" });
  }

  return c.json(reservation);
});

// POST /reservations/:id/release — release reservation (reverse qty changes)
reservations.post("/:id/release", zValidator("json", releaseSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const reservationId = Number(c.req.param("id"));
  const body = c.req.valid("json");

  const reservation = await db.$client.prepare(
    "SELECT * FROM InventoryStockReservation WHERE tenant_id = ? AND ReservationId = ?",
  ).bind(tenantId, reservationId).first<any>();

  if (!reservation) {
    throw new HTTPException(404, { message: "Reservation not found" });
  }

  if (reservation.Status !== "active") {
    throw new HTTPException(400, { message: "Only active reservations can be released" });
  }

  const now = nowIso();
  const quantity = Number(reservation.Quantity);
  const stockId = Number(reservation.StockId);

  // Atomic stock reversal — uses the reservation's own Quantity (not request body)
  // to prevent stock inflation if AvailableQuantity was independently modified.
  await db.$client.prepare(`
    UPDATE InventoryStock
    SET AvailableQuantity = AvailableQuantity + ?,
        ReservedQuantity = MAX(0, ReservedQuantity - ?),
        ModifiedBy = ?,
        ModifiedOn = ?
    WHERE tenant_id = ? AND StockId = ?
  `).bind(quantity, quantity, userId, now, tenantId, stockId).run();

  // Update reservation status
  await db.$client.prepare(`
    UPDATE InventoryStockReservation
    SET Status = 'cancelled', CancelledAt = ?, Remarks = COALESCE(Remarks, '') || ?
    WHERE tenant_id = ? AND ReservationId = ?
  `).bind(now, body.Remarks ? `\nReleased: ${body.Remarks}` : "", tenantId, reservationId).run();

  return c.json({
    ReservationId: reservationId,
    Status: "cancelled",
    Quantity: quantity,
  });
});

// POST /reservations/:id/fulfill — mark as fulfilled
reservations.post("/:id/fulfill", zValidator("json", fulfillSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const reservationId = Number(c.req.param("id"));
  const body = c.req.valid("json");

  const reservation = await db.$client.prepare(
    "SELECT * FROM InventoryStockReservation WHERE tenant_id = ? AND ReservationId = ?",
  ).bind(tenantId, reservationId).first<any>();

  if (!reservation) {
    throw new HTTPException(404, { message: "Reservation not found" });
  }

  if (reservation.Status !== "active") {
    throw new HTTPException(400, { message: "Only active reservations can be fulfilled" });
  }

  const now = nowIso();

  // Update reservation status — stock stays as-is (actual issue/dispatch handles qty)
  await db.$client.prepare(`
    UPDATE InventoryStockReservation
    SET Status = 'fulfilled', FulfilledAt = ?, Remarks = COALESCE(Remarks, '') || ?
    WHERE tenant_id = ? AND ReservationId = ?
  `).bind(now, body.Remarks ? `\nFulfilled: ${body.Remarks}` : "", tenantId, reservationId).run();

  return c.json({
    ReservationId: reservationId,
    Status: "fulfilled",
    Quantity: Number(reservation.Quantity),
  });
});

// POST /reservations/expire-check — expire all past-due active reservations
reservations.post("/expire-check", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const now = nowIso();

  // Find all expired active reservations
  const expiredRows = await db.$client.prepare(`
    SELECT ReservationId, StockId, Quantity
    FROM InventoryStockReservation
    WHERE tenant_id = ? AND Status = 'active' AND ExpiresAt < ?
  `).bind(tenantId, now).all<{ ReservationId: number; StockId: number; Quantity: number }>();

  const expired = expiredRows.results || [];
  let expiredCount = 0;

  for (const row of expired) {
    const stockId = Number(row.StockId);
    const quantity = Number(row.Quantity);

    // Atomically reverse stock
    await db.$client.prepare(`
      UPDATE InventoryStock
      SET AvailableQuantity = AvailableQuantity + ?,
          ReservedQuantity = MAX(0, ReservedQuantity - ?),
          ModifiedBy = 'system', ModifiedOn = ?
      WHERE tenant_id = ? AND StockId = ?
    `).bind(quantity, quantity, now, tenantId, stockId).run();

    // Mark reservation as expired
    await db.$client.prepare(`
      UPDATE InventoryStockReservation
      SET Status = 'expired', Remarks = COALESCE(Remarks, '') || '\nAuto-expired'
      WHERE tenant_id = ? AND ReservationId = ?
    `).bind(tenantId, Number(row.ReservationId)).run();

    expiredCount++;
  }

  return c.json({ expired: expiredCount });
});

export default reservations;

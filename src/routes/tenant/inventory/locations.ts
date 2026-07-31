import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { getDb } from "../../../db";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { makeInventoryQrCode, upsertQrTag } from "./helpers";

type Variables = { tenantId?: string; userId?: string; role?: string };

const locations = new Hono<{ Bindings: Env; Variables: Variables }>();

const locationSchema = z.object({
  LocationCode: z.string().min(1).max(80),
  LocationName: z.string().min(1).max(160),
  LocationType: z.enum(["hospital", "building", "floor", "ward", "room", "bed", "store", "rack", "department", "other"]).default("room"),
  ParentLocationId: z.number().int().positive().optional(),
  StoreId: z.number().int().positive().optional(),
  WardId: z.number().int().positive().optional(),
  WardName: z.string().max(120).optional(),
  RoomNo: z.string().max(80).optional(),
  BedId: z.number().int().positive().optional(),
  Floor: z.string().max(80).optional(),
  Department: z.string().max(120).optional(),
  IsActive: z.boolean().default(true),
});

locations.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { search, type, wardId, storeId, parentId, active = "true", page = "1", limit = "100" } = c.req.query();
  const params: (string | number)[] = [tenantId];
  const conditions = ["tenant_id = ?"];

  if (search) {
    conditions.push("(LocationCode LIKE ? OR LocationName LIKE ? OR WardName LIKE ? OR RoomNo LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type) {
    conditions.push("LocationType = ?");
    params.push(type);
  }
  if (wardId) {
    conditions.push("WardId = ?");
    params.push(Number(wardId));
  }
  if (storeId) {
    conditions.push("StoreId = ?");
    params.push(Number(storeId));
  }
  if (parentId) {
    conditions.push("ParentLocationId = ?");
    params.push(Number(parentId));
  }
  if (active !== "all") {
    conditions.push("IsActive = ?");
    params.push(active === "false" ? 0 : 1);
  }

  const pageNo = Math.max(1, Number(page));
  const pageSize = Math.min(200, Math.max(1, Number(limit)));
  const where = conditions.join(" AND ");

  const count = await db.$client.prepare(`SELECT COUNT(*) as total FROM InventoryLocation WHERE ${where}`)
    .bind(...params).first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT L.*, P.LocationName as ParentLocationName, S.StoreName
    FROM InventoryLocation L
    LEFT JOIN InventoryLocation P ON P.LocationId = L.ParentLocationId AND P.tenant_id = L.tenant_id
    LEFT JOIN InventoryStore S ON S.StoreId = L.StoreId AND S.tenant_id = L.tenant_id
    WHERE ${where}
    ORDER BY COALESCE(L.WardName, ''), COALESCE(L.RoomNo, ''), L.LocationName
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, (pageNo - 1) * pageSize).all();

  return c.json({ data: rows.results, pagination: { page: pageNo, limit: pageSize, total: count?.total || 0 } });
});

locations.post("/", zValidator("json", locationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO InventoryLocation
      (tenant_id, LocationCode, LocationName, LocationType, ParentLocationId, StoreId, WardId, WardName,
       RoomNo, BedId, Floor, Department, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    body.LocationCode,
    body.LocationName,
    body.LocationType,
    body.ParentLocationId || null,
    body.StoreId || null,
    body.WardId || null,
    body.WardName || null,
    body.RoomNo || null,
    body.BedId || null,
    body.Floor || null,
    body.Department || null,
    body.IsActive ? 1 : 0,
    userId,
    now,
  ).run();

  const locationId = Number(result.meta.last_row_id);
  const tagCode = makeInventoryQrCode(tenantId, "location", locationId, body.LocationCode);
  await upsertQrTag(db, {
    tenantId,
    tagCode,
    entityType: "location",
    entityId: locationId,
    humanLabel: body.LocationName,
    createdBy: userId,
    payload: {
      system: "hms",
      entityType: "location",
      entityId: locationId,
      locationCode: body.LocationCode,
      locationName: body.LocationName,
      locationType: body.LocationType,
      wardId: body.WardId || null,
      roomNo: body.RoomNo || null,
    },
  });

  return c.json({ message: "Location created", id: locationId, tagCode }, 201);
});

locations.put("/:id", zValidator("json", locationSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: "Invalid location ID" }, 400);
  const body = c.req.valid("json");
  const allow = ["LocationCode", "LocationName", "LocationType", "ParentLocationId", "StoreId", "WardId", "WardName", "RoomNo", "BedId", "Floor", "Department", "IsActive"] as const;
  const updates: string[] = [];
  const params: unknown[] = [];

  for (const key of allow) {
    if ((body as any)[key] !== undefined) {
      updates.push(`${key} = ?`);
      const value = (body as any)[key];
      params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
  }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);
  updates.push("ModifiedBy = ?", "ModifiedOn = ?");
  params.push(userId, new Date().toISOString(), id, tenantId);

  const result = await db.$client.prepare(`UPDATE InventoryLocation SET ${updates.join(", ")} WHERE LocationId = ? AND tenant_id = ?`)
    .bind(...params).run();
  if (result.meta.changes === 0) return c.json({ error: "Location not found" }, 404);
  return c.json({ message: "Location updated" });
});

locations.get("/:id/stock", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param("id"));
  const rows = await db.$client.prepare(`
    SELECT LS.*, I.ItemName, I.ItemCode, A.BarCodeNumber as AssetTag
    FROM ward_supply_location_stock LS
    LEFT JOIN InventoryItem I ON I.ItemId = LS.inventory_item_id AND I.tenant_id = LS.tenant_id
    LEFT JOIN InventoryFixedAssetStock A ON A.FixedAssetStockId = LS.fixed_asset_stock_id AND A.tenant_id = LS.tenant_id
    WHERE LS.tenant_id = ? AND LS.location_id = ?
    ORDER BY LS.item_name
  `).bind(tenantId, id).all();
  return c.json({ data: rows.results });
});

export default locations;

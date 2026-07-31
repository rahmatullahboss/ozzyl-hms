import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import QRCode from "qrcode";
import type { Env } from "../../../types";
import { getDb } from "../../../db";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { makeInventoryQrCode, normalizeQrCode, upsertQrTag } from "./helpers";
import { buildInventoryQrCodeValue } from "../../../lib/inventory-core";

type Variables = { tenantId?: string; userId?: string; role?: string };

const qr = new Hono<{ Bindings: Env; Variables: Variables }>();

const entityTypeSchema = z.enum([
  "item",
  "stock",
  "store",
  "location",
  "ward_stock",
  "fixed_asset",
  "purchase_order",
  "goods_receipt",
]);

const generateQrSchema = z.object({
  EntityType: entityTypeSchema,
  EntityId: z.number().int().positive(),
  TagCode: z.string().min(1).max(120).optional(),
  HumanLabel: z.string().max(200).optional(),
  Payload: z.record(z.string(), z.unknown()).optional(),
});

async function buildEntityPayload(db: ReturnType<typeof getDb>, tenantId: string, entityType: z.infer<typeof entityTypeSchema>, entityId: number) {
  if (entityType === "item") {
    return db.$client.prepare("SELECT ItemId, ItemName, ItemCode, IsFixedAsset FROM InventoryItem WHERE tenant_id = ? AND ItemId = ?")
      .bind(tenantId, entityId).first();
  }
  if (entityType === "stock") {
    return db.$client.prepare(`
      SELECT S.StockId, S.ItemId, S.StoreId, S.BatchNo, S.ExpiryDate, S.AvailableQuantity, I.ItemName, I.ItemCode, ST.StoreName
      FROM InventoryStock S
      LEFT JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE S.tenant_id = ? AND S.StockId = ?
    `).bind(tenantId, entityId).first();
  }
  if (entityType === "store") {
    return db.$client.prepare("SELECT StoreId, StoreName, StoreCode, StoreType FROM InventoryStore WHERE tenant_id = ? AND StoreId = ?")
      .bind(tenantId, entityId).first();
  }
  if (entityType === "location") {
    return db.$client.prepare("SELECT * FROM InventoryLocation WHERE tenant_id = ? AND LocationId = ?")
      .bind(tenantId, entityId).first();
  }
  if (entityType === "ward_stock") {
    return db.$client.prepare("SELECT * FROM ward_supply_location_stock WHERE tenant_id = ? AND id = ?")
      .bind(tenantId, entityId).first();
  }
  if (entityType === "fixed_asset") {
    return db.$client.prepare(`
      SELECT A.*, I.ItemName, I.ItemCode
      FROM InventoryFixedAssetStock A
      LEFT JOIN InventoryItem I ON I.ItemId = A.ItemId AND I.tenant_id = A.tenant_id
      WHERE A.tenant_id = ? AND A.FixedAssetStockId = ?
    `).bind(tenantId, entityId).first();
  }
  if (entityType === "purchase_order") {
    return db.$client.prepare("SELECT PurchaseOrderId, PONumber, PODate, POStatus, TotalAmount FROM InventoryPurchaseOrder WHERE tenant_id = ? AND PurchaseOrderId = ?")
      .bind(tenantId, entityId).first();
  }
  return db.$client.prepare("SELECT GoodsReceiptId, GRNumber, GRDate, TotalAmount FROM InventoryGoodsReceipt WHERE tenant_id = ? AND GoodsReceiptId = ?")
    .bind(tenantId, entityId).first();
}

qr.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { entityType, entityId, status = "active", page = "1", limit = "50" } = c.req.query();
  const params: (string | number)[] = [tenantId];
  const conditions = ["tenant_id = ?"];

  if (entityType) {
    conditions.push("EntityType = ?");
    params.push(entityType);
  }
  if (entityId) {
    conditions.push("EntityId = ?");
    params.push(Number(entityId));
  }
  if (status) {
    conditions.push("Status = ?");
    params.push(status);
  }

  const pageNo = Math.max(1, Number(page));
  const pageSize = Math.min(100, Math.max(1, Number(limit)));
  const where = conditions.join(" AND ");
  const count = await db.$client.prepare(`SELECT COUNT(*) as total FROM InventoryQrTag WHERE ${where}`).bind(...params).first<{ total: number }>();
  const rows = await db.$client.prepare(`
    SELECT * FROM InventoryQrTag
    WHERE ${where}
    ORDER BY CreatedOn DESC
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, (pageNo - 1) * pageSize).all();

  return c.json({ data: rows.results, pagination: { page: pageNo, limit: pageSize, total: count?.total || 0 } });
});

qr.post("/generate", zValidator("json", generateQrSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const entity = await buildEntityPayload(db, tenantId, body.EntityType, body.EntityId);

  if (!entity) return c.json({ error: "Entity not found" }, 404);

  const tagCode = normalizeQrCode(body.TagCode || makeInventoryQrCode(tenantId, body.EntityType, body.EntityId));
  const payload = {
    system: "hms",
    tenantId,
    tagCode,
    entityType: body.EntityType,
    entityId: body.EntityId,
    udiReady: body.EntityType === "fixed_asset" || body.EntityType === "stock",
    ...(body.Payload || {}),
  };

  await upsertQrTag(db, {
    tenantId,
    tagCode,
    entityType: body.EntityType,
    entityId: body.EntityId,
    humanLabel: body.HumanLabel || (entity as any).ItemName || (entity as any).StoreName || (entity as any).LocationName || null,
    payload,
    createdBy: userId,
  });

  const qrPayload = buildInventoryQrCodeValue(tagCode);
  const svg = await QRCode.toString(qrPayload, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return c.json({ tagCode, qrPayload, payload, svg });
});

qr.get("/scan/:code", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = c.get("userId") || null;
  const code = normalizeQrCode(c.req.param("code"));
  const purpose = c.req.query("purpose") || "lookup";
  const locationId = c.req.query("locationId") ? Number(c.req.query("locationId")) : null;
  const wardId = c.req.query("wardId") ? Number(c.req.query("wardId")) : null;

  const tag = await db.$client.prepare("SELECT * FROM InventoryQrTag WHERE tenant_id = ? AND TagCode = ?")
    .bind(tenantId, code).first<any>();

  if (!tag) {
    await db.$client.prepare(`
      INSERT INTO InventoryQrScanLog (tenant_id, TagCode, ScanPurpose, LocationId, WardId, ScannedBy, ScanResult, ResultJson)
      VALUES (?, ?, ?, ?, ?, ?, 'not_found', ?)
    `).bind(tenantId, code, purpose, locationId, wardId, userId, JSON.stringify({ error: "Tag not found" })).run();
    return c.json({ error: "Tag not found", tagCode: code }, 404);
  }

  const entity = await buildEntityPayload(db, tenantId, tag.EntityType, tag.EntityId);
  const scanResult = tag.Status === "active" ? "found" : "inactive";
  const result = { tag, payload: JSON.parse(tag.PayloadJson || "{}"), entity };

  await db.$client.prepare("UPDATE InventoryQrTag SET LastScannedOn = ?, ModifiedOn = ? WHERE tenant_id = ? AND TagCode = ?")
    .bind(new Date().toISOString(), new Date().toISOString(), tenantId, code).run();
  await db.$client.prepare(`
    INSERT INTO InventoryQrScanLog
      (tenant_id, TagCode, EntityType, EntityId, ScanPurpose, LocationId, WardId, ScannedBy, ScanResult, ResultJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, code, tag.EntityType, tag.EntityId, purpose, locationId, wardId, userId, scanResult, JSON.stringify(result)).run();

  return c.json(result, tag.Status === "active" ? 200 : 409);
});

qr.post("/:code/print", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const code = normalizeQrCode(c.req.param("code"));
  const tag = await db.$client.prepare("SELECT * FROM InventoryQrTag WHERE tenant_id = ? AND TagCode = ?").bind(tenantId, code).first<any>();
  if (!tag) return c.json({ error: "Tag not found" }, 404);
  await db.$client.prepare("UPDATE InventoryQrTag SET PrintCount = PrintCount + 1, LastPrintedOn = ?, ModifiedOn = ? WHERE tenant_id = ? AND TagCode = ?")
    .bind(new Date().toISOString(), new Date().toISOString(), tenantId, code).run();
  const qrPayload = buildInventoryQrCodeValue(code);
  const svg = await QRCode.toString(qrPayload, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return c.json({ tagCode: code, qrPayload, svg, payload: JSON.parse(tag.PayloadJson || "{}") });
});

export default qr;

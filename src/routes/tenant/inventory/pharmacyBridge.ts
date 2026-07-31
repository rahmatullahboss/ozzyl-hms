import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { getDb } from "../../../db";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";

const pharmacyBridge = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// ── Schemas ──────────────────────────────────────────────────────────────

const linkSchema = z.object({
  pharmacyItemId: z.number().int().positive(),
  inventoryItemId: z.number().int().positive(),
});

const syncStockSchema = z.object({}).strict();

// ── GET /link-suggestions ────────────────────────────────────────────────
// Suggests links between pharmacy_items and InventoryItem where ItemType='medicine'
// Matching by name similarity (exact or contains)

pharmacyBridge.get("/link-suggestions", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  // Get all pharmacy items without an inventory link
  const pharmacyItems = await db.$client.prepare(
    `SELECT id, name, item_code, inventory_item_id FROM pharmacy_items WHERE tenant_id = ? AND (inventory_item_id IS NULL OR inventory_item_id = 0) AND is_active = 1`
  ).bind(tenantId).all<{ id: number; name: string; item_code: string | null; inventory_item_id: number | null }>();

  // Get all inventory medicine items without a pharmacy link
  const inventoryItems = await db.$client.prepare(
    `SELECT ItemId, ItemName, ItemCode, ItemType, GenericName, BrandName, pharmacy_item_id FROM InventoryItem WHERE tenant_id = ? AND ItemType = 'medicine' AND (pharmacy_item_id IS NULL OR pharmacy_item_id = 0) AND IsActive = 1`
  ).bind(tenantId).all<{ ItemId: number; ItemName: string; ItemCode: string | null; ItemType: string; GenericName: string | null; BrandName: string | null; pharmacy_item_id: number | null }>();

  // Build suggestions by fuzzy name matching
  const suggestions: Array<{
    pharmacyItemId: number;
    pharmacyItemName: string;
    pharmacyItemCode: string | null;
    inventoryItemId: number;
    inventoryItemName: string;
    inventoryItemCode: string | null;
    matchType: "exact" | "contains";
  }> = [];

  for (const pi of pharmacyItems.results) {
    const piNameLower = pi.name.toLowerCase().trim();
    for (const ii of inventoryItems.results) {
      const iiNameLower = ii.ItemName.toLowerCase().trim();
      if (piNameLower === iiNameLower) {
        suggestions.push({
          pharmacyItemId: pi.id,
          pharmacyItemName: pi.name,
          pharmacyItemCode: pi.item_code,
          inventoryItemId: ii.ItemId,
          inventoryItemName: ii.ItemName,
          inventoryItemCode: ii.ItemCode,
          matchType: "exact",
        });
      } else if (piNameLower.includes(iiNameLower) || iiNameLower.includes(piNameLower)) {
        suggestions.push({
          pharmacyItemId: pi.id,
          pharmacyItemName: pi.name,
          pharmacyItemCode: pi.item_code,
          inventoryItemId: ii.ItemId,
          inventoryItemName: ii.ItemName,
          inventoryItemCode: ii.ItemCode,
          matchType: "contains",
        });
      }
    }
  }

  // Sort: exact matches first
  suggestions.sort((a, b) => (a.matchType === "exact" ? -1 : 1) - (b.matchType === "exact" ? -1 : 1));

  return c.json({ data: suggestions });
});

// ── POST /link ───────────────────────────────────────────────────────────
// Link a pharmacy_item to an InventoryItem (bidirectional FK)

pharmacyBridge.post("/link", zValidator("json", linkSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { pharmacyItemId, inventoryItemId } = c.req.valid("json");

  // Verify pharmacy item exists
  const phItem = await db.$client.prepare(
    `SELECT id, inventory_item_id FROM pharmacy_items WHERE id = ? AND tenant_id = ?`
  ).bind(pharmacyItemId, tenantId).first<{ id: number; inventory_item_id: number | null }>();

  if (!phItem) {
    return c.json({ error: "Pharmacy item not found" }, 404);
  }

  // Verify inventory item exists
  const invItem = await db.$client.prepare(
    `SELECT ItemId, pharmacy_item_id FROM InventoryItem WHERE ItemId = ? AND tenant_id = ?`
  ).bind(inventoryItemId, tenantId).first<{ ItemId: number; pharmacy_item_id: number | null }>();

  if (!invItem) {
    return c.json({ error: "Inventory item not found" }, 404);
  }

  // Set bidirectional link
  await db.$client.prepare(
    `UPDATE pharmacy_items SET inventory_item_id = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
  ).bind(inventoryItemId, pharmacyItemId, tenantId).run();

  await db.$client.prepare(
    `UPDATE InventoryItem SET pharmacy_item_id = ? WHERE ItemId = ? AND tenant_id = ?`
  ).bind(pharmacyItemId, inventoryItemId, tenantId).run();

  return c.json({ message: "Link created successfully", pharmacyItemId, inventoryItemId });
});

// ── DELETE /link/:pharmacyItemId ─────────────────────────────────────────
// Unlink a pharmacy item from its inventory item

pharmacyBridge.delete("/link/:pharmacyItemId", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const pharmacyItemId = Number(c.req.param("pharmacyItemId"));

  // Verify pharmacy item exists
  const phItem = await db.$client.prepare(
    `SELECT id, inventory_item_id FROM pharmacy_items WHERE id = ? AND tenant_id = ?`
  ).bind(pharmacyItemId, tenantId).first<{ id: number; inventory_item_id: number | null }>();

  if (!phItem) {
    return c.json({ error: "Pharmacy item not found" }, 404);
  }

  const linkedInvId = phItem.inventory_item_id;

  // Clear pharmacy side
  await db.$client.prepare(
    `UPDATE pharmacy_items SET inventory_item_id = NULL, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
  ).bind(pharmacyItemId, tenantId).run();

  // Clear inventory side (if was linked)
  if (linkedInvId) {
    await db.$client.prepare(
      `UPDATE InventoryItem SET pharmacy_item_id = NULL WHERE ItemId = ? AND tenant_id = ?`
    ).bind(linkedInvId, tenantId).run();
  }

  return c.json({ message: "Unlink successful" });
});

// ── GET /unified-low-stock ───────────────────────────────────────────────
// Single endpoint returning low-stock items from BOTH systems

pharmacyBridge.get("/unified-low-stock", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  // Pharmacy low-stock: total available_qty < reorder_level per item
  const pharmacyLow = await db.$client.prepare(`
    SELECT
      pi.id AS pharmacyItemId,
      pi.name AS itemName,
      pi.item_code AS itemCode,
      pi.reorder_level AS reorderLevel,
      pi.min_stock_qty AS minStockQty,
      COALESCE(SUM(ps.available_qty), 0) AS totalStock
    FROM pharmacy_items pi
    LEFT JOIN pharmacy_stock ps ON ps.item_id = pi.id AND ps.is_active = 1 AND ps.tenant_id = pi.tenant_id
    WHERE pi.tenant_id = ? AND pi.is_active = 1
    GROUP BY pi.id
    HAVING totalStock < pi.reorder_level OR totalStock < pi.min_stock_qty
    ORDER BY totalStock ASC
  `).bind(tenantId).all<{
    pharmacyItemId: number;
    itemName: string;
    itemCode: string | null;
    reorderLevel: number;
    minStockQty: number;
    totalStock: number;
  }>();

  // Inventory low-stock: total AvailableQuantity <= ReOrderLevel per medicine item
  const inventoryLow = await db.$client.prepare(`
    SELECT
      ii.ItemId AS inventoryItemId,
      ii.ItemName AS itemName,
      ii.ItemCode AS itemCode,
      ii.ReOrderLevel AS reorderLevel,
      ii.MinStockQuantity AS minStockQty,
      COALESCE(SUM(is2.AvailableQuantity), 0) AS totalStock
    FROM InventoryItem ii
    LEFT JOIN InventoryStock is2 ON is2.ItemId = ii.ItemId AND is2.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ? AND ii.ItemType = 'medicine' AND ii.IsActive = 1
    GROUP BY ii.ItemId
    HAVING totalStock <= ii.ReOrderLevel OR totalStock <= ii.MinStockQuantity
    ORDER BY totalStock ASC
  `).bind(tenantId).all<{
    inventoryItemId: number;
    itemName: string;
    itemCode: string | null;
    reorderLevel: number;
    minStockQty: number;
    totalStock: number;
  }>();

  return c.json({
    pharmacy: pharmacyLow.results,
    inventory: inventoryLow.results,
  });
});

// ── POST /sync-stock-to-pharmacy ─────────────────────────────────────────
// One-directional sync: inventory AvailableQuantity → pharmacy available_qty
// Only updates pharmacy when inventory has more stock. Does NOT sync the reverse direction.

pharmacyBridge.post("/sync-stock-to-pharmacy", zValidator("json", syncStockSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  // Get all linked pharmacy items
  const linked = await db.$client.prepare(`
    SELECT pi.id AS pharmacyItemId, pi.inventory_item_id AS inventoryItemId
    FROM pharmacy_items pi
    WHERE pi.tenant_id = ? AND pi.inventory_item_id IS NOT NULL AND pi.inventory_item_id > 0 AND pi.is_active = 1
  `).bind(tenantId).all<{ pharmacyItemId: number; inventoryItemId: number }>();

  const details: Array<{ pharmacyItemId: number; inventoryItemId: number; inventoryStock: number; action: string }> = [];

  for (const link of linked.results) {
    // Sum inventory stock for this item
    const invStock = await db.$client.prepare(`
      SELECT COALESCE(SUM(AvailableQuantity), 0) AS totalStock
      FROM InventoryStock
      WHERE tenant_id = ? AND ItemId = ?
    `).bind(tenantId, link.inventoryItemId).first<{ totalStock: number }>();

    const inventoryStock = invStock?.totalStock ?? 0;

    // Sum current pharmacy stock
    const phStock = await db.$client.prepare(`
      SELECT COALESCE(SUM(available_qty), 0) AS totalStock
      FROM pharmacy_stock
      WHERE tenant_id = ? AND item_id = ? AND is_active = 1
    `).bind(tenantId, link.pharmacyItemId).first<{ totalStock: number }>();

    const pharmacyStock = phStock?.totalStock ?? 0;

    // If inventory has more stock than pharmacy, update pharmacy stock
    if (inventoryStock > pharmacyStock) {
      const diff = inventoryStock - pharmacyStock;

      // Check if pharmacy has an existing stock row for this item
      const existingStock = await db.$client.prepare(`
        SELECT id FROM pharmacy_stock
        WHERE tenant_id = ? AND item_id = ? AND is_active = 1
        ORDER BY id ASC LIMIT 1
      `).bind(tenantId, link.pharmacyItemId).first<{ id: number }>();

      if (existingStock) {
        // Atomic update of existing stock row
        await db.$client.prepare(`
          UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now')
          WHERE item_id = ? AND batch_no = (SELECT batch_no FROM pharmacy_stock WHERE id = ?)
        `).bind(diff, link.pharmacyItemId, existingStock.id).run();
      } else {
        // Insert new stock row
        await db.$client.prepare(`
          INSERT INTO pharmacy_stock (item_id, batch_no, available_qty, is_active, tenant_id, created_at, updated_at)
          VALUES (?, 'SYNC', ?, 1, ?, datetime('now'), datetime('now'))
        `).bind(link.pharmacyItemId, diff, tenantId).run();
      }

      details.push({
        pharmacyItemId: link.pharmacyItemId,
        inventoryItemId: link.inventoryItemId,
        inventoryStock,
        action: `Synced +${diff} units`,
      });
    } else {
      details.push({
        pharmacyItemId: link.pharmacyItemId,
        inventoryItemId: link.inventoryItemId,
        inventoryStock,
        action: "No sync needed",
      });
    }
  }

  return c.json({ synced: details.filter(d => d.action.startsWith("Synced")).length, details });
});

export default pharmacyBridge;

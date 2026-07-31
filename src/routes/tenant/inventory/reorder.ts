import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../../types";
import { getDb } from "../../../db";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";

const INTELLIGENCE_SOURCE = "intelligence_snapshot";
const LEGACY_SOURCE = "legacy_reorder_level";

type Variables = { tenantId?: string; userId?: string; role?: string };

const reorderQuantityFormulaSchema = z.enum([
  "max_minus_current",
  "reorder_x2_minus_current",
  "reorder_level_multiply",
  "fixed",
]).transform((value) => value === "reorder_level_multiply" ? "reorder_x2_minus_current" : value);

const updateReorderConfigSchema = z.object({
  auto_reorder_enabled: z.boolean().optional(),
  preferred_vendor_id: z.number().int().positive().nullable().optional(),
  reorder_quantity_formula: reorderQuantityFormulaSchema.optional(),
});

const generatePrSchema = z.object({
  item_ids: z.array(z.number().int().positive()).optional(),
  notes: z.string().optional(),
}).optional();

const reorder = new Hono<{ Bindings: Env; Variables: Variables }>();

function isMissingIntelligenceSnapshotError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such table: inventory_stock_intelligence_snapshot");
}

type ReorderSuggestionRow = {
  ItemId: number;
  ItemName: string;
  ItemCode: string;
  ReOrderLevel: number;
  MaxStockQuantity?: number | null;
  MinStockQuantity?: number | null;
  auto_reorder_enabled?: number | boolean | null;
  reorder_quantity_formula?: string | null;
  preferred_vendor_id: number | null;
  preferred_vendor_name: string | null;
  StandardRate?: number | null;
  current_stock: number;
  intelligence_reorder_point?: number | null;
  suggested_quantity: number;
  days_of_cover?: number | null;
  estimated_stockout_date?: string | null;
  recommendation_status?: string | null;
  source: typeof INTELLIGENCE_SOURCE | typeof LEGACY_SOURCE;
};

async function intelligenceReorderSuggestions(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  options: { automationOnly?: boolean } = {},
): Promise<ReorderSuggestionRow[]> {
  const rows = await db.$client.prepare(`
    SELECT
      I.ItemId,
      I.ItemName,
      I.ItemCode,
      I.ReOrderLevel,
      I.MaxStockQuantity,
      I.MinStockQuantity,
      I.auto_reorder_enabled,
      I.reorder_quantity_formula,
      I.preferred_vendor_id,
      V.VendorName AS preferred_vendor_name,
      I.StandardRate,
      S.usable_stock AS current_stock,
      S.reorder_point AS intelligence_reorder_point,
      S.suggested_order_qty AS suggested_quantity,
      S.days_of_cover,
      S.estimated_stockout_date,
      S.recommendation_status,
      'intelligence_snapshot' AS source
    FROM inventory_stock_intelligence_snapshot S
    JOIN InventoryItem I ON I.ItemId = S.inventory_item_id AND I.tenant_id = S.tenant_id
    LEFT JOIN InventoryVendor V ON V.VendorId = I.preferred_vendor_id AND V.tenant_id = I.tenant_id
    WHERE S.tenant_id = ?
      AND COALESCE(I.IsActive, 1) = 1
      AND (? = 0 OR I.auto_reorder_enabled = 1)
      AND S.recommendation_status IN ('stockout', 'low', 'watch')
      AND S.suggested_order_qty > 0
    ORDER BY CASE S.recommendation_status WHEN 'stockout' THEN 0 WHEN 'low' THEN 1 ELSE 2 END,
             S.days_of_cover ASC,
             I.ItemName ASC
    LIMIT 100
  `).bind(tenantId, options.automationOnly ? 1 : 0).all<ReorderSuggestionRow>();

  return (rows.results || []) as ReorderSuggestionRow[];
}

async function legacyReorderSuggestions(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  options: { automationOnly?: boolean } = {},
): Promise<ReorderSuggestionRow[]> {
  const rows = await db.$client.prepare(`
    SELECT
      I.ItemId,
      I.ItemName,
      I.ItemCode,
      I.ReOrderLevel,
      I.MaxStockQuantity,
      I.MinStockQuantity,
      I.auto_reorder_enabled,
      I.reorder_quantity_formula,
      I.preferred_vendor_id,
      V.VendorName AS preferred_vendor_name,
      I.StandardRate,
      COALESCE(SUM(S.AvailableQuantity), 0) AS current_stock,
      CASE
        WHEN I.MaxStockQuantity > 0 THEN MAX(I.MaxStockQuantity - COALESCE(SUM(S.AvailableQuantity), 0), 0)
        ELSE MAX(I.ReOrderLevel * 2 - COALESCE(SUM(S.AvailableQuantity), 0), 0)
      END AS suggested_quantity,
      'legacy_reorder_level' AS source
    FROM InventoryItem I
    LEFT JOIN InventoryStock S ON S.ItemId = I.ItemId AND S.tenant_id = I.tenant_id AND COALESCE(S.IsActive, 1) = 1
    LEFT JOIN InventoryVendor V ON V.VendorId = I.preferred_vendor_id AND V.tenant_id = I.tenant_id
    WHERE I.tenant_id = ? AND COALESCE(I.IsActive, 1) = 1
      AND I.ReOrderLevel > 0
      AND (? = 0 OR I.auto_reorder_enabled = 1)
    GROUP BY I.ItemId
    HAVING current_stock <= I.ReOrderLevel
    ORDER BY current_stock ASC
  `).bind(tenantId, options.automationOnly ? 1 : 0).all<ReorderSuggestionRow>();

  return (rows.results || []) as ReorderSuggestionRow[];
}

async function loadReorderSuggestionsForDashboard(db: ReturnType<typeof getDb>, tenantId: string): Promise<ReorderSuggestionRow[]> {
  try {
    const intelligenceRows = await intelligenceReorderSuggestions(db, tenantId);
    if (intelligenceRows.length > 0) return intelligenceRows;
  } catch (error) {
    if (!isMissingIntelligenceSnapshotError(error)) throw error;
  }
  return legacyReorderSuggestions(db, tenantId);
}

async function loadReorderSuggestionsForAutomation(db: ReturnType<typeof getDb>, tenantId: string): Promise<ReorderSuggestionRow[]> {
  try {
    const intelligenceRows = await intelligenceReorderSuggestions(db, tenantId, { automationOnly: true });
    if (intelligenceRows.length > 0) return intelligenceRows;
  } catch (error) {
    if (!isMissingIntelligenceSnapshotError(error)) throw error;
  }
  return legacyReorderSuggestions(db, tenantId, { automationOnly: true });
}

reorder.get("/suggestions", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  return c.json({ suggestions: await loadReorderSuggestionsForDashboard(db, tenantId) });
});

reorder.post("/generate-pr", zValidator("json", generatePrSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const body = c.req.valid("json") || {};
  const requestedItemIds = new Set(body.item_ids || []);
  const allSuggestions = await loadReorderSuggestionsForAutomation(db, tenantId);
  const suggestions = requestedItemIds.size > 0
    ? allSuggestions.filter((suggestion) => requestedItemIds.has(suggestion.ItemId))
    : allSuggestions;

  // Deduplication: find items already in open PRs
  const openPrItems = await db.$client.prepare(`
    SELECT DISTINCT PRI.ItemId
    FROM InventoryPurchaseRequestItem PRI
    JOIN InventoryPurchaseRequest PR ON PR.PurchaseRequestId = PRI.PurchaseRequestId
    WHERE PR.tenant_id = ? AND PR.Status IN ('draft', 'submitted', 'approved')
  `).bind(tenantId).all();

  const openItemIds = new Set((openPrItems.results || []).map((r: any) => r.ItemId));
  const validSuggestions = suggestions.filter(s => !openItemIds.has(s.ItemId));
  const skippedItems = suggestions
    .filter(s => openItemIds.has(s.ItemId))
    .map(s => ({ ItemId: s.ItemId, ItemName: s.ItemName, reason: 'already_in_open_pr' }));

  // Group by vendor
  const byVendor = new Map<number | null, typeof validSuggestions>();
  for (const s of validSuggestions) {
    const key = s.preferred_vendor_id ?? null;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(s);
  }

  const createdPRs: number[] = [];

  for (const [, items] of byVendor) {
    if (items.length === 0) continue;

    const prYear = new Date().getFullYear();
    const lastPr = await db.$client.prepare(
      "SELECT MAX(CAST(SUBSTR(PRNumber, 9) AS INTEGER)) as maxNum FROM InventoryPurchaseRequest WHERE tenant_id = ? AND PRNumber LIKE ?"
    ).bind(tenantId, `PR-${prYear}-%`).first<{ maxNum: number }>();

    const nextNum = (lastPr?.maxNum || 0) + 1;
    const prNumber = `PR-${prYear}-${String(nextNum).padStart(5, "0")}`;

    const result = await db.$client.prepare(`
      INSERT INTO InventoryPurchaseRequest
        (tenant_id, PRNumber, PRDate, RequestedBy, Priority, Status, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, 'normal', 'draft', ?, ?, ?)
    `).bind(
      tenantId, prNumber, now.slice(0, 10), userId,
      `Auto-generated reorder PR for ${items.length} items`,
      userId, now,
    ).run();

    const prId = Number(result.meta.last_row_id);
    createdPRs.push(prId);

    for (const item of items) {
      await db.$client.prepare(`
        INSERT INTO InventoryPurchaseRequestItem
          (PurchaseRequestId, ItemId, ItemName, Quantity, ApprovedQuantity, EstimatedRate, EstimatedAmount, Remarks, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).bind(
        prId, item.ItemId, item.ItemName, item.suggested_quantity,
        item.StandardRate || 0, item.suggested_quantity * (item.StandardRate || 0),
        `Auto-reorder (${item.source}): suggested ${item.suggested_quantity}`,
        userId, now,
      ).run();
    }
  }

  return c.json({
    message: `Generated ${createdPRs.length} purchase request(s)`,
    purchase_requests: createdPRs,
    skipped_items: skippedItems,
  }, 201);
});

reorder.get("/config/:itemId", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const itemId = Number(c.req.param("itemId"));

  const item = await db.$client.prepare(`
    SELECT ItemId, ItemName, ItemCode, auto_reorder_enabled, preferred_vendor_id, reorder_quantity_formula
    FROM InventoryItem
    WHERE tenant_id = ? AND ItemId = ?
  `).bind(tenantId, itemId).first();

  if (!item) return c.json({ error: "Item not found" }, 404);
  return c.json(item);
});

reorder.put("/config/:itemId", zValidator("json", updateReorderConfigSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const itemId = Number(c.req.param("itemId"));
  const body = c.req.valid("json");

  const existing = await db.$client.prepare(`
    SELECT ItemId, auto_reorder_enabled, preferred_vendor_id, reorder_quantity_formula
    FROM InventoryItem
    WHERE tenant_id = ? AND ItemId = ?
  `).bind(tenantId, itemId).first<{
    ItemId: number;
    auto_reorder_enabled?: number | boolean | null;
    preferred_vendor_id?: number | null;
    reorder_quantity_formula?: string | null;
  }>();

  if (!existing) return c.json({ error: "Item not found" }, 404);

  await db.$client.prepare(`
    UPDATE InventoryItem
    SET auto_reorder_enabled = ?,
        preferred_vendor_id = ?,
        reorder_quantity_formula = ?,
        ModifiedBy = ?,
        ModifiedOn = ?
    WHERE tenant_id = ? AND ItemId = ?
  `).bind(
    body.auto_reorder_enabled === undefined
      ? (existing.auto_reorder_enabled ? 1 : 0)
      : (body.auto_reorder_enabled ? 1 : 0),
    body.preferred_vendor_id === undefined
      ? (existing.preferred_vendor_id ?? null)
      : body.preferred_vendor_id,
    body.reorder_quantity_formula
      ?? existing.reorder_quantity_formula
      ?? 'max_minus_current',
    userId,
    new Date().toISOString(),
    tenantId,
    itemId,
  ).run();

  return c.json({ message: "Reorder config updated" });
});

export default reorder;

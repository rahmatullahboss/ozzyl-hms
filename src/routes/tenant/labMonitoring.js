import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { requireTenantId, requireUserId } from "../../lib/context-helpers";
import { getDb } from "../../db";
import { requireRole } from "../../middleware/rbac";
import { createAuditLog } from "../../lib/accounting-helpers";
import { recordLabWorkflowEvent } from "../../lib/lab-workflow";
import { consumeLabConsumableStock, consumeMappedLabConsumables } from "../../lib/lab-consumables";
import { LAB_INVENTORY_CAPABILITIES, getLabInventoryPolicy, getLabInventoryStrictModeReadiness, upsertLabInventoryPolicy } from "../../lib/lab-inventory-policy";
import { seedLabReagentDefaults } from "../../lib/lab-reagent-defaults";
import { buildLisBridgeDeploymentChecklist } from "../../lib/lis-bridge-deployment-checklist";
import { buildLisStabilizationReview, summarizeLisStabilizationReview } from "../../lib/lis-stabilization-review";
import { listLabReagentReconciliation } from "../../lib/lab-reagent-reconciliation";
const labInventoryPolicySchema = z.object({
  lab_inventory_mode: z.enum(["disabled", "soft", "strict"]).optional(),
  reagent_consumption_timing: z.enum(["billing", "result"]),
  allow_result_without_stock: z.boolean().optional(),
  require_test_mapping_for_completion: z.boolean().optional()
});
const labInventoryExceptionReviewSchema = z.object({
  status: z.enum(["resolved", "ignored"]),
  remarks: z.string().optional()
});
const labMonitoring = new Hono();
labMonitoring.use("*", requireRole("laboratory", "lab", "lab_tech", "hospital_admin", "director", "receptionist"));
const requireLabInventoryRole = (...allowedRoles) => async (c, next) => {
  const role = String(c.get("role") ?? "");
  if (!allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: "Insufficient lab inventory permissions" });
  }
  await next();
};
const labInventoryAdminOnly = requireLabInventoryRole("hospital_admin", "director");
const labInventoryManagerOnly = requireLabInventoryRole("laboratory", "lab", "hospital_admin", "director");
const labInventoryOperatorOnly = requireLabInventoryRole("laboratory", "lab", "lab_tech", "hospital_admin", "director");
function parseId(raw) {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid ID" });
  return id;
}
function goLiveCheck(id, label, status, detail, action) {
  return { id, label, status, detail, action: action ?? null };
}
function goLiveOverall(checks) {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ready";
}
function goLiveScore(checks) {
  if (checks.length === 0) return 0;
  const points = checks.reduce((sum, check) => sum + (check.status === "ready" ? 100 : check.status === "warning" ? 50 : 0), 0);
  return Math.round(points / checks.length);
}
labMonitoring.get("/inventory-policy", async (c) => {
  const tenantId = requireTenantId(c);
  const policy = await getLabInventoryPolicy(c.env.DB, tenantId);
  return c.json({ data: policy, capabilities: LAB_INVENTORY_CAPABILITIES });
});
labMonitoring.get("/inventory-readiness", async (c) => {
  const tenantId = requireTenantId(c);
  const readiness = await getLabInventoryStrictModeReadiness(c.env.DB, tenantId);
  return c.json({ data: readiness });
});
labMonitoring.get("/inventory-reconciliation", labInventoryManagerOnly, async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStatus = c.req.query("status") || "all";
  const allowedStatuses = /* @__PURE__ */ new Set(["all", "complete", "partial", "projection_missing", "mismatch"]);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "all";
  const labOrderItemId = Number(c.req.query("lab_order_item_id") || 0) || null;
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 100), 1), 500);
  try {
    const data = await listLabReagentReconciliation(c.env.DB, {
      tenantId: String(tenantId),
      labOrderItemId,
      status,
      limit
    });
    const summary = data.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    return c.json({ data, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no such table: lab_consumable_mapping_progress")) {
      return c.json({ data: [], summary: {}, status: "not_configured" });
    }
    throw error;
  }
});
labMonitoring.put("/inventory-policy", labInventoryAdminOnly, zValidator("json", labInventoryPolicySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  let strictModeReadiness = null;
  const requestedStrictMode = data.lab_inventory_mode === "strict";
  if (requestedStrictMode) {
    strictModeReadiness = await getLabInventoryStrictModeReadiness(c.env.DB, tenantId);
    if (!strictModeReadiness.ready) {
      const message = `Strict lab reagent mode is not ready: ${strictModeReadiness.blockers.join("; ")}`;
      return c.json({
        error: "Strict lab reagent mode is not ready",
        message,
        code: "STRICT_LAB_INVENTORY_NOT_READY",
        readiness: strictModeReadiness,
        capabilities: LAB_INVENTORY_CAPABILITIES
      }, 409);
    }
    if (!LAB_INVENTORY_CAPABILITIES.strict_mode_available) {
      return c.json({
        error: "Strict lab reagent mode is unavailable",
        message: LAB_INVENTORY_CAPABILITIES.reason,
        code: "STRICT_LAB_INVENTORY_ATOMICITY_REQUIRED",
        readiness: strictModeReadiness,
        capabilities: LAB_INVENTORY_CAPABILITIES
      }, 409);
    }
  }
  const policy = await upsertLabInventoryPolicy(c.env.DB, {
    tenantId,
    userId,
    lab_inventory_mode: data.lab_inventory_mode,
    reagent_consumption_timing: requestedStrictMode ? "billing" : data.reagent_consumption_timing,
    allow_result_without_stock: requestedStrictMode ? false : data.allow_result_without_stock,
    require_test_mapping_for_completion: requestedStrictMode ? true : data.require_test_mapping_for_completion
  });
  return c.json({ data: policy, readiness: strictModeReadiness, message: "Lab inventory policy updated" });
});
labMonitoring.post("/default-reagent-catalog/seed", labInventoryManagerOnly, async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const summary = await seedLabReagentDefaults(c.env.DB, tenantId);
  void createAuditLog(c.env, tenantId, userId, "CREATE", "lab_reagent_default_catalog", 0, null, summary);
  return c.json({ message: "Default reagent catalog loaded", summary });
});
labMonitoring.get("/inventory-exceptions", async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStatus = c.req.query("status") || "open";
  const status = ["open", "resolved", "ignored", "all"].includes(requestedStatus) ? requestedStatus : "open";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 100);
  const whereClause = status === "all" ? "tenant_id = ?" : "tenant_id = ? AND status = ?";
  const params = status === "all" ? [String(tenantId), limit] : [String(tenantId), status, limit];
  const rows = await c.env.DB.prepare(`
    SELECT id, lab_order_id, lab_order_item_id, lab_test_id, consumable_id,
           source_event, severity, reason, message, metadata_json, status,
           created_by, resolved_by, resolved_at, resolution_remarks, created_at, updated_at
    FROM lab_inventory_exceptions
    WHERE ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(...params).all();
  return c.json({ data: rows.results ?? [] });
});
labMonitoring.post("/inventory-exceptions/:id/review", labInventoryManagerOnly, zValidator("json", labInventoryExceptionReviewSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  const result = await c.env.DB.prepare(`
    UPDATE lab_inventory_exceptions
    SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP,
        resolution_remarks = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND status = 'open'
  `).bind(data.status, userId, data.remarks ?? null, id, String(tenantId)).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new HTTPException(404, { message: "Open lab inventory exception not found" });
  }
  return c.json({ message: `Lab inventory exception ${data.status}` });
});
labMonitoring.post("/inventory-exceptions/:id/retry-consumption", labInventoryManagerOnly, async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param("id"));
  const exception = await c.env.DB.prepare(`
    SELECT id, lab_order_id, lab_order_item_id, lab_test_id, source_event, reason, message, metadata_json
    FROM lab_inventory_exceptions
    WHERE id = ? AND tenant_id = ? AND status = 'open'
    LIMIT 1
  `).bind(id, String(tenantId)).first();
  if (!exception) {
    throw new HTTPException(404, { message: "Open lab inventory exception not found" });
  }
  const labOrderId = Number(exception.lab_order_id ?? 0);
  const labOrderItemId = Number(exception.lab_order_item_id ?? 0);
  const labTestId = Number(exception.lab_test_id ?? 0);
  if (!labOrderId || !labOrderItemId || !labTestId) {
    throw new HTTPException(400, { message: "Lab inventory exception is not retryable because order item details are missing" });
  }
  try {
    const result = await consumeMappedLabConsumables(c.env.DB, {
      tenantId,
      userId,
      labOrderItemId,
      labOrderId,
      labTestId,
      requireMapping: true
    });
    const updateResult = await c.env.DB.prepare(`
      UPDATE lab_inventory_exceptions
      SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP,
          resolution_remarks = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND status = 'open'
    `).bind(userId, "Consumption retry succeeded", id, String(tenantId)).run();
    if (Number(updateResult.meta?.changes ?? 0) !== 1) {
      throw new HTTPException(409, { message: "Lab inventory exception changed before retry could be resolved" });
    }
    return c.json({ data: result, message: "Lab reagent consumption retry succeeded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lab reagent consumption retry failed";
    await c.env.DB.prepare(`
      UPDATE lab_inventory_exceptions
      SET message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND status = 'open'
    `).bind("Retry failed: " + message, id, String(tenantId)).run();
    throw error;
  }
});
const consumableSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["reagent", "tube", "strip", "film", "chemical", "kit", "slide", "syringe", "other"]),
  unit: z.string().min(1),
  unit_price: z.number().int().min(0).optional(),
  reorder_level: z.number().int().min(0).optional(),
  reorder_qty: z.number().int().min(0).optional(),
  supplier_id: z.number().int().positive().optional(),
  description: z.string().optional(),
  storage_condition: z.string().optional(),
  expiry_alert_days: z.number().int().min(1).optional()
});
labMonitoring.get("/consumables", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const category = c.req.query("category");
  const lowStock = c.req.query("low_stock");
  const search = c.req.query("search") || "";
  let where = "WHERE c.tenant_id = ? AND c.is_active = 1";
  const params = [tenantId];
  if (category) {
    where += " AND c.category = ?";
    params.push(category);
  }
  if (search) {
    where += " AND (c.name LIKE ? OR c.code LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  let consumables;
  try {
    consumables = await db.$client.prepare(`
      SELECT c.*,
        CASE
          WHEN c.inventory_item_id IS NOT NULL THEN COALESCE(SUM(inv.AvailableQuantity), 0)
          ELSE COALESCE(SUM(s.quantity_available), 0)
        END as total_stock,
        COUNT(CASE
          WHEN c.inventory_item_id IS NOT NULL AND inv.ExpiryDate IS NOT NULL AND inv.ExpiryDate != '' AND inv.ExpiryDate <= date('now', '+' || c.expiry_alert_days || ' days') THEN 1
          WHEN c.inventory_item_id IS NULL AND s.expiry_date <= date('now', '+' || c.expiry_alert_days || ' days') THEN 1
        END) as expiring_lots
      FROM lab_consumables c
      LEFT JOIN InventoryStock inv ON c.inventory_item_id IS NOT NULL
        AND inv.ItemId = c.inventory_item_id
        AND inv.tenant_id = c.tenant_id
        AND COALESCE(inv.IsActive, 1) = 1
        AND inv.AvailableQuantity > 0
        AND COALESCE(inv.StockStatus, 'available') = 'available'
        AND COALESCE(inv.QCStatus, 'accepted') IN ('accepted', 'passed', 'not_required')
        AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) >= CURRENT_DATE)
        AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
      LEFT JOIN lab_consumable_stock s ON c.inventory_item_id IS NULL
        AND s.consumable_id = c.id
        AND s.tenant_id = c.tenant_id
        AND s.quantity_available > 0
        AND s.qc_status IN ('not_required', 'passed')
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE)
        AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
      ${where}
      GROUP BY c.id
      ORDER BY c.category, c.name
    `).bind(...params).all();
  } catch {
    consumables = await db.$client.prepare(`
      SELECT c.*,
        COALESCE(SUM(s.quantity_available), 0) as total_stock,
        COUNT(CASE WHEN s.expiry_date <= date('now', '+' || c.expiry_alert_days || ' days') THEN 1 END) as expiring_lots
      FROM lab_consumables c
      LEFT JOIN lab_consumable_stock s ON s.consumable_id = c.id AND s.tenant_id = c.tenant_id AND s.quantity_available > 0 AND s.qc_status IN ('not_required', 'passed') AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE) AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
      ${where}
      GROUP BY c.id
      ORDER BY c.category, c.name
    `).bind(...params).all();
  }
  let results = consumables.results;
  if (lowStock === "1") {
    results = results.filter((r) => {
      const stock = Number(r.total_stock ?? 0);
      const reorder = Number(r.reorder_level ?? 10);
      return stock <= reorder;
    });
  }
  return c.json({ data: results });
});
labMonitoring.get("/consumables/:id", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param("id"));
  const consumable = await db.$client.prepare(`
    SELECT c.*,
      COALESCE(SUM(s.quantity_available), 0) as total_stock
    FROM lab_consumables c
    LEFT JOIN lab_consumable_stock s ON s.consumable_id = c.id AND s.quantity_available > 0 AND s.qc_status IN ('not_required', 'passed') AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE) AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
    WHERE c.id = ? AND c.tenant_id = ? AND c.is_active = 1
    GROUP BY c.id
  `).bind(id, tenantId).first();
  if (!consumable) throw new HTTPException(404, { message: "Consumable not found" });
  const linkedInventoryItemId = Number(consumable.inventory_item_id ?? 0);
  if (linkedInventoryItemId > 0) {
    try {
      const inventoryTotal = await db.$client.prepare(`
        SELECT COALESCE(SUM(AvailableQuantity), 0) as total_stock
        FROM InventoryStock
        WHERE ItemId = ? AND tenant_id = ?
          AND COALESCE(IsActive, 1) = 1
          AND AvailableQuantity > 0
          AND COALESCE(StockStatus, 'available') = 'available'
          AND COALESCE(QCStatus, 'accepted') IN ('accepted', 'passed', 'not_required')
          AND (AfterOpenExpiryDate IS NULL OR date(AfterOpenExpiryDate) >= CURRENT_DATE)
          AND (ExpiryDate IS NULL OR ExpiryDate = '' OR date(ExpiryDate) >= CURRENT_DATE)
      `).bind(linkedInventoryItemId, tenantId).first();
      consumable.total_stock = Number(inventoryTotal?.total_stock ?? 0);
    } catch {
      try {
        const inventoryTotal = await db.$client.prepare(`
          SELECT COALESCE(SUM(AvailableQuantity), 0) as total_stock
          FROM InventoryStock
          WHERE ItemId = ? AND tenant_id = ?
            AND COALESCE(IsActive, 1) = 1
            AND AvailableQuantity > 0
            AND (ExpiryDate IS NULL OR ExpiryDate = '' OR date(ExpiryDate) >= CURRENT_DATE)
        `).bind(linkedInventoryItemId, tenantId).first();
        consumable.total_stock = Number(inventoryTotal?.total_stock ?? 0);
      } catch {
      }
    }
  }
  let stock;
  if (linkedInventoryItemId > 0) {
    try {
      stock = await db.$client.prepare(`
        SELECT
          inv.StockId as id,
          ? as consumable_id,
          inv.BatchNo as lot_number,
          inv.ExpiryDate as expiry_date,
          inv.AvailableQuantity as quantity_available,
          inv.CostPrice as purchase_price,
          COALESCE(inv.QCStatus, 'accepted') as qc_status,
          inv.OpenDate as opened_at,
          inv.AfterOpenExpiryDate as onboard_expires_at,
          inv.StockStatus as stock_status,
          inv.StoreId as location_id,
          COALESCE(st.StoreCode, (SELECT st2.StoreCode FROM InventoryStore st2 WHERE st2.StoreId = inv.StoreId LIMIT 1)) as location_code,
          COALESCE(st.StoreName, (SELECT st2.StoreName FROM InventoryStore st2 WHERE st2.StoreId = inv.StoreId LIMIT 1)) as location_name,
          COALESCE(st.StoreType, (SELECT st2.StoreType FROM InventoryStore st2 WHERE st2.StoreId = inv.StoreId LIMIT 1)) as location_type,
          lraa.id as active_assignment_id,
          lraa.machine_id as assigned_machine_id,
          lm.machine_name as assigned_machine_name,
          lm.machine_code as assigned_machine_code,
          lraa.location_id as analyzer_location_id,
          aloc.location_name as analyzer_location_name,
          aloc.location_code as analyzer_location_code,
          lraa.assigned_at as analyzer_assigned_at,
          lraa.remarks as analyzer_assignment_remarks,
          'inventory' as ledger_type
        FROM InventoryStock inv
        LEFT JOIN InventoryStore st ON st.StoreId = inv.StoreId AND st.tenant_id = inv.tenant_id
        LEFT JOIN lab_reagent_analyzer_assignments lraa ON lraa.tenant_id = inv.tenant_id AND lraa.stock_id = inv.StockId AND lraa.status = 'active'
        LEFT JOIN lab_machines lm ON lm.id = lraa.machine_id
        LEFT JOIN lab_consumable_locations aloc ON aloc.id = lraa.location_id AND aloc.tenant_id = inv.tenant_id
        WHERE inv.ItemId = ? AND inv.tenant_id = ?
          AND COALESCE(inv.IsActive, 1) = 1
          AND inv.AvailableQuantity > 0
          AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) >= CURRENT_DATE)
          AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
        ORDER BY CASE WHEN inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' THEN 1 ELSE 0 END, inv.ExpiryDate ASC, inv.StockId ASC
      `).bind(id, linkedInventoryItemId, tenantId).all();
    } catch {
      try {
        stock = await db.$client.prepare(`
          SELECT
            StockId as id,
            ? as consumable_id,
            BatchNo as lot_number,
            ExpiryDate as expiry_date,
            AvailableQuantity as quantity_available,
            CostPrice as purchase_price,
            'not_required' as qc_status,
            inv.StoreId as location_id,
            st.StoreCode as location_code,
            st.StoreName as location_name,
            st.StoreType as location_type,
            'inventory' as ledger_type
          FROM InventoryStock inv
          LEFT JOIN InventoryStore st ON st.StoreId = inv.StoreId AND st.tenant_id = inv.tenant_id
          WHERE inv.ItemId = ? AND inv.tenant_id = ?
            AND COALESCE(inv.IsActive, 1) = 1
            AND inv.AvailableQuantity > 0
            AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
          ORDER BY CASE WHEN inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' THEN 1 ELSE 0 END, inv.ExpiryDate ASC, inv.StockId ASC
        `).bind(id, linkedInventoryItemId, tenantId).all();
      } catch {
        stock = void 0;
      }
    }
  }
  if (!stock) {
    stock = await db.$client.prepare(`
      SELECT s.*, l.location_code, l.location_name, l.location_type, 'lab' as ledger_type
      FROM lab_consumable_stock s
      LEFT JOIN lab_consumable_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      WHERE s.consumable_id = ? AND s.tenant_id = ? AND s.quantity_available > 0
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE)
        AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
      ORDER BY s.expiry_date ASC
    `).bind(id, tenantId).all();
  }
  const movements = await db.$client.prepare(`
    SELECT m.*, c.name as consumable_name, u.name as performed_by_name
    FROM lab_consumable_movements m
    JOIN lab_consumables c ON m.consumable_id = c.id
    LEFT JOIN users u ON m.performed_by = u.id
    WHERE m.consumable_id = ? AND m.tenant_id = ?
    ORDER BY m.created_at DESC LIMIT 50
  `).bind(id, tenantId).all();
  return c.json({ consumable, stock: stock.results, movements: movements.results });
});
labMonitoring.post("/consumables", labInventoryManagerOnly, zValidator("json", consumableSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    INSERT INTO lab_consumables
      (code, name, category, unit, unit_price, reorder_level, reorder_qty, supplier_id, description, storage_condition, expiry_alert_days, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.code,
    data.name,
    data.category,
    data.unit,
    data.unit_price ?? 0,
    data.reorder_level ?? 10,
    data.reorder_qty ?? 50,
    data.supplier_id ?? null,
    data.description ?? null,
    data.storage_condition ?? null,
    data.expiry_alert_days ?? 30,
    tenantId,
    userId
  ).run();
  return c.json({ id: result.meta.last_row_id, message: "Consumable created" }, 201);
});
labMonitoring.put("/consumables/:id", labInventoryManagerOnly, zValidator("json", consumableSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  const existing = await db.$client.prepare("SELECT id FROM lab_consumables WHERE id = ? AND tenant_id = ?").bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: "Consumable not found" });
  const sets = [];
  const vals = [];
  if (data.code !== void 0) {
    sets.push("code = ?");
    vals.push(data.code);
  }
  if (data.name !== void 0) {
    sets.push("name = ?");
    vals.push(data.name);
  }
  if (data.category !== void 0) {
    sets.push("category = ?");
    vals.push(data.category);
  }
  if (data.unit !== void 0) {
    sets.push("unit = ?");
    vals.push(data.unit);
  }
  if (data.unit_price !== void 0) {
    sets.push("unit_price = ?");
    vals.push(data.unit_price);
  }
  if (data.reorder_level !== void 0) {
    sets.push("reorder_level = ?");
    vals.push(data.reorder_level);
  }
  if (data.reorder_qty !== void 0) {
    sets.push("reorder_qty = ?");
    vals.push(data.reorder_qty);
  }
  if (data.supplier_id !== void 0) {
    sets.push("supplier_id = ?");
    vals.push(data.supplier_id);
  }
  if (data.description !== void 0) {
    sets.push("description = ?");
    vals.push(data.description);
  }
  if (data.storage_condition !== void 0) {
    sets.push("storage_condition = ?");
    vals.push(data.storage_condition);
  }
  if (data.expiry_alert_days !== void 0) {
    sets.push("expiry_alert_days = ?");
    vals.push(data.expiry_alert_days);
  }
  if (sets.length === 0) throw new HTTPException(400, { message: "No fields to update" });
  vals.push(id, tenantId);
  await db.$client.prepare(`UPDATE lab_consumables SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  return c.json({ message: "Consumable updated" });
});
labMonitoring.delete("/consumables/:id", labInventoryManagerOnly, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param("id"));
  const result = await db.$client.prepare(
    "UPDATE lab_consumables SET is_active = 0 WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Consumable not found" });
  return c.json({ message: "Consumable deactivated" });
});
const locationSchema = z.object({
  location_code: z.string().min(1),
  location_name: z.string().min(1),
  location_type: z.enum(["store", "fridge", "analyzer", "rack", "room", "other"]).default("store"),
  description: z.string().optional()
});
labMonitoring.get("/stock/locations", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const rows = await db.$client.prepare(`
    SELECT id, location_code, location_name, location_type, description, is_active
    FROM lab_consumable_locations
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY location_type, location_name
  `).bind(tenantId).all();
  return c.json({ data: rows.results });
});
labMonitoring.get("/machines", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const rows = await db.$client.prepare("SELECT id, machine_name, machine_code, status FROM lab_machines WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY machine_name, machine_code, id").bind(tenantId).all();
    return c.json({ data: rows.results });
  } catch {
    const rows = await db.$client.prepare("SELECT id, 'Machine ' || id as machine_name, NULL as machine_code, 'active' as status FROM lab_machines ORDER BY id").all();
    return c.json({ data: rows.results });
  }
});
labMonitoring.get("/analyzer-health", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = {
    open_unmatched_results: 0,
    machines_total: 0,
    active_assignments: 0,
    machines_with_active_assignment: 0,
    inventory_reagent_lots: 0,
    unassigned_inventory_lots: 0,
    machine_breakdown: []
  };
  try {
    const row = await db.$client.prepare(
      "SELECT COUNT(*) as count FROM lis_unmatched_results WHERE tenant_id = ? AND status = 'open'"
    ).bind(tenantId).first();
    data.open_unmatched_results = Number(row?.count ?? 0);
  } catch {
  }
  try {
    const row = await db.$client.prepare(
      "SELECT COUNT(*) as count FROM lab_machines WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1"
    ).bind(tenantId).first();
    data.machines_total = Number(row?.count ?? 0);
  } catch {
    try {
      const row = await db.$client.prepare("SELECT COUNT(*) as count FROM lab_machines").first();
      data.machines_total = Number(row?.count ?? 0);
    } catch {
    }
  }
  try {
    const row = await db.$client.prepare(`
      SELECT COUNT(*) as active_assignments,
             COUNT(DISTINCT machine_id) as machines_with_active_assignment
      FROM lab_reagent_analyzer_assignments
      WHERE tenant_id = ? AND status = 'active'
    `).bind(tenantId).first();
    data.active_assignments = Number(row?.active_assignments ?? 0);
    data.machines_with_active_assignment = Number(row?.machines_with_active_assignment ?? 0);
  } catch {
  }
  try {
    const row = await db.$client.prepare(`
      SELECT COUNT(*) as inventory_reagent_lots,
             SUM(CASE WHEN NOT EXISTS (
               SELECT 1 FROM lab_reagent_analyzer_assignments lraa
               WHERE lraa.tenant_id = inv.tenant_id
                 AND lraa.stock_id = inv.StockId
                 AND lraa.status = 'active'
             ) THEN 1 ELSE 0 END) as unassigned_inventory_lots
      FROM InventoryStock inv
      JOIN lab_consumables lc ON lc.tenant_id = inv.tenant_id
        AND lc.inventory_item_id = inv.ItemId
        AND lc.is_active = 1
        AND lc.category = 'reagent'
      WHERE inv.tenant_id = ?
        AND COALESCE(inv.IsActive, 1) = 1
        AND inv.AvailableQuantity > 0
        AND COALESCE(inv.StockStatus, 'available') = 'available'
        AND COALESCE(inv.QCStatus, 'passed') IN ('accepted', 'passed', 'not_required')
        AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) >= CURRENT_DATE)
        AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
    `).bind(tenantId).first();
    data.inventory_reagent_lots = Number(row?.inventory_reagent_lots ?? 0);
    data.unassigned_inventory_lots = Number(row?.unassigned_inventory_lots ?? 0);
  } catch {
  }
  try {
    const machineRows = await db.$client.prepare(`
      SELECT m.id as machine_id,
             COALESCE(m.machine_name, 'Machine ' || m.id) as machine_name,
             m.machine_code as machine_code,
             COALESCE(u.open_unmatched_results, 0) as open_unmatched_results,
             COALESCE(a.active_assignments, 0) as active_assignments
      FROM lab_machines m
      LEFT JOIN (
        SELECT machine_id, COUNT(*) as open_unmatched_results
        FROM lis_unmatched_results
        WHERE tenant_id = ? AND status = 'open'
        GROUP BY machine_id
      ) u ON u.machine_id = m.id
      LEFT JOIN (
        SELECT machine_id, COUNT(*) as active_assignments
        FROM lab_reagent_analyzer_assignments
        WHERE tenant_id = ? AND status = 'active'
        GROUP BY machine_id
      ) a ON a.machine_id = m.id
      WHERE m.tenant_id = ? AND COALESCE(m.is_active, 1) = 1
      ORDER BY COALESCE(u.open_unmatched_results, 0) DESC,
               CASE WHEN COALESCE(a.active_assignments, 0) = 0 THEN 0 ELSE 1 END,
               machine_name,
               machine_id
    `).bind(tenantId, tenantId, tenantId).all();
    data.machine_breakdown = (machineRows.results ?? []).map((machine) => {
      const open = Number(machine.open_unmatched_results ?? 0);
      const assignments = Number(machine.active_assignments ?? 0);
      return {
        machine_id: Number(machine.machine_id),
        machine_name: String(machine.machine_name ?? `Machine ${machine.machine_id}`),
        machine_code: machine.machine_code ?? null,
        open_unmatched_results: open,
        active_assignments: assignments,
        needs_attention: open > 0 || assignments === 0
      };
    });
  } catch {
  }
  return c.json({ data });
});
labMonitoring.get("/lis-go-live-readiness", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineIdRaw = c.req.query("machineId");
  const machineId = machineIdRaw ? parseId(machineIdRaw) : null;
  const machineFilter = machineId ? " AND id = ?" : "";
  const machineBinds = machineId ? [tenantId, machineId] : [tenantId];
  const checks = [];
  const activeMachines = await db.$client.prepare(
    `SELECT COUNT(*) as count FROM lab_machines WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1${machineFilter}`
  ).bind(...machineBinds).first();
  const machineCount = Number(activeMachines?.count ?? 0);
  checks.push(goLiveCheck(
    "machine-config",
    "Machine configured",
    machineCount > 0 ? "ready" : "blocked",
    machineCount > 0 ? `${machineCount} active analyzer machine${machineCount === 1 ? "" : "s"} configured` : "No active analyzer machine is configured",
    "Add and activate the analyzer machine before go-live"
  ));
  const mappedTests = await db.$client.prepare(`
    SELECT COUNT(*) as count
    FROM lab_machine_test_map mtm
    JOIN lab_machines m ON m.id = mtm.machine_id AND m.tenant_id = mtm.tenant_id
    WHERE mtm.tenant_id = ? AND COALESCE(mtm.is_active, 1) = 1 AND COALESCE(m.is_active, 1) = 1${machineId ? " AND mtm.machine_id = ?" : ""}
  `).bind(...machineBinds).first();
  const mappingCount = Number(mappedTests?.count ?? 0);
  checks.push(goLiveCheck(
    "test-mapping",
    "Analyzer test mapping",
    mappingCount > 0 ? "ready" : "blocked",
    mappingCount > 0 ? `${mappingCount} active analyzer test mappings configured` : "No active analyzer test mappings found",
    "Map analyzer test codes to lab test catalog before go-live"
  ));
  const bridgeAgents = await db.$client.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status IN ('online', 'healthy', 'active', 'ok')
             AND (last_seen_at IS NULL OR last_seen_at >= datetime('now', '-10 minutes')) THEN 1 ELSE 0 END) as healthy
    FROM lis_bridge_agents
    WHERE tenant_id = ?
  `).bind(tenantId).first();
  const bridgeTotal = Number(bridgeAgents?.total ?? 0);
  const bridgeHealthy = Number(bridgeAgents?.healthy ?? 0);
  checks.push(goLiveCheck(
    "bridge-heartbeat",
    "Bridge heartbeat",
    bridgeHealthy > 0 ? "ready" : bridgeTotal > 0 ? "warning" : "blocked",
    bridgeHealthy > 0 ? `${bridgeHealthy} bridge agent heartbeat is healthy` : bridgeTotal > 0 ? `${bridgeTotal} bridge agent registered but no recent healthy heartbeat` : "No LIS bridge agent heartbeat found",
    "Install/start the local bridge and confirm heartbeat before go-live"
  ));
  const qcRows = await db.$client.prepare(`
    SELECT
      (SELECT COUNT(*) FROM lab_qc_controls WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1) as controls,
      (SELECT COUNT(*) FROM lab_qc_ranges WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1) as ranges
  `).bind(tenantId, tenantId).first();
  const qcControls = Number(qcRows?.controls ?? 0);
  const qcRanges = Number(qcRows?.ranges ?? 0);
  checks.push(goLiveCheck(
    "qc-setup",
    "QC controls and ranges",
    qcControls > 0 && qcRanges > 0 ? "ready" : "warning",
    `${qcControls} QC controls and ${qcRanges} QC ranges configured`,
    "Configure QC controls/ranges for analyzer tests before strict clinical use"
  ));
  const validationRows = await db.$client.prepare(
    `SELECT COUNT(*) as count FROM lab_validation_rules WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`
  ).bind(tenantId).first();
  const validationCount = Number(validationRows?.count ?? 0);
  checks.push(goLiveCheck(
    "validation-rules",
    "Validation rules",
    validationCount > 0 ? "ready" : "warning",
    validationCount > 0 ? `${validationCount} active validation rules configured` : "No active validation rules configured",
    "Add range/mandatory/delta rules for high-risk analyzer tests"
  ));
  const unmatchedRows = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM lis_unmatched_results
    WHERE tenant_id = ? AND status = 'open'${machineId ? " AND machine_id = ?" : ""}
  `).bind(...machineBinds).first();
  const openUnmatched = Number(unmatchedRows?.count ?? 0);
  checks.push(goLiveCheck(
    "unmatched-queue",
    "Unmatched result queue",
    openUnmatched === 0 ? "ready" : "warning",
    openUnmatched === 0 ? "No open unmatched analyzer results" : `${openUnmatched} open unmatched analyzer result${openUnmatched === 1 ? "" : "s"}`,
    "Resolve or ignore open unmatched analyzer results before go-live"
  ));
  const logRows = await db.$client.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN processing_status IN ('error', 'partial', 'validation_blocked', 'qc_review') THEN 1 ELSE 0 END) as needs_review
    FROM lab_machine_result_log
    WHERE tenant_id = ?${machineId ? " AND machine_id = ?" : ""}
  `).bind(...machineBinds).first();
  const logTotal = Number(logRows?.total ?? 0);
  const logNeedsReview = Number(logRows?.needs_review ?? 0);
  checks.push(goLiveCheck(
    "analyzer-run-smoke-test",
    "Analyzer smoke test run",
    logTotal > 0 && logNeedsReview === 0 ? "ready" : logTotal > 0 ? "warning" : "warning",
    logTotal > 0 ? `${logTotal} analyzer log runs recorded; ${logNeedsReview} need review` : "No analyzer test message has been received yet",
    "Send a test analyzer message and verify the run summary before go-live"
  ));
  const reagentReadiness = await getLabInventoryStrictModeReadiness(c.env.DB, tenantId);
  checks.push(goLiveCheck(
    "reagent-readiness",
    "Reagent strict-mode readiness",
    reagentReadiness.ready ? "ready" : "warning",
    reagentReadiness.ready ? "Reagent strict-mode prerequisites are satisfied" : `Reagent readiness blockers: ${reagentReadiness.blockers.join("; ") || "not ready"}`,
    "Keep soft mode or resolve reagent mapping/stock/QC exceptions before strict mode"
  ));
  const overall = goLiveOverall(checks);
  return c.json({
    data: {
      overall_status: overall,
      readiness_score: goLiveScore(checks),
      machine_id: machineId,
      checks,
      summary: {
        blockers: checks.filter((check) => check.status === "blocked").length,
        warnings: checks.filter((check) => check.status === "warning").length,
        ready: checks.filter((check) => check.status === "ready").length
      }
    }
  });
});
labMonitoring.get("/lis-stabilization-review", async (c) => {
  requireTenantId(c);
  const machineIdRaw = c.req.query("machineId");
  const machineId = machineIdRaw ? parseId(machineIdRaw) : null;
  const branchName = c.req.query("branch") ?? "abdullah";
  const sections = buildLisStabilizationReview({ machineId, branchName });
  return c.json({
    data: {
      machine_id: machineId,
      branch: branchName,
      source: "openelis-reference + existing Ozzyl LIS APIs/tests",
      summary: summarizeLisStabilizationReview(sections),
      sections
    }
  });
});
labMonitoring.get("/lis-bridge-deployment-checklist", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineIdRaw = c.req.query("machineId");
  const machineId = machineIdRaw ? parseId(machineIdRaw) : null;
  let machine = null;
  if (machineId) {
    machine = await db.$client.prepare(`
      SELECT id, machine_name, machine_code, protocol, analyzer_profile_id
      FROM lab_machines
      WHERE tenant_id = ? AND id = ? AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(tenantId, machineId).first();
    if (!machine) throw new HTTPException(404, { message: "Analyzer machine not found" });
  }
  return c.json({
    data: {
      machine_id: machineId,
      source: "openelis-reference + existing Ozzyl LIS readiness signals",
      checklist: buildLisBridgeDeploymentChecklist({
        machineId,
        machineName: machine?.machine_name ?? null,
        machineCode: machine?.machine_code ?? null,
        protocol: machine?.protocol ?? null,
        analyzerProfileId: machine?.analyzer_profile_id ?? null
      })
    }
  });
});
labMonitoring.post("/stock/locations", labInventoryManagerOnly, zValidator("json", locationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    INSERT INTO lab_consumable_locations
      (location_code, location_name, location_type, description, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(data.location_code, data.location_name, data.location_type, data.description ?? null, tenantId, userId).run();
  return c.json({ id: result.meta.last_row_id, message: "Lab stock location created" }, 201);
});
labMonitoring.put("/stock/locations/:locationId", labInventoryManagerOnly, zValidator("json", locationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const locationId = parseId(c.req.param("locationId"));
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    UPDATE lab_consumable_locations
    SET location_code = ?, location_name = ?, location_type = ?, description = ?
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(data.location_code, data.location_name, data.location_type, data.description ?? null, locationId, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Lab stock location not found" });
  return c.json({ message: "Lab stock location updated" });
});
labMonitoring.delete("/stock/locations/:locationId", labInventoryManagerOnly, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const locationId = parseId(c.req.param("locationId"));
  const result = await db.$client.prepare(`
    UPDATE lab_consumable_locations
    SET is_active = 0
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(locationId, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Lab stock location not found" });
  return c.json({ message: "Lab stock location deactivated" });
});
const stockInSchema = z.object({
  consumable_id: z.number().int().positive(),
  lot_number: z.string().optional(),
  expiry_date: z.string().optional(),
  quantity: z.number().int().positive(),
  purchase_price: z.number().int().min(0).optional(),
  received_date: z.string().optional(),
  remarks: z.string().optional(),
  location_id: z.number().int().positive().optional()
});
const manualUsageTypeValues = ["manual", "rerun", "control", "qc", "calibration", "other"];
function manualUsageReferenceType(usageType) {
  return "manual_" + usageType;
}
const manualUsageSchema = z.object({
  quantity: z.number().positive(),
  usage_type: z.enum(manualUsageTypeValues).default("manual"),
  reference_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  remarks: z.string().trim().min(3, "Remarks are required for manual reagent usage audit trail").max(500)
});
labMonitoring.post("/consumables/:id/manual-usage", labInventoryOperatorOnly, zValidator("json", manualUsageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const consumableId = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  const consumable = await db.$client.prepare(
    "SELECT id, name FROM lab_consumables WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(consumableId, tenantId).first();
  if (!consumable) throw new HTTPException(404, { message: "Consumable not found" });
  const referenceType = manualUsageReferenceType(data.usage_type);
  const remarks = data.remarks;
  const result = await consumeLabConsumableStock(db.$client, {
    tenantId,
    userId,
    consumableId,
    quantity: data.quantity,
    referenceType,
    referenceId: data.reference_id ?? null,
    locationId: data.location_id ?? null,
    remarks
  });
  const logDescription = `Manual ${data.usage_type} usage: ${consumable.name ?? "#" + consumableId} \u2014 ${remarks}`;
  await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_date, log_type, consumable_id, quantity, description, performed_by, tenant_id)
    VALUES (CURRENT_DATE, ?, ?, ?, ?, ?, ?)
  `).bind(
    "reagent_used",
    consumableId,
    result.quantity_used,
    logDescription,
    userId,
    tenantId
  ).run();
  const auditMovementIds = result.movement_ids ?? [];
  const auditRecordId = auditMovementIds[0] ?? consumableId;
  void createAuditLog(c.env, String(tenantId), String(userId), "CREATE", "lab_consumable_movements", auditRecordId, null, {
    consumable_id: consumableId,
    consumable_name: consumable.name ?? null,
    usage_type: data.usage_type,
    reference_type: referenceType,
    reference_id: data.reference_id ?? null,
    location_id: data.location_id ?? null,
    quantity_requested: data.quantity,
    quantity_used: result.quantity_used,
    movements: result.movements,
    movement_ids: auditMovementIds,
    cost: result.cost,
    remarks
  });
  return c.json({
    message: "Manual lab consumable usage recorded",
    consumable_id: consumableId,
    usage_type: data.usage_type,
    reference_type: referenceType,
    quantity_used: result.quantity_used,
    movements: result.movements,
    cost: result.cost
  });
});
labMonitoring.get('/stock/lots', async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const consumableIdRaw = c.req.query('consumable_id');
    const consumableId = consumableIdRaw ? parseId(consumableIdRaw) : null;
    const consumableFilter = consumableId ? ' AND c.id = ?' : '';
    const queryParams = consumableId ? [tenantId, consumableId] : [tenantId];
    let legacyRows = [];
    try {
        const legacy = await db.$client.prepare(`
      SELECT
        s.id,
        s.consumable_id,
        c.name as consumable_name,
        c.code as consumable_code,
        c.unit as consumable_unit,
        s.lot_number,
        s.expiry_date,
        s.quantity_available,
        s.purchase_price,
        s.qc_status,
        s.opened_at,
        s.onboard_expires_at,
        s.location_id,
        l.location_code,
        l.location_name,
        l.location_type,
        NULL as active_assignment_id,
        NULL as assigned_machine_id,
        NULL as assigned_machine_name,
        NULL as assigned_machine_code,
        NULL as analyzer_location_id,
        NULL as analyzer_location_name,
        NULL as analyzer_location_code,
        NULL as analyzer_assigned_at,
        NULL as analyzer_assignment_remarks,
        'lab' as ledger_type
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id AND c.is_active = 1
      LEFT JOIN lab_consumable_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND COALESCE(c.inventory_item_id, 0) <= 0
        AND s.quantity_available > 0
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE)
        AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
        ${consumableFilter}
    `).bind(...queryParams).all();
        legacyRows = legacy.results;
    }
    catch {
        const legacy = await db.$client.prepare(`
      SELECT
        s.id,
        s.consumable_id,
        c.name as consumable_name,
        c.code as consumable_code,
        c.unit as consumable_unit,
        s.lot_number,
        s.expiry_date,
        s.quantity_available,
        s.purchase_price,
        s.qc_status,
        s.opened_at,
        s.onboard_expires_at,
        s.location_id,
        l.location_code,
        l.location_name,
        l.location_type,
        NULL as active_assignment_id,
        NULL as assigned_machine_id,
        NULL as assigned_machine_name,
        NULL as assigned_machine_code,
        NULL as analyzer_location_id,
        NULL as analyzer_location_name,
        NULL as analyzer_location_code,
        NULL as analyzer_assigned_at,
        NULL as analyzer_assignment_remarks,
        'lab' as ledger_type
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id AND c.is_active = 1
      LEFT JOIN lab_consumable_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.quantity_available > 0
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE)
        AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
        ${consumableFilter}
    `).bind(...queryParams).all();
        legacyRows = legacy.results;
    }
    let inventoryRows = [];
    let canonicalProjectionAvailable = true;
    try {
        const inventory = await db.$client.prepare(`
      SELECT
        inv.StockId as id,
        c.id as consumable_id,
        c.name as consumable_name,
        c.code as consumable_code,
        c.unit as consumable_unit,
        inv.BatchNo as lot_number,
        inv.ExpiryDate as expiry_date,
        inv.AvailableQuantity as quantity_available,
        inv.CostPrice as purchase_price,
        COALESCE(inv.QCStatus, 'accepted') as qc_status,
        inv.OpenDate as opened_at,
        inv.AfterOpenExpiryDate as onboard_expires_at,
        inv.StockStatus as stock_status,
        inv.StoreId as location_id,
        st.StoreCode as location_code,
        st.StoreName as location_name,
        st.StoreType as location_type,
        lraa.id as active_assignment_id,
        lraa.machine_id as assigned_machine_id,
        lm.machine_name as assigned_machine_name,
        lm.machine_code as assigned_machine_code,
        lraa.location_id as analyzer_location_id,
        aloc.location_name as analyzer_location_name,
        aloc.location_code as analyzer_location_code,
        lraa.assigned_at as analyzer_assigned_at,
        lraa.remarks as analyzer_assignment_remarks,
        'inventory' as ledger_type
      FROM lab_consumables c
      JOIN InventoryStock inv ON inv.ItemId = c.inventory_item_id AND inv.tenant_id = c.tenant_id
      LEFT JOIN InventoryStore st ON st.StoreId = inv.StoreId AND st.tenant_id = inv.tenant_id
      LEFT JOIN lab_reagent_analyzer_assignments lraa ON lraa.tenant_id = inv.tenant_id AND lraa.stock_id = inv.StockId AND lraa.status = 'active'
      LEFT JOIN lab_machines lm ON lm.id = lraa.machine_id
      LEFT JOIN lab_consumable_locations aloc ON aloc.id = lraa.location_id AND aloc.tenant_id = inv.tenant_id
      WHERE c.tenant_id = ?
        AND c.is_active = 1
        AND c.inventory_item_id > 0
        AND COALESCE(inv.IsActive, 1) = 1
        AND inv.AvailableQuantity > 0
        AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) >= CURRENT_DATE)
        AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
        ${consumableFilter}
    `).bind(...queryParams).all();
        inventoryRows = inventory.results;
    }
    catch {
        try {
            const inventory = await db.$client.prepare(`
        SELECT
          inv.StockId as id,
          c.id as consumable_id,
          c.name as consumable_name,
          c.code as consumable_code,
          c.unit as consumable_unit,
          inv.BatchNo as lot_number,
          inv.ExpiryDate as expiry_date,
          inv.AvailableQuantity as quantity_available,
          inv.CostPrice as purchase_price,
          'not_required' as qc_status,
          NULL as opened_at,
          NULL as onboard_expires_at,
          NULL as stock_status,
          inv.StoreId as location_id,
          st.StoreCode as location_code,
          st.StoreName as location_name,
          st.StoreType as location_type,
          NULL as active_assignment_id,
          NULL as assigned_machine_id,
          NULL as assigned_machine_name,
          NULL as assigned_machine_code,
          NULL as analyzer_location_id,
          NULL as analyzer_location_name,
          NULL as analyzer_location_code,
          NULL as analyzer_assigned_at,
          NULL as analyzer_assignment_remarks,
          'inventory' as ledger_type
        FROM lab_consumables c
        JOIN InventoryStock inv ON inv.ItemId = c.inventory_item_id AND inv.tenant_id = c.tenant_id
        LEFT JOIN InventoryStore st ON st.StoreId = inv.StoreId AND st.tenant_id = inv.tenant_id
        WHERE c.tenant_id = ?
          AND c.is_active = 1
          AND c.inventory_item_id > 0
          AND COALESCE(inv.IsActive, 1) = 1
          AND inv.AvailableQuantity > 0
          AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
          ${consumableFilter}
      `).bind(...queryParams).all();
            inventoryRows = inventory.results;
        }
        catch {
            canonicalProjectionAvailable = false;
            inventoryRows = [];
        }
    }
    if (!canonicalProjectionAvailable) {
        const legacy = await db.$client.prepare(`
      SELECT
        s.id,
        s.consumable_id,
        c.name as consumable_name,
        c.code as consumable_code,
        c.unit as consumable_unit,
        s.lot_number,
        s.expiry_date,
        s.quantity_available,
        s.purchase_price,
        s.qc_status,
        s.opened_at,
        s.onboard_expires_at,
        s.location_id,
        l.location_code,
        l.location_name,
        l.location_type,
        NULL as active_assignment_id,
        NULL as assigned_machine_id,
        NULL as assigned_machine_name,
        NULL as assigned_machine_code,
        NULL as analyzer_location_id,
        NULL as analyzer_location_name,
        NULL as analyzer_location_code,
        NULL as analyzer_assigned_at,
        NULL as analyzer_assignment_remarks,
        'lab' as ledger_type
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id AND c.is_active = 1
      LEFT JOIN lab_consumable_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.quantity_available > 0
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE)
        AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
        ${consumableFilter}
    `).bind(...queryParams).all();
        legacyRows = legacy.results;
    }
    const rows = [...legacyRows, ...inventoryRows].sort((a, b) => {
        const nameOrder = String(a.consumable_name ?? '').localeCompare(String(b.consumable_name ?? ''));
        if (nameOrder !== 0)
            return nameOrder;
        const expiryA = String(a.expiry_date ?? '9999-12-31');
        const expiryB = String(b.expiry_date ?? '9999-12-31');
        const expiryOrder = expiryA.localeCompare(expiryB);
        if (expiryOrder !== 0)
            return expiryOrder;
        return Number(a.id ?? 0) - Number(b.id ?? 0);
    });
    return c.json({ data: rows });
});
labMonitoring.post("/stock/in", labInventoryOperatorOnly, zValidator("json", stockInSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const qcStatusRow = await db.$client.prepare(`
    SELECT CASE
      WHEN category IN ('reagent','chemical','kit') THEN 'pending'
      ELSE 'not_required'
    END AS qc_status
    FROM lab_consumables
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(data.consumable_id, tenantId).first();
  if (!qcStatusRow) throw new HTTPException(404, { message: "Consumable not found" });
  const qc_status = qcStatusRow.qc_status;
  const stockResult = await db.$client.prepare(`
    INSERT INTO lab_consumable_stock
      (consumable_id, lot_number, expiry_date, quantity_received, purchase_price, received_date, remarks, qc_status, location_id, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.consumable_id,
    data.lot_number ?? null,
    data.expiry_date ?? null,
    data.quantity,
    data.purchase_price ?? 0,
    data.received_date ?? (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    data.remarks ?? null,
    qc_status,
    data.location_id ?? null,
    tenantId,
    userId
  ).run();
  await db.$client.prepare(`
    INSERT INTO lab_consumable_movements
      (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, performed_by, remarks, tenant_id)
    VALUES (?, ?, 'purchase_in', ?, ?, 'purchase', ?, ?, ?)
  `).bind(
    data.consumable_id,
    stockResult.meta.last_row_id,
    data.quantity,
    data.purchase_price ?? 0,
    userId,
    data.remarks ?? "Stock received",
    tenantId
  ).run();
  return c.json({ id: stockResult.meta.last_row_id, message: "Stock added", qc_status }, 201);
});
async function loadLinkedInventoryLabStock(db, tenantId, stockId) {
  try {
    return await db.$client.prepare(`
      SELECT
        inv.StockId as stock_id,
        inv.ItemId as item_id,
        inv.StoreId as store_id,
        inv.BatchNo as batch_no,
        inv.AvailableQuantity as available_quantity,
        inv.QCStatus as qc_status,
        inv.StockStatus as stock_status,
        inv.OpenDate as open_date,
        inv.AfterOpenExpiryDate as after_open_expiry_date,
        lraa.id as active_assignment_id,
        lraa.machine_id as assigned_machine_id,
        lraa.location_id as assigned_location_id,
        lc.id as consumable_id
      FROM InventoryStock inv
      JOIN lab_consumables lc ON lc.tenant_id = inv.tenant_id
        AND lc.inventory_item_id = inv.ItemId
        AND lc.is_active = 1
      LEFT JOIN lab_reagent_analyzer_assignments lraa ON lraa.tenant_id = inv.tenant_id
        AND lraa.stock_id = inv.StockId
        AND lraa.status = 'active'
      WHERE inv.StockId = ? AND inv.tenant_id = ?
      LIMIT 1
    `).bind(stockId, tenantId).first();
  } catch {
    try {
      return await db.$client.prepare(`
        SELECT
          inv.StockId as stock_id,
          inv.ItemId as item_id,
          inv.StoreId as store_id,
          inv.BatchNo as batch_no,
          inv.AvailableQuantity as available_quantity,
          inv.QCStatus as qc_status,
          inv.StockStatus as stock_status,
          lraa.id as active_assignment_id,
          lraa.machine_id as assigned_machine_id,
          lraa.location_id as assigned_location_id,
          lc.id as consumable_id
        FROM InventoryStock inv
        JOIN lab_consumables lc ON lc.tenant_id = inv.tenant_id
          AND lc.inventory_item_id = inv.ItemId
          AND lc.is_active = 1
        LEFT JOIN lab_reagent_analyzer_assignments lraa ON lraa.tenant_id = inv.tenant_id
          AND lraa.stock_id = inv.StockId
          AND lraa.status = 'active'
        WHERE inv.StockId = ? AND inv.tenant_id = ?
        LIMIT 1
      `).bind(stockId, tenantId).first();
    } catch {
      return null;
    }
  }
}
async function loadLabMachineForAssignment(db, tenantId, machineId) {
  try {
    return await db.$client.prepare(`
      SELECT id, machine_name, machine_code
      FROM lab_machines
      WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(machineId, tenantId).first();
  } catch {
    try {
      return await db.$client.prepare(`
        SELECT id
        FROM lab_machines
        WHERE id = ?
        LIMIT 1
      `).bind(machineId).first();
    } catch {
      return null;
    }
  }
}
async function loadLabStockLocationForAssignment(db, tenantId, locationId) {
  try {
    return await db.$client.prepare(`
      SELECT id, location_name, location_type
      FROM lab_consumable_locations
      WHERE id = ? AND tenant_id = ? AND is_active = 1
      LIMIT 1
    `).bind(locationId, tenantId).first();
  } catch {
    return null;
  }
}
function inventoryStockStatusForQc(qcStatus) {
  return qcStatus === "failed" || qcStatus === "pending" ? "blocked" : "available";
}
async function logInventoryMetadataAudit(db, input) {
  try {
    await db.$client.prepare(`
      INSERT INTO InventoryAuditLog
        (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
         ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
      VALUES (?, ?, 'InventoryStock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      input.tenantId,
      input.action,
      input.stock.stock_id,
      input.stock.item_id,
      input.stock.stock_id,
      input.stock.batch_no ?? null,
      input.stock.store_id ?? null,
      input.referenceType,
      input.stock.stock_id,
      JSON.stringify(input.oldValue),
      JSON.stringify(input.newValue),
      input.userId
    ).run();
  } catch {
  }
}
const analyzerAssignmentSchema = z.object({
  machine_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  remarks: z.string().max(500).optional()
}).refine((data) => Boolean(data.machine_id || data.location_id), {
  message: "Select analyzer machine or analyzer location"
});
labMonitoring.post("/stock/:stockId/analyzer-assignment", labInventoryOperatorOnly, zValidator("json", analyzerAssignmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const stockId = parseId(c.req.param("stockId"));
  const data = c.req.valid("json");
  const inventoryStock = await loadLinkedInventoryLabStock(db, tenantId, stockId);
  if (!inventoryStock) throw new HTTPException(404, { message: "Linked inventory reagent stock lot not found" });
  const machine = data.machine_id ? await loadLabMachineForAssignment(db, tenantId, data.machine_id) : null;
  if (data.machine_id && !machine) throw new HTTPException(404, { message: "Analyzer machine not found" });
  const location = data.location_id ? await loadLabStockLocationForAssignment(db, tenantId, data.location_id) : null;
  if (data.location_id && !location) throw new HTTPException(404, { message: "Analyzer location not found" });
  await db.$client.prepare(`
    UPDATE lab_reagent_analyzer_assignments
    SET status = 'ended',
        unassigned_at = datetime('now'),
        unassigned_by = ?,
        updated_at = datetime('now')
    WHERE tenant_id = ? AND stock_id = ? AND status = 'active'
  `).bind(userId, tenantId, stockId).run();
  const result = await db.$client.prepare(`
    INSERT INTO lab_reagent_analyzer_assignments
      (tenant_id, stock_id, inventory_item_id, consumable_id, machine_id, location_id,
       status, assigned_by, remarks, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
  `).bind(
    tenantId,
    stockId,
    inventoryStock.item_id,
    inventoryStock.consumable_id,
    data.machine_id ?? null,
    data.location_id ?? null,
    userId,
    data.remarks ?? null
  ).run();
  await db.$client.prepare(`
    UPDATE InventoryStock
    SET ModifiedBy = ?, ModifiedOn = datetime('now')
    WHERE StockId = ? AND tenant_id = ?
  `).bind(userId, stockId, tenantId).run();
  await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_type, consumable_id, quantity, machine_id, description, performed_by, tenant_id)
    VALUES ('machine_run', ?, 1, ?, ?, ?, ?)
  `).bind(
    inventoryStock.consumable_id,
    data.machine_id ?? null,
    `InventoryStock lot ${stockId} assigned to analyzer${machine?.machine_name ? ` ${machine.machine_name}` : ""}${location?.location_name ? ` at ${location.location_name}` : ""}${data.remarks ? `: ${data.remarks}` : ""}`,
    userId,
    tenantId
  ).run();
  await logInventoryMetadataAudit(db, {
    tenantId,
    userId,
    stock: inventoryStock,
    action: "lab_reagent_analyzer_assignment",
    referenceType: "lab_reagent_analyzer_assignment",
    oldValue: {
      assignment_id: inventoryStock.active_assignment_id ?? null,
      machine_id: inventoryStock.assigned_machine_id ?? null,
      location_id: inventoryStock.assigned_location_id ?? null
    },
    newValue: {
      assignment_id: result.meta.last_row_id,
      machine_id: data.machine_id ?? null,
      location_id: data.location_id ?? null,
      remarks: data.remarks ?? null
    }
  });
  return c.json({
    id: result.meta.last_row_id,
    message: "Analyzer assignment updated",
    ledger_type: "inventory",
    stock_id: stockId,
    machine_id: data.machine_id ?? null,
    location_id: data.location_id ?? null
  }, 201);
});
const stockQcSchema = z.object({
  qc_status: z.enum(["pending", "passed", "failed", "not_required"]),
  remarks: z.string().optional(),
  ledger_type: z.enum(["lab", "inventory"]).optional()
});
labMonitoring.post("/stock/:stockId/qc", labInventoryOperatorOnly, zValidator("json", stockQcSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const stockId = parseId(c.req.param("stockId"));
  const data = c.req.valid("json");
  const stock = data.ledger_type === "inventory" ? null : await db.$client.prepare(`
    SELECT id, consumable_id
    FROM lab_consumable_stock
    WHERE id = ? AND tenant_id = ?
  `).bind(stockId, tenantId).first();
  if (stock) {
    const result2 = await db.$client.prepare(`
      UPDATE lab_consumable_stock
      SET qc_status = ?,
          qc_checked_at = datetime('now', '+6 hours'),
          qc_checked_by = ?,
          qc_remarks = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(data.qc_status, userId, data.remarks ?? null, stockId, tenantId).run();
    if (!result2.meta.changes) throw new HTTPException(404, { message: "Stock lot not found" });
    await db.$client.prepare(`
      INSERT INTO lab_operation_logs
        (log_type, consumable_id, quantity, description, performed_by, tenant_id)
      VALUES ('qc_performed', ?, 1, ?, ?, ?)
    `).bind(
      stock.consumable_id,
      `QC ${data.qc_status} for stock lot ${stockId}${data.remarks ? `: ${data.remarks}` : ""}`,
      userId,
      tenantId
    ).run();
    return c.json({ message: "QC status updated", qc_status: data.qc_status, ledger_type: "lab" });
  }
  const inventoryStock = await loadLinkedInventoryLabStock(db, tenantId, stockId);
  if (!inventoryStock) throw new HTTPException(404, { message: "Stock lot not found" });
  const nextStockStatus = inventoryStockStatusForQc(data.qc_status);
  const result = await db.$client.prepare(`
    UPDATE InventoryStock
    SET QCStatus = ?,
        StockStatus = ?,
        ModifiedBy = ?,
        ModifiedOn = datetime('now')
    WHERE StockId = ? AND tenant_id = ?
  `).bind(data.qc_status, nextStockStatus, userId, stockId, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Stock lot not found" });
  await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_type, consumable_id, quantity, description, performed_by, tenant_id)
    VALUES ('qc_performed', ?, 1, ?, ?, ?)
  `).bind(
    inventoryStock.consumable_id,
    `InventoryStock lot ${stockId} QC ${data.qc_status}${data.remarks ? `: ${data.remarks}` : ""}`,
    userId,
    tenantId
  ).run();
  await logInventoryMetadataAudit(db, {
    tenantId,
    userId,
    stock: inventoryStock,
    action: "lab_reagent_qc_update",
    referenceType: "lab_reagent_qc",
    oldValue: { QCStatus: inventoryStock.qc_status ?? null, StockStatus: inventoryStock.stock_status ?? null },
    newValue: { QCStatus: data.qc_status, StockStatus: nextStockStatus, remarks: data.remarks ?? null }
  });
  return c.json({ message: "QC status updated", qc_status: data.qc_status, stock_status: nextStockStatus, ledger_type: "inventory" });
});
const stockOpenSchema = z.object({
  onboard_expiry_days: z.number().int().min(1).max(365),
  remarks: z.string().max(500).optional(),
  ledger_type: z.enum(["lab", "inventory"]).optional()
});
labMonitoring.post("/stock/:stockId/open", labInventoryOperatorOnly, zValidator("json", stockOpenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const stockId = parseId(c.req.param("stockId"));
  const data = c.req.valid("json");
  const stock = data.ledger_type === "inventory" ? null : await db.$client.prepare(`
    SELECT id, consumable_id
    FROM lab_consumable_stock
    WHERE id = ? AND tenant_id = ?
  `).bind(stockId, tenantId).first();
  const inventoryStock = data.ledger_type === "lab" ? null : await loadLinkedInventoryLabStock(db, tenantId, stockId);
  if (!data.ledger_type && stock && inventoryStock) {
    throw new HTTPException(409, { message: "Stock lot id matches both lab and inventory ledgers; provide ledger_type to open the correct lot" });
  }
  if (stock) {
    const result2 = await db.$client.prepare(`
      UPDATE lab_consumable_stock
      SET opened_at = datetime('now', '+6 hours'),
          opened_by = ?,
          onboard_expiry_days = ?,
          onboard_expires_at = date('now', '+6 hours', '+' || ? || ' days'),
          opened_remarks = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      userId,
      data.onboard_expiry_days,
      data.onboard_expiry_days,
      data.remarks ?? null,
      stockId,
      tenantId
    ).run();
    if (!result2.meta.changes) throw new HTTPException(404, { message: "Stock lot not found" });
    await db.$client.prepare(`
      INSERT INTO lab_operation_logs
        (log_type, consumable_id, quantity, description, performed_by, tenant_id)
      VALUES ('stock_opened', ?, 1, ?, ?, ?)
    `).bind(
      stock.consumable_id,
      `Stock lot ${stockId} opened for ${data.onboard_expiry_days} days${data.remarks ? `: ${data.remarks}` : ""}`,
      userId,
      tenantId
    ).run();
    const openedLot = await db.$client.prepare(`
      SELECT opened_at, onboard_expires_at
      FROM lab_consumable_stock
      WHERE id = ? AND tenant_id = ?
    `).bind(stockId, tenantId).first();
    return c.json({
      message: "Stock lot opened",
      onboard_expiry_days: data.onboard_expiry_days,
      opened_at: openedLot?.opened_at ?? null,
      onboard_expires_at: openedLot?.onboard_expires_at ?? null,
      ledger_type: "lab"
    });
  }
  if (!inventoryStock) throw new HTTPException(404, { message: "Stock lot not found" });
  const result = await db.$client.prepare(`
    UPDATE InventoryStock
    SET OpenDate = date('now', '+6 hours'),
        AfterOpenExpiryDate = date('now', '+6 hours', '+' || ? || ' days'),
        ModifiedBy = ?,
        ModifiedOn = datetime('now', '+6 hours')
    WHERE StockId = ? AND tenant_id = ?
  `).bind(data.onboard_expiry_days, userId, stockId, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Stock lot not found" });
  await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_type, consumable_id, quantity, description, performed_by, tenant_id)
    VALUES ('stock_opened', ?, 1, ?, ?, ?)
  `).bind(
    inventoryStock.consumable_id,
    `InventoryStock lot ${stockId} opened for ${data.onboard_expiry_days} days${data.remarks ? `: ${data.remarks}` : ""}`,
    userId,
    tenantId
  ).run();
  const openedInventoryLot = await db.$client.prepare(`
    SELECT OpenDate, AfterOpenExpiryDate
    FROM InventoryStock
    WHERE StockId = ? AND tenant_id = ?
  `).bind(stockId, tenantId).first();
  await logInventoryMetadataAudit(db, {
    tenantId,
    userId,
    stock: inventoryStock,
    action: "lab_reagent_open_vial",
    referenceType: "lab_reagent_open_vial",
    oldValue: {
      OpenDate: inventoryStock.open_date ?? null,
      AfterOpenExpiryDate: inventoryStock.after_open_expiry_date ?? null
    },
    newValue: {
      onboard_expiry_days: data.onboard_expiry_days,
      OpenDate: openedInventoryLot?.OpenDate ?? null,
      AfterOpenExpiryDate: openedInventoryLot?.AfterOpenExpiryDate ?? null,
      remarks: data.remarks ?? null
    }
  });
  return c.json({
    message: "Stock lot opened",
    onboard_expiry_days: data.onboard_expiry_days,
    opened_at: openedInventoryLot?.OpenDate ?? null,
    onboard_expires_at: openedInventoryLot?.AfterOpenExpiryDate ?? null,
    ledger_type: "inventory"
  });
});
const stockTransferSchema = z.object({
  target_location_id: z.number().int().positive(),
  remarks: z.string().optional()
});
labMonitoring.post("/stock/:stockId/transfer-location", labInventoryOperatorOnly, zValidator("json", stockTransferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const stockId = parseId(c.req.param("stockId"));
  const data = c.req.valid("json");
  const targetLocation = await db.$client.prepare(`
    SELECT id, location_name
    FROM lab_consumable_locations
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(data.target_location_id, tenantId).first();
  if (!targetLocation) throw new HTTPException(404, { message: "Target stock location not found" });
  const stock = await db.$client.prepare(`
    SELECT id, consumable_id, location_id, quantity_available, purchase_price
    FROM lab_consumable_stock
    WHERE id = ? AND tenant_id = ?
  `).bind(stockId, tenantId).first();
  if (!stock) throw new HTTPException(404, { message: "Stock lot not found" });
  if (Number(stock.quantity_available || 0) <= 0) {
    throw new HTTPException(400, { message: "Only stock lots with available quantity can be transferred" });
  }
  if (Number(stock.location_id || 0) === data.target_location_id) {
    throw new HTTPException(400, { message: "Stock lot is already in the selected location" });
  }
  const result = await db.$client.prepare(`
    UPDATE lab_consumable_stock
    SET location_id = ?
    WHERE id = ? AND tenant_id = ? AND quantity_available > 0
  `).bind(data.target_location_id, stockId, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(409, { message: "Stock lot changed while transferring. Please retry." });
  const quantity = Number(stock.quantity_available || 0);
  const unitCost = Number(stock.purchase_price || 0);
  const transferRemarks = data.remarks ?? `Transferred stock lot ${stockId} to ${targetLocation.location_name}`;
  await db.$client.prepare(`
    INSERT INTO lab_consumable_movements
      (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
    VALUES (?, ?, 'transfer_out', ?, ?, 'location_transfer', ?, ?, ?, ?)
  `).bind(stock.consumable_id, stockId, quantity, unitCost, stockId, userId, transferRemarks, tenantId).run();
  await db.$client.prepare(`
    INSERT INTO lab_consumable_movements
      (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
    VALUES (?, ?, 'transfer_in', ?, ?, 'location_transfer', ?, ?, ?, ?)
  `).bind(stock.consumable_id, stockId, quantity, unitCost, stockId, userId, transferRemarks, tenantId).run();
  return c.json({ message: "Stock lot transferred", stock_id: stockId, target_location_id: data.target_location_id });
});
const stockOutSchema = z.object({
  consumable_id: z.number().int().positive(),
  quantity: z.number().int().positive(),
  reference_type: z.string().optional(),
  reference_id: z.number().int().optional(),
  remarks: z.string().optional(),
  location_id: z.number().int().positive().optional()
});
labMonitoring.post("/stock/out", labInventoryOperatorOnly, zValidator("json", stockOutSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const result = await consumeLabConsumableStock(db.$client, {
    tenantId,
    userId,
    consumableId: data.consumable_id,
    quantity: data.quantity,
    referenceType: data.reference_type ?? "manual",
    referenceId: data.reference_id ?? null,
    remarks: data.remarks ?? "Stock used",
    locationId: data.location_id
  });
  return c.json({ message: "Stock deducted", quantity_used: result.quantity_used });
});
const wasteReasonSchema = z.enum(["expired", "broken", "qc_failed", "spillage", "temperature_breach", "other"]);
const wasteRemarksSchema = z.string().trim().max(500).optional().transform((value) => value || void 0);
const wasteStatusSchema = z.enum(["pending", "approved", "rejected", "all"]);
const wasteRequestSchema = z.object({
  stock_id: z.number().int().positive(),
  quantity: z.number().int().positive(),
  reason: wasteReasonSchema,
  remarks: wasteRemarksSchema
}).superRefine((data, ctx) => {
  if (data.reason === "other" && !data.remarks) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["remarks"], message: "Remarks are required when waste reason is other" });
  }
});
const wasteReviewSchema = z.object({
  review_remarks: wasteRemarksSchema
});
labMonitoring.get("/stock/waste-requests", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const parsedStatus = wasteStatusSchema.safeParse(c.req.query("status") ?? "pending");
  if (!parsedStatus.success) throw new HTTPException(400, { message: "Invalid waste request status filter" });
  const status = parsedStatus.data;
  let where = "WHERE wr.tenant_id = ?";
  const params = [tenantId];
  if (status !== "all") {
    where += " AND wr.status = ?";
    params.push(status);
  }
  const rows = await db.$client.prepare(`
    SELECT wr.*,
      c.name as consumable_name,
      c.code as consumable_code,
      s.lot_number,
      s.expiry_date,
      s.quantity_available,
      l.location_name,
      requested_by_user.name as requested_by_name,
      reviewed_by_user.name as reviewed_by_name
    FROM lab_consumable_waste_requests wr
    JOIN lab_consumables c ON c.id = wr.consumable_id AND c.tenant_id = wr.tenant_id
    JOIN lab_consumable_stock s ON s.id = wr.stock_id AND s.tenant_id = wr.tenant_id
    LEFT JOIN lab_consumable_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
    LEFT JOIN users requested_by_user ON requested_by_user.id = wr.requested_by
    LEFT JOIN users reviewed_by_user ON reviewed_by_user.id = wr.reviewed_by
    ${where}
    ORDER BY wr.requested_at DESC
    LIMIT 100
  `).bind(...params).all();
  return c.json({ data: rows.results });
});
labMonitoring.post("/stock/waste-requests", labInventoryOperatorOnly, zValidator("json", wasteRequestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const stock = await db.$client.prepare(`
    SELECT s.id, s.consumable_id, s.quantity_available
    FROM lab_consumable_stock s
    WHERE s.id = ? AND s.tenant_id = ?
  `).bind(data.stock_id, tenantId).first();
  if (!stock) throw new HTTPException(404, { message: "Stock lot not found" });
  if (Number(stock.quantity_available || 0) < data.quantity) {
    throw new HTTPException(400, { message: "Waste quantity exceeds available stock" });
  }
  const result = await db.$client.prepare(`
    INSERT INTO lab_consumable_waste_requests
      (stock_id, consumable_id, quantity, reason, remarks, status, requested_by, tenant_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    data.stock_id,
    stock.consumable_id,
    data.quantity,
    data.reason,
    data.remarks ?? null,
    userId,
    tenantId
  ).run();
  return c.json({ id: result.meta.last_row_id, status: "pending", message: "Waste request submitted" }, 201);
});
labMonitoring.post("/stock/waste-requests/:requestId/approve", labInventoryManagerOnly, zValidator("json", wasteReviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const requestId = parseId(c.req.param("requestId"));
  const data = c.req.valid("json");
  const request = await db.$client.prepare(`
    SELECT wr.*, s.quantity_available, s.purchase_price, c.unit_price
    FROM lab_consumable_waste_requests wr
    JOIN lab_consumable_stock s ON s.id = wr.stock_id AND s.tenant_id = wr.tenant_id
    LEFT JOIN lab_consumables c ON c.id = wr.consumable_id AND c.tenant_id = wr.tenant_id
    WHERE wr.id = ? AND wr.tenant_id = ? AND wr.status = 'pending'
  `).bind(requestId, tenantId).first();
  if (!request) throw new HTTPException(404, { message: "Pending waste request not found" });
  if (Number(request.quantity_available || 0) < Number(request.quantity || 0)) {
    throw new HTTPException(409, { message: "Waste request quantity is no longer available in stock" });
  }
  const stockUpdate = await db.$client.prepare(`
    UPDATE lab_consumable_stock
    SET quantity_wasted = quantity_wasted + ?
    WHERE id = ? AND tenant_id = ? AND quantity_available >= ?
  `).bind(request.quantity, request.stock_id, tenantId, request.quantity).run();
  if (!stockUpdate.meta.changes) {
    throw new HTTPException(409, { message: "Stock changed while approving waste request. Please retry." });
  }
  await db.$client.prepare(`
    UPDATE lab_consumable_waste_requests
    SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_remarks = ?
    WHERE id = ? AND tenant_id = ? AND status = 'pending'
  `).bind(userId, data.review_remarks ?? null, requestId, tenantId).run();
  const unitCost = Number(request.purchase_price ?? request.unit_price ?? 0);
  await db.$client.prepare(`
    INSERT INTO lab_consumable_movements
      (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
    VALUES (?, ?, 'waste', ?, ?, 'waste_request', ?, ?, ?, ?)
  `).bind(
    request.consumable_id,
    request.stock_id,
    request.quantity,
    unitCost,
    requestId,
    userId,
    `${request.reason}${request.remarks ? `: ${request.remarks}` : ""}`,
    tenantId
  ).run();
  await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_type, consumable_id, quantity, description, performed_by, tenant_id)
    VALUES ('waste_disposed', ?, ?, ?, ?, ?)
  `).bind(
    request.consumable_id,
    request.quantity,
    `Approved waste request ${requestId}: ${request.reason}`,
    userId,
    tenantId
  ).run();
  return c.json({ message: "Waste request approved", quantity_wasted: request.quantity });
});
labMonitoring.post("/stock/waste-requests/:requestId/reject", labInventoryManagerOnly, zValidator("json", wasteReviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const requestId = parseId(c.req.param("requestId"));
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    UPDATE lab_consumable_waste_requests
    SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_remarks = ?
    WHERE id = ? AND tenant_id = ? AND status = 'pending'
  `).bind(userId, data.review_remarks ?? null, requestId, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Pending waste request not found" });
  return c.json({ message: "Waste request rejected" });
});
const testConsumableMapSchema = z.object({
  lab_test_id: z.number().int().positive(),
  consumable_id: z.number().int().positive(),
  qty_per_test: z.number().positive().default(1),
  is_mandatory: z.boolean().default(true),
  notes: z.string().optional()
});
const bulkTestConsumableMapSchema = z.object({
  mappings: z.array(testConsumableMapSchema).min(1).max(500)
});
const testConsumableMapUpdateSchema = z.object({
  qty_per_test: z.number().positive().optional(),
  is_mandatory: z.boolean().optional(),
  notes: z.string().optional().nullable()
}).refine((data) => data.qty_per_test !== void 0 || data.is_mandatory !== void 0 || data.notes !== void 0, {
  message: "Provide at least one mapping field to update"
});
async function assertTestConsumableMapReferences(dbClient, tenantId, mapping) {
  const labTest = await dbClient.prepare(`
    SELECT id
    FROM lab_test_catalog
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(mapping.lab_test_id, tenantId).first();
  if (!labTest?.id) {
    throw new HTTPException(400, { message: `Unknown or inactive lab test id ${mapping.lab_test_id}` });
  }
  const consumable = await dbClient.prepare(`
    SELECT id
    FROM lab_consumables
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(mapping.consumable_id, tenantId).first();
  if (!consumable?.id) {
    throw new HTTPException(400, { message: `Unknown or inactive reagent/consumable id ${mapping.consumable_id}` });
  }
}
labMonitoring.get("/mapping-coverage", async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStatus = c.req.query("status") || "all";
  const status = ["all", "mapped", "missing"].includes(requestedStatus) ? requestedStatus : "all";
  const includeOutsourced = c.req.query("include_outsourced") === "true";
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 500), 1), 1e3);
  const coverageTargetMin = 95;
  let mappingCoverageResult;
  try {
    mappingCoverageResult = await c.env.DB.prepare(`
      SELECT
        t.id,
        t.code,
        t.name,
        t.category,
        t.department,
        t.test_type,
        COALESCE(m.mapping_count, 0) AS mapping_count,
        COALESCE(m.mandatory_count, 0) AS mandatory_count,
        COALESCE(m.expected_quantity, 0) AS expected_quantity
      FROM lab_test_catalog t
      JOIN billing_service_items si
        ON si.id = t.billing_service_item_id
       AND si.tenant_id = t.tenant_id
       AND COALESCE(si.is_active, 1) = 1
      LEFT JOIN (
        SELECT tenant_id, lab_test_id,
          COUNT(1) AS mapping_count,
          SUM(CASE WHEN COALESCE(is_mandatory, 1) = 1 THEN 1 ELSE 0 END) as mandatory_count,
          COALESCE(SUM(qty_per_test), 0) AS expected_quantity
        FROM lab_test_consumable_map
        WHERE COALESCE(is_active, 1) = 1
          AND (effective_from IS NULL OR datetime(effective_from) <= CURRENT_TIMESTAMP)
          AND (effective_to IS NULL OR datetime(effective_to) > CURRENT_TIMESTAMP)
        GROUP BY tenant_id, lab_test_id
      ) m ON m.tenant_id = t.tenant_id AND m.lab_test_id = t.id
      WHERE t.tenant_id = ?
        AND COALESCE(t.is_active, 1) = 1
        AND t.billing_service_item_id IS NOT NULL
        AND (? = 1 OR COALESCE(t.is_outsourced, 0) = 0)
      ORDER BY CASE WHEN COALESCE(m.mapping_count, 0) = 0 THEN 0 ELSE 1 END, t.name, t.id
      LIMIT ?
    `).bind(String(tenantId), includeOutsourced ? 1 : 0, limit).all();
  } catch {
    mappingCoverageResult = await c.env.DB.prepare(`
      SELECT
        t.id,
        t.code,
        t.name,
        t.category,
        t.department,
        t.test_type,
        COALESCE(m.mapping_count, 0) AS mapping_count,
        COALESCE(m.mandatory_count, 0) AS mandatory_count,
        COALESCE(m.expected_quantity, 0) AS expected_quantity
      FROM lab_test_catalog t
      LEFT JOIN (
        SELECT tenant_id, lab_test_id,
          COUNT(1) AS mapping_count,
          SUM(CASE WHEN COALESCE(is_mandatory, 1) = 1 THEN 1 ELSE 0 END) as mandatory_count,
          COALESCE(SUM(qty_per_test), 0) AS expected_quantity
        FROM lab_test_consumable_map
        WHERE COALESCE(is_active, 1) = 1
          AND (effective_from IS NULL OR datetime(effective_from) <= CURRENT_TIMESTAMP)
          AND (effective_to IS NULL OR datetime(effective_to) > CURRENT_TIMESTAMP)
        GROUP BY tenant_id, lab_test_id
      ) m ON m.tenant_id = t.tenant_id AND m.lab_test_id = t.id
      WHERE t.tenant_id = ?
        AND COALESCE(t.is_active, 1) = 1
        AND (? = 1 OR COALESCE(t.is_outsourced, 0) = 0)
      ORDER BY CASE WHEN COALESCE(m.mapping_count, 0) = 0 THEN 0 ELSE 1 END, t.name, t.id
      LIMIT ?
    `).bind(String(tenantId), includeOutsourced ? 1 : 0, limit).all();
  }
  const { results } = mappingCoverageResult;
  const rows = (results ?? []).map((row) => {
    const mappingCount = Number(row.mapping_count ?? 0);
    return {
      lab_test_id: Number(row.id),
      code: row.code,
      name: row.name,
      category: row.category,
      department: row.department,
      test_type: row.test_type,
      mapping_count: mappingCount,
      mandatory_count: Number(row.mandatory_count ?? 0),
      expected_quantity: Number(row.expected_quantity ?? 0),
      status: mappingCount > 0 ? "mapped" : "missing"
    };
  });
  const filtered = status === "all" ? rows : rows.filter((row) => row.status === status);
  const summary = rows.reduce((acc, row) => {
    acc.total_tests += 1;
    acc.expected_quantity += row.expected_quantity;
    if (row.status === "mapped") acc.mapped_tests += 1;
    if (row.status === "missing") acc.missing_tests += 1;
    return acc;
  }, { total_tests: 0, mapped_tests: 0, missing_tests: 0, expected_quantity: 0 });
  const coveragePercent = summary.total_tests > 0 ? Math.round(summary.mapped_tests / summary.total_tests * 1e4) / 100 : 0;
  let qcFailedLotRow;
  try {
    qcFailedLotRow = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(failed_count), 0) AS qc_failed_usable_lot_count
      FROM (
        SELECT COUNT(1) AS failed_count
        FROM lab_consumable_stock s
        JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
          AND COALESCE(c.is_active, 1) = 1
          AND s.quantity_available > 0
          AND LOWER(COALESCE(s.qc_status, 'not_required')) = 'failed'
          AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE)
          AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
        UNION ALL
        SELECT COUNT(1) AS failed_count
        FROM InventoryStock inv
        JOIN lab_consumables c ON c.inventory_item_id = inv.ItemId AND c.tenant_id = inv.tenant_id
        WHERE inv.tenant_id = ?
          AND COALESCE(c.is_active, 1) = 1
          AND COALESCE(inv.IsActive, 1) = 1
          AND inv.AvailableQuantity > 0
          AND COALESCE(inv.StockStatus, 'available') = 'available'
          AND LOWER(COALESCE(inv.QCStatus, 'accepted')) IN ('failed', 'rejected')
          AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) >= CURRENT_DATE)
          AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) >= CURRENT_DATE)
      )
    `).bind(String(tenantId), String(tenantId)).first();
  } catch {
    qcFailedLotRow = await c.env.DB.prepare(`
      SELECT COUNT(1) AS qc_failed_usable_lot_count
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND COALESCE(c.is_active, 1) = 1
        AND s.quantity_available > 0
        AND LOWER(COALESCE(s.qc_status, 'not_required')) = 'failed'
        AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
    `).bind(String(tenantId)).first();
  }
  const stockShortageExceptionRow = await c.env.DB.prepare(`
    SELECT COUNT(1) AS open_stock_shortage_exceptions
    FROM lab_inventory_exceptions
    WHERE tenant_id = ?
      AND status = 'open'
      AND reason = 'insufficient_stock'
  `).bind(String(tenantId)).first();
  const qcFailedUsableLots = Number(qcFailedLotRow?.qc_failed_usable_lot_count ?? 0);
  const openStockShortageExceptions = Number(stockShortageExceptionRow?.open_stock_shortage_exceptions ?? 0);
  const strictModeReady = summary.total_tests > 0 && coveragePercent >= coverageTargetMin && summary.missing_tests === 0 && qcFailedUsableLots === 0 && openStockShortageExceptions === 0;
  return c.json({
    status,
    include_outsourced: includeOutsourced,
    data: filtered,
    summary: {
      ...summary,
      coverage_percent: coveragePercent,
      coverage_target_min: coverageTargetMin,
      qc_failed_usable_lots: qcFailedUsableLots,
      open_stock_shortage_exceptions: openStockShortageExceptions,
      strict_mode_ready: strictModeReady
    }
  });
});
labMonitoring.get("/test-consumable-map", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const testId = c.req.query("test_id");
  let where = `WHERE m.tenant_id = ?
    AND COALESCE(m.is_active, 1) = 1
    AND (m.effective_from IS NULL OR datetime(m.effective_from) <= CURRENT_TIMESTAMP)
    AND (m.effective_to IS NULL OR datetime(m.effective_to) > CURRENT_TIMESTAMP)`;
  const params = [tenantId];
  if (testId) {
    where += " AND m.lab_test_id = ?";
    params.push(Number(testId));
  }
  const rows = await db.$client.prepare(`
    SELECT m.*, c.name as consumable_name, c.code as consumable_code, c.unit, c.category,
      t.name as test_name, t.code as test_code
    FROM lab_test_consumable_map m
    JOIN lab_consumables c ON m.consumable_id = c.id AND c.tenant_id = m.tenant_id
    JOIN lab_test_catalog t ON m.lab_test_id = t.id AND t.tenant_id = m.tenant_id
    ${where}
    ORDER BY t.name, c.name
  `).bind(...params).all();
  return c.json({ data: rows.results });
});
labMonitoring.post("/test-consumable-map/bulk", labInventoryManagerOnly, zValidator("json", bulkTestConsumableMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const validationSeen = /* @__PURE__ */ new Set();
  for (const mapping of data.mappings) {
    const key = `${mapping.lab_test_id}:${mapping.consumable_id}`;
    if (validationSeen.has(key)) continue;
    validationSeen.add(key);
    await assertTestConsumableMapReferences(db.$client, tenantId, mapping);
  }
  const seen = /* @__PURE__ */ new Set();
  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let skipped = 0;
  const details = [];
  for (const mapping of data.mappings) {
    const key = `${mapping.lab_test_id}:${mapping.consumable_id}`;
    if (seen.has(key)) {
      skipped += 1;
      details.push({ lab_test_id: mapping.lab_test_id, consumable_id: mapping.consumable_id, status: "duplicate_in_payload" });
      continue;
    }
    seen.add(key);
    const existing = await db.$client.prepare(`
      SELECT id, COALESCE(is_active, 1) as is_active
      FROM lab_test_consumable_map
      WHERE lab_test_id = ? AND consumable_id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(mapping.lab_test_id, mapping.consumable_id, tenantId).first();
    if (existing?.id) {
      await db.$client.prepare(`
        UPDATE lab_test_consumable_map
        SET qty_per_test = ?,
            is_mandatory = ?,
            notes = ?,
            is_active = 1,
            effective_from = CASE WHEN COALESCE(is_active, 1) = 0 THEN CURRENT_TIMESTAMP ELSE effective_from END,
            effective_to = NULL,
            deleted_at = NULL,
            deleted_by = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?
      `).bind(mapping.qty_per_test, mapping.is_mandatory ? 1 : 0, mapping.notes ?? null, existing.id, tenantId).run();
      const wasInactive = Number(existing.is_active ?? 1) === 0;
      if (wasInactive) reactivated += 1;
      else updated += 1;
      details.push({ lab_test_id: mapping.lab_test_id, consumable_id: mapping.consumable_id, status: wasInactive ? "reactivated" : "updated", id: existing.id });
      continue;
    }
    const result = await db.$client.prepare(`
      INSERT INTO lab_test_consumable_map
        (lab_test_id, consumable_id, qty_per_test, is_mandatory, notes, tenant_id, effective_from, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(mapping.lab_test_id, mapping.consumable_id, mapping.qty_per_test, mapping.is_mandatory ? 1 : 0, mapping.notes ?? null, tenantId).run();
    created += 1;
    details.push({ lab_test_id: mapping.lab_test_id, consumable_id: mapping.consumable_id, status: "created", id: Number(result.meta.last_row_id ?? 0) });
  }
  void createAuditLog(c.env, tenantId, userId, "UPDATE", "lab_test_consumable_map", 0, null, {
    created,
    updated,
    reactivated,
    skipped,
    count: data.mappings.length
  });
  return c.json({ message: "Bulk mapping import completed", summary: { created, updated, reactivated, skipped, total: data.mappings.length }, details }, 201);
});
labMonitoring.post("/test-consumable-map", labInventoryManagerOnly, zValidator("json", testConsumableMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid("json");
  await assertTestConsumableMapReferences(db.$client, tenantId, data);
  const existing = await db.$client.prepare(`
    SELECT id, COALESCE(is_active, 1) as is_active
    FROM lab_test_consumable_map
    WHERE lab_test_id = ? AND consumable_id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(data.lab_test_id, data.consumable_id, tenantId).first();
  if (existing?.id) {
    if (Number(existing.is_active ?? 1) === 1) {
      throw new HTTPException(409, { message: "Mapping already exists for this test and consumable" });
    }
    await db.$client.prepare(`
      UPDATE lab_test_consumable_map
      SET qty_per_test = ?,
          is_mandatory = ?,
          notes = ?,
          is_active = 1,
          effective_from = CURRENT_TIMESTAMP,
          effective_to = NULL,
          deleted_at = NULL,
          deleted_by = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(data.qty_per_test, data.is_mandatory ? 1 : 0, data.notes ?? null, existing.id, tenantId).run();
    return c.json({ id: existing.id, message: "Mapping reactivated" });
  }
  const result = await db.$client.prepare(`
    INSERT INTO lab_test_consumable_map
      (lab_test_id, consumable_id, qty_per_test, is_mandatory, notes, tenant_id, effective_from, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(data.lab_test_id, data.consumable_id, data.qty_per_test, data.is_mandatory ? 1 : 0, data.notes ?? null, tenantId).run();
  return c.json({ id: result.meta.last_row_id, message: "Mapping created" }, 201);
});
labMonitoring.put("/test-consumable-map/:id", labInventoryManagerOnly, zValidator("json", testConsumableMapUpdateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param("id"));
  const data = c.req.valid("json");
  const existing = await db.$client.prepare(`
    SELECT id FROM lab_test_consumable_map
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(id, tenantId).first();
  if (!existing?.id) throw new HTTPException(404, { message: "Mapping not found" });
  await db.$client.prepare(`
    UPDATE lab_test_consumable_map
    SET qty_per_test = COALESCE(?, qty_per_test),
        is_mandatory = COALESCE(?, is_mandatory),
        notes = CASE WHEN ? THEN ? ELSE notes END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
  `).bind(
    data.qty_per_test ?? null,
    data.is_mandatory === void 0 ? null : data.is_mandatory ? 1 : 0,
    data.notes !== void 0 ? 1 : 0,
    data.notes ?? null,
    id,
    tenantId
  ).run();
  return c.json({ id, message: "Mapping updated" });
});
labMonitoring.delete("/test-consumable-map/:id", labInventoryManagerOnly, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param("id"));
  const userId = requireUserId(c);
  const result = await db.$client.prepare(`
    UPDATE lab_test_consumable_map
    SET is_active = 0,
        effective_to = CURRENT_TIMESTAMP,
        deleted_at = CURRENT_TIMESTAMP,
        deleted_by = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
  `).bind(userId, id, tenantId).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new HTTPException(404, { message: "Mapping not found" });
  }
  return c.json({ message: "Mapping removed" });
});
const operationLogSchema = z.object({
  log_type: z.enum(["test_performed", "reagent_used", "film_used", "print_made", "machine_run", "qc_performed", "calibration", "maintenance", "waste_disposed"]),
  lab_test_id: z.number().int().positive().optional(),
  consumable_id: z.number().int().positive().optional(),
  lab_order_id: z.number().int().positive().optional(),
  radiology_req_id: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).default(1),
  machine_id: z.number().int().positive().optional(),
  description: z.string().optional()
});
labMonitoring.get("/operation-logs", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query("date") || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const logType = c.req.query("log_type");
  let where = "WHERE l.tenant_id = ? AND l.log_date = ?";
  const params = [tenantId, date];
  if (logType) {
    where += " AND l.log_type = ?";
    params.push(logType);
  }
  const rows = await db.$client.prepare(`
    SELECT l.*,
      t.name as test_name,
      c.name as consumable_name,
      m.machine_name,
      u.name as performed_by_name
    FROM lab_operation_logs l
    LEFT JOIN lab_test_catalog t ON l.lab_test_id = t.id AND t.tenant_id IN (l.tenant_id, '0')
    LEFT JOIN lab_consumables c ON l.consumable_id = c.id AND c.tenant_id = l.tenant_id
    LEFT JOIN lab_machines m ON l.machine_id = m.id AND m.tenant_id = l.tenant_id
    LEFT JOIN users u ON l.performed_by = u.id AND u.tenant_id = l.tenant_id
    ${where}
    ORDER BY l.created_at DESC
  `).bind(...params).all();
  return c.json({ date, data: rows.results });
});
labMonitoring.post("/operation-logs", labInventoryOperatorOnly, zValidator("json", operationLogSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_type, lab_test_id, consumable_id, lab_order_id, radiology_req_id, quantity, machine_id, description, performed_by, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.log_type,
    data.lab_test_id ?? null,
    data.consumable_id ?? null,
    data.lab_order_id ?? null,
    data.radiology_req_id ?? null,
    data.quantity,
    data.machine_id ?? null,
    data.description ?? null,
    userId,
    tenantId
  ).run();
  return c.json({ id: result.meta.last_row_id, message: "Log recorded" }, 201);
});
labMonitoring.get("/daily-summary", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query("date") || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const precomputed = await db.$client.prepare(
    "SELECT * FROM lab_daily_summaries WHERE summary_date = ? AND tenant_id = ?"
  ).bind(date, tenantId).first();
  if (precomputed) return c.json({ date, summary: precomputed });
  const orders = await db.$client.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM lab_orders WHERE tenant_id = ? AND order_date = ?
  `).bind(tenantId, date).first();
  const tests = await db.$client.prepare(`
    SELECT COUNT(*) as total FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE lo.tenant_id = ? AND lo.order_date = ?
  `).bind(tenantId, date).first();
  const prints = await db.$client.prepare(`
    SELECT SUM(print_count) as total FROM lab_orders WHERE tenant_id = ? AND order_date = ?
  `).bind(tenantId, date).first();
  const revenue = await db.$client.prepare(`
    SELECT COALESCE(SUM(total), 0) as total FROM bills
    WHERE tenant_id = ? AND DATE(created_at) = ?
      AND id IN (SELECT DISTINCT bill_id FROM invoice_items WHERE item_category = 'test')
  `).bind(tenantId, date).first();
  const abnormal = await db.$client.prepare(`
    SELECT COUNT(*) as total FROM lab_results lr
    JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
    JOIN lab_orders lo ON lrp.lab_order_id = lo.id
    WHERE lo.tenant_id = ? AND lo.order_date = ? AND lr.abnormal_flag IN ('high','low','critical')
  `).bind(tenantId, date).first();
  let reagents = null;
  try {
    reagents = await db.$client.prepare(`
      SELECT COALESCE(SUM(ici.Quantity), 0) as total
      FROM InventoryConsumption ic
      JOIN InventoryConsumptionItem ici ON ici.ConsumptionId = ic.ConsumptionId
      WHERE ic.tenant_id = ?
        AND ic.IssueType = 'lab_consumption'
        AND ic.ConsumptionDate = ?
    `).bind(tenantId, date).first();
  } catch {
    reagents = null;
  }
  if (!reagents || Number(reagents.total ?? 0) === 0) {
    reagents = await db.$client.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total FROM lab_operation_logs
      WHERE tenant_id = ? AND log_date = ? AND log_type = 'reagent_used'
    `).bind(tenantId, date).first();
  }
  const films = await db.$client.prepare(`
    SELECT COALESCE(SUM(quantity), 0) as total FROM lab_operation_logs
    WHERE tenant_id = ? AND log_date = ? AND log_type = 'film_used'
  `).bind(tenantId, date).first();
  const summary = {
    summary_date: date,
    total_orders: orders?.total ?? 0,
    total_tests_done: orders?.done ?? 0,
    total_tests_pending: orders?.pending ?? 0,
    total_reports_printed: prints?.total ?? 0,
    total_reagents_used: reagents?.total ?? 0,
    total_films_used: films?.total ?? 0,
    total_waste_items: 0,
    revenue_from_lab: revenue?.total ?? 0,
    abnormal_results: abnormal?.total ?? 0,
    machine_downtime_mins: 0,
    tenant_id: tenantId
  };
  return c.json({ date, summary, computed: true });
});
labMonitoring.get("/reagent-reconciliation", async (c) => {
  const tenantId = requireTenantId(c);
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const from = c.req.query("from") || today;
  const to = c.req.query("to") || from;
  const requestedStatus = c.req.query("status") || "all";
  const status = ["all", "ok", "missing", "exception"].includes(requestedStatus) ? requestedStatus : "all";
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 200), 1), 500);
  const { results } = await c.env.DB.prepare(`
    SELECT
      ii.reference_id AS lab_order_item_id,
      loi.lab_order_id,
      loi.lab_test_id,
      COALESCE(NULLIF(loi.test_name, ''), ltc.name, 'Test #' || loi.lab_test_id) AS test_name,
      lo.order_no,
      pt.name AS patient_name,
      b.id AS bill_id,
      b.invoice_no,
      DATE(b.created_at) AS bill_date,
      lo.created_at AS ordered_at,
      loi.collected_at,
      loi.received_at,
      loi.completed_at,
      loi.status AS test_status,
      loi.sample_status,
      loi.result_status,
      ltc.tat_minutes AS tat_target_minutes,
      CASE WHEN loi.received_at IS NOT NULL OR loi.status IN ('received', 'processing', 'completed', 'verified') THEN 1 ELSE 0 END AS performed_flag,
      CASE WHEN loi.completed_at IS NOT NULL OR loi.status IN ('completed', 'verified') THEN 1 ELSE 0 END AS resulted_flag,
      CASE
        WHEN loi.completed_at IS NOT NULL AND lo.created_at IS NOT NULL
        THEN ROUND((julianday(loi.completed_at) - julianday(lo.created_at)) * 24 * 60)
        ELSE NULL
      END AS tat_minutes_actual,
      COALESCE(exp.expected_quantity, 0) AS expected_quantity,
      COALESCE(act.consumed_quantity, 0) AS consumed_quantity,
      COALESCE(act.consumed_cost, 0) AS consumed_cost,
      COALESCE(exc.exception_count, 0) AS exception_count
    FROM invoice_items ii
    JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    JOIN lab_order_items loi ON loi.id = ii.reference_id AND loi.tenant_id = ii.tenant_id
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ii.tenant_id
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = ii.tenant_id
    LEFT JOIN patients pt ON pt.id = lo.patient_id AND pt.tenant_id = ii.tenant_id
    LEFT JOIN (
      SELECT tenant_id, lab_test_id, COALESCE(SUM(qty_per_test), 0) AS expected_quantity
      FROM lab_test_consumable_map
      WHERE COALESCE(is_active, 1) = 1
        AND (effective_to IS NULL OR date(effective_to) >= CURRENT_DATE)
      GROUP BY tenant_id, lab_test_id
    ) exp ON exp.tenant_id = ii.tenant_id AND exp.lab_test_id = loi.lab_test_id
    LEFT JOIN (
      SELECT tenant_id, reference_id AS lab_order_item_id,
        COALESCE(SUM(CASE WHEN movement_type = 'usage_out' THEN quantity WHEN movement_type = 'return' THEN -quantity ELSE 0 END), 0) AS consumed_quantity,
        COALESCE(SUM(CASE WHEN movement_type = 'usage_out' THEN quantity * COALESCE(unit_cost, 0) ELSE 0 END), 0) AS consumed_cost
      FROM lab_consumable_movements
      WHERE reference_type = 'lab_order_item'
      GROUP BY tenant_id, reference_id
    ) act ON act.tenant_id = ii.tenant_id AND act.lab_order_item_id = ii.reference_id
    LEFT JOIN (
      SELECT tenant_id, lab_order_item_id, COUNT(1) AS exception_count
      FROM lab_inventory_exceptions
      WHERE status = 'open'
      GROUP BY tenant_id, lab_order_item_id
    ) exc ON exc.tenant_id = ii.tenant_id AND exc.lab_order_item_id = ii.reference_id
    WHERE ii.tenant_id = ?
      AND ii.item_category = 'test'
      AND ii.reference_id IS NOT NULL
      AND COALESCE(ii.status, 'active') = 'active'
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      AND DATE(b.created_at) >= ?
      AND DATE(b.created_at) <= ?
    ORDER BY b.created_at DESC, ii.reference_id DESC
    LIMIT ?
  `).bind(String(tenantId), from, to, limit).all();
  const rows = (results ?? []).map((row) => {
    const expectedQty = Number(row.expected_quantity ?? 0);
    const consumedQty = Number(row.consumed_quantity ?? 0);
    const exceptionCount = Number(row.exception_count ?? 0);
    const performed = Boolean(Number(row.performed_flag ?? 0));
    const resulted = Boolean(Number(row.resulted_flag ?? 0));
    const tatTargetMinutes = Number(row.tat_target_minutes ?? 0) || null;
    const tatMinutes = row.tat_minutes_actual === null || row.tat_minutes_actual === void 0 ? null : Number(row.tat_minutes_actual);
    const tatStatus = tatMinutes === null ? "pending" : tatTargetMinutes && tatMinutes > tatTargetMinutes ? "delayed" : "on_time";
    const rowStatus = exceptionCount > 0 ? "exception" : expectedQty <= 0 || consumedQty < expectedQty ? "missing" : "ok";
    const statusMeaning = rowStatus === "ok" ? "Expected reagent deducted" : rowStatus === "exception" ? "Deduction failed/needs review" : "Mapping/stock missing";
    return {
      lab_order_item_id: Number(row.lab_order_item_id),
      lab_order_id: Number(row.lab_order_id),
      lab_test_id: Number(row.lab_test_id),
      test_name: row.test_name,
      order_no: row.order_no,
      patient_name: row.patient_name,
      bill_id: Number(row.bill_id),
      invoice_no: row.invoice_no,
      bill_date: row.bill_date,
      billed: true,
      performed,
      resulted,
      ordered_at: row.ordered_at ?? null,
      collected_at: row.collected_at ?? null,
      received_at: row.received_at ?? null,
      completed_at: row.completed_at ?? null,
      test_status: row.test_status ?? null,
      sample_status: row.sample_status ?? null,
      result_status: row.result_status ?? null,
      tat_target_minutes: tatTargetMinutes,
      tat_minutes: tatMinutes,
      tat_status: tatStatus,
      expected_quantity: expectedQty,
      consumed_quantity: consumedQty,
      consumed_cost: Number(row.consumed_cost ?? 0),
      exception_count: exceptionCount,
      status: rowStatus,
      status_meaning: statusMeaning
    };
  });
  const filtered = status === "all" ? rows : rows.filter((row) => row.status === status);
  const summary = filtered.reduce((acc, row) => {
    acc.tests += 1;
    acc.billed += 1;
    acc.expected_quantity += row.expected_quantity;
    acc.consumed_quantity += row.consumed_quantity;
    acc.consumed_cost += row.consumed_cost;
    acc.exceptions += row.exception_count;
    if (row.performed) acc.performed += 1;
    if (row.resulted) acc.resulted += 1;
    if (row.tat_status === "delayed") acc.delayed += 1;
    if (row.tat_status === "on_time") acc.on_time += 1;
    if (row.tat_minutes !== null) {
      acc.tat_observed += 1;
      acc.tat_minutes_total += row.tat_minutes;
    }
    if (row.status === "ok") acc.ok += 1;
    if (row.status === "missing") acc.missing += 1;
    if (row.status === "exception") acc.exception += 1;
    return acc;
  }, { tests: 0, billed: 0, performed: 0, resulted: 0, ok: 0, missing: 0, exception: 0, expected_quantity: 0, consumed_quantity: 0, consumed_cost: 0, exceptions: 0, delayed: 0, on_time: 0, tat_observed: 0, tat_minutes_total: 0 });
  const enrichedSummary = {
    ...summary,
    average_tat_minutes: summary.tat_observed > 0 ? Math.round(summary.tat_minutes_total / summary.tat_observed) : null
  };
  return c.json({ from, to, status, data: filtered, summary: enrichedSummary });
});
const filmUsageSchema = z.object({
  requisition_id: z.number().int().positive(),
  film_type_id: z.number().int().positive(),
  film_size: z.string().optional(),
  quantity_used: z.number().int().min(1).default(1),
  quantity_wasted: z.number().int().min(0).default(0),
  print_count: z.number().int().min(1).default(1),
  remarks: z.string().optional()
});
labMonitoring.get("/film-usage", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query("date") || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const rows = await db.$client.prepare(`
    SELECT f.*, ft.film_type, ft.display_name, rr.imaging_item_name, p.name as patient_name
    FROM radiology_film_usage f
    JOIN film_types ft ON f.film_type_id = ft.id
    JOIN radiology_requisitions rr ON f.requisition_id = rr.id
    JOIN patients p ON rr.patient_id = p.id
    WHERE f.tenant_id = ? AND DATE(f.created_at) = ?
    ORDER BY f.created_at DESC
  `).bind(tenantId, date).all();
  return c.json({ date, data: rows.results });
});
labMonitoring.post("/film-usage", labInventoryOperatorOnly, zValidator("json", filmUsageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    INSERT INTO radiology_film_usage
      (requisition_id, film_type_id, film_size, quantity_used, quantity_wasted, print_count, processed_by, remarks, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.requisition_id,
    data.film_type_id,
    data.film_size ?? null,
    data.quantity_used,
    data.quantity_wasted,
    data.print_count,
    userId,
    data.remarks ?? null,
    tenantId
  ).run();
  await db.$client.prepare(`
    INSERT INTO lab_operation_logs
      (log_type, radiology_req_id, quantity, description, performed_by, tenant_id, log_date)
    VALUES ('film_used', ?, ?, ?, ?, ?, date('now', '+6 hours'))
  `).bind(data.requisition_id, data.quantity_used + data.quantity_wasted, `Film: ${data.film_size || "standard"}`, userId, tenantId).run();
  await db.$client.prepare(
    "UPDATE radiology_requisitions SET film_usage_logged = 1 WHERE id = ?"
  ).bind(data.requisition_id).run();
  return c.json({ id: result.meta.last_row_id, message: "Film usage recorded" }, 201);
});
labMonitoring.get("/template-presets", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const category = c.req.query("category");
  let where = "WHERE (tenant_id = 0 OR tenant_id = ?) AND is_active = 1";
  const params = [tenantId];
  if (category) {
    where += " AND category = ?";
    params.push(category);
  }
  const rows = await db.$client.prepare(`
    SELECT id, preset_code, preset_name, preset_name_bn, category, layout_type, structure_json, sample_html, is_system
    FROM lab_report_template_presets
    ${where}
    ORDER BY category, preset_name
  `).bind(...params).all();
  return c.json({ data: rows.results });
});
labMonitoring.get("/template-presets/:id", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param("id"));
  const row = await db.$client.prepare(`
    SELECT * FROM lab_report_template_presets
    WHERE id = ? AND (tenant_id = 0 OR tenant_id = ?) AND is_active = 1
  `).bind(id, tenantId).first();
  if (!row) throw new HTTPException(404, { message: "Template preset not found" });
  return c.json(row);
});
const presetSchema = z.object({
  preset_code: z.string().min(1),
  preset_name: z.string().min(1),
  preset_name_bn: z.string().optional(),
  category: z.string().min(1),
  layout_type: z.enum(["table", "grid", "list", "freeform"]),
  structure_json: z.string().min(1),
  sample_html: z.string().optional()
});
labMonitoring.post("/template-presets", labInventoryManagerOnly, zValidator("json", presetSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid("json");
  const result = await db.$client.prepare(`
    INSERT INTO lab_report_template_presets
      (preset_code, preset_name, preset_name_bn, category, layout_type, structure_json, sample_html, is_system, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    data.preset_code,
    data.preset_name,
    data.preset_name_bn ?? null,
    data.category,
    data.layout_type,
    data.structure_json,
    data.sample_html ?? null,
    tenantId
  ).run();
  return c.json({ id: result.meta.last_row_id, message: "Template preset created" }, 201);
});
labMonitoring.get("/help", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const pageKey = c.req.query("page") || "lab_settings";
  const lang = c.req.query("lang") || "bn";
  const rows = await db.$client.prepare(`
    SELECT page_key, section_key,
      CASE WHEN ? = 'bn' THEN COALESCE(title_bn, title) ELSE title END as title,
      CASE WHEN ? = 'bn' THEN COALESCE(content_bn, content) ELSE content END as content,
      sort_order
    FROM help_contents
    WHERE page_key = ? AND (tenant_id = 0 OR tenant_id = ?) AND is_active = 1
    ORDER BY sort_order
  `).bind(lang, lang, pageKey, tenantId).all();
  return c.json({ page: pageKey, lang, data: rows.results });
});
labMonitoring.get("/alerts", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const lowStock = await db.$client.prepare(`
    SELECT c.id, c.code, c.name, c.category, c.unit, c.reorder_level,
      COALESCE(SUM(s.quantity_available), 0) as total_stock
    FROM lab_consumables c
    LEFT JOIN lab_consumable_stock s ON s.consumable_id = c.id AND s.quantity_available > 0 AND s.qc_status IN ('not_required', 'passed') AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) >= CURRENT_DATE) AND (s.expiry_date IS NULL OR date(s.expiry_date) >= CURRENT_DATE)
    WHERE c.tenant_id = ? AND c.is_active = 1
    GROUP BY c.id
    HAVING total_stock <= c.reorder_level
    ORDER BY c.category, c.name
  `).bind(tenantId).all();
  const expiring = await db.$client.prepare(`
    SELECT c.id, c.code, c.name, s.lot_number, s.expiry_date, s.quantity_available,
      julianday(s.expiry_date) - julianday('now') as days_remaining
    FROM lab_consumables c
    JOIN lab_consumable_stock s ON s.consumable_id = c.id
    WHERE c.tenant_id = ? AND s.quantity_available > 0
      AND s.expiry_date <= date('now', '+' || c.expiry_alert_days || ' days')
    ORDER BY s.expiry_date
  `).bind(tenantId).all();
  return c.json({
    low_stock: lowStock.results,
    expiring: expiring.results,
    low_stock_count: lowStock.results?.length ?? 0,
    expiring_count: expiring.results?.length ?? 0
  });
});
labMonitoring.get("/critical", async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const alerts = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.result AS result_value,
      loi.abnormal_flag, loi.status, loi.completed_at,
      lo.order_no, lo.order_date,
      p.name as patient_name, p.patient_code, p.mobile,
      ltc.name as test_name, ltc.code as test_code
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    JOIN patients p ON lo.patient_id = p.id
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE lo.tenant_id = ? AND loi.abnormal_flag = 'critical'
      AND loi.status IN ('completed', 'verified')
    ORDER BY loi.completed_at DESC
    LIMIT 100
  `).bind(tenantId).all();
  return c.json({ alerts: alerts.results });
});
labMonitoring.post("/critical/:alertId/acknowledge", labInventoryOperatorOnly, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const alertId = parseId(c.req.param("alertId"));
  const userId = requireUserId(c);
  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, lo.patient_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(alertId, tenantId).first();
  await db.$client.prepare(`
    INSERT INTO lab_critical_acknowledgements (
      lab_order_item_id,
      acknowledged_by,
      tenant_id,
      created_at
    )
    VALUES (?, ?, ?, datetime('now', '+6 hours'))
  `).bind(alertId, userId, tenantId).run();
  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: c.get("role") ?? null,
    eventType: "critical_acknowledged",
    eventStage: "critical",
    labOrderId: Number(item?.lab_order_id ?? 0) || null,
    labOrderItemId: alertId,
    patientId: Number(item?.patient_id ?? 0) || null,
    fromStatus: "critical",
    toStatus: "acknowledged"
  });
  void createAuditLog(c.env, tenantId, userId, "ACK_CRITICAL", "lab_order_items", alertId, null, {
    acknowledged_by: userId
  });
  return c.json({ message: "Critical alert acknowledged" });
});
var labMonitoring_default = labMonitoring;
export {
  labMonitoring_default as default
};

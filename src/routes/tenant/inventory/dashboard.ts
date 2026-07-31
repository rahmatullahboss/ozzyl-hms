import { Hono } from "hono";
import type { Env } from "../../../types";
import { requireTenantId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";

type Variables = { tenantId?: string; userId?: string; role?: string };

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

type NumberRow = Record<string, number | null | undefined>;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}



dashboard.get("/", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = todayDate();
  const in30Days = addDays(today, 30);

  let batchResults: any[] = [];
  try {
    batchResults = await db.$client.batch([
      db.$client.prepare(`
        SELECT COALESCE(SUM(S.AvailableQuantity * S.CostPrice), 0) AS value
        FROM InventoryStock S
        WHERE S.tenant_id = ? AND COALESCE(S.IsActive, 1) = 1
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COUNT(DISTINCT S.ItemId) AS count
        FROM InventoryStock S
        JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
        WHERE S.tenant_id = ? AND COALESCE(S.IsActive, 1) = 1
          AND S.AvailableQuantity > 0
          AND S.AvailableQuantity <= COALESCE(NULLIF(I.ReOrderLevel, 0), I.MinStockQuantity, 0)
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COUNT(DISTINCT ItemId) AS count
        FROM InventoryStock
        WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1 AND AvailableQuantity <= 0
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COUNT(*) AS count
        FROM InventoryStock
        WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1
          AND ExpiryDate IS NOT NULL AND ExpiryDate > ? AND ExpiryDate <= ?
      `).bind(tenantId, today, in30Days),
      db.$client.prepare(`
        SELECT COUNT(*) AS count
        FROM InventoryStock
        WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1
          AND ExpiryDate IS NOT NULL AND ExpiryDate <= ?
      `).bind(tenantId, today),
      db.$client.prepare(`
        SELECT COUNT(*) AS count
        FROM InventoryPurchaseRequest
        WHERE tenant_id = ? AND Status IN ('draft','submitted','approved')
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COUNT(*) AS count
        FROM InventoryRequisition
        WHERE tenant_id = ? AND RequisitionStatus IN ('pending','approved','partial')
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COALESCE(SUM(InQuantity), 0) AS qty
        FROM InventoryStockTransaction
        WHERE tenant_id = ? AND date(TransactionDate) = date(?)
          AND TransactionType IN ('goods-receipt','purchase_receive')
      `).bind(tenantId, today),
      db.$client.prepare(`
        SELECT COALESCE(SUM(OutQuantity), 0) AS qty
        FROM InventoryStockTransaction
        WHERE tenant_id = ? AND date(TransactionDate) = date(?)
          AND TransactionType IN ('dispatch-out','department_issue','patient_issue','lab_consumption','ot_consumption','pharmacy_sale')
      `).bind(tenantId, today),
      db.$client.prepare(`
        SELECT COALESCE(SUM(DamagedQuantity), 0) AS qty
        FROM InventoryStock
        WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COUNT(*) AS count
        FROM asset_maintenance_log
        WHERE tenant_id = ? AND next_due_date IS NOT NULL AND next_due_date <= ?
      `).bind(tenantId, in30Days),
      db.$client.prepare(`
        SELECT COUNT(*) AS count
        FROM InventoryStockTransaction
        WHERE tenant_id = ? AND date(TransactionDate) = date(?)
          AND TransactionType IN ('adjustment-in','adjustment-out','adjustment_plus','adjustment_minus')
          AND (InQuantity >= 100 OR OutQuantity >= 100)
      `).bind(tenantId, today),
      db.$client.prepare(`
        SELECT T.*, I.ItemName, S.StoreName
        FROM InventoryStockTransaction T
        LEFT JOIN InventoryItem I ON I.ItemId = T.ItemId AND I.tenant_id = T.tenant_id
        LEFT JOIN InventoryStore S ON S.StoreId = T.StoreId AND S.tenant_id = T.tenant_id
        WHERE T.tenant_id = ?
        ORDER BY T.TransactionDate DESC, T.TransactionId DESC
        LIMIT 10
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT S.StockId, S.ItemId, I.ItemName, I.ItemCode, S.AvailableQuantity, I.ReOrderLevel, ST.StoreName
        FROM InventoryStock S
        JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
        LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
        WHERE S.tenant_id = ? AND COALESCE(S.IsActive, 1) = 1
          AND S.AvailableQuantity > 0
          AND S.AvailableQuantity <= COALESCE(NULLIF(I.ReOrderLevel, 0), I.MinStockQuantity, 0)
        ORDER BY S.AvailableQuantity ASC
        LIMIT 10
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT S.StockId, S.ItemId, I.ItemName, S.BatchNo, S.ExpiryDate, S.AvailableQuantity, ST.StoreName
        FROM InventoryStock S
        JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
        LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
        WHERE S.tenant_id = ? AND COALESCE(S.IsActive, 1) = 1
          AND S.ExpiryDate IS NOT NULL AND S.ExpiryDate <= ?
        ORDER BY S.ExpiryDate ASC
        LIMIT 10
      `).bind(tenantId, in30Days)
    ]);
  } catch (error) {
    console.error('Inventory dashboard batch fetch failed:', error);
  }

  const totalStockValue = Number(batchResults[0]?.results?.[0]?.value ?? 0);
  const lowStockItems = Number(batchResults[1]?.results?.[0]?.count ?? 0);
  const outOfStockItems = Number(batchResults[2]?.results?.[0]?.count ?? 0);
  const expiringSoonItems = Number(batchResults[3]?.results?.[0]?.count ?? 0);
  const expiredItems = Number(batchResults[4]?.results?.[0]?.count ?? 0);
  const pendingPurchaseRequests = Number(batchResults[5]?.results?.[0]?.count ?? 0);
  const pendingDepartmentRequests = Number(batchResults[6]?.results?.[0]?.count ?? 0);
  const todayReceivedQuantity = Number(batchResults[7]?.results?.[0]?.qty ?? 0);
  const todayIssuedQuantity = Number(batchResults[8]?.results?.[0]?.qty ?? 0);
  const damagedStockQuantity = Number(batchResults[9]?.results?.[0]?.qty ?? 0);
  const assetMaintenanceDue = Number(batchResults[10]?.results?.[0]?.count ?? 0);
  const unusualAdjustments = Number(batchResults[11]?.results?.[0]?.count ?? 0);
  const recentMovements = batchResults[12]?.results || [];
  const lowStockAlerts = batchResults[13]?.results || [];
  const expiryAlerts = batchResults[14]?.results || [];

  const alerts = [
    ...lowStockAlerts.map((row: any) => ({ type: "low_stock", severity: "warning", ...row })),
    ...expiryAlerts.map((row: any) => ({
      type: String((row as any).ExpiryDate || "") <= today ? "expired" : "expiring_soon",
      severity: String((row as any).ExpiryDate || "") <= today ? "danger" : "warning",
      ...row,
    })),
    ...(pendingPurchaseRequests > 0 ? [{ type: "pending_purchase_request", severity: "info", count: pendingPurchaseRequests }] : []),
    ...(pendingDepartmentRequests > 0 ? [{ type: "pending_department_request", severity: "info", count: pendingDepartmentRequests }] : []),
    ...(unusualAdjustments > 0 ? [{ type: "unusual_adjustment", severity: "warning", count: unusualAdjustments }] : []),
    ...(assetMaintenanceDue > 0 ? [{ type: "asset_service_due", severity: "warning", count: assetMaintenanceDue }] : []),
  ];

  return c.json({
    summary: {
      totalStockValue,
      lowStockItems,
      outOfStockItems,
      expiringSoonItems,
      expiredItems,
      pendingPurchaseRequests,
      pendingDepartmentRequests,
      todayReceivedQuantity,
      todayIssuedQuantity,
      damagedStockQuantity,
      assetMaintenanceDue,
    },
    alerts,
    recentMovements,
  });
});

export default dashboard;

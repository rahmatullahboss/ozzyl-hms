import { Hono } from "hono";
import type { Env } from "../../../types";
import { requireTenantId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";

type Variables = { tenantId?: string; userId?: string; role?: string };
type ReadinessMode = "simple" | "standard" | "enterprise";
type ChecklistStatus = "done" | "warning" | "missing" | "action_required";

type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  status: ChecklistStatus;
  priority: "P0" | "P1" | "P2";
  action: string;
  href?: string;
  metric?: number | string;
};

type InventoryRoleGuide = {
  role: string;
  mode: "simple" | "standard" | "enterprise";
  responsibility: string;
  dailyTasks: string[];
  allowedActions: string[];
  avoid: string[];
};

const quickStart = new Hono<{ Bindings: Env; Variables: Variables }>();

function modeOf(raw: string | undefined | null): ReadinessMode {
  return raw === "standard" || raw === "enterprise" ? raw : "simple";
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function n(row: Record<string, unknown> | null | undefined, key = "count"): number {
  const parsed = Number(row?.[key] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function first(db: ReturnType<typeof getDb>, sql: string, ...params: unknown[]) {
  try {
    return await db.$client.prepare(sql).bind(...params).first() as Record<string, unknown> | null;
  } catch (error) {
    console.warn("inventory quick-start readiness query failed", { sql, error });
    return null;
  }
}

function score(items: ChecklistItem[]): number {
  if (!items.length) return 0;
  const points = items.reduce((sum, item) => {
    if (item.status === "done") return sum + 1;
    if (item.status === "warning") return sum + 0.55;
    return sum;
  }, 0);
  return Math.round((points / items.length) * 100);
}

type DefaultInventoryStore = {
  StoreName: string;
  StoreCode: string;
  StoreType: "main" | "departmental" | "substore";
  Address: string;
  ParentStoreCode?: string;
};

type DefaultLabInventoryItem = {
  ItemName: string;
  ItemCode: string;
  CategoryName: "reagent/kit" | "tube" | "reagent" | "kit";
  CategoryCode: string;
  UOMName: "test" | "pcs";
  ItemType: "lab_reagent" | "consumable";
  StorageCondition: string;
  Description: string;
};

const DEFAULT_REAGENT_INVENTORY_STORES: readonly DefaultInventoryStore[] = [
  { StoreName: "Main Store", StoreCode: "MAIN", StoreType: "main", Address: "Central canonical inventory store for hospital stock receipt and control." },
  { StoreName: "Lab Store", StoreCode: "LAB", StoreType: "departmental", Address: "Primary lab reagent and consumable stock store.", ParentStoreCode: "MAIN" },
  { StoreName: "Lab Refrigerator", StoreCode: "LAB-REF", StoreType: "substore", Address: "Cold-chain lab reagent storage location for refrigerator stock.", ParentStoreCode: "LAB" },
  { StoreName: "Chemistry Analyzer Area", StoreCode: "LAB-CHEM", StoreType: "substore", Address: "Chemistry analyzer working-stock location.", ParentStoreCode: "LAB" },
  { StoreName: "Hematology Analyzer Area", StoreCode: "LAB-HEMA", StoreType: "substore", Address: "Hematology analyzer working-stock location.", ParentStoreCode: "LAB" },
  { StoreName: "Sample Collection Area", StoreCode: "LAB-SAMPLE", StoreType: "substore", Address: "Sample collection phlebotomy consumable and reagent-facing location.", ParentStoreCode: "LAB" },
] as const;

const TEST_EQUIVALENT_NOTE = "Safe starter model: 1 performed test deducts 1 test-equivalent unit from the mapped reagent/kit item. Do not enter raw mL/uL consumption here; set analyzer-specific quantities later from the hospital analyzer kit manufacturer IFU.";

const DEFAULT_LAB_INVENTORY_ITEMS: readonly DefaultLabInventoryItem[] = [
  { ItemName: "CBC Reagent Pack", ItemCode: "LAB-CBC-REAGENT-PACK", CategoryName: "reagent/kit", CategoryCode: "REAGENT-KIT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `CBC reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "EDTA Tube", ItemCode: "LAB-EDTA-TUBE", CategoryName: "tube", CategoryCode: "TUBE", UOMName: "pcs", ItemType: "consumable", StorageCondition: "Dry sample collection consumable storage; track lot/expiry where supplier provides it.", Description: "EDTA tube starter item measured in pieces for sample collection consumption." },
  { ItemName: "Glucose Reagent", ItemCode: "LAB-GLUCOSE-REAGENT", CategoryName: "reagent", CategoryCode: "REAGENT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `Glucose reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "Creatinine Reagent", ItemCode: "LAB-CREATININE-REAGENT", CategoryName: "reagent", CategoryCode: "REAGENT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `Creatinine reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "ALT Reagent", ItemCode: "LAB-ALT-REAGENT", CategoryName: "reagent", CategoryCode: "REAGENT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `ALT reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "AST Reagent", ItemCode: "LAB-AST-REAGENT", CategoryName: "reagent", CategoryCode: "REAGENT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `AST reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "Cholesterol Reagent", ItemCode: "LAB-CHOLESTEROL-REAGENT", CategoryName: "reagent", CategoryCode: "REAGENT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `Cholesterol reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "Triglyceride Reagent", ItemCode: "LAB-TRIGLYCERIDE-REAGENT", CategoryName: "reagent", CategoryCode: "REAGENT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow analyzer kit IFU; keep batch, expiry and QC status before strict consumption.", Description: `Triglyceride reagent starter item. ${TEST_EQUIVALENT_NOTE}` },
  { ItemName: "Dengue NS1 Kit", ItemCode: "LAB-DENGUE-NS1-KIT", CategoryName: "kit", CategoryCode: "KIT", UOMName: "test", ItemType: "lab_reagent", StorageCondition: "Follow kit IFU; keep batch, expiry, QC and kit storage condition before strict consumption.", Description: `Dengue NS1 kit starter item. ${TEST_EQUIVALENT_NOTE}` },
] as const;

const ROLE_GUIDE: InventoryRoleGuide[] = [
  {
    role: "Owner/Admin",
    mode: "simple",
    responsibility: "Initial setup, approval decisions, daily risk review and purchase decision.",
    dailyTasks: ["Open Inventory Quick Start", "Review out-of-stock and expiry alerts", "Approve adjustments/write-off only after checking reason"],
    allowedActions: ["Create default stores", "Import item master", "Add opening stock", "Set reorder levels", "Review lab exceptions"],
    avoid: ["Editing stock silently without reason", "Turning on strict reagent mode before mapping is ready"],
  },
  {
    role: "Storekeeper / Admin Assistant",
    mode: "simple",
    responsibility: "Receive, issue, transfer and count stock with minimum typing.",
    dailyTasks: ["Receive supplier stock", "Issue stock to pharmacy/lab/ward", "Print QR for expensive or expiring items", "Report mismatch to admin"],
    allowedActions: ["GRN/opening stock", "Issue/dispatch", "Transfer request", "Stock count draft"],
    avoid: ["Approving own adjustment", "Deleting or bypassing stock movement ledger"],
  },
  {
    role: "Lab Technician",
    mode: "simple",
    responsibility: "Use soft reagent tracking and flag reagent shortage/mapping problems.",
    dailyTasks: ["Check reagent stock before running tests", "Resolve or report reagent exceptions", "Record waste/open-vial issue"],
    allowedActions: ["View lab reagent stock", "Create reagent usage/waste request", "Suggest test-reagent mapping correction"],
    avoid: ["Running strict mode without stock and mapping readiness", "Using QC failed/expired reagent lots"],
  },
  {
    role: "Accountant",
    mode: "standard",
    responsibility: "Review valuation, vendor bills, PO/GRN totals and stock adjustment value impact.",
    dailyTasks: ["Review GRN value", "Match vendor bill with PO/GRN", "Check write-off and adjustment value"],
    allowedActions: ["View reports", "Export valuation", "Review supplier ledger"],
    avoid: ["Changing physical stock quantity", "Approving clinical reagent override"],
  },
  {
    role: "Inventory Manager",
    mode: "enterprise",
    responsibility: "Govern multi-store stock, reconciliation, approval policy and period close.",
    dailyTasks: ["Review control room", "Resolve reconciliation mismatches", "Monitor transfer aging", "Prepare monthly close"],
    allowedActions: ["Configure roles", "Approve high-value adjustment", "Run reconciliation", "Enable enterprise workflows"],
    avoid: ["Letting direct stock edits bypass approval", "Leaving transfer in-transit unreconciled"],
  },
];

async function ensureInventoryUom(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  uomName: DefaultLabInventoryItem["UOMName"],
  userId: string | null,
  now: string,
): Promise<number | null> {
  const existing = await db.$client.prepare(`
    SELECT UOMId, UOMName
    FROM InventoryUnitOfMeasurement
    WHERE tenant_id = ? AND LOWER(UOMName) = LOWER(?)
    LIMIT 1
  `).bind(tenantId, uomName).first<{ UOMId: number; UOMName: string }>();

  if (existing?.UOMId) return Number(existing.UOMId);

  const result = await db.$client.prepare(`
    INSERT INTO InventoryUnitOfMeasurement (tenant_id, UOMName, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(tenantId, uomName, uomName === "test" ? "Test-equivalent unit for lab reagent/kit consumption." : "Piece unit for lab consumables.", userId, now).run();

  return Number(result.meta.last_row_id ?? 0) || null;
}

async function ensureInventoryCategory(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  item: Pick<DefaultLabInventoryItem, "CategoryName" | "CategoryCode">,
  userId: string | null,
  now: string,
): Promise<number | null> {
  const existing = await db.$client.prepare(`
    SELECT ItemCategoryId, CategoryName, CategoryCode
    FROM InventoryItemCategory
    WHERE tenant_id = ? AND (LOWER(CategoryName) = LOWER(?) OR CategoryCode = ?)
    ORDER BY CASE WHEN LOWER(CategoryName) = LOWER(?) THEN 0 ELSE 1 END, ItemCategoryId ASC
    LIMIT 1
  `).bind(tenantId, item.CategoryName, item.CategoryCode, item.CategoryName).first<{ ItemCategoryId: number; CategoryName: string; CategoryCode: string }>();

  if (existing?.ItemCategoryId) return Number(existing.ItemCategoryId);

  const result = await db.$client.prepare(`
    INSERT INTO InventoryItemCategory (tenant_id, CategoryName, CategoryCode, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).bind(tenantId, item.CategoryName, item.CategoryCode, "Default lab inventory category for reagent/consumable item master setup.", userId, now).run();

  return Number(result.meta.last_row_id ?? 0) || null;
}

quickStart.get("/process-guide", async (c) => {
  const mode = modeOf(c.req.query("mode"));
  const visibleRoles = ROLE_GUIDE.filter(role => mode === "enterprise" || role.mode !== "enterprise");

  return c.json({
    mode,
    position: {
      smallHospital: "Ready for guided simple setup: default stores, item master, opening stock, reorder alerts and soft reagent tracking.",
      enterprise: "Enterprise foundation is strong, but reconciliation, canonical movement service and period close remain next-phase governance work.",
    },
    simpleHospitalProcess: [
      "Admin creates default stores from Quick Start.",
      "Admin/storekeeper imports item master and opening stock.",
      "Storekeeper receives supplier stock and issues to lab/pharmacy/ward.",
      "System shows out-of-stock, low-stock and expiry risks daily.",
      "Lab starts with soft reagent tracking and maps common tests first.",
      "Admin reviews exceptions and approvals daily or weekly based on volume.",
    ],
    roleGuide: visibleRoles,
    remainingWork: [
      { priority: "P1", item: "Setup wizard for item/category/reagent defaults" },
      { priority: "P1", item: "Inventory control room with reconciliation signals" },
      { priority: "P1", item: "Strict reagent readiness guard before enabling strict mode" },
      { priority: "P2", item: "Canonical stock movement service for all stock mutations" },
      { priority: "P2", item: "Monthly period close and advanced Danphe-style reports" },
    ],
  });
});

quickStart.post("/default-stores", async (c) => {
  const tenantId = requireTenantId(c);
  const userId = c.get("userId") ?? null;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const created: Array<{ id: number | null; storeCode: string; storeName: string; parentStoreCode?: string }> = [];
  const existing: Array<{ id: number | null; storeCode: string; storeName: string; parentStoreCode?: string }> = [];
  const readyByCode = new Map<string, number>();

  for (const store of DEFAULT_REAGENT_INVENTORY_STORES) {
    const parentStoreId = store.ParentStoreCode ? readyByCode.get(store.ParentStoreCode) ?? null : null;
    const current = await db.$client.prepare(`
      SELECT StoreId, StoreName, StoreCode
      FROM InventoryStore
      WHERE tenant_id = ? AND (StoreCode = ? OR LOWER(StoreName) = LOWER(?))
      ORDER BY CASE WHEN StoreCode = ? THEN 0 ELSE 1 END, StoreId ASC
      LIMIT 1
    `).bind(tenantId, store.StoreCode, store.StoreName, store.StoreCode).first<{ StoreId: number; StoreName: string; StoreCode: string }>();

    if (current) {
      await db.$client.prepare(`
        UPDATE InventoryStore
        SET StoreCode = ?,
            StoreType = ?,
            Address = COALESCE(NULLIF(Address, ''), ?),
            ParentStoreId = ?,
            IsActive = 1,
            ModifiedBy = ?,
            ModifiedOn = ?
        WHERE tenant_id = ? AND StoreId = ?
      `).bind(store.StoreCode, store.StoreType, store.Address, parentStoreId, userId, now, tenantId, current.StoreId).run();
      readyByCode.set(store.StoreCode, Number(current.StoreId));
      existing.push({ id: current.StoreId ?? null, storeCode: store.StoreCode, storeName: current.StoreName || store.StoreName, parentStoreCode: store.ParentStoreCode });
      continue;
    }

    const result = await db.$client.prepare(`
      INSERT INTO InventoryStore (tenant_id, StoreName, StoreCode, StoreType, Address, ParentStoreId, IsActive, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(tenantId, store.StoreName, store.StoreCode, store.StoreType, store.Address, parentStoreId, userId, now).run();

    const id = Number(result.meta.last_row_id ?? 0) || null;
    if (id) readyByCode.set(store.StoreCode, id);
    created.push({ id, storeCode: store.StoreCode, storeName: store.StoreName, parentStoreCode: store.ParentStoreCode });
  }

  return c.json({
    message: created.length ? "Default reagent inventory stores created" : "Default reagent inventory stores already existed",
    created,
    existing,
    totalReady: created.length + existing.length,
    canonicalFlow: {
      sourceOfTruth: "InventoryStock",
      labMonitoringRole: "reagent-facing projection and controls only",
      hierarchy: "Main Store > Lab Store > Lab Refrigerator / analyzer areas / sample collection area",
    },
    nextActions: [
      { id: "item-master", title: "Add or import lab reagent item master", href: "/inventory/master-data" },
      { id: "opening-stock", title: "Add opening stock into InventoryStock by store/location", href: "/inventory/import-export" },
      { id: "reorder-alerts", title: "Set low-stock and expiry alerts", href: "/inventory/reorder" },
    ],
  }, created.length ? 201 : 200);
});

quickStart.post("/default-lab-items", async (c) => {
  const tenantId = requireTenantId(c);
  const userId = c.get("userId") ?? null;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const created: Array<{ id: number | null; itemCode: string; itemName: string; category: string; unit: string }> = [];
  const existing: Array<{ id: number | null; itemCode: string; itemName: string; category: string; unit: string }> = [];

  const uomByName = new Map<DefaultLabInventoryItem["UOMName"], number | null>();
  const categoryByName = new Map<DefaultLabInventoryItem["CategoryName"], number | null>();

  for (const item of DEFAULT_LAB_INVENTORY_ITEMS) {
    if (!uomByName.has(item.UOMName)) {
      uomByName.set(item.UOMName, await ensureInventoryUom(db, tenantId, item.UOMName, userId, now));
    }
    if (!categoryByName.has(item.CategoryName)) {
      categoryByName.set(item.CategoryName, await ensureInventoryCategory(db, tenantId, item, userId, now));
    }

    const uomId = uomByName.get(item.UOMName) ?? null;
    const categoryId = categoryByName.get(item.CategoryName) ?? null;
    const labMeta = JSON.stringify({
      starterItem: true,
      category: item.CategoryName,
      testEquivalent: item.UOMName === "test",
      consumptionBasis: item.UOMName === "test" ? "test_equivalent" : "piece",
      defaultDeductionPerTest: item.UOMName === "test" ? 1 : null,
      analyzerSpecificQuantityRequired: item.UOMName === "test",
      rawMlOrMicroliterConfigured: false,
      ifuRequiredForExactQuantity: item.UOMName === "test",
    });

    const current = await db.$client.prepare(`
      SELECT ItemId, ItemName, ItemCode
      FROM InventoryItem
      WHERE tenant_id = ? AND (ItemCode = ? OR LOWER(ItemName) = LOWER(?))
      ORDER BY CASE WHEN ItemCode = ? THEN 0 ELSE 1 END, ItemId ASC
      LIMIT 1
    `).bind(tenantId, item.ItemCode, item.ItemName, item.ItemCode).first<{ ItemId: number; ItemName: string; ItemCode: string }>();

    if (current) {
      await db.$client.prepare(`
        UPDATE InventoryItem
        SET ItemCode = ?,
            ItemType = ?,
            ItemCategoryId = ?,
            UOMId = ?,
            PurchaseUnit = ?,
            IssueUnit = ?,
            UnitConversionFactor = 1,
            IsBatchRequired = 1,
            IsExpiryRequired = 1,
            IsSerialRequired = 0,
            Description = ?,
            StorageCondition = ?,
            Chargeable = 0,
            LabMetaJson = ?,
            IsFixedAsset = 0,
            IsActive = 1,
            ModifiedBy = ?,
            ModifiedOn = ?
        WHERE tenant_id = ? AND ItemId = ?
      `).bind(
        item.ItemCode,
        item.ItemType,
        categoryId,
        uomId,
        item.UOMName,
        item.UOMName,
        item.Description,
        item.StorageCondition,
        labMeta,
        userId,
        now,
        tenantId,
        current.ItemId,
      ).run();
      existing.push({ id: current.ItemId ?? null, itemCode: item.ItemCode, itemName: current.ItemName || item.ItemName, category: item.CategoryName, unit: item.UOMName });
      continue;
    }

    const result = await db.$client.prepare(`
      INSERT INTO InventoryItem (
        tenant_id, ItemName, ItemCode, ItemType, ItemCategoryId, UOMId, PurchaseUnit, IssueUnit,
        UnitConversionFactor, IsBatchRequired, IsExpiryRequired, IsSerialRequired, StandardRate,
        ReOrderLevel, MinStockQuantity, MaxStockQuantity, BudgetedQuantity, PurchasePrice, SalePrice,
        Description, IsVATApplicable, VATPercentage, StorageCondition, Chargeable, LabMetaJson,
        IsFixedAsset, IsActive, CreatedBy, CreatedOn
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, ?, 0, 0, ?, 0, ?, 0, 1, ?, ?)
    `).bind(
      tenantId,
      item.ItemName,
      item.ItemCode,
      item.ItemType,
      categoryId,
      uomId,
      item.UOMName,
      item.UOMName,
      item.Description,
      item.StorageCondition,
      labMeta,
      userId,
      now,
    ).run();

    const id = Number(result.meta.last_row_id ?? 0) || null;
    created.push({ id, itemCode: item.ItemCode, itemName: item.ItemName, category: item.CategoryName, unit: item.UOMName });
  }

  return c.json({
    message: created.length ? "Default lab item master created" : "Default lab item master already existed",
    created,
    existing,
    totalReady: created.length + existing.length,
    testEquivalentModel: "1 test deducts 1 test-equivalent unit from the mapped reagent/kit item; raw mL/µL values must be configured later from hospital analyzer kit manufacturer IFU.",
    nextActions: [
      { id: "opening-stock", title: "Add opening stock with batch/expiry/QC", href: "/inventory/import-export" },
      { id: "lab-mapping", title: "Map common lab tests to these item master records", href: "/lab/settings" },
      { id: "strict-readiness", title: "Keep soft mode until stock, QC and mapping are clean", href: "/inventory/quick-start" },
    ],
  }, created.length ? 201 : 200);
});

quickStart.get("/readiness", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const mode = modeOf(c.req.query("mode"));
  const today = todayDate();
  const in30Days = addDays(today, 30);

  const [
    stores,
    items,
    stock,
    reorder,
    lowStock,
    outOfStock,
    expiring,
    expired,
    pendingPr,
    pendingPo,
    pendingReq,
    pendingAdjustment,
    labPolicy,
    labConsumables,
    labStock,
    labMap,
    labExceptions,
    reagentQcRisk,
    reagentOpenVialRisk,
  ] = await Promise.all([
    first(db, "SELECT COUNT(*) AS count FROM InventoryStore WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryItem WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryStock WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryItem WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1 AND (COALESCE(ReOrderLevel, 0) > 0 OR COALESCE(MinStockQuantity, 0) > 0 OR COALESCE(MaxStockQuantity, 0) > 0)", tenantId),
    first(db, "SELECT COUNT(DISTINCT S.ItemId) AS count FROM InventoryStock S JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id WHERE S.tenant_id = ? AND COALESCE(S.IsActive, 1) = 1 AND S.AvailableQuantity > 0 AND S.AvailableQuantity <= COALESCE(NULLIF(I.ReOrderLevel, 0), I.MinStockQuantity, 0)", tenantId),
    first(db, "SELECT COUNT(DISTINCT ItemId) AS count FROM InventoryStock WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1 AND AvailableQuantity <= 0", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryStock WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1 AND ExpiryDate IS NOT NULL AND ExpiryDate > ? AND ExpiryDate <= ?", tenantId, today, in30Days),
    first(db, "SELECT COUNT(*) AS count FROM InventoryStock WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1 AND ExpiryDate IS NOT NULL AND ExpiryDate <= ?", tenantId, today),
    first(db, "SELECT COUNT(*) AS count FROM InventoryPurchaseRequest WHERE tenant_id = ? AND Status IN ('draft','submitted','approved')", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryPurchaseOrder WHERE tenant_id = ? AND COALESCE(IsCancelled, 0) = 0 AND POStatus IN ('draft','pending','approved','partial')", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryRequisition WHERE tenant_id = ? AND RequisitionStatus IN ('pending','approved','partial')", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM InventoryAdjustmentRequest WHERE tenant_id = ? AND Status IN ('draft','submitted','pending','approved')", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_inventory_policy WHERE tenant_id = ?", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_consumables WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_consumable_stock WHERE tenant_id = ? AND quantity_available > 0", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_test_consumable_map WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_inventory_exceptions WHERE tenant_id = ? AND status = 'open'", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_consumable_stock WHERE tenant_id = ? AND quantity_available > 0 AND qc_status IN ('pending','failed')", tenantId),
    first(db, "SELECT COUNT(*) AS count FROM lab_consumable_stock WHERE tenant_id = ? AND quantity_available > 0 AND onboard_expires_at IS NOT NULL AND onboard_expires_at <= ?", tenantId, in30Days),
  ]);

  const metrics = {
    stores: n(stores),
    items: n(items),
    stockLots: n(stock),
    reorderConfiguredItems: n(reorder),
    lowStockItems: n(lowStock),
    outOfStockItems: n(outOfStock),
    expiringSoonItems: n(expiring),
    expiredItems: n(expired),
    pendingPurchaseRequests: n(pendingPr),
    pendingPurchaseOrders: n(pendingPo),
    pendingRequisitions: n(pendingReq),
    pendingAdjustments: n(pendingAdjustment),
    labPolicyConfigured: n(labPolicy) > 0,
    labConsumables: n(labConsumables),
    labStockLots: n(labStock),
    labMappedTests: n(labMap),
    openLabExceptions: n(labExceptions),
    reagentQcRiskLots: n(reagentQcRisk),
    reagentOpenVialRiskLots: n(reagentOpenVialRisk),
  };

  const setupChecklist: ChecklistItem[] = [
    {
      id: "stores",
      title: mode === "simple" ? "Create at least one active store" : "Create dedicated stores",
      description: mode === "simple" ? "Small hospitals can start with one Main Store." : "Larger hospitals should separate main, pharmacy and lab stores.",
      status: metrics.stores > 0 ? "done" : "missing",
      priority: "P0",
      action: metrics.stores > 0 ? "Store setup is ready" : "Create Main Store first",
      href: "/inventory/stores",
      metric: metrics.stores,
    },
    {
      id: "item-master",
      title: "Add or import item master",
      description: "Add item names, units, category and type before receiving stock.",
      status: metrics.items > 0 ? "done" : "missing",
      priority: "P0",
      action: metrics.items > 0 ? "Item master exists" : "Import or add first items",
      href: "/inventory/master-data",
      metric: metrics.items,
    },
    {
      id: "opening-stock",
      title: "Add opening stock",
      description: "Enter current stock with batch and expiry where possible.",
      status: metrics.stockLots > 0 ? "done" : "missing",
      priority: "P0",
      action: metrics.stockLots > 0 ? "Opening stock exists" : "Add opening stock by GRN/import",
      href: "/inventory/import-export",
      metric: metrics.stockLots,
    },
    {
      id: "reorder-alerts",
      title: "Set low-stock alerts",
      description: "Start with simple reorder/minimum levels for important items.",
      status: metrics.reorderConfiguredItems > 0 ? "done" : metrics.items > 0 ? "warning" : "missing",
      priority: "P1",
      action: metrics.reorderConfiguredItems > 0 ? "Reorder alert exists" : "Set reorder level for key items",
      href: "/inventory/reorder",
      metric: `${metrics.reorderConfiguredItems}/${metrics.items}`,
    },
  ];

  const labChecklist: ChecklistItem[] = [
    {
      id: "lab-policy",
      title: "Choose lab reagent mode",
      description: "Small hospitals should start with soft reagent tracking before strict mode.",
      status: metrics.labPolicyConfigured ? "done" : "missing",
      priority: "P0",
      action: metrics.labPolicyConfigured ? "Lab policy is configured" : "Set lab inventory mode to soft",
      href: "/lab/settings",
      metric: metrics.labPolicyConfigured ? "configured" : "not_configured",
    },
    {
      id: "lab-reagent-catalog",
      title: "Load reagent catalog",
      description: "Default catalog reduces manual typing for lab setup.",
      status: metrics.labConsumables > 0 ? "done" : "missing",
      priority: "P0",
      action: metrics.labConsumables > 0 ? "Reagent catalog exists" : "Load default reagent catalog",
      href: "/lab/settings",
      metric: metrics.labConsumables,
    },
    {
      id: "lab-reagent-stock",
      title: "Add reagent stock",
      description: "Add lot, expiry, QC and location before strict consumption.",
      status: metrics.labStockLots > 0 ? "done" : metrics.labPolicyConfigured ? "warning" : "missing",
      priority: "P1",
      action: metrics.labStockLots > 0 ? "Reagent stock exists" : "Add current reagent stock",
      href: "/lab/monitoring",
      metric: metrics.labStockLots,
    },
    {
      id: "lab-test-mapping",
      title: "Map common lab tests to reagents",
      description: "Strict mode requires common tests to be mapped to reagents/consumables.",
      status: metrics.labMappedTests > 0 ? "done" : "warning",
      priority: "P1",
      action: metrics.labMappedTests > 0 ? "Test mapping exists" : "Map top lab tests first",
      href: "/lab/settings",
      metric: metrics.labMappedTests,
    },
  ];

  const dailyActions: ChecklistItem[] = [
    {
      id: "out-of-stock",
      title: "Review out-of-stock items",
      description: "Out-of-stock items can block pharmacy, lab, ward or billing flow.",
      status: metrics.outOfStockItems > 0 ? "action_required" : "done",
      priority: metrics.outOfStockItems > 0 ? "P0" : "P2",
      action: metrics.outOfStockItems > 0 ? "Receive stock or create purchase request" : "No out-of-stock risk",
      href: "/inventory/stock?OutOfStock=true",
      metric: metrics.outOfStockItems,
    },
    {
      id: "low-stock",
      title: "Review low-stock items",
      description: "Use reorder suggestion to decide what to buy today.",
      status: metrics.lowStockItems > 0 ? "warning" : "done",
      priority: "P1",
      action: metrics.lowStockItems > 0 ? "Open purchase suggestions" : "Low stock is under control",
      href: "/inventory/reorder",
      metric: metrics.lowStockItems,
    },
    {
      id: "expiry-risk",
      title: "Review expiry risk",
      description: "Expired and near-expiry items need FEFO, return or write-off.",
      status: metrics.expiredItems > 0 ? "action_required" : metrics.expiringSoonItems > 0 ? "warning" : "done",
      priority: metrics.expiredItems > 0 ? "P0" : "P1",
      action: metrics.expiredItems > 0 ? "Block/write off expired stock" : metrics.expiringSoonItems > 0 ? "Use expiring stock first" : "Expiry risk is clear",
      href: "/inventory/stock",
      metric: `${metrics.expiredItems} expired / ${metrics.expiringSoonItems} expiring`,
    },
    {
      id: "lab-exceptions",
      title: "Resolve lab reagent exceptions",
      description: "Open exceptions mean reagent stock or test mapping needs review.",
      status: metrics.openLabExceptions > 0 ? "action_required" : "done",
      priority: metrics.openLabExceptions > 0 ? "P0" : "P2",
      action: metrics.openLabExceptions > 0 ? "Resolve reagent exceptions" : "No open reagent exception",
      href: "/lab/monitoring",
      metric: metrics.openLabExceptions,
    },
  ];

  const allItems = [...setupChecklist, ...labChecklist, ...dailyActions];
  const readinessScore = score(allItems);
  const strictModeReady = metrics.labPolicyConfigured && metrics.labConsumables > 0 && metrics.labStockLots > 0 && metrics.labMappedTests > 0 && metrics.openLabExceptions === 0 && metrics.reagentQcRiskLots === 0 && metrics.reagentOpenVialRiskLots === 0;
  const blockingIssues = allItems.filter(item => item.status === "missing" || item.status === "action_required");
  const warnings = allItems.filter(item => item.status === "warning");

  return c.json({
    mode,
    generatedAt: new Date().toISOString(),
    readinessScore,
    smallHospitalReady: readinessScore >= 70 && metrics.stores > 0 && metrics.items > 0 && metrics.stockLots > 0,
    enterpriseReady: readinessScore >= 85 && strictModeReady,
    strictModeReady,
    metrics,
    setupChecklist,
    labChecklist,
    dailyActions,
    blockingIssues,
    warnings,
    recommendedNextActions: [...blockingIssues, ...warnings].slice(0, 6).map(item => ({ id: item.id, title: item.title, action: item.action, href: item.href, priority: item.priority })),
    guidance: {
      simple: "Start with Main Store, item import, opening stock, reorder alerts and soft reagent tracking.",
      standard: "Enable PR/PO/GRN, department requisition and approval workflows gradually.",
      enterprise: "Add reconciliation, granular roles and canonical stock movement service before strict enterprise rollout.",
    },
  });
});

export default quickStart;

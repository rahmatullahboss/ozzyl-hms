const LAB_INVENTORY_CAPABILITIES = {
  strict_mode_available: false,
  strict_billing_atomicity_ready: false,
  reason: "Strict stock control is unavailable until billing and reagent deduction share a transactional reservation/commit workflow."
};
const DEFAULT_LAB_INVENTORY_POLICY = {
  lab_inventory_mode: "soft",
  reagent_consumption_timing: "billing",
  allow_result_without_stock: true,
  require_test_mapping_for_completion: false
};
function normalizeLabReagentConsumptionTiming(value) {
  return value === "result" ? "result" : "billing";
}
function normalizeLabInventoryMode(value) {
  return value === "disabled" || value === "strict" ? value : "soft";
}
function normalizeBoolean(value, fallback) {
  if (value === void 0 || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return fallback;
}
function normalizeLabInventoryPolicy(row) {
  return {
    lab_inventory_mode: normalizeLabInventoryMode(row?.lab_inventory_mode),
    reagent_consumption_timing: normalizeLabReagentConsumptionTiming(row?.reagent_consumption_timing),
    allow_result_without_stock: normalizeBoolean(row?.allow_result_without_stock, DEFAULT_LAB_INVENTORY_POLICY.allow_result_without_stock),
    require_test_mapping_for_completion: normalizeBoolean(row?.require_test_mapping_for_completion, DEFAULT_LAB_INVENTORY_POLICY.require_test_mapping_for_completion)
  };
}
function shouldBlockLabInventoryException(policy, event) {
  if (policy.lab_inventory_mode !== "strict") return false;
  if (event === "result" && policy.allow_result_without_stock) return false;
  return true;
}
async function getLabInventoryPolicy(db, tenantId) {
  try {
    const row = await db.prepare(`
      SELECT lab_inventory_mode,
             reagent_consumption_timing,
             allow_result_without_stock,
             require_test_mapping_for_completion
      FROM lab_inventory_policy
      WHERE tenant_id = ?
      LIMIT 1
    `).bind(String(tenantId)).first();
    return normalizeLabInventoryPolicy(row);
  } catch {
    return DEFAULT_LAB_INVENTORY_POLICY;
  }
}
async function shouldConsumeLabReagentsForEvent(db, tenantId, event) {
  const policy = await getLabInventoryPolicy(db, tenantId);
  if (policy.lab_inventory_mode === "disabled") return false;
  return policy.reagent_consumption_timing === event;
}
function normalizeBindValue(value) {
  if (value === void 0 || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}
async function countRows(db, sql, ...params) {
  const row = await db.prepare(sql).bind(...params.map(normalizeBindValue)).first();
  const parsed = Number(row?.count ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
async function safeCount(db, sql, ...params) {
  try {
    return await countRows(db, sql, ...params);
  } catch {
    return 0;
  }
}
async function safeCountWithFallback(db, primarySql, primaryParams, fallbackSql, fallbackParams) {
  try {
    return await countRows(db, primarySql, ...primaryParams);
  } catch {
    return safeCount(db, fallbackSql, ...fallbackParams);
  }
}
async function getLabInventoryStrictModeReadiness(db, tenantId, referenceDate = /* @__PURE__ */ new Date()) {
  const tenantKey = String(tenantId);
  const referenceDateIso = referenceDate.toISOString().slice(0, 10);
  const in30Days = new Date(referenceDate);
  in30Days.setUTCDate(in30Days.getUTCDate() + 30);
  const in30DaysIso = in30Days.toISOString().slice(0, 10);
  const activeBillingTestsSql = `
    SELECT COUNT(*) AS count
    FROM lab_test_catalog t
    JOIN billing_service_items si
      ON si.id = t.billing_service_item_id
     AND si.tenant_id = t.tenant_id
     AND COALESCE(si.is_active, 1) = 1
    WHERE t.tenant_id = ?
      AND COALESCE(t.is_active, 1) = 1
      AND t.billing_service_item_id IS NOT NULL
      AND COALESCE(t.is_outsourced, 0) = 0
  `;
  const mappedBillingTestsSql = `
    SELECT COUNT(DISTINCT t.id) AS count
    FROM lab_test_catalog t
    JOIN billing_service_items si
      ON si.id = t.billing_service_item_id
     AND si.tenant_id = t.tenant_id
     AND COALESCE(si.is_active, 1) = 1
    JOIN lab_test_consumable_map m
      ON m.lab_test_id = t.id
     AND m.tenant_id = t.tenant_id
     AND COALESCE(m.is_active, 1) = 1
     AND (m.effective_from IS NULL OR datetime(m.effective_from) <= CURRENT_TIMESTAMP)
     AND (m.effective_to IS NULL OR datetime(m.effective_to) > CURRENT_TIMESTAMP)
    WHERE t.tenant_id = ?
      AND COALESCE(t.is_active, 1) = 1
      AND t.billing_service_item_id IS NOT NULL
      AND COALESCE(t.is_outsourced, 0) = 0
  `;
  const legacyStockedLotsFallbackSql = `
    SELECT COUNT(*) AS count
    FROM lab_consumable_stock
    WHERE tenant_id = ? AND quantity_available > 0
  `;
  const combinedStockedLotsSql = `
    SELECT COALESCE(SUM(lot_count), 0) AS count
    FROM (
      SELECT COUNT(1) AS lot_count
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.inventory_stock_id IS NULL
        AND COALESCE(c.is_active, 1) = 1
        AND s.quantity_available > 0
        AND LOWER(COALESCE(s.qc_status, 'not_required')) IN ('accepted','passed','not_required')
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) > date(?))
        AND (s.expiry_date IS NULL OR date(s.expiry_date) > date(?))
      UNION ALL
      SELECT COUNT(1) AS lot_count
      FROM InventoryStock inv
      JOIN lab_consumables c ON c.inventory_item_id = inv.ItemId AND c.tenant_id = inv.tenant_id
      WHERE inv.tenant_id = ?
        AND COALESCE(c.is_active, 1) = 1
        AND COALESCE(inv.IsActive, 1) = 1
        AND (COALESCE(inv.AvailableQuantity, 0)
             - COALESCE(inv.ReservedQuantity, 0)
             - COALESCE(inv.DamagedQuantity, 0)
             - COALESCE(inv.BlockedQuantity, 0)) > 0
        AND LOWER(COALESCE(inv.StockStatus, 'available')) = 'available'
        AND LOWER(COALESCE(inv.QCStatus, 'accepted')) IN ('accepted','passed','not_required')
        AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) > date(?))
        AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) > date(?))
    )
  `;
  const labStockQcRiskSql = `
    SELECT COUNT(*) AS count
    FROM lab_consumable_stock s
    JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
      AND COALESCE(c.is_active, 1) = 1
      AND s.quantity_available > 0
      AND LOWER(COALESCE(s.qc_status, 'not_required')) IN ('pending','failed','rejected')
      AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) > date(?))
      AND (s.expiry_date IS NULL OR date(s.expiry_date) > date(?))
  `;
  const combinedQcRiskSql = `
    SELECT COALESCE(SUM(risk_count), 0) AS count
    FROM (
      SELECT COUNT(1) AS risk_count
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.inventory_stock_id IS NULL
        AND COALESCE(c.is_active, 1) = 1
        AND s.quantity_available > 0
        AND LOWER(COALESCE(s.qc_status, 'not_required')) IN ('pending','failed','rejected')
        AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) > date(?))
        AND (s.expiry_date IS NULL OR date(s.expiry_date) > date(?))
      UNION ALL
      SELECT COUNT(1) AS risk_count
      FROM InventoryStock inv
      JOIN lab_consumables c ON c.inventory_item_id = inv.ItemId AND c.tenant_id = inv.tenant_id
      WHERE inv.tenant_id = ?
        AND COALESCE(c.is_active, 1) = 1
        AND COALESCE(inv.IsActive, 1) = 1
        AND (COALESCE(inv.AvailableQuantity, 0)
             - COALESCE(inv.ReservedQuantity, 0)
             - COALESCE(inv.DamagedQuantity, 0)
             - COALESCE(inv.BlockedQuantity, 0)) > 0
        AND LOWER(COALESCE(inv.QCStatus, 'accepted')) IN ('pending','failed','rejected')
        AND (inv.AfterOpenExpiryDate IS NULL OR date(inv.AfterOpenExpiryDate) > date(?))
        AND (inv.ExpiryDate IS NULL OR inv.ExpiryDate = '' OR date(inv.ExpiryDate) > date(?))
    )
  `;
  const legacyOnboardExpiryRiskFallbackSql = `
    SELECT COUNT(*) AS count
    FROM lab_consumable_stock
    WHERE tenant_id = ?
      AND quantity_available > 0
      AND onboard_expires_at IS NOT NULL
      AND date(onboard_expires_at) <= date(?)
  `;
  const combinedOnboardExpiryRiskSql = `
    SELECT COALESCE(SUM(risk_count), 0) AS count
    FROM (
      SELECT COUNT(1) AS risk_count
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.inventory_stock_id IS NULL
        AND COALESCE(c.is_active, 1) = 1
        AND s.quantity_available > 0
        AND s.onboard_expires_at IS NOT NULL
        AND date(s.onboard_expires_at) <= date(?)
      UNION ALL
      SELECT COUNT(1) AS risk_count
      FROM InventoryStock inv
      JOIN lab_consumables c ON c.inventory_item_id = inv.ItemId AND c.tenant_id = inv.tenant_id
      WHERE inv.tenant_id = ?
        AND COALESCE(c.is_active, 1) = 1
        AND COALESCE(inv.IsActive, 1) = 1
        AND (COALESCE(inv.AvailableQuantity, 0)
             - COALESCE(inv.ReservedQuantity, 0)
             - COALESCE(inv.DamagedQuantity, 0)
             - COALESCE(inv.BlockedQuantity, 0)) > 0
        AND inv.AfterOpenExpiryDate IS NOT NULL
        AND date(inv.AfterOpenExpiryDate) <= date(?)
    )
  `;
  const [
    activeConsumables,
    stockedLots,
    activeMappings,
    activeBillingTests,
    mappedBillingTests,
    openExceptions,
    openStockShortageExceptions,
    qcRiskLots,
    onboardExpiryRiskLots
  ] = await Promise.all([
    safeCount(db, `SELECT COUNT(*) AS count FROM lab_consumables WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    safeCountWithFallback(
      db,
      combinedStockedLotsSql,
      [tenantKey, referenceDateIso, referenceDateIso, tenantKey, referenceDateIso, referenceDateIso],
      legacyStockedLotsFallbackSql,
      [tenantKey]
    ),
    safeCount(db, `SELECT COUNT(*) AS count FROM lab_test_consumable_map WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    safeCount(db, activeBillingTestsSql, tenantId),
    safeCount(db, mappedBillingTestsSql, tenantId),
    safeCount(db, `SELECT COUNT(*) AS count FROM lab_inventory_exceptions WHERE tenant_id = ? AND status = 'open'`, tenantId),
    safeCount(db, `
      SELECT COUNT(*) AS count
      FROM lab_inventory_exceptions
      WHERE tenant_id = ?
        AND status = 'open'
        AND reason IN ('insufficient_stock','missing_stock','stock_shortage','no_usable_stock')
    `, tenantId),
    safeCountWithFallback(
      db,
      combinedQcRiskSql,
      [tenantKey, referenceDateIso, referenceDateIso, tenantKey, referenceDateIso, referenceDateIso],
      labStockQcRiskSql,
      [tenantKey, referenceDateIso, referenceDateIso]
    ),
    safeCountWithFallback(
      db,
      combinedOnboardExpiryRiskSql,
      [tenantKey, in30DaysIso, tenantKey, in30DaysIso],
      legacyOnboardExpiryRiskFallbackSql,
      [tenantKey, in30DaysIso]
    )
  ]);
  const missingBillingTests = Math.max(activeBillingTests - mappedBillingTests, 0);
  const coveragePercent = activeBillingTests > 0 ? Math.round(mappedBillingTests / activeBillingTests * 1e4) / 100 : 0;
  const blockers = [];
  const warnings = [];
  const nextActions = [];
  if (activeConsumables <= 0) {
    blockers.push("No active reagent/consumable catalog found");
    nextActions.push({ id: "seed-reagent-catalog", title: "Load reagent catalog", action: "Seed default reagent catalog or import consumables first" });
  }
  if (stockedLots <= 0) {
    blockers.push("No reagent stock lots with available quantity found");
    nextActions.push({ id: "add-reagent-stock", title: "Add reagent stock", action: "Add current reagent stock with lot, expiry and QC status" });
  }
  if (activeBillingTests <= 0) {
    blockers.push("No active billing-time lab tests found");
    nextActions.push({ id: "activate-billing-tests", title: "Activate billable lab tests", action: "Link active lab tests to billing service items before strict mode" });
  }
  if (missingBillingTests > 0) {
    blockers.push(`${missingBillingTests} active billing lab test${missingBillingTests === 1 ? " needs" : "s need"} reagent mapping`);
    nextActions.push({ id: "map-tests", title: "Complete required mappings", action: "Map every active billing-time lab test to reagent/consumable usage before strict mode" });
  }
  if (activeMappings <= 0) {
    blockers.push("No active test-to-reagent mappings found");
    nextActions.push({ id: "map-common-tests", title: "Map common tests", action: "Map top lab tests to reagent/consumable usage before strict mode" });
  }
  if (openExceptions > 0) {
    blockers.push("Open lab inventory exceptions exist");
    nextActions.push({ id: "resolve-exceptions", title: "Resolve reagent exceptions", action: "Resolve or ignore reviewed exceptions before strict mode" });
  }
  if (qcRiskLots > 0) {
    blockers.push("QC pending or failed reagent lots exist");
    nextActions.push({ id: "review-qc", title: "Review reagent QC", action: "Approve, quarantine or replace QC pending/failed lots" });
  }
  if (onboardExpiryRiskLots > 0) {
    warnings.push("Some opened/on-board reagent lots are near expiry");
    nextActions.push({ id: "review-onboard-expiry", title: "Review opened-vial expiry", action: "Use, replace or write off opened/on-board reagent lots near expiry" });
  }
  const checks = [
    activeConsumables > 0,
    stockedLots > 0,
    activeBillingTests > 0,
    activeMappings > 0,
    missingBillingTests === 0,
    openExceptions === 0,
    qcRiskLots === 0,
    onboardExpiryRiskLots === 0
  ];
  const score = Math.round(checks.filter(Boolean).length / checks.length * 100);
  return {
    ready: blockers.length === 0,
    score,
    counts: {
      activeConsumables,
      stockedLots,
      activeMappings,
      activeBillingTests,
      mappedBillingTests,
      missingBillingTests,
      coveragePercent,
      openExceptions,
      openStockShortageExceptions,
      qcRiskLots,
      onboardExpiryRiskLots
    },
    blockers,
    warnings,
    nextActions
  };
}
async function upsertLabInventoryPolicy(db, input) {
  const policy = normalizeLabInventoryPolicy({
    lab_inventory_mode: input.lab_inventory_mode,
    reagent_consumption_timing: input.reagent_consumption_timing,
    allow_result_without_stock: input.allow_result_without_stock,
    require_test_mapping_for_completion: input.require_test_mapping_for_completion
  });
  await db.prepare(`
    INSERT INTO lab_inventory_policy
      (tenant_id, lab_inventory_mode, reagent_consumption_timing, allow_result_without_stock,
       require_test_mapping_for_completion, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id) DO UPDATE SET
      lab_inventory_mode = excluded.lab_inventory_mode,
      reagent_consumption_timing = excluded.reagent_consumption_timing,
      allow_result_without_stock = excluded.allow_result_without_stock,
      require_test_mapping_for_completion = excluded.require_test_mapping_for_completion,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    String(input.tenantId),
    policy.lab_inventory_mode,
    policy.reagent_consumption_timing,
    policy.allow_result_without_stock ? 1 : 0,
    policy.require_test_mapping_for_completion ? 1 : 0,
    input.userId ?? null
  ).run();
  return policy;
}
export {
  DEFAULT_LAB_INVENTORY_POLICY,
  LAB_INVENTORY_CAPABILITIES,
  getLabInventoryPolicy,
  getLabInventoryStrictModeReadiness,
  normalizeLabInventoryMode,
  normalizeLabInventoryPolicy,
  normalizeLabReagentConsumptionTiming,
  shouldBlockLabInventoryException,
  shouldConsumeLabReagentsForEvent,
  upsertLabInventoryPolicy
};

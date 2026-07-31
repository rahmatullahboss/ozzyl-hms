import { HTTPException } from "hono/http-exception";
import { createInventoryIssue } from "./inventory-issue-service";
import { reverseLabConsumableUsageAtomically } from "./lab-consumable-reversal";
async function hasExistingConsumptionForOrderItem(db, tenantId, labOrderItemId) {
  const existing = await db.prepare(`
    SELECT id
    FROM lab_consumable_movements
    WHERE tenant_id = ?
      AND reference_type = 'lab_order_item'
      AND reference_id = ?
    LIMIT 1
  `).bind(tenantId, labOrderItemId).first();
  return Boolean(existing?.id);
}
async function recordLabInventoryException(db, input) {
  const tenantId = String(input.tenantId);
  const sourceEvent = input.sourceEvent ?? "unknown";
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  try {
    await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO lab_inventory_exceptions
          (tenant_id, lab_order_id, lab_order_item_id, lab_test_id, consumable_id,
           source_event, severity, reason, message, metadata_json, status, created_by,
           occurrence_count, last_occurred_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        tenantId,
        input.labOrderId ?? null,
        input.labOrderItemId ?? null,
        input.labTestId ?? null,
        input.consumableId ?? null,
        sourceEvent,
        input.severity ?? "error",
        input.reason,
        input.message,
        metadataJson,
        input.userId ?? null
      ),
      db.prepare(`
        UPDATE lab_inventory_exceptions
        SET lab_order_id = COALESCE(?, lab_order_id),
            lab_test_id = COALESCE(?, lab_test_id),
            severity = ?,
            message = ?,
            metadata_json = ?,
            occurrence_count = COALESCE(occurrence_count, 0) + 1,
            last_occurred_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND source_event = ?
          AND COALESCE(lab_order_item_id, -1) = COALESCE(?, -1)
          AND COALESCE(consumable_id, -1) = COALESCE(?, -1)
          AND reason = ?
          AND status = 'open'
      `).bind(
        input.labOrderId ?? null,
        input.labTestId ?? null,
        input.severity ?? "error",
        input.message,
        metadataJson,
        tenantId,
        sourceEvent,
        input.labOrderItemId ?? null,
        input.consumableId ?? null,
        input.reason
      )
    ]);
  } catch {
    try {
      await db.prepare(`
        INSERT INTO lab_inventory_exceptions
          (tenant_id, lab_order_id, lab_order_item_id, lab_test_id, consumable_id,
           source_event, severity, reason, message, metadata_json, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        tenantId,
        input.labOrderId ?? null,
        input.labOrderItemId ?? null,
        input.labTestId ?? null,
        input.consumableId ?? null,
        sourceEvent,
        input.severity ?? "error",
        input.reason,
        input.message,
        metadataJson,
        input.userId ?? null
      ).run();
    } catch {
    }
  }
}
async function acquireConsumptionClaimForOrderItem(db, input) {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO lab_consumable_consumption_claims
      (tenant_id, reference_type, reference_id, lab_order_id, lab_test_id, status, attempt_no, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, CURRENT_TIMESTAMP)
  `).bind(
    input.tenantId,
    "lab_order_item",
    input.labOrderItemId,
    input.labOrderId,
    input.labTestId,
    input.userId
  ).run();
  if ((result.meta?.changes ?? 0) > 0) return true;
  try {
    const existing = await db.prepare(`
      SELECT id, status
      FROM lab_consumable_consumption_claims
      WHERE tenant_id = ? AND reference_type = 'lab_order_item' AND reference_id = ?
      LIMIT 1
    `).bind(input.tenantId, input.labOrderItemId).first();
    if (existing?.id && (existing.status === "failed" || existing.status === "committed")) {
      const retryableStatus = existing.status;
      const retry = await db.prepare(`
        UPDATE lab_consumable_consumption_claims
        SET status = 'pending',
            attempt_no = COALESCE(attempt_no, 0) + 1,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ? AND status = ?
      `).bind(existing.id, input.tenantId, retryableStatus).run();
      return (retry.meta?.changes ?? 0) > 0;
    }
  } catch {
  }
  return false;
}
async function markConsumptionClaimForOrderItem(db, input, status, errorMessage) {
  try {
    await db.prepare(`
      UPDATE lab_consumable_consumption_claims
      SET status = ?,
          error_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND reference_type = 'lab_order_item' AND reference_id = ?
    `).bind(status, errorMessage ?? null, input.tenantId, input.labOrderItemId).run();
  } catch {
  }
}
async function releaseConsumptionClaimForOrderItem(db, tenantId, labOrderItemId) {
  try {
    await db.prepare(`
      DELETE FROM lab_consumable_consumption_claims
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item'
        AND reference_id = ?
    `).bind(tenantId, labOrderItemId).run();
  } catch {
  }
}
async function getMappedConsumables(db, tenantId, labTestId) {
  const { results } = await db.prepare(`
    SELECT
      m.consumable_id,
      m.qty_per_test,
      m.is_mandatory,
      c.name as consumable_name,
      c.category
    FROM lab_test_consumable_map m
    JOIN lab_consumables c ON c.id = m.consumable_id AND c.tenant_id = m.tenant_id
    WHERE m.lab_test_id = ?
      AND m.tenant_id = ?
      AND COALESCE(m.is_active, 1) = 1
      AND (m.effective_from IS NULL OR datetime(m.effective_from) <= CURRENT_TIMESTAMP)
      AND (m.effective_to IS NULL OR datetime(m.effective_to) > CURRENT_TIMESTAMP)
      AND c.is_active = 1
  `).bind(labTestId, tenantId).all();
  return results ?? [];
}
async function loadInventoryItemIdForConsumable(db, tenantId, consumableId) {
  try {
    const row = await db.prepare(`
      SELECT inventory_item_id
      FROM lab_consumables
      WHERE tenant_id = ? AND id = ? AND is_active = 1
      LIMIT 1
    `).bind(tenantId, consumableId).first();
    const id = Number(row?.inventory_item_id ?? 0);
    return id > 0 ? id : null;
  } catch {
    return null;
  }
}
async function getProjectedQuantitiesForOrderItem(db, tenantId, labOrderItemId) {
  try {
    const { results } = await db.prepare(`
      SELECT consumable_id, COALESCE(SUM(quantity), 0) AS quantity
      FROM lab_consumable_movements
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item'
        AND reference_id = ?
        AND movement_type = 'usage_out'
      GROUP BY consumable_id
    `).bind(tenantId, labOrderItemId).all();
    return new Map((results ?? []).map((row) => [Number(row.consumable_id), Number(row.quantity ?? 0)]));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
async function getProjectedInventoryQuantitiesForMapping(db, tenantId, labOrderItemId, consumableId) {
  try {
    const { results } = await db.prepare(`
      SELECT COALESCE(inventory_stock_id, stock_id) AS stock_id, COALESCE(SUM(quantity), 0) AS quantity
      FROM lab_consumable_movements
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item'
        AND reference_id = ?
        AND consumable_id = ?
        AND movement_type = 'usage_out'
        AND COALESCE(ledger_type, 'inventory') = 'inventory'
      GROUP BY COALESCE(inventory_stock_id, stock_id)
    `).bind(tenantId, labOrderItemId, consumableId).all();
    return new Map((results ?? []).map((row) => [Number(row.stock_id), Number(row.quantity ?? 0)]));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
async function getCanonicalCommittedAllocations(db, input, inventoryItemId) {
  try {
    const { results } = await db.prepare(`
      SELECT
        ICI.StockId AS stock_id,
        COALESCE(SUM(ICI.Quantity), 0) AS quantity,
        COALESCE(MAX(ICI.CostPrice), 0) AS unit_cost
      FROM InventoryConsumptionItem ICI
      JOIN InventoryConsumption IC ON IC.ConsumptionId = ICI.ConsumptionId
      WHERE IC.tenant_id = ?
        AND IC.IssueType = 'lab_consumption'
        AND IC.LabOrderId = ?
        AND IC.BillingReferenceId = ?
        AND COALESCE(IC.OperationStatus, 'completed') != 'reversed'
        AND ICI.ItemId = ?
      GROUP BY ICI.StockId
    `).bind(
      input.tenantId,
      input.labOrderId,
      input.labOrderItemId,
      inventoryItemId
    ).all();
    return (results ?? []).map((row) => ({
      stock_id: Number(row.stock_id),
      quantity: Number(row.quantity ?? 0),
      unit_cost: Number(row.unit_cost ?? 0)
    })).filter((row) => row.stock_id > 0 && row.quantity > 0);
  } catch {
    return [];
  }
}
async function upsertMappingProgress(db, input, mapping, inventoryItemId, committedQuantity, projectedQuantity, status, lastError) {
  try {
    await db.prepare(`
      INSERT INTO lab_consumable_mapping_progress
        (tenant_id, lab_order_id, lab_order_item_id, lab_test_id, consumable_id, inventory_item_id,
         expected_quantity, committed_quantity, projected_quantity, status, last_error, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(tenant_id, lab_order_item_id, consumable_id) DO UPDATE SET
        expected_quantity = excluded.expected_quantity,
        committed_quantity = excluded.committed_quantity,
        projected_quantity = excluded.projected_quantity,
        inventory_item_id = excluded.inventory_item_id,
        status = excluded.status,
        last_error = excluded.last_error,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      String(input.tenantId),
      input.labOrderId,
      input.labOrderItemId,
      input.labTestId,
      mapping.consumable_id,
      inventoryItemId,
      Number(mapping.qty_per_test || 0),
      committedQuantity,
      projectedQuantity,
      status,
      lastError ?? null,
      String(input.userId)
    ).run();
  } catch {
  }
}
async function getAvailableStock(db, tenantId, consumableId, locationId, machineId) {
  const inventoryItemId = await loadInventoryItemIdForConsumable(db, tenantId, consumableId);
  if (inventoryItemId) {
    try {
      const { results: results2 } = await db.prepare(`
        SELECT
          StockId as id,
          CASE
            WHEN AvailableQuantity - COALESCE(ReservedQuantity, 0) - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0) > 0
              THEN AvailableQuantity - COALESCE(ReservedQuantity, 0) - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0)
            ELSE 0
          END as quantity_available,
          CostPrice as purchase_price,
          'inventory' as ledger_type,
          ItemId as inventory_item_id,
          StoreId as store_id,
          BatchNo as batch_no,
          ExpiryDate as expiry_date
        FROM InventoryStock
        WHERE tenant_id = ?
          AND ItemId = ?
          AND (? IS NULL OR StoreId = ?)
          AND AvailableQuantity - COALESCE(ReservedQuantity, 0) - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0) > 0
          AND COALESCE(IsActive, 1) = 1
          AND COALESCE(StockStatus, 'available') = 'available'
          AND COALESCE(QCStatus, 'accepted') IN ('accepted', 'passed', 'not_required')
          AND (AfterOpenExpiryDate IS NULL OR date(AfterOpenExpiryDate) > CURRENT_DATE)
          AND (ExpiryDate IS NULL OR ExpiryDate = '' OR date(ExpiryDate) > CURRENT_DATE)
        ORDER BY
          CASE WHEN ? IS NOT NULL AND EXISTS (
            SELECT 1 FROM lab_reagent_analyzer_assignments lraa
            WHERE lraa.tenant_id = InventoryStock.tenant_id
              AND lraa.stock_id = InventoryStock.StockId
              AND lraa.machine_id = ?
              AND lraa.status = 'active'
          ) THEN 0 ELSE 1 END,
          CASE WHEN ExpiryDate IS NULL OR ExpiryDate = '' THEN 1 ELSE 0 END,
          ExpiryDate ASC,
          StockId ASC
      `).bind(tenantId, inventoryItemId, locationId ?? null, locationId ?? null, machineId ?? null, machineId ?? null).all();
      return results2 ?? [];
    } catch {
    }
  }
  const { results } = await db.prepare(`
    SELECT
      s.id,
      s.quantity_available,
      s.purchase_price,
      c.unit_price,
      'lab' as ledger_type
    FROM lab_consumable_stock s
    LEFT JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
      AND s.consumable_id = ?
      AND (? IS NULL OR s.location_id = ?)
      AND s.quantity_available > 0
      AND s.qc_status IN ('not_required', 'passed')
      AND (s.onboard_expires_at IS NULL OR date(s.onboard_expires_at) > CURRENT_DATE)
      AND (s.expiry_date IS NULL OR date(s.expiry_date) > CURRENT_DATE)
    ORDER BY
      CASE WHEN s.expiry_date IS NULL THEN 1 ELSE 0 END,
      s.expiry_date ASC,
      s.created_at ASC
  `).bind(tenantId, consumableId, locationId ?? null, locationId ?? null).all();
  return results ?? [];
}
async function deductStockQty(db, tenantId, stock, deductQty) {
  const result = stock.ledger_type === "inventory" ? await db.prepare(`
      UPDATE InventoryStock
      SET AvailableQuantity = AvailableQuantity - ?
      WHERE StockId = ?
        AND tenant_id = ?
        AND AvailableQuantity >= ?
        AND COALESCE(IsActive, 1) = 1
        AND COALESCE(StockStatus, 'available') = 'available'
        AND COALESCE(QCStatus, 'accepted') IN ('accepted', 'passed', 'not_required')
        AND (AfterOpenExpiryDate IS NULL OR date(AfterOpenExpiryDate) > CURRENT_DATE)
        AND (ExpiryDate IS NULL OR ExpiryDate = '' OR date(ExpiryDate) > CURRENT_DATE)
    `).bind(deductQty, stock.id, tenantId, deductQty).run() : await db.prepare(`
      UPDATE lab_consumable_stock
      SET quantity_used = quantity_used + ?
      WHERE id = ?
        AND tenant_id = ?
        AND quantity_available >= ?
        AND qc_status IN ('not_required', 'passed')
        AND (onboard_expires_at IS NULL OR date(onboard_expires_at) > CURRENT_DATE)
        AND (expiry_date IS NULL OR date(expiry_date) > CURRENT_DATE)
    `).bind(deductQty, stock.id, tenantId, deductQty).run();
  const changes = result.meta?.changes;
  if (changes === 0) {
    throw new HTTPException(409, {
      message: "Lab consumable stock changed while submitting this result. Please retry after refreshing stock."
    });
  }
}
function canonicalQuantityKey(value) {
  return Number(value.toFixed(6)).toString();
}
function buildCanonicalLabInventoryOperationKey(input) {
  return `lab-reagent:${input.tenantId}:${input.labOrderItemId}:${input.inventoryItemId}:${input.stockId}:${canonicalQuantityKey(input.quantity)}`;
}
async function recordCanonicalInventoryConsumption(db, input) {
  if (input.stock.ledger_type !== "inventory" || !input.stock.inventory_item_id || !input.stock.store_id) return;
  const tenantId = String(input.tenantId);
  const userId = String(input.userId);
  const issuePayload = {
    IssueType: "lab_consumption",
    FromStoreId: Number(input.stock.store_id),
    ToDepartment: "Lab",
    LabOrderId: input.labOrderId ?? void 0,
    BillingReferenceId: input.referenceType === "lab_order_item" ? input.referenceId ?? void 0 : void 0,
    Chargeable: false,
    Remarks: input.remarks,
    IdempotencyKey: buildCanonicalLabInventoryOperationKey({
      tenantId,
      labOrderItemId: Number(input.referenceId ?? 0),
      inventoryItemId: Number(input.stock.inventory_item_id),
      stockId: Number(input.stock.id),
      quantity: input.quantity
    }),
    Items: [{
      ItemId: Number(input.stock.inventory_item_id),
      StockId: Number(input.stock.id),
      Quantity: input.quantity,
      Remarks: input.remarks
    }]
  };
  await createInventoryIssue({
    db,
    tenantId,
    userId
  }, issuePayload);
}
async function insertLabConsumableMovement(db, input) {
  const stockId = input.ledgerType === "inventory" ? input.inventoryStockId ?? input.stockId ?? null : input.labStockId ?? input.stockId ?? null;
  const labStockId = input.ledgerType === "lab" ? input.labStockId ?? input.stockId ?? null : input.labStockId ?? null;
  const inventoryStockId = input.ledgerType === "inventory" ? input.inventoryStockId ?? input.stockId ?? null : input.inventoryStockId ?? null;
  try {
    const result = await db.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, ledger_type, lab_stock_id, inventory_stock_id, movement_type,
         quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.consumableId,
      stockId,
      input.ledgerType,
      labStockId,
      inventoryStockId,
      input.movementType,
      input.quantity,
      input.unitCost,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.performedBy ?? null,
      input.remarks ?? null,
      input.tenantId
    ).run();
    return Number(result.meta.last_row_id ?? 0);
  } catch {
    const result = await db.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.consumableId,
      stockId,
      input.movementType,
      input.quantity,
      input.unitCost,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.performedBy ?? null,
      input.remarks ?? null,
      input.tenantId
    ).run();
    return Number(result.meta.last_row_id ?? 0);
  }
}
async function consumeLegacyMappedStockAtomically(db, input, mapping, stock, quantity, unitCost) {
  const update = db.prepare(`
    UPDATE lab_consumable_stock
    SET quantity_used = quantity_used + ?
    WHERE id = ?
      AND tenant_id = ?
      AND quantity_available >= ?
      AND qc_status IN ('not_required', 'passed')
      AND (onboard_expires_at IS NULL OR date(onboard_expires_at) > CURRENT_DATE)
      AND (expiry_date IS NULL OR date(expiry_date) > CURRENT_DATE)
  `).bind(quantity, stock.id, input.tenantId, quantity);
  const movement = db.prepare(`
    INSERT INTO lab_consumable_movements
      (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    mapping.consumable_id,
    stock.id,
    "usage_out",
    quantity,
    unitCost,
    "lab_order_item",
    input.labOrderItemId,
    input.userId,
    `Auto usage for lab order ${input.labOrderId}`,
    input.tenantId
  );
  const operationLog = db.prepare(`
    INSERT INTO lab_operation_logs
      (log_date, log_type, lab_test_id, consumable_id, lab_order_id, quantity, description, performed_by, tenant_id)
    SELECT CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    "reagent_used",
    input.labTestId,
    mapping.consumable_id,
    input.labOrderId,
    quantity,
    `Auto reagent usage: ${mapping.consumable_name ?? `#${mapping.consumable_id}`}`,
    input.userId,
    input.tenantId
  );
  if (typeof db.batch === "function") {
    const results = await db.batch([update, movement, operationLog]);
    const rawUpdateChanges = results[0]?.meta?.changes;
    if (rawUpdateChanges !== void 0 && Number(rawUpdateChanges) !== 1) {
      throw new HTTPException(409, {
        message: "Lab consumable stock changed while submitting this result. Please retry after refreshing stock."
      });
    }
    return Number(results[1]?.meta?.last_row_id ?? 0);
  }
  await deductStockQty(db, input.tenantId, stock, quantity);
  const movementId = await insertLabConsumableMovement(db, {
    tenantId: input.tenantId,
    consumableId: mapping.consumable_id,
    stockId: stock.id,
    labStockId: stock.id,
    ledgerType: "lab",
    movementType: "usage_out",
    quantity,
    unitCost,
    referenceType: "lab_order_item",
    referenceId: input.labOrderItemId,
    performedBy: input.userId,
    remarks: `Auto usage for lab order ${input.labOrderId}`
  });
  await operationLog.run();
  return movementId;
}
async function backfillCanonicalLabMovementProjection(db, input, mapping, allocations) {
  const projectedByStock = await getProjectedInventoryQuantitiesForMapping(
    db,
    input.tenantId,
    input.labOrderItemId,
    mapping.consumable_id
  );
  let projectedQuantity = 0;
  let projectedCost = 0;
  let insertedMovements = 0;
  for (const allocation of allocations) {
    const alreadyProjected = Number(projectedByStock.get(allocation.stock_id) ?? 0);
    projectedQuantity += alreadyProjected;
    projectedCost += alreadyProjected * allocation.unit_cost;
    const missing = Math.max(0, allocation.quantity - alreadyProjected);
    if (missing <= 0) continue;
    await insertLabConsumableMovement(db, {
      tenantId: input.tenantId,
      consumableId: mapping.consumable_id,
      stockId: allocation.stock_id,
      inventoryStockId: allocation.stock_id,
      ledgerType: "inventory",
      movementType: "usage_out",
      quantity: missing,
      unitCost: allocation.unit_cost,
      referenceType: "lab_order_item",
      referenceId: input.labOrderItemId,
      performedBy: input.userId,
      remarks: `Reconciled canonical usage for lab order ${input.labOrderId}`
    });
    await db.prepare(`
      INSERT INTO lab_operation_logs
        (log_date, log_type, lab_test_id, consumable_id, lab_order_id, quantity, description, performed_by, tenant_id)
      VALUES (CURRENT_DATE, 'reagent_used', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.labTestId,
      mapping.consumable_id,
      input.labOrderId,
      missing,
      `Reconciled reagent projection: ${mapping.consumable_name ?? `#${mapping.consumable_id}`}`,
      input.userId,
      input.tenantId
    ).run();
    projectedQuantity += missing;
    projectedCost += missing * allocation.unit_cost;
    insertedMovements += 1;
  }
  return { projectedQuantity, projectedCost, insertedMovements };
}
async function loadConsumableUsageMovementsForOrderItem(db, tenantId, labOrderItemId) {
  try {
    const { results } = await db.prepare(`
      SELECT id, consumable_id, stock_id, lab_stock_id, inventory_stock_id, ledger_type, quantity, unit_cost
      FROM lab_consumable_movements
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item'
        AND reference_id = ?
        AND movement_type = 'usage_out'
      ORDER BY id ASC
    `).bind(tenantId, labOrderItemId).all();
    return results ?? [];
  } catch {
    const { results } = await db.prepare(`
      SELECT id, consumable_id, stock_id, quantity, unit_cost
      FROM lab_consumable_movements
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item'
        AND reference_id = ?
        AND movement_type = 'usage_out'
      ORDER BY id ASC
    `).bind(tenantId, labOrderItemId).all();
    return (results ?? []).map((row) => ({ ...row, ledger_type: null, lab_stock_id: null, inventory_stock_id: null }));
  }
}
async function consumeLabConsumableStock(db, input) {
  if (input.quantity <= 0) {
    throw new HTTPException(400, { message: "Quantity must be greater than zero" });
  }
  const stockRows = await getAvailableStock(db, input.tenantId, input.consumableId, input.locationId ?? null);
  const availableQty = stockRows.reduce((sum, row) => sum + Number(row.quantity_available || 0), 0);
  if (availableQty < input.quantity) {
    throw new HTTPException(400, {
      message: `Insufficient stock. Short by ${input.quantity - availableQty} units.`
    });
  }
  let remaining = input.quantity;
  let quantityUsed = 0;
  let movementCount = 0;
  let totalCost = 0;
  const movementIds = [];
  for (const stock of stockRows) {
    if (remaining <= 0) break;
    const deductQty = Math.min(remaining, Number(stock.quantity_available || 0));
    if (deductQty <= 0) continue;
    const unitCost = Number(stock.purchase_price ?? stock.unit_price ?? 0);
    if (stock.ledger_type === "inventory") {
      await recordCanonicalInventoryConsumption(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        stock,
        quantity: deductQty,
        referenceType: input.referenceType ?? "manual",
        referenceId: input.referenceId ?? null,
        remarks: input.remarks ?? "Stock used",
        labOrderId: null
      });
    } else {
      await deductStockQty(db, input.tenantId, stock, deductQty);
    }
    const movementId = await insertLabConsumableMovement(db, {
      tenantId: input.tenantId,
      consumableId: input.consumableId,
      stockId: stock.id,
      labStockId: stock.ledger_type === "lab" ? stock.id : null,
      inventoryStockId: stock.ledger_type === "inventory" ? stock.id : null,
      ledgerType: stock.ledger_type === "inventory" ? "inventory" : "lab",
      movementType: "usage_out",
      quantity: deductQty,
      unitCost,
      referenceType: input.referenceType ?? "manual",
      referenceId: input.referenceId ?? null,
      performedBy: input.userId,
      remarks: input.remarks ?? "Stock used"
    });
    if (movementId > 0) movementIds.push(movementId);
    remaining -= deductQty;
    quantityUsed += deductQty;
    movementCount += 1;
    totalCost += deductQty * unitCost;
  }
  return { quantity_used: quantityUsed, movements: movementCount, cost: totalCost, movement_ids: movementIds };
}
async function consumeMappedLabConsumables(db, input) {
  const mappings = await getMappedConsumables(db, input.tenantId, input.labTestId);
  if (mappings.length === 0) {
    if (input.requireMapping) {
      const message = `No lab reagent mapping configured for lab test #${input.labTestId}.`;
      await recordLabInventoryException(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        labOrderId: input.labOrderId,
        labOrderItemId: input.labOrderItemId,
        labTestId: input.labTestId,
        sourceEvent: "lab_order_item_consumption",
        reason: "missing_test_mapping",
        message,
        metadata: { machineId: input.machineId ?? null }
      });
      throw new HTTPException(409, { message });
    }
    return { mappings: 0, quantity: 0, cost: 0 };
  }
  const projectedByConsumable = await getProjectedQuantitiesForOrderItem(
    db,
    input.tenantId,
    input.labOrderItemId
  );
  const stockByConsumable = /* @__PURE__ */ new Map();
  const stateByConsumable = /* @__PURE__ */ new Map();
  let allMandatoryMappingsComplete = true;
  for (const mapping of mappings) {
    const expectedQuantity = Number(mapping.qty_per_test || 0);
    if (expectedQuantity <= 0) continue;
    const inventoryItemId = await loadInventoryItemIdForConsumable(
      db,
      input.tenantId,
      mapping.consumable_id
    );
    const canonicalAllocations = inventoryItemId ? await getCanonicalCommittedAllocations(db, input, inventoryItemId) : [];
    const canonicalCommittedQuantity = canonicalAllocations.reduce(
      (sum, row) => sum + Number(row.quantity || 0),
      0
    );
    const projectedQuantity = Number(projectedByConsumable.get(mapping.consumable_id) ?? 0);
    const committedQuantity = inventoryItemId ? canonicalCommittedQuantity : projectedQuantity;
    const remainingQuantity = Math.max(0, expectedQuantity - committedQuantity);
    stateByConsumable.set(mapping.consumable_id, {
      inventoryItemId,
      canonicalAllocations,
      committedQuantity,
      projectedQuantity,
      remainingQuantity
    });
    const mappingComplete = committedQuantity >= expectedQuantity && (!inventoryItemId || projectedQuantity >= committedQuantity);
    if (mapping.is_mandatory && !mappingComplete) allMandatoryMappingsComplete = false;
    if (remainingQuantity <= 0) continue;
    const stockRows = await getAvailableStock(
      db,
      input.tenantId,
      mapping.consumable_id,
      null,
      input.machineId
    );
    stockByConsumable.set(mapping.consumable_id, stockRows);
    const availableQty = stockRows.reduce((sum, row) => sum + Number(row.quantity_available || 0), 0);
    if (mapping.is_mandatory && availableQty < remainingQuantity) {
      const message = `Insufficient lab consumable stock for ${mapping.consumable_name ?? `#${mapping.consumable_id}`}. Required ${remainingQuantity}, available ${availableQty}.`;
      await recordLabInventoryException(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        labOrderId: input.labOrderId,
        labOrderItemId: input.labOrderItemId,
        labTestId: input.labTestId,
        consumableId: mapping.consumable_id,
        sourceEvent: "lab_order_item_consumption",
        reason: "insufficient_stock",
        message,
        metadata: {
          expectedQuantity,
          committedQuantity,
          remainingQuantity,
          availableQty,
          machineId: input.machineId ?? null
        }
      });
      throw new HTTPException(409, { message });
    }
  }
  if (allMandatoryMappingsComplete) {
    await markConsumptionClaimForOrderItem(db, input, "committed");
    return { mappings: 0, quantity: 0, cost: 0 };
  }
  const claimAcquired = await acquireConsumptionClaimForOrderItem(db, input);
  if (!claimAcquired) {
    const message = "Lab consumable usage is already being recorded for this order item. Please retry after refreshing.";
    await recordLabInventoryException(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      labOrderId: input.labOrderId,
      labOrderItemId: input.labOrderItemId,
      labTestId: input.labTestId,
      sourceEvent: "lab_order_item_consumption",
      reason: "claim_conflict",
      message,
      metadata: { machineId: input.machineId ?? null }
    });
    throw new HTTPException(409, { message });
  }
  let totalQuantity = 0;
  let totalCost = 0;
  let consumedMappings = 0;
  let activeMapping = null;
  try {
    let allMandatoryMappingsCommitted = true;
    for (const mapping of mappings) {
      activeMapping = mapping;
      const expectedQuantity = Number(mapping.qty_per_test || 0);
      if (expectedQuantity <= 0) continue;
      const state = stateByConsumable.get(mapping.consumable_id) ?? {
        inventoryItemId: null,
        canonicalAllocations: [],
        committedQuantity: 0,
        projectedQuantity: 0,
        remainingQuantity: expectedQuantity
      };
      let committedQuantity = state.committedQuantity;
      let projectedQuantity = state.projectedQuantity;
      let mappingChanged = false;
      if (state.inventoryItemId && state.canonicalAllocations.length > 0 && projectedQuantity < committedQuantity) {
        const backfill = await backfillCanonicalLabMovementProjection(db, input, mapping, state.canonicalAllocations);
        projectedQuantity = backfill.projectedQuantity;
        mappingChanged = backfill.insertedMovements > 0;
      }
      let remainingQty = Math.max(0, expectedQuantity - committedQuantity);
      const stockRows = stockByConsumable.get(mapping.consumable_id) ?? [];
      for (const stock of stockRows) {
        if (remainingQty <= 0) break;
        const deductQty = Math.min(remainingQty, Number(stock.quantity_available || 0));
        if (deductQty <= 0) continue;
        const unitCost = Number(stock.purchase_price ?? stock.unit_price ?? 0);
        if (stock.ledger_type === "inventory") {
          await recordCanonicalInventoryConsumption(db, {
            tenantId: input.tenantId,
            userId: input.userId,
            stock,
            quantity: deductQty,
            referenceType: "lab_order_item",
            referenceId: input.labOrderItemId,
            remarks: `Auto usage for lab order ${input.labOrderId}`,
            labOrderId: input.labOrderId
          });
          await insertLabConsumableMovement(db, {
            tenantId: input.tenantId,
            consumableId: mapping.consumable_id,
            stockId: stock.id,
            inventoryStockId: stock.id,
            ledgerType: "inventory",
            movementType: "usage_out",
            quantity: deductQty,
            unitCost,
            referenceType: "lab_order_item",
            referenceId: input.labOrderItemId,
            performedBy: input.userId,
            remarks: `Auto usage for lab order ${input.labOrderId}`
          });
          await db.prepare(`
            INSERT INTO lab_operation_logs
              (log_date, log_type, lab_test_id, consumable_id, lab_order_id, quantity, description, performed_by, tenant_id)
            VALUES (CURRENT_DATE, 'reagent_used', ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            input.labTestId,
            mapping.consumable_id,
            input.labOrderId,
            deductQty,
            `Auto reagent usage: ${mapping.consumable_name ?? `#${mapping.consumable_id}`}`,
            input.userId,
            input.tenantId
          ).run();
        } else {
          await consumeLegacyMappedStockAtomically(db, input, mapping, stock, deductQty, unitCost);
        }
        committedQuantity += deductQty;
        projectedQuantity += deductQty;
        remainingQty -= deductQty;
        totalQuantity += deductQty;
        totalCost += deductQty * unitCost;
        mappingChanged = true;
      }
      const mappingCommitted = committedQuantity >= expectedQuantity && (!state.inventoryItemId || projectedQuantity >= committedQuantity);
      if (mapping.is_mandatory && !mappingCommitted) allMandatoryMappingsCommitted = false;
      await upsertMappingProgress(
        db,
        input,
        mapping,
        state.inventoryItemId,
        committedQuantity,
        projectedQuantity,
        mappingCommitted ? "committed" : committedQuantity > 0 ? "partial" : "pending"
      );
      if (mappingCommitted && mappingChanged) consumedMappings += 1;
    }
    if (!allMandatoryMappingsCommitted) {
      throw new HTTPException(409, { message: "Lab consumable usage is only partially committed. Retry after reviewing inventory exceptions." });
    }
    activeMapping = null;
    if (consumedMappings > 0) {
      try {
        await db.prepare(`
          INSERT INTO lab_operation_logs
            (log_date, log_type, lab_test_id, lab_order_id, quantity, description, performed_by, tenant_id)
          VALUES (CURRENT_DATE, ?, ?, ?, 1, ?, ?, ?)
        `).bind(
          "test_performed",
          input.labTestId,
          input.labOrderId,
          `Lab result completed for order item ${input.labOrderItemId}`,
          input.userId,
          input.tenantId
        ).run();
      } catch (logError) {
        const logMessage = logError instanceof Error ? logError.message : "Failed to record test-performed operation log";
        await recordLabInventoryException(db, {
          tenantId: input.tenantId,
          userId: input.userId,
          labOrderId: input.labOrderId,
          labOrderItemId: input.labOrderItemId,
          labTestId: input.labTestId,
          sourceEvent: "lab_order_item_consumption",
          severity: "warning",
          reason: "operation_log_projection_failed",
          message: logMessage
        });
      }
    }
    await markConsumptionClaimForOrderItem(db, input, "committed");
    return { mappings: consumedMappings, quantity: totalQuantity, cost: totalCost };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record lab consumable usage";
    if (activeMapping) {
      const state = stateByConsumable.get(activeMapping.consumable_id);
      const inventoryItemId = state?.inventoryItemId ?? null;
      const canonicalAllocations = inventoryItemId ? await getCanonicalCommittedAllocations(db, input, inventoryItemId) : [];
      const projectedMap = await getProjectedQuantitiesForOrderItem(db, input.tenantId, input.labOrderItemId);
      const projectedQuantity = Number(projectedMap.get(activeMapping.consumable_id) ?? 0);
      const committedQuantity = inventoryItemId ? canonicalAllocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) : projectedQuantity;
      await upsertMappingProgress(
        db,
        input,
        activeMapping,
        inventoryItemId,
        committedQuantity,
        projectedQuantity,
        "failed",
        message
      );
    }
    await markConsumptionClaimForOrderItem(db, input, "failed", message);
    await recordLabInventoryException(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      labOrderId: input.labOrderId,
      labOrderItemId: input.labOrderItemId,
      labTestId: input.labTestId,
      sourceEvent: "lab_order_item_consumption",
      reason: "consumption_failed",
      message,
      metadata: { machineId: input.machineId ?? null }
    });
    const hasMovement = await hasExistingConsumptionForOrderItem(db, input.tenantId, input.labOrderItemId);
    if (!hasMovement) {
      await releaseConsumptionClaimForOrderItem(db, input.tenantId, input.labOrderItemId);
    }
    throw error;
  }
}
async function reverseMappedLabConsumablesForOrderItem(db, input) {
  return reverseLabConsumableUsageAtomically(db, input);
}
export {
  buildCanonicalLabInventoryOperationKey,
  consumeLabConsumableStock,
  consumeMappedLabConsumables,
  recordLabInventoryException,
  reverseMappedLabConsumablesForOrderItem
};

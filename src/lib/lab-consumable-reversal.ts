import { HTTPException } from 'hono/http-exception';

export type LabMovementLedgerType = 'lab' | 'inventory';

type UsageMovementRow = {
  id: number;
  consumable_id: number;
  stock_id: number | null;
  lab_stock_id?: number | null;
  inventory_stock_id?: number | null;
  ledger_type?: LabMovementLedgerType | null;
  quantity: number;
  unit_cost: number | null;
};

type LegacyStockSnapshot = {
  id: number;
  quantity_used: number;
};

type InventoryStockSnapshot = {
  StockId: number;
  ItemId: number;
  StoreId: number;
  AvailableQuantity: number;
  BatchNo?: string | null;
};

export type ReverseLabConsumableUsageInput = {
  tenantId: string | number;
  userId: string | number;
  labOrderItemId: number;
  reason?: string | null;
};

export type ReverseLabConsumableUsageResult = {
  reversed: number;
  quantity: number;
  cost: number;
};

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  try {
    const row = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    ).bind(tableName).first<{ name?: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

async function columnExists(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name?: string }>();
    return (results ?? []).some((row) => row.name === columnName);
  } catch {
    return false;
  }
}

async function loadUsageMovements(
  db: D1Database,
  tenantId: string | number,
  labOrderItemId: number,
): Promise<UsageMovementRow[]> {
  try {
    const { results } = await db.prepare(`
      SELECT id, consumable_id, stock_id, lab_stock_id, inventory_stock_id, ledger_type, quantity, unit_cost
      FROM lab_consumable_movements
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item'
        AND reference_id = ?
        AND movement_type = 'usage_out'
      ORDER BY id ASC
    `).bind(tenantId, labOrderItemId).all<UsageMovementRow>();
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
    `).bind(tenantId, labOrderItemId).all<UsageMovementRow>();
    return (results ?? []).map((row) => ({ ...row, ledger_type: 'lab' }));
  }
}

async function loadReversedMovementIds(
  db: D1Database,
  tenantId: string | number,
  labOrderItemId: number,
): Promise<Set<number>> {
  try {
    const { results } = await db.prepare(`
      SELECT reverses_movement_id
      FROM lab_consumable_movements
      WHERE tenant_id = ?
        AND reference_type = 'lab_order_item_reversal'
        AND reference_id = ?
        AND movement_type = 'return'
        AND reverses_movement_id IS NOT NULL
    `).bind(tenantId, labOrderItemId).all<{ reverses_movement_id: number }>();
    return new Set((results ?? []).map((row) => Number(row.reverses_movement_id)).filter((id) => id > 0));
  } catch {
    return new Set();
  }
}

function resolvedStockId(movement: UsageMovementRow, ledgerType: LabMovementLedgerType): number {
  return Number(
    (ledgerType === 'inventory' ? movement.inventory_stock_id : movement.lab_stock_id)
      ?? movement.stock_id
      ?? 0,
  );
}

function reversalGuardStatement(
  db: D1Database,
  tenantId: string | number,
  operationKey: string,
  stepKey: string,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO lab_reagent_reversal_guard (tenant_id, operation_key, step_key, assertion_value)
    SELECT ?, ?, ?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END
  `).bind(String(tenantId), operationKey, stepKey);
}

export async function reverseLabConsumableUsageAtomically(
  db: D1Database,
  input: ReverseLabConsumableUsageInput,
): Promise<ReverseLabConsumableUsageResult> {
  const sourceMovements = await loadUsageMovements(db, input.tenantId, input.labOrderItemId);
  if (sourceMovements.length === 0) return { reversed: 0, quantity: 0, cost: 0 };

  const reversedSourceIds = await loadReversedMovementIds(db, input.tenantId, input.labOrderItemId);
  const pendingMovements = sourceMovements.filter((movement) => !reversedSourceIds.has(Number(movement.id)));
  if (pendingMovements.length === 0) return { reversed: 0, quantity: 0, cost: 0 };

  const remarks = input.reason ? `Reversal: ${input.reason}` : 'Reversal for cancelled lab order item';
  const operationKey = `lab-reversal:${String(input.tenantId)}:${input.labOrderItemId}`;
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM lab_reagent_reversal_guard WHERE tenant_id = ? AND operation_key = ?')
      .bind(String(input.tenantId), operationKey),
  ];
  const legacySnapshots = new Map<number, number>();
  const inventorySnapshots = new Map<number, InventoryStockSnapshot>();
  const hasAuditLog = await tableExists(db, 'InventoryAuditLog');
  const hasCanonicalConsumption = await tableExists(db, 'InventoryConsumption')
    && await columnExists(db, 'InventoryConsumption', 'OperationStatus');
  const hasClaims = await tableExists(db, 'lab_consumable_consumption_claims');
  const hasProgress = await tableExists(db, 'lab_consumable_mapping_progress');

  let reversed = 0;
  let totalQuantity = 0;
  let totalCost = 0;

  for (const movement of pendingMovements) {
    const qty = Number(movement.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const ledgerType: LabMovementLedgerType = movement.ledger_type === 'inventory' ? 'inventory' : 'lab';
    const stockId = resolvedStockId(movement, ledgerType);
    if (stockId <= 0) {
      throw new HTTPException(409, { message: `Cannot reverse reagent movement ${movement.id}; stock lot is missing.` });
    }

    if (ledgerType === 'lab') {
      let currentQuantityUsed = legacySnapshots.get(stockId);
      if (currentQuantityUsed === undefined) {
        const snapshot = await db.prepare(`
          SELECT id, quantity_used
          FROM lab_consumable_stock
          WHERE id = ? AND tenant_id = ?
          LIMIT 1
        `).bind(stockId, input.tenantId).first<LegacyStockSnapshot>();
        if (!snapshot) {
          throw new HTTPException(409, { message: `Cannot reverse lab reagent stock ${stockId}; lot was not found.` });
        }
        currentQuantityUsed = Number(snapshot.quantity_used ?? 0);
      }
      if (currentQuantityUsed < qty) {
        throw new HTTPException(409, { message: `Cannot reverse lab reagent stock ${stockId}; used quantity is lower than the return.` });
      }
      const nextQuantityUsed = currentQuantityUsed - qty;
      statements.push(db.prepare(`
        UPDATE lab_consumable_stock
        SET quantity_used = ?
        WHERE id = ? AND tenant_id = ? AND quantity_used = ?
      `).bind(nextQuantityUsed, stockId, input.tenantId, currentQuantityUsed));
      statements.push(reversalGuardStatement(db, input.tenantId, operationKey, `legacy-stock:${movement.id}`));
      legacySnapshots.set(stockId, nextQuantityUsed);
    } else {
      let inventoryStock = inventorySnapshots.get(stockId);
      if (!inventoryStock) {
        inventoryStock = await db.prepare(`
          SELECT StockId, ItemId, StoreId, AvailableQuantity, BatchNo
          FROM InventoryStock
          WHERE StockId = ? AND tenant_id = ?
          LIMIT 1
        `).bind(stockId, input.tenantId).first<InventoryStockSnapshot>() ?? undefined;
      }
      if (!inventoryStock) {
        throw new HTTPException(409, { message: `Cannot reverse lab reagent stock ${stockId}; canonical stock lot was not found.` });
      }
      const currentAvailable = Number(inventoryStock.AvailableQuantity ?? 0);
      const balanceAfterReturn = currentAvailable + qty;
      statements.push(db.prepare(`
        UPDATE InventoryStock
        SET AvailableQuantity = ?, ModifiedBy = ?, ModifiedOn = CURRENT_TIMESTAMP
        WHERE StockId = ? AND tenant_id = ? AND AvailableQuantity = ?
      `).bind(balanceAfterReturn, input.userId, stockId, input.tenantId, currentAvailable));
      statements.push(reversalGuardStatement(db, input.tenantId, operationKey, `inventory-stock:${movement.id}`));
      statements.push(db.prepare(`
        INSERT INTO InventoryStockTransaction
          (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
           InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, 'return_in', ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        input.tenantId,
        stockId,
        inventoryStock.ItemId,
        inventoryStock.StoreId,
        `LAB-REV-${input.labOrderItemId}`,
        input.labOrderItemId,
        qty,
        balanceAfterReturn,
        remarks,
        input.userId,
      ));
      if (hasAuditLog) {
        statements.push(db.prepare(`
          INSERT INTO InventoryAuditLog
            (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
             ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
          VALUES (?, 'stock_return', 'InventoryStock', ?, ?, ?, ?, ?, 'lab_order_item_reversal', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          input.tenantId,
          stockId,
          inventoryStock.ItemId,
          stockId,
          inventoryStock.BatchNo ?? null,
          inventoryStock.StoreId,
          input.labOrderItemId,
          JSON.stringify({ AvailableQuantity: currentAvailable }),
          JSON.stringify({ AvailableQuantity: balanceAfterReturn, returnedQuantity: qty }),
          input.userId,
        ));
      }
      inventorySnapshots.set(stockId, { ...inventoryStock, AvailableQuantity: balanceAfterReturn });
    }

    statements.push(db.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, lab_stock_id, inventory_stock_id, ledger_type,
         movement_type, quantity, unit_cost, reference_type, reference_id,
         performed_by, remarks, tenant_id, reverses_movement_id)
      VALUES (?, ?, ?, ?, ?, 'return', ?, ?, 'lab_order_item_reversal', ?, ?, ?, ?, ?)
    `).bind(
      movement.consumable_id,
      stockId,
      ledgerType === 'lab' ? stockId : null,
      ledgerType === 'inventory' ? stockId : null,
      ledgerType,
      qty,
      Number(movement.unit_cost ?? 0),
      input.labOrderItemId,
      input.userId,
      remarks,
      input.tenantId,
      movement.id,
    ));

    reversed += 1;
    totalQuantity += qty;
    totalCost += qty * Number(movement.unit_cost ?? 0);
  }

  if (reversed === 0) return { reversed: 0, quantity: 0, cost: 0 };

  if (hasCanonicalConsumption) {
    statements.push(db.prepare(`
      UPDATE InventoryConsumption
      SET OperationStatus = 'reversed'
      WHERE tenant_id = ?
        AND IssueType = 'lab_consumption'
        AND BillingReferenceId = ?
        AND COALESCE(OperationStatus, 'completed') != 'reversed'
    `).bind(input.tenantId, input.labOrderItemId));
  }
  if (hasClaims) {
    statements.push(db.prepare(`
      DELETE FROM lab_consumable_consumption_claims
      WHERE tenant_id = ? AND reference_type = 'lab_order_item' AND reference_id = ?
    `).bind(input.tenantId, input.labOrderItemId));
  }
  if (hasProgress) {
    statements.push(db.prepare(`
      DELETE FROM lab_consumable_mapping_progress
      WHERE tenant_id = ? AND lab_order_item_id = ?
    `).bind(String(input.tenantId), input.labOrderItemId));
  }
  statements.push(
    db.prepare('DELETE FROM lab_reagent_reversal_guard WHERE tenant_id = ? AND operation_key = ?')
      .bind(String(input.tenantId), operationKey),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    throw new HTTPException(409, {
      message: `Reagent reversal could not be completed atomically: ${error instanceof Error ? error.message : 'stock changed'}`,
    });
  }

  return { reversed, quantity: totalQuantity, cost: totalCost };
}

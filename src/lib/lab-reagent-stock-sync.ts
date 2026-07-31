export type CanonicalReagentQcStatus = 'pending' | 'not_required';

export function isCanonicalReagentCategory(category: string): boolean {
  return ['reagent', 'chemical', 'kit'].includes(String(category ?? '').trim().toLowerCase());
}

export interface CanonicalReagentStockInput {
  tenantId: string | number;
  userId: string | number;
  consumableId: number;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  purchasePrice: number;
  receivedDate: string;
  remarks?: string | null;
  locationId?: number | null;
  idempotencyKey?: string | null;
}

export interface CanonicalReagentStockResult {
  labStockId: number;
  inventoryStockId: number;
  inventoryItemId: number;
  inventoryStoreId: number;
  qcStatus: CanonicalReagentQcStatus;
  deduplicated: boolean;
}

export interface LegacyReagentBackfillSummary {
  scanned: number;
  created: number;
  alreadyLinked: number;
  skipped: number;
  failed: number;
  errors: Array<{ labStockId: number; message: string }>;
}

type ConsumableRow = {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  unit_price?: number | null;
  reorder_level?: number | null;
  storage_condition?: string | null;
  description?: string | null;
  inventory_item_id?: number | null;
};

type LabLocationRow = {
  id: number;
  location_code: string;
  location_name: string;
  location_type: string;
  description?: string | null;
};

type ExistingCanonicalStockRow = {
  lab_stock_id: number | null;
  inventory_stock_id: number;
  inventory_item_id: number;
  inventory_store_id: number;
  reference_consumable_id: number | null;
  in_quantity: number;
  batch_no: string | null;
  expiry_date: string | null;
  cost_price: number;
  qc_status: string;
};

type LegacyStockRow = ConsumableRow & {
  lab_stock_id: number;
  lot_number?: string | null;
  expiry_date?: string | null;
  quantity_available: number;
  purchase_price?: number | null;
  received_date?: string | null;
  remarks?: string | null;
  qc_status?: string | null;
  location_id?: number | null;
  inventory_stock_id?: number | null;
};

function metaChanges(result: D1Result<unknown> | undefined): number {
  return Number((result?.meta as { changes?: number } | undefined)?.changes ?? 0);
}

function metaLastRowId(result: D1Result<unknown> | undefined): number {
  return Number((result?.meta as { last_row_id?: number } | undefined)?.last_row_id ?? 0);
}

function cleanRequiredText(value: string, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertIsoDate(value: string, label: string): string {
  const normalized = cleanRequiredText(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${label} must use YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  return normalized;
}

function canonicalQcStatus(category: string): CanonicalReagentQcStatus {
  return isCanonicalReagentCategory(category) ? 'pending' : 'not_required';
}

function requiresTrackedLot(category: string): boolean {
  return isCanonicalReagentCategory(category);
}

function itemCategoryCode(category: string): string {
  return `LAB-${String(category || 'reagent').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
}

async function loadConsumable(db: D1Database, tenantId: string | number, consumableId: number): Promise<ConsumableRow> {
  const row = await db.prepare(`
    SELECT id, code, name, category, unit, unit_price, reorder_level,
           storage_condition, description, inventory_item_id
    FROM lab_consumables
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(consumableId, tenantId).first<ConsumableRow>();
  if (!row) throw new Error('Consumable not found');
  return row;
}

async function resolveInventoryCategory(db: D1Database, tenantId: string | number, userId: string | number, category: string): Promise<number> {
  const categoryCode = itemCategoryCode(category);
  let row = await db.prepare(`
    SELECT ItemCategoryId
    FROM InventoryItemCategory
    WHERE tenant_id = ? AND UPPER(COALESCE(CategoryCode, '')) = UPPER(?) AND COALESCE(IsActive, 1) = 1
    ORDER BY ItemCategoryId
    LIMIT 1
  `).bind(tenantId, categoryCode).first<{ ItemCategoryId: number }>();
  if (row?.ItemCategoryId) return Number(row.ItemCategoryId);

  const result = await db.prepare(`
    INSERT INTO InventoryItemCategory
      (tenant_id, CategoryName, CategoryCode, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
  `).bind(
    tenantId,
    `Lab ${String(category || 'reagent').replace(/_/g, ' ')}`,
    categoryCode,
    'Canonical laboratory reagent and consumable category',
    userId,
  ).run();
  const id = metaLastRowId(result);
  if (!id) throw new Error('Failed to create inventory category for reagent');
  return id;
}

async function resolveInventoryUom(db: D1Database, tenantId: string | number, userId: string | number, unit: string): Promise<number> {
  const uomName = String(unit || 'pcs').trim() || 'pcs';
  let row = await db.prepare(`
    SELECT UOMId
    FROM InventoryUnitOfMeasurement
    WHERE tenant_id = ? AND lower(UOMName) = lower(?) AND COALESCE(IsActive, 1) = 1
    ORDER BY UOMId
    LIMIT 1
  `).bind(tenantId, uomName).first<{ UOMId: number }>();
  if (row?.UOMId) return Number(row.UOMId);

  const result = await db.prepare(`
    INSERT INTO InventoryUnitOfMeasurement
      (tenant_id, UOMName, Description, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
  `).bind(tenantId, uomName, `Laboratory stock unit: ${uomName}`, userId).run();
  const id = metaLastRowId(result);
  if (!id) throw new Error('Failed to create inventory unit for reagent');
  return id;
}

async function resolveInventoryItem(
  db: D1Database,
  tenantId: string | number,
  userId: string | number,
  consumable: ConsumableRow,
): Promise<number> {
  const linkedId = Number(consumable.inventory_item_id ?? 0);
  if (linkedId > 0) {
    const linked = await db.prepare(`
      SELECT ItemId
      FROM InventoryItem
      WHERE ItemId = ? AND tenant_id = ? AND COALESCE(IsActive, 1) = 1
      LIMIT 1
    `).bind(linkedId, tenantId).first<{ ItemId: number }>();
    if (linked?.ItemId) return Number(linked.ItemId);
  }

  const itemCode = cleanRequiredText(consumable.code, 'Consumable code');
  const existing = await db.prepare(`
    SELECT ItemId
    FROM InventoryItem
    WHERE tenant_id = ?
      AND UPPER(COALESCE(ItemCode, '')) = UPPER(?)
      AND COALESCE(ItemType, 'general') = 'lab_reagent'
      AND COALESCE(IsActive, 1) = 1
    ORDER BY ItemId
    LIMIT 1
  `).bind(tenantId, itemCode).first<{ ItemId: number }>();

  let inventoryItemId = Number(existing?.ItemId ?? 0);
  if (!inventoryItemId) {
    const categoryId = await resolveInventoryCategory(db, tenantId, userId, consumable.category);
    const uomId = await resolveInventoryUom(db, tenantId, userId, consumable.unit);
    const rate = Number(consumable.unit_price ?? 0);
    const result = await db.prepare(`
      INSERT INTO InventoryItem
        (tenant_id, ItemName, ItemCode, ItemCategoryId, UOMId,
         StandardRate, ReOrderLevel, Description, IsActive, CreatedBy, CreatedOn,
         ItemType, PurchasePrice, StorageCondition, IsBatchRequired, IsExpiryRequired)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP,
              'lab_reagent', ?, ?, 1, 1)
    `).bind(
      tenantId,
      consumable.name,
      itemCode,
      categoryId,
      uomId,
      rate,
      Number(consumable.reorder_level ?? 0),
      consumable.description ?? `Canonical inventory item for lab consumable ${consumable.id}`,
      userId,
      rate,
      consumable.storage_condition ?? null,
    ).run();
    inventoryItemId = metaLastRowId(result);
    if (!inventoryItemId) throw new Error('Failed to create canonical inventory item for reagent');
  }

  await db.prepare(`
    UPDATE lab_consumables
    SET inventory_item_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
  `).bind(inventoryItemId, consumable.id, tenantId).run();

  return inventoryItemId;
}

function inventoryStoreType(locationType?: string | null): 'departmental' | 'substore' {
  return String(locationType ?? '').toLowerCase() === 'store' ? 'departmental' : 'substore';
}

async function resolveInventoryStore(
  db: D1Database,
  tenantId: string | number,
  userId: string | number,
  locationId?: number | null,
): Promise<number> {
  let storeCode = 'LAB';
  let storeName = 'Lab Store';
  let storeType: 'departmental' | 'substore' = 'departmental';
  let address = 'Canonical laboratory reagent store';

  if (Number(locationId ?? 0) > 0) {
    const location = await db.prepare(`
      SELECT id, location_code, location_name, location_type, description
      FROM lab_consumable_locations
      WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(locationId, tenantId).first<LabLocationRow>();
    if (!location) throw new Error('Lab stock location not found');
    storeCode = cleanRequiredText(location.location_code, 'Lab location code');
    storeName = cleanRequiredText(location.location_name, 'Lab location name');
    storeType = inventoryStoreType(location.location_type);
    address = location.description ?? `Canonical inventory store for lab location ${storeName}`;
  }

  const existing = await db.prepare(`
    SELECT StoreId
    FROM InventoryStore
    WHERE tenant_id = ?
      AND UPPER(COALESCE(StoreCode, '')) = UPPER(?)
      AND COALESCE(IsActive, 1) = 1
    ORDER BY StoreId
    LIMIT 1
  `).bind(tenantId, storeCode).first<{ StoreId: number }>();
  if (existing?.StoreId) return Number(existing.StoreId);

  const result = await db.prepare(`
    INSERT INTO InventoryStore
      (tenant_id, StoreName, StoreCode, StoreType, Address, IsActive, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
  `).bind(tenantId, storeName, storeCode, storeType, address, userId).run();
  const id = metaLastRowId(result);
  if (!id) throw new Error('Failed to create canonical inventory store for reagent');
  return id;
}

async function loadExistingCanonicalStock(
  db: D1Database,
  tenantId: string | number,
  referenceNo: string,
): Promise<ExistingCanonicalStockRow | null> {
  return db.prepare(`
    SELECT ls.id AS lab_stock_id,
           tx.StockId AS inventory_stock_id,
           tx.ItemId AS inventory_item_id,
           tx.StoreId AS inventory_store_id,
           tx.ReferenceId AS reference_consumable_id,
           tx.InQuantity AS in_quantity,
           inv.BatchNo AS batch_no,
           inv.ExpiryDate AS expiry_date,
           inv.CostPrice AS cost_price,
           COALESCE(inv.QCStatus, 'accepted') AS qc_status
    FROM InventoryStockTransaction tx
    JOIN InventoryStock inv
      ON inv.StockId = tx.StockId AND inv.tenant_id = tx.tenant_id
    LEFT JOIN lab_consumable_stock ls
      ON ls.inventory_stock_id = tx.StockId AND ls.tenant_id = tx.tenant_id
    WHERE tx.tenant_id = ?
      AND tx.TransactionType = 'lab-stock-in'
      AND tx.ReferenceNo = ?
    ORDER BY tx.TransactionId
    LIMIT 1
  `).bind(tenantId, referenceNo).first<ExistingCanonicalStockRow>();
}

function assertIdempotentRequestMatches(
  existing: ExistingCanonicalStockRow,
  input: CanonicalReagentStockInput,
): void {
  const mismatched =
    Number(existing.reference_consumable_id ?? 0) !== input.consumableId
    || String(existing.batch_no ?? '').trim() !== String(input.lotNumber ?? '').trim()
    || String(existing.expiry_date ?? '').trim() !== String(input.expiryDate ?? '').trim()
    || Number(existing.in_quantity ?? 0) !== input.quantity
    || Number(existing.cost_price ?? 0) !== Number(input.purchasePrice ?? 0);

  if (mismatched) {
    throw new Error('Idempotency key is already used for a different reagent stock-in request');
  }
}

export async function createCanonicalReagentStock(
  db: D1Database,
  input: CanonicalReagentStockInput,
): Promise<CanonicalReagentStockResult> {
  const consumable = await loadConsumable(db, input.tenantId, input.consumableId);
  if (!isCanonicalReagentCategory(consumable.category)) {
    throw new Error('Canonical inventory sync is only supported for reagents, chemicals and kits');
  }
  const lotNumber = String(input.lotNumber ?? '').trim();
  const rawExpiryDate = String(input.expiryDate ?? '').trim();
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('Quantity must be a positive integer');
  if (requiresTrackedLot(consumable.category) && (!lotNumber || !rawExpiryDate)) {
    throw new Error('Lot number and expiry date are required for reagents, chemicals and kits');
  }
  const expiryDate = assertIsoDate(rawExpiryDate, 'Expiry date');

  const normalizedIdempotencyKey = String(input.idempotencyKey ?? '').trim();
  const referenceNo = normalizedIdempotencyKey ? `LAB-STOCK-IN:${normalizedIdempotencyKey}` : null;
  if (referenceNo) {
    const existing = await loadExistingCanonicalStock(db, input.tenantId, referenceNo);
    if (existing?.inventory_stock_id) {
      assertIdempotentRequestMatches(existing, input);
      if (!existing.lab_stock_id) {
        throw new Error('Idempotent reagent stock-in exists without its lab compatibility record');
      }
      return {
        labStockId: Number(existing.lab_stock_id),
        inventoryStockId: Number(existing.inventory_stock_id),
        inventoryItemId: Number(existing.inventory_item_id),
        inventoryStoreId: Number(existing.inventory_store_id),
        qcStatus: canonicalQcStatus(consumable.category),
        deduplicated: true,
      };
    }
  }

  const inventoryItemId = await resolveInventoryItem(db, input.tenantId, input.userId, consumable);
  const inventoryStoreId = await resolveInventoryStore(db, input.tenantId, input.userId, input.locationId);
  const qcStatus = canonicalQcStatus(consumable.category);
  const now = new Date().toISOString();
  const remarks = input.remarks?.trim() || 'Reagent stock received from Lab Reagent Control';
  const receivedDate = assertIsoDate(input.receivedDate, 'Received date');
  const purchasePrice = Number.isFinite(input.purchasePrice) ? Number(input.purchasePrice) : 0;

  let results: D1Result<unknown>[];
  try {
    results = await db.batch([
      db.prepare(`
      INSERT INTO InventoryStock
        (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity,
         CostPrice, MRP, IsActive, CreatedBy, CreatedOn, QCStatus, StockStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'available')
    `).bind(
      input.tenantId,
      inventoryItemId,
      inventoryStoreId,
      lotNumber,
      expiryDate,
      input.quantity,
      purchasePrice,
      purchasePrice,
      input.userId,
      now,
      qcStatus,
    ),
    db.prepare(`
      INSERT INTO InventoryStockTransaction
        (tenant_id, ItemId, StockId, StoreId, TransactionType, ReferenceNo, ReferenceId,
         InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, last_insert_rowid(), ?, 'lab-stock-in', ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      inventoryItemId,
      inventoryStoreId,
      referenceNo,
      input.consumableId,
      input.quantity,
      input.quantity,
      receivedDate,
      remarks,
      input.userId,
      now,
    ),
    db.prepare(`
      INSERT INTO lab_consumable_stock
        (consumable_id, lot_number, expiry_date, quantity_received, purchase_price,
         received_date, remarks, qc_status, location_id, tenant_id, created_by, inventory_stock_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT StockId FROM InventoryStockTransaction WHERE TransactionId = last_insert_rowid()))
    `).bind(
      input.consumableId,
      lotNumber,
      expiryDate,
      input.quantity,
      purchasePrice,
      receivedDate,
      input.remarks ?? null,
      qcStatus,
      input.locationId ?? null,
      input.tenantId,
      input.userId,
    ),
    db.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, ledger_type, lab_stock_id, inventory_stock_id,
         movement_type, quantity, unit_cost, reference_type, reference_id,
         performed_by, remarks, tenant_id)
      SELECT ?, s.inventory_stock_id, 'inventory', s.id, s.inventory_stock_id,
             'purchase_in', ?, ?, 'inventory_stock_in', s.inventory_stock_id,
             ?, ?, ?
      FROM lab_consumable_stock s
      WHERE s.id = last_insert_rowid() AND s.tenant_id = ?
    `).bind(
      input.consumableId,
      input.quantity,
      purchasePrice,
      input.userId,
      remarks,
      input.tenantId,
      input.tenantId,
      ),
    ]);
  } catch (error) {
    if (referenceNo) {
      const winner = await loadExistingCanonicalStock(db, input.tenantId, referenceNo);
      if (winner?.inventory_stock_id) {
        assertIdempotentRequestMatches(winner, input);
        if (!winner.lab_stock_id) {
          throw new Error('Idempotent reagent stock-in exists without its lab compatibility record');
        }
        return {
          labStockId: Number(winner.lab_stock_id),
          inventoryStockId: Number(winner.inventory_stock_id),
          inventoryItemId: Number(winner.inventory_item_id),
          inventoryStoreId: Number(winner.inventory_store_id),
          qcStatus,
          deduplicated: true,
        };
      }
    }
    throw error;
  }

  if (results.length !== 4 || results.some((result) => metaChanges(result) !== 1)) {
    throw new Error('Canonical reagent stock write did not complete atomically');
  }

  const inventoryStockId = metaLastRowId(results[0]);
  const labStockId = metaLastRowId(results[2]);
  if (!inventoryStockId || !labStockId) throw new Error('Canonical reagent stock IDs were not returned');

  return {
    labStockId,
    inventoryStockId,
    inventoryItemId,
    inventoryStoreId,
    qcStatus,
    deduplicated: false,
  };
}

async function linkExistingBackfillTransaction(
  db: D1Database,
  tenantId: string | number,
  labStockId: number,
  referenceNo: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT StockId
    FROM InventoryStockTransaction
    WHERE tenant_id = ? AND TransactionType = 'lab-legacy-backfill' AND ReferenceNo = ?
    ORDER BY TransactionId
    LIMIT 1
  `).bind(tenantId, referenceNo).first<{ StockId: number }>();
  const stockId = Number(row?.StockId ?? 0);
  if (!stockId) return false;

  await db.batch([
    db.prepare(`
      UPDATE lab_consumable_stock
      SET inventory_stock_id = ?
      WHERE id = ? AND tenant_id = ? AND inventory_stock_id IS NULL
    `).bind(stockId, labStockId, tenantId),
    db.prepare(`
      UPDATE lab_consumable_movements
      SET stock_id = ?, ledger_type = 'inventory', lab_stock_id = ?, inventory_stock_id = ?
      WHERE tenant_id = ?
        AND COALESCE(ledger_type, 'lab') = 'lab'
        AND (lab_stock_id = ? OR (lab_stock_id IS NULL AND stock_id = ?))
    `).bind(stockId, labStockId, stockId, tenantId, labStockId, labStockId),
  ]);
  return true;
}

export async function backfillLegacyReagentStock(
  db: D1Database,
  input: { tenantId: string | number; userId: string | number },
): Promise<LegacyReagentBackfillSummary> {
  const rows = await db.prepare(`
    SELECT s.id AS lab_stock_id, s.lot_number, s.expiry_date, s.quantity_available,
           s.purchase_price, s.received_date, s.remarks, s.qc_status, s.location_id,
           s.inventory_stock_id,
           c.id, c.code, c.name, c.category, c.unit, c.unit_price, c.reorder_level,
           c.storage_condition, c.description, c.inventory_item_id
    FROM lab_consumable_stock s
    JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
      AND COALESCE(c.is_active, 1) = 1
      AND c.category IN ('reagent', 'chemical', 'kit')
      AND s.quantity_available > 0
    ORDER BY s.id
  `).bind(input.tenantId).all<LegacyStockRow>();

  const summary: LegacyReagentBackfillSummary = {
    scanned: rows.results.length,
    created: 0,
    alreadyLinked: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const row of rows.results) {
    const labStockId = Number(row.lab_stock_id);
    if (Number(row.inventory_stock_id ?? 0) > 0) {
      summary.alreadyLinked += 1;
      continue;
    }
    if (requiresTrackedLot(row.category) && (!String(row.lot_number ?? '').trim() || !String(row.expiry_date ?? '').trim())) {
      summary.skipped += 1;
      continue;
    }

    try {
      const referenceNo = `LAB-LEGACY-STOCK:${labStockId}`;
      if (await linkExistingBackfillTransaction(db, input.tenantId, labStockId, referenceNo)) {
        summary.alreadyLinked += 1;
        continue;
      }

      const inventoryItemId = await resolveInventoryItem(db, input.tenantId, input.userId, row);
      const inventoryStoreId = await resolveInventoryStore(db, input.tenantId, input.userId, row.location_id);
      const quantity = Number(row.quantity_available);
      const purchasePrice = Number(row.purchase_price ?? row.unit_price ?? 0);
      const receivedDate = String(row.received_date ?? new Date().toISOString().slice(0, 10));
      const qcStatus = String(row.qc_status ?? canonicalQcStatus(row.category));
      const stockStatus = ['failed', 'blocked'].includes(qcStatus) ? 'blocked' : 'available';
      const now = new Date().toISOString();
      const remarks = row.remarks?.trim() || `Legacy lab stock ${labStockId} backfilled to canonical inventory`;

      const results = await db.batch([
        db.prepare(`
          INSERT INTO InventoryStock
            (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity,
             CostPrice, MRP, IsActive, CreatedBy, CreatedOn, QCStatus, StockStatus)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).bind(
          input.tenantId,
          inventoryItemId,
          inventoryStoreId,
          row.lot_number ?? null,
          row.expiry_date ?? null,
          quantity,
          purchasePrice,
          purchasePrice,
          input.userId,
          now,
          qcStatus,
          stockStatus,
        ),
        db.prepare(`
          INSERT INTO InventoryStockTransaction
            (tenant_id, ItemId, StockId, StoreId, TransactionType, ReferenceNo, ReferenceId,
             InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
          VALUES (?, ?, last_insert_rowid(), ?, 'lab-legacy-backfill', ?, ?, ?, 0, ?, ?, ?, ?, ?)
        `).bind(
          input.tenantId,
          inventoryItemId,
          inventoryStoreId,
          referenceNo,
          labStockId,
          quantity,
          quantity,
          receivedDate,
          remarks,
          input.userId,
          now,
        ),
        db.prepare(`
          UPDATE lab_consumable_stock
          SET inventory_stock_id = (
            SELECT StockId FROM InventoryStockTransaction WHERE TransactionId = last_insert_rowid()
          )
          WHERE id = ? AND tenant_id = ? AND inventory_stock_id IS NULL
        `).bind(labStockId, input.tenantId),
        db.prepare(`
          UPDATE lab_consumable_movements
          SET stock_id = (SELECT inventory_stock_id FROM lab_consumable_stock WHERE id = ? AND tenant_id = ?),
              ledger_type = 'inventory',
              lab_stock_id = ?,
              inventory_stock_id = (SELECT inventory_stock_id FROM lab_consumable_stock WHERE id = ? AND tenant_id = ?)
          WHERE tenant_id = ?
            AND COALESCE(ledger_type, 'lab') = 'lab'
            AND (lab_stock_id = ? OR (lab_stock_id IS NULL AND stock_id = ?))
        `).bind(
          labStockId,
          input.tenantId,
          labStockId,
          labStockId,
          input.tenantId,
          input.tenantId,
          labStockId,
          labStockId,
        ),
      ]);

      if (results.length !== 4 || metaChanges(results[0]) !== 1 || metaChanges(results[1]) !== 1 || metaChanges(results[2]) !== 1) {
        throw new Error('Legacy reagent stock backfill did not complete atomically');
      }
      summary.created += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        labStockId,
        message: error instanceof Error ? error.message : 'Unknown backfill error',
      });
    }
  }

  return summary;
}

export interface MirrorInventoryLabReagentReceiptInput {
  tenantId: string | number;
  userId: string | number;
  itemId: number;
  inventoryStockId: number;
  goodsReceiptItemId?: number | null;
  sourceReferenceType?: 'inventory_gr_item' | 'inventory_opening_stock';
  batchNo?: string | null;
  expiryDate?: string | null;
  quantity: number;
  purchasePrice: number;
  receivedDate: string;
  remarks?: string | null;
}

interface InventoryItemRow {
  ItemId: number;
  ItemName: string;
  ItemCode?: string | null;
  ItemType?: string | null;
  PurchasePrice?: number | null;
  ReOrderLevel?: number | null;
  StorageCondition?: string | null;
  IsExpiryRequired?: number | null;
}

export interface MirrorInventoryLabReagentReceiptResult {
  mirrored: boolean;
  consumableId: number | null;
  stockId: number | null;
  skippedReason: 'not_lab_reagent' | 'already_mirrored' | 'inventory_item_not_found' | null;
}

function defaultConsumableCode(item: InventoryItemRow): string {
  return item.ItemCode?.trim() || `INV-LAB-${item.ItemId}`;
}

function qcStatusForLabReagent(): 'pending' {
  return 'pending';
}

async function findOrCreateLabConsumable(
  db: D1Database,
  item: InventoryItemRow,
  input: MirrorInventoryLabReagentReceiptInput,
): Promise<number> {
  const existing = await db.prepare(`
    SELECT id FROM lab_consumables
    WHERE inventory_item_id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(input.itemId, input.tenantId).first<{ id: number }>();

  if (existing?.id) return existing.id;

  const result = await db.prepare(`
    INSERT INTO lab_consumables
      (code, name, category, unit, unit_price, reorder_level, storage_condition, description, tenant_id, created_by, inventory_item_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    defaultConsumableCode(item),
    item.ItemName,
    'reagent',
    'pcs',
    Number(item.PurchasePrice ?? input.purchasePrice ?? 0),
    Number(item.ReOrderLevel ?? 0),
    item.StorageCondition ?? null,
    `Inventory lab reagent source item ${item.ItemId}`,
    input.tenantId,
    input.userId,
    input.itemId,
  ).run();

  return Number(result.meta.last_row_id);
}

export async function mirrorInventoryLabReagentReceipt(
  db: D1Database,
  input: MirrorInventoryLabReagentReceiptInput,
): Promise<MirrorInventoryLabReagentReceiptResult> {
  const item = await db.prepare(`
    SELECT ItemId, ItemName, ItemCode, ItemType, PurchasePrice, ReOrderLevel, StorageCondition, IsExpiryRequired
    FROM InventoryItem
    WHERE ItemId = ? AND tenant_id = ?
    LIMIT 1
  `).bind(input.itemId, input.tenantId).first<InventoryItemRow>();

  if (!item) {
    return { mirrored: false, consumableId: null, stockId: null, skippedReason: 'inventory_item_not_found' };
  }

  if (item.ItemType !== 'lab_reagent') {
    return { mirrored: false, consumableId: null, stockId: null, skippedReason: 'not_lab_reagent' };
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('quantity must be positive');
  }

  const consumableId = await findOrCreateLabConsumable(db, item, input);

  const existingStock = await db.prepare(`
    SELECT id FROM lab_consumable_stock
    WHERE inventory_stock_id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(input.inventoryStockId, input.tenantId).first<{ id: number }>();

  if (existingStock?.id) {
    return { mirrored: false, consumableId, stockId: existingStock.id, skippedReason: 'already_mirrored' };
  }

  const stockResult = await db.prepare(`
    INSERT INTO lab_consumable_stock
      (consumable_id, lot_number, expiry_date, quantity_received, purchase_price, received_date, remarks, qc_status, tenant_id, created_by, inventory_stock_id, goods_receipt_item_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    consumableId,
    input.batchNo ?? null,
    input.expiryDate ?? null,
    input.quantity,
    input.purchasePrice,
    input.receivedDate,
    input.remarks ?? null,
    qcStatusForLabReagent(),
    input.tenantId,
    input.userId,
    input.inventoryStockId,
    input.goodsReceiptItemId ?? null,
  ).run();

  const labStockId = Number(stockResult.meta.last_row_id);

  await db.prepare(`
    INSERT INTO lab_consumable_movements
      (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id, performed_by, remarks, tenant_id)
    VALUES (?, ?, 'purchase_in', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    consumableId,
    labStockId,
    input.quantity,
    input.purchasePrice,
    input.sourceReferenceType ?? 'inventory_gr_item',
    input.goodsReceiptItemId ?? input.inventoryStockId,
    input.userId,
    input.remarks ?? 'Inventory stock mirrored to lab stock',
    input.tenantId,
  ).run();

  return { mirrored: true, consumableId, stockId: labStockId, skippedReason: null };
}

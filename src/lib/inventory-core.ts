import { getInventoryLotBlockReason, getInventoryUsableQuantity } from './inventory-lot-policy';

export const INVENTORY_MOVEMENT_TYPES = [
  'opening_stock',
  'purchase_receive',
  'department_issue',
  'patient_issue',
  'pharmacy_sale',
  'lab_consumption',
  'ot_consumption',
  'transfer_out',
  'transfer_in',
  'return_in',
  'return_out',
  'adjustment_plus',
  'adjustment_minus',
  'expired_writeoff',
  'damage_writeoff',
  'supplier_return',
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export type FefoStockRow = {
  stockId?: number;
  StockId?: number;
  itemId?: number;
  ItemId?: number;
  storeId?: number;
  StoreId?: number;
  availableQuantity?: number;
  AvailableQuantity?: number;
  reservedQuantity?: number | null;
  ReservedQuantity?: number | null;
  damagedQuantity?: number | null;
  DamagedQuantity?: number | null;
  blockedQuantity?: number | null;
  BlockedQuantity?: number | null;
  expiryDate?: string | null;
  ExpiryDate?: string | null;
  status?: string | null;
  Status?: string | null;
  StockStatus?: string | null;
  qcStatus?: string | null;
  QCStatus?: string | null;
  IsActive?: number | boolean | null;
  isActive?: number | boolean | null;
};

export type FefoAllocation = {
  stockId: number;
  quantity: number;
  balanceAfterIssue: number;
};

export type InventoryStockStatus =
  | 'available'
  | 'low_stock'
  | 'out_of_stock'
  | 'expiring_soon'
  | 'expired'
  | 'blocked'
  | 'damaged';

const MOVEMENT_ALIASES: Record<string, InventoryMovementType> = {
  purchase: 'purchase_receive',
  'goods-receipt': 'purchase_receive',
  goods_receipt: 'purchase_receive',
  grn: 'purchase_receive',
  issue: 'department_issue',
  requisition: 'department_issue',
  'dispatch-out': 'transfer_out',
  dispatch_out: 'transfer_out',
  'dispatch-in': 'transfer_in',
  dispatch_in: 'transfer_in',
  transfer: 'transfer_out',
  writeoff: 'damage_writeoff',
  'write-off': 'damage_writeoff',
  'adjustment-in': 'adjustment_plus',
  adjustment_in: 'adjustment_plus',
  'adjustment-out': 'adjustment_minus',
  adjustment_out: 'adjustment_minus',
  return: 'return_in',
};

const BLOCKING_STOCK_STATUSES = new Set([
  'blocked',
  'damaged',
  'expired',
  'disposed',
  'lost',
  'inactive',
  'under_maintenance',
  'under-maintenance',
]);

const BLOCKING_QC_STATUSES = new Set([
  'pending',
  'failed',
  'rejected',
  'blocked',
]);

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stockIdOf(row: FefoStockRow): number {
  return Number(row.stockId ?? row.StockId ?? 0);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

export function normalizeInventoryMovementType(type: string): InventoryMovementType {
  const normalized = String(type || '').trim().toLowerCase().replace(/\s+/g, '_');
  if ((INVENTORY_MOVEMENT_TYPES as readonly string[]).includes(normalized)) {
    return normalized as InventoryMovementType;
  }
  return MOVEMENT_ALIASES[normalized] ?? MOVEMENT_ALIASES[normalized.replace(/_/g, '-')] ?? 'department_issue';
}

export function buildInventoryQrCodeValue(tagCode: string): string {
  return String(tagCode || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function getUsableStockQuantity(row: FefoStockRow): number {
  return getInventoryUsableQuantity(row);
}

export function getInventoryStockStatus(
  row: FefoStockRow & { ReOrderLevel?: number | null; reOrderLevel?: number | null },
  options: { today?: string; expiringSoonDays?: number } = {},
): InventoryStockStatus {
  const today = dateOnly(options.today) ?? new Date().toISOString().slice(0, 10);
  const expiringSoonDays = options.expiringSoonDays ?? 90;
  const expiry = dateOnly(row.expiryDate ?? row.ExpiryDate);
  const status = String(row.status ?? row.Status ?? row.StockStatus ?? 'available').trim().toLowerCase();
  const damaged = toNumber(row.damagedQuantity ?? row.DamagedQuantity);
  const blocked = toNumber(row.blockedQuantity ?? row.BlockedQuantity);
  const available = toNumber(row.availableQuantity ?? row.AvailableQuantity);
  const reorderLevel = toNumber(row.reOrderLevel ?? row.ReOrderLevel);

  if (BLOCKING_STOCK_STATUSES.has(status) || blocked > 0) return status === 'damaged' ? 'damaged' : 'blocked';
  if (damaged > 0) return 'damaged';
  if (expiry && expiry <= today) return 'expired';
  if (available <= 0) return 'out_of_stock';

  if (expiry) {
    const expiryDate = new Date(`${expiry}T00:00:00.000Z`);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - todayDate.getTime()) / 86400000);
    if (daysUntilExpiry > 0 && daysUntilExpiry <= expiringSoonDays) return 'expiring_soon';
  }

  if (reorderLevel > 0 && available <= reorderLevel) return 'low_stock';
  return 'available';
}

export function getStockIssueBlockReason(
  row: FefoStockRow,
  quantity: number,
  options: { today?: string } = {},
): string | null {
  return getInventoryLotBlockReason(row, quantity, options);
}

export function selectFefoStockAllocations(
  rows: FefoStockRow[],
  requestedQuantity: number,
  options: { today?: string } = {},
): FefoAllocation[] {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error('Requested quantity must be greater than zero');
  }

  const today = dateOnly(options.today) ?? new Date().toISOString().slice(0, 10);
  const usableRows = rows
    .map((row) => ({
      row,
      stockId: stockIdOf(row),
      expiry: dateOnly(row.expiryDate ?? row.ExpiryDate),
      usable: getUsableStockQuantity(row),
    }))
    .filter(({ row, stockId, usable }) => stockId > 0 && usable > 0 && !getStockIssueBlockReason(row, Math.min(1, usable), { today }))
    .sort((a, b) => {
      if (a.expiry && b.expiry && a.expiry !== b.expiry) return a.expiry.localeCompare(b.expiry);
      if (a.expiry && !b.expiry) return -1;
      if (!a.expiry && b.expiry) return 1;
      return a.stockId - b.stockId;
    });

  let remaining = requestedQuantity;
  const allocations: FefoAllocation[] = [];

  for (const candidate of usableRows) {
    if (remaining <= 0) break;
    const quantity = Math.min(candidate.usable, remaining);
    allocations.push({
      stockId: candidate.stockId,
      quantity,
      balanceAfterIssue: candidate.usable - quantity,
    });
    remaining -= quantity;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient non-expired stock. Missing ${remaining}`);
  }

  return allocations;
}

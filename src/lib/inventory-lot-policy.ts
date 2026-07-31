export type InventoryLotLike = {
  AvailableQuantity?: number | null;
  availableQuantity?: number | null;
  ReservedQuantity?: number | null;
  reservedQuantity?: number | null;
  DamagedQuantity?: number | null;
  damagedQuantity?: number | null;
  BlockedQuantity?: number | null;
  blockedQuantity?: number | null;
  IsActive?: number | boolean | null;
  isActive?: number | boolean | null;
  QCStatus?: string | null;
  qcStatus?: string | null;
  StockStatus?: string | null;
  Status?: string | null;
  status?: string | null;
  ExpiryDate?: string | null;
  expiryDate?: string | null;
  AfterOpenExpiryDate?: string | null;
  afterOpenExpiryDate?: string | null;
};

const BLOCKING_STOCK_STATUSES = new Set([
  'blocked',
  'damaged',
  'expired',
  'disposed',
  'lost',
  'inactive',
  'quarantine',
  'quarantined',
  'rejected',
  'hold',
  'on_hold',
  'under_maintenance',
  'under-maintenance',
]);

const BLOCKING_QC_STATUSES = new Set(['pending', 'failed', 'rejected', 'blocked']);

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, 10) : null;
}

function normalizedStatus(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim().toLowerCase();
}

export function getInventoryUsableQuantity(row: InventoryLotLike): number {
  const available = toNumber(row.availableQuantity ?? row.AvailableQuantity);
  const reserved = toNumber(row.reservedQuantity ?? row.ReservedQuantity);
  const damaged = toNumber(row.damagedQuantity ?? row.DamagedQuantity);
  const blocked = toNumber(row.blockedQuantity ?? row.BlockedQuantity);
  return Math.max(0, available - reserved - damaged - blocked);
}

export function getInventoryLotBlockReason(
  row: InventoryLotLike,
  quantity: number,
  options: { today?: string } = {},
): string | null {
  const today = dateOnly(options.today) ?? new Date().toISOString().slice(0, 10);
  const isActive = row.isActive ?? row.IsActive;
  if (isActive === 0 || isActive === false) return 'Stock is inactive';

  const stockStatus = normalizedStatus(row.status ?? row.Status ?? row.StockStatus, 'available');
  if (BLOCKING_STOCK_STATUSES.has(stockStatus)) return `Stock is ${stockStatus.replace(/_/g, ' ')}`;

  const qcStatus = normalizedStatus(row.qcStatus ?? row.QCStatus);
  if (BLOCKING_QC_STATUSES.has(qcStatus)) {
    return qcStatus === 'failed' ? 'Stock lot QC failed' : `Stock lot QC is ${qcStatus.replace(/_/g, ' ')}`;
  }

  const expiry = dateOnly(row.expiryDate ?? row.ExpiryDate);
  if (expiry && expiry <= today) return 'Stock batch is expired';

  const afterOpenExpiry = dateOnly(row.afterOpenExpiryDate ?? row.AfterOpenExpiryDate);
  if (afterOpenExpiry && afterOpenExpiry <= today) return 'Stock lot after-open expiry is breached';

  const usable = getInventoryUsableQuantity(row);
  if (usable < quantity) return `Insufficient usable stock. Available ${usable}, requested ${quantity}`;
  return null;
}

export function isInventoryLotUsable(
  row: InventoryLotLike,
  options: { today?: string } = {},
): boolean {
  const usable = getInventoryUsableQuantity(row);
  return usable > 0 && getInventoryLotBlockReason(row, Math.min(1, usable), options) === null;
}

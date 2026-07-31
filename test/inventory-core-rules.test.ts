import { describe, expect, it } from 'vitest';
import {
  buildInventoryQrCodeValue,
  getInventoryStockStatus,
  normalizeInventoryMovementType,
  selectFefoStockAllocations,
} from '../src/lib/inventory-core';

describe('inventory core rules', () => {
  it('selects non-expired FEFO batches and skips blocked or damaged stock', () => {
    const allocations = selectFefoStockAllocations([
      {
        stockId: 1,
        itemId: 10,
        storeId: 1,
        availableQuantity: 20,
        expiryDate: '2026-12-31',
        damagedQuantity: 0,
        blockedQuantity: 0,
        status: 'available',
      },
      {
        stockId: 2,
        itemId: 10,
        storeId: 1,
        availableQuantity: 10,
        expiryDate: '2026-06-30',
        damagedQuantity: 0,
        blockedQuantity: 0,
        status: 'available',
      },
      {
        stockId: 3,
        itemId: 10,
        storeId: 1,
        availableQuantity: 99,
        expiryDate: '2025-01-01',
        damagedQuantity: 0,
        blockedQuantity: 0,
        status: 'available',
      },
      {
        stockId: 4,
        itemId: 10,
        storeId: 1,
        availableQuantity: 99,
        expiryDate: '2026-01-01',
        damagedQuantity: 99,
        blockedQuantity: 0,
        status: 'available',
      },
    ], 25, { today: '2026-05-17' });

    expect(allocations).toEqual([
      { stockId: 2, quantity: 10, balanceAfterIssue: 0 },
      { stockId: 1, quantity: 15, balanceAfterIssue: 5 },
    ]);
  });

  it('throws when FEFO allocation cannot cover requested quantity without expired stock', () => {
    expect(() => selectFefoStockAllocations([
      {
        stockId: 5,
        itemId: 10,
        storeId: 1,
        availableQuantity: 10,
        expiryDate: '2025-01-01',
        status: 'available',
      },
    ], 1, { today: '2026-05-17' })).toThrow(/insufficient/i);
  });

  it('normalizes legacy movement labels to the canonical inventory ledger vocabulary', () => {
    expect(normalizeInventoryMovementType('goods-receipt')).toBe('purchase_receive');
    expect(normalizeInventoryMovementType('dispatch-out')).toBe('transfer_out');
    expect(normalizeInventoryMovementType('dispatch-in')).toBe('transfer_in');
    expect(normalizeInventoryMovementType('adjustment-in')).toBe('adjustment_plus');
    expect(normalizeInventoryMovementType('adjustment-out')).toBe('adjustment_minus');
    expect(normalizeInventoryMovementType('lab_consumption')).toBe('lab_consumption');
  });

  it('prints only the opaque tag code in QR/barcode payloads', () => {
    expect(buildInventoryQrCodeValue(' HMS-ABC-STOCK-123 ')).toBe('HMS-ABC-STOCK-123');
  });

  it('computes stock status badges from expiry, quantity, and blocked quantities', () => {
    expect(getInventoryStockStatus({ AvailableQuantity: 0 }, { today: '2026-05-17' })).toBe('out_of_stock');
    expect(getInventoryStockStatus({ AvailableQuantity: 10, ExpiryDate: '2026-05-01' }, { today: '2026-05-17' })).toBe('expired');
    expect(getInventoryStockStatus({ AvailableQuantity: 10, ExpiryDate: '2026-06-01' }, { today: '2026-05-17' })).toBe('expiring_soon');
    expect(getInventoryStockStatus({ AvailableQuantity: 10, ReOrderLevel: 20 }, { today: '2026-05-17' })).toBe('low_stock');
    expect(getInventoryStockStatus({ AvailableQuantity: 10, DamagedQuantity: 1 }, { today: '2026-05-17' })).toBe('damaged');
    expect(getInventoryStockStatus({ AvailableQuantity: 10, StockStatus: 'blocked' }, { today: '2026-05-17' })).toBe('blocked');
  });
});

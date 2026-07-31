import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

function insertsInventoryStock(sql: string) {
  return /INSERT\s+INTO\s+InventoryStock\s*\(/i.test(sql);
}

describe('Inventory — explicit store transfers', () => {
  it('creates a transfer draft without moving stock before send', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 51,
              ItemId: 77,
              StoreId: 1,
              AvailableQuantity: 20,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              MRP: 80,
              IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers', {
      method: 'POST',
      body: {
        FromStoreId: 1,
        ToStoreId: 2,
        Items: [{ ItemId: 77, StockId: 51, Quantity: 5 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryTransfer'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryTransferItem'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('InTransitQuantity'))).toBe(false);
  });

  it('sends transfer stock into in-transit quantity instead of destination stock', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryTransfer WHERE')) {
          return { first: { TransferId: 1, TransferNo: 'TRF-1', FromStoreId: 1, ToStoreId: 2, Status: 'draft' } };
        }
        if (sql.includes('FROM InventoryTransferItem WHERE')) {
          return {
            results: [{ TransferItemId: 7, TransferId: 1, ItemId: 77, StockId: 51, BatchNo: 'CAN-2026', Quantity: 5, ReceivedQuantity: 0 }],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 51,
              ItemId: 77,
              StoreId: 1,
              AvailableQuantity: 20,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              MRP: 80,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('UPDATE InventoryStock') && sql.includes('InTransitQuantity')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers/1/send', { method: 'POST', body: {} });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some(q => q.sql.includes('InTransitQuantity = COALESCE(InTransitQuantity, 0) + ?'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('transfer_out'))).toBe(true);
    expect(mockDB.queries.some(q => insertsInventoryStock(q.sql))).toBe(false);
  });

  it('rejects transfer send when source stock changed after draft creation', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryTransfer WHERE')) {
          return { first: { TransferId: 2, TransferNo: 'TRF-2', FromStoreId: 1, ToStoreId: 2, Status: 'draft' } };
        }
        if (sql.includes('FROM InventoryTransferItem WHERE')) {
          return { results: [{ TransferItemId: 8, TransferId: 2, ItemId: 77, StockId: 51, BatchNo: 'CAN-2026', Quantity: 5, ReceivedQuantity: 0 }] };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return { first: { StockId: 51, ItemId: 77, StoreId: 1, AvailableQuantity: 20, BatchNo: 'CAN-2026', ExpiryDate: '2027-01-01', CostPrice: 30, MRP: 80, IsActive: 1 } };
        }
        if (sql.includes('UPDATE InventoryStock') && sql.includes('InTransitQuantity')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers/2/send', { method: 'POST', body: {} });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some(q => q.sql.includes("Status = 'in_transit'"))).toBe(false);
  });

  it('receives in-transit stock into the destination store and records transfer-in ledger', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryTransfer WHERE')) {
          return { first: { TransferId: 1, TransferNo: 'TRF-1', FromStoreId: 1, ToStoreId: 2, Status: 'in_transit' } };
        }
        if (sql.includes('FROM InventoryTransferItem WHERE')) {
          return {
            results: [{ TransferItemId: 7, TransferId: 1, ItemId: 77, StockId: 51, BatchNo: 'CAN-2026', Quantity: 5, ReceivedQuantity: 0, CostPrice: 30 }],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 51,
              ItemId: 77,
              StoreId: 1,
              AvailableQuantity: 15,
              InTransitQuantity: 5,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              MRP: 80,
            },
          };
        }
        if (sql.includes('SELECT StockId, AvailableQuantity')) {
          return { first: null };
        }
        if (sql.includes('UPDATE InventoryStock') && sql.includes('InTransitQuantity = COALESCE')) {
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE InventoryTransferItem')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers/1/receive', { method: 'POST', body: {} });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some(q => q.sql.includes('InTransitQuantity = COALESCE(InTransitQuantity, 0) - ?'))).toBe(true);
    expect(mockDB.queries.some(q => insertsInventoryStock(q.sql))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('transfer_in'))).toBe(true);
  });

  it('rejects receive when source in-transit stock is no longer available', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryTransfer WHERE')) {
          return { first: { TransferId: 3, TransferNo: 'TRF-3', FromStoreId: 1, ToStoreId: 2, Status: 'in_transit' } };
        }
        if (sql.includes('FROM InventoryTransferItem WHERE')) {
          return { results: [{ TransferItemId: 9, TransferId: 3, ItemId: 77, StockId: 51, BatchNo: 'CAN-2026', Quantity: 5, ReceivedQuantity: 0, CostPrice: 30 }] };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return { first: { StockId: 51, ItemId: 77, StoreId: 1, AvailableQuantity: 15, InTransitQuantity: 4, BatchNo: 'CAN-2026', ExpiryDate: '2027-01-01', CostPrice: 30, MRP: 80 } };
        }
        if (sql.includes('UPDATE InventoryStock') && sql.includes('InTransitQuantity = COALESCE')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers/3/receive', { method: 'POST', body: {} });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('transfer_in'))).toBe(false);
  });
});

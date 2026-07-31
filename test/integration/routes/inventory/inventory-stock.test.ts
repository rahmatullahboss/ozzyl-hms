/**
 * Enterprise-grade integration tests for Inventory Stock route.
 *
 * Covers: list stock, filters, stock transactions, stock adjustment.
 *
 * NOTE: adjustment route is POST /stock/adjustment (singular), not /adjustments.
 *       The route performs a stock lookup first — needs universalFallback for existing adjustments.
 */

import { describe, it, expect } from 'vitest';
import stockRoute from '../../../../src/routes/tenant/inventory/stock';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_STOCK_1, INV_STOCK_2,
  INV_ITEM_1, INV_ITEM_2, INV_STORE_MAIN,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const stockAdjustInBody = {
  Items: [
    {
      ItemId: INV_ITEM_1.ItemId,
      StoreId: INV_STORE_MAIN.StoreId,
      StockId: INV_STOCK_1.StockId,
      AdjustmentType: 'in' as const,
      Quantity: 20,
      BatchNo: 'BN-ADJ-001',
      Remarks: 'Count adjustment',
    },
  ],
};

const stockNewItemAdjustBody = {
  Items: [
    {
      ItemId: INV_ITEM_2.ItemId,
      StoreId: INV_STORE_MAIN.StoreId,
      AdjustmentType: 'in' as const,
      Quantity: 10,
      BatchNo: 'BN-NEW-001',
    },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Stock Routes', () => {

  describe('GET / — list stock', () => {
    it('returns paginated stock for tenant', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystock: [INV_STOCK_1, INV_STOCK_2] },
      });
      const res = await app.request('/stock');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by ItemId', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventorystock: [INV_STOCK_1] },
      });
      const res = await app.request(`/stock?ItemId=${INV_ITEM_1.ItemId}`);
      expect(res.status).toBe(200);
    });

    it('filters by StoreId', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventorystock: [INV_STOCK_1] },
      });
      const res = await app.request(`/stock?StoreId=${INV_STORE_MAIN.StoreId}`);
      expect(res.status).toBe(200);
    });

    it('filters by ExpiringBefore date', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystock: [INV_STOCK_2] },
      });
      const res = await app.request('/stock?ExpiringBefore=2026-01-01');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorystock: [INV_STOCK_1, INV_STOCK_2] },
      });
      const res = await app.request('/stock');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('GET /transactions — list stock transactions', () => {
    const txn1 = {
      TransactionId: 1,
      tenant_id: TENANT_1.id,
      StockId: INV_STOCK_1.StockId,
      ItemId: INV_ITEM_1.ItemId,
      StoreId: INV_STORE_MAIN.StoreId,
      TransactionType: 'received',
      Quantity: 100,
      InOut: 'in',
      TransactionDate: '2024-01-20',
    };

    it('returns paginated stock transactions', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystocktransaction: [txn1] },
      });
      const res = await app.request('/stock/transactions');
      expect(res.status).toBe(200);
    });

    it('filters transactions by TransactionType', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystocktransaction: [txn1] },
      });
      const res = await app.request('/stock/transactions?TransactionType=received');
      expect(res.status).toBe(200);
    });

    it('returns empty transactions for different tenant', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorystocktransaction: [txn1] },
      });
      const res = await app.request('/stock/transactions');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST /adjustment — stock adjustment', () => {
    it('creates an IN-adjustment for existing stock and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventorystock: [INV_STOCK_1],
          inventorystocktransaction: [],
        },
        universalFallback: true, // route SELECTs stock first to compute newQty
      });
      const res = await jsonRequest(app, '/stock/adjustment', {
        method: 'POST',
        body: stockAdjustInBody,
      });
      expect(res.status).toBe(200);

      // Verify UPDATE to stock (route uses UPDATE InventoryStock)
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toUpperCase().includes('INVENTORYSTOCK'),
      );
      expect(updateQ).toBeTruthy();
      expect(updateQ!.params).toContain(TENANT_1.id);
    });

    it('creates an IN-adjustment creating new stock entry and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventorystock: [], // no existing stock — will create new
          inventoryitem: [INV_ITEM_2], // needed to look up StandardRate
          inventorystocktransaction: [],
        },
      });
      const res = await jsonRequest(app, '/stock/adjustment', {
        method: 'POST',
        body: stockNewItemAdjustBody,
      });
      expect(res.status).toBe(200);
      expect(mockDB.batchCalls.some((batch) =>
        batch.some((sql) => sql.includes('INSERT INTO InventoryStock') && !sql.includes('InventoryStockTransaction'))
        && batch.some((sql) => sql.includes('INSERT INTO InventoryStockTransaction'))
      )).toBe(true);
    });

    it('does not fabricate batch or expiry when creating a reagent stock lot by adjustment', async () => {
      const { app, mockDB } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          if (sql.includes('SELECT * FROM InventoryStock')) return { first: null };
          if (sql.includes('FROM InventoryItem')) {
            return {
              first: {
                StandardRate: 100,
                ItemType: 'lab_reagent',
                IsBatchRequired: 1,
                IsExpiryRequired: 1,
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/stock/adjustment', {
        method: 'POST',
        body: {
          Items: [{
            ItemId: 900,
            StoreId: INV_STORE_MAIN.StoreId,
            AdjustmentType: 'in',
            Quantity: 10,
            BatchNo: 'CBC-LOT-1',
          }],
        },
      });

      expect(res.status).toBe(400);
      expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
    });

    it('returns 400 when Items is empty (Zod min)', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/stock/adjustment', {
        method: 'POST',
        body: { Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid AdjustmentType (Zod enum)', async () => {
      const { app } = createTestApp({
        route: stockRoute,
        routePath: '/stock',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/stock/adjustment', {
        method: 'POST',
        body: {
          Items: [{
            ItemId: 1, StoreId: 1, AdjustmentType: 'transfer', Quantity: 5,
          }],
        },
      });
      expect(res.status).toBe(400);
    });
  });
});

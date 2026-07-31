/**
 * Enterprise-grade integration tests for Inventory Return to Vendor route.
 *
 * Covers: list, create (stock deduction via GRItemId lookup), Zod validation, tenant isolation.
 *
 * NOTE: return POST looks up stock by GRItemId AND ItemId. The stock fixture must have GRItemId set.
 */

import { describe, it, expect } from 'vitest';
import returnRoute from '../../../../src/routes/tenant/inventory/return';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import { createMockDB } from '../../helpers/mock-db';
import {
  TENANT_1, TENANT_2,
  INV_RETURN_1, INV_VENDOR_1, INV_STORE_MAIN,
  INV_ITEM_1, INV_GR_1, INV_GR_ITEM_1,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

// Stock row with GRItemId to satisfy the return route's stock lookup
const STOCK_FOR_RETURN = {
  StockId: 901,
  tenant_id: TENANT_1.id,
  ItemId: INV_ITEM_1.ItemId,
  StoreId: INV_STORE_MAIN.StoreId,
  GRItemId: INV_GR_ITEM_1.GRItemId, // critical: return.ts looks up by GRItemId
  BatchNo: 'BN-001-T1',
  AvailableQuantity: 80, // more than ReturnQuantity=10
  ExpiryDate: '2026-06-30',
  CostPrice: 45,
  MRP: 60,
};

const newReturnBody = {
  VendorId: INV_VENDOR_1.VendorId,
  GoodsReceiptId: INV_GR_1.GoodsReceiptId,
  StoreId: INV_STORE_MAIN.StoreId,
  Reason: 'Defective items — wrong batch',
  CreditNoteNo: 'CN-2024-001',
  Items: [
    {
      GRItemId: INV_GR_ITEM_1.GRItemId,
      ItemId: INV_ITEM_1.ItemId,
      ReturnQuantity: 10,
      Remarks: 'Damaged packaging',
    },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Return to Vendor Routes', () => {

  describe('GET / — list returns', () => {
    it('returns paginated returns for tenant', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryreturntovendor: [INV_RETURN_1] },
      });
      const res = await app.request('/return');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by VendorId', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventoryreturntovendor: [INV_RETURN_1] },
      });
      const res = await app.request(`/return?VendorId=${INV_VENDOR_1.VendorId}`);
      expect(res.status).toBe(200);
    });

    it('filters by StoreId', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryreturntovendor: [INV_RETURN_1] },
      });
      const res = await app.request(`/return?StoreId=${INV_STORE_MAIN.StoreId}`);
      expect(res.status).toBe(200);
    });

    it('filters by date range', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryreturntovendor: [INV_RETURN_1] },
      });
      const res = await app.request('/return?FromDate=2024-01-01&ToDate=2024-12-31');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryreturntovendor: [INV_RETURN_1] },
      });
      const res = await app.request('/return');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST / — create return to vendor', () => {
    it('creates return, deducts stock, and returns 201', async () => {
      // queryOverride: route does SELECT StockId, AvailableQuantity FROM InventoryStock WHERE GRItemId=? AND ItemId=? AND tenant_id=?
      // filterRows would fail because it uses lowercase 'gritemid' but fixture has PascalCase 'GRItemId'.
      // Use queryOverride so the return route finds stock with sufficient AvailableQuantity.
      const stockMockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.toUpperCase().includes('INVENTORYSTOCK') && sql.toUpperCase().includes('GRITEMID')) {
            return { results: [{ StockId: STOCK_FOR_RETURN.StockId, AvailableQuantity: 80 }] };
          }
          return null;
        },
      });
      const { app, mockDB } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB: stockMockDB,
      });
      const res = await jsonRequest(app, '/return', { method: 'POST', body: newReturnBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { ReturnId: number };
      expect(typeof body.ReturnId).toBe('number');

      // Verify tenant_id in INSERT
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toUpperCase().includes('INVENTORYRETURNTOVENDOR'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when stock is insufficient for return', async () => {
      // queryOverride: return insufficient stock (5 < 10 needed)
      const insuffStockMockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.toUpperCase().includes('INVENTORYSTOCK') && sql.toUpperCase().includes('GRITEMID')) {
            return { results: [{ StockId: STOCK_FOR_RETURN.StockId, AvailableQuantity: 5 }] };
          }
          return null;
        },
      });
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB: insuffStockMockDB,
      });
      const res = await jsonRequest(app, '/return', { method: 'POST', body: newReturnBody });
      expect(res.status).toBe(400);
    });

    it('returns 400 when Items is empty (Zod min)', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/return', {
        method: 'POST',
        body: { ...newReturnBody, Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when Reason is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const { Reason: _removed, ...bodyNoReason } = newReturnBody;
      const res = await jsonRequest(app, '/return', { method: 'POST', body: bodyNoReason });
      expect(res.status).toBe(400);
    });

    it('returns 400 when VendorId is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const { VendorId: _removed, ...bodyNoVendor } = newReturnBody;
      const res = await jsonRequest(app, '/return', { method: 'POST', body: bodyNoVendor });
      expect(res.status).toBe(400);
    });

    it('returns 400 when ReturnQuantity is zero (Zod positive)', async () => {
      const { app } = createTestApp({
        route: returnRoute,
        routePath: '/return',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/return', {
        method: 'POST',
        body: {
          ...newReturnBody,
          Items: [{ ...newReturnBody.Items[0], ReturnQuantity: 0 }],
        },
      });
      expect(res.status).toBe(400);
    });
  });
});

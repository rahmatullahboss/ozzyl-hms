/**
 * Enterprise-grade integration tests for Inventory Dispatch route.
 *
 * Covers: list, create (stock check + deduction), receive, tenant isolation.
 *
 * NOTE: dispatch POST first checks stock availability (AvailableQuantity >= DispatchedQuantity).
 *       The /:id/receive body field is `ReceivedRemarks` (optional), no required fields.
 */

import { describe, it, expect } from 'vitest';
import dispatchRoute from '../../../../src/routes/tenant/inventory/dispatch';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import { createMockDB, type MockDB } from '../../helpers/mock-db';
import {
  TENANT_1, TENANT_2,
  INV_DISPATCH_1, INV_DISPATCH_RECEIVED,
  INV_REQUISITION_1,
  INV_STORE_MAIN, INV_STORE_OT,
  INV_STOCK_1, INV_ITEM_1,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const SUFFICIENT_STOCK = {
  ...INV_STOCK_1,
  AvailableQuantity: 500, // more than DispatchedQuantity=15
};

const newDispatchBody = {
  RequisitionId: INV_REQUISITION_1.RequisitionId,
  SourceStoreId: INV_STORE_MAIN.StoreId,
  DestinationStoreId: INV_STORE_OT.StoreId,
  Remarks: 'Dispatching 15 units to OT',
  Items: [
    {
      RequisitionItemId: 1,  // required by dispatchItemSchema
      ItemId: INV_ITEM_1.ItemId,
      StockId: INV_STOCK_1.StockId,
      DispatchedQuantity: 15,
    },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Dispatch Routes', () => {

  describe('GET / — list dispatches', () => {
    it('returns paginated dispatches for tenant', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorydispatch: [INV_DISPATCH_1, INV_DISPATCH_RECEIVED] },
      });
      const res = await app.request('/dispatch');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by SourceStoreId', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventorydispatch: [INV_DISPATCH_1] },
      });
      const res = await app.request(`/dispatch?SourceStoreId=${INV_STORE_MAIN.StoreId}`);
      expect(res.status).toBe(200);
    });

    it('filters by RequisitionId', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorydispatch: [INV_DISPATCH_1] },
      });
      const res = await app.request(`/dispatch?RequisitionId=${INV_REQUISITION_1.RequisitionId}`);
      expect(res.status).toBe(200);
    });

    it('filters by IsReceived param', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorydispatch: [INV_DISPATCH_1] },
      });
      const res = await app.request('/dispatch?IsReceived=false');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorydispatch: [INV_DISPATCH_1] },
      });
      const res = await app.request('/dispatch');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST / — create dispatch', () => {
    it('creates dispatch (sufficient stock) and returns 201', async () => {
      // queryOverride: route does SELECT AvailableQuantity FROM InventoryStock WHERE StockId=? AND tenant_id=?
      // mock-db filterRows uses lowercase keys so PascalCase fixture StockId doesn't match.
      // Use queryOverride to return the stock row directly for the availability check.
      const sufficientStockMockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.toUpperCase().includes('SELECT') && sql.toUpperCase().includes('INVENTORYSTOCK')) {
            return { results: [{ AvailableQuantity: 500, StockId: INV_STOCK_1.StockId }] };
          }
          return null;
        },
      });
      const { app, mockDB } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB: sufficientStockMockDB,
      });
      const res = await jsonRequest(app, '/dispatch', { method: 'POST', body: newDispatchBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { DispatchId: number };
      expect(typeof body.DispatchId).toBe('number');

      // Verify dispatch INSERT has tenant_id
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toUpperCase().includes('INVENTORYDISPATCH'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when stock is insufficient', async () => {
      // queryOverride: return insufficient AvailableQuantity (3 < 15)
      const insuffStockMockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.toUpperCase().includes('SELECT') && sql.toUpperCase().includes('INVENTORYSTOCK')) {
            return { results: [{ AvailableQuantity: 3, StockId: INV_STOCK_1.StockId }] };
          }
          return null;
        },
      });
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB: insuffStockMockDB,
      });
      const res = await jsonRequest(app, '/dispatch', { method: 'POST', body: newDispatchBody });
      expect(res.status).toBe(400);
    });

    it('returns 400 when Items is empty (Zod min)', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/dispatch', {
        method: 'POST',
        body: { ...newDispatchBody, Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when RequisitionId is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const { RequisitionId: _removed, ...bodyNoReq } = newDispatchBody;
      const res = await jsonRequest(app, '/dispatch', { method: 'POST', body: bodyNoReq });
      expect(res.status).toBe(400);
    });

    it('returns 400 when DispatchedQuantity is zero (Zod positive)', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/dispatch', {
        method: 'POST',
        body: {
          ...newDispatchBody,
          Items: [{ ...newDispatchBody.Items[0], DispatchedQuantity: 0 }],
        },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id/receive — receive dispatch', () => {
    it('marks dispatch as received and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventorydispatch: [INV_DISPATCH_1], // ReceivedOn: null
          inventorydispatchitem: [],
          inventorystock: [SUFFICIENT_STOCK],
          inventorystocktransaction: [],
        },
        // universalFallback: .first() for PascalCase DispatchId lookup returns a row
        // The FALLBACK_ROW has ReceivedOn: undefined (falsy) so the guard passes
        universalFallback: true,
      });
      const res = await jsonRequest(app, `/dispatch/${INV_DISPATCH_1.DispatchId}/receive`, {
        method: 'PUT',
        body: { ReceivedRemarks: 'Items received in good condition' },
      });
      expect(res.status).toBe(200);

      // Verify dispatch UPDATE has tenant_id
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('dispatch'),
      );
      expect(updateQ).toBeTruthy();
      expect(updateQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when dispatch already received', async () => {
      // queryOverride returns a row WITH ReceivedOn set so the route detects it
      // universalFallback would return FALLBACK_ROW (ReceivedOn=null) which fails the guard
      const receivedDispatchDB = createMockDB({
        queryOverride: (sql: string) => {
          if (sql.toUpperCase().includes('SELECT') && sql.toUpperCase().includes('DISPATCH')) {
            return {
              results: [{
                DispatchId: INV_DISPATCH_RECEIVED.DispatchId,
                tenant_id: TENANT_1.id,
                ReceivedOn: '2024-01-18T15:00:00Z',
              }],
            };
          }
          return null;
        },
      });
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB: receivedDispatchDB,
      });
      const res = await jsonRequest(app, `/dispatch/${INV_DISPATCH_RECEIVED.DispatchId}/receive`, {
        method: 'PUT',
        body: { ReceivedRemarks: 'duplicate' },
      });
      expect(res.status).toBe(400);
    });


    it('returns 404 when dispatch does not belong to tenant', async () => {
      const { app } = createTestApp({
        route: dispatchRoute,
        routePath: '/dispatch',
        role: 'hospital_admin',
        tenantId: TENANT_2.id, // different tenant
        tables: {
          inventorydispatch: [INV_DISPATCH_1], // belongs to TENANT_1
        },
        // No universalFallback — should return null and trigger 404
      });
      const res = await jsonRequest(app, `/dispatch/${INV_DISPATCH_1.DispatchId}/receive`, {
        method: 'PUT',
        body: {},
      });
      expect(res.status).toBe(404);
    });
  });
});

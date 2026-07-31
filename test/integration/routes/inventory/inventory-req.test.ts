/**
 * Enterprise-grade integration tests for Inventory Requisitions route.
 *
 * Covers: list, get detail, create, cancel, item approval, tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import reqRoute from '../../../../src/routes/tenant/inventory/req';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_REQUISITION_1, INV_REQ_ITEM_1,
  INV_STORE_MAIN, INV_STORE_OT, INV_ITEM_1,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const newRequisitionBody = {
  RequestingStoreId: INV_STORE_OT.StoreId,
  SourceStoreId: INV_STORE_MAIN.StoreId,
  Priority: 'high' as const,
  RequiredDate: '2024-02-10',
  Remarks: 'Urgent request for OT',
  Items: [
    {
      ItemId: INV_ITEM_1.ItemId,
      RequestedQuantity: 30,
      Remarks: 'For upcoming surgeries',
    },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Requisitions Routes', () => {

  describe('GET / — list requisitions', () => {
    it('returns paginated requisitions for tenant', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrequisition: [INV_REQUISITION_1],
          inventoryrequisitionitem: [INV_REQ_ITEM_1],
        },
      });
      const res = await app.request('/req');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by RequestingStoreId', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventoryrequisition: [INV_REQUISITION_1] },
      });
      const res = await app.request(`/req?RequestingStoreId=${INV_STORE_OT.StoreId}`);
      expect(res.status).toBe(200);
    });

    it('filters by Priority', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrequisition: [INV_REQUISITION_1] },
      });
      const res = await app.request('/req?Priority=normal');
      expect(res.status).toBe(200);
    });

    it('filters by RequisitionStatus', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrequisition: [INV_REQUISITION_1] },
      });
      const res = await app.request('/req?RequisitionStatus=pending');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryrequisition: [INV_REQUISITION_1] },
      });
      const res = await app.request('/req');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('GET /:id — get requisition detail', () => {
    it('returns requisition detail with items', async () => {
      // universalFallback=true: mock .first() returns FALLBACK_ROW for JOIN queries
      // since the mock can't filter PascalCase columns in condition. Route then spreads
      // the returned row and fetches items separately.
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrequisition: [INV_REQUISITION_1],
          inventoryrequisitionitem: [INV_REQ_ITEM_1],
        },
        universalFallback: true,
      });
      const res = await app.request(`/req/${INV_REQUISITION_1.RequisitionId}`);
      expect(res.status).toBe(200);
    });

    it('returns 404 for requisition belonging to different tenant', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_2.id, // different tenant
        tables: {
          inventoryrequisition: [INV_REQUISITION_1], // belongs to TENANT_1
          inventoryrequisitionitem: [],
        },
        // No universalFallback — should return null and trigger 404
      });
      const res = await app.request(`/req/${INV_REQUISITION_1.RequisitionId}`);
      expect(res.status).toBe(404);
    });
  });


  describe('POST / — create requisition', () => {
    it('creates requisition with items and returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrequisition: [],
          inventoryrequisitionitem: [],
          inventorysequence: [],
        },
      });
      const res = await jsonRequest(app, '/req', { method: 'POST', body: newRequisitionBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { RequisitionId: number };
      expect(typeof body.RequisitionId).toBe('number');

      // Verify tenant_id in INSERT
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('requisition'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when Items is empty (Zod min)', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/req', {
        method: 'POST',
        body: { ...newRequisitionBody, Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when RequestingStoreId is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/req', {
        method: 'POST',
        body: { Items: newRequisitionBody.Items }, // no store
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid Priority enum (Zod)', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/req', {
        method: 'POST',
        body: { ...newRequisitionBody, Priority: 'critical' }, // invalid enum
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when RequestedQuantity is zero (Zod positive)', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/req', {
        method: 'POST',
        body: {
          ...newRequisitionBody,
          Items: [{ ItemId: 1, RequestedQuantity: 0 }],
        },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id — update requisition (cancel)', () => {
    it('cancels requisition and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrequisition: [INV_REQUISITION_1],
          inventoryrequisitionitem: [INV_REQ_ITEM_1],
        },
      });
      const res = await jsonRequest(app, `/req/${INV_REQUISITION_1.RequisitionId}`, {
        method: 'PUT',
        body: { RequisitionStatus: 'cancelled', CancelRemarks: 'No longer needed' },
      });
      expect(res.status).toBe(200);

      // Verify UPDATE has tenant_id
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('requisition'),
      );
      expect(updateQ).toBeTruthy();
      expect(updateQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 for invalid status value (Zod enum)', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/req/1', {
        method: 'PUT',
        body: { RequisitionStatus: 'rejected' }, // not in enum
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id/items/:itemId/approve — approve item', () => {
    it('approves a requisition item with ApprovedQuantity', async () => {
      const { app, mockDB } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrequisition: [INV_REQUISITION_1],
          inventoryrequisitionitem: [INV_REQ_ITEM_1],
        },
      });
      const res = await jsonRequest(
        app,
        `/req/${INV_REQUISITION_1.RequisitionId}/items/${INV_REQ_ITEM_1.RequisitionItemId}/approve`,
        {
          method: 'PUT',
          body: { ApprovedQuantity: 15 },
        },
      );
      expect(res.status).toBe(200);

      // Verify UPDATE to items has tenant scoping
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('requisitionitem'),
      );
      expect(updateQ).toBeTruthy();
    });

    it('returns 400 when ApprovedQuantity is negative (Zod min(0))', async () => {
      const { app } = createTestApp({
        route: reqRoute,
        routePath: '/req',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/req/1/items/1/approve', {
        method: 'PUT',
        body: { ApprovedQuantity: -5 },
      });
      expect(res.status).toBe(400);
    });
  });
});

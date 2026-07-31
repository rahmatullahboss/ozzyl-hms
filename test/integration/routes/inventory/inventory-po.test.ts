/**
 * Enterprise-grade integration tests for Inventory Purchase Orders route.
 *
 * Covers: list, create, drafts, Zod validation, tenant isolation.
 *
 * NOTE: po.ts has no PUT /:id route. Status updates happen via workflow.
 */

import { describe, it, expect } from 'vitest';
import poRoute from '../../../../src/routes/tenant/inventory/po';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_PO_1, INV_PO_ITEM_1,
  INV_VENDOR_1, INV_STORE_MAIN, INV_ITEM_1,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const newPOBody = {
  VendorId: INV_VENDOR_1.VendorId,
  StoreId: INV_STORE_MAIN.StoreId,
  PODate: '2024-02-01',
  DeliveryDays: 10,
  Items: [
    {
      ItemId: INV_ITEM_1.ItemId,
      Quantity: 50,
      StandardRate: 45,
      VATPercent: 0,
    },
  ],
};

const newDraftBody = {
  VendorId: INV_VENDOR_1.VendorId,
  Remarks: 'Draft for Q2',
  Items: [
    { ItemId: INV_ITEM_1.ItemId, Quantity: 10, ItemRate: 45 },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Purchase Orders Routes', () => {

  describe('GET / — list purchase orders', () => {
    it('returns paginated POs for tenant', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventorypurchaseorder: [INV_PO_1],
          inventorypurchaseorderitem: [INV_PO_ITEM_1],
        },
      });
      const res = await app.request('/po');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by VendorId', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventorypurchaseorder: [INV_PO_1] },
      });
      const res = await app.request(`/po?VendorId=${INV_VENDOR_1.VendorId}`);
      expect(res.status).toBe(200);
    });

    it('filters by POStatus', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorypurchaseorder: [INV_PO_1] },
      });
      const res = await app.request('/po?POStatus=pending');
      expect(res.status).toBe(200);
    });

    it('filters by date range', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorypurchaseorder: [INV_PO_1] },
      });
      const res = await app.request('/po?FromDate=2024-01-01&ToDate=2024-12-31');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorypurchaseorder: [INV_PO_1] },
      });
      const res = await app.request('/po');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST / — create purchase order', () => {
    it('creates PO with items and returns 201 with PurchaseOrderId', async () => {
      const { app, mockDB } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventorypurchaseorder: [],
          inventorypurchaseorderitem: [],
          inventorysequence: [],
        },
      });
      const res = await jsonRequest(app, '/po', { method: 'POST', body: newPOBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string; PurchaseOrderId: number };
      expect(typeof body.PurchaseOrderId).toBe('number');

      // Verify tenant_id in INSERT
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('purchaseorder'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when Items array is empty (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/po', {
        method: 'POST',
        body: { ...newPOBody, Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when VendorId is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/po', {
        method: 'POST',
        body: { Items: newPOBody.Items }, // no VendorId
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when item Quantity is zero (Zod positive)', async () => {
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/po', {
        method: 'POST',
        body: { ...newPOBody, Items: [{ ItemId: 1, Quantity: 0, StandardRate: 50, VATPercent: 0 }] },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /drafts — list draft POs', () => {
    it('returns draft POs scoped to tenant', async () => {
      const draftPO = {
        DraftId: 1,
        tenant_id: TENANT_1.id,
        Status: 'active',
        VendorId: INV_VENDOR_1.VendorId,
        Remarks: 'Draft',
        CreatedOn: '2024-01-10',
      };
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorypurchaseorderdraft: [draftPO] },
      });
      const res = await app.request('/po/drafts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });

    it('returns empty list for different tenant (draft isolation)', async () => {
      const draftPO = {
        DraftId: 1,
        tenant_id: TENANT_1.id,
        Status: 'active',
      };
      const { app } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorypurchaseorderdraft: [draftPO] },
      });
      const res = await app.request('/po/drafts');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST /drafts — create draft PO', () => {
    it('creates a draft and returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: poRoute,
        routePath: '/po',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventorypurchaseorderdraft: [],
          inventorypurchaseorderdraftitem: [],
          inventorysequence: [],
        },
      });
      const res = await jsonRequest(app, '/po/drafts', { method: 'POST', body: newDraftBody });
      expect(res.status).toBe(201);

      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('draft'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });
  });
});

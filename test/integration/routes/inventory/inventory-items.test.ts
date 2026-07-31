/**
 * Enterprise-grade integration tests for Inventory Items route.
 *
 * Covers: CRUD, filtering, Zod validation, tenant isolation, DB assertions.
 */

import { describe, it, expect } from 'vitest';
import itemsRoute from '../../../../src/routes/tenant/inventory/items';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_ITEM_1, INV_ITEM_2,
  INV_CATEGORY_1,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const newItemBody = {
  ItemName: 'Paracetamol 500mg',
  ItemCode: 'IT-003',
  ItemCategoryId: INV_CATEGORY_1.ItemCategoryId,
  StandardRate: 8.5,
  ReOrderLevel: 200,
  MinStockQuantity: 50,
  IsVATApplicable: false,
  VATPercentage: 0,
  IsFixedAsset: false,
  IsActive: true,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Items Routes', () => {

  describe('GET / — list items', () => {
    it('returns paginated items for tenant', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [INV_ITEM_1, INV_ITEM_2] },
      });
      const res = await app.request('/items');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by ItemCategoryId', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [INV_ITEM_1] },
      });
      const res = await app.request(`/items?ItemCategoryId=${INV_CATEGORY_1.ItemCategoryId}`);
      expect(res.status).toBe(200);
    });

    it('filters by search term', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [INV_ITEM_1] },
      });
      const res = await app.request('/items?search=glove');
      expect(res.status).toBe(200);
    });

    it('filters by IsActive param', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [INV_ITEM_1] },
      });
      const res = await app.request('/items?IsActive=true');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryitem: [INV_ITEM_1, INV_ITEM_2] },
      });
      const res = await app.request('/items');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST / — create item', () => {
    it('creates an item and returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [] },
      });
      const res = await jsonRequest(app, '/items', { method: 'POST', body: newItemBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { id: number; message: string };
      expect(typeof body.id).toBe('number');


      // Assert INSERT includes tenant_id
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('item'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('requires batch and expiry tracking for lab reagent items', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const invalid = await jsonRequest(app, '/items', {
        method: 'POST',
        body: { ItemName: 'CBC Reagent', ItemType: 'lab_reagent' },
      });
      expect(invalid.status).toBe(400);

      const valid = await jsonRequest(app, '/items', {
        method: 'POST',
        body: {
          ItemName: 'CBC Reagent',
          ItemType: 'lab_reagent',
          IsBatchRequired: true,
          IsExpiryRequired: true,
        },
      });
      expect(valid.status).toBe(201);
    });

    it('accepts radiology and X-ray consumables as a first-class item type', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const response = await jsonRequest(app, '/items', {
        method: 'POST',
        body: {
          ItemName: 'X-ray Film 14x17',
          ItemCode: 'XR-FILM-1417',
          ItemType: 'radiology_consumable',
          IsBatchRequired: true,
          IsExpiryRequired: true,
        },
      });

      expect(response.status).toBe(201);
    });

    it('returns 400 when ItemName is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/items', {
        method: 'POST',
        body: { StandardRate: 10 }, // no ItemName
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty ItemName (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/items', {
        method: 'POST',
        body: { ItemName: '' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id — update item', () => {
    it('updates item with explicit allowlist columns and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [INV_ITEM_1] },
      });
      const res = await jsonRequest(app, `/items/${INV_ITEM_1.ItemId}`, {
        method: 'PUT',
        body: { StandardRate: 50, ReOrderLevel: 75, IsActive: true },
      });
      expect(res.status).toBe(200);

      // Assert UPDATE query includes tenant scoping
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('item'),
      );
      expect(updateQ).toBeTruthy();
      expect(updateQ!.params).toContain(TENANT_1.id);
    });

    it('returns 200 with single field update', async () => {
      const { app } = createTestApp({
        route: itemsRoute,
        routePath: '/items',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitem: [INV_ITEM_1] },
      });
      const res = await jsonRequest(app, `/items/${INV_ITEM_1.ItemId}`, {
        method: 'PUT',
        body: { IsActive: false },
      });
      expect(res.status).toBe(200);
    });
  });
});

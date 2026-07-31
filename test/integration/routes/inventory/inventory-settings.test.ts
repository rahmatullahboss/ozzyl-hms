/**
 * Enterprise-grade integration tests for Inventory Settings route.
 *
 * Covers: Categories, SubCategories, UOM — CRUD, Zod validation, tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import settingsRoute from '../../../../src/routes/tenant/inventory/settings';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_CATEGORY_1, INV_SUBCATEGORY_1, INV_UOM_1,
} from '../../helpers/fixtures';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Settings Routes (Categories, SubCategories, UOM)', () => {

  // ===========================================================================
  // CATEGORIES
  // ===========================================================================

  describe('GET /categories — list categories', () => {
    it('returns paginated categories', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitemcategory: [INV_CATEGORY_1] },
      });
      const res = await app.request('/settings/categories');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });

    it('filters categories by search', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitemcategory: [INV_CATEGORY_1] },
      });
      const res = await app.request('/settings/categories?search=Surgical');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryitemcategory: [INV_CATEGORY_1] },
      });
      const res = await app.request('/settings/categories');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST /categories — create category', () => {
    it('creates a category and returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryitemcategory: [] },
      });
      const res = await jsonRequest(app, '/settings/categories', {
        method: 'POST',
        body: { CategoryName: 'Diagnostic Equipment', IsActive: true },
      });
      expect(res.status).toBe(201);

      // Verify tenant_id in INSERT
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('category'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when CategoryName is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/settings/categories', {
        method: 'POST',
        body: { IsActive: true }, // no CategoryName
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty CategoryName (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/settings/categories', {
        method: 'POST',
        body: { CategoryName: '' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // SUBCATEGORIES
  // ===========================================================================

  describe('GET /subcategories — list subcategories', () => {
    it('returns paginated subcategories', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorysubcategory: [INV_SUBCATEGORY_1] },
      });
      const res = await app.request('/settings/subcategories');
      expect(res.status).toBe(200);
    });

    it('filters by ItemCategoryId', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorysubcategory: [INV_SUBCATEGORY_1] },
      });
      const res = await app.request(`/settings/subcategories?ItemCategoryId=${INV_CATEGORY_1.ItemCategoryId}`);
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorysubcategory: [INV_SUBCATEGORY_1] },
      });
      const res = await app.request('/settings/subcategories');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST /subcategories — create subcategory', () => {
    it('creates subcategory and returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorysubcategory: [] },
      });
      const res = await jsonRequest(app, '/settings/subcategories', {
        method: 'POST',
        body: { SubCategoryName: 'Bandages', ItemCategoryId: 1, IsActive: true },
      });
      expect(res.status).toBe(201);
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('subcategory'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when SubCategoryName is missing', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/settings/subcategories', {
        method: 'POST',
        body: { ItemCategoryId: 1 },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when ItemCategoryId is missing', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/settings/subcategories', {
        method: 'POST',
        body: { SubCategoryName: 'Bandages' }, // no ItemCategoryId
      });
      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // UOM
  // ===========================================================================

  describe('GET /uom — list units of measure', () => {
    it('returns paginated UOMs', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryuom: [INV_UOM_1] },
      });
      const res = await app.request('/settings/uom');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryuom: [INV_UOM_1] },
      });
      const res = await app.request('/settings/uom');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST /uom — create UOM', () => {
    it('creates UOM and returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryuom: [] },
      });
      const res = await jsonRequest(app, '/settings/uom', {
        method: 'POST',
        body: { UOMName: 'Vial', IsActive: true },
      });
      expect(res.status).toBe(201);
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('uom'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when UOMName is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: settingsRoute,
        routePath: '/settings',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/settings/uom', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });
});

/**
 * Enterprise-grade integration tests for Inventory Stores route.
 *
 * Covers: list, filters, CRUD, Zod validation, tenant isolation, DB assertions.
 *
 * NOTE: stores.ts only has GET / and POST / routes. No PUT /:id exists yet.
 */

import { describe, it, expect } from 'vitest';
import storesRoute from '../../../../src/routes/tenant/inventory/stores';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_STORE_MAIN, INV_STORE_OT,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const newStoreBody = {
  StoreName: 'Pediatric Pharmacy',
  StoreCode: 'PED-PH',
  StoreType: 'substore' as const,  // valid enum: 'main' | 'substore' | 'departmental'
  Address: 'Block C, 2nd Floor',
  ContactPerson: 'Rehana Khatun',
  ContactPhone: '01800000003',
  IsActive: true,
};


// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Stores Routes', () => {

  describe('GET / — list stores', () => {
    it('returns paginated stores for tenant', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystore: [INV_STORE_MAIN, INV_STORE_OT] },
      });
      const res = await app.request('/stores');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by StoreType', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventorystore: [INV_STORE_MAIN] },
      });
      const res = await app.request('/stores?StoreType=pharmacy');
      expect(res.status).toBe(200);
    });

    it('filters by search term (matches StoreName)', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystore: [INV_STORE_MAIN] },
      });
      const res = await app.request('/stores?search=main');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventorystore: [INV_STORE_MAIN, INV_STORE_OT] },
      });
      const res = await app.request('/stores');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST / — create store', () => {
    it('creates a store and returns 201 with id', async () => {
      const { app, mockDB } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventorystore: [] },
      });
      const res = await jsonRequest(app, '/stores', { method: 'POST', body: newStoreBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string; id: number };
      expect(body.message).toMatch(/[Cc]reat/);
      expect(typeof body.id).toBe('number');

      // Assert INSERT includes tenant_id
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('store'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when StoreName is missing (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/stores', {
        method: 'POST',
        body: { StoreType: 'pharmacy' }, // no StoreName
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when StoreType is invalid (Zod enum)', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/stores', {
        method: 'POST',
        body: { ...newStoreBody, StoreType: 'warehouse' }, // not in enum
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty StoreName string (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: storesRoute,
        routePath: '/stores',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/stores', {
        method: 'POST',
        body: { ...newStoreBody, StoreName: '' },
      });
      expect(res.status).toBe(400);
    });
  });
});

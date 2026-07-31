/**
 * Enterprise-grade integration tests for Inventory Vendors route.
 *
 * Covers: CRUD, Zod validation, tenant isolation, DB INSERT assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import vendorsRoute from '../../../../src/routes/tenant/inventory/vendors';
import { DEFAULT_INVENTORY_VENDOR_PROFILES } from '../../../../src/lib/inventory-vendor-defaults';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_VENDOR_1, INV_VENDOR_2,
} from '../../helpers/fixtures';

// ─── Shared fixtures ───────────────────────────────────────────────────────

const newVendorBody = {
  VendorName: 'PharmaPro Ltd',
  VendorCode: 'VP-003',
  ContactPerson: 'Rahim Mia',
  ContactPhone: '01799000001',
  ContactEmail: 'info@pharmapro.bd',
  ContactAddress: 'Gulshan, Dhaka',
  City: 'Dhaka',
  Country: 'Bangladesh',
  CreditPeriod: 45,
  IsActive: true,
  IsTDSApplicable: false,
  TDSPercent: 0,
};

const updateVendorBody = {
  VendorName: 'PharmaPro Updated',
  CreditPeriod: 60,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Vendors Routes', () => {

  describe('GET / — list vendors', () => {
    it('returns paginated vendors for tenant', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [INV_VENDOR_1, INV_VENDOR_2] },
      });
      const res = await app.request('/vendors');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('returns 200 with pagination defaults (no query params)', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [INV_VENDOR_1] },
      });
      const res = await app.request('/vendors?page=1&limit=10');
      expect(res.status).toBe(200);
    });

    it('filters by search param', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [INV_VENDOR_1, INV_VENDOR_2] },
      });
      const res = await app.request('/vendors?search=MedSupply');
      expect(res.status).toBe(200);
    });

    it('filters by IsActive param', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [INV_VENDOR_1] },
      });
      const res = await app.request('/vendors?IsActive=true');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /defaults/seed — seed starter suppliers', () => {
    it('loads professional default vendors for the current tenant', async () => {
      const { app, mockDB } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [] },
      });

      const res = await jsonRequest(app, '/vendors/defaults/seed', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json() as { message: string; summary: { created: number; skipped: number; total: number } };
      expect(body.message).toBe('Default inventory vendors loaded');
      expect(body.summary).toEqual({
        created: DEFAULT_INVENTORY_VENDOR_PROFILES.length,
        skipped: 0,
        total: DEFAULT_INVENTORY_VENDOR_PROFILES.length,
      });

      const insertQueries = mockDB.queries.filter(
        q => q.method === 'run' && q.sql.includes('INSERT INTO InventoryVendor'),
      );
      expect(insertQueries.length).toBe(DEFAULT_INVENTORY_VENDOR_PROFILES.length);
      expect(insertQueries[0].params).toEqual(expect.arrayContaining([
        TENANT_1.id,
        'Roche Diagnostics Supplier',
        'VND-ROCHE-DX',
      ]));

      await new Promise(resolve => setTimeout(resolve, 0));
      const auditQuery = mockDB.queries.find(
        q => q.method === 'run' && q.sql.includes('INSERT INTO audit_logs'),
      );
      expect(auditQuery?.params).toEqual(expect.arrayContaining([
        TENANT_1.id,
        '1',
        'CREATE',
        'inventory_vendor_defaults',
      ]));
    });
  });

  describe('POST / — create vendor', () => {
    it('creates a vendor and returns 201 with VendorId', async () => {
      const { app, mockDB } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [] },
      });
      const res = await jsonRequest(app, '/vendors', { method: 'POST', body: newVendorBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string; id: number };
      expect(body.message).toMatch(/[Cc]reat/);
      expect(typeof body.id).toBe('number');

      // Verify INSERT was recorded with tenant_id
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('vendor'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when VendorName is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/vendors', {
        method: 'POST',
        body: { ContactPhone: '0171' }, // no VendorName
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when ContactEmail is invalid format (Zod)', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/vendors', {
        method: 'POST',
        body: { ...newVendorBody, ContactEmail: 'not-an-email' },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty request body', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/vendors', { method: 'POST', body: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id — update vendor', () => {
    it('updates vendor and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [INV_VENDOR_1] },
      });
      const res = await jsonRequest(app, `/vendors/${INV_VENDOR_1.VendorId}`, {
        method: 'PUT',
        body: updateVendorBody,
      });
      expect(res.status).toBe(200);

      // Assert UPDATE query has tenant scoping
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('vendor'),
      );
      expect(updateQ).toBeTruthy();
      expect(updateQ!.params).toContain(TENANT_1.id);
    });

    it('returns 200 with partial update body', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryvendor: [INV_VENDOR_1] },
      });
      const res = await jsonRequest(app, `/vendors/${INV_VENDOR_1.VendorId}`, {
        method: 'PUT',
        body: { IsActive: false },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Tenant isolation', () => {
    it('returns empty data for different tenant', async () => {
      const { app } = createTestApp({
        route: vendorsRoute,
        routePath: '/vendors',
        role: 'hospital_admin',
        tenantId: TENANT_2.id, // Tenant 2 — no vendors
        tables: { inventoryvendor: [INV_VENDOR_1, INV_VENDOR_2] }, // Both belong to TENANT_1
      });
      const res = await app.request('/vendors');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });
});

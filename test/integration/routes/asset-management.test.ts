/**
 * Integration tests for src/routes/tenant/inventory/assets.ts
 *
 * Tests asset CRUD, AMC contracts, maintenance log, allocations, stats
 * using actual route handlers with mock D1.
 */

import { describe, it, expect } from 'vitest';
import assets from '../../../src/routes/tenant/inventory/assets';
import { createTestApp, jsonRequest } from '../helpers/test-app';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ASSET_1 = {
  FixedAssetStockId: 1, tenant_id: 'tenant-1', ItemId: 10, BarCodeNumber: 'BC001',
  asset_category: 'Medical Equipment', manufacturer: 'Philips', model_number: 'MX800',
  serial_number: 'SN12345', asset_status: 'active', department: 'ICU', location: 'Room 3',
  purchase_cost: 500000, current_value: 400000, ItemName: 'Patient Monitor',
};

const AMC_1 = {
  id: 1, tenant_id: 'tenant-1', asset_stock_id: 1, contract_number: 'AMC-2025-001',
  vendor_name: 'Philips Service', start_date: '2025-01-01', end_date: '2025-12-31',
  contract_amount: 50000, coverage_type: 'comprehensive', is_active: 1,
};

const MAINT_1 = {
  id: 1, tenant_id: 'tenant-1', asset_stock_id: 1, maintenance_type: 'preventive',
  description: 'Annual calibration', performed_by: 'Tech Team', performed_date: '2025-03-15',
  next_due_date: '2025-09-15', cost: 5000, covered_by_amc: 1, status: 'completed',
};

const ALLOC_1 = {
  id: 1, tenant_id: 'tenant-1', asset_stock_id: 1, department: 'ICU',
  location: 'Room 3', allocated_to: 'Dr. Rahim', allocated_date: '2025-01-10',
  condition_on_allocate: 'good',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Asset Management Routes', () => {

  // ── GET / — list assets ─────────────────────────────────────────────────
  describe('GET / — list assets', () => {
    it('returns 200 with data array', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { InventoryFixedAssetStock: [ASSET_1] },
        universalFallback: true,
      });
      const res = await app.request('/assets');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });
  });

  // ── GET /stats ──────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns 200 with counts', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { InventoryFixedAssetStock: [ASSET_1], asset_amc_contracts: [], asset_maintenance_log: [] },
        universalFallback: true,
      });
      const res = await app.request('/assets/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('active');
      expect(body).toHaveProperty('expiring_amc');
    });
  });

  // ── POST / — register asset ─────────────────────────────────────────────
  describe('POST / — register asset', () => {
    it('returns 201 with valid body', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { InventoryFixedAssetStock: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets', {
        method: 'POST',
        body: { ItemId: 10, BarCodeNumber: 'BC999', asset_category: 'IT Equipment' },
      });
      expect(res.status).toBe(201);
    });

    it('auto-generates BarCodeNumber when missing', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets', {
        method: 'POST',
        body: { ItemId: 10, asset_category: 'IT' },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { BarCodeNumber?: string };
      expect(body.BarCodeNumber).toContain('FIXEDASSET');
    });

    it('rejects missing ItemId (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets', {
        method: 'POST',
        body: { BarCodeNumber: 'BC001', asset_category: 'IT' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── PUT /:id/status ─────────────────────────────────────────────────────
  describe('PUT /:id/status', () => {
    it('returns 200 with valid status', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { InventoryFixedAssetStock: [ASSET_1] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/status', {
        method: 'PUT',
        body: { status: 'under_repair' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/status', {
        method: 'PUT',
        body: { status: 'broken' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /amc — list AMC ─────────────────────────────────────────────────
  describe('GET /amc', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_amc_contracts: [AMC_1] },
        universalFallback: true,
      });
      const res = await app.request('/assets/amc');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });

  // ── POST /amc — create AMC ──────────────────────────────────────────────
  describe('POST /amc', () => {
    it('returns 201 with valid body', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_amc_contracts: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/amc', {
        method: 'POST',
        body: {
          asset_stock_id: 1, contract_number: 'AMC-NEW',
          vendor_name: 'TestVendor', start_date: '2025-04-01',
          end_date: '2026-04-01', contract_amount: 100000,
        },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing vendor_name (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/amc', {
        method: 'POST',
        body: { asset_stock_id: 1, contract_number: 'X', start_date: '2025-01-01', end_date: '2026-01-01', contract_amount: 0 },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /maintenance ────────────────────────────────────────────────────
  describe('GET /maintenance', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_maintenance_log: [MAINT_1] },
        universalFallback: true,
      });
      const res = await app.request('/assets/maintenance');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });

  // ── POST /maintenance — log maintenance ─────────────────────────────────
  describe('POST /maintenance', () => {
    it('returns 201 with valid body', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_maintenance_log: [], InventoryFixedAssetStock: [ASSET_1] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/maintenance', {
        method: 'POST',
        body: {
          asset_stock_id: 1, maintenance_type: 'preventive',
          description: 'Quarterly check', performed_date: '2025-04-07',
        },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing asset_stock_id (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/maintenance', {
        method: 'POST',
        body: { maintenance_type: 'preventive', performed_date: '2025-04-07' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /allocate ──────────────────────────────────────────────────────
  describe('POST /allocate', () => {
    it('returns 201 with valid body', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_allocations: [], InventoryFixedAssetStock: [ASSET_1] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/allocate', {
        method: 'POST',
        body: { asset_stock_id: 1, department: 'ICU', allocated_date: '2025-04-07' },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing department (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/allocate', {
        method: 'POST',
        body: { asset_stock_id: 1, allocated_date: '2025-04-07' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /allocate ───────────────────────────────────────────────────────
  describe('GET /allocate', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_allocations: [ALLOC_1] },
        universalFallback: true,
      });
      const res = await app.request('/assets/allocate');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });

  // ── PUT /allocate/:id/return ────────────────────────────────────────────
  describe('PUT /allocate/:id/return', () => {
    it('returns 200 with valid return', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_allocations: [ALLOC_1] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/allocate/1/return', {
        method: 'PUT',
        body: { returned_date: '2025-04-07', condition_on_return: 'good' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects missing returned_date (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/allocate/1/return', {
        method: 'PUT',
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });
});

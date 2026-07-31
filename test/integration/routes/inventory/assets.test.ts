/**
 * Integration tests for src/routes/tenant/inventory/assets.ts
 *
 * Covers: Insurance, Contracts/Documents, Depreciation, Disposal endpoints
 * using actual route handlers with mock D1.
 */

import { describe, it, expect } from 'vitest';
import assets from '../../../../src/routes/tenant/inventory/assets';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ASSET_1 = {
  FixedAssetStockId: 1, tenant_id: 'tenant-1', ItemId: 10, BarCodeNumber: 'BC001',
  asset_category: 'Medical Equipment', manufacturer: 'Philips', model_number: 'MX800',
  serial_number: 'SN12345', asset_status: 'active', department: 'ICU', location: 'Room 3',
  purchase_cost: 500000, current_value: 400000, ItemName: 'Patient Monitor',
};

const ASSET_DISPOSED = {
  FixedAssetStockId: 2, tenant_id: 'tenant-1', ItemId: 11, BarCodeNumber: 'BC002',
  asset_category: 'IT Equipment', asset_status: 'disposed', department: 'IT',
  purchase_cost: 100000, current_value: 0,
};

const INSURANCE_1 = {
  id: 1, tenant_id: 'tenant-1', asset_stock_id: 1, policy_number: 'POL-2025-001',
  insurer_name: 'National Insurance', insured_value: 500000, premium_amount: 12000,
  start_date: '2025-01-01', end_date: '2025-12-31', status: 'active',
};

const CONTRACT_1 = {
  id: 1, tenant_id: 'tenant-1', asset_stock_id: 1, contract_type: 'warranty',
  contract_number: 'WRN-2025-001', vendor_name: 'Philips', file_key: 'docs/warranty.pdf',
  file_name: 'warranty.pdf', is_active: 1,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Asset Insurance Endpoints', () => {

  describe('GET /:id/insurance — list insurance policies', () => {
    it('returns 200 with data array for valid asset', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_insurance_policies: [INSURANCE_1] },
        universalFallback: true,
      });
      const res = await app.request('/assets/1/insurance');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 400 for invalid asset ID', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await app.request('/assets/abc/insurance');
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent asset', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [] },
        universalFallback: false,
      });
      const res = await app.request('/assets/999/insurance');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/insurance — create insurance policy', () => {
    it('returns 201 with valid body', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_insurance_policies: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/insurance', {
        method: 'POST',
        body: {
          policy_number: 'POL-2025-NEW', insurer_name: 'State Insurance',
          insured_value: 400000, start_date: '2025-04-01', end_date: '2026-04-01',
        },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing policy_number (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/insurance', {
        method: 'POST',
        body: { insurer_name: 'Test', insured_value: 100000, start_date: '2025-01-01', end_date: '2026-01-01' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing insurer_name (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/insurance', {
        method: 'POST',
        body: { policy_number: 'POL-001', insured_value: 100000, start_date: '2025-01-01', end_date: '2026-01-01' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing dates (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/insurance', {
        method: 'POST',
        body: { policy_number: 'POL-001', insurer_name: 'Test', insured_value: 100000 },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /insurance/:id — update insurance policy', () => {
    it('returns 200 with valid update', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { asset_insurance_policies: [INSURANCE_1] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/insurance/1', {
        method: 'PUT',
        body: { status: 'expired' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects empty update body (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/insurance/1', {
        method: 'PUT',
        body: {},
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid insurance ID (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/insurance/abc', {
        method: 'PUT',
        body: { status: 'expired' },
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('Asset Contract Documents Endpoints', () => {

  describe('GET /:id/contracts — list contract documents', () => {
    it('returns 200 with data array for valid asset', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_contract_documents: [CONTRACT_1] },
        universalFallback: true,
      });
      const res = await app.request('/assets/1/contracts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 400 for invalid asset ID', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await app.request('/assets/abc/contracts');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /:id/contracts — create contract document', () => {
    it('returns 201 with valid body', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_contract_documents: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/contracts', {
        method: 'POST',
        body: {
          contract_type: 'warranty', file_key: 'docs/warranty.pdf',
          file_name: 'warranty.pdf', vendor_name: 'Philips',
        },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing contract_type (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/contracts', {
        method: 'POST',
        body: { file_key: 'docs/test.pdf' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing file_key (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/contracts', {
        method: 'POST',
        body: { contract_type: 'warranty' },
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('Asset Depreciation Endpoints', () => {

  describe('POST /:id/depreciation — record depreciation', () => {
    it('returns 201 with straight_line method', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_depreciation_entries: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: {
          depreciation_method: 'straight_line',
          depreciation_date: '2025-03-31',
          depreciation_amount: 50000,
        },
      });
      expect(res.status).toBe(201);
    });

    it('returns 201 with declining_balance method', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_depreciation_entries: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: {
          depreciation_method: 'declining_balance',
          depreciation_date: '2025-03-31',
          depreciation_amount: 80000,
          depreciation_rate: 25,
        },
      });
      expect(res.status).toBe(201);
    });

    it('returns 201 with manual method', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_depreciation_entries: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: {
          depreciation_method: 'manual',
          depreciation_date: '2025-03-31',
          depreciation_amount: 100000,
          remarks: 'Manual adjustment',
        },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing depreciation_date (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: { depreciation_amount: 50000 },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing depreciation_amount (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: { depreciation_date: '2025-03-31' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid depreciation_method (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: { depreciation_method: 'accelerated', depreciation_date: '2025-03-31', depreciation_amount: 50000 },
      });
      expect(res.status).toBe(400);
    });

    it('rejects negative depreciation_amount (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/depreciation', {
        method: 'POST',
        body: { depreciation_date: '2025-03-31', depreciation_amount: -100 },
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('Asset Disposal Endpoints', () => {

  describe('POST /:id/dispose — dispose asset', () => {
    it('returns 200 with scrap type', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_disposal_records: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: {
          disposal_date: '2025-06-01', disposal_type: 'scrap',
          reason: 'End of life, no longer functional',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('message', 'Asset disposed');
      expect(body).toHaveProperty('status', 'disposed');
    });

    it('returns 200 with sold type and disposal_value', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_disposal_records: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: {
          disposal_date: '2025-06-01', disposal_type: 'sold',
          reason: 'Upgraded to newer model', disposal_value: 50000,
        },
      });
      expect(res.status).toBe(200);
    });

    it('returns 200 with donated type', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_disposal_records: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: {
          disposal_date: '2025-06-01', disposal_type: 'donated',
          reason: 'Donated to rural clinic',
        },
      });
      expect(res.status).toBe(200);
    });

    it('returns 200 with lost type', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_disposal_records: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: {
          disposal_date: '2025-06-01', disposal_type: 'lost',
          reason: 'Missing from inventory count',
        },
      });
      expect(res.status).toBe(200);
    });

    it('returns 200 with condemned type', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_1], asset_disposal_records: [] },
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: {
          disposal_date: '2025-06-01', disposal_type: 'condemned',
          reason: 'Failed safety inspection, deemed unsafe for use',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('message', 'Asset disposed');
      expect(body).toHaveProperty('status', 'condemned');
    });

    it('rejects already disposed asset (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: { inventoryfixedassetstock: [ASSET_DISPOSED], asset_disposal_records: [] },
      });
      const res = await jsonRequest(app, '/assets/2/dispose', {
        method: 'POST',
        body: {
          disposal_date: '2025-06-01', disposal_type: 'scrap',
          reason: 'Already disposed',
        },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing disposal_date (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: { disposal_type: 'scrap', reason: 'Test' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing reason (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: { disposal_date: '2025-06-01', disposal_type: 'scrap' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid disposal_type (400)', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {},
      });
      const res = await jsonRequest(app, '/assets/1/dispose', {
        method: 'POST',
        body: { disposal_date: '2025-06-01', disposal_type: 'recycled', reason: 'Test' },
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('Asset Detail Endpoint (with insurance & contracts)', () => {

  describe('GET /:id — single asset detail', () => {
    it('returns 200 with nested insurance and contracts', async () => {
      const { app } = createTestApp({
        route: assets, routePath: '/assets', role: 'hospital_admin',
        tables: {
          inventoryfixedassetstock: [ASSET_1],
          asset_amc_contracts: [],
          asset_maintenance_log: [],
          asset_allocations: [],
          asset_insurance_policies: [INSURANCE_1],
          asset_contract_documents: [CONTRACT_1],
        },
        universalFallback: true,
      });
      const res = await app.request('/assets/1');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('insurance_policies');
      expect(body).toHaveProperty('contract_documents');
      expect(Array.isArray(body.insurance_policies)).toBe(true);
      expect(Array.isArray(body.contract_documents)).toBe(true);
    });
  });
});

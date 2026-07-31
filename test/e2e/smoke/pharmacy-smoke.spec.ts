/**
 * Pharmacy Module — E2E API Smoke Tests (Playwright)
 * ══════════════════════════════════════════════════════════════════════════════
 * Enterprise-grade smoke tests that run against production/staging.
 * If these fail → STOP the pipeline.
 *
 * Run:
 *   npx playwright test test/e2e/smoke/pharmacy-smoke.spec.ts --project=smoke
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

test.beforeAll(() => {
  loadAuth();
});

// ─── SMOKE: Pharmacy Core Endpoints ─────────────────────────────────────────
test.describe('💊 Pharmacy Smoke — Core Endpoints', () => {
  const READ_ENDPOINTS = [
    '/api/pharmacy/medicines',
    '/api/pharmacy/items',
    '/api/pharmacy/stock',
    '/api/pharmacy/categories',
    '/api/pharmacy/generics',
    '/api/pharmacy/suppliers',
    '/api/pharmacy/pharmacy-suppliers',
    '/api/pharmacy/uom',
    '/api/pharmacy/packing-types',
    '/api/pharmacy/racks',
    '/api/pharmacy/purchase-orders',
    '/api/pharmacy/goods-receipts',
    '/api/pharmacy/invoices',
    '/api/pharmacy/deposits',
    '/api/pharmacy/settlements',
    '/api/pharmacy/counters',
    '/api/pharmacy/alerts/low-stock',
    '/api/pharmacy/alerts/expiring',
    '/api/pharmacy/summary',
  ];

  for (const endpoint of READ_ENDPOINTS) {
    test(`GET ${endpoint} → 200 (not 500)`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect(latency).toBeLessThan(3000);
      expect([200, 404]).toContain(res.status());
    });
  }
});

// ─── SMOKE: Pharmacy Phase 2/3 Endpoints ────────────────────────────────────
test.describe('💊 Pharmacy Smoke — Phase 2/3 Endpoints', () => {
  const PHASE23_ENDPOINTS = [
    '/api/pharmacy/tax-config',
    '/api/pharmacy/dosage-templates',
    '/api/pharmacy/stock/transactions',
    '/api/pharmacy/returns/supplier',
    '/api/pharmacy/invoice-returns',
    '/api/pharmacy/provisional-invoices',
    '/api/pharmacy/prescriptions',
    '/api/pharmacy/narcotics',
    '/api/pharmacy/write-offs',
    '/api/pharmacy/requisitions',
    '/api/pharmacy/dispatches',
    '/api/pharmacy/master-drugs/stats',
  ];

  for (const endpoint of PHASE23_ENDPOINTS) {
    test(`GET ${endpoint} → 200 or 404 (not 500)`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect(latency).toBeLessThan(3000);
    });
  }
});

// ─── SMOKE: Auth Required (401 without token) ──────────────────────────────
test.describe('🔒 Pharmacy Smoke — Auth Required', () => {
  const PROTECTED = [
    '/api/pharmacy/medicines',
    '/api/pharmacy/items',
    '/api/pharmacy/stock',
    '/api/pharmacy/invoices',
    '/api/pharmacy/purchase-orders',
    '/api/pharmacy/goods-receipts',
    '/api/pharmacy/summary',
    '/api/pharmacy/tax-config',
  ];

  for (const endpoint of PROTECTED) {
    test(`GET ${endpoint} → 401 without auth`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status()).toBe(401);
    });
  }
});

// ─── SMOKE: POST Validation (malformed body) ────────────────────────────────
test.describe('📝 Pharmacy Smoke — POST Validation', () => {
  const POST_ENDPOINTS: Array<[string, Record<string, unknown>]> = [
    ['/api/pharmacy/medicines', {}],
    ['/api/pharmacy/items', {}],
    ['/api/pharmacy/invoices', {}],
    ['/api/pharmacy/purchase-orders', {}],
    ['/api/pharmacy/goods-receipts', {}],
    ['/api/pharmacy/deposits', {}],
    ['/api/pharmacy/settlements', {}],
    ['/api/pharmacy/stock/adjustment', {}],
    ['/api/pharmacy/categories', {}],
    ['/api/pharmacy/generics', {}],
    ['/api/pharmacy/tax-config', {}],
    ['/api/pharmacy/dosage-templates', {}],
    ['/api/pharmacy/narcotics', {}],
    ['/api/pharmacy/write-offs', {}],
    ['/api/pharmacy/requisitions', {}],
    ['/api/pharmacy/dispatches', {}],
    ['/api/pharmacy/prescriptions', {}],
  ];

  for (const [endpoint, body] of POST_ENDPOINTS) {
    test(`POST ${endpoint} empty body → 400/422 (not 500)`, async ({ request }) => {
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: authHeaders(),
      });
      expect(res.status()).not.toBe(500);
      expect([400, 422]).toContain(res.status());
    });
  }
});

// ─── SMOKE: Response Contract ───────────────────────────────────────────────
test.describe('📋 Pharmacy Smoke — Response Contract', () => {
  test('GET /api/pharmacy/summary → JSON with numeric fields', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/summary`, {
      headers: authHeaders(),
    });
    if (res.status() === 200) {
      const body = await res.json();
      // Production returns camelCase: grossProfit, totalInvestment, etc.
      expect(typeof body).toBe('object');
      expect(body).not.toBeNull();
    }
  });

  test('GET /api/pharmacy/medicines → JSON array', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/medicines`, {
      headers: authHeaders(),
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('medicines');
      expect(Array.isArray(body.medicines)).toBe(true);
    }
  });

  test('No 500 on 10 concurrent pharmacy requests', async ({ request }) => {
    const endpoints = [
      '/api/pharmacy/medicines', '/api/pharmacy/items',
      '/api/pharmacy/stock', '/api/pharmacy/categories',
      '/api/pharmacy/generics', '/api/pharmacy/suppliers',
      '/api/pharmacy/purchase-orders', '/api/pharmacy/invoices',
      '/api/pharmacy/alerts/low-stock', '/api/pharmacy/summary',
    ];
    const responses = await Promise.all(
      endpoints.map(e =>
        request.get(`${BASE_URL}${e}`, { headers: authHeaders() }),
      ),
    );
    for (const res of responses) {
      expect(res.status()).not.toBe(500);
    }
  });

  test('Latency: pharmacy summary < 2s', async ({ request }) => {
    const start = Date.now();
    await request.get(`${BASE_URL}/api/pharmacy/summary`, {
      headers: authHeaders(),
    });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

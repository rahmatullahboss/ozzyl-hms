/**
 * Ozzyl HMS — Nursing API Smoke Tests (Playwright)
 *
 * Tests ALL nursing/IPD-related API endpoints against production (or any BASE_URL).
 * Validates:
 *   - Auth middleware is active (401 for unauthenticated requests)
 *   - No 500 errors on any nursing endpoint
 *   - Response time < 3000ms
 *   - JSON responses are valid
 *
 * Run:
 *   pnpm test:e2e:prod --project=smoke
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev pnpm test:e2e:prod --project=smoke
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] || 'https://hms-saas-production.rahmatullahzisan.workers.dev';

// ─── SMOKE: Nursing GET Endpoints (unauthenticated → 401) ─────────────────────
test.describe('🏥 Smoke — Nursing GET Endpoints (401 without auth)', () => {
  const endpoints = [
    // ─── Core Nursing ────────────────────────────────────────────
    '/api/nursing/wards/bed-grid',
    '/api/nursing/medication-orders',
    '/api/nursing/notes',
    '/api/nursing/io',
    '/api/nursing/care-plan',
    '/api/nursing/activity-log',
    '/api/nursing/respiratory',
    '/api/nursing/iv-drugs',
    '/api/nursing/investigation-results',
    '/api/nursing/diet-sheet',
    // ─── Nurse Station ───────────────────────────────────────────
    '/api/nurse-station/dashboard',
    '/api/nurse-station/vitals',
    '/api/nurse-station/active-alerts',
    // ─── IPD & Ward ──────────────────────────────────────────────
    '/api/billing-provisional',
    '/api/discharge-planning',
    '/api/ward-supply/stats',
    // ─── Housekeeping ────────────────────────────────────────────
    '/api/housekeeping/tasks',
  ];

  for (const endpoint of endpoints) {
    test(`GET ${endpoint} → 401 (not 500)`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const latency = Date.now() - start;

      // Never 500
      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect(res.status()).not.toBe(503);

      // Must respond in under 3s
      expect(latency).toBeLessThan(3000);

      // Auth required endpoints return 401/403/404
      expect([401, 403, 404]).toContain(res.status());

      // Verify JSON response
      const ct = res.headers()['content-type'] || '';
      expect(ct).toContain('application/json');
    });
  }
});

// ─── SMOKE: Nursing POST Endpoints (unauthenticated → 401/400) ────────────────
test.describe('📝 Smoke — Nursing POST Endpoints (auth required)', () => {
  const postEndpoints: Array<[string, Record<string, unknown>]> = [
    ['/api/nursing/emergency-alert', { patientId: 1, wardId: 1, type: 'code-blue' }],
    ['/api/nursing/notes', { patientId: 1, content: 'Test note', noteType: 'clinical' }],
    ['/api/nursing/io', { patientId: 1, type: 'intake', item: 'Oral fluid', amount: 200 }],
  ];

  for (const [endpoint, body] of postEndpoints) {
    test(`POST ${endpoint} → 401/400 (not 500)`, async ({ request }) => {
      const start = Date.now();
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: { 'Content-Type': 'application/json' },
      });
      const latency = Date.now() - start;

      // Never 500
      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect(res.status()).not.toBe(503);

      // Must respond in under 3s
      expect(latency).toBeLessThan(3000);

      // Auth or validation error
      expect([400, 401, 403, 404, 422]).toContain(res.status());

      // Verify JSON response
      const ct = res.headers()['content-type'] || '';
      expect(ct).toContain('application/json');
    });
  }
});

// ─── SMOKE: Nursing Response Contract ─────────────────────────────────────────
test.describe('📋 Smoke — Nursing Response Contract', () => {
  test('Nursing API error responses are JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/notes`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('application/json');
  });

  test('Nurse station API error responses are JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nurse-station/dashboard`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('application/json');
  });
});

// ─── SMOKE: Nursing Concurrent Load ───────────────────────────────────────────
test.describe('⚡ Smoke — Nursing Concurrent Load', () => {
  test('10 concurrent GET requests to nursing endpoints → no 500', async ({ request }) => {
    const endpoints = [
      '/api/nursing/wards/bed-grid',
      '/api/nursing/medication-orders',
      '/api/nursing/notes',
      '/api/nursing/io',
      '/api/nursing/care-plan',
      '/api/nursing/activity-log',
      '/api/nursing/respiratory',
      '/api/nursing/iv-drugs',
      '/api/nursing/investigation-results',
      '/api/nursing/diet-sheet',
    ];

    const responses = await Promise.all(
      endpoints.map((e) =>
        request.get(`${BASE_URL}${e}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    for (let i = 0; i < responses.length; i++) {
      const res = responses[i];
      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect(res.status()).not.toBe(503);
    }
  });

  test('10 concurrent requests complete in under 10s', async ({ request }) => {
    const endpoints = [
      '/api/nursing/wards/bed-grid',
      '/api/nursing/medication-orders',
      '/api/nursing/notes',
      '/api/nursing/io',
      '/api/nursing/care-plan',
      '/api/nursing/activity-log',
      '/api/nursing/respiratory',
      '/api/nursing/iv-drugs',
      '/api/nursing/investigation-results',
      '/api/nursing/diet-sheet',
    ];

    const start = Date.now();
    await Promise.all(
      endpoints.map((e) =>
        request.get(`${BASE_URL}${e}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const totalLatency = Date.now() - start;

    expect(totalLatency).toBeLessThan(10000);
  });
});

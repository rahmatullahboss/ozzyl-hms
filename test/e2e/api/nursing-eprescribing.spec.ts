/**
 * Ozzyl HMS — E2E Smoke Tests: Nursing + E-Prescribing Modules
 *
 * Verifies all GET endpoints for the two newest modules return non-500
 * status, with response shape contracts and concurrency checks.
 *
 * Requires:
 *   E2E_EMAIL=your@email.com E2E_PASSWORD=yourpass
 *
 * Run:
 *   E2E_EMAIL=... E2E_PASSWORD=... npx playwright test --project=nursing-eprescribing
 */

import { test, expect } from '@playwright/test';
import { BASE_URL, loadAuth, authHeaders } from '../helpers/auth-helper';

const SLA_MS = 5000;

// ─── Login before all tests ────────────────────────────────────────────────────

test.beforeAll(async () => {
  const auth = loadAuth();
  console.log(`✅ Auth loaded: ${auth.user.name} (${auth.user.role})`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NURSING MODULE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🩺 Nursing — GET Endpoints', () => {
  const nursingEndpoints = [
    '/api/nursing/patients',
    '/api/nursing/care-plan',
    '/api/nursing/notes',
    '/api/nursing/mar',
    '/api/nursing/io',
    '/api/nursing/monitoring',
    '/api/nursing/iv-drugs',
    '/api/nursing/wound-care',
    '/api/nursing/handover',
    '/api/nursing/opd/visits',
    '/api/nursing/wards',
  ];

  for (const endpoint of nursingEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
      expect(latency).toBeLessThan(SLA_MS);
    });
  }
});

test.describe('🩺 Nursing — Response Shapes', () => {
  test('GET /api/nursing/patients → { Results, TotalCount }', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/patients`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('TotalCount');
      expect(Array.isArray(body.Results)).toBe(true);
      expect(typeof body.TotalCount).toBe('number');
    }
  });

  test('GET /api/nursing/care-plan → paginated list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/care-plan`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(Array.isArray(body.Results)).toBe(true);
    }
  });

  test('GET /api/nursing/wards → ward list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/wards`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('wards');
      expect(Array.isArray(body.wards)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E-PRESCRIBING MODULE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('💊 E-Prescribing — GET Endpoints', () => {
  const ePrescribingEndpoints = [
    '/api/e-prescribing/stats',
    '/api/e-prescribing/formulary',
    '/api/e-prescribing/formulary/categories',
    '/api/e-prescribing/interactions',
    '/api/e-prescribing/safety-checks',
  ];

  for (const endpoint of ePrescribingEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
      expect(latency).toBeLessThan(SLA_MS);
    });
  }
});

test.describe('💊 E-Prescribing — Response Shapes', () => {
  test('GET /api/e-prescribing/stats → stats object', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/e-prescribing/stats`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.total_items).toBe('number');
      expect(typeof body.total_categories).toBe('number');
      expect(typeof body.total_interactions).toBe('number');
    }
  });

  test('GET /api/e-prescribing/formulary → { formulary[] }', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/e-prescribing/formulary`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('formulary');
      expect(Array.isArray(body.formulary)).toBe(true);
    }
  });

  test('GET /api/e-prescribing/formulary/categories → { categories[] }', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/e-prescribing/formulary/categories`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('categories');
      expect(Array.isArray(body.categories)).toBe(true);
    }
  });

  test('GET /api/e-prescribing/interactions → paginated', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/e-prescribing/interactions`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('interactions');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.interactions)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E-PRESCRIBING SAFETY CHECKER — POST endpoint smoke
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('💊 E-Prescribing — Safety Checker', () => {
  test('POST /api/e-prescribing/check-safety → validates drug pair', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/e-prescribing/check-safety`, {
      headers: authHeaders(),
      data: {
        patient_id: 1,
        medication_name: 'warfarin',
        generic_name: 'warfarin',
      },
    });
    // Should be 200 (found results) or 400 (validation error), never 500
    expect(res.status(), `check-safety returned ${res.status()}`).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONCURRENT SMOKE — both modules together
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('⚡ Concurrent — Nursing + E-Prescribing', () => {
  test('10 concurrent GETs across both modules → all < 500', async ({ request }) => {
    const endpoints = [
      '/api/nursing/patients',
      '/api/nursing/care-plan',
      '/api/nursing/notes',
      '/api/nursing/mar',
      '/api/nursing/wards',
      '/api/e-prescribing/stats',
      '/api/e-prescribing/formulary',
      '/api/e-prescribing/formulary/categories',
      '/api/e-prescribing/interactions',
      '/api/e-prescribing/safety-checks',
    ];

    const start = Date.now();
    const responses = await Promise.all(
      endpoints.map(ep =>
        request.get(`${BASE_URL}${ep}`, { headers: authHeaders() })
      )
    );
    const totalMs = Date.now() - start;

    for (const [i, res] of responses.entries()) {
      expect(res.status(), `${endpoints[i]} returned ${res.status()}`).toBeLessThan(500);
    }

    // All 10 concurrent requests should finish under 10s
    expect(totalMs).toBeLessThan(10_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE SLA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('⏱️ SLA — Nursing + E-Prescribing', () => {
  const criticalEndpoints = [
    '/api/nursing/patients',
    '/api/nursing/care-plan',
    '/api/e-prescribing/stats',
    '/api/e-prescribing/formulary',
  ];

  for (const endpoint of criticalEndpoints) {
    test(`GET ${endpoint} → under ${SLA_MS}ms`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
      expect(latency).toBeLessThan(SLA_MS);
    });
  }
});

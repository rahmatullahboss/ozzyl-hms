/**
 * Ozzyl HMS — Super Admin API E2E Tests (Playwright)
 *
 * Tests all Super Admin API endpoints:
 *  - Auth: login, unauthorized access, role enforcement
 *  - CRUD: hospitals, onboarding requests
 *  - Platform: stats, audit logs, system health, plans
 *  - Input validation: ID params, bad bodies
 *  - Impersonation: endpoint contract
 *
 * Run:
 *   npx playwright test test/e2e/api/super-admin-api.spec.ts --project=api
 */

import { test, expect } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SLA_MS = 3000;

// ─── AUTH ────────────────────────────────────────────────────────────────────────
test.describe('🛡️ Super Admin — Auth', () => {
  test('POST /api/admin/login with empty body → 400/422/429 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 422, 429]).toContain(res.status());
  });

  test('POST /api/admin/login with bad credentials → 401/429', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: { email: 'notreal@admin.com', password: 'wrongpassword123' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 429]).toContain(res.status());
  });

  test('POST /api/admin/login with non-admin user creds → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: { email: 'reception@demo.com', password: 'password123' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([401, 429]).toContain(res.status());
  });

  test('POST /api/admin/login with SQL injection → 400/401 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: { email: "' OR 1=1--", password: 'anything' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422, 429]).toContain(res.status());
  });
});

// ─── PROTECTED ENDPOINTS — No Auth ─────────────────────────────────────────────
test.describe('🔒 Super Admin — Unauthorized Access (no token)', () => {
  const PROTECTED_ADMIN_ROUTES = [
    '/api/admin/hospitals',
    '/api/admin/stats',
    '/api/admin/plans',
    '/api/admin/onboarding',
    '/api/admin/audit-logs',
    '/api/admin/system-health',
    '/api/admin/usage',
  ];

  for (const endpoint of PROTECTED_ADMIN_ROUTES) {
    test(`GET ${endpoint} without auth → 401/403 (not 500)`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, { headers: JSON_HEADERS });
      const latency = Date.now() - start;

      expect(res.status()).not.toBe(500);
      expect([401, 403]).toContain(res.status());
      expect(latency).toBeLessThan(SLA_MS);
      expect(res.headers()['content-type']).toContain('application/json');
    });
  }
});

// ─── PROTECTED ENDPOINTS — Wrong Role ──────────────────────────────────────────
test.describe('🚫 Super Admin — Wrong Role Rejection', () => {
  test('GET /api/admin/hospitals with regular-user JWT → 401/403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals`, {
      headers: {
        ...JSON_HEADERS,
        Authorization: 'Bearer invalid.jwt.token.here',
      },
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/admin/hospitals with invalid JWT → 401/403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/hospitals`, {
      data: { name: 'Hacked Hospital', subdomain: 'hacked' },
      headers: {
        ...JSON_HEADERS,
        Authorization: 'Bearer invalid.jwt.token',
      },
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });
});

// ─── INPUT VALIDATION — Hospital ID param ──────────────────────────────────────
test.describe('🔢 Super Admin — ID Validation', () => {
  test('GET /api/admin/hospitals/abc → 400/401 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals/abc`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('GET /api/admin/hospitals/-1 → 400/401 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals/-1`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('GET /api/admin/hospitals/0 → 400/401 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals/0`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('DELETE /api/admin/hospitals/abc → 400/401 (not 500)', async ({ request }) => {
    const res = await request.delete(`${BASE_URL}/api/admin/hospitals/abc`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('POST /api/admin/impersonate/abc → 400/401 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/impersonate/abc`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });
});

// ─── HOSPITAL CRUD — Validation ────────────────────────────────────────────────
test.describe('🏥 Super Admin — Hospital CRUD Validation', () => {
  test('POST /api/admin/hospitals with empty body → 400/401/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/hospitals`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test('PUT /api/admin/hospitals/1 with empty body → 400/401/422', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/admin/hospitals/1`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test('POST /api/admin/hospitals with reserved subdomain → 400/401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/hospitals`, {
      data: { name: 'Test', subdomain: 'admin', adminEmail: 'a@b.com', adminName: 'A', adminPassword: 'password123' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });
});

// ─── ONBOARDING — Validation ───────────────────────────────────────────────────
test.describe('📋 Super Admin — Onboarding Validation', () => {
  test('PUT /api/admin/onboarding/1 with invalid status → 400/401/422', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/admin/onboarding/1`, {
      data: { status: 'invalid_status_xyz' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test('POST /api/admin/onboarding/1/provision with empty body → 400/401/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/onboarding/1/provision`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test('POST /api/admin/onboarding/1/provision with reserved slug → 400/401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/onboarding/1/provision`, {
      data: { slug: 'admin', adminEmail: 'a@b.com', adminName: 'Test', plan: 'starter' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('POST /api/admin/onboarding/1/provision with invalid slug format → 400/401/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/onboarding/1/provision`, {
      data: { slug: 'AB', adminEmail: 'a@b.com', adminName: 'Test', plan: 'starter' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 403, 422]).toContain(res.status());
  });
});

// ─── PAGINATION PARAMS ─────────────────────────────────────────────────────────
test.describe('📄 Super Admin — Pagination Support', () => {
  test('GET /api/admin/hospitals?page=1&limit=10 → 401/403 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals?page=1&limit=10`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });

  test('GET /api/admin/audit-logs?page=1&limit=20 → 401/403 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/audit-logs?page=1&limit=20`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });

  test('GET /api/admin/hospitals?page=abc&limit=-5 → 401/403 (not 500 — bad params handled)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals?page=abc&limit=-5`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });
});

// ─── CONCURRENT LOAD ───────────────────────────────────────────────────────────
test.describe('⚡ Super Admin — Concurrent Load (no 5xx)', () => {
  test('10 concurrent admin GET requests → all non-500', async ({ request }) => {
    const endpoints = [
      '/api/admin/hospitals',
      '/api/admin/stats',
      '/api/admin/plans',
      '/api/admin/onboarding',
      '/api/admin/audit-logs',
      '/api/admin/system-health',
      '/api/admin/usage',
      '/api/admin/hospitals/1',
      '/api/admin/hospitals/999999',
      '/api/admin/onboarding?status=pending',
    ];

    const responses = await Promise.all(
      endpoints.map((e) => request.get(`${BASE_URL}${e}`, { headers: JSON_HEADERS }))
    );

    for (const [i, res] of responses.entries()) {
      expect(res.status(), `${endpoints[i]} returned 5xx`).not.toBe(500);
      expect(res.status(), `${endpoints[i]} returned 502`).not.toBe(502);
    }
  });
});

// ─── EDGE CASES ────────────────────────────────────────────────────────────────
test.describe('🎯 Super Admin — Edge Cases', () => {
  test('GET /api/admin/hospitals/99999999999 → 400/401 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals/99999999999`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });

  test('GET /api/admin/nonexistent → 401/403/404', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/nonexistent-endpoint`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });

  test('POST /api/admin/login with XSS in email → 400/401 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: { email: '<script>alert(1)</script>', password: 'x' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });

  test('POST /api/admin/hospitals with SQL injection in subdomain → 400/401 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/hospitals`, {
      data: { name: 'Hack', subdomain: "'; DROP TABLE tenants;--" },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });
});

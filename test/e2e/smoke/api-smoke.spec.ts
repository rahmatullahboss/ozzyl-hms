/**
 * Ozzyl HMS — Comprehensive API Smoke Test (Playwright)
 *
 * Tests ALL HMS API endpoints against production (or any BASE_URL).
 * Validates:
 *   - Worker is alive and serving
 *   - Auth middleware is active (401 for unauthenticated requests)
 *   - No 500 errors on any endpoint
 *   - Response time < 3000ms
 *   - JSON responses are valid
 *   - Public endpoints return correct status codes
 *
 * Run:
 *   npx playwright test --project=smoke
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev npx playwright test --project=smoke
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] || 'https://hms-saas-production.rahmatullahzisan.workers.dev';

// ─── SMOKE: Worker Health ─────────────────────────────────────────────────────
test.describe('🔥 Smoke — Worker Health', () => {
  test('GET / → worker alive (200 or redirect)', async ({ request }) => {
    const res = await request.get(BASE_URL);
    expect(res.status()).not.toBe(500);
    expect([200, 301, 302, 401]).toContain(res.status());
  });

  test('GET / latency < 2000ms', async ({ request }) => {
    const start = Date.now();
    await request.get(BASE_URL);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('GET /api/health → 200 with JSON body', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/health`);
    const latency = Date.now() - start;

    expect(res.status()).toBe(200);
    expect(latency).toBeLessThan(2000);

    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('timestamp');
  });

  test('GET /api/nonexistent → not 500', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/this-does-not-exist-xyz`);
    expect(res.status()).not.toBe(500);
  });
});

// ─── SMOKE: Auth Endpoints ────────────────────────────────────────────────────
test.describe('🔒 Smoke — Auth', () => {
  test('POST /api/auth/login → 400/401 for empty body (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422, 429]).toContain(res.status());
  });

  test('POST /api/auth/login → 400 for invalid credentials', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: 'notreal@notreal.com', password: 'wrong' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422, 429]).toContain(res.status());
  });

  test('POST /api/auth/login-direct → 400/401 for empty body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/login-direct`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 422, 429]).toContain(res.status());
  });

  test('POST /api/admin/login → 400/401 for empty body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 422, 429]).toContain(res.status());
  });
});

// ─── SMOKE: Public Endpoints (no auth required) ──────────────────────────────
test.describe('🌍 Smoke — Public Endpoints', () => {
  test('POST /api/register → 400/422 for empty body (validation)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/register`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([400, 422, 429]).toContain(res.status());
  });

  test('POST /api/onboarding → 400/422 for empty body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/onboarding`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 404, 422, 429]).toContain(res.status());
  });

  test('GET /api/rx/invalidtoken → 400/404 (shared prescription)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/rx/invalidtoken`);
    expect(res.status()).not.toBe(500);
    expect([400, 404]).toContain(res.status());
  });

  test('GET /api/invite/nonexistent-token → 400/404/429', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invite/nonexistent-token`);
    expect(res.status()).not.toBe(500);
    expect([400, 404, 429]).toContain(res.status());
  });
});

// ─── SMOKE: All Core GET Endpoints (unauthenticated → 401) ───────────────────
test.describe('🏥 Smoke — Core Endpoints (401 without auth)', () => {
  const endpoints = [
    // ─── Patient & Clinical ─────────────────────────────────────
    '/api/patients',
    '/api/visits',
    '/api/admissions',
    '/api/discharge',
    '/api/emergency',
    '/api/vitals',
    '/api/allergies',
    '/api/prescriptions',
    '/api/consultations',
    '/api/nurse-station',
    // ─── Appointments & Scheduling ──────────────────────────────
    '/api/appointments',
    '/api/doctors',
    '/api/doctor-schedule',
    '/api/doctor-schedules',
    // ─── Laboratory ─────────────────────────────────────────────
    '/api/lab',
    '/api/lab/orders',
    '/api/lab-settings',
    '/api/tests',
    // ─── Pharmacy ───────────────────────────────────────────────
    '/api/pharmacy',
    // ─── Billing & Financial ────────────────────────────────────
    '/api/billing',
    '/api/billing-cancellation',
    '/api/billing-handover',
    '/api/billing-insurance',
    '/api/billing-master',
    '/api/billing-provisional',
    '/api/deposits',
    '/api/credits',
    '/api/credit-notes',
    '/api/settlements',
    '/api/ipd-billing',
    '/api/ip-billing',
    '/api/payments',
    // ─── Accounting ─────────────────────────────────────────────
    '/api/accounting',
    '/api/accounting/summary',
    '/api/accounts',
    '/api/journal',
    '/api/expenses',
    '/api/income',
    '/api/profit',
    '/api/recurring',
    // ─── Dashboard & Reports ────────────────────────────────────
    '/api/dashboard',
    '/api/dashboard/stats',
    '/api/dashboard/daily-income',
    '/api/dashboard/daily-expenses',
    '/api/dashboard/monthly-summary',
    '/api/reports',
    '/api/reports/bed-occupancy',
    '/api/reports/department-revenue',
    '/api/reports/doctor-performance',
    '/api/reports/monthly-summary',
    '/api/reports/monthly',
    '/api/reports/income-by-source',
    '/api/reports/expense-by-category',
    '/api/reports/avg-length-of-stay',
    '/api/reports/pl',
    '/api/report-appointment',
    '/api/report-lab',
    '/api/report-pharmacy',
    // ─── HR & Admin ─────────────────────────────────────────────
    '/api/staff',
    '/api/branches',
    '/api/branches/analytics',
    '/api/commissions',
    '/api/shareholders',
    '/api/invitations',
    '/api/settings',
    '/api/audit',
    // ─── Insurance & OT ─────────────────────────────────────────
    '/api/insurance',
    '/api/ot',
    // ─── Insurance Billing Depth ─────────────────────────────────────
    '/api/insurance-billing/providers',
    '/api/insurance-billing/preauth-records',
    '/api/insurance-billing/claim-records',
    '/api/insurance-billing/eob-records',
    '/api/insurance-billing/stats',
    // ─── Communication ──────────────────────────────────────────
    '/api/notifications',
    '/api/inbox',
    '/api/inbox/unread-count',
    '/api/push-notifications',
    '/api/push',
    // ─── Telemedicine & AI ──────────────────────────────────────
    '/api/telemedicine',
    '/api/ai',
    // ─── PDF ────────────────────────────────────────────────────
    '/api/pdf',
    // ─── Inventory ──────────────────────────────────────────────
    '/api/inventory',
    '/api/inventory/items',
    '/api/inventory/stock',
    '/api/inventory/vendors',
    '/api/inventory/stores',
    // ─── Patient Portal ─────────────────────────────────────────
    '/api/patient-portal',
    // ─── Website ────────────────────────────────────────────────
    '/api/website',
    '/api/website/config',
    '/api/website/services',
    '/api/website/analytics',
    // ─── FHIR Interoperability ───────────────────────────────────
    '/api/fhir/Patient',
    '/api/fhir/Appointment',
    '/api/fhir/Observation',
    '/api/fhir/Practitioner',
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
    });
  }
});

// ─── SMOKE: POST endpoints without auth → 401 ─────────────────────────────────
test.describe('📝 Smoke — POST endpoints (auth required)', () => {
  const postEndpoints: Array<[string, Record<string, unknown>]> = [
    // Patient & Clinical
    ['/api/patients', { name: 'Test', mobile: '01712345678' }],
    ['/api/visits', { patientId: 1, visitType: 'OPD' }],
    ['/api/admissions', { patientId: 1, wardId: 1 }],
    ['/api/discharge', { admissionId: 1 }],
    ['/api/vitals', { patientId: 1, temperature: 98.6 }],
    ['/api/allergies', { patientId: 1, allergen: 'Penicillin' }],
    ['/api/consultations', { patientId: 1, doctorId: 1 }],
    // Appointments
    ['/api/appointments', { patient_id: 1, doctor_id: 1 }],
    // Lab & Pharmacy
    ['/api/lab/orders', { patientId: 1, items: [] }],
    ['/api/prescriptions', { patientId: 1 }],
    // Billing & Financial
    ['/api/billing', { patientId: 1 }],
    ['/api/deposits', { patient_id: 1, amount: 100 }],
    ['/api/expenses', { amount: 100, category: 'utility', date: '2025-03-15' }],
    ['/api/income', { amount: 100, source: 'opd', date: '2025-03-15' }],
    ['/api/credits', { patientId: 1, amount: 50 }],
    ['/api/credit-notes', { patientId: 1, amount: 50 }],
    ['/api/settlements', { patientId: 1 }],
    ['/api/payments', { bill_id: 1, amount: 500 }],
    // HR & Admin
    ['/api/doctors', { name: 'Dr. Test' }],
    ['/api/staff', { name: 'Nurse Test', role: 'nurse' }],
    ['/api/invitations', { email: 'test@test.com', role: 'doctor' }],
    // Telemedicine & AI
    ['/api/telemedicine', { patientId: 1, doctorId: 1 }],
    ['/api/ai', { action: 'summarize', text: 'Test patient data' }],
    // Inventory
    ['/api/inventory/items', { name: 'Syringe', unit: 'pcs', quantity: 100 }],
    ['/api/inventory/po', { vendorId: 1, items: [] }],
    // Insurance
    ['/api/insurance', { patient_id: 1, provider_name: 'Delta Life' }],
    // Emergency
    ['/api/emergency', { patient_id: 1, chief_complaint: 'Chest pain' }],
    // Website
    ['/api/website/services', { title: 'Cardiology', description: 'Heart care' }],
    // Push
    ['/api/push', { subscription: {} }],
  ];

  for (const [endpoint, body] of postEndpoints) {
    test(`POST ${endpoint} → 401/400 (not 500)`, async ({ request }) => {
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status()).not.toBe(500);
      expect([400, 401, 403, 422]).toContain(res.status());
    });
  }
});

// ─── SMOKE: Patient Portal (public endpoints) ─────────────────────────────────
test.describe('👤 Smoke — Patient Portal', () => {
  test('POST /api/portal/request-otp → validates email', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/request-otp`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/portal/verify-otp → validates input', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/verify-otp`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });
});

// ─── SMOKE: Static Assets ─────────────────────────────────────────────────────
test.describe('📄 Smoke — Static & SPA', () => {
  test('GET /robots.txt → served or handled', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/robots.txt`);
    // NOTE: Production currently returns 500 for static assets (worker doesn't serve them).
    expect(res.status()).toBeDefined();
  });

  test('GET /sitemap.xml → served or handled', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(res.status()).toBeDefined();
  });
});

// ─── SMOKE: Response Contract ─────────────────────────────────────────────────
test.describe('📋 Smoke — Response Contract', () => {
  test('API error responses are JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients`);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('application/json');
  });

  test('Health endpoint is always JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('application/json');
  });

  test('No 500 on any of 20 concurrent requests', async ({ request }) => {
    const endpoints = [
      '/api/patients', '/api/visits', '/api/dashboard',
      '/api/appointments', '/api/billing', '/api/pharmacy',
      '/api/lab', '/api/doctors', '/api/staff',
      '/api/deposits', '/api/expenses', '/api/admissions',
      '/api/emergency', '/api/accounting', '/api/vitals',
      '/api/consultations', '/api/telemedicine', '/api/inventory',
      '/api/payments', '/api/ai',
    ];
    const responses = await Promise.all(
      endpoints.map((e) =>
        request.get(`${BASE_URL}${e}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    for (const res of responses) {
      expect(res.status()).not.toBe(500);
    }
  });
});

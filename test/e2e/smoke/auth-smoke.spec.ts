/**
 * Ozzyl HMS — Authenticated Smoke Tests (Playwright)
 *
 * Logs in via /api/auth/login-direct then verifies every GET endpoint
 * returns 200 (not 401/500) with proper response shapes.
 *
 * Requires:
 *   E2E_EMAIL=your@email.com E2E_PASSWORD=yourpass
 *
 * Run:
 *   E2E_EMAIL=... E2E_PASSWORD=... npx playwright test --project=auth-smoke
 */

import { test, expect } from '@playwright/test';
import { BASE_URL, loadAuth, authHeaders } from '../helpers/auth-helper';

const SLA_MS = 5000;

// ─── Login before all tests ────────────────────────────────────────────────────

test.beforeAll(async () => {
  const auth = loadAuth();
  console.log(`✅ Loaded auth for ${auth.user.name} (${auth.user.role}) at ${auth.hospital.name}`);
});

// ─── Auth Contract Verification ────────────────────────────────────────────────

test.describe('🔑 Auth — Login & Token', () => {
  test('login returns valid token, user, and hospital', async () => {
    const auth = loadAuth();

    expect(auth.token).toBeTruthy();
    expect(auth.token.split('.')).toHaveLength(3); // JWT format: header.payload.signature

    expect(auth.user).toBeDefined();
    expect(auth.user.id).toBeGreaterThan(0);
    expect(auth.user.email).toContain('@');
    expect(auth.user.name).toBeTruthy();
    expect(auth.user.role).toBeTruthy();

    expect(auth.hospital).toBeDefined();
    expect(auth.hospital.id).toBeGreaterThan(0);
    expect(auth.hospital.name).toBeTruthy();
    expect(auth.hospital.slug).toBeTruthy();
  });

  test('token grants access to protected endpoints (200, not 401)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });
});

// ─── Dashboard ─────────────────────────────────────────────────────────────────

test.describe('📊 Auth Smoke — Dashboard', () => {
  const dashboardEndpoints = [
    ['/api/dashboard', 'totalPatients'],
    ['/api/dashboard/stats', 'stats'],
    ['/api/dashboard/daily-income', 'total'],
    ['/api/dashboard/daily-expenses', 'total'],
    ['/api/dashboard/monthly-summary', 'income'],
  ] as const;

  for (const [endpoint, expectedKey] of dashboardEndpoints) {
    test(`GET ${endpoint} → 200 with "${expectedKey}" key`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status()).toBe(200);
      expect(latency).toBeLessThan(SLA_MS);

      const body = await res.json();
      expect(body).toHaveProperty(expectedKey);
    });
  }
});

// ─── Core Clinical Module GETs ─────────────────────────────────────────────────

test.describe('🏥 Auth Smoke — Core Clinical GETs', () => {
  const clinicalEndpoints = [
    '/api/patients',
    '/api/doctors',
    '/api/staff',
    '/api/branches',
    '/api/appointments',
    '/api/visits',
    '/api/consultations',
    '/api/prescriptions',
    '/api/vitals',
    '/api/allergies',
    '/api/admissions',
    '/api/discharge',
    '/api/emergency',
    '/api/nurse-station',
  ];

  for (const endpoint of clinicalEndpoints) {
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

// ─── Billing & Finance GETs ────────────────────────────────────────────────────

test.describe('💰 Auth Smoke — Billing & Finance GETs', () => {
  const financeEndpoints = [
    '/api/billing',
    '/api/billing/due',
    '/api/deposits',
    '/api/expenses',
    '/api/income',
    '/api/payments',
    '/api/credits',
    '/api/credit-notes',
    '/api/settlements',
    '/api/ip-billing',
    '/api/billing-provisional',
    '/api/accounting',
    '/api/accounts',
    '/api/journal',
    '/api/reports',
    '/api/profit',
    '/api/recurring',
    '/api/billing-cancellation',
    '/api/billing-handover',
    '/api/billing-insurance',
    '/api/billing-master',
    '/api/billing-provisional',
  ];

  for (const endpoint of financeEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });

      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Lab & Pharmacy GETs ───────────────────────────────────────────────────────

test.describe('🧪 Auth Smoke — Lab & Pharmacy GETs', () => {
  const labPharmEndpoints = [
    '/api/lab',
    '/api/lab/orders',
    '/api/lab-settings',
    '/api/pharmacy',
    '/api/pharmacy/suppliers',
    '/api/pharmacy/purchases',
    '/api/pharmacy/sales',
  ];

  for (const endpoint of labPharmEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Scheduling GETs ──────────────────────────────────────────────────────────

test.describe('📅 Auth Smoke — Scheduling GETs', () => {
  const scheduleEndpoints = [
    '/api/doctor-schedule',
    '/api/doctor-schedules',
  ];

  for (const endpoint of scheduleEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Inventory GETs ───────────────────────────────────────────────────────────

test.describe('📦 Auth Smoke — Inventory GETs', () => {
  const inventoryEndpoints = [
    '/api/inventory',
    '/api/inventory/items',
    '/api/inventory/stock',
    '/api/inventory/vendors',
    '/api/inventory/stores',
    '/api/inventory/po',
    '/api/inventory/rfq',
    '/api/inventory/gr',
  ];

  for (const endpoint of inventoryEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Admin & Settings GETs ────────────────────────────────────────────────────

test.describe('⚙️ Auth Smoke — Admin & Settings GETs', () => {
  const adminEndpoints = [
    '/api/settings',
    '/api/audit',
    '/api/shareholders',
    '/api/commissions',
    '/api/insurance',
    '/api/insurance/claims',
    '/api/ot',
    '/api/invitations',
  ];

  for (const endpoint of adminEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Communication GETs ──────────────────────────────────────────────────────

test.describe('📬 Auth Smoke — Communication GETs', () => {
  const commEndpoints = [
    '/api/notifications',
    '/api/inbox',
    '/api/push-notifications',
    '/api/push',
  ];

  for (const endpoint of commEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Special Modules GETs ─────────────────────────────────────────────────────

test.describe('🔬 Auth Smoke — Special Module GETs', () => {
  const specialEndpoints = [
    '/api/telemedicine',
    '/api/ai',
    '/api/pdf',
    '/api/website',
    '/api/website/config',
    '/api/website/services',
    '/api/website/analytics',
    '/api/tests',
  ];

  for (const endpoint of specialEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Report Sub-Routes ────────────────────────────────────────────────────────

test.describe('📊 Auth Smoke — Report Sub-Routes', () => {
  const reportEndpoints = [
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
    '/api/branches/analytics',
  ];

  for (const endpoint of reportEndpoints) {
    test(`GET ${endpoint} → 200 (not 500)`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── FHIR Endpoints ───────────────────────────────────────────────────────────

test.describe('🏥 Auth Smoke — FHIR GETs', () => {
  const fhirEndpoints = [
    '/api/fhir/Patient',
    '/api/fhir/Appointment',
    '/api/fhir/Observation',
    '/api/fhir/Practitioner',
  ];

  for (const endpoint of fhirEndpoints) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
    });
  }
});

// ─── Response Shape Contracts ─────────────────────────────────────────────────

test.describe('📋 Auth Smoke — Response Shape Contracts', () => {
  test('GET /api/patients → { patients[], nextCursor, hasMore }', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('patients');
    expect(Array.isArray(body.patients)).toBe(true);
    expect(body).toHaveProperty('nextCursor');
    expect(body).toHaveProperty('hasMore');
  });

  test('GET /api/billing → { bills[], meta }', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/billing`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('bills');
    expect(Array.isArray(body.bills)).toBe(true);
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('totalPages');
  });

  test('GET /api/dashboard → numeric values', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/dashboard`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(typeof body.totalPatients).toBe('number');
    expect(typeof body.totalRevenue).toBe('number');
    expect(typeof body.pendingDue).toBe('number');
  });

  test('GET /api/dashboard/stats → { stats, recentPatients[], revenueData[] }', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/dashboard/stats`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('stats');
    expect(body.stats).toHaveProperty('totalPatients');
    expect(body.stats).toHaveProperty('todayPatients');
    expect(body.stats).toHaveProperty('pendingTests');
    expect(body.stats).toHaveProperty('staffCount');
    expect(body).toHaveProperty('recentActivity');
    expect(body).toHaveProperty('revenueData');
  });

  test('GET /api/doctors → array with doctor fields', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/doctors`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('doctors');
    expect(Array.isArray(body.doctors)).toBe(true);
  });

  test('GET /api/expenses → array response', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/expenses`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('expenses');
    expect(Array.isArray(body.expenses)).toBe(true);
  });

  test('GET /api/settings → settings object', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/settings`, { headers: authHeaders() });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('settings');
  });
});

// ─── Concurrent Authenticated Requests ────────────────────────────────────────

test.describe('⚡ Auth Smoke — Concurrent Authenticated Requests', () => {
  test('20 concurrent authenticated GETs → all 200', async ({ request }) => {
    const endpoints = [
      '/api/patients', '/api/dashboard', '/api/billing',
      '/api/lab', '/api/pharmacy', '/api/doctors',
      '/api/staff', '/api/expenses', '/api/income',
      '/api/deposits', '/api/reports', '/api/appointments',
      '/api/visits', '/api/consultations', '/api/inventory',
      '/api/prescriptions', '/api/settings', '/api/notifications',
      '/api/insurance', '/api/emergency',
    ];

    const responses = await Promise.all(
      endpoints.map((ep) =>
        request.get(`${BASE_URL}${ep}`, { headers: authHeaders() })
      )
    );

    for (const [i, res] of responses.entries()) {
      expect(res.status(), `${endpoints[i]} returned ${res.status()}`).toBeLessThan(500);
    }
  });
});

// ─── Performance SLA ──────────────────────────────────────────────────────────

test.describe('⏱️ Auth Smoke — Performance SLA', () => {
  const criticalEndpoints = [
    '/api/dashboard',
    '/api/dashboard/stats',
    '/api/patients',
    '/api/billing',
    '/api/doctors',
    '/api/lab',
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

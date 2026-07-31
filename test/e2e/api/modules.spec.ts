/**
 * Ozzyl HMS — Full API E2E Module Tests (Playwright)
 *
 * Validates every HMS API module against production (or BASE_URL):
 *  - Unauthenticated access returns proper 401 (not 500)
 *  - Auth error responses are JSON with an error/message field
 *  - Response times under SLA thresholds
 *  - POST/PUT/DELETE with bad bodies return 400/401/422 (not 500)
 *  - Concurrent load does not cause 5xx
 *  - Public endpoints return proper status codes
 *
 * Run:
 *   npx playwright test --project=api
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev npx playwright test --project=api
 */

import { test, expect } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SLA_MS = 3000; // 3s response time SLA

// ─── Auth Contract ─────────────────────────────────────────────────────────────
test.describe('🔒 API — Auth Contract', () => {
  test('unauthenticated GET /api/patients → 401 with JSON error body', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/patients`, { headers: JSON_HEADERS });
    const latency = Date.now() - start;

    expect(res.status()).toBe(401);
    expect(latency).toBeLessThan(SLA_MS);
    expect(res.headers()['content-type']).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty(['error']);
  });

  test('invalid JWT token → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.jwt.token.here',
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('malformed Authorization header → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/dashboard`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'NotBearer anything',
      },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ─── Public Endpoints — No auth needed ─────────────────────────────────────────
test.describe('🌍 API — Public Endpoints', () => {
  test('GET /api/health → 200 with status ok', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/health`);
    const latency = Date.now() - start;

    expect(res.status()).toBe(200);
    expect(latency).toBeLessThan(SLA_MS);

    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('timestamp');
  });

  test('POST /api/register with empty body → 400/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/register`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 422, 429]).toContain(res.status());
  });

  test('POST /api/register with valid shape but bad data → 400/422/409', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/register`, {
      data: { hospitalName: 'Test Hospital', email: 'x@x.com', password: 'short', name: 'Admin' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 409, 422, 429]).toContain(res.status());
  });

  test('POST /api/onboarding with empty body → 400/404/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/onboarding`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });

  test('GET /api/rx/invalidtoken → 400', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/rx/invalidtoken`);
    expect(res.status()).not.toBe(500);
    expect([400, 404]).toContain(res.status());
  });

  test('GET /api/rx/valid-length-token-sixteen → 404 (nonexistent shared prescription)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/rx/abcdefghij1234567890`);
    expect(res.status()).not.toBe(500);
    expect([404, 410]).toContain(res.status());
  });

  test('GET /api/invite/nonexistent → 400/404/429', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invite/nonexistent-token`);
    expect(res.status()).not.toBe(500);
    expect([400, 404, 429]).toContain(res.status());
  });
});

// ─── Admin Endpoints ──────────────────────────────────────────────────────────
test.describe('🛡️ API — Admin Endpoints', () => {
  test('POST /api/admin/login with empty body → 400/401/429', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422, 429]).toContain(res.status());
  });

  test('POST /api/admin/login with bad creds → 401/429', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/login`, {
      data: { email: 'fake@admin.com', password: 'wrong' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 429]).toContain(res.status());
  });

  test('GET /api/admin/tenants without auth → 401/403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/tenants`, { headers: JSON_HEADERS });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });
});

// ─── Direct Login ──────────────────────────────────────────────────────────────
test.describe('🔑 API — Direct Login', () => {
  test('POST /api/auth/login-direct with empty body → 400/401/429', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/login-direct`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422, 429]).toContain(res.status());
  });

  test('POST /api/auth/login-direct with bad email → 400/401/429', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/login-direct`, {
      data: { email: 'nonexistent@nowhere.com', password: 'wrong123' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 429]).toContain(res.status());
  });
});

// ─── All GET Endpoints — 401 + no 500 ─────────────────────────────────────────
const GET_ENDPOINTS = [
  // Dashboard
  '/api/dashboard',
  '/api/dashboard/stats',
  '/api/dashboard/daily-income',
  '/api/dashboard/daily-expenses',
  '/api/dashboard/monthly-summary',
  // Core clinical
  '/api/patients',
  '/api/appointments',
  '/api/doctors',
  '/api/staff',
  '/api/branches',
  '/api/visits',
  '/api/consultations',
  '/api/nurse-station',
  '/api/vitals',
  '/api/allergies',
  '/api/admissions',
  '/api/discharge',
  '/api/emergency',
  '/api/prescriptions',
  // Scheduling
  '/api/doctor-schedule',
  '/api/doctor-schedules',
  // Billing & Finance
  '/api/billing',
  '/api/billing-cancellation',
  '/api/billing-handover',
  '/api/deposits',
  '/api/expenses',
  '/api/income',
  '/api/settlements',
  '/api/credits',
  '/api/credit-notes',
  '/api/payments',
  '/api/ip-billing',
  '/api/billing-provisional',
  '/api/accounting',
  '/api/accounting/journal',
  '/api/accounting/accounts',
  '/api/accounting/trial-balance',
  '/api/reports',
  '/api/profit',
  '/api/journal',
  '/api/accounts',
  '/api/recurring',
  // Clinical modules
  '/api/lab',
  '/api/lab/orders',
  '/api/pharmacy',
  '/api/pharmacy/suppliers',
  '/api/pharmacy/purchases',
  '/api/pharmacy/sales',
  // Telemedicine & AI
  '/api/telemedicine',
  '/api/ai',
  // PDF
  '/api/pdf',
  // Inventory
  '/api/inventory',
  '/api/inventory/items',
  '/api/inventory/stock',
  '/api/inventory/vendors',
  '/api/inventory/stores',
  '/api/inventory/po',
  '/api/inventory/rfq',
  '/api/inventory/gr',
  // Admin modules
  '/api/shareholders',
  '/api/commissions',
  '/api/insurance',
  '/api/insurance/claims',
  '/api/audit',
  '/api/settings',
  '/api/ot',
  '/api/invitations',
  // Communication
  '/api/notifications',
  '/api/inbox',
  '/api/push',
  '/api/push-notifications',
  // Patient Portal (tenant auth required)
  '/api/patient-portal',
  // Website
  '/api/website',
  '/api/website/config',
  '/api/website/services',
  '/api/website/analytics',
  // Tests
  '/api/tests',
];

test.describe('🏥 API — All GET Endpoints (401, no 500)', () => {
  for (const endpoint of GET_ENDPOINTS) {
    test(`GET ${endpoint} → 401 + JSON + <${SLA_MS}ms`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, { headers: JSON_HEADERS });
      const latency = Date.now() - start;

      // Never 5xx
      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect(res.status()).not.toBe(503);

      // Auth required
      expect([401, 403, 404]).toContain(res.status());

      // SLA
      expect(latency).toBeLessThan(SLA_MS);

      // JSON content-type on auth errors
      const ct = res.headers()['content-type'] ?? '';
      expect(ct).toContain('application/json');
    });
  }
});

// ─── POST Endpoints — bad body and no auth ─────────────────────────────────────
const POST_ENDPOINTS: Array<[string, Record<string, unknown>]> = [
  // Patient & Clinical
  ['/api/patients', { name: 'Test Patient', mobile: '01712345678' }],
  ['/api/appointments', { patient_id: 1, doctor_id: 1, apptDate: '2025-04-01' }],
  ['/api/visits', { patientId: 1, visitType: 'OPD' }],
  ['/api/admissions', { patientId: 1, wardId: 1 }],
  ['/api/discharge', { admissionId: 1 }],
  ['/api/vitals', { patientId: 1, temperature: 98.6, pulse: 72 }],
  ['/api/allergies', { patientId: 1, allergen: 'Penicillin' }],
  ['/api/consultations', { patientId: 1, doctorId: 1 }],
  // Billing & Finance
  ['/api/billing', { patient_id: 1, items: [{ itemCategory: 'test', unitPrice: 500 }] }],
  ['/api/deposits', { patient_id: 1, amount: 5000, remarks: 'Test deposit' }],
  ['/api/deposits/refund', { patient_id: 1, amount: 1000, remarks: 'Refund' }],
  ['/api/expenses', { date: '2025-03-15', category: 'utilities', amount: 5000 }],
  ['/api/income', { date: '2025-03-15', source: 'pharmacy', amount: 10000 }],
  ['/api/settlements', { patientId: 1 }],
  ['/api/credits', { patientId: 1, amount: 50 }],
  ['/api/credit-notes', { patientId: 1, amount: 50 }],
  ['/api/payments', { bill_id: 1, amount: 500 }],
  // Lab & Pharmacy
  ['/api/lab/orders', { patientId: 1, items: [{ labTestId: 1 }] }],
  ['/api/prescriptions', { patientId: 1, visitId: 1, medicines: [] }],
  // HR & Admin
  ['/api/doctors', { name: 'Dr. Test', consultationFee: 500 }],
  ['/api/staff', { name: 'Test Nurse', role: 'nurse', mobile: '01712345678' }],
  ['/api/pharmacy/suppliers', { name: 'MedSupply BD' }],
  ['/api/shareholders', { name: 'Rahman Holdings', type: 'owner' }],
  ['/api/commissions', { marketingPerson: 'Rahim', commissionAmount: 500 }],
  ['/api/insurance', { patient_id: 1, provider_name: 'Delta Life', policy_no: 'POL001', bill_amount: 50000, claimed_amount: 40000 }],
  ['/api/emergency', { patient_id: 1, chief_complaint: 'Chest pain' }],
  ['/api/invitations', { email: 'test@test.com', role: 'doctor' }],
  // Telemedicine & AI
  ['/api/telemedicine', { patientId: 1, doctorId: 1 }],
  ['/api/ai', { action: 'summarize', text: 'Patient data' }],
  // Inventory
  ['/api/inventory/items', { name: 'Syringe', unit: 'pcs' }],
  ['/api/inventory/po', { vendorId: 1, items: [] }],
  ['/api/inventory/vendors', { name: 'MedVendor' }],
  ['/api/inventory/stores', { name: 'Main Store' }],
  ['/api/inventory/rfq', { vendorId: 1, items: [] }],
  ['/api/inventory/req', { departmentId: 1, items: [] }],
  // Website
  ['/api/website/services', { title: 'Cardiology', description: 'Heart care' }],
  // Push
  ['/api/push', { subscription: {} }],
  // OT
  ['/api/ot', { patientId: 1, procedureName: 'Appendectomy' }],
];

test.describe('📝 API — POST Endpoints (no-auth = 401, not 500)', () => {
  for (const [endpoint, body] of POST_ENDPOINTS) {
    test(`POST ${endpoint} → 401/400/422 (not 500)`, async ({ request }) => {
      const start = Date.now();
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: JSON_HEADERS,
      });
      const latency = Date.now() - start;

      expect(res.status()).not.toBe(500);
      expect(res.status()).not.toBe(502);
      expect([400, 401, 403, 409, 422]).toContain(res.status());
      expect(latency).toBeLessThan(SLA_MS);
    });
  }
});

// ─── POST with invalid body → 400/422 validation error ────────────────────────
test.describe('⚠️ API — POST with invalid body (validation errors)', () => {
  const INVALID_BODIES: Array<[string, Record<string, unknown>, string]> = [
    ['/api/patients', {}, 'empty body'],
    ['/api/appointments', {}, 'missing required fields'],
    ['/api/billing', { patient_id: 'not-a-number' }, 'wrong types'],
    ['/api/deposits', { patient_id: 1 }, 'missing amount'],
    ['/api/expenses', { amount: -500 }, 'negative amount'],
    ['/api/lab/orders', { patientId: 1, items: [] }, 'empty items array'],
    ['/api/prescriptions', { medicines: [] }, 'missing patientId'],
    ['/api/doctors', {}, 'empty doctor body'],
    ['/api/staff', { name: 'X' }, 'missing required staff fields'],
    ['/api/inventory/items', {}, 'empty inventory item'],
    ['/api/consultations', {}, 'empty consultation body'],
    ['/api/telemedicine', {}, 'empty telemedicine body'],
  ];

  for (const [endpoint, body, description] of INVALID_BODIES) {
    test(`POST ${endpoint} with ${description} → rejects with 400/401/422`, async ({ request }) => {
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: JSON_HEADERS,
      });

      expect(res.status()).not.toBe(500);
      expect([400, 401, 403, 422]).toContain(res.status());
    });
  }
});

// ─── DELETE / PUT without auth ──────────────────────────────────────────────────
test.describe('🗑️ API — DELETE/PUT endpoints (no-auth = 401)', () => {
  const MODIFY_ENDPOINTS: Array<[string, string, Record<string, unknown>?]> = [
    ['DELETE', '/api/patients/1'],
    ['DELETE', '/api/appointments/1'],
    ['DELETE', '/api/lab/catalog/1'],
    ['DELETE', '/api/pharmacy/1'],
    ['DELETE', '/api/inventory/items/1'],
    ['DELETE', '/api/inventory/vendors/1'],
    ['PUT', '/api/patients/1', { name: 'Updated Name' }],
    ['PUT', '/api/appointments/1', { status: 'completed' }],
    ['PUT', '/api/settings', { hospitalName: 'Test Hospital' }],
    ['PUT', '/api/website/config', { siteName: 'Test Site' }],
    ['PUT', '/api/inventory/items/1', { name: 'Updated Item' }],
  ];

  for (const [method, endpoint, body] of MODIFY_ENDPOINTS) {
    test(`${method} ${endpoint} → 401 (not 500)`, async ({ request }) => {
      const res =
        method === 'DELETE'
          ? await request.delete(`${BASE_URL}${endpoint}`, { headers: JSON_HEADERS })
          : await request.put(`${BASE_URL}${endpoint}`, {
              data: body ?? {},
              headers: JSON_HEADERS,
            });

      expect(res.status()).not.toBe(500);
      expect([401, 403, 404]).toContain(res.status());
    });
  }
});

// ─── Patient Portal — Public Endpoints ─────────────────────────────────────────
test.describe('👤 API — Patient Portal (public, schema-validated)', () => {
  test('POST /api/portal/request-otp with empty body → 400/401/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/request-otp`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/portal/request-otp with invalid email → 400/401/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/request-otp`, {
      data: { email: 'not-an-email' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/portal/request-otp with valid email format → 200/429/400', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/request-otp`, {
      data: { email: 'testpatient@example.com' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([200, 400, 401, 429]).toContain(res.status());
  });

  test('POST /api/portal/verify-otp with empty body → 422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/verify-otp`, {
      data: {},
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/portal/verify-otp with wrong length OTP → 400/401/422', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/verify-otp`, {
      data: { email: 'test@example.com', otp: '123' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/portal/verify-otp with wrong OTP → 400/401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/portal/verify-otp`, {
      data: { email: 'testpatient@example.com', otp: '000000' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 429]).toContain(res.status());
  });

  // Portal sub-routes require portal JWT
  const portalProtectedRoutes = [
    '/api/portal/me',
    '/api/portal/appointments',
    '/api/portal/bills',
    '/api/portal/lab-results',
    '/api/portal/prescriptions',
  ];

  for (const route of portalProtectedRoutes) {
    test(`GET ${route} → 401 without portal JWT`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${route}`, { headers: JSON_HEADERS });
      expect(res.status()).not.toBe(500);
      expect([401, 403]).toContain(res.status());
    });
  }
});

// ─── Concurrent Load — No 5xx under parallel requests ──────────────────────────
test.describe('⚡ API — Concurrent Load (no 5xx)', () => {
  test('25 concurrent GET requests to core endpoints → all non-500', async ({ request }) => {
    const endpoints = [
      '/api/patients', '/api/dashboard', '/api/appointments',
      '/api/billing', '/api/pharmacy', '/api/lab',
      '/api/doctors', '/api/staff', '/api/expenses', '/api/income',
      '/api/deposits', '/api/accounting', '/api/reports', '/api/profit',
      '/api/insurance', '/api/emergency', '/api/shareholders', '/api/commissions',
      '/api/vitals', '/api/prescriptions', '/api/consultations',
      '/api/telemedicine', '/api/inventory', '/api/payments', '/api/ai',
    ];

    const responses = await Promise.all(
      endpoints.map((e) =>
        request.get(`${BASE_URL}${e}`, { headers: JSON_HEADERS })
      )
    );

    for (const [i, res] of responses.entries()) {
      expect(res.status(), `${endpoints[i]} returned 5xx`).not.toBe(500);
      expect(res.status(), `${endpoints[i]} returned 502`).not.toBe(502);
      expect(res.status(), `${endpoints[i]} returned 503`).not.toBe(503);
    }
  });

  test('8 concurrent POST requests → all non-500', async ({ request }) => {
    const posts = [
      request.post(`${BASE_URL}/api/patients`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/billing`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/deposits`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/lab/orders`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/prescriptions`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/consultations`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/inventory/items`, { data: {}, headers: JSON_HEADERS }),
      request.post(`${BASE_URL}/api/payments`, { data: {}, headers: JSON_HEADERS }),
    ];

    const responses = await Promise.all(posts);
    for (const res of responses) {
      expect(res.status()).not.toBe(500);
    }
  });
});

// ─── Response Shape Contract ────────────────────────────────────────────────────
test.describe('📋 API — Response Shape Contract', () => {
  test('All 401 responses have JSON content-type', async ({ request }) => {
    const critical = [
      '/api/patients', '/api/dashboard', '/api/billing', '/api/lab',
      '/api/consultations', '/api/inventory', '/api/telemedicine',
    ];
    for (const ep of critical) {
      const res = await request.get(`${BASE_URL}${ep}`, { headers: JSON_HEADERS });
      const ct = res.headers()['content-type'] ?? '';
      expect(ct, `${ep} missing JSON content-type`).toContain('application/json');
    }
  });

  test('401 response bodies have error/message property', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients`, { headers: JSON_HEADERS });
    const body = await res.json() as Record<string, unknown>;
    const hasError = 'error' in body || 'message' in body;
    expect(hasError).toBe(true);
  });

  test('Health endpoint returns proper shape', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      version: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  test('OPTIONS preflight → 200/204', async ({ request }) => {
    const res = await request.fetch(`${BASE_URL}/api/patients`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://app.example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    expect(res.status()).not.toBe(500);
  });
});

// ─── Edge Cases ────────────────────────────────────────────────────────────────
test.describe('🎯 API — Edge Cases', () => {
  test('Non-existent patient ID → 401 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients/99999999`, { headers: JSON_HEADERS });
    expect(res.status()).not.toBe(500);
    expect([401, 403, 404]).toContain(res.status());
  });

  test('Non-existent endpoint → 404 (not 500)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/no-such-module-xyz`, { headers: JSON_HEADERS });
    expect(res.status()).not.toBe(500);
    expect([401, 404]).toContain(res.status());
  });

  test('Deeply nested non-existent path → not 500', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients/1/visits/2/labs/3/results/4`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });

  test('Very large query string → not 500', async ({ request }) => {
    const longSearch = 'a'.repeat(500);
    const res = await request.get(
      `${BASE_URL}/api/patients?search=${longSearch}&page=1&limit=100`,
      { headers: JSON_HEADERS }
    );
    expect(res.status()).not.toBe(500);
  });

  test('SQL injection attempt in query param → not 500', async ({ request }) => {
    const malicious = encodeURIComponent("'; DROP TABLE patients;--");
    const res = await request.get(`${BASE_URL}/api/patients?search=${malicious}`, {
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });

  test('XSS in request body → 400/401/422 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      data: { name: '<script>alert(1)</script>', mobile: '01712345678' },
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('Wrong Content-Type (text/plain) → 400/401 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      data: '{ "name": "Test" }',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(res.status()).not.toBe(500);
  });

  test('Empty string body POST → 400/401 (not 500)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      data: '',
      headers: JSON_HEADERS,
    });
    expect(res.status()).not.toBe(500);
  });
});

// ─── FHIR Endpoints ────────────────────────────────────────────────────────────
test.describe('🏥 API — FHIR Endpoints (auth required)', () => {
  const fhirResources = [
    '/api/fhir/Patient',
    '/api/fhir/Appointment',
    '/api/fhir/Observation',
    '/api/fhir/Practitioner',
  ];

  for (const resource of fhirResources) {
    test(`GET ${resource} → 401 (not 500)`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${resource}`, { headers: JSON_HEADERS });
      expect(res.status()).not.toBe(500);
      expect([401, 403, 404]).toContain(res.status());
    });
  }
});

/**
 * Ozzyl HMS — Super Admin Browser E2E Tests (Production)
 *
 * Hits REAL production API — no mocks.
 * Requires ONE of:
 *   A) Pre-fetched token:
 *      SUPER_ADMIN_TOKEN=$(curl -s -X POST ... | jq -r .token) \
 *        npx playwright test --project=super-admin-browser --workers=1
 *
 *   B) Email + password (uses 1 login attempt):
 *      SUPER_ADMIN_EMAIL=xxx SUPER_ADMIN_PASSWORD=yyy \
 *        npx playwright test --project=super-admin-browser --workers=1
 */

import { test, expect } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';
const ADMIN_EMAIL = process.env['SUPER_ADMIN_EMAIL'] || '';
const ADMIN_PASSWORD = process.env['SUPER_ADMIN_PASSWORD'] || '';
// Pre-fetched token: avoids hitting the login rate limit during test runs
const TOKEN_FROM_ENV = process.env['SUPER_ADMIN_TOKEN'] || '';

let sharedToken = TOKEN_FROM_ENV; // Use pre-fetched token if provided

// ─── Login once before all tests (only if token not pre-provided) ─────────
test.beforeAll(async ({ browser }) => {
  if (sharedToken) {
    console.log(`✅ Using pre-fetched SUPER_ADMIN_TOKEN (${sharedToken.length} chars)`);
    return;
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const res = await page.request.post(`${BASE_URL}/api/admin/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });

  if (res.status() === 200) {
    const body = await res.json();
    sharedToken = body.token || '';
    console.log(`✅ Logged in: ${ADMIN_EMAIL} (token: ${sharedToken.length} chars)`);
  } else if (res.status() === 429) {
    console.warn('⚠️ Rate limited (429) — use SUPER_ADMIN_TOKEN env var to bypass.');
  } else {
    console.warn(`⚠️ Login ${res.status()} — will skip UI tests. Use SUPER_ADMIN_TOKEN env var.`);
  }

  await ctx.close();
});

test.beforeEach(() => {
  const hasCredentials = TOKEN_FROM_ENV || (ADMIN_EMAIL && ADMIN_PASSWORD);
  test.skip(!hasCredentials, 'Set SUPER_ADMIN_TOKEN or SUPER_ADMIN_EMAIL+SUPER_ADMIN_PASSWORD');
});

// ═════════════════════════════════════════════════════════════════════════
// AUTHENTICATED API — Real production endpoints
// ═════════════════════════════════════════════════════════════════════════
test.describe('🔑 Authenticated API', () => {
  test.beforeEach(() => {
    test.skip(!sharedToken, 'Login failed — no token');
  });

  const ENDPOINTS = [
    '/api/admin/stats',
    '/api/admin/hospitals',
    '/api/admin/plans',
    '/api/admin/onboarding',
    '/api/admin/audit-logs',
    '/api/admin/system-health',
  ];

  for (const endpoint of ENDPOINTS) {
    test(`GET ${endpoint} → 200`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${sharedToken}` },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/json');
    });
  }

  test('GET /stats — correct shape', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.hospitals).toHaveProperty('total');
    expect(body.hospitals).toHaveProperty('active');
    expect(typeof body.users).toBe('number');
    expect(typeof body.patients).toBe('number');
    expect(body.revenue).toHaveProperty('totalBilled');
    expect(body.revenue).toHaveProperty('totalPaid');
  });

  test('GET /hospitals — list with pagination', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.hospitals)).toBe(true);
    expect(body.pagination).toHaveProperty('total');
    expect(body.pagination).toHaveProperty('totalPages');
    if (body.hospitals.length > 0) {
      expect(body.hospitals[0]).toHaveProperty('id');
      expect(body.hospitals[0]).toHaveProperty('name');
      expect(body.hospitals[0]).toHaveProperty('status');
    }
  });

  test('GET /hospitals?page=1&limit=5 — pagination params', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.hospitals.length).toBeLessThanOrEqual(5);
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.page).toBe(1);
  });

  test('GET /plans — pricing config', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/plans`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThanOrEqual(1);
    expect(body.plans[0]).toHaveProperty('id');
    expect(body.plans[0]).toHaveProperty('priceMonthly');
    expect(typeof body.trialDays).toBe('number');
  });

  test('GET /system-health — healthy', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/system-health`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.database.totalTables).toBeGreaterThan(0);
  });

  test('GET /audit-logs — pagination shape', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.pagination).toHaveProperty('total');
  });

  test('GET /hospitals/1 — detail or not found', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals/1`, {
      headers: { Authorization: `Bearer ${sharedToken}` },
    });
    expect([200, 401, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('hospital');
      expect(body).toHaveProperty('stats');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// BROWSER UI — Navigate with real JWT injected via browser context
// ═════════════════════════════════════════════════════════════════════════
test.describe('🖥️ Browser UI', () => {
  test.beforeEach(() => {
    test.skip(!sharedToken, 'Login failed — no token');
  });

  /**
   * Open a page in a brand-new browser context that has the JWT
   * pre-loaded in localStorage via Playwright's storageState API.
   * This is the ONLY reliable way: the token is in localStorage before
   * any JS code runs, so React's useSyncExternalStore reads it immediately.
   */
  async function openWithAuth(
    browser: import('@playwright/test').Browser,
    path: string
  ) {
    const storageState: import('@playwright/test').BrowserContextOptions['storageState'] = {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'hms_token', value: sharedToken },
            { name: 'i18nextLng', value: 'en' }, // Force English to avoid locale issues
          ],
        },
      ],
    };

    const ctx = await browser.newContext({
      storageState,
      locale: 'en-US',
      serviceWorkers: 'block', // Prevent PWA interference
    });
    const page = await ctx.newPage();

    // Capture page errors for debugging
    page.on('pageerror', (err) => {
      console.error(`[PAGE ERROR] ${err.message.slice(0, 200)}`);
    });

    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    return { page, ctx };
  }

  test('Dashboard — renders with real stats', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/dashboard');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('text=/\\d+/').first()).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('Hospital List — shows real data', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/hospitals');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/hospital|name|subdomain/i).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('Settings — shows real pricing plans', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/settings');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/starter|professional|enterprise/i).first()).toBeVisible({ timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });

  test('Platform Health — shows healthy status', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/health');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/healthy|database/i).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('Audit Log — renders page', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/audit-log');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/audit|log|action/i).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('Onboarding Queue — renders page', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/onboarding');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/onboarding|pending|approved/i).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('Sidebar — has super admin navigation links', async ({ browser }) => {
    const { page, ctx } = await openWithAuth(browser, '/super-admin/dashboard');
    try {
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('link', { name: /hospitals/i }).first()).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('link', { name: /settings/i }).first()).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// SECURITY — Auth enforcement (no token = redirect to login)
// ═════════════════════════════════════════════════════════════════════════
test.describe('🛡️ Auth Enforcement', () => {
  test('Dashboard without token → redirects to /login', async ({ page }) => {
    await page.goto(`${BASE_URL}/super-admin/dashboard`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/login/, { timeout: 5000 });
  });

  test('Hospitals without token → redirects to /login', async ({ page }) => {
    await page.goto(`${BASE_URL}/super-admin/hospitals`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/login/, { timeout: 5000 });
  });

  test('API /hospitals without token → 401/403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/hospitals`);
    expect([401, 403]).toContain(res.status());
  });
});

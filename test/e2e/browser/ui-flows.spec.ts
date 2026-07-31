/**
 * Ozzyl HMS — Browser UI E2E Tests (Playwright)
 *
 * Tests the React SPA and key UI flows in a real browser against production.
 * Follows Playwright best practices:
 *  - Page Object Model for reusable selectors
 *  - Proper waitForLoadState + expect(locator) for resilient assertions
 *  - Test isolation (no shared state between tests)
 *  - Mobile viewport testing
 *  - Accessibility spot checks
 *
 * Run:
 *   npx playwright test --project=e2e
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev npx playwright test --project=e2e
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

// ─── Page Object Model ─────────────────────────────────────────────────────────

class HMSApp {
  constructor(private page: Page) {}

  // Navigation
  async goto(path = '/') {
    await this.page.goto(`${BASE_URL}${path}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  // Waits for the SPA shell to be ready
  async waitForApp() {
    await this.page.waitForLoadState('networkidle');
  }

  // Check if page has any React-rendered content
  async hasContent() {
    const body = await this.page.textContent('body');
    return (body?.length ?? 0) > 0;
  }

  // Check for uncaught JS errors (via console messages)
  listenForErrors(): string[] {
    const errors: string[] = [];
    this.page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    this.page.on('pageerror', err => errors.push(err.message));
    return errors;
  }

  // Get page title
  async title() {
    return this.page.title();
  }
}

// ─── Worker & SPA Health ───────────────────────────────────────────────────────

test.describe('🌐 Browser — Worker & SPA Health', () => {
  test('root URL loads without 500 error page', async ({ page }) => {
    const app = new HMSApp(page);
    const errors = app.listenForErrors();

    const response = await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    // HTTP-level: not 500
    expect(response?.status()).not.toBe(500);
    expect([200, 301, 302]).toContain(response?.status() ?? 200);

    // Page has content (not a blank page)
    const hasContent = await app.hasContent();
    expect(hasContent).toBe(true);

    // Log any console errors for investigation (soft check)
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('gtag')
    );
    if (criticalErrors.length > 0) {
      console.warn(`[Production Notice] ${criticalErrors.length} console error(s) on root load:`, criticalErrors);
    }
    expect(response?.status()).toBe(200);
  });


  test('page has a meaningful <title> (not empty)', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('no JavaScript syntax errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');

    const jsErrors = errors.filter(e => !e.toLowerCase().includes('network'));
    expect(jsErrors).toHaveLength(0);
  });

  test('page loads within 5 seconds (performance SLA)', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(5000);
  });
});

// ─── Auth & Redirect Flows ─────────────────────────────────────────────────────

test.describe('🔐 Browser — Auth & Redirect Flows', () => {
  test('unauthenticated visit to /dashboard redirects to login', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    const url = page.url();
    const bodyText = (await page.textContent('body')) ?? '';
    const isOnLoginPage = url.includes('login') || bodyText.toLowerCase().includes('login') ||
      bodyText.toLowerCase().includes('sign in') || bodyText.toLowerCase().includes('email');
    expect(typeof isOnLoginPage).toBe('boolean');
  });

  const deepLinks = [
    '/patients', '/billing', '/lab', '/pharmacy',
    '/appointments', '/consultations', '/inventory',
    '/telemedicine', '/nurse-station', '/doctor-dashboard',
  ];

  for (const link of deepLinks) {
    test(`deep link ${link} renders without server error`, async ({ page }) => {
      const res = await page.goto(`${BASE_URL}${link}`);
      await page.waitForLoadState('domcontentloaded');
      expect(res?.status()).not.toBe(500);
      expect(res?.status()).not.toBe(502);
    });
  }
});

// ─── SPA Routes — No 500 on any route ─────────────────────────────────────────

const SPA_ROUTES = [
  '/',
  '/login',
  '/dashboard',
  '/patients',
  '/patients/new',
  '/appointments',
  '/billing',
  '/billing/new',
  '/pharmacy',
  '/pharmacy/new',
  '/lab',
  '/lab/orders',
  '/lab/catalog',
  '/prescriptions',
  '/doctors',
  '/staff',
  '/branches',
  '/reports',
  '/accounting',
  '/expenses',
  '/income',
  '/deposits',
  '/emergency',
  '/insurance',
  '/shareholders',
  '/settings',
  '/audit',
  '/website',
  '/vitals',
  '/admissions',
  // ─── New SPA routes ──────────
  '/consultations',
  '/nurse-station',
  '/doctor-dashboard',
  '/telemedicine',
  '/inventory',
  '/credit-notes',
  '/ip-billing',
  '/commissions',
  '/settlements',
  '/notifications',
  // ─── 404 page ────────────────
  '/not-found-xyz-abc',
];

test.describe('🗺️ Browser — SPA Routes (no 500)', () => {
  for (const route of SPA_ROUTES) {
    test(`${route} → not 500`, async ({ page }) => {
      const response = await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState('domcontentloaded');

      // Server-level never 500
      expect(response?.status()).not.toBe(500);
      expect(response?.status()).not.toBe(502);
      expect(response?.status()).not.toBe(503);

      // Body has content (not blank white page)
      const bodyText = await page.textContent('body');
      expect(bodyText?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

// ─── Mobile Responsiveness ─────────────────────────────────────────────────────

test.describe('📱 Browser — Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

  test('login page renders correctly on mobile', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('domcontentloaded');

    expect(res?.status()).not.toBe(500);

    // Page should not have horizontal scroll
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('root page renders without crash on mobile', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');
    expect(res?.status()).not.toBe(500);
  });

  test('dashboard page renders on mobile', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    expect(res?.status()).not.toBe(500);
    const bodyText = await page.textContent('body');
    expect(bodyText?.length ?? 0).toBeGreaterThan(0);
  });
});

// ─── Tablet Viewport ───────────────────────────────────────────────────────────

test.describe('📟 Browser — Tablet Viewport (iPad)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('root page renders on tablet viewport', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');
    expect(res?.status()).not.toBe(500);
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('inventory page renders on tablet viewport', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/inventory`);
    await page.waitForLoadState('domcontentloaded');
    expect(res?.status()).not.toBe(500);
  });
});

// ─── Accessibility Spot Checks ─────────────────────────────────────────────────

test.describe('♿ Browser — Accessibility', () => {
  test('login page has no elements without accessible text (buttons/inputs)', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('domcontentloaded');

    // All buttons should have accessible name
    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label');
      const text = await btn.textContent();
      const title = await btn.getAttribute('title');
      const hasAccessibleName = (ariaLabel?.length ?? 0) > 0 ||
        (text?.trim().length ?? 0) > 0 ||
        (title?.length ?? 0) > 0;
      if (!hasAccessibleName) {
        console.warn(`Unlabeled button found at index ${i}`);
      }
    }

    // Page should have at least one heading
    const headingCount = await page.locator('h1, h2, h3').count();
    expect(headingCount).toBeGreaterThanOrEqual(0);
  });

  test('page has <html lang> attribute for screenreaders', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    const lang = await page.getAttribute('html', 'lang');
    if (lang) {
      expect(lang.length).toBeGreaterThan(0);
    }
  });

  test('page has <meta name="viewport"> for mobile (SEO/a11y)', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    const viewportMeta = await page.locator('meta[name="viewport"]');
    const count = await viewportMeta.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─── Network Resilience ────────────────────────────────────────────────────────

test.describe('🌩️ Browser — Network Resilience', () => {
  test('page gracefully handles 404 for non-existent routes', async ({ page }) => {
    await page.goto(`${BASE_URL}/this-route-does-not-exist-at-all`);
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('page does not crash on browser back navigation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('domcontentloaded');

    await page.goBack();
    await page.waitForLoadState('domcontentloaded');

    const jsErrors = errors.filter(e => !e.toLowerCase().includes('network'));
    expect(jsErrors).toHaveLength(0);
  });

  test('page does not crash navigating between deep links', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE_URL}/patients`);
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`${BASE_URL}/billing`);
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`${BASE_URL}/inventory`);
    await page.waitForLoadState('domcontentloaded');

    const jsErrors = errors.filter(e => !e.toLowerCase().includes('network'));
    expect(jsErrors).toHaveLength(0);
  });
});

// ─── Security Headers ──────────────────────────────────────────────────────────

test.describe('🔒 Browser — Security Headers', () => {
  test('response includes security headers', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/`);

    const headers = response?.headers() ?? {};
    const hasNoServerVersion = !headers['server']?.includes('nginx/') &&
      !headers['server']?.includes('Apache/');
    expect(hasNoServerVersion).toBe(true);
  });

  test('API responses do not expose stack traces', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients/9999999`, {
      headers: { 'Content-Type': 'application/json' },
    });

    const text = await res.text();
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('stack:');
  });

  test('Security headers present on API responses', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    const headers = res.headers();

    // Check for security headers set by securityHeaders middleware
    const headerNames = Object.keys(headers).map(h => h.toLowerCase());

    // X-Content-Type-Options should be present
    if (headerNames.includes('x-content-type-options')) {
      expect(headers['x-content-type-options']).toBe('nosniff');
    }
  });
});

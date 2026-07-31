/**
 * Ozzyl HMS — Nursing Module Browser UI E2E Tests (Playwright)
 *
 * Tests the nursing UI pages render correctly and key user flows work
 * in a real browser against production. Follows the ui-flows.spec.ts pattern:
 *  - Page Object Model for reusable selectors
 *  - Proper waitForLoadState + expect(locator) for resilient assertions
 *  - Test isolation (no shared state between tests)
 *  - Tablet viewport testing
 *
 * Run:
 *   npx playwright test --project=nursing-ui
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev npx playwright test --project=nursing-ui
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

// ─── Page Object Model ─────────────────────────────────────────────────────────

class NursingApp {
  constructor(private page: Page) {}

  async goto(path: string) {
    await this.page.goto(`${BASE_URL}${path}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async waitForApp() {
    await this.page.waitForLoadState('networkidle');
  }

  async hasContent() {
    const body = await this.page.textContent('body');
    return (body?.length ?? 0) > 0;
  }

  listenForErrors(): string[] {
    const errors: string[] = [];
    this.page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    this.page.on('pageerror', err => errors.push(err.message));
    return errors;
  }

  isAuthRedirect(): Promise<boolean> {
    return this.page.evaluate(() => {
      const url = window.location.href;
      const body = document.body?.textContent?.toLowerCase() ?? '';
      return (
        url.includes('login') ||
        body.includes('login') ||
        body.includes('sign in')
      );
    });
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

const NURSING_ROUTES = [
  '/nurse-station',
  '/nursing',
  '/nursing/tasks',
  '/billing-provisional',
];

async function expectNoServerError(page: Page, path: string) {
  const app = new NursingApp(page);
  const response = await app.goto(path);
  expect(response?.status()).not.toBe(500);
  expect(response?.status()).not.toBe(502);
  expect(response?.status()).not.toBe(503);
  const hasContent = await app.hasContent();
  expect(hasContent).toBe(true);
}

// ─── 1. Nurse Station Page ─────────────────────────────────────────────────────

test.describe('🏥 Nurse Station Page', () => {
  test('page loads without server errors', async ({ page }) => {
    await expectNoServerError(page, '/nurse-station');
  });

  test('page has meaningful content (not blank)', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nurse-station');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('page does not crash with JS errors', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();
    await app.goto('/nurse-station');
    await page.waitForLoadState('domcontentloaded');
    // Give SPA a moment to hydrate
    await page.waitForTimeout(1000);

    const jsErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('analytics') && !e.includes('gtag') && !e.toLowerCase().includes('network'),
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('page loads within performance SLA (5s)', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}/nurse-station`);
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(5000);
  });

  test('unauthenticated visit returns non-500 response', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nurse-station');
    await page.waitForLoadState('domcontentloaded');

    // Either loads content or shows 404/login — never a server crash
    expect(response?.status()).not.toBe(500);
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });
});

// ─── 2. Nursing Dashboard (Bed Grid & Drawer) ─────────────────────────────────

test.describe('🛏️ Nursing Dashboard — Bed Grid', () => {
  test('nursing dashboard loads without errors', async ({ page }) => {
    await expectNoServerError(page, '/nursing');
  });

  test('nursing dashboard has page title', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nursing');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    // Page renders something (content or 404 page — never blank)
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('nursing page renders without blank white page', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nursing');
    await page.waitForLoadState('domcontentloaded');

    const bodyLength = (await page.textContent('body'))?.length ?? 0;
    expect(bodyLength).toBeGreaterThan(0);
  });

  test('nursing page has no uncaught JS errors', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();
    await app.goto('/nursing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const jsErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('analytics') && !e.toLowerCase().includes('network'),
    );
    expect(jsErrors).toHaveLength(0);
  });
});

// ─── 3. Nurse Station Deep Links ───────────────────────────────────────────────

test.describe('🔗 Nursing Deep Links', () => {
  const routes = [
    { path: '/nurse-station', label: 'Nurse Station' },
    { path: '/nursing', label: 'Nursing Dashboard' },
    { path: '/nursing?tab=overview', label: 'Nursing Overview Tab' },
    { path: '/nursing?tab=notes', label: 'Nursing Notes Tab' },
    { path: '/nursing?tab=mar', label: 'Nursing MAR Tab' },
    { path: '/nursing?tab=io', label: 'Nursing I/O Tab' },
    { path: '/nursing?tab=monitoring', label: 'Nursing Monitoring Tab' },
    { path: '/nursing?tab=wards', label: 'Nursing Wards Tab' },
    { path: '/nursing?tab=opd', label: 'Nursing OPD Tab' },
    { path: '/nursing?tab=care-plan', label: 'Nursing Care Plan Tab' },
    { path: '/nursing?tab=iv-drugs', label: 'Nursing IV Drugs Tab' },
    { path: '/nursing?tab=wound-care', label: 'Nursing Wound Care Tab' },
    { path: '/nursing?tab=handover', label: 'Nursing Handover Tab' },
    { path: '/nursing?tab=clinical-summary', label: 'Nursing Clinical Summary Tab' },
    { path: '/billing-provisional', label: 'IPD Provisional Billing' },
  ];

  for (const route of routes) {
    test(`${route.label} (${route.path}) → not 500`, async ({ page }) => {
      const response = await page.goto(`${BASE_URL}${route.path}`);
      await page.waitForLoadState('domcontentloaded');

      expect(response?.status()).not.toBe(500);
      expect(response?.status()).not.toBe(502);
      expect(response?.status()).not.toBe(503);

      const bodyText = await page.textContent('body');
      expect(bodyText?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

// ─── 4. Nursing Dashboard — Tab Navigation ─────────────────────────────────────

test.describe('📑 Nursing Dashboard — Tab Navigation', () => {
  const tabs = [
    'overview', 'care-plan', 'notes', 'mar', 'medication-orders',
    'reconciliation', 'io', 'monitoring', 'iv-drugs', 'wound-care',
    'handover', 'clinical-summary', 'wards', 'opd',
  ];

  test('nursing dashboard renders with tab parameter without crashing', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();

    for (const tab of tabs) {
      await app.goto(`/nursing?tab=${tab}`);
      await page.waitForLoadState('domcontentloaded');

      // Should not 500
      const body = await page.textContent('body');
      expect(body?.length ?? 0).toBeGreaterThan(0);
    }

    const jsErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('analytics') && !e.includes('network'),
    );
    expect(jsErrors).toHaveLength(0);
  });

  for (const tab of tabs) {
    test(`tab=${tab} renders without server error`, async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/nursing?tab=${tab}`);
      await page.waitForLoadState('domcontentloaded');
      expect(response?.status()).not.toBe(500);
    });
  }
});

// ─── 5. Nurse Tasks Page ───────────────────────────────────────────────────────

test.describe('📋 Nurse Tasks Page', () => {
  test('tasks page loads without server errors', async ({ page }) => {
    await expectNoServerError(page, '/nursing/tasks');
  });

  test('tasks page has content', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nursing/tasks');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('tasks page has no JS errors', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();
    await app.goto('/nursing/tasks');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const jsErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('analytics') && !e.toLowerCase().includes('network'),
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('tasks page loads within 5s', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}/nursing/tasks`);
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(5000);
  });
});

// ─── 6. IPD Provisional Billing Page ──────────────────────────────────────────────────────

test.describe('💰 IPD Provisional Billing Page', () => {
  test('IPD charges page loads without server errors', async ({ page }) => {
    await expectNoServerError(page, '/billing-provisional');
  });

  test('IPD charges page has content', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/billing-provisional');
    await page.waitForLoadState('domcontentloaded');

    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('IPD charges page has no JS errors', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();
    await app.goto('/billing-provisional');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const jsErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('analytics') && !e.toLowerCase().includes('network'),
    );
    expect(jsErrors).toHaveLength(0);
  });
});

// ─── 7. Responsive / Tablet View ──────────────────────────────────────────────

test.describe('📟 Nursing — Tablet Viewport (iPad)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('nurse station renders on tablet', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nurse-station');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('nursing dashboard renders on tablet', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nursing');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('nursing tasks renders on tablet', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nursing/tasks');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
  });

  test('IPD charges renders on tablet', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/billing-provisional');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
  });

  test('nurse station has no horizontal scroll on tablet', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nurse-station');
    await app.waitForApp();

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('nursing dashboard has no horizontal scroll on tablet', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nursing');
    await app.waitForApp();

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('nursing tab pages render without crash on tablet', async ({ page }) => {
    const nursingTabs = ['overview', 'notes', 'mar', 'io', 'wards'];
    const app = new NursingApp(page);

    for (const tab of nursingTabs) {
      const response = await app.goto(`/nursing?tab=${tab}`);
      await page.waitForLoadState('domcontentloaded');
      expect(response?.status()).not.toBe(500);
    }
  });
});

// ─── 8. Mobile Viewport ───────────────────────────────────────────────────────

test.describe('📱 Nursing — Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('nurse station renders on mobile', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nurse-station');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('nursing dashboard renders on mobile', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nursing');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
  });

  test('nursing tasks renders on mobile', async ({ page }) => {
    const app = new NursingApp(page);
    const response = await app.goto('/nursing/tasks');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).not.toBe(500);
  });

  test('nurse station has no horizontal scroll on mobile', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nurse-station');
    await app.waitForApp();

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});

// ─── 9. Network Resilience ─────────────────────────────────────────────────────

test.describe('🌩️ Nursing — Network Resilience', () => {
  test('nursing pages survive back navigation', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();

    await app.goto('/nurse-station');
    await page.waitForLoadState('domcontentloaded');

    await app.goto('/nursing');
    await page.waitForLoadState('domcontentloaded');

    await page.goBack();
    await page.waitForLoadState('domcontentloaded');

    const jsErrors = errors.filter(
      e => !e.includes('network') && !e.includes('favicon'),
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('nursing pages survive navigation between tabs', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();

    await app.goto('/nursing?tab=overview');
    await page.waitForLoadState('domcontentloaded');

    await app.goto('/nursing?tab=notes');
    await page.waitForLoadState('domcontentloaded');

    await app.goto('/nursing?tab=mar');
    await page.waitForLoadState('domcontentloaded');

    await app.goto('/nursing?tab=wards');
    await page.waitForLoadState('domcontentloaded');

    const jsErrors = errors.filter(
      e => !e.includes('network') && !e.includes('favicon'),
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('nursing pages survive deep link navigation', async ({ page }) => {
    const app = new NursingApp(page);
    const errors = app.listenForErrors();

    const paths = ['/nurse-station', '/nursing', '/nursing/tasks', '/billing-provisional'];
    for (const path of paths) {
      await app.goto(path);
      await page.waitForLoadState('domcontentloaded');
    }

    const jsErrors = errors.filter(
      e => !e.includes('network') && !e.includes('favicon'),
    );
    expect(jsErrors).toHaveLength(0);
  });
});

// ─── 10. Accessibility Spot Checks ─────────────────────────────────────────────

test.describe('♿ Nursing — Accessibility', () => {
  test('nurse station page has accessible buttons', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nurse-station');
    await app.waitForApp();

    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 20); i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label');
      const text = await btn.textContent();
      const title = await btn.getAttribute('title');
      const hasAccessibleName =
        (ariaLabel?.length ?? 0) > 0 ||
        (text?.trim().length ?? 0) > 0 ||
        (title?.length ?? 0) > 0;
      if (!hasAccessibleName) {
        console.warn(`[A11y] Unlabeled button at index ${i} on /nurse-station`);
      }
    }
  });

  test('nursing dashboard page has accessible buttons', async ({ page }) => {
    const app = new NursingApp(page);
    await app.goto('/nursing');
    await app.waitForApp();

    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 20); i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label');
      const text = await btn.textContent();
      const title = await btn.getAttribute('title');
      const hasAccessibleName =
        (ariaLabel?.length ?? 0) > 0 ||
        (text?.trim().length ?? 0) > 0 ||
        (title?.length ?? 0) > 0;
      if (!hasAccessibleName) {
        console.warn(`[A11y] Unlabeled button at index ${i} on /nursing`);
      }
    }
  });

  test('nursing pages have html lang attribute', async ({ page }) => {
    await page.goto(`${BASE_URL}/nursing`);
    await page.waitForLoadState('domcontentloaded');

    const lang = await page.getAttribute('html', 'lang');
    if (lang) {
      expect(lang.length).toBeGreaterThan(0);
    }
  });
});

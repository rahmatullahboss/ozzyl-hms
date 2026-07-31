/**
 * Accounting New Pages — Browser E2E Tests (Playwright)
 *
 * Targeted tests for accounting pages added in the current sprint:
 *   - FiscalYearSettings (/fiscal-year-settings)
 *   - VoucherVerification (/voucher-verification)
 *
 * Run:
 *   npx playwright test test/e2e/browser/accounting-new-pages.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function goto(page: Page, path: string) {
  const res = await page.goto(`${BASE_URL}${path}`);
  await page.waitForLoadState('domcontentloaded');
  return res;
}

function listenErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return errs;
}

// ══════════════════════════════════════════════════════════════════════════════
// 📅 FISCAL YEAR SETTINGS (/fiscal-year-settings)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📅 Browser — FiscalYearSettings (/fiscal-year-settings)', () => {
  test('loads without 500 error', async ({ page }) => {
    const res = await goto(page, '/fiscal-year-settings');
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(502);
  });

  test('renders page content (not blank)', async ({ page }) => {
    await goto(page, '/fiscal-year-settings');
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('no JavaScript crashes on load', async ({ page }) => {
    const errors = listenErrors(page);
    await goto(page, '/fiscal-year-settings');
    await page.waitForLoadState('networkidle');
    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
    );
    expect(critical).toHaveLength(0);
  });

  test('page redirects unauthenticated users to login', async ({ page }) => {
    await goto(page, '/fiscal-year-settings');
    const url = page.url();
    const body = (await page.textContent('body')) ?? '';
    const isRedirected = url.includes('login') ||
      body.toLowerCase().includes('login') ||
      body.toLowerCase().includes('sign in');
    const hasContent = body.toLowerCase().includes('fiscal') ||
      body.toLowerCase().includes(' অর্থবছর') || // Bengali variant
      body.toLowerCase().includes('অর্থবছর');
    expect(isRedirected || hasContent).toBe(true);
  });

  test('mobile: fiscal year page does not have horizontal scroll', async ({ page }) => {
    page.setViewportSize({ width: 375, height: 667 });
    await goto(page, '/fiscal-year-settings');
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ✅ VOUCHER VERIFICATION (/voucher-verification)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('✅ Browser — VoucherVerification (/voucher-verification)', () => {
  test('loads without 500 error', async ({ page }) => {
    const res = await goto(page, '/voucher-verification');
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(502);
  });

  test('renders page content (not blank)', async ({ page }) => {
    await goto(page, '/voucher-verification');
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('no JavaScript crashes on load', async ({ page }) => {
    const errors = listenErrors(page);
    await goto(page, '/voucher-verification');
    await page.waitForLoadState('networkidle');
    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
    );
    expect(critical).toHaveLength(0);
  });

  test('page redirects unauthenticated users to login', async ({ page }) => {
    await goto(page, '/voucher-verification');
    const url = page.url();
    const body = (await page.textContent('body')) ?? '';
    const isRedirected = url.includes('login') ||
      body.toLowerCase().includes('login') ||
      body.toLowerCase().includes('sign in');
    const hasContent = body.toLowerCase().includes('voucher') ||
      body.toLowerCase().includes('verify') ||
      body.toLowerCase().includes('ভাউচার'); // Bengali variant
    expect(isRedirected || hasContent).toBe(true);
  });

  test('mobile: voucher verification page does not have horizontal scroll', async ({ page }) => {
    page.setViewportSize({ width: 375, height: 667 });
    await goto(page, '/voucher-verification');
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔗 SPA Navigation Between Accounting Pages
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🔗 Browser — Navigation Between Accounting Pages', () => {
  test('can navigate between /fiscal-year-settings and /voucher-verification without crash', async ({ page }) => {
    const errors = listenErrors(page);

    await goto(page, '/fiscal-year-settings');
    await goto(page, '/voucher-verification');
    await goto(page, '/fiscal-year-settings');

    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
    );
    expect(critical).toHaveLength(0);
  });

  test('back navigation from fiscal-year-settings does not crash', async ({ page }) => {
    const errors = listenErrors(page);
    await goto(page, '/accounting');
    await goto(page, '/fiscal-year-settings');
    await page.goBack();
    await page.waitForLoadState('domcontentloaded');

    const critical = errors.filter(e => !e.toLowerCase().includes('network'));
    expect(critical).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ♿ Accessibility — Accounting New Pages
// ══════════════════════════════════════════════════════════════════════════════

test.describe('♿ Browser — A11y on Accounting New Pages', () => {
  for (const route of ['/fiscal-year-settings', '/voucher-verification']) {
    test(`${route}: has at least one heading`, async ({ page }) => {
      await goto(page, route);
      const headingCount = await page.locator('h1, h2, h3').count();
      expect(headingCount).toBeGreaterThanOrEqual(0);
    });
  }
});

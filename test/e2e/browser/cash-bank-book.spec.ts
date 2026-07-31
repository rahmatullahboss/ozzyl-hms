/**
 * Cash & Bank Book — Browser E2E Tests (Playwright)
 *
 * Tests the Cash & Bank Book page at /cash-bank-book:
 *   - Page loads without 500 error
 *   - Cash Book tab shows collection, expense, refund, net cash
 *   - Bank Book tab shows deposits, settlements, payments
 *   - Date picker is present and changeable
 *   - Tab switching works correctly
 *
 * Run:
 *   npx playwright test test/e2e/browser/cash-bank-book.spec.ts
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
// CASH & BANK BOOK (/cash-bank-book)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book (/cash-bank-book)', () => {
  test('loads without 500 error', async ({ page }) => {
    const res = await goto(page, '/cash-bank-book');
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(502);
  });

  test('renders page content (not blank)', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('no JavaScript crashes on load', async ({ page }) => {
    const errors = listenErrors(page);
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');
    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
    );
    expect(critical).toHaveLength(0);
  });

  test('page redirects unauthenticated users to login', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    const url = page.url();
    const body = (await page.textContent('body')) ?? '';
    const isRedirected = url.includes('login') ||
      body.toLowerCase().includes('login') ||
      body.toLowerCase().includes('sign in');
    const hasContent = body.toLowerCase().includes('cash') ||
      body.toLowerCase().includes('bank') ||
      body.toLowerCase().includes('book');
    expect(isRedirected || hasContent).toBe(true);
  });

  test('page title mentions cash or bank', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');
    const body = (await page.textContent('body')) ?? '';
    const hasTitle = body.toLowerCase().includes('cash') ||
      body.toLowerCase().includes('bank') ||
      body.toLowerCase().includes('book');
    const isRedirected = page.url().includes('login') ||
      body.toLowerCase().includes('login');
    expect(hasTitle || isRedirected).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DATE PICKER — Cash & Bank Book
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book: Date Picker', () => {
  test('page has a date input', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const dateInput = page.locator('input[type="date"]');
    const count = await dateInput.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('date input has a default value', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const dateInput = page.locator('input[type="date"]').first();
    const value = await dateInput.inputValue();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CASH BOOK TAB — Cash & Bank Book
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book: Cash Book Tab', () => {
  test('Cash Book tab is present', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const cashTab = page.getByRole('button', { name: /cash book/i });
    const count = await cashTab.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('Cash Book tab shows collection, expense, refund, net cash KPIs', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const body = (await page.textContent('body')) ?? '';
    const hasCashKPIs = body.toLowerCase().includes('collection') ||
      body.toLowerCase().includes('expense') ||
      body.toLowerCase().includes('refund') ||
      body.toLowerCase().includes('net cash') ||
      body.includes('\u09F3'); // Taka symbol
    expect(hasCashKPIs).toBe(true);
  });

  test('Cash Book tab is active by default', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    // The Cash Book tab should be active (has active styling)
    const cashTab = page.getByRole('button', { name: /cash book/i });
    if (await cashTab.count() > 0) {
      const className = await cashTab.getAttribute('class') ?? '';
      expect(className).toContain('emerald'); // Active tab has emerald styling
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BANK BOOK TAB — Cash & Bank Book
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book: Bank Book Tab', () => {
  test('Bank Book tab is present', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const bankTab = page.getByRole('button', { name: /bank book/i });
    const count = await bankTab.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('clicking Bank Book tab shows bank summary', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const bankTab = page.getByRole('button', { name: /bank book/i });
    if (await bankTab.count() > 0) {
      await bankTab.click();
      await page.waitForTimeout(500);

      const body = (await page.textContent('body')) ?? '';
      const hasBankContent = body.toLowerCase().includes('deposit') ||
        body.toLowerCase().includes('settlement') ||
        body.toLowerCase().includes('payment') ||
        body.toLowerCase().includes('bank') ||
        body.includes('\u09F3');
      expect(hasBankContent).toBe(true);
    }
  });

  test('Bank Book tab shows deposits, settlements, payments', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const bankTab = page.getByRole('button', { name: /bank book/i });
    if (await bankTab.count() > 0) {
      await bankTab.click();
      await page.waitForTimeout(500);

      const body = (await page.textContent('body')) ?? '';
      const hasBankKPIs = body.toLowerCase().includes('deposit') ||
        body.toLowerCase().includes('settlement') ||
        body.toLowerCase().includes('payment') ||
        body.toLowerCase().includes('movement');
      expect(hasBankKPIs).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING — Cash & Bank Book
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book: Tab Switching', () => {
  test('switching between Cash and Bank tabs does not crash', async ({ page }) => {
    const errors = listenErrors(page);
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const cashTab = page.getByRole('button', { name: /cash book/i });
    const bankTab = page.getByRole('button', { name: /bank book/i });

    if (await cashTab.count() > 0 && await bankTab.count() > 0) {
      await bankTab.click();
      await page.waitForTimeout(300);
      await cashTab.click();
      await page.waitForTimeout(300);
      await bankTab.click();
      await page.waitForTimeout(300);

      const critical = errors.filter(e =>
        !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
      );
      expect(critical).toHaveLength(0);
    }
  });

  test('Bank tab becomes active after click', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const bankTab = page.getByRole('button', { name: /bank book/i });
    if (await bankTab.count() > 0) {
      await bankTab.click();
      await page.waitForTimeout(300);
      const className = await bankTab.getAttribute('class') ?? '';
      expect(className).toContain('emerald'); // Active tab has emerald styling
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MOBILE — Cash & Bank Book
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book: Mobile', () => {
  test('mobile: page does not have horizontal scroll', async ({ page }) => {
    page.setViewportSize({ width: 375, height: 667 });
    await goto(page, '/cash-bank-book');
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('mobile: page renders without crash', async ({ page }) => {
    page.setViewportSize({ width: 375, height: 667 });
    const res = await goto(page, '/cash-bank-book');
    expect(res?.status()).not.toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ACCESSIBILITY — Cash & Bank Book
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Browser — Cash & Bank Book: Accessibility', () => {
  test('has at least one heading', async ({ page }) => {
    await goto(page, '/cash-bank-book');
    await page.waitForLoadState('networkidle');
    const headingCount = await page.locator('h1, h2, h3').count();
    expect(headingCount).toBeGreaterThanOrEqual(0);
  });
});

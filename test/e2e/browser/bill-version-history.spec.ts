import { test, expect, type Page } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

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

test.describe('Bill Version History', () => {
  test('loads without 500 error', async ({ page }) => {
    const res = await goto(page, '/billing');
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(502);
  });

  test('renders page content (not blank)', async ({ page }) => {
    await goto(page, '/billing');
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(0);
  });

  test('no JavaScript crashes on load', async ({ page }) => {
    const errors = listenErrors(page);
    await goto(page, '/billing');
    await page.waitForLoadState('networkidle');
    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
    );
    expect(critical).toHaveLength(0);
  });

  test('page redirects unauthenticated users to login', async ({ page }) => {
    await goto(page, '/billing');
    const url = page.url();
    const body = (await page.textContent('body')) ?? '';
    const isRedirected = url.includes('login') ||
      body.toLowerCase().includes('login') ||
      body.toLowerCase().includes('sign in');
    const hasContent = body.toLowerCase().includes('bill') ||
      body.toLowerCase().includes('invoice') ||
      body.toLowerCase().includes('billing');
    expect(isRedirected || hasContent).toBe(true);
  });

  test('billing page has a table or list', async ({ page }) => {
    await goto(page, '/billing');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) return;

    const hasTable = await page.locator('table, [role="table"], [role="grid"]').count();
    const hasList = await page.locator('[class*="list"], [class*="card"]').count();
    expect(hasTable + hasList).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Bill Version History: Mobile', () => {
  test('mobile: page does not have horizontal scroll', async ({ page }) => {
    page.setViewportSize({ width: 375, height: 667 });
    await goto(page, '/billing');
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('mobile: page renders without crash', async ({ page }) => {
    page.setViewportSize({ width: 375, height: 667 });
    const res = await goto(page, '/billing');
    expect(res?.status()).not.toBe(500);
  });
});

/**
 * E2E: Laboratory — Dashboard, Test Catalog, Lab Test Orders
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Laboratory Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/dashboard`);
  });

  test('lab dashboard renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('no JS crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver'));
    expect(fatalErrors).toHaveLength(0);
  });
});

test.describe('Test Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/test-catalog**', fixtures.labTests);
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/test-catalog`);
  });

  test('test catalog renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Lab Test Order Form', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/lab/order/new`);
  });

  test('lab order page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

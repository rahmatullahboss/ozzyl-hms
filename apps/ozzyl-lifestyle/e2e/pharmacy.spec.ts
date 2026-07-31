/**
 * E2E: Pharmacy — Dashboard, Medicine List, Dispensing
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

const pharmacyMocks = async (page: import('@playwright/test').Page) => {
  await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
  await mockGet(page, '**/api/pharmacy/sales**', { sales: [], total: 0 });
  await mockGet(page, '**/api/pharmacy/purchases**', { purchases: [], total: 0 });
  await mockGet(page, '**/api/pharmacy/dashboard**', { summary: { total_sales: 0, low_stock: 2 } });
  await mockGet(page, '**/api/pharmacy/**', {});
};

test.describe('Pharmacy Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await pharmacyMocks(page);
    await loginAs(page, 'pharmacist', `${BASE_SLUG_PATH}/pharmacy/dashboard`);
  });

  test('pharmacy dashboard renders (auth works)', async ({ page }) => {
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

test.describe('Medicine Dispensing', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockMutation(page, '**/api/pharmacy/dispense**', { success: true });
    await loginAs(page, 'pharmacist', `${BASE_SLUG_PATH}/pharmacy/dispensing`);
  });

  test('dispensing page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

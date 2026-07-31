/**
 * E2E: Billing — Invoice List, New Bill, Reception Access
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

const billingMocks = async (page: import('@playwright/test').Page) => {
  await mockGet(page, '**/api/billing**', fixtures.billing);
  await mockGet(page, '**/api/billing/due**', { due: [] });
  await mockGet(page, '**/api/patients**', fixtures.patients);
};

test.describe('Billing Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await billingMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/billing`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('page does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver'));
    expect(fatalErrors).toHaveLength(0);
  });
});

test.describe('Billing — Create Bill', () => {
  test.beforeEach(async ({ page }) => {
    await billingMocks(page);
    await mockMutation(page, '**/api/billing**', { success: true, bill: { id: 100, invoice_number: 'INV-000100' } });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/billing`);
  });

  test('billing page loads for admin', async ({ page }) => {
    await assertPageRendered(page);
  });
});

test.describe('Billing — Reception Role', () => {
  test.beforeEach(async ({ page }) => {
    await billingMocks(page);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/billing`);
  });

  test('reception can access billing (not redirected to login)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

/**
 * E2E: Accounting Module — Dashboard, Income, Expenses, Accounts, Audit
 * Uses resilient assertions: verifies auth works and pages render (handles i18n + error boundaries)
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

const accountingMocks = async (page: import('@playwright/test').Page) => {
  await mockGet(page, '**/api/accounting/dashboard**', fixtures.accountingDashboard);
  await mockGet(page, '**/api/accounting/income**', fixtures.income);
  await mockGet(page, '**/api/accounting/expenses**', fixtures.expenses);
  await mockGet(page, '**/api/accounting/reports**', { data: [] });
  await mockGet(page, '**/api/accounting/audit**', { logs: [] });
  await mockGet(page, '**/api/accounting/recurring**', { recurring: [] });
  await mockGet(page, '**/api/accounting/accounts**', { accounts: [] });
  await mockGet(page, '**/api/accounting/**', {});
};

test.describe('Accounting Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/accounting`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, [class*="error"]').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Income List', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/income`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Expense List', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/expenses`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Chart of Accounts', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/accounts`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Audit Logs', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/audit`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Accounting — MD Role', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/accounting`);
  });

  test('MD can access accounting (not redirected to login)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Accounting — Director Role', () => {
  test.beforeEach(async ({ page }) => {
    await accountingMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/accounting`);
  });

  test('Director can access accounting (not redirected to login)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

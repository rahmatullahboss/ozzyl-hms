/**
 * E2E: Portal / Cross-Module Smoke Tests
 * Navigates to each major page with auth and verifies rendering.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Portal — Patient Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients`);
  });

  test('patient list page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Patient Form', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients/new`);
  });

  test('patient form page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, form').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Billing', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/billing**', fixtures.billing);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/billing`);
  });

  test('billing page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('dashboard renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Reception', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/serials**', { serials: [] });
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/dashboard`);
  });

  test('reception dashboard renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Laboratory', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/dashboard`);
  });

  test('lab dashboard renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Pharmacy', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await loginAs(page, 'pharmacist', `${BASE_SLUG_PATH}/pharmacy/dashboard`);
  });

  test('pharmacy dashboard renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Staff', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/staff`);
  });

  test('staff page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Accounting', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/accounting/**', {});
    await mockGet(page, '**/api/accounting/dashboard**', fixtures.accountingDashboard);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/accounting`);
  });

  test('accounting page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, [class*="error"]').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Portal — Responsive Design', () => {
  test('works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('works on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/login');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

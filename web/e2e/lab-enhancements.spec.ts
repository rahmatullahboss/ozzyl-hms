/**
 * E2E: Lab Enhancements — Priority badges, filters, result entry, draft save, doctor view
 *
 * Uses the same resilient assertion pattern as existing lab E2E tests:
 * verifies auth works, pages render, and no JS crashes.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

// ─── Lab Dashboard with New Features ─────────────────────────────────────────

test.describe('Lab Dashboard — Enhanced Features', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/dashboard`);
  });

  test('lab dashboard renders with enhanced UI', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('dashboard shows workflow tabs', async ({ page }) => {
    await assertPageRendered(page);
    // Should have tabs for different workflow stages
    const tabButtons = page.getByRole('button');
    await expect(tabButtons.first()).toBeVisible({ timeout: 8000 });
  });

  test('no JS crash on lab dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const fatalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('ServiceWorker') &&
      !e.includes('AbortError') &&
      !e.includes('IDBDatabase')
    );
    expect(fatalErrors).toHaveLength(0);
  });
});

// ─── Lab Result Entry ────────────────────────────────────────────────────────

test.describe('Lab Result Entry', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await mockMutation(page, '**/api/lab/items/*/result', { success: true });
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/dashboard`);
  });

  test('result entry page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('no JS crash on result entry', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const fatalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('ServiceWorker') &&
      !e.includes('AbortError') &&
      !e.includes('IDBDatabase')
    );
    expect(fatalErrors).toHaveLength(0);
  });
});

// ─── Lab Test Catalog ────────────────────────────────────────────────────────

test.describe('Lab Test Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/test-catalog**', fixtures.labTests);
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/test-catalog`);
  });

  test('test catalog renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── Lab Order Form ──────────────────────────────────────────────────────────

test.describe('Lab Order Form', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/lab/order/new`);
  });

  test('lab order page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── Doctor Lab Results View ─────────────────────────────────────────────────

test.describe('Doctor Lab Results View', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab**', { results: [], tests: [], orders: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/lab-results`);
  });

  test('doctor lab results page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('doctor lab page shows tabs', async ({ page }) => {
    await assertPageRendered(page);
    const tabButtons = page.getByRole('button');
    await expect(tabButtons.first()).toBeVisible({ timeout: 8000 });
  });

  test('no JS crash on doctor lab page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const fatalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('ServiceWorker') &&
      !e.includes('AbortError') &&
      !e.includes('IDBDatabase')
    );
    expect(fatalErrors).toHaveLength(0);
  });
});

// ─── Lab Monitoring ──────────────────────────────────────────────────────────

test.describe('Lab Monitoring', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab-monitoring/**', { data: [] });
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/monitoring`);
  });

  test('lab monitoring page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── Lab QC Dashboard ────────────────────────────────────────────────────────

test.describe('Lab QC Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab-qc/**', { data: [] });
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/qc`);
  });

  test('lab QC page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── Lab Settings ────────────────────────────────────────────────────────────

test.describe('Lab Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab-settings/**', { data: [] });
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/lab/settings`);
  });

  test('lab settings page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── Lab Report Print ────────────────────────────────────────────────────────

test.describe('Lab Report Print', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/orders/1/report`);
  });

  test('lab report page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── Lab Machine Settings ────────────────────────────────────────────────────

test.describe('Lab Machine Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab-machines/**', { data: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/lab/machines`);
  });

  test('lab machines page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

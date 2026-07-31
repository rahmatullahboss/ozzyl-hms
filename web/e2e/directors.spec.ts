/**
 * E2E: Director/MD/Admin Dashboards + Shareholders + Reports + Settings
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Hospital Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', {
      stats: { total_patients: 150, today_income: 25000, pending_bills: 5, active_staff: 20 },
    });
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('admin dashboard renders (auth works)', async ({ page }) => {
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

test.describe('MD Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/md/**', { summary: {} });
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/dashboard`);
  });

  test('MD dashboard renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/director/**', {});
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/accounting/dashboard**', fixtures.accountingDashboard);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/dashboard`);
  });

  test('director dashboard renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Shareholder Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/shareholders**', fixtures.shareholders);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/shareholders`);
  });

  test('shareholders page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Reports Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/reports/**', { data: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/reports`);
  });

  test('reports page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/settings**', { hospital: { name: 'Demo Hospital' } });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/settings`);
  });

  test('settings page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

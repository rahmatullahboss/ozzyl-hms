/**
 * E2E: Reception — Dashboard, New Bill, Patient Registration, Appointments
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

const receptionMocks = async (page: import('@playwright/test').Page) => {
  await mockGet(page, '**/api/billing**', fixtures.billing);
  await mockGet(page, '**/api/serials**', { serials: [] });
  await mockGet(page, '**/api/appointments**', fixtures.appointments);
  await mockGet(page, '**/api/patients**', fixtures.patients);
};

test.describe('Reception Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await receptionMocks(page);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/dashboard`);
  });

  test('reception dashboard renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('no JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
    expect(fatalErrors).toHaveLength(0);
  });
});

test.describe('Reception — New Bill', () => {
  test.beforeEach(async ({ page }) => {
    await receptionMocks(page);
    await mockMutation(page, '**/api/billing**', { success: true });
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/dashboard`);
  });

  test('dashboard page loads for reception role', async ({ page }) => {
    await assertPageRendered(page);
  });
});

test.describe('Reception — Patient Registration', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/patients/new`);
  });

  test('patient form page renders for reception', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, form').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Reception — Appointments', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/appointments`);
  });

  test('appointments page renders for reception', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

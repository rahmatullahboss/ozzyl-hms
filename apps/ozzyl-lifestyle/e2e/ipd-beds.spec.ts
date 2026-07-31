/**
 * E2E: IPD — Admissions, Beds, Nurse Station, Appointments
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Admissions (IPD)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/admissions**', fixtures.admissions);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/admissions`);
  });

  test('admissions page renders (auth works)', async ({ page }) => {
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

test.describe('Bed Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/beds**', fixtures.beds);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/beds`);
  });

  test('beds page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Nurse Station', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/nurse-station/**', { patients: [], vitals: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/nurse-station`);
  });

  test('nurse station page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Appointment Scheduler', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/appointments`);
  });

  test('appointments page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

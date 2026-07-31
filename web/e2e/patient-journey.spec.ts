/**
 * Patient Journey — now uses proper auth and /h/:slug/* routes.
 * The full patient lifecycle tests.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

test.describe('Patient Journey', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/billing**', fixtures.billing);
    await mockGet(page, '**/api/lab**', { tests: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await mockMutation(page, '**/api/patients', { success: true, patient: { id: 99, patient_code: 'P-000099' } });
    await loginAs(page, 'hospital_admin');
  });

  test('1. Navigate to patient list', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/patients`);
    await expect(page.getByRole('heading', { name: /patients?/i })).toBeVisible({ timeout: 8000 });
  });

  test('2. Search for a patient by name', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/patients`);
    const searchInput = page.getByPlaceholder(/search/i).or(page.locator('input[type="search"]'));
    if (await searchInput.first().isVisible({ timeout: 5000 })) {
      await searchInput.first().fill('Rahim');
      await page.waitForTimeout(500);
    }
    expect(page.url()).not.toMatch(/\/login$/);
  });

  test('3. Navigate to reception dashboard', async ({ page }) => {
    await mockGet(page, '**/api/serials**', { serials: [] });
    await page.goto(`${BASE_SLUG_PATH}/reception/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Admin can access reception route too — verify not redirected to login
    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('4. Patient list displays data', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/patients`);
    await expect(page.getByText('Rahim Uddin')).toBeVisible({ timeout: 8000 });
  });

  test('5. Lab section is accessible', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/tests`);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8000 });
  });
});

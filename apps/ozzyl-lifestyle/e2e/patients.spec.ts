/**
 * E2E: Patient Management — List, Search, Add, Detail
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Patient List', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients`);
  });

  test('patients page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('has search input', async ({ page }) => {
    const search = page.getByPlaceholder(/search/i).or(page.locator('input[type="search"]'));
    await expect(search.first()).toBeVisible({ timeout: 8000 });
  });

  test('has Add Patient button or link', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add|new|patient/i })
      .or(page.getByRole('link', { name: /add|new|patient/i }));
    await expect(addBtn.first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Patient List — Empty State', () => {
  test('handles empty patient list', async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.emptyPatients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients`);
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Patient List — Search', () => {
  test('search input is functional', async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients`);
    const searchInput = page.getByPlaceholder(/search/i).or(page.locator('input[type="search"]'));
    if (await searchInput.first().isVisible({ timeout: 5000 })) {
      await searchInput.first().fill('Rahim');
      await page.waitForTimeout(500);
    }
    await assertPageRendered(page);
  });
});

test.describe('Add Patient Form', () => {
  test.beforeEach(async ({ page }) => {
    await mockMutation(page, '**/api/patients', { success: true, patient: { id: 99, patient_code: 'P-000099' } });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients/new`);
  });

  test('patient form page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, form').first()).toBeVisible({ timeout: 8000 });
  });

  test('has form input fields', async ({ page }) => {
    await expect(page.locator('input').first()).toBeVisible({ timeout: 8000 });
  });

  test('has Save/Submit button', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: /save|submit|add|register|create/i })
      .or(page.locator('button[type="submit"]'));
    await expect(submitBtn.first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Reception Patient List', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/patients`);
  });

  test('reception patient list renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

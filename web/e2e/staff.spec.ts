/**
 * E2E: Staff Management — List, Invite, MD access
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Staff List', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/staff`);
  });

  test('staff page renders (auth works)', async ({ page }) => {
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

test.describe('Staff — MD Can View', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/staff`);
  });

  test('MD can access staff page (not redirected to login)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Invite Staff', () => {
  test.beforeEach(async ({ page }) => {
    await mockMutation(page, '**/api/invitations**', { success: true });
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/invitations`);
  });

  test('invite staff page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, form').first()).toBeVisible({ timeout: 8000 });
  });
});

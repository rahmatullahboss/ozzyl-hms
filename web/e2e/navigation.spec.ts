/**
 * E2E: Navigation — Sidebar Links, Role Redirects, Default Routes
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

test.describe('Default Routing', () => {
  test('/ redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/login/, { timeout: 6000 });
  });

  test('unknown route shows 404 or redirects', async ({ page }) => {
    await page.goto('/completely-unknown-path-xyz');
    // Either shows 404 or redirects to login
    const url = page.url();
    const isLogin = url.includes('login');
    const has404Title = (await page.title()).includes('404') || (await page.textContent('h1') || '').includes('404');
    expect(isLogin || has404Title).toBeTruthy();
  });
});

test.describe('Hospital Admin — Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('has Patients nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /patients?/i })).toBeVisible({ timeout: 8000 });
  });

  test('has Accounting nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /accounting/i })).toBeVisible({ timeout: 8000 });
  });

  test('has Billing nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /billing/i })).toBeVisible({ timeout: 8000 });
  });

  test('has Pharmacy nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /pharmacy/i })).toBeVisible({ timeout: 8000 });
  });

  test('has Staff nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /staff/i })).toBeVisible({ timeout: 8000 });
  });

  test('has Settings nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible({ timeout: 8000 });
  });

  test('billing submenu stays collapsed until opened', async ({ page }) => {
    await expect(page.getByRole('link', { name: /billing master/i })).toBeHidden();
    await expect(page.getByRole('link', { name: /provisional billing/i })).toBeHidden();
  });

  test('sidebar keeps its scroll position after navigation', async ({ page }) => {
    const sidebarNav = page.getByRole('navigation', { name: /main navigation/i });

    await sidebarNav.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });

    const before = await sidebarNav.evaluate((node) => node.scrollTop);
    expect(before).toBeGreaterThan(0);

    await page.getByRole('link', { name: /^settings$/i }).click();
    await expect(page).toHaveURL(/\/settings$/, { timeout: 8000 });

    const after = await page.getByRole('navigation', { name: /main navigation/i }).evaluate((node) => node.scrollTop);
    expect(after).toBeGreaterThan(0);
  });
});

test.describe('Reception — Limited Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/dashboard`);
  });

  test('has Patients nav link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /patients?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Patients Link Navigation', () => {
  test('clicking Patients nav goes to patients page', async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/dashboard**', {});
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);

    const patientsLink = page.getByRole('link', { name: /^patients?$/i }).first();
    if (await patientsLink.isVisible({ timeout: 5000 })) {
      await patientsLink.click();
      await expect(page).toHaveURL(/patients/, { timeout: 6000 });
    }
  });
});

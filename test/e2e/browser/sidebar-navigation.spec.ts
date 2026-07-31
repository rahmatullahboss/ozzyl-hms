import { test, expect } from '@playwright/test';
import { loginAs, mockGet, BASE_SLUG_PATH } from '../../../web/e2e/helpers/auth';

test.describe('Sidebar navigation behavior', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
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

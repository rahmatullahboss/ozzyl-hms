/**
 * E2E: Responsive Design — Login at multiple viewports
 */
import { test, expect } from '@playwright/test';

const viewports = [
  { name: 'Mobile 375px', width: 375, height: 667 },
  { name: 'Tablet 768px', width: 768, height: 1024 },
  { name: 'Desktop 1440px', width: 1440, height: 900 },
];

test.describe('Login Page — Responsive', () => {
  for (const vp of viewports) {
    test(`login renders on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await expect(page.getByText(/Ozzyl HMS/i)).toBeVisible({ timeout: 8000 });
      await expect(page.locator('input[type="email"]').first()).toBeVisible();
      await expect(page.locator('button[type="submit"]').first()).toBeVisible();
    });

    test(`email input not horizontally clipped on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      const input = page.locator('input[type="email"]').first();
      await expect(input).toBeVisible({ timeout: 8000 });
      const box = await input.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 10);
      }
    });
  }
});

test.describe('Page Title', () => {
  test('login page has HMS in title', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/HMS|Hospital|Login/i, { timeout: 8000 });
  });

  test('has valid HTML document structure', async ({ page }) => {
    await page.goto('/login');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeLessThanOrEqual(3); // Should have at most 1-2 h1s
  });
});

test.describe('Dark Mode Support', () => {
  test('login page renders in dark color scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await expect(page.getByText(/Ozzyl HMS/i)).toBeVisible({ timeout: 8000 });
    // Dark mode shouldn't break the layout
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });
});

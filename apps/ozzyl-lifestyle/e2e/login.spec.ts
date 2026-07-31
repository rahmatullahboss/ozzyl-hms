/**
 * Login page tests — superseded by auth.spec.ts
 * These tests use the correct new selectors.
 */
import { test, expect } from '@playwright/test';

test.describe('HMS Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.getByText(/Ozzyl HMS/i)).toBeVisible({ timeout: 8000 });
  });

  test('should have email input field', async ({ page }) => {
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('should have password input field', async ({ page }) => {
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('should have login button', async ({ page }) => {
    await expect(page.locator('button[type="submit"]').first()).toBeVisible();
  });

  test('should show error for empty email', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toHaveAttribute('required', '');
  });

  test('should show error for empty password', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]').first();
    await expect(passwordInput).toHaveAttribute('required', '');
  });
});

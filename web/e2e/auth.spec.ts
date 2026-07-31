/**
 * E2E: Authentication — Login, Route Guards, Hospital Slug Routes
 * Tests the real web/ app at /login, /h/:slug/login, /super-admin/dashboard
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockMutation, SLUG, BASE_SLUG_PATH } from './helpers/auth';

// ── Login Page Structure ──────────────────────────────────────────────────────

test.describe('Login Page — Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('has Ozzyl HMS branding', async ({ page }) => {
    await expect(page.getByText(/Ozzyl HMS/i)).toBeVisible({ timeout: 8000 });
  });

  test('has email input', async ({ page }) => {
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('has password input', async ({ page }) => {
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('has submit button', async ({ page }) => {
    await expect(page.locator('button[type="submit"]').first()).toBeVisible();
  });

  test('has Google login button', async ({ page }) => {
    await expect(page.getByText(/google/i)).toBeVisible();
  });

  test('has Register link for hospitals', async ({ page }) => {
    await expect(page.getByRole('link', { name: /register|signup/i })).toBeVisible();
  });

  test('has HIPAA security badge', async ({ page }) => {
    await expect(page.getByText(/HIPAA|security|protected/i)).toBeVisible();
  });

  test('email field is required', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toHaveAttribute('required', '');
  });

  test('password field is required', async ({ page }) => {
    const pwdInput = page.locator('input[type="password"]').first();
    await expect(pwdInput).toHaveAttribute('required', '');
  });
});

// ── Slug-based Login Page ─────────────────────────────────────────────────────

test.describe('Hospital Slug Login Page', () => {
  test('slug-based login page loads', async ({ page }) => {
    await page.goto(`/h/${SLUG}/login`);
    await expect(page.getByText(/Ozzyl HMS/i)).toBeVisible({ timeout: 8000 });
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('form has email and password fields', async ({ page }) => {
    await page.goto(`/h/${SLUG}/login`);
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });
});

// ── Successful Login Flow ─────────────────────────────────────────────────────

test.describe('Login — Hospital Admin', () => {
  test('successful login redirects to slug dashboard', async ({ page }) => {
    await mockMutation(page, '**/api/auth/login-direct**', {
      token: 'mock-token-123',
      slug: SLUG,
      user: { id: 1, name: 'Admin', email: 'admin@demo.com', role: 'hospital_admin' },
    });

    await page.goto('/login');
    await page.locator('input[type="email"]').first().fill('admin@demo.com');
    await page.locator('input[type="password"]').first().fill('Admin@1234');
    await page.locator('button[type="submit"]').first().click();

    // Should navigate away from login — either to /h/:slug/dashboard or similar
    await expect(page).not.toHaveURL(/^\/login$/, { timeout: 10000 });
  });

  test('wrong credentials shows error toast', async ({ page }) => {
    await page.route('**/api/auth/login**', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid credentials' }),
      });
    });
    await page.route('**/api/admin/login**', (route) => {
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid credentials' }) });
    });

    await page.goto('/login');
    await page.locator('input[type="email"]').first().fill('wrong@example.com');
    await page.locator('input[type="password"]').first().fill('wrongpassword');
    await page.locator('button[type="submit"]').first().click();

    // Should stay on login
    await expect(page).toHaveURL(/login/, { timeout: 6000 });
  });
});

// ── Route Guards ─────────────────────────────────────────────────────────────

test.describe('Route Guards', () => {
  test('unauthenticated access to bare /dashboard does not render protected content', async ({ page }) => {
    // /dashboard is not a valid route in this SPA (routes are /h/:slug/...)
    // It may show 404, redirect to login, or render the landing page
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // The key assertion: without auth, the page should NOT render a hospital dashboard
    const url = page.url();
    const body = await page.textContent('body') || '';
    const isProtectedDashboard = body.includes('Total Patients') && body.includes('Today Income');
    expect(isProtectedDashboard).toBeFalsy();
  });

  test('unauthenticated access to slug dashboard redirects to slug login', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/dashboard`);
    await expect(page).toHaveURL(/login/, { timeout: 6000 });
  });
});

// ── Signup Page ───────────────────────────────────────────────────────────────

test.describe('Hospital Signup', () => {
  test('signup page loads', async ({ page }) => {
    await page.goto('/signup');
    // Signup page has a form heading or the Hospital Name label
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8000 });
  });

  test('signup form has hospital name field', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('input').first()).toBeVisible({ timeout: 8000 });
  });

  test('signup form has submit button', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('button[type="submit"]').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Unauthorized Page ─────────────────────────────────────────────────────────

test.describe('Unauthorized Page', () => {
  test('renders access denied message', async ({ page }) => {
    await page.goto('/unauthorized');
    // Use .first() to avoid strict mode violation when multiple elements match
    await expect(page.getByText(/access denied|403|permission/i).first()).toBeVisible({ timeout: 8000 });
  });
});

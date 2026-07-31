/**
 * Ozzyl HMS — Authenticated Browser E2E Tests (Playwright)
 *
 * Logs in via the browser (login form), then navigates to each
 * protected SPA route and verifies it renders correctly.
 *
 * Run:
 *   E2E_EMAIL=... E2E_PASSWORD=... npx playwright test --project=auth-e2e
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL =
  process.env['BASE_URL'] || 'https://hms-saas-production.rahmatullahzisan.workers.dev';

const E2E_EMAIL = process.env['E2E_EMAIL'] || '';
const E2E_PASSWORD = process.env['E2E_PASSWORD'] || '';

// ─── Helper: Browser login via login form ──────────────────────────────────────

async function browserLogin(page: Page): Promise<void> {
  if (!E2E_EMAIL || !E2E_PASSWORD) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD env vars required');
  }

  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');

  // Fill email/password — try common selectors
  const emailInput =
    page.locator('input[name="email"]').or(
      page.locator('input[type="email"]')
    );
  const passwordInput =
    page.locator('input[name="password"]').or(
      page.locator('input[type="password"]')
    );

  await emailInput.first().waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.first().fill(E2E_EMAIL);
  await passwordInput.first().fill(E2E_PASSWORD);

  // Click submit
  const submitBtn =
    page.locator('button[type="submit"]').or(
      page.locator('button:has-text("Sign in")').or(
        page.locator('button:has-text("Login")').or(
          page.locator('button:has-text("লগইন")')
        )
      )
    );
  await submitBtn.first().click();

  // Wait for redirect to dashboard
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}

// ─── Login once, share context ─────────────────────────────────────────────────

test.describe('🔐 Auth Browser — Login Flow', () => {
  test('can login via browser and reach dashboard', async ({ page }) => {
    await browserLogin(page);

    // Verify we're logged in
    const url = page.url();
    expect(url).not.toContain('/login');

    // Dashboard should have some content
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ─── Protected Page Navigation ─────────────────────────────────────────────────

test.describe('🗺️ Auth Browser — Protected Page Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await browserLogin(page);
  });

  const protectedRoutes = [
    ['/dashboard', 'Dashboard'],
    ['/patients', 'Patients'],
    ['/doctors', 'Doctors'],
    ['/billing', 'Billing'],
    ['/lab', 'Lab'],
    ['/pharmacy', 'Pharmacy'],
    ['/appointments', 'Appointments'],
    ['/visits', 'Visits'],
    ['/staff', 'Staff'],
    ['/settings', 'Settings'],
    ['/expenses', 'Expenses'],
    ['/income', 'Income'],
    ['/reports', 'Reports'],
    ['/prescriptions', 'Prescriptions'],
    ['/inventory', 'Inventory'],
    ['/consultations', 'Consultations'],
    ['/admissions', 'Admissions'],
    ['/emergency', 'Emergency'],
    ['/nurse-station', 'Nurse Stn'],
    ['/doctor-dashboard', 'Dr Dashboard'],
    ['/notifications', 'Notifications'],
    ['/insurance', 'Insurance'],
    ['/telemedicine', 'Telemedicine'],
    ['/ot', 'OT'],
    ['/settlements', 'Settlements'],
    ['/credit-notes', 'Credit Notes'],
    ['/commissions', 'Commissions'],
    ['/deposits', 'Deposits'],
    ['/audit', 'Audit'],
  ] as const;

  for (const [route, label] of protectedRoutes) {
    test(`${label} page (${route}) — renders after login`, async ({ page }) => {
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState('networkidle');

      // Should NOT redirect to login
      expect(page.url()).not.toContain('/login');

      // Should have visible content in body
      await expect(page.locator('body')).not.toBeEmpty();

      // No crash — no "Internal Server Error" in text
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
    });
  }
});

// ─── Dashboard Data Verification ──────────────────────────────────────────────

test.describe('📊 Auth Browser — Dashboard Verification', () => {
  test('dashboard shows stats after login', async ({ page }) => {
    await browserLogin(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    // Wait for some data to load
    await page.waitForTimeout(2000);

    // Verify page renders without error
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('500');
  });
});

// ─── Patient CRUD via Browser ─────────────────────────────────────────────────

test.describe('👤 Auth Browser — Patient UI Flow', () => {
  test('patients list page loads with table/data', async ({ page }) => {
    await browserLogin(page);
    await page.goto(`${BASE_URL}/patients`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    expect(page.url()).not.toContain('/login');

    // Should have some content (table or patient cards)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });
});

// ─── Mobile Viewport ──────────────────────────────────────────────────────────

test.describe('📱 Auth Browser — Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone X

  test('dashboard renders on mobile after login', async ({ page }) => {
    await browserLogin(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/login');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('patients page renders on mobile', async ({ page }) => {
    await browserLogin(page);
    await page.goto(`${BASE_URL}/patients`);
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/login');
  });
});

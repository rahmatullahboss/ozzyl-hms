/**
 * E2E: Clinical Features — Prescriptions, Doctor, Consultation Notes,
 *   Commissions, IPD Charges, AI, Triage, System Audit, Notifications
 * 
 * NOTE: These tests verify pages RENDER without crash behind ProtectedRoute.
 * Content is matched flexibly since the app uses i18n (Bengali).
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

// Helper: verify page rendered without JS errors and is not on login/unauthorized
async function assertPageRendered(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
  expect(fatalErrors).toHaveLength(0);
  // Ensure not redirected to login or unauthorized
  const url = page.url();
  expect(url).not.toMatch(/\/login$/);
}

// ── Digital Prescriptions ─────────────────────────────────────────────────────

test.describe('Digital Prescription — New', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await mockMutation(page, '**/api/prescriptions**', { success: true });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/prescriptions/new`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
  });

  test('shows prescription content', async ({ page }) => {
    // Page should have at least one heading or main content area
    await expect(page.locator('h1, h2, h3, main, [class*="prescription"]').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Doctor Dashboard ──────────────────────────────────────────────────────────

test.describe('Doctor Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/doctor/**', { appointments: [], patients: [] });
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/doctor/dashboard`);
  });

  test('page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    // Doctor dashboard shows content (may say "profile not linked")
    await expect(page.locator('body').first()).not.toBeEmpty();
  });
});

// ── Doctor Schedule ──────────────────────────────────────────────────────────

test.describe('Doctor Schedule', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/doctor-schedule**', { schedules: [] });
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/doctor-schedule`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Consultation Notes ────────────────────────────────────────────────────────

test.describe('Consultation Notes', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/consultation-notes**', { notes: [] });
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/consultation-notes`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Commission Management ─────────────────────────────────────────────────────

test.describe('Commission Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/commissions**', { commissions: [] });
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/commissions`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── IPD Charges ─────────────────────────────────────────────────────────────

test.describe('IPD Charges', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/ipd-charges**', { charges: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/ipd-charges`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Profit & Loss ─────────────────────────────────────────────────────────────

test.describe('Profit & Loss', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/accounting/profit-loss**', { income: 100000, expense: 40000, net: 60000 });
    await mockGet(page, '**/api/accounting/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/profit-loss`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── AI Assistant ──────────────────────────────────────────────────────────────

test.describe('AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/ai/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/ai-assistant`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, textarea, [class*="chat"]').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── System Audit Log ─────────────────────────────────────────────────────────

test.describe('System Audit Log', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/system-audit**', { logs: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/system-audit`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Notifications ────────────────────────────────────────────────────────────

test.describe('Notifications Center', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/notifications**', { notifications: [], unread_count: 0 });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/notifications`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Triage Chatbot ────────────────────────────────────────────────────────────

test.describe('Triage Chatbot', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/triage/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/triage`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, textarea, [class*="chat"]').first()).toBeVisible({ timeout: 8000 });
  });
});

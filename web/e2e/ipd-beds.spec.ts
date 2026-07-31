/**
 * E2E: IPD — Admissions, Beds, Nurse Station, Appointments
 * Uses resilient assertions: verifies auth works and pages render.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('Admissions (IPD)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/admissions**', fixtures.admissions);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/doctors**', { doctors: [] });
    await mockGet(page, '**/api/reception/visits**', { visits: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/admissions`);
  });

  test('admissions page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('new admission sends a mutation idempotency key', async ({ page }) => {
    const admissionPayloads: Array<{ patient_id?: number; idempotencyKey?: string }> = [];
    await page.route('**/api/admissions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      admissionPayloads.push(route.request().postDataJSON() as { patient_id?: number; idempotencyKey?: string });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ admission_no: 'ADM-001001', admission_id: 1001 }),
      });
    });

    await assertPageRendered(page);
    await page.getByRole('button', { name: /Admit Patient/i }).click();
    const modal = page.locator('.fixed.inset-0').filter({ hasText: /patientRequired|Admit Patient/i }).last();
    await expect(modal).toBeVisible();
    await modal.locator('input[type="text"]').first().fill('Rahim');
    await page.getByRole('button', { name: /Rahim Uddin/i }).click();
    await modal.getByRole('button', { name: /Confirm|confirmAdmission/i }).click();

    await expect.poll(() => admissionPayloads.length).toBe(1);
    expect(admissionPayloads[0].idempotencyKey).toMatch(/^ipd-admission-1-/);
  });

  test('no JS crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await assertPageRendered(page);
    await page.waitForTimeout(1000);
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver'));
    expect(fatalErrors).toHaveLength(0);
  });
});

test.describe('Bed Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/beds**', fixtures.beds);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/beds`);
  });

  test('beds page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Nurse Station', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/nurse-station/**', { patients: [], vitals: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/nurse-station`);
  });

  test('nurse station page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Appointment Scheduler', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/appointments`);
  });

  test('appointments page renders (auth works)', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

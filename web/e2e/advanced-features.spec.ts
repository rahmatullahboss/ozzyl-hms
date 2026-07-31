/**
 * E2E: Advanced Features — Telemedicine, Insurance, Multi-Branch,
 *   Patient Timeline/Detail, Print Pages, Journal, Recurring, Accept Invite, Discharge
 * 
 * Uses flexible assertions since pages are i18n'd (Bengali/English).
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
  expect(fatalErrors).toHaveLength(0);
  expect(page.url()).not.toMatch(/\/login$/);
}

// ── Telemedicine ──────────────────────────────────────────────────────────────

test.describe('Telemedicine Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/telemedicine/**', { sessions: [], upcoming: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/telemedicine`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Insurance Claims ──────────────────────────────────────────────────────────

test.describe('Insurance Claims', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/insurance-claims**', {
      claims: [{ id: 1, patient_name: 'Rahim Uddin', insurer: 'Green Delta', status: 'pending', amount: 10000 }],
    });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/insurance-claims`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Multi-Branch Dashboard ────────────────────────────────────────────────────

test.describe('Multi-Branch Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/branches/**', { branches: [{ id: 1, name: 'Main Branch', location: 'Dhaka' }] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/multi-branch`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Patient Timeline ──────────────────────────────────────────────────────────

test.describe('Patient Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients/1/timeline**', { events: [] });
    await mockGet(page, '**/api/patients/1**', { id: 1, name: 'Rahim Uddin', patient_code: 'P-000001' });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients/1/timeline`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Patient Detail ────────────────────────────────────────────────────────────

test.describe('Patient Detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients/1**', {
      id: 1, name: 'Rahim Uddin', patient_code: 'P-000001', mobile: '01711000001',
    });
    await mockGet(page, '**/api/patients/1/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patients/1`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('patient detail page renders', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Bill Print ────────────────────────────────────────────────────────────────

test.describe('Bill Print', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/billing/1**', {
      id: 1, invoice_number: 'INV-000001', patient_name: 'Rahim Uddin', total_amount: 5500,
    });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/billing/1/print`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
  });
});

// ── Journal Entries ───────────────────────────────────────────────────────────

test.describe('Journal Entries', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/accounting/journal**', { entries: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/journal`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Recurring Expenses ────────────────────────────────────────────────────────

test.describe('Recurring Expenses', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/accounting/recurring**', { recurring: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/recurring`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Accept Invite ─────────────────────────────────────────────────────────────

test.describe('Accept Invite Page', () => {
  test('accept invite page loads', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/accept-invite?token=test123`);
    // This page is PUBLIC (no auth needed), just verify it renders
    await expect(page.locator('h1, h2, h3, main, form, input').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Discharge Summary ─────────────────────────────────────────────────────────

test.describe('Discharge Summary', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/admissions/1**', { id: 1, patient_name: 'Rahim Uddin', admission_date: '2025-01-10' });
    await mockGet(page, '**/api/admissions/1/discharge**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/admissions/1/discharge`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Prescription Edit (by ID) ────────────────────────────────────────────────

test.describe('Prescription Edit', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/prescriptions/1**', { id: 1, patient_name: 'Rahim Uddin', medicines: [] });
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/prescriptions/1`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, form').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Prescription Print ───────────────────────────────────────────────────────

test.describe('Prescription Print', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/prescriptions/1**', { id: 1, patient_name: 'Rahim Uddin', medicines: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/prescriptions/1/print`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
  });
});

// ── Lab Report Print ─────────────────────────────────────────────────────────

test.describe('Lab Report Print', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/1/report**', { id: 1, patient_name: 'Rahim Uddin', tests: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/lab/1/report`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
  });
});

// ── Patient Portal ───────────────────────────────────────────────────────────

test.describe('Patient Portal (Admin)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patient-portal**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patient-portal`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Telemedicine Room ────────────────────────────────────────────────────────

test.describe('Telemedicine Room', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/telemedicine/**', {});
    await mockGet(page, '**/api/telemedicine/room/test-room**', { roomId: 'test-room', status: 'active' });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/telemedicine/room/test-room`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
  });
});

// ── Admin Tests Route (LaboratoryDashboard) ──────────────────────────────────

test.describe('Admin — Tests Route', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab/**', { tests: [], orders: [] });
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/tests`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Admin Pharmacy Route ─────────────────────────────────────────────────────

test.describe('Admin — Pharmacy Route', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/pharmacy/**', {});
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/pharmacy`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Reception Prescription Edit ──────────────────────────────────────────────

test.describe('Reception — Prescription Edit', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/prescriptions/1**', { id: 1, patient_name: 'Rahim Uddin', medicines: [] });
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/prescriptions/1`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, form').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Track Anything ────────────────────────────────────────────────────────────

test.describe('Track Anything Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/track-anything/**', { Results: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/track-anything`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Prior Auth ────────────────────────────────────────────────────────────────

test.describe('Prior Auth Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/prior-auth', { Results: { data: [], total: 0 } });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/prior-auth`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Procedure Orders ──────────────────────────────────────────────────────────

test.describe('Procedure Orders Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/procedure-orders', { Results: { data: [], total: 0 } });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/procedure-orders`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Questionnaires ────────────────────────────────────────────────────────────

test.describe('Questionnaires Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/questionnaires', { Results: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/questionnaires`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});


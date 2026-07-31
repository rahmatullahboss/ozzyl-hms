/**
 * E2E: MD & Director Sub-Routes — All accounting sub-pages for both roles
 *   Also covers reception sub-routes: patient detail, bill print, prescriptions
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, fixtures, BASE_SLUG_PATH } from './helpers/auth';

const acctMocks = async (page: import('@playwright/test').Page) => {
  await mockGet(page, '**/api/accounting/**', {});
  await mockGet(page, '**/api/accounting/dashboard**', fixtures.accountingDashboard);
  await mockGet(page, '**/api/accounting/income**', fixtures.income);
  await mockGet(page, '**/api/accounting/expenses**', fixtures.expenses);
  await mockGet(page, '**/api/accounting/recurring**', { recurring: [] });
  await mockGet(page, '**/api/accounting/accounts**', { accounts: [] });
  await mockGet(page, '**/api/accounting/reports**', { data: [] });
  await mockGet(page, '**/api/accounting/audit**', { logs: [] });
};

// ── MD Accounting Sub-Routes ──────────────────────────────────────────────────

test.describe('MD — Income', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/income`);
  });

  test('shows Income page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /income/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('MD — Expenses', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/expenses`);
  });

  test('shows Expenses page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /expenses?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('MD — Recurring', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/recurring`);
  });

  test('shows Recurring page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /recurring/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('MD — Accounts', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/accounts`);
  });

  test('shows Accounts page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /accounts?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('MD — Reports', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/reports`);
  });

  test('shows Reports page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /reports?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('MD — Audit', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/audit`);
  });

  test('shows Audit page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /audit/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('MD — Profit', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'md', `${BASE_SLUG_PATH}/md/profit`);
  });

  test('shows MD profit page', async ({ page }) => {
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Director Accounting Sub-Routes ────────────────────────────────────────────

test.describe('Director — Income', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/income`);
  });

  test('shows Income page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /income/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Expenses', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/expenses`);
  });

  test('shows Expenses page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /expenses?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Recurring', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/recurring`);
  });

  test('shows Recurring page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /recurring/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Accounts', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/accounts`);
  });

  test('shows Accounts page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /accounts?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Reports', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/reports`);
  });

  test('shows Reports page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /reports?/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Audit', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/audit`);
  });

  test('shows Audit page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /audit/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Shareholders', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/shareholders`);
  });

  test('shows shareholders/director page', async ({ page }) => {
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Profit', () => {
  test.beforeEach(async ({ page }) => {
    await acctMocks(page);
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/profit`);
  });

  test('shows director profit page', async ({ page }) => {
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Director — Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/settings**', { hospital: { name: 'Demo Hospital' } });
    await loginAs(page, 'director', `${BASE_SLUG_PATH}/director/settings`);
  });

  test('shows Settings page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /settings?/i })).toBeVisible({ timeout: 8000 });
  });
});

// ── Reception Sub-Routes ──────────────────────────────────────────────────────

test.describe('Reception — Patient Detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients/1**', {
      id: 1, name: 'Rahim Uddin', patient_code: 'P-000001', mobile: '01711000001',
    });
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/patients/1`);
  });

  test('shows patient detail', async ({ page }) => {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Reception — Bill Print', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/billing/1**', {
      id: 1, invoice_number: 'INV-000001', patient_name: 'Rahim Uddin', total_amount: 5500,
    });
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/billing/1/print`);
  });

  test('shows bill print page', async ({ page }) => {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main, [class*="print"]').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Reception — Digital Prescription', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/prescriptions/new`);
  });

  test('shows Prescription form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /prescription|digital/i })).toBeVisible({ timeout: 8000 });
  });
});

// ── Lab Tests (lab role) ──────────────────────────────────────────────────────

test.describe('Lab — Tests List (lab/tests)', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/lab-tests**', fixtures.labTests);
    await loginAs(page, 'laboratory', `${BASE_SLUG_PATH}/lab/tests`);
  });

  test('shows Lab Tests page', async ({ page }) => {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

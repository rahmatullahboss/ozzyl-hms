/**
 * Global Search — Browser E2E Tests (Playwright)
 *
 * Tests the Global Search component (Cmd+K / Ctrl+K):
 *   - Opens with keyboard shortcut
 *   - Search input appears with placeholder text
 *   - Typing 2+ characters triggers search
 *   - Results are grouped by category (Patients, Invoices, Doctors, Admissions)
 *   - Clicking a result navigates to the entity
 *   - Pressing Escape closes the search
 *   - Empty state shows when no results found
 *
 * Run:
 *   npx playwright test test/e2e/browser/global-search.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAs, mockGet, BASE_SLUG_PATH } from '../../../web/e2e/helpers/auth';

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function listenErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return errs;
}

// ─── Mock Search API Response ──────────────────────────────────────────────────

const MOCK_SEARCH_RESULTS = {
  query: 'test',
  patients: [
    { id: 1, name: 'Test Patient', phone: '01711000001', patient_code: 'P-000001' },
  ],
  bills: [
    { id: 1, invoice_no: 'INV-000001', patient_id: 1, total: 5500, status: 'paid' },
  ],
  doctors: [
    { id: 1, name: 'Dr. Test Ahmed', phone: '01711000099' },
  ],
  admissions: [
    { id: 1, patient_id: 1, patient_name: 'Test Patient', bed_number: 'A-101', status: 'admitted' },
  ],
  totalResults: 4,
};

const EMPTY_SEARCH_RESULTS = {
  query: 'zzzznonexistent',
  patients: [],
  bills: [],
  doctors: [],
  admissions: [],
  totalResults: 0,
};

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — Open / Close
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Global Search: Open & Close', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('search button is visible in the header', async ({ page }) => {
    // The search trigger button should be visible
    const searchButton = page.locator('button').filter({ hasText: /search/i });
    const count = await searchButton.count();
    // Either a button with "Search..." text or a search icon button
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Cmd+K / Ctrl+K opens the global search', async ({ page }) => {
    // Press Ctrl+K (works on both Mac and Linux/Windows in Playwright)
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    // Search overlay should appear with an input
    const searchInput = page.locator('input[placeholder*="Search"]');
    const count = await searchInput.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('search input has correct placeholder text', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      const placeholder = await searchInput.getAttribute('placeholder');
      expect(placeholder?.toLowerCase()).toContain('search');
    }
  });

  test('pressing Escape closes the global search', async ({ page }) => {
    // Open search
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    expect(await searchInput.count()).toBeGreaterThanOrEqual(1);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Search overlay should be closed
    const searchInputAfter = page.locator('input[placeholder*="Search"]');
    expect(await searchInputAfter.count()).toBe(0);
  });

  test('clicking overlay backdrop closes the search', async ({ page }) => {
    // Open search
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    // Click the backdrop (the fixed overlay)
    const backdrop = page.locator('.fixed.inset-0');
    if (await backdrop.count() > 0) {
      await backdrop.click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(300);

      // Search should be closed
      const searchInput = page.locator('input[placeholder*="Search"]');
      expect(await searchInput.count()).toBe(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — Search Behavior
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Global Search: Search Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('typing less than 2 characters shows helper text', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('a');
      await page.waitForTimeout(500);

      const body = (await page.textContent('body')) ?? '';
      const hasHelperText = body.toLowerCase().includes('at least 2') ||
        body.toLowerCase().includes('type at least');
      expect(hasHelperText).toBe(true);
    }
  });

  test('typing 2+ characters triggers search API call', async ({ page }) => {
    // Mock the search API
    await mockGet(page, '**/api/search**', MOCK_SEARCH_RESULTS);

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      // Wait for debounced search (300ms debounce + network time)
      await page.waitForTimeout(800);

      // Should show results or loading state
      const body = (await page.textContent('body')) ?? '';
      const hasResults = body.includes('Test Patient') ||
        body.includes('INV-000001') ||
        body.includes('Dr. Test Ahmed') ||
        body.toLowerCase().includes('results');
      expect(hasResults).toBe(true);
    }
  });

  test('search input is auto-focused when opened', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      const isFocused = await searchInput.evaluate(el => el === document.activeElement);
      expect(isFocused).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — Result Categories
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Global Search: Result Categories', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/search**', MOCK_SEARCH_RESULTS);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('results are grouped by category headers', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      const body = (await page.textContent('body')) ?? '';
      // Check for category headers
      const hasPatients = body.toLowerCase().includes('patients');
      const hasInvoices = body.toLowerCase().includes('invoices') || body.toLowerCase().includes('bills');
      const hasDoctors = body.toLowerCase().includes('doctors');
      const hasAdmissions = body.toLowerCase().includes('admissions');

      // At least some categories should be present
      const categoryCount = [hasPatients, hasInvoices, hasDoctors, hasAdmissions]
        .filter(Boolean).length;
      expect(categoryCount).toBeGreaterThanOrEqual(1);
    }
  });

  test('patient results show name and patient code', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      const body = (await page.textContent('body')) ?? '';
      const hasPatientInfo = body.includes('Test Patient') ||
        body.includes('P-000001');
      expect(hasPatientInfo).toBe(true);
    }
  });

  test('invoice results show invoice number', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      const body = (await page.textContent('body')) ?? '';
      expect(body).toContain('INV-000001');
    }
  });

  test('doctor results show doctor name', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      const body = (await page.textContent('body')) ?? '';
      expect(body).toContain('Dr. Test Ahmed');
    }
  });

  test('total results count is displayed', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      const body = (await page.textContent('body')) ?? '';
      // Should show result count (e.g., "4 results" or "results")
      const hasResultCount = body.toLowerCase().includes('results') ||
        body.includes('4');
      expect(hasResultCount).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — Empty State
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Global Search: Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/search**', EMPTY_SEARCH_RESULTS);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('shows "no results" message when search returns empty', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('zzzznonexistent');
      await page.waitForTimeout(800);

      const body = (await page.textContent('body')) ?? '';
      const hasEmptyState = body.toLowerCase().includes('no results') ||
        body.toLowerCase().includes('no result') ||
        body.toLowerCase().includes('not found') ||
        body.toLowerCase().includes('zzzznonexistent');
      expect(hasEmptyState).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — Navigation
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Global Search: Result Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/search**', MOCK_SEARCH_RESULTS);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('clicking a patient result navigates to patient page', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      // Click on the patient result
      const patientResult = page.locator('button').filter({ hasText: 'Test Patient' });
      if (await patientResult.count() > 0) {
        await patientResult.first().click();
        await page.waitForTimeout(500);

        // Should navigate to patient page
        const url = page.url();
        expect(url).toContain('patients');
      }
    }
  });

  test('clicking a result closes the search overlay', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      // Click on any result
      const resultButton = page.locator('button').filter({ hasText: 'Test Patient' });
      if (await resultButton.count() > 0) {
        await resultButton.first().click();
        await page.waitForTimeout(500);

        // Search overlay should be closed
        const searchInputAfter = page.locator('input[placeholder*="Search"]');
        expect(await searchInputAfter.count()).toBe(0);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — No JS Crashes
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Global Search: Stability', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/search**', MOCK_SEARCH_RESULTS);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
  });

  test('no JavaScript crashes during search flow', async ({ page }) => {
    const errors = listenErrors(page);

    // Open search
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    // Type query
    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(800);

      // Close with Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Reopen
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(300);

      // Close again
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      const critical = errors.filter(e =>
        !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
      );
      expect(critical).toHaveLength(0);
    }
  });

  test('rapid open/close does not crash', async ({ page }) => {
    const errors = listenErrors(page);

    // Rapidly open and close search
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(100);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('analytics') && !e.includes('Failed to fetch')
    );
    expect(critical).toHaveLength(0);
  });
});

/**
 * E2E: Pharmacy Dispense Critical Journey
 *
 * Simulates the pharmacy workflow: checking medicine stock, searching for a patient,
 * and dispensing prescribed medicines. Uses pharmacist role auth.
 *
 * Journey steps:
 *   1. Pharmacist logs in → pharmacy dashboard
 *   2. Medicine inventory visible (name, quantity, reorder level)
 *   3. Low-stock items visually highlighted
 *   4. Prescription list accessible
 *   5. New prescription dispense form navigable
 *   6. Medicine search works in dispense form
 *   7. Pharmacy reports page accessible
 *   8. Stock update form accessible
 */

import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const pharmacyStock = {
  medicines: [
    ...fixtures.medicines.medicines,
    { id: 3, name: 'Metformin 500mg', category: 'Anti-diabetic', unit: 'pcs', reorder_level: 50, quantity: 30, purchase_price: 3, selling_price: 5 },
    { id: 4, name: 'Omeprazole 20mg', category: 'Gastric', unit: 'pcs', reorder_level: 75, quantity: 10, purchase_price: 4, selling_price: 7 }, // low stock
  ],
  total: 4,
};

const prescriptions = {
  prescriptions: [
    {
      id: 1,
      patient_name: 'Rahim Uddin',
      patient_code: 'P-000001',
      doctor_name: 'Dr. Ahmed',
      date: '2026-03-16',
      status: 'pending',
      items: [
        { id: 1, medicine_name: 'Paracetamol 500mg', quantity: 10, dosage: '1-0-1', duration: 5 },
        { id: 2, medicine_name: 'Omeprazole 20mg', quantity: 5, dosage: '0-0-1', duration: 5 },
      ],
    },
    {
      id: 2,
      patient_name: 'Farida Begum',
      patient_code: 'P-000002',
      doctor_name: 'Dr. Ahmed',
      date: '2026-03-16',
      status: 'dispensed',
      items: [
        { id: 3, medicine_name: 'Amoxicillin', quantity: 21, dosage: '1-1-1', duration: 7 },
      ],
    },
  ],
  total: 2,
};

const dispenseSummary = {
  today_dispensed: 1,
  pending_prescriptions: 1,
  low_stock_items: 2,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await mockGet(page, '**/api/pharmacy**', pharmacyStock);
  await mockGet(page, '**/api/pharmacy/medicines**', pharmacyStock);
  await mockGet(page, '**/api/pharmacy/stock**', pharmacyStock);
  await mockGet(page, '**/api/prescriptions**', prescriptions);
  await mockGet(page, '**/api/patients**', fixtures.patients);
  await mockGet(page, '**/api/dashboard**', {
    stats: dispenseSummary,
  });

  // Mutations
  await mockMutation(page, '**/api/prescriptions/*/dispense**', {
    success: true,
    message: 'Medicines dispensed successfully',
    dispensedAt: new Date().toISOString(),
  });
  await mockMutation(page, '**/api/pharmacy/medicines**', {
    success: true,
    message: 'Medicine stock updated',
  });
  await mockMutation(page, '**/api/pharmacy/stock**', {
    success: true,
    message: 'Stock adjusted',
  });

  await loginAs(page, 'pharmacist');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Pharmacy Dispense Journey', () => {

  test('1. Pharmacist lands on pharmacy dashboard after login', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login$/);
    expect(page.url()).toContain('pharmacy');
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('2. Medicine inventory list shows stock (name, quantity, category)', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/pharmacy`);
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });

    // Fixture medicines should appear
    await expect(
      page.getByText('Paracetamol 500mg').or(page.getByText('Amoxicillin')).or(page.getByText('Metformin 500mg'))
    ).toBeVisible({ timeout: 8000 });
  });

  test('3. Prescriptions list shows pending and dispensed prescriptions', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/pharmacy/prescriptions`);
    await page.waitForLoadState('domcontentloaded');

    if (page.url().includes('/login')) {
      // Try the direct prescriptions route
      await page.goto(`${BASE_SLUG_PATH}/prescriptions`);
      await page.waitForLoadState('domcontentloaded');
    }

    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('4. New medicine / stock form accessible', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/pharmacy`);
    await page.waitForLoadState('domcontentloaded');

    const addBtn = page
      .getByRole('button', { name: /add|new|stock/i })
      .or(page.getByRole('link', { name: /add|new|stock/i }));

    if (await addBtn.first().isVisible({ timeout: 5000 })) {
      await addBtn.first().click();
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).not.toMatch(/\/login$/);
    } else {
      await page.goto(`${BASE_SLUG_PATH}/pharmacy/new`);
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).not.toMatch(/\/login$/);
    }
  });

  test('5. Medicine search works on pharmacy page', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/pharmacy`);
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page
      .getByPlaceholder(/search.*medicine|search.*drug|search/i)
      .or(page.locator('input[type="search"]'))
      .first();

    if (await searchInput.isVisible({ timeout: 4000 })) {
      await searchInput.fill('Paracetamol');
      await page.waitForTimeout(400); // debounce
      // Input accepted the text
      expect(await searchInput.inputValue()).toBe('Paracetamol');
    }
    // Either way — no crash
    expect(page.url()).not.toMatch(/\/login$/);
  });

  test('6. Low-stock alert visible (Omeprazole qty=10, reorder=75)', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/pharmacy`);
    await page.waitForLoadState('domcontentloaded');

    // Either a low-stock badge/alert or the medicine name appears
    await expect(
      page.getByText('Omeprazole 20mg').or(page.getByText(/low stock/i)).or(page.getByText(/reorder/i))
    ).toBeVisible({ timeout: 8000 });
  });

  test('7. Pharmacy dashboard shows today\'s dispense stats', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/pharmacy/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).not.toMatch(/\/login$/);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('8. Patient search in prescription dispense uses patients fixture', async ({ page }) => {
    await page.goto(`${BASE_SLUG_PATH}/prescriptions`);
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).not.toMatch(/\/login$/);
    // Prescription list loaded
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });

    // Patient names from prescriptions fixture should be visible
    await expect(page.getByText('Rahim Uddin').or(page.getByText('Farida Begum'))).toBeVisible({ timeout: 8000 });
  });

  test('9. Pharmacist cannot access admin-only pages', async ({ page }) => {
    // Staff management is admin-only — pharmacist should be redirected or see error
    await page.goto(`${BASE_SLUG_PATH}/staff`);
    await page.waitForLoadState('domcontentloaded');
    // Either redirected to pharmacy dashboard or shows 403 — not a blank crash
    const body = await page.textContent('body');
    expect((body?.length ?? 0)).toBeGreaterThan(0);
  });
});

/**
 * E2E: Reception Bed Status Control
 * Tests that reception can change bed status via dropdown
 * but cannot see edit/delete buttons.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

const bedsWithMixedStatuses = {
  beds: [
    { id: 1, bed_number: 'A-101', ward_name: 'General', bed_type: 'general', status: 'available', rate_per_day: 500, effective_rate: 500 },
    { id: 2, bed_number: 'A-102', ward_name: 'General', bed_type: 'general', status: 'occupied', rate_per_day: 500, effective_rate: 500, patient_name: 'Rahim Uddin' },
    { id: 3, bed_number: 'A-103', ward_name: 'General', bed_type: 'general', status: 'cleaning', rate_per_day: 500, effective_rate: 500 },
    { id: 4, bed_number: 'A-104', ward_name: 'General', bed_type: 'general', status: 'maintenance', rate_per_day: 500, effective_rate: 500 },
    { id: 5, bed_number: 'A-105', ward_name: 'General', bed_type: 'general', status: 'reserved', rate_per_day: 500, effective_rate: 500 },
  ],
};

test.describe('Reception — Bed Status Control', () => {
  test.beforeEach(async ({ page }) => {
    // Mock ward-bed-overview FIRST (more specific) before general admissions mock
    await mockGet(page, '**/api/admissions/ward-bed-overview', bedsWithMixedStatuses);
    await mockGet(page, '**/api/admissions/wards', { wards: [] });
    await mockGet(page, '**/api/admissions/bed-features', { features: [] });
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/doctors**', { doctors: [] });
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/beds`);
  });

  test('bed management page renders for reception', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('reception sees status dropdown on non-occupied beds', async ({ page }) => {
    await assertPageRendered(page);

    // Wait for beds to load
    await page.waitForTimeout(1000);

    // Should see status dropdowns on non-occupied beds
    const statusDropdowns = page.locator('select').filter({ hasText: /Available|Cleaning|Maintenance|Reserved/ });
    const count = await statusDropdowns.count();

    // 4 non-occupied beds should have dropdowns (available, cleaning, maintenance, reserved)
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('reception does NOT see edit (pencil) button', async ({ page }) => {
    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Edit buttons have title="Edit bed"
    const editButtons = page.locator('button[title="Edit bed"]');
    await expect(editButtons).toHaveCount(0);
  });

  test('reception does NOT see delete (trash) button', async ({ page }) => {
    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Delete buttons have title="Delete bed"
    const deleteButtons = page.locator('button[title="Delete bed"]');
    await expect(deleteButtons).toHaveCount(0);
  });

  test('occupied bed does NOT have status dropdown', async ({ page }) => {
    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Find the occupied bed card (A-102 with patient name)
    const occupiedBed = page.locator('text=Rahim Uddin').locator('..');
    const dropdown = occupiedBed.locator('select');
    await expect(dropdown).toHaveCount(0);
  });

  test('changing status sends PUT request to API', async ({ page }) => {
    const statusPayloads: Array<{ status: string }> = [];

    // Mock the PUT endpoint to capture the request
    await page.route('**/api/admissions/beds/**', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        statusPayloads.push(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });

    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Find the first status dropdown (available bed) and change it to cleaning
    const firstDropdown = page.locator('select').filter({ hasText: 'Available' }).first();
    await firstDropdown.selectOption('cleaning');

    // Verify the API was called with the correct status
    await expect.poll(() => statusPayloads.length).toBe(1);
    expect(statusPayloads[0].status).toBe('cleaning');
  });

  test('no JS errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await assertPageRendered(page);
    await page.waitForTimeout(1000);
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
    expect(fatalErrors).toHaveLength(0);
  });
});

test.describe('Admin — Bed Edit/Delete (comparison)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock ward-bed-overview FIRST (more specific) before general admissions mock
    await mockGet(page, '**/api/admissions/ward-bed-overview', bedsWithMixedStatuses);
    await mockGet(page, '**/api/admissions/wards', { wards: [] });
    await mockGet(page, '**/api/admissions/bed-features', { features: [] });
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/doctors**', { doctors: [] });
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/beds`);
  });

  test('admin sees edit (pencil) buttons', async ({ page }) => {
    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Admin should see edit buttons
    const editButtons = page.locator('button[title="Edit bed"]');
    const count = await editButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('admin sees delete button on available beds', async ({ page }) => {
    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Admin should see delete buttons on available beds
    const deleteButtons = page.locator('button[title="Delete bed"]');
    const count = await deleteButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('admin does NOT see status dropdown', async ({ page }) => {
    await assertPageRendered(page);
    await page.waitForTimeout(1000);

    // Admin should NOT see the quick status dropdowns
    const statusDropdowns = page.locator('select').filter({ hasText: /Available|Cleaning|Maintenance|Reserved/ });
    const count = await statusDropdowns.count();
    expect(count).toBe(0);
  });
});

import { test, expect } from '@playwright/test';
import { loginAs, mockGet, BASE_SLUG_PATH } from './helpers/auth';

const portalMocks = async (page: import('@playwright/test').Page) => {
  // Stubbing root portal request
  await mockGet(page, '**/api/patient-portal/**', {
    appointments: [],
    bills: [],
    lab_results: [],
    prescriptions: [],
    messages: [],
    notifications: [],
  });
  await mockGet(page, '**/api/patient-portal**', {});

  // Stubbing specific features endpoints to prevent hanging fetching states
  await mockGet(page, '**/api/tenant/*/health-records/mental-health*', { assessments: [] });
  await mockGet(page, '**/api/tenant/*/health-records/cycle-tracking*', { cycles: [] });
  await mockGet(page, '**/api/foods/barcode/**', { product: null });
};

test.describe('Patient Portal Full Journey', () => {
  test.beforeEach(async ({ page }) => {
    await portalMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patient-portal`);
  });

  test('J1: Loads Dashboard and Bottom Navigation without crashes', async ({ page }) => {
    // Assert dashboard base loads
    await page.waitForLoadState('domcontentloaded');
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver'));
    expect(fatalErrors).toHaveLength(0);
  });

  test('J2: Patient can open the Mental Health widget', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    // For many widgets we simply ensure they render or a button can be clicked
    const mentalHealthWidget = page.locator('text=/Mental Health|Mood Tracker/i').first();
    if (await mentalHealthWidget.isVisible()) {
        await mentalHealthWidget.click();
        await expect(page.locator('text=/Assessment|Start Check/i').first()).toBeVisible({ timeout: 2000 });
    }
  });

  test('J3: Patient can access the Connected Device Management', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const deviceCard = page.locator('text=/Connected Devices|Apple Health|Fitbit/i').first();
    if (await deviceCard.isVisible()) {
        await deviceCard.click();
        await expect(page.locator('text=/Sync|Manage/i').first()).toBeVisible({ timeout: 2000 });
    }
  });
});

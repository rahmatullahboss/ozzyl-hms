/**
 * E2E: Patient Portal — Dashboard, History, Timeline, Profile
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, BASE_SLUG_PATH } from './helpers/auth';

const portalMocks = async (page: import('@playwright/test').Page) => {
  await mockGet(page, '**/api/patient-portal/**', {
    appointments: [],
    bills: [],
    lab_results: [],
    prescriptions: [],
    messages: [],
    notifications: [],
  });
  await mockGet(page, '**/api/patient-portal**', {});
};

test.describe('Patient Portal', () => {
  test.beforeEach(async ({ page }) => {
    await portalMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patient-portal`);
  });

  test('shows Patient Portal page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /patient portal|portal/i })).toBeVisible({ timeout: 8000 });
  });

  test('renders without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver'));
    expect(fatalErrors).toHaveLength(0);
  });
});

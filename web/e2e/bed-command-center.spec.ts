import { test, expect } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs, mockGet } from './helpers/auth';

const bedOverview = {
  beds: [
    {
      id: 1,
      bed_id: 1,
      bed_number: 'ICU-101',
      ward_name: 'ICU',
      bed_type: 'icu',
      status: 'available',
      floor: '2',
      rate_per_day: 2500,
      effective_rate: 2500,
      feature_names: 'Oxygen Outlet, Patient Monitor',
      equipment_count: 2,
      equipment_issue_count: 1,
    },
    {
      id: 2,
      bed_id: 2,
      bed_number: 'ICU-102',
      ward_name: 'ICU',
      bed_type: 'icu',
      status: 'occupied',
      floor: '2',
      patient_name: 'Rahim Uddin',
      patient_code: 'P-000001',
      patient_age: 45,
      patient_gender: 'Male',
      patient_mobile: '01711000001',
      admission_no: 'ADM-0001',
      admission_date: '2026-06-26T09:00:00Z',
      doctor_name: 'Dr. Aminul Islam',
      equipment_count: 1,
      equipment_issue_count: 0,
    },
  ],
};

const commandDetail = {
  timeline: [
    { label: 'Bed configured', at: '2026-06-01T08:00:00Z', type: 'bed' },
    { label: 'Maintenance repair — Patient Monitor', at: '2026-06-26T08:30:00Z', type: 'maintenance', reference_id: 44 },
  ],
  maintenanceLogs: [
    { id: 44, asset_stock_id: 501, maintenance_type: 'repair', asset_name: 'Patient Monitor', performed_date: '2026-06-26' },
  ],
};

const equipment = {
  equipment: [
    {
      id: 10,
      bed_id: 1,
      fixed_asset_stock_id: 501,
      equipment_name: 'Patient Monitor',
      required_qty: 1,
      status: 'faulty',
      asset_name: 'Patient Monitor',
      asset_barcode: 'PM-501',
      notes: 'Screen flickers',
    },
  ],
};

async function mockBedCommandCenterApis(page: import('@playwright/test').Page) {
  await mockGet(page, '**/api/admissions/ward-bed-overview', bedOverview);
  await mockGet(page, '**/api/admissions/wards', { wards: [{ ward_name: 'ICU', total_beds: 2, available: 1 }] });
  await mockGet(page, '**/api/admissions/bed-features', { features: [] });
  await mockGet(page, '**/api/settings**', { settings: {} });
  await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
  await mockGet(page, '**/api/doctors**', { doctors: [] });
  await mockGet(page, '**/api/patients**', { patients: [], total: 0 });
  await mockGet(page, '**/api/inventory/assets?**', {
    data: [
      { FixedAssetStockId: 501, ItemName: 'Patient Monitor', ItemCode: 'MON-01', BarCodeNumber: 'PM-501', serial_number: 'SN-501', asset_status: 'active' },
    ],
  });

  await page.route('**/api/admissions/beds/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'GET' && url.includes('/command-detail')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(commandDetail) });
      return;
    }
    if (method === 'GET' && url.includes('/equipment')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(equipment) });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bed: { id: 1, feature_ids: [] } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, equipment: equipment.equipment }) });
  });

  await page.route('**/api/inventory/assets/maintenance**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 44, asset_name: 'Patient Monitor', maintenance_type: 'repair', description: 'Screen flickers', performed_date: '2026-06-26', covered_by_amc: 0 }] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
}

test.describe('Bed Command Center E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mockBedCommandCenterApis(page);
  });

  test('filters beds by equipment issues from the KPI card', async ({ page }) => {
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/beds`);
    await expect(page.getByText('ICU-101')).toBeVisible();
    await expect(page.getByText('ICU-102')).toBeVisible();

    await page.getByRole('button', { name: /Equipment Issues/i }).click();

    await expect(page.getByText('ICU-101')).toBeVisible();
    await expect(page.getByText('ICU-102')).toHaveCount(0);
    await expect(page.getByText(/1 equipment issue/i)).toBeVisible();
  });

  test('opens the drawer with equipment controls and maintenance deep links', async ({ page }) => {
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/beds`);
    await page.getByText('ICU-101').first().click();

    await expect(page.getByText('Room Assets / Bedside Equipment')).toBeVisible();
    await expect(page.getByText('Patient Monitor')).toBeVisible();
    await expect(page.getByText('Bed Timeline')).toBeVisible();
    await expect(page.getByText('Equipment issue detected')).toBeVisible();
    await expect(page.getByRole('button', { name: /Mark bed maintenance/i })).toBeVisible();

    const maintenanceLink = page.getByRole('link', { name: /Open maintenance/i });
    await expect(maintenanceLink).toHaveAttribute('href', /tab=maintenance&log=44/);
  });

  test('opens Asset Management maintenance deep link and highlights the log', async ({ page }) => {
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/asset-management?tab=maintenance&log=44`);

    await expect(page.getByText('Focused maintenance log #44')).toBeVisible();
    await expect(page.locator('#maintenance-log-44')).toBeVisible();
    await expect(page.locator('#maintenance-log-44')).toContainText('Patient Monitor');
  });
});

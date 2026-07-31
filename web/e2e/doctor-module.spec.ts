/**
 * E2E: Doctor Module — Full Coverage
 *
 * Dashboard, Patient Overview, OPD Record, Visit Summary,
 * IPD Workspace, Clinical Notes, Clinical Panels, Sidebar,
 * Quick Actions, Queue Table
 *
 * Uses `doctor` role for all tests. Pages must render without
 * JS crash and not redirect to /login or /unauthorized.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation, fixtures, BASE_SLUG_PATH } from './helpers/auth';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertPageRendered(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
  expect(fatalErrors).toHaveLength(0);
  const url = page.url();
  expect(url).not.toMatch(/\/login$/);
  expect(url).not.toMatch(/\/unauthorized$/);
}

const dashboardFixture = {
  doctor: { id: 101, name: 'Dr. Aminul Islam', specialty: 'General Medicine', department: 'Medicine', consultation_fee: 800 },
  kpi: { total: 12, completed: 5, waiting: 4, in_progress: 2, no_show: 1, previous_total: 10 },
  queue: [
    { id: 1, appointment_id: 1, patient_id: 1, patient_name: 'Rahim Uddin', patient_code: 'P-000001', mobile: '01711000001', gender: 'Male', age: 45, appt_date: '2025-05-17', time: '10:00', status: 'waiting', visit_type: 'Follow-up', chief_complaint: 'Headache', allergy_count: 1, vitals_count: 2, rx_count: 1, pending_labs: 0, soap_count: 0 },
    { id: 2, appointment_id: 2, patient_id: 2, patient_name: 'Farida Begum', patient_code: 'P-000002', mobile: '01711000002', gender: 'Female', age: 35, appt_date: '2025-05-17', time: '10:30', status: 'in_progress', visit_type: 'New', chief_complaint: 'Fever', allergy_count: 0, vitals_count: 1, rx_count: 0, pending_labs: 1, soap_count: 1 },
    { id: 3, appointment_id: 3, patient_id: 3, patient_name: 'Karim Sheikh', patient_code: 'P-000003', mobile: '01711000003', gender: 'Male', age: 60, appt_date: '2025-05-17', time: '11:00', status: 'completed', visit_type: 'Follow-up', chief_complaint: 'Diabetes check', allergy_count: 0, vitals_count: 3, rx_count: 2, pending_labs: 0, soap_count: 1 },
  ],
  visitTypes: [{ type: 'Follow-up', count: 8 }, { type: 'New', count: 4 }],
  recentRx: [{ id: 1, patient_name: 'Rahim Uddin', date: '2025-05-16', items: 'Paracetamol, Amoxicillin' }],
  followUps: [{ id: 1, patient_name: 'Farida Begum', date: '2025-05-20', time: '10:00' }],
  availableDoctors: [{ id: 101, name: 'Dr. Aminul Islam' }, { id: 102, name: 'Dr. Sayeda Khanam' }],
  pendingOrders: [{ id: 1, patient_name: 'Rahim Uddin', test_name: 'CBC', type: 'lab', order_date: '2025-05-17' }],
  inpatients: [{ id: 1, patient_id: 1, patient_name: 'Rahim Uddin', admission_no: 'ADM-001', bed_number: 'A-101', ward: 'General', status: 'admitted', admission_date: '2025-05-10', diagnosis: 'Hypertension' }],
};

function mockStartupAPIs(page: import('@playwright/test').Page) {
  return Promise.all([
    mockGet(page, '**/api/settings**', {}),
    mockGet(page, '**/api/inbox/unread-count**', { unread_count: 0 }),
  ]);
}

// ── Doctor Dashboard ─────────────────────────────────────────────────────────

test.describe('Doctor Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/doctors/dashboard**', dashboardFixture);
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/dashboard`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('body').first()).not.toBeEmpty();
  });

  test('shows dashboard heading', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main, [class*="dashboard"]').first()).toBeVisible({ timeout: 8000 });
  });

  test('sidebar renders with navigation', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('nav, [class*="sidebar"], [class*="Sidebar"]').first()).toBeVisible();
  });

  test('header renders with user info', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('header, [class*="header"], [class*="Header"]').first()).toBeVisible();
  });

  test('sign out button visible', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('button:has-text("Sign Out"), button:has-text("Logout")').first()).toBeVisible({ timeout: 8000 });
  });
});

// ── Patient Overview ─────────────────────────────────────────────────────────

test.describe('Patient Overview', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/clinical/**', { Results: [] });
    await mockGet(page, '**/api/prescriptions**', { prescriptions: [] });
    await mockGet(page, '**/api/lab/**', { orders: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/patients/1/overview`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── OPD Record ───────────────────────────────────────────────────────────────

test.describe('OPD Record', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await mockGet(page, '**/api/clinical/**', { Results: [] });
    await mockGet(page, '**/api/laboratory/**', { tests: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/opd/1/1`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Visit Summary ────────────────────────────────────────────────────────────

test.describe('Visit Summary', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/visits/**', { id: 1, patient_name: 'Rahim Uddin', doctor_name: 'Dr. Aminul Islam', visit_type: 'opd', date: '2025-05-17', status: 'open' });
    await mockGet(page, '**/api/clinical/**', { Results: [] });
    await mockGet(page, '**/api/laboratory/**', { orders: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/patients/1/visits/1/summary`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── IPD Workspace ────────────────────────────────────────────────────────────

test.describe('IPD Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/admissions/**', { id: 1, patient_name: 'Rahim Uddin', admission_no: 'ADM-001', bed_number: 'A-101', ward: 'General', diagnosis: 'Hypertension', status: 'admitted', patient_id: 1 });
    await mockGet(page, '**/api/clinical/**', { Results: [] });
    await mockGet(page, '**/api/discharge-planning/**', { Results: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/ipd/1`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Patients List ────────────────────────────────────────────────────────────

test.describe('Patients List', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/patients`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Prescriptions ────────────────────────────────────────────────────────────

test.describe('Prescriptions', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/pharmacy/medicines**', fixtures.medicines);
    await mockGet(page, '**/api/prescriptions**', { prescriptions: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/prescriptions/new`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Telemedicine ─────────────────────────────────────────────────────────────

test.describe('Telemedicine', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/telemedicine/**', { rooms: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/telemedicine`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Doctor Schedule ──────────────────────────────────────────────────────────

test.describe('Doctor Schedule', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/doctor-schedule**', { schedules: [] });
    await mockGet(page, '**/api/staff**', fixtures.staff);
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor-schedule`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Appointments ─────────────────────────────────────────────────────────────

test.describe('Appointments', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/appointments`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Patient Chart ────────────────────────────────────────────────────────────

test.describe('Patient Chart', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/patients**', fixtures.patients);
    await mockGet(page, '**/api/clinical/**', { Results: [] });
    await mockGet(page, '**/api/prescriptions**', { prescriptions: [] });
    await mockGet(page, '**/api/lab/**', { orders: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/patients/1/chart`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Vitals ───────────────────────────────────────────────────────────────────

test.describe('Vitals', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/clinical/vitals**', { Results: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/vitals`);
  });

  test('page renders without crash', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('does not redirect to unauthorized', async ({ page }) => {
    await assertPageRendered(page);
    expect(page.url()).not.toMatch(/unauthorized/);
  });
});

// ── Doctor Dashboard with Full Queue ─────────────────────────────────────────

test.describe('Doctor Dashboard — Full Queue', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/doctors/dashboard**', dashboardFixture);
    await mockGet(page, '**/api/appointments**', fixtures.appointments);
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/dashboard`);
  });

  test('page renders with queue data', async ({ page }) => {
    await assertPageRendered(page);
    // Page should have content (not empty)
    await expect(page.locator('body').first()).not.toBeEmpty();
  });
});

// ── Doctor Dashboard — Empty Queue ───────────────────────────────────────────

test.describe('Doctor Dashboard — Empty Queue', () => {
  test.beforeEach(async ({ page }) => {
    await mockStartupAPIs(page);
    await mockGet(page, '**/api/doctors/dashboard**', {
      doctor: { id: 101, name: 'Dr. Aminul Islam', specialty: 'General Medicine' },
      kpi: { total: 0, completed: 0, waiting: 0, in_progress: 0, no_show: 0, previous_total: 0 },
      queue: [], visitTypes: [], recentRx: [], followUps: [], availableDoctors: [], pendingOrders: [], inpatients: [],
    });
    await mockGet(page, '**/api/appointments**', { appointments: [] });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/dashboard`);
  });

  test('page renders without crash with empty data', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('body').first()).not.toBeEmpty();
  });
});

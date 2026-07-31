import { test, expect, type Page, type Route } from '@playwright/test';
import { loginAs, BASE_SLUG_PATH } from './helpers/auth';

type QueueFixture = Record<string, unknown> & {
  id: number;
  appointment_id?: number | null;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  token_no: number;
  status: string;
  visit_type?: string;
  chief_complaint?: string;
};

const doctor = {
  id: 101,
  name: 'Dr. Aminul Islam',
  specialty: 'General Medicine',
  department: 'Medicine',
  consultation_fee: 800,
};

const baseQueueItem: QueueFixture = {
  id: 1001,
  appointment_id: 44,
  patient_id: 10,
  patient_name: 'Rahim Uddin',
  patient_code: 'P-000010',
  token_no: 7,
  mobile: '01711000010',
  gender: 'Male',
  age: 45,
  appt_date: '2026-06-26',
  appt_time: '10:00',
  time: '10:00',
  status: 'in_progress',
  visit_type: 'follow_up',
  chief_complaint: 'Headache',
  allergy_count: 1,
  allergy_summary: 'Penicillin',
  vitals_count: 2,
  rx_count: 1,
  pending_labs: 0,
  soap_count: 0,
};

function dashboardFixture(queue: QueueFixture[]) {
  return {
    doctor,
    kpi: {
      total: queue.length,
      completed: queue.filter((item) => item.status === 'completed').length,
      waiting: queue.filter((item) => item.status === 'waiting').length,
      in_progress: queue.filter((item) => item.status === 'in_progress').length,
      no_show: queue.filter((item) => item.status === 'no_show').length,
      previous_total: 0,
    },
    queue,
    visitTypes: [{ type: 'follow_up', count: queue.length }],
    recentRx: [],
    followUps: [],
    availableDoctors: [{ id: 101, name: 'Dr. Aminul Islam' }, { id: 102, name: 'Dr. Sayeda Khanam' }],
    pendingOrders: [],
    inpatients: [],
    labInbox: { needs_review: 0, critical: 0 },
  };
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockDoctorShell(page: Page, queue: QueueFixture[]) {
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') return fulfill(route, {});
    return fulfill(route, { ok: true });
  });

  await page.route(/\/api\/doctors\/dashboard\/ipd-rounds(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfill(route, {
      date: '2026-06-26',
      summary: { total_inpatients: 0, not_rounded_today: 0, pending_clinical_note: 0, deteriorating: 0, critical: 0 },
      inpatients: [],
    });
  });

  await page.route(/\/api\/doctors\/dashboard(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfill(route, dashboardFixture(queue));
  });

  await page.route(/\/api\/patients\/10$/, async (route) => fulfill(route, {
    id: 10,
    name: 'Rahim Uddin',
    patient_code: 'P-000010',
    mobile: '01711000010',
    gender: 'Male',
    date_of_birth: '1981-01-01',
  }));

  await page.route(/\/api\/patients\/10\/chart$/, async (route) => fulfill(route, {
    allergies: [{ allergen: 'Penicillin', severity: 'high' }],
    medications: [],
    labResults: [],
    visits: [],
  }));

  await page.route(/\/api\/appointments\/44$/, async (route) => fulfill(route, {
    id: 44,
    patient_id: 10,
    doctor_id: 101,
    chief_complaint: 'Headache',
    status: 'in_progress',
  }));

  await page.route('**/api/doctors/101', async (route) => fulfill(route, { doctor }));
  await page.route('**/api/e-prescribing/formulary/frequent**', async (route) => fulfill(route, { medicines: [] }));
  await page.route('**/api/e-prescribing/formulary/search**', async (route) => fulfill(route, { medicines: [] }));
  await page.route('**/api/e-prescribing/check-safety', async (route) => fulfill(route, { findings: [], safety_check_id: 501 }));
  await page.route('**/api/doctors/dashboard/appointments/44/clinical-orders', async (route) => fulfill(route, { orders: [] }));
}

async function openDoctorDashboard(page: Page, queue: QueueFixture[]) {
  await mockDoctorShell(page, queue);
  await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page).not.toHaveURL(/\/unauthorized$/);
}

test.describe('Doctor critical workflow guards', () => {
  test('Fast Rx uses the real appointment id and preserves doctor dashboard return context', async ({ page }) => {
    await openDoctorDashboard(page, [{ ...baseQueueItem, status: 'waiting', appointment_id: 44 }]);

    const fastRx = page.getByRole('link', { name: /fast rx/i }).first();
    await expect(fastRx).toBeVisible();
    await expect(fastRx).toHaveAttribute('href', /\/prescriptions\/new\?patient=10&appt=44&from=doctor\/dashboard$/);

    await fastRx.click();
    await expect(page).toHaveURL(/\/prescriptions\/new\?patient=10&appt=44&from=doctor\/dashboard/);
  });

  test('missing appointment id disables Fast Rx and blocks Call Next mutation', async ({ page }) => {
    let statusMutationCount = 0;
    await mockDoctorShell(page, [{ ...baseQueueItem, id: 2001, appointment_id: null, status: 'waiting' }]);
    await page.route('**/api/doctors/dashboard/appointments/**/status', async (route) => {
      statusMutationCount += 1;
      return fulfill(route, { ok: true });
    });
    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await expect(page.getByRole('button', { name: /fast rx/i }).first()).toBeDisabled();
    await expect(page.getByRole('link', { name: /fast rx/i })).toHaveCount(0);

    await page.getByRole('button', { name: /call next/i }).click();
    await expect.poll(() => statusMutationCount).toBe(0);
    await expect(page.getByText(/appointment id is missing/i).first()).toBeVisible();
  });

  test('consultation drawer completes the visit against the same appointment id', async ({ page }) => {
    const completePayloads: Array<Record<string, unknown>> = [];
    let statusMutationCount = 0;

    await mockDoctorShell(page, [{ ...baseQueueItem, appointment_id: 44, status: 'in_progress' }]);
    await page.route('**/api/doctors/dashboard/appointments/44/status', async (route) => {
      statusMutationCount += 1;
      return fulfill(route, { ok: true });
    });
    await page.route('**/api/doctors/dashboard/appointments/44/complete-consultation', async (route) => {
      if (route.request().method() === 'POST') {
        completePayloads.push(route.request().postDataJSON() as Record<string, unknown>);
        return fulfill(route, { message: 'Consultation completed', appointmentId: 44, patientId: 10, lifecycle: { appointmentStatus: 'completed' } });
      }
      return route.fallback();
    });

    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await page.getByRole('button', { name: /call next/i }).click();
    await expect(page.getByText('Consultation Workspace')).toBeVisible();
    await expect.poll(() => statusMutationCount).toBe(0);

    await page.getByPlaceholder('Chief complaint').fill('Headache with nausea');
    await page.locator('button:has-text("Save & Complete")').last().click();

    await expect.poll(() => completePayloads.length).toBe(1);
    expect(completePayloads[0].completeVisit).toBe(true);
    expect(completePayloads[0].soap).toMatchObject({ chiefComplaint: 'Headache with nausea' });
  });

  test('OPD record New Prescription keeps exact patient, appointment and return route', async ({ page }) => {
    await mockDoctorShell(page, [{ ...baseQueueItem, appointment_id: 44, status: 'in_progress' }]);
    await page.route('**/api/clinical/**', async (route) => fulfill(route, { Results: [] }));
    await page.route('**/api/laboratory/**', async (route) => fulfill(route, { tests: [] }));

    await loginAs(page, 'doctor', `${BASE_SLUG_PATH}/doctor/opd/10/44`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const newPrescription = page.getByRole('link', { name: /new prescription/i }).first();
    await expect(newPrescription).toBeVisible();
    await expect(newPrescription).toHaveAttribute('href', /\/prescriptions\/new\?patient=10&appt=44&from=doctor\/opd\/10\/44$/);

    await newPrescription.click();
    await expect(page).toHaveURL(/\/prescriptions\/new\?patient=10&appt=44&from=doctor\/opd\/10\/44/);
  });
});

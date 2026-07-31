import { test, expect } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs } from './helpers/auth';

test.describe('Appointment Booking', () => {
  test('books an appointment with server fee preview and selected patient', async ({ page }) => {
    const bookingPayloads: unknown[] = [];

    await page.route('**/api/doctors**', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          doctors: [
            { id: 1, name: 'Dr. Ahmed', specialty: 'Medicine', consultation_fee: 500 },
          ],
        }),
      });
    });

    await page.route('**/api/patients**', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          patients: [
            { id: 1, patient_code: 'P-000001', name: 'Rahim Uddin', mobile: '01711000001' },
          ],
        }),
      });
    });

    await page.route('**/api/appointments**', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.endsWith('/api/appointments/fee-preview')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            charge: {
              appointmentType: 'new_patient',
              originalFee: 500,
              discountAmount: 0,
              finalFee: 500,
              billingStatus: 'unpaid',
            },
          }),
        });
      }

      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ appointments: [] }),
        });
      }

      if (request.method() === 'POST' && url.pathname.endsWith('/api/appointments')) {
        bookingPayloads.push(request.postDataJSON());
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Appointment booked',
            id: 9001,
            apptNo: 'APT-009001',
            tokenNo: 1,
            consultationFee: 500,
            billingStatus: 'unpaid',
          }),
        });
      }

      return route.continue();
    });

    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/appointments`);
    await expect(page.getByRole('button', { name: /book appointment/i }).first()).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /book appointment/i }).first().click();

    await page.locator('input[placeholder*="search" i]').fill('Rahim');
    await expect(page.getByText('Rahim Uddin')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /Rahim Uddin/i }).click();

    await page.locator('select').first().selectOption('1');
    await page.locator('input[type="time"]').fill('10:00');

    await expect(page.getByText('৳500').last()).toBeVisible({ timeout: 8000 });
    await page.locator('form').getByRole('button', { name: /^Book Appointment$/i }).click();

    await expect.poll(() => bookingPayloads.length).toBe(1);
    expect(bookingPayloads[0]).toMatchObject({
      patientId: 1,
      doctorId: 1,
      apptTime: '10:00',
      appointmentType: 'new_patient',
    });
  });

  test('quick pay sends a mutation idempotency key', async ({ page }) => {
    const quickPayPayloads: unknown[] = [];

    await page.route('**/api/settings', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: {} }) });
    });
    await page.route('**/api/inbox/unread-count', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unreadCount: 0 }) });
    });
    await page.route('**/api/doctors**', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          doctors: [
            { id: 1, name: 'Dr. Ahmed', specialty: 'Medicine', consultation_fee: 500 },
          ],
        }),
      });
    });
    await page.route('**/api/appointments**', (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            appointments: [
              {
                id: 9001,
                appt_no: 'APT-009001',
                token_no: 1,
                patient_id: 1,
                patient_name: 'Rahim Uddin',
                patient_code: 'P-000001',
                patient_mobile: '01711000001',
                doctor_id: 1,
                doctor_name: 'Dr. Ahmed',
                doctor_specialty: 'Medicine',
                appt_date: '2026-05-12',
                appt_time: '10:00',
                visit_type: 'opd',
                status: 'scheduled',
                fee: 500,
                final_fee: 500,
                billing_status: 'unpaid',
                source: 'scheduled',
                chief_complaint: null,
                notes: null,
              },
            ],
          }),
        });
      }

      if (request.method() === 'POST' && url.pathname.endsWith('/api/appointments/9001/pay-now')) {
        quickPayPayloads.push(request.postDataJSON());
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Appointment consultation payment posted',
            appointmentId: 9001,
            invoiceNo: 'INV-009001',
            receiptNo: 'RCP-009001',
            total: 500,
            paid: 500,
            due: 0,
            billingStatus: 'paid',
          }),
        });
      }

      return route.continue();
    });

    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/appointments`);
    await expect(page.getByText('Rahim Uddin')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /^Pay Now$/i }).click();

    await expect.poll(() => quickPayPayloads.length).toBe(1);
    expect(quickPayPayloads[0]).toMatchObject({
      paymentMethod: 'cash',
    });
    expect((quickPayPayloads[0] as { idempotencyKey?: string }).idempotencyKey).toMatch(/^appointment-pay-9001-/);
  });

  test('check-in creates a visit for a financially cleared appointment', async ({ page }) => {
    const checkInCalls: string[] = [];

    await page.route('**/api/settings', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: {} }) });
    });
    await page.route('**/api/inbox/unread-count', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unreadCount: 0 }) });
    });
    await page.route('**/api/doctors**', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ doctors: [{ id: 1, name: 'Dr. Ahmed', specialty: 'Medicine', consultation_fee: 0 }] }),
      });
    });
    await page.route('**/api/appointments**', (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            appointments: [
              {
                id: 9002,
                appt_no: 'APT-009002',
                token_no: 2,
                patient_id: 1,
                patient_name: 'Farida Begum',
                patient_code: 'P-000002',
                patient_mobile: '01711000002',
                doctor_id: 1,
                doctor_name: 'Dr. Ahmed',
                doctor_specialty: 'Medicine',
                appt_date: '2026-05-12',
                appt_time: '11:00',
                visit_type: 'opd',
                status: 'scheduled',
                fee: 0,
                final_fee: 0,
                billing_status: 'no_charge',
                source: 'scheduled',
                chief_complaint: null,
                notes: null,
              },
            ],
          }),
        });
      }

      if (request.method() === 'POST' && url.pathname.endsWith('/api/appointments/9002/check-in')) {
        checkInCalls.push(url.pathname);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Patient checked in',
            visitId: 7002,
            visitNo: 'V-007002',
            consultationFee: 0,
            billingStatus: 'no_charge',
            doctorQueueAllowed: true,
          }),
        });
      }

      return route.continue();
    });

    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/appointments`);
    await expect(page.getByText('Farida Begum')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /^Check In$/i }).click();

    await expect.poll(() => checkInCalls.length).toBe(1);
    expect(checkInCalls[0]).toContain('/api/appointments/9002/check-in');
  });
});

import { test, expect } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs, mockGet } from './helpers/auth';

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

test.describe('IP Billing', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/ip-billing/stats**', {
      total_inpatients: 1,
      pending_billing: 1,
      total_charges_today: 1000,
      settled_today: 0,
    });
    await mockGet(page, '**/api/ip-billing/patients**', {
      data: [{
        admission_id: 100,
        admission_number: 'ADM-00100',
        patient_id: 1,
        patient_name: 'Rahim Uddin',
        patient_code: 'P-000001',
        ward_name: 'General',
        bed_number: 'A-101',
        doctor_name: 'Dr. Ahmed',
        admitted_date: '2026-05-12T09:00:00Z',
        billing_status: 'pending',
        total_charges: 1000,
        total_paid: 0,
        balance: 1000,
        deposit_balance: 0,
      }],
    });
    await mockGet(page, '**/api/admissions/100/detail**', {
      admission: {
        id: 100,
        admission_no: 'ADM-00100',
        patient_id: 1,
        patient_name: 'Rahim Uddin',
        patient_code: 'P-000001',
        ward_name: 'General',
        bed_number: 'A-101',
        bed_type: 'General',
        doctor_name: 'Dr. Ahmed',
        admission_date: '2026-05-12T09:00:00Z',
        admission_type: 'planned',
        status: 'admitted',
      },
    });
    await mockGet(page, '**/api/ip-billing/pending/100**', {
      items: [{
        id: 1,
        item_name: 'CBC Test',
        item_category: 'test',
        department: 'Pathology',
        reference_id: 501,
        unit_price: 1000,
        quantity: 1,
        discount_percent: 0,
        discount_amount: 0,
        total_amount: 1000,
        created_at: '2026-05-12T10:00:00Z',
        bill_status: 'provisional',
      }],
      bed_charges: { segments: [], bed_total: 0 },
      summary: {
        provisional_total: 1000,
        bed_total: 0,
        grand_total: 1000,
        deposit_balance: 0,
        net_payable: 1000,
      },
    });
    await mockGet(page, '**/api/deposits/balance/1**', {
      patient_id: 1,
      total_deposits: 0,
      total_refunds: 0,
      total_adjustments: 0,
      balance: 0,
    });
    await mockGet(page, '**/api/billing-master/service-departments**', { data: [] });
    await mockGet(page, '**/api/billing-master/service-items**', { data: [] });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/ip-billing`);
  });

  test('discharge posts payable amount instead of cashier tender amount', async ({ page }) => {
    const dischargePayloads: Array<{ paid_amount?: number; admission_id?: number }> = [];
    await page.route('**/api/ip-billing/discharge-bill', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      dischargePayloads.push(route.request().postDataJSON() as { paid_amount?: number; admission_id?: number });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ bill_id: 7001, invoice_no: 'BL-0001', total_amount: 1000, paid_amount: 1000, due_amount: 0, status: 'paid' }),
      });
    });

    await assertPageRendered(page);
    await page.getByTitle('View billing detail').click();
    await expect(page.getByText(/IP Billing .* Rahim Uddin/)).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const tenderInput = page.locator('main input[placeholder="0.00"]').first();
    await tenderInput.click();
    await tenderInput.pressSequentially('5000');
    await expect(tenderInput).toHaveValue('5000');
    await page.getByRole('button', { name: /Discharge Patient/i }).click();
    await page.getByRole('button', { name: /Confirm Discharge/i }).click();

    await expect.poll(() => dischargePayloads.length).toBe(1);
    expect(dischargePayloads[0]).toMatchObject({ admission_id: 100, paid_amount: 1000 });
  });
});

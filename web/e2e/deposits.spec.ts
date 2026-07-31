import { test, expect } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs, mockGet } from './helpers/auth';

test.describe('Deposits', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/deposits**', {
      deposits: [],
      total: 0,
      summary: { total_deposits: 0, total_refunds: 0, total_adjustments: 0, balance: 0 },
    });
    await mockGet(page, '**/api/patients**', {
      patients: [{
        id: 1,
        name: 'Rahim Uddin',
        patient_code: 'P-000001',
        mobile: '01711000001',
      }],
      total: 1,
    });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/deposits`);
  });

  test('collect deposit sends an idempotency key', async ({ page }) => {
    const payloads: Array<{ patient_id?: number; amount?: number; idempotencyKey?: string }> = [];
    await page.route('**/api/deposits**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            deposits: [],
            total: 0,
            summary: { total_deposits: 0, total_refunds: 0, total_adjustments: 0, balance: 0 },
          }),
        });
        return;
      }
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      payloads.push(route.request().postDataJSON() as { patient_id?: number; amount?: number; idempotencyKey?: string });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 11, receipt_no: 'DEP-000011', message: 'Deposit collected' }),
      });
    });

    await expect(page.locator('main')).toBeVisible();
    await page.getByRole('button', { name: /new\s*deposit|newDeposit/i }).first().click();
    await page.getByPlaceholder(/search patient/i).last().fill('Rahim');
    await page.getByRole('button', { name: /Rahim Uddin/ }).click();
    await page.locator('input[type="number"]').last().fill('2500');
    await page.getByRole('button', { name: /new\s*deposit|newDeposit/i }).last().click();

    await expect.poll(() => payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({ patient_id: 1, amount: 2500 });
    expect(payloads[0].idempotencyKey).toMatch(/^patient-deposit-/);
  });

  test('refund deposit sends an idempotency key', async ({ page }) => {
    const payloads: Array<{ patient_id?: number; amount?: number; idempotencyKey?: string }> = [];
    await page.route('**/api/deposits**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            deposits: [],
            total: 0,
            summary: { total_deposits: 0, total_refunds: 0, total_adjustments: 0, balance: 0 },
          }),
        });
        return;
      }
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      if (route.request().url().includes('/api/deposits/refund')) {
        payloads.push(route.request().postDataJSON() as { patient_id?: number; amount?: number; idempotencyKey?: string });
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 12, receipt_no: 'DRF-000012', message: 'Refund processed' }),
        });
        return;
      }
      await route.continue();
    });

    await expect(page.locator('main')).toBeVisible();
    await page.getByRole('button', { name: /refunded|refund/i }).first().click();
    await page.getByPlaceholder(/search patient/i).last().fill('Rahim');
    await page.getByRole('button', { name: /Rahim Uddin/ }).click();
    await page.locator('input[type="number"]').last().fill('1000');
    await page.getByRole('button', { name: /process/i }).last().click();

    await expect.poll(() => payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({ patient_id: 1, amount: 1000 });
    expect(payloads[0].idempotencyKey).toMatch(/^patient-deposit-refund-/);
  });
});

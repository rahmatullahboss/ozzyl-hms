import { test, expect } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs, mockGet } from './helpers/auth';

test.describe('Billing Counter', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/doctors**', { doctors: [] });
    await mockGet(page, '**/api/billing-master/schemes**', { data: [] });
    await mockGet(page, '**/api/billing-master/price-categories**', { data: [] });
    await mockGet(page, '**/api/billing-master/counters**', {
      data: [{ id: 7, counter_name: 'Main Billing Counter', counter_code: 'BILL-1', counter_type: 'billing' }],
    });
    await mockGet(page, '**/api/billing-counter/sessions/active**', {
      session: {
        id: 17,
        counterId: 7,
        counterName: 'Main Billing Counter',
        counterCode: 'BILL-1',
        counterType: 'billing',
        openedAt: '2026-05-12 08:00:00',
        openingCash: 100,
        expectedCash: 100,
      },
    });
    await mockGet(page, '**/api/billing-counter/handover-recipients**', {
      recipients: [{ id: 2, name: 'Accountant One', email: 'accountant@example.test', role: 'accountant' }],
    });
    await mockGet(page, '**/api/billing-counter/pending-appointment-charges**', { data: [], date: '2026-05-12' });
    await mockGet(page, '**/api/billing-counter/pending-bills**', {
      data: [{
        bill_id: 101,
        invoice_no: 'INV-000101',
        patient_id: 1,
        patient_name: 'Rahim Uddin',
        patient_code: 'P-000001',
        pending_amount: 500,
        status: 'open',
        created_at: '2026-05-12 10:00:00',
      }],
      date: '2026-05-12',
    });
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/reception/billing-counter`);
  });

  test('pending due bill cash payment sends an idempotency key', async ({ page }) => {
    const payloads: Array<{ billId?: number; amount?: number; type?: string; idempotencyKey?: string }> = [];
    await page.route('**/api/billing/pay', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      payloads.push(route.request().postDataJSON() as { billId?: number; amount?: number; type?: string; idempotencyKey?: string });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ receiptNo: 'RCP-000101', status: 'paid' }),
      });
    });

    await expect(page.getByText('INV-000101')).toBeVisible();
    await page.getByRole('button', { name: /pay cash/i }).click();

    await expect.poll(() => payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({ billId: 101, amount: 500, type: 'due' });
    expect(payloads[0].idempotencyKey).toMatch(/^billing-counter-due-101-/);
  });

  test('counter closing sends declared cash, partial handover, and variance remarks', async ({ page }) => {
    const payloads: Array<{ closingCash?: number; handoverTo?: number; handoverAmount?: number; remarks?: string }> = [];
    await page.route('**/api/billing-counter/sessions/17/close', async (route) => {
      payloads.push(route.request().postDataJSON() as { closingCash?: number; handoverTo?: number; handoverAmount?: number; remarks?: string });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Billing counter closed',
          expectedCash: 100,
          variance: -20,
          handoverAmount: 70,
          handoverDueAmount: 10,
        }),
      });
    });

    await page.getByLabel(/closing cash/i).fill('80');
    await page.getByLabel(/handover amount/i).fill('70');
    await page.getByLabel(/handover recipient/i).selectOption('2');
    await page.getByLabel(/closing remarks/i).fill('Cash shortage verified by supervisor');
    await page.getByRole('button', { name: /close counter/i }).click();

    await expect.poll(() => payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({
      closingCash: 80,
      handoverTo: 2,
      handoverAmount: 70,
      remarks: 'Cash shortage verified by supervisor',
    });
  });
});

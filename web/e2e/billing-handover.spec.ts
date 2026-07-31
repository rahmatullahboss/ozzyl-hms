import { test, expect } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs, mockGet } from './helpers/auth';

test.describe('Billing Handover', () => {
  test.beforeEach(async ({ page }) => {
    await mockGet(page, '**/api/settings**', { settings: {} });
    await mockGet(page, '**/api/inbox/unread-count**', { unreadCount: 0 });
    await mockGet(page, '**/api/billing-handover**', {
      handovers: [{
        id: 55,
        handover_by_name: 'Cashier One',
        handover_to_name: 'Accountant One',
        handover_amount: 1800,
        due_amount: 0,
        handover_type: 'counter',
        status: 'pending',
        remarks: 'End of day',
        created_at: '2026-05-12 20:00:00',
      }],
    });
    await mockGet(page, '**/api/billing-counter/admin/collection-summary**', {
      date: '2026-05-12',
      todayCollection: 1200,
      pendingCount: 1,
      pendingAmount: 600,
      counterBreakdown: [],
    });
    await mockGet(page, '**/api/billing-counter/admin/pending-handovers**', {
      totalPending: 600,
      count: 1,
      handovers: [{
        id: 77,
        counterSessionId: 17,
        handoverAmount: 1800,
        dueAmount: 600,
        status: 'partial',
        sessionNo: 'BCS-001',
        counterName: 'Main Billing Counter',
        counterCode: 'BILL-1',
        cashierName: 'Cashier One',
        handoverToName: 'Accountant One',
        variance: 0,
        closedAt: '2026-05-12 18:00:00',
      }],
    });
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/billing-handover`);
  });

  test('manual handover creation uses the backend API contract', async ({ page }) => {
    const payloads: Array<Record<string, unknown>> = [];
    await page.route('**/api/billing-handover', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      payloads.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 99, message: 'Handover created' }),
      });
    });

    await page.getByRole('button', { name: /new handover/i }).click();
    await page.getByLabel(/to user id/i).fill('2');
    await page.getByLabel(/^amount/i).fill('1500');
    await page.getByLabel(/due amount/i).fill('200');
    await page.getByLabel(/handover type/i).selectOption('counter');
    await page.getByRole('textbox', { name: /^remarks$/i }).fill('Manual cash transfer');
    await page.getByRole('button', { name: /create handover/i }).click();

    await expect.poll(() => payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({
      handover_to: 2,
      handover_amount: 1500,
      due_amount: 200,
      handover_type: 'counter',
      remarks: 'Manual cash transfer',
    });
  });

  test('admin can collect remaining counter handover cash', async ({ page }) => {
    const collected: number[] = [];
    await page.route('**/api/billing-counter/admin/collect/*', async (route) => {
      collected.push(Number(route.request().url().split('/').pop()));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Cash collected successfully', handoverId: 77, status: 'collected' }),
      });
    });

    await expect(page.getByRole('heading', { name: /admin cash collection/i })).toBeVisible();
    await page.getByRole('button', { name: /collect remaining/i }).click();

    await expect.poll(() => collected).toEqual([77]);
  });

  test('admin partial collection sends amount and remarks', async ({ page }) => {
    const payloads: Array<Record<string, unknown>> = [];
    await page.route('**/api/billing-counter/admin/partial-collect/*', async (route) => {
      payloads.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Partially collected', handoverId: 77, status: 'partial', remainingAmount: 400 }),
      });
    });

    await page.getByLabel(/collect amount for handover 77/i).fill('200');
    await page.getByLabel(/collection remarks for handover 77/i).fill('Owner collected partial cash');
    await page.getByRole('button', { name: /^partial$/i }).click();

    await expect.poll(() => payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({
      id: 77,
      collectedAmount: 200,
      remarks: 'Owner collected partial cash',
    });
  });
});

/**
 * Ozzyl HMS — Approval Center Browser E2E Tests (Playwright)
 *
 * Tests the Approval Center page: navigation, queue cards with counts,
 * review links, empty states, and role-based access control.
 *
 * Run:
 *   npx playwright test --project=approval-center
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev npx playwright test --project=approval-center
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAs, mockGet, mockMutation, BASE_SLUG_PATH } from '../../../web/e2e/helpers/auth';

// ─── Fixtures ───────────────────────────────────────────────────────────────────

const pendingRefunds = {
  credit_notes: [
    { id: 1, patient_name: 'Rahim Uddin', amount: 500, status: 'pending' },
    { id: 2, patient_name: 'Farida Begum', amount: 1200, status: 'pending' },
  ],
};

const pendingGrn = {
  data: [
    { id: 10, grn_no: 'GRN-0010', supplier_name: 'MediCo', total_amount: 30000, approval_status: 'pending' },
  ],
};

const pendingWriteOffs = {
  data: [
    { id: 5, write_off_no: 'WO-0005', reason: 'Expired stock', total_value: 8000, approval_status: 'pending' },
  ],
};

const pendingAdjustments = {
  data: [
    { id: 7, Status: 'submitted', item_name: 'Paracetamol', quantity: 50 },
  ],
};

const emptyRefunds = { credit_notes: [] };
const emptyGrn = { data: [] };
const emptyWriteOffs = { data: [] };
const emptyAdjustments = { data: [] };

// ─── Helpers ────────────────────────────────────────────────────────────────────

async function setupApprovalMocks(page: Page, opts?: {
  refunds?: unknown;
  grn?: unknown;
  writeOffs?: unknown;
  adjustments?: unknown;
}) {
  await mockGet(page, '**/api/dashboard**', { stats: {} });
  await mockGet(page, '**/api/credit-notes**', opts?.refunds ?? pendingRefunds);
  await mockGet(page, '**/api/pharmacy/grn/pending-approval**', opts?.grn ?? pendingGrn);
  await mockGet(page, '**/api/pharmacy/write-offs/pending-approval**', opts?.writeOffs ?? pendingWriteOffs);
  await mockGet(page, '**/api/inventory/adjustment-requests**', opts?.adjustments ?? pendingAdjustments);
  await mockGet(page, '**/api/**', {});
}

async function navigateToApprovalCenter(page: Page) {
  await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/approvals`);
  await page.waitForLoadState('networkidle');
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Approval Center', () => {

  test('admin can navigate to Approval Center from sidebar', async ({ page }) => {
    await setupApprovalMocks(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/dashboard`);
    await page.waitForLoadState('networkidle');

    const sidebarLink = page.getByRole('link', { name: /approvals/i });
    await sidebarLink.click();

    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByRole('heading', { name: /approval center/i })).toBeVisible();
  });

  test('shows queue cards with pending counts', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    // Queue card titles
    await expect(page.getByText('Refund requests')).toBeVisible();
    await expect(page.getByText('Pharmacy receiving and write-off')).toBeVisible();
    await expect(page.getByText('Inventory adjustments')).toBeVisible();

    // Counts should reflect fixture data
    await expect(page.getByText('2')).toBeVisible(); // 2 refund credit notes
    await expect(page.getByText('2').first()).toBeVisible(); // 1 GRN + 1 write-off = 2 pharmacy
    await expect(page.getByText('1')).toBeVisible(); // 1 submitted adjustment
  });

  test('shows total pending count in header card', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    const pendingCard = page.locator('.card').filter({ hasText: 'Pending now' });
    await expect(pendingCard).toBeVisible();

    // Total = 2 refunds + 2 pharmacy + 1 adjustment = 5
    await expect(pendingCard.getByText('5')).toBeVisible();
  });

  test('each queue card has a review link', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    await expect(page.getByRole('link', { name: /review refunds/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /review pharmacy approvals/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /review adjustments/i })).toBeVisible();
  });

  test('clicking Review refunds navigates to credit notes page', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    const reviewLink = page.getByRole('link', { name: /review refunds/i });
    await expect(reviewLink).toHaveAttribute('href', /\/credit-notes$/);
    await reviewLink.click();
    await expect(page).toHaveURL(/\/credit-notes$/);
  });

  test('clicking Review pharmacy approvals navigates to approval queue', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    const reviewLink = page.getByRole('link', { name: /review pharmacy approvals/i });
    await expect(reviewLink).toHaveAttribute('href', /\/pharmacy\/approval-queue$/);
    await reviewLink.click();
    await expect(page).toHaveURL(/\/pharmacy\/approval-queue$/);
  });

  test('clicking Review adjustments navigates to adjustment requests page', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    const reviewLink = page.getByRole('link', { name: /review adjustments/i });
    await expect(reviewLink).toHaveAttribute('href', /\/inventory\/adjustment-requests$/);
    await reviewLink.click();
    await expect(page).toHaveURL(/\/inventory\/adjustment-requests$/);
  });

  test('empty state shows zero counts when no pending approvals', async ({ page }) => {
    await setupApprovalMocks(page, {
      refunds: emptyRefunds,
      grn: emptyGrn,
      writeOffs: emptyWriteOffs,
      adjustments: emptyAdjustments,
    });
    await navigateToApprovalCenter(page);

    const pendingCard = page.locator('.card').filter({ hasText: 'Pending now' });
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard.getByText('0')).toBeVisible();

    // Queue cards should still render
    await expect(page.getByText('Refund requests')).toBeVisible();
    await expect(page.getByText('Pharmacy receiving and write-off')).toBeVisible();
    await expect(page.getByText('Inventory adjustments')).toBeVisible();
  });

  test('controlled actions section is visible', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    await expect(page.getByText('Controlled actions')).toBeVisible();
    await expect(page.getByRole('link', { name: /bill cancellation control/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /cash handover and variance/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /discount policy/i })).toBeVisible();
  });

  test('controlled actions link to correct pages', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    await expect(page.getByRole('link', { name: /bill cancellation control/i }))
      .toHaveAttribute('href', /\/billing-cancellation$/);
    await expect(page.getByRole('link', { name: /cash handover and variance/i }))
      .toHaveAttribute('href', /\/billing-handover$/);
    await expect(page.getByRole('link', { name: /discount policy/i }))
      .toHaveAttribute('href', /\/settings\/discounts$/);
  });

  test('non-admin user cannot access Approval Center', async ({ page }) => {
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'reception', `${BASE_SLUG_PATH}/approvals`);

    // Should redirect to reception dashboard or show unauthorized
    const url = page.url();
    const onApprovals = url.includes('/approvals');
    const bodyText = await page.textContent('body') ?? '';

    if (onApprovals) {
      // If somehow on the page, should not see the Approval Center heading
      const heading = page.getByRole('heading', { name: /approval center/i });
      const visible = await heading.isVisible().catch(() => false);
      expect(visible).toBe(false);
    } else {
      // Redirected away — should be on a different page
      expect(url).not.toContain('/approvals');
    }
  });

  test('page subtitle describes the workflow', async ({ page }) => {
    await setupApprovalMocks(page);
    await navigateToApprovalCenter(page);

    await expect(
      page.getByText(/sensitive actions are reviewed inside their audited operational workflow/i)
    ).toBeVisible();
  });

  test('loading state shows dash placeholder', async ({ page }) => {
    // Delay API responses to observe loading state
    await page.route('**/api/credit-notes**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pendingRefunds) });
    });
    await page.route('**/api/pharmacy/grn/pending-approval**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pendingGrn) });
    });
    await page.route('**/api/pharmacy/write-offs/pending-approval**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pendingWriteOffs) });
    });
    await page.route('**/api/inventory/adjustment-requests**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pendingAdjustments) });
    });
    await mockGet(page, '**/api/dashboard**', { stats: {} });
    await mockGet(page, '**/api/**', {});
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/approvals`);

    // During loading, counts show dash
    const pendingCard = page.locator('.card').filter({ hasText: 'Pending now' });
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard.getByText('-')).toBeVisible();
  });

});

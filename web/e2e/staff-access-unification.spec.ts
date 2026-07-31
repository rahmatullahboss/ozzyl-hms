import { test, expect, type Page } from '@playwright/test';
import { loginAs, mockGet, BASE_SLUG_PATH } from './helpers/auth';

const staffFixture = {
  staff: [
    {
      id: 11,
      name: 'Pending Reception',
      position: 'Receptionist',
      department: 'Front Desk',
      salary: 0,
      status: 'active',
      user_id: null,
      email: 'pending@example.com',
      pending_invitation_id: 91,
      pending_invitation_status: 'pending',
      pending_invitation_role: 'reception',
    },
    {
      id: 12,
      name: 'Expired Manager',
      position: 'Manager',
      department: 'Admin',
      salary: 0,
      status: 'active',
      user_id: null,
      email: 'expired@example.com',
      pending_invitation_id: 92,
      pending_invitation_status: 'expired',
      pending_invitation_role: 'manager',
    },
    {
      id: 13,
      name: 'No Access Accountant',
      position: 'Accountant',
      department: 'Accounts',
      salary: 0,
      status: 'active',
      user_id: null,
      email: 'noaccess@example.com',
      pending_invitation_id: null,
      pending_invitation_status: null,
    },
    {
      id: 14,
      name: 'Active Director',
      position: 'Director',
      department: 'Management',
      salary: 0,
      status: 'active',
      user_id: 200,
      email: 'director@example.com',
      pending_invitation_id: null,
      pending_invitation_status: null,
    },
  ],
};

async function openStaffPage(page: Page) {
  await mockGet(page, '**/api/staff**', staffFixture);
  await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/staff`);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

test.describe('Staff access unification E2E', () => {
  test('staff list shows connected login/invitation statuses', async ({ page }) => {
    await openStaffPage(page);

    await expect(page.getByText('Pending Reception')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Pending Invite').first()).toBeVisible();
    await expect(page.getByText('Expired Invite')).toBeVisible();
    await expect(page.getByText('No Access')).toBeVisible();
    await expect(page.getByText('Active Login')).toBeVisible();
  });

  test('resend keeps staff invitation workflow on the Staff page', async ({ page }) => {
    let resendCalled = false;
    await page.route('**/api/invitations/91/resend', (route) => {
      resendCalled = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inviteLink: '/h/demo-hospital/accept-invite?token=resend-token', expiresAt: '2099-01-01T00:00:00.000Z' }),
      });
    });

    await openStaffPage(page);
    await page.getByRole('row', { name: /Pending Reception/ }).getByRole('button', { name: /Resend/i }).click();

    await expect.poll(() => resendCalled).toBe(true);
    await expect(page.getByText(/accept-invite\?token=resend-token/)).toBeVisible({ timeout: 10000 });
  });

  test('creating staff can send selected login role invite without bank account', async ({ page }) => {
    let createBody: any = null;
    let inviteBody: any = null;

    await page.route('**/api/staff', async (route) => {
      if (route.request().method() === 'POST') {
        createBody = await route.request().postDataJSON();
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 100, message: 'Staff added' }) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ staff: [] }) });
      }
    });
    await page.route('**/api/staff/100/invite', async (route) => {
      inviteBody = await route.request().postDataJSON();
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ invite: { inviteLink: '/h/demo-hospital/accept-invite?token=create-token', email: inviteBody.email, role: inviteBody.role, staffId: 100 } }),
      });
    });

    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/staff`);
    await page.getByRole('button', { name: /Add Staff/i }).click();

    const drawer = page.getByTestId('staff-drawer');
    await drawer.locator('input').nth(0).fill('New Director Reception');
    await drawer.locator('input').nth(1).fill('Director');
    await drawer.locator('select').first().selectOption('accountant');
    await drawer.locator('input[type="email"]').fill('new-director@example.com');
    await drawer.getByText(/Give software access/i).click();
    await drawer.locator('select').nth(2).selectOption('director');
    await page.getByRole('button', { name: /Add Staff/i }).last().click();

    await expect.poll(() => createBody?.bankAccount).toBe('');
    await expect.poll(() => inviteBody?.role).toBe('director');
    expect(inviteBody.email).toBe('new-director@example.com');
  });

  test('workspace switcher exposes dual-purpose workspaces after login', async ({ page }) => {
    await openStaffPage(page);

    const switchButton = page.getByRole('button', { name: /Switch workspace/i }).or(page.getByRole('button', { name: /^Switch$/i })).first();
    await switchButton.click();

    await expect(page.getByText('Reception Desk')).toBeVisible();
    await expect(page.getByText('MD / Management')).toBeVisible();
    await expect(page.getByText('Accountant Dashboard')).toBeVisible();
    await expect(page.getByText('Administration Dashboard')).toBeVisible();
  });
});

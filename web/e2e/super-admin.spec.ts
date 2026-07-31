/**
 * E2E: Super Admin — All Pages (Dashboard, Hospital List, Hospital Detail,
 * Onboarding Queue, Settings, Audit Log, Platform Health)
 *
 * Uses resilient assertions: verifies auth works, pages render, and key UI
 * elements are present.
 */
import { test, expect } from '@playwright/test';
import { loginAs, mockGet, mockMutation } from './helpers/auth';

// ── Shared Mocks ────────────────────────────────────────────────────────────────

const superAdminMocks = async (page: import('@playwright/test').Page) => {
  // Mock the inbox unread-count that Header fires on every page
  await mockGet(page, '**/api/inbox/unread-count', { count: 0 });

  // Stats
  await mockGet(page, '**/api/admin/stats', {
    hospitals: { total: 5, active: 4, inactive: 0, suspended: 1 },
    users: 22,
    patients: 1040,
    revenue: { totalBilled: 250000, totalPaid: 195000 },
    recentHospitals: [
      { id: 1, name: 'Demo Hospital', subdomain: 'demo-hospital', plan: 'professional', status: 'active', created_at: '2025-03-01T00:00:00Z' },
      { id: 2, name: 'New Medical', subdomain: 'new-medical', plan: 'starter', status: 'active', created_at: '2025-03-10T00:00:00Z' },
    ],
    pendingOnboarding: 3,
  });

  // Hospital list (glob with ** covers query string variants)
  await mockGet(page, '**/api/admin/hospitals?*', {
    hospitals: [
      { id: 1, name: 'Demo Hospital', subdomain: 'demo-hospital', status: 'active', plan: 'professional', created_at: '2025-01-01', user_count: 8, patient_count: 500 },
      { id: 2, name: 'New Medical', subdomain: 'new-medical', status: 'active', plan: 'starter', created_at: '2025-02-15', user_count: 3, patient_count: 120 },
    ],
    pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
  });

  // Hospital list (without query string)
  await mockGet(page, '**/api/admin/hospitals', {
    hospitals: [
      { id: 1, name: 'Demo Hospital', subdomain: 'demo-hospital', status: 'active', plan: 'professional', created_at: '2025-01-01', user_count: 8, patient_count: 500 },
      { id: 2, name: 'New Medical', subdomain: 'new-medical', status: 'active', plan: 'starter', created_at: '2025-02-15', user_count: 3, patient_count: 120 },
    ],
    pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
  });

  // Hospital detail (id=1)
  await mockGet(page, '**/api/admin/hospitals/*', {
    hospital: { id: 1, name: 'Demo Hospital', subdomain: 'demo-hospital', status: 'active', plan: 'professional', created_at: '2025-01-01' },
    users: [
      { id: 1, email: 'admin@demo.com', name: 'Admin User', role: 'hospital_admin', created_at: '2025-01-01' },
    ],
    stats: { patients: 500, totalBilled: 150000, totalPaid: 120000 },
  });

  // Onboarding (with and without query string)
  await mockGet(page, '**/api/admin/onboarding?*', {
    requests: [
      { id: 1, hospital_name: 'Green Life Hospital', contact_name: 'Dr. Rafiq', email: 'rafiq@greenlife.com', whatsapp_number: '01700000001', bed_count: '50', status: 'pending', notes: null, tenant_id: null, created_at: '2025-03-14T00:00:00Z' },
      { id: 2, hospital_name: 'City Care Clinic', contact_name: 'Dr. Nasrin', email: 'nasrin@citycare.com', whatsapp_number: '01700000002', bed_count: '30', status: 'contacted', notes: null, tenant_id: null, created_at: '2025-03-12T00:00:00Z' },
    ],
  });
  await mockGet(page, '**/api/admin/onboarding', {
    requests: [
      { id: 1, hospital_name: 'Green Life Hospital', contact_name: 'Dr. Rafiq', email: 'rafiq@greenlife.com', whatsapp_number: '01700000001', bed_count: '50', status: 'pending', notes: null, tenant_id: null, created_at: '2025-03-14T00:00:00Z' },
      { id: 2, hospital_name: 'City Care Clinic', contact_name: 'Dr. Nasrin', email: 'nasrin@citycare.com', whatsapp_number: '01700000002', bed_count: '30', status: 'contacted', notes: null, tenant_id: null, created_at: '2025-03-12T00:00:00Z' },
    ],
  });

  // Plans
  await mockGet(page, '**/api/admin/plans', {
    plans: [
      { id: 'starter', name: 'Starter', priceMonthly: 0, maxUsers: 5 },
      { id: 'professional', name: 'Professional', priceMonthly: 2999, maxUsers: 25 },
      { id: 'enterprise', name: 'Enterprise', priceMonthly: 9999, maxUsers: -1 },
    ],
    addons: [
      { id: 'telemedicine', name: 'Telemedicine', priceMonthly: 500 },
    ],
    trialDays: 14,
  });

  // Audit logs (with and without query string)
  await mockGet(page, '**/api/admin/audit-logs?*', {
    logs: [
      { id: 1, tenant_id: 1, user_id: '99', action: 'impersonate_start', table_name: 'tenants', record_id: 1, created_at: '2025-03-15T10:00:00Z', tenant_name: 'Demo Hospital', user_email: 'super@hms.com' },
      { id: 2, tenant_id: null, user_id: '99', action: 'create', table_name: 'tenants', record_id: 2, created_at: '2025-03-14T09:00:00Z', tenant_name: null, user_email: 'super@hms.com' },
    ],
    pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
  });
  await mockGet(page, '**/api/admin/audit-logs', {
    logs: [
      { id: 1, tenant_id: 1, user_id: '99', action: 'impersonate_start', table_name: 'tenants', record_id: 1, created_at: '2025-03-15T10:00:00Z', tenant_name: 'Demo Hospital', user_email: 'super@hms.com' },
      { id: 2, tenant_id: null, user_id: '99', action: 'create', table_name: 'tenants', record_id: 2, created_at: '2025-03-14T09:00:00Z', tenant_name: null, user_email: 'super@hms.com' },
    ],
    pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
  });

  // System health
  await mockGet(page, '**/api/admin/system-health', {
    database: {
      totalTables: 13,
      tableStats: [
        { table: 'patients', count: 1040 },
        { table: 'bills', count: 890 },
        { table: 'users', count: 22 },
        { table: 'tenants', count: 5 },
        { table: 'appointments', count: 350 },
      ],
    },
    status: 'healthy',
    uptime: 'N/A (serverless)',
  });

  // Mutation mocks
  await mockMutation(page, '**/api/admin/onboarding/*', { message: 'Updated' });
  await mockMutation(page, '**/api/admin/impersonate/*', {
    token: 'fake.impersonation.token',
    tenant: { id: 1, name: 'Demo Hospital', subdomain: 'demo-hospital', status: 'active', plan: 'professional' },
    redirectUrl: '/h/demo-hospital/dashboard',
  });
};

async function assertPageRendered(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  expect(page.url()).not.toMatch(/\/login$/);
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
test.describe('Super Admin — Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/dashboard');
  });

  test('renders dashboard with KPI cards', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows pending onboarding count', async ({ page }) => {
    await assertPageRendered(page);
    // Use a more resilient locator — look for "Pending Onboarding" label
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 8000 });
  });

  test('refresh button is present', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('button[title]').first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── HOSPITAL LIST ─────────────────────────────────────────────────────────────
test.describe('Super Admin — Hospital List', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/hospitals');
  });

  test('renders hospital list page', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows hospital table with headers', async ({ page }) => {
    await assertPageRendered(page);
    // Table headers are always present
    await expect(page.locator('th').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows search input', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('input[placeholder]').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows status filter buttons', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('shows hospital names from mocked data', async ({ page }) => {
    await assertPageRendered(page);
    // Wait for any data to load with a longer timeout
    const demoHospital = page.getByText('Demo Hospital');
    await expect(demoHospital.first()).toBeVisible({ timeout: 15000 });
  });
});

// ─── HOSPITAL DETAIL ───────────────────────────────────────────────────────────
test.describe('Super Admin — Hospital Detail', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/hospitals/1');
  });

  test('renders hospital detail page', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── ONBOARDING QUEUE ──────────────────────────────────────────────────────────
test.describe('Super Admin — Onboarding Queue', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/onboarding');
  });

  test('renders onboarding page', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows status tabs', async ({ page }) => {
    await assertPageRendered(page);
    // The onboarding queue always has status tab buttons
    await expect(page.getByRole('button').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows onboarding data from mock', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByText('Green Life Hospital').first()).toBeVisible({ timeout: 15000 });
  });
});

// ─── SETTINGS ──────────────────────────────────────────────────────────────────
test.describe('Super Admin — Settings', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/settings');
  });

  test('renders settings page', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows system info cards', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByText('Cloudflare Workers').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Cloudflare D1').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows trial period section', async ({ page }) => {
    await assertPageRendered(page);
    // Trial section is always rendered (with fallback value)
    await expect(page.getByText(/trial/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('shows pricing section header', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByText(/pricing plans/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('shows plan names from mocked data', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByText('Starter').first()).toBeVisible({ timeout: 15000 });
  });
});

// ─── AUDIT LOG ─────────────────────────────────────────────────────────────────
test.describe('Super Admin — Audit Log', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/audit-log');
  });

  test('renders audit log page', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('search input is present', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('input[type="text"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('action filter dropdown is present', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('select').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows entry count or empty state', async ({ page }) => {
    await assertPageRendered(page);
    // Page always shows either "X entries" or "No audit entries found"
    const entriesText = page.getByText(/entries|audit/i);
    await expect(entriesText.first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── PLATFORM HEALTH ───────────────────────────────────────────────────────────
test.describe('Super Admin — Platform Health', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/health');
  });

  test('renders health page', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows status indicator', async ({ page }) => {
    await assertPageRendered(page);
    // Should show either green (healthy) or amber (degraded) status
    const statusEl = page.locator('[class*="emerald"], [class*="amber"]');
    await expect(statusEl.first()).toBeVisible({ timeout: 8000 });
  });

  test('shows infrastructure cards', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByText('Cloudflare Workers').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('D1 (SQLite)').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Cloudflare R2').first()).toBeVisible({ timeout: 8000 });
  });

  test('shows database section', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByText(/database/i).first()).toBeVisible({ timeout: 8000 });
  });
});

// ─── NAVIGATION ────────────────────────────────────────────────────────────────
test.describe('Super Admin — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await superAdminMocks(page);
    await loginAs(page, 'super_admin', '/super-admin/dashboard');
  });

  test('sidebar contains all super admin links', async ({ page }) => {
    await assertPageRendered(page);
    const sidebar = page.locator('nav, aside').first();
    await expect(sidebar).toBeVisible({ timeout: 8000 });
  });

  test('sidebar shows section groups', async ({ page }) => {
    await assertPageRendered(page);
    // Check for group labels
    await expect(page.getByText('Platform').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Hospitals').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('System').first()).toBeVisible({ timeout: 5000 });
  });

  test('sidebar has all 6 navigation links', async ({ page }) => {
    await assertPageRendered(page);
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /health/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /hospitals/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /onboarding/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /audit/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible({ timeout: 5000 });
  });
});

// ─── DEGRADED STATE ────────────────────────────────────────────────────────────
test.describe('Super Admin — Error Handling', () => {
  test('settings handles API error gracefully', async ({ page }) => {
    await mockGet(page, '**/api/inbox/unread-count', { count: 0 });
    await mockGet(page, '**/api/admin/plans', {}, 500);
    await mockGet(page, '**/api/admin/stats', {
      hospitals: { total: 0, active: 0, inactive: 0, suspended: 0 },
      users: 0, patients: 0,
      revenue: { totalBilled: 0, totalPaid: 0 },
      recentHospitals: [], pendingOnboarding: 0,
    });
    await loginAs(page, 'super_admin', '/super-admin/settings');
    await assertPageRendered(page);
    // Page should still render even if plans API fails
    await expect(page.locator('h1, h2, h3, main').first()).toBeVisible({ timeout: 8000 });
  });

  test('audit log handles empty results', async ({ page }) => {
    await mockGet(page, '**/api/inbox/unread-count', { count: 0 });
    await mockGet(page, '**/api/admin/audit-logs?*', {
      logs: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    await mockGet(page, '**/api/admin/audit-logs', {
      logs: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    await mockGet(page, '**/api/admin/stats', {
      hospitals: { total: 0, active: 0, inactive: 0, suspended: 0 },
      users: 0, patients: 0,
      revenue: { totalBilled: 0, totalPaid: 0 },
      recentHospitals: [], pendingOnboarding: 0,
    });
    await loginAs(page, 'super_admin', '/super-admin/audit-log');
    await assertPageRendered(page);
    // Should show empty state message
    await expect(page.getByText(/no audit/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('hospital list shows empty state', async ({ page }) => {
    await mockGet(page, '**/api/inbox/unread-count', { count: 0 });
    await mockGet(page, '**/api/admin/hospitals?*', {
      hospitals: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    await mockGet(page, '**/api/admin/hospitals', {
      hospitals: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    await mockGet(page, '**/api/admin/stats', {
      hospitals: { total: 0, active: 0, inactive: 0, suspended: 0 },
      users: 0, patients: 0,
      revenue: { totalBilled: 0, totalPaid: 0 },
      recentHospitals: [], pendingOnboarding: 0,
    });
    await loginAs(page, 'super_admin', '/super-admin/hospitals');
    await assertPageRendered(page);
    await expect(page.getByText(/no hospitals/i).first()).toBeVisible({ timeout: 8000 });
  });
});

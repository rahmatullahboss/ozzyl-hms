import { test, expect, type Browser, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, loginDirectAndCache, type RoleAuthState } from '../helpers/prod-auth-cache';

const PASSWORD = process.env['E2E_PASSWORD'] || 'Demo@1234';
const MONTH = new Date().toISOString().slice(0, 7);
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_START = `${MONTH}-01`;

const ROLE_USERS = {
  reception: 'reception@demo-hospital.com',
  laboratory: 'lab@demo-hospital.com',
  md: 'md@demo-hospital.com',
  director: 'director@demo-hospital.com',
} as const;

const authStates: Partial<Record<keyof typeof ROLE_USERS, RoleAuthState>> = {};

async function getRoleAuth(role: keyof typeof ROLE_USERS): Promise<RoleAuthState> {
  if (!authStates[role]) {
    authStates[role] = await loginDirectAndCache(ROLE_USERS[role], PASSWORD, role);
  }
  return authStates[role]!;
}

function authHeaders(auth: RoleAuthState): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.token}`,
    'X-Tenant-Slug': auth.slug,
  };
}

async function openAuthedPage(browser: Browser, auth: RoleAuthState, route: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    localStorage.setItem('hms_token', token);
  }, auth.token);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

test.describe.serial('Production Onboarding E2E', () => {
  test('reception login returns token and correct role', async () => {
    const auth = await getRoleAuth('reception');
    expect(auth.user.role).toBe('reception');
    expect(auth.token).toBeTruthy();
    expect(auth.slug).toBeTruthy();
  });

  test('laboratory login returns token and correct role', async () => {
    const auth = await getRoleAuth('laboratory');
    expect(auth.user.role).toBe('laboratory');
    expect(auth.token).toBeTruthy();
  });

  test('md login returns token and correct role', async () => {
    const auth = await getRoleAuth('md');
    expect(auth.user.role).toBe('md');
    expect(auth.token).toBeTruthy();
  });

  test('director login returns token and correct role', async () => {
    const auth = await getRoleAuth('director');
    expect(auth.user.role).toBe('director');
    expect(auth.token).toBeTruthy();
  });

  test('reception APIs for patient onboarding and billing are healthy', async ({ request }) => {
    const auth = await getRoleAuth('reception');

    const patientsRes = await request.get(`${BASE_URL}/api/patients`, { headers: authHeaders(auth) });
    expect(patientsRes.status()).toBe(200);
    const patientsBody = await patientsRes.json();
    expect(Array.isArray(patientsBody.patients)).toBe(true);

    const billingRes = await request.get(`${BASE_URL}/api/billing`, { headers: authHeaders(auth) });
    expect(billingRes.status()).toBe(200);
    const billingBody = await billingRes.json();
    expect(Array.isArray(billingBody.bills)).toBe(true);

    const settingsRes = await request.get(`${BASE_URL}/api/settings`, { headers: authHeaders(auth) });
    expect(settingsRes.status()).toBe(200);
    const settingsBody = await settingsRes.json();
    expect(settingsBody.settings).toBeTruthy();
  });

  test('laboratory APIs expose queue and test data', async ({ request }) => {
    const auth = await getRoleAuth('laboratory');

    const testsRes = await request.get(`${BASE_URL}/api/tests`, { headers: authHeaders(auth) });
    expect(testsRes.status()).toBe(200);
    const testsBody = await testsRes.json();
    expect(Array.isArray(testsBody.tests)).toBe(true);

    const queueRes = await request.get(`${BASE_URL}/api/lab/orders/queue/today`, { headers: authHeaders(auth) });
    expect(queueRes.status()).toBe(200);
    const queueBody = await queueRes.json();
    expect(Array.isArray(queueBody.queue)).toBe(true);
  });

  test('md APIs expose daily summary and staff/accounting data', async ({ request }) => {
    const auth = await getRoleAuth('md');

    const dailyIncomeRes = await request.get(`${BASE_URL}/api/dashboard/daily-income`, { headers: authHeaders(auth) });
    expect(dailyIncomeRes.status()).toBe(200);

    const dailyExpensesRes = await request.get(`${BASE_URL}/api/dashboard/daily-expenses`, { headers: authHeaders(auth) });
    expect(dailyExpensesRes.status()).toBe(200);

    const staffRes = await request.get(`${BASE_URL}/api/staff`, { headers: authHeaders(auth) });
    expect(staffRes.status()).toBe(200);
    const staffBody = await staffRes.json();
    expect(Array.isArray(staffBody.staff)).toBe(true);

    const incomeRes = await request.get(`${BASE_URL}/api/income`, { headers: authHeaders(auth) });
    expect(incomeRes.status()).toBe(200);

    const expensesRes = await request.get(`${BASE_URL}/api/expenses`, { headers: authHeaders(auth) });
    expect(expensesRes.status()).toBe(200);
  });

  test('director APIs expose shareholder and profit data', async ({ request }) => {
    const auth = await getRoleAuth('director');

    const shareholdersRes = await request.get(`${BASE_URL}/api/shareholders`, { headers: authHeaders(auth) });
    expect(shareholdersRes.status()).toBe(200);
    const shareholdersBody = await shareholdersRes.json();
    expect(Array.isArray(shareholdersBody.shareholders)).toBe(true);

    const calcRes = await request.get(`${BASE_URL}/api/shareholders/calculate?month=${MONTH}`, { headers: authHeaders(auth) });
    expect(calcRes.status()).toBe(200);
    const calcBody = await calcRes.json();
    expect(calcBody.financials).toBeTruthy();
    expect(Array.isArray(calcBody.breakdown)).toBe(true);

    const plRes = await request.get(
      `${BASE_URL}/api/reports/pl?startDate=${MONTH_START}&endDate=${TODAY}`,
      { headers: authHeaders(auth) },
    );
    expect(plRes.status()).toBe(200);
  });

  test('reception browser routes render onboarding screens', async ({ browser }) => {
    const auth = await getRoleAuth('reception');
    const { context, page } = await openAuthedPage(browser, auth, `/h/${auth.slug}/reception/dashboard`);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/Dashboard|Billing|Patient/i);

    await page.goto(`${BASE_URL}/h/${auth.slug}/reception/patients/new`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toContainText(/Father|Husband|Guardian|Register Patient/i);

    await context.close();
  });

  test('laboratory browser dashboard renders queue/reporting UI', async ({ browser }) => {
    const auth = await getRoleAuth('laboratory');
    const { context, page } = await openAuthedPage(browser, auth, `/h/${auth.slug}/lab/dashboard`);

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/Laboratory|Test|Report/i);

    await context.close();
  });

  test('md browser dashboard renders financial overview without fetch error', async ({ browser }) => {
    const auth = await getRoleAuth('md');
    const { context, page } = await openAuthedPage(browser, auth, `/h/${auth.slug}/md/dashboard`);

    await expect(page).not.toHaveURL(/\/login/);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Failed to fetch data');
    expect(body).toMatch(/Managing Director Dashboard|Income Sources Today|Staff Overview/i);

    await context.close();
  });

  test('director browser dashboard renders shareholder/profit overview without fetch error', async ({ browser }) => {
    const auth = await getRoleAuth('director');
    const { context, page } = await openAuthedPage(browser, auth, `/h/${auth.slug}/director/dashboard`);

    await expect(page).not.toHaveURL(/\/login/);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Failed to fetch data');
    expect(body).toMatch(/Administration Dashboard|Shareholder|Profit/i);

    await context.close();
  });
});

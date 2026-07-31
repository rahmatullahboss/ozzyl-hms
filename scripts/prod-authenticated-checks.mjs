import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://hms.ozzyl.com';
const BASE_HOSTNAME = new URL(BASE_URL).hostname;
const PASSWORD = process.env.E2E_PASSWORD || 'Demo@1234';
const SLUG = process.env.E2E_SLUG || 'demo-hospital';
const PATIENT_EMAIL = process.env.E2E_PATIENT_EMAIL || 'e2e-portal@hms-test.local';
const PATIENT_PHONE = process.env.E2E_PATIENT_PHONE || '01811000001';
const WORKER_VERSION_OVERRIDE_ID = process.env.WORKER_VERSION_OVERRIDE_ID?.trim();
const VERSION_OVERRIDE_HEADERS = WORKER_VERSION_OVERRIDE_ID
  ? { 'Cloudflare-Workers-Version-Overrides': `hms-saas-production="${WORKER_VERSION_OVERRIDE_ID}"` }
  : {};

function mergeVersionOverrideHeaders(headers = {}) {
  return { ...VERSION_OVERRIDE_HEADERS, ...headers };
}

const roles = [
  { key: 'hospital_admin', email: 'admin@demo-hospital.com', route: `/h/${SLUG}/dashboard`, checks: [/Dashboard|Patients|Billing/i], endpoints: [{ path: '/api/dashboard', status: 200 }, { path: '/api/patients', status: 200 }, { path: '/api/staff', status: 200 }] },
  { key: 'reception', email: 'reception@demo-hospital.com', route: `/h/${SLUG}/reception/dashboard`, checks: [/Reception|Dashboard|Billing|Patient|Cash/i], endpoints: [{ path: '/api/dashboard', status: 403 }, { path: '/api/patients', status: 200 }, { path: '/api/billing', status: 200 }] },
  { key: 'laboratory', email: 'lab@demo-hospital.com', route: `/h/${SLUG}/lab/dashboard`, checks: [/Operational LIS Control Room|Laboratory Information System|LIS Control Room/i], endpoints: [{ path: '/api/dashboard', status: 403 }, { path: '/api/patients', status: 200 }, { path: '/api/tests', status: 200 }] },
  { key: 'md', email: 'md@demo-hospital.com', route: `/h/${SLUG}/md/dashboard`, checks: [/Managing Director|Dashboard|Income|Staff/i], endpoints: [{ path: '/api/dashboard', status: 200 }, { path: '/api/patients', status: 200 }, { path: '/api/staff', status: 200 }] },
  { key: 'director', email: 'director@demo-hospital.com', route: `/h/${SLUG}/director/dashboard`, checks: [/Director|Dashboard|Shareholder|Profit/i], endpoints: [{ path: '/api/dashboard', status: 200 }, { path: '/api/patients', status: 200 }, { path: '/api/staff', status: 200 }] },
  { key: 'pharmacist', email: 'pharmacy@demo-hospital.com', route: `/h/${SLUG}/pharmacy/dashboard`, checks: [/Pharmacy|Medicine|Stock/i], endpoints: [{ path: '/api/dashboard', status: 403 }, { path: '/api/patients', status: 200 }, { path: '/api/pharmacy/summary', status: 200 }] },
  { key: 'accountant', email: 'accounts@demo-hospital.com', route: `/h/${SLUG}/accountant/dashboard`, checks: [/Accounting|Income|Expense|Dashboard/i], endpoints: [{ path: '/api/dashboard', status: 200 }, { path: '/api/patients', status: 403 }, { path: '/api/income', status: 200 }] },
];

const ROLE_FILTER = process.env.E2E_ROLE?.trim();
const SELECTED_ROLES = ROLE_FILTER ? roles.filter((role) => role.key === ROLE_FILTER) : roles;
const SKIP_PATIENT = process.env.E2E_SKIP_PATIENT === '1';

if (ROLE_FILTER && SELECTED_ROLES.length === 0) {
  throw new Error(`Unknown E2E_ROLE: ${ROLE_FILTER}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: mergeVersionOverrideHeaders(options.headers),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

async function loginRole(email) {
  const { response, body } = await jsonFetch('/api/auth/login-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });

  if (!response.ok || !body?.token) {
    throw new Error(`${email} login failed: ${response.status}`);
  }

  return body;
}

async function checkRoleApi(auth, endpoints) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.token}`,
    'X-Tenant-Slug': auth.slug,
  };

  const failures = [];
  for (const endpoint of endpoints) {
    const { response } = await jsonFetch(endpoint.path, { headers });
    if (response.status !== endpoint.status) {
      failures.push(`${endpoint.path} -> ${response.status} (expected ${endpoint.status})`);
    }
  }
  return failures;
}

async function checkRoleBrowser(browser, auth, role) {
  const context = await browser.newContext({
    locale: 'en-US',
    serviceWorkers: 'block',
    extraHTTPHeaders: VERSION_OVERRIDE_HEADERS,
  });
  await context.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
  const page = await context.newPage();
  const pageErrors = [];
  const api500s = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(`${BASE_URL}/api/`) && response.status() >= 500) {
      api500s.push(`${response.status()} ${response.url()}`);
    }
  });

  const roleRoute = role.route.replace(`/h/${SLUG}/`, `/h/${auth.slug}/`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#email').fill(role.email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();

  const loginDeadline = Date.now() + 30_000;
  while (new URL(page.url()).pathname === '/login' && Date.now() < loginDeadline) {
    const hospitalButton = page.locator('button').filter({ hasText: `/${auth.slug}` }).first();
    if (await hospitalButton.isVisible().catch(() => false)) {
      await hospitalButton.click();
    }
    await wait(250);
  }

  const deadline = Date.now() + 20_000;
  let body = '';
  let matched = false;

  while (Date.now() < deadline) {
    body = await page.locator('body').innerText().catch(() => '');
    matched = new URL(page.url()).pathname === roleRoute && role.checks.some((pattern) => pattern.test(body));
    if (matched) break;
    await wait(500);
  }

  if (!matched) {
    body = await page.locator('body').innerText().catch(() => body);
    matched = new URL(page.url()).pathname === roleRoute && role.checks.some((pattern) => pattern.test(body));
  }
  const finalUrl = page.url();
  const headings = matched
    ? []
    : (await page.locator('h1, h2').allInnerTexts().catch(() => [])).slice(0, 8);
  await context.close();

  return {
    matched,
    pageErrors,
    api500s,
    finalUrl,
    headings,
  };
}

async function loginOrRegisterPatient() {
  const login = await jsonFetch('/api/patient-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: PATIENT_EMAIL, password: PASSWORD }),
  });

  if (login.response.ok && login.body?.token) {
    return login.body;
  }

  if (login.response.status === 429) {
    await wait(45_000);
    return loginOrRegisterPatient();
  }

  if (login.response.status !== 401) {
    throw new Error(`patient login failed: ${login.response.status}`);
  }

  const register = await jsonFetch('/api/patient-auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Mohammad Ali',
      email: PATIENT_EMAIL,
      phone: PATIENT_PHONE,
      password: PASSWORD,
    }),
  });

  if (register.response.status === 429) {
    await wait(45_000);
    return loginOrRegisterPatient();
  }

  if (!register.response.ok || !register.body?.token) {
    throw new Error(`patient register failed: ${register.response.status}`);
  }

  return register.body;
}

async function checkPatient(browser, auth) {
  const dashboard = await jsonFetch('/api/global-portal/dashboard', {
    headers: { Authorization: `Bearer ${auth.token}` },
  });

  if (dashboard.response.status !== 200) {
    return {
      ok: false,
      reason: `global dashboard -> ${dashboard.response.status}`,
    };
  }

  const context = await browser.newContext({
    locale: 'en-US',
    serviceWorkers: 'block',
    extraHTTPHeaders: VERSION_OVERRIDE_HEADERS,
    storageState: {
      cookies: [
        {
          name: 'phr_token',
          value: auth.token,
          domain: BASE_HOSTNAME,
          path: '/',
          secure: true,
          sameSite: 'None',
          httpOnly: false,
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'global_patient_user', value: JSON.stringify(auth.user) },
            { name: 'i18nextLng', value: 'en' },
          ],
        },
      ],
    },
  });

  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (!response.url().startsWith(`${BASE_URL}/api/`)) {
      return;
    }

    const status = response.status();
    const url = response.url();
    if (status >= 500 || status === 401 || status === 403 || status === 404 || status === 429) {
      apiFailures.push(`${status} ${url}`);
    }
  });

  await page.goto(`${BASE_URL}/patient/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const text = document.body?.innerText || '';
    return (
      text.includes('Overview') ||
      text.includes('Hospital Services') ||
      text.includes("Today's Guidance") ||
      text.includes('প্রোফাইল completion বাকি আছে') ||
      text.includes('Data Tab-এ যান')
    );
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  for (const tab of ['Hospital Services', 'Global Records', 'My Health Vault', 'Self-Reported Data', 'Privacy & Access']) {
    const button = page.getByRole('button', { name: tab });
    if (await button.count()) {
      await button.first().click();
      await page.waitForTimeout(1200);
    }
  }

  const body = await page.locator('body').innerText();
  await context.close();

  const hasExpectedDashboardMarker =
    /Overview|Global|Guidance|Hospital/i.test(body) ||
    /প্রোফাইল completion বাকি আছে|Data Tab-এ যান/i.test(body);

  return {
    ok: hasExpectedDashboardMarker && pageErrors.length === 0 && apiFailures.length === 0,
    reason: pageErrors[0] || apiFailures[0] || null,
  };
}

async function main() {
  if (WORKER_VERSION_OVERRIDE_ID) {
    const health = await jsonFetch('/api/health');
    if (!health.response.ok || health.body?.workerVersionId !== WORKER_VERSION_OVERRIDE_ID) {
      throw new Error(`candidate health version mismatch: ${health.response.status}`);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const failures = [];

  try {
    for (const role of SELECTED_ROLES) {
      const auth = await loginRole(role.email);
      const apiFailures = await checkRoleApi(auth, role.endpoints);
      const browserResult = await checkRoleBrowser(browser, auth, role);

      failures.push(...apiFailures.map((failure) => `${role.key}: ${failure}`));
      if (!browserResult.matched) {
        const diagnostics = browserResult.headings.length > 0
          ? `headings=${browserResult.headings.join(' | ')}`
          : 'no headings rendered';
        failures.push(`${role.key}: browser content mismatch (${browserResult.finalUrl}; ${diagnostics})`);
      }
      failures.push(...browserResult.pageErrors.map((error) => `${role.key}: pageerror ${error}`));
      failures.push(...browserResult.api500s.map((error) => `${role.key}: ${error}`));
    }

    if (!SKIP_PATIENT) {
      try {
        const patientAuth = await loginOrRegisterPatient();
        const patientResult = await checkPatient(browser, patientAuth);
        if (!patientResult.ok) {
          failures.push(`patient: ${patientResult.reason ?? 'dashboard failed'}`);
        }
      } catch (error) {
        failures.push(`patient: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error('Authenticated production checks failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Authenticated production checks passed.');
}

await main();

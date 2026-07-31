import { chromium } from '@playwright/test';
const BASE_URL = 'https://hms-saas-production.rahmatullahzisan.workers.dev';
const PASSWORD = 'Demo@1234';
const PATIENT_EMAIL = 'e2e-portal@hms-test.local';
async function jsonFetch(path, options = {}) {
  const response = await fetch(BASE_URL + path, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}
const login = await jsonFetch('/api/patient-auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: PATIENT_EMAIL, password: PASSWORD }),
});
if (!login.response.ok || !login.body?.token) {
  throw new Error('login failed ' + login.response.status + ' ' + JSON.stringify(login.body));
}
const auth = login.body;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-US',
  serviceWorkers: 'block',
  storageState: {
    cookies: [{
      name: 'phr_token',
      value: auth.token,
      domain: 'hms-saas-production.rahmatullahzisan.workers.dev',
      path: '/',
      secure: true,
      sameSite: 'None',
      httpOnly: false,
      expires: Math.floor(Date.now() / 1000) + 3600,
    }],
    origins: [{
      origin: BASE_URL,
      localStorage: [
        { name: 'global_patient_user', value: JSON.stringify(auth.user) },
        { name: 'i18nextLng', value: 'en' },
      ],
    }],
  },
});
const page = await context.newPage();
const pageErrors = [];
const apiFailures = [];
const seen = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('response', async (response) => {
  const url = response.url();
  if (!url.startsWith(BASE_URL + '/api/')) return;
  const status = response.status();
  seen.push({ status, url });
  if (status >= 400) {
    let body = '';
    try { body = await response.text(); } catch {}
    apiFailures.push({ status, url, body });
  }
});
await page.goto(BASE_URL + '/patient/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3500);
for (const tab of ['Hospital Services', 'Global Records', 'My Health Vault', 'Self-Reported Data', 'Privacy & Access']) {
  const button = page.getByRole('button', { name: tab });
  if (await button.count()) {
    await button.first().click();
    await page.waitForTimeout(1200);
  }
}
const bodyText = await page.locator('body').innerText();
console.log('BODY_START');
console.log(bodyText.slice(0, 2500));
console.log('BODY_END');
console.log('PAGE_ERRORS', JSON.stringify(pageErrors, null, 2));
console.log('API_FAILURES', JSON.stringify(apiFailures, null, 2));
console.log('SEEN_LAST', JSON.stringify(seen.slice(-40), null, 2));
await context.close();
await browser.close();

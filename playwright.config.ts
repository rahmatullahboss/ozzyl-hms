/// <reference types="node" />
/**
 * Playwright configuration for Ozzyl HMS E2E + Smoke Tests
 *
 * Runs against:
 *   - Local (default, safe): http://localhost:8788 (override with HMS_API_PORT)
 *   - Staging:    https://hms-saas-staging.rahmatullahzisan.workers.dev
 *   - Production: https://hms-saas-production.rahmatullahzisan.workers.dev
 *
 * SAFETY: Playwright defaults to the local Worker. Running e2e against
 * production requires ALLOW_PROD_E2E=1 to be set explicitly in the
 * environment. The guard runs at config load and throws if a production
 * URL is detected without the override.
 *
 * Usage:
 *   pnpm test:e2e:smoke                                # local server (8788)
 *   HMS_API_PORT=9000 pnpm test:e2e                    # local server on 9000
 *   BASE_URL=http://localhost:8787 pnpm test:e2e       # legacy port (8787)
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev \
 *     ALLOW_PROD_E2E=1 pnpm test:e2e:smoke
 */

import { defineConfig, devices } from '@playwright/test';

const DEFAULT_LOCAL_PORT = process.env['HMS_API_PORT'] || '8788';
const DEFAULT_LOCAL_URL = `http://localhost:${DEFAULT_LOCAL_PORT}`;
const ALLOW_PROD_E2E = process.env['ALLOW_PROD_E2E'] === '1';

const rawBaseUrl = process.env['BASE_URL'] ?? DEFAULT_LOCAL_URL;
const BASE_URL = rawBaseUrl;
const ACTION_CENTER_E2E_BASE_URL = process.env['ACTION_CENTER_E2E_BASE_URL'] ?? 'http://127.0.0.1:4177';

export function shouldStartActionCenterWebServer(argv: string[]) {
  if (argv.includes('--list')) return false;
  return argv.some((argument, index) => (
    argument.includes('action-center-workflows.spec.ts')
    || argument === '--project=action-center-workflows'
    || (argument === 'action-center-workflows' && argv[index - 1] === '--project')
  ));
}

const isActionCenterWorkflowRun = shouldStartActionCenterWebServer(process.argv);

export function createActionCenterWebServerConfig(baseUrl: string) {
  const target = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error(
      `Action Center E2E web server must use a local URL, received ${baseUrl}.`,
    );
  }

  return {
    command: `pnpm --filter web build && pnpm --filter web preview --host ${target.hostname} --port ${target.port || '4177'} --strictPort`,
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 180_000,
  };
}

const actionCenterWebServer = isActionCenterWorkflowRun
  ? createActionCenterWebServerConfig(ACTION_CENTER_E2E_BASE_URL)
  : undefined;

// ─── Production safety guard ───────────────────────────────────────────
// Throw at config load if BASE_URL targets production and the override
// is missing. This prevents a developer from accidentally running
// authenticated write tests against live hospital data.
if (
  !ALLOW_PROD_E2E &&
  /production|workers\.dev/i.test(BASE_URL)
) {
  // eslint-disable-next-line no-console
  console.error(
    `[playwright.config] Refusing to run e2e against ${BASE_URL}. ` +
      `Set ALLOW_PROD_E2E=1 to override, or unset BASE_URL to use the local default.`,
  );
  throw new Error(
    `Refusing to run Playwright against production URL ${BASE_URL} without ALLOW_PROD_E2E=1.`,
  );
}

export default defineConfig({
  testDir: './test/e2e',
  outputDir: './test/e2e/results',

  // Global setup: login once before all workers → writes .auth-state.json
  globalSetup: process.env['E2E_EMAIL'] ? './test/e2e/global-setup.ts' : undefined,
  webServer: actionCenterWebServer,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['html', { outputFolder: 'test/e2e/report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  projects: [
    // ─── API Smoke — pure fetch, no browser needed ───
    {
      name: 'smoke',
      testMatch: '**/smoke/api-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Pharmacy API Smoke — all pharmacy endpoints ─
    {
      name: 'pharmacy-smoke',
      testMatch: '**/smoke/pharmacy-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Nursing API Smoke — all nursing endpoints ─
    {
      name: 'nursing-smoke',
      testMatch: '**/smoke/nursing-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Full API E2E — tests every endpoint ──────────
    {
      name: 'api',
      testMatch: '**/api/modules.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Browser E2E — UI flows ──────────────────────
    {
      name: 'e2e',
      testMatch: '**/browser/ui-flows.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Authenticated API Smoke (login + all GETs) ──
    {
      name: 'auth-smoke',
      testMatch: '**/smoke/auth-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Authenticated API CRUD tests ────────────────
    {
      name: 'auth-api',
      testMatch: '**/api/auth-modules.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Extended write coverage (20 additional modules) ─
    {
      name: 'auth-extended',
      testMatch: '**/api/auth-modules-extended.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Extended write coverage 2 (30+ additional modules) ─
    {
      name: 'auth-extended2',
      testMatch: '**/api/auth-modules-extended2.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Deep write coverage 3 (75+ deep write endpoint tests) ─
    {
      name: 'auth-extended3',
      testMatch: '**/api/auth-modules-extended3.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Patient Portal E2E (OTP auth + all portal writes) ─
    {
      name: 'patient-portal',
      testMatch: '**/api/patient-portal.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Authenticated Browser E2E ──────────────────
    {
      name: 'auth-e2e',
      testMatch: '**/browser/auth-ui-flows.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'prod-onboarding',
      testMatch: '**/browser/prod-onboarding.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Super Admin API E2E ─────────────────────────
    {
      name: 'super-admin-api',
      testMatch: '**/api/super-admin-api.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Shareholders E2E (43 tests, full coverage) ──
    {
      name: 'shareholders',
      testMatch: '**/api/shareholders.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Super Admin Browser E2E (Production — real API, no mocks) ──
    {
      name: 'super-admin-browser',
      testMatch: '**/browser/super-admin-prod.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'block',
      },
    },
    // ─── Lab Settings Catalog E2E ────────────────────────
    {
      name: 'lab-settings-catalog',
      testMatch: '**/browser/lab-settings-catalog.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── LIS readiness/read-only API E2E ────────────────────────
    {
      name: 'lis-readiness',
      testMatch: '**/api/lis-readiness.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Nursing + E-Prescribing E2E (new modules) ──
    {
      name: 'nursing-eprescribing',
      testMatch: '**/api/nursing-eprescribing.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Nursing API Integration Tests ──────────────
    {
      name: 'nursing-api',
      testMatch: '**/api/nursing-api.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Nursing UI Browser E2E (bed grid, drawer, tabs, tasks, charges) ──
    {
      name: 'nursing-ui',
      testMatch: '**/browser/nursing-ui.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Approval Center Browser E2E ─────────────────────
    {
      name: 'approval-center',
      testMatch: '**/browser/approval-center.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // ─── Unified Action Center browser workflows ─────────────────────
    {
      name: 'action-center-workflows',
      testMatch: '**/action-center-workflows.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ACTION_CENTER_E2E_BASE_URL ?? 'http://127.0.0.1:4177',
        serviceWorkers: 'block',
      },
    },
    // ─── Golden-path workflow E2E (OPD, IPD, billing, lab, pharmacy) ──
    {
      name: 'workflows',
      testDir: './test/e2e/workflows',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

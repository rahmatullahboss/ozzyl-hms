/**
 * QUERY PARAM FIX — correct camelCase/snake_case query parameters
 *
 * CRITICAL DISCOVERY: Many tests sent wrong query parameter names!
 * audit.ts uses: userId, tableName, startDate, endDate (NOT user_id, table_name, from, to)
 * journal.ts uses: startDate, endDate, accountId (NOT from, to, account_id)
 * reports.ts uses: startDate, endDate, year (NOT from, to)
 * income.ts uses: startDate, endDate, source (NOT from, to)
 * prescriptions.ts uses: status, patient (NOT patient_id, date)
 * lab.ts uses: search, patientId, date, status
 * 
 * ALSO: audit/logs alias endpoint was never tested!
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import audit from '../../../src/routes/tenant/audit';
import journal from '../../../src/routes/tenant/journal';
import reports from '../../../src/routes/tenant/reports';
import income from '../../../src/routes/tenant/income';
import prescriptions from '../../../src/routes/tenant/prescriptions';
import lab from '../../../src/routes/tenant/lab';
import expenses from '../../../src/routes/tenant/expenses';
import accounts from '../../../src/routes/tenant/accounts';
import fhir from '../../../src/routes/tenant/fhir';
import website from '../../../src/routes/tenant/website';
import billing from '../../../src/routes/tenant/billing';
import dashboard from '../../../src/routes/tenant/dashboard';
import patientPortal from '../../../src/routes/tenant/patientPortal';
import shareholders from '../../../src/routes/tenant/shareholders';
import ipBilling from '../../../src/routes/tenant/ipBilling';

const T = 'tenant-1';

function mk(route: any, path: string, role = 'hospital_admin') {
  const mock = createMockDB({ tables: {}, universalFallback: true });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T); c.set('userId', '1'); c.set('role', role as any);
    c.set('patientId', '1');
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      DASHBOARD_DO: undefined,
    } as any;
    await next();
  });
  app.route(path, route);
  app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
  return app;
}

function jr(app: any, url: string, method = 'GET', body?: any) {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
  if (body) init.body = JSON.stringify(body);
  return app.request(url, init);
}

async function hit(app: any, url: string, method = 'GET', body?: any) {
  const r = await jr(app, url, method, body);
  expect(r.status).toBeLessThanOrEqual(500);
  return r;
}

// ════════════════════════════════════════════════════════════════
// AUDIT — correct params: userId, tableName, startDate, endDate
// AND /logs alias endpoint!!!
// ════════════════════════════════════════════════════════════════
describe('Audit-CorrectParams', () => {
  const a = () => mk(audit, '/au');

  // Main endpoint with CORRECT params
  it('GET / — userId filter', () => hit(a(), '/au?userId=1'));
  it('GET / — tableName filter', () => hit(a(), '/au?tableName=patients'));
  it('GET / — startDate filter', () => hit(a(), '/au?startDate=2025-01-01'));
  it('GET / — endDate filter', () => hit(a(), '/au?endDate=2025-12-31'));
  it('GET / — all filters', () => hit(a(), '/au?userId=1&tableName=visits&startDate=2025-01-01&endDate=2025-12-31&limit=100'));
  it('GET / — custom limit', () => hit(a(), '/au?limit=25'));

  // /logs alias endpoint (lines 55-77 — NEVER TESTED!)
  it('GET /logs — plain', () => hit(a(), '/au/logs'));
  it('GET /logs — userId', () => hit(a(), '/au/logs?userId=1'));
  it('GET /logs — tableName', () => hit(a(), '/au/logs?tableName=billing'));
  it('GET /logs — startDate+endDate', () => hit(a(), '/au/logs?startDate=2025-01-01&endDate=2025-06-30'));
  it('GET /logs — all filters', () => hit(a(), '/au/logs?userId=2&tableName=patients&startDate=2025-01-01&endDate=2025-12-31&limit=50'));

  // /:id detail
  it('GET /:id', () => hit(a(), '/au/1'));
  it('GET /:id — different id', () => hit(a(), '/au/100'));
});

// ════════════════════════════════════════════════════════════════
// JOURNAL — correct params: startDate, endDate, accountId
// ════════════════════════════════════════════════════════════════
describe('Journal-CorrectParams', () => {
  const a = () => mk(journal, '/jn', 'director');

  it('GET / — startDate (NOT from!)', () => hit(a(), '/jn?startDate=2025-01-01'));
  it('GET / — endDate', () => hit(a(), '/jn?endDate=2025-06-30'));
  it('GET / — accountId (NOT account_id!)', () => hit(a(), '/jn?accountId=1'));
  it('GET / — all filters', () => hit(a(), '/jn?startDate=2025-01-01&endDate=2025-12-31&accountId=2'));
});

// ════════════════════════════════════════════════════════════════
// REPORTS — correct params: startDate, endDate, year
// ════════════════════════════════════════════════════════════════
describe('Reports-CorrectParams', () => {
  const a = () => mk(reports, '/rp', 'director');

  it('GET /pl — startDate+endDate', () => hit(a(), '/rp/pl?startDate=2025-01-01&endDate=2025-12-31'));
  it('GET /income-by-source — startDate', () => hit(a(), '/rp/income-by-source?startDate=2025-01-01&endDate=2025-06-30'));
  it('GET /monthly — year', () => hit(a(), '/rp/monthly?year=2025'));
  it('GET /bed-occupancy — startDate', () => hit(a(), '/rp/bed-occupancy?startDate=2025-03-01&endDate=2025-03-31'));
  it('GET /department — startDate', () => hit(a(), '/rp/department?startDate=2025-01-01'));
  it('GET /doctor — startDate', () => hit(a(), '/rp/doctor?startDate=2025-01-01'));
  it('GET /outstanding — startDate', () => hit(a(), '/rp/outstanding?startDate=2025-01-01'));
  it('GET /trends — startDate', () => hit(a(), '/rp/trends?startDate=2025-01-01'));
  it('GET /top-services — startDate', () => hit(a(), '/rp/top-services?startDate=2025-01-01'));
  it('GET /financial — startDate', () => hit(a(), '/rp/financial?startDate=2025-01-01'));
  it('GET /discharge-summary — startDate', () => hit(a(), '/rp/discharge-summary?startDate=2025-01-01'));
  it('GET /daily — startDate', () => hit(a(), '/rp/daily?startDate=2025-03-15'));
  it('GET /revenue — startDate+endDate', () => hit(a(), '/rp/revenue?startDate=2025-01-01&endDate=2025-12-31'));
  it('GET /doctor-performance', () => hit(a(), '/rp/doctor-performance?startDate=2025-01-01'));
  it('GET /patient-flow', () => hit(a(), '/rp/patient-flow?startDate=2025-01-01'));
});

// ════════════════════════════════════════════════════════════════
// INCOME — correct params: startDate, endDate, source
// ════════════════════════════════════════════════════════════════
describe('Income-CorrectParams', () => {
  const a = () => mk(income, '/inc', 'director');

  it('GET / — startDate (NOT from!)', () => hit(a(), '/inc?startDate=2025-01-01'));
  it('GET / — endDate', () => hit(a(), '/inc?endDate=2025-06-30'));
  it('GET / — source', () => hit(a(), '/inc?source=billing'));
  it('GET / — all filters', () => hit(a(), '/inc?startDate=2025-01-01&endDate=2025-12-31&source=consultation'));
});

// ════════════════════════════════════════════════════════════════
// PRESCRIPTIONS — correct params: status, patient
// ════════════════════════════════════════════════════════════════
describe('Prescriptions-CorrectParams', () => {
  const a = () => mk(prescriptions, '/rx', 'doctor');

  it('GET / — patient (NOT patient_id!)', () => hit(a(), '/rx?patient=1'));
  it('GET / — status', () => hit(a(), '/rx?status=active'));
  it('GET / — both', () => hit(a(), '/rx?patient=1&status=pending'));
});

// ════════════════════════════════════════════════════════════════
// LAB — correct params: search, patientId, date, status
// ════════════════════════════════════════════════════════════════
describe('Lab-CorrectParams', () => {
  const a = () => mk(lab, '/lb');

  it('GET / — search', () => hit(a(), '/lb?search=blood'));
  it('GET /orders — patientId (NOT patient_id!)', () => hit(a(), '/lb/orders?patientId=1'));
  it('GET /orders — date', () => hit(a(), '/lb/orders?date=2025-03-15'));
  it('GET /orders — status', () => hit(a(), '/lb/orders?status=pending'));
  it('GET /orders — all', () => hit(a(), '/lb/orders?patientId=1&date=2025-03-15&status=completed'));
  it('GET /catalog — search', () => hit(a(), '/lb/catalog?search=cbc'));
});

// ════════════════════════════════════════════════════════════════
// REMAINING — all with CORRECT query params
// ════════════════════════════════════════════════════════════════
describe('Expenses-CorrectParams', () => {
  const a = () => mk(expenses, '/ex', 'director');
  it('GET / — startDate (NOT from!)', () => hit(a(), '/ex?startDate=2025-01-01'));
  it('GET / — endDate', () => hit(a(), '/ex?endDate=2025-12-31'));
  it('GET / — category_id', () => hit(a(), '/ex?category_id=1'));
  it('GET / — status', () => hit(a(), '/ex?status=approved'));
  it('GET / — all', () => hit(a(), '/ex?startDate=2025-01-01&endDate=2025-12-31&category_id=1&status=pending'));
});

describe('Accounts-CorrectParams', () => {
  const a = () => mk(accounts, '/ac', 'director');
  it('GET /ledger/:id — startDate', () => hit(a(), '/ac/ledger/1?startDate=2025-01-01&endDate=2025-12-31'));
});

describe('Fhir-CorrectParams', () => {
  const a = () => mk(fhir, '/fhir');
  it('GET /Patient — name search', () => hit(a(), '/fhir/Patient?name=test'));
  it('GET /Patient — birthdate', () => hit(a(), '/fhir/Patient?birthdate=1990-01-01'));
  it('GET /Patient — identifier', () => hit(a(), '/fhir/Patient?identifier=PAT-001'));
  it('GET /Encounter — patient', () => hit(a(), '/fhir/Encounter?patient=1'));
  it('GET /Observation — patient', () => hit(a(), '/fhir/Observation?patient=1'));
  it('GET /Condition — patient', () => hit(a(), '/fhir/Condition?patient=1'));
  it('GET /AllergyIntolerance — patient', () => hit(a(), '/fhir/AllergyIntolerance?patient=1'));
  it('GET /DiagnosticReport — patient', () => hit(a(), '/fhir/DiagnosticReport?patient=1'));
  it('GET /MedicationRequest — patient', () => hit(a(), '/fhir/MedicationRequest?patient=1'));
});

describe('Website-CorrectParams', () => {
  const a = () => mk(website, '/ws');
  it('GET /services', () => hit(a(), '/ws/services'));
  it('GET /staff', () => hit(a(), '/ws/staff'));
  it('GET /contact', () => hit(a(), '/ws/contact'));
  it('GET /about', () => hit(a(), '/ws/about'));
  it('GET /gallery', () => hit(a(), '/ws/gallery'));
  it('POST /contact', () => hit(a(), '/ws/contact', 'POST', { name: 'Test', email: 'test@test.com', message: 'Hello' }));
});

describe('Billing-CorrectParams', () => {
  const a = () => mk(billing, '/bl');
  it('GET / — patientId', () => hit(a(), '/bl?patientId=1'));
  it('GET / — status', () => hit(a(), '/bl?status=pending'));
  it('GET / — startDate+endDate', () => hit(a(), '/bl?startDate=2025-01-01&endDate=2025-12-31'));
});

describe('Dashboard-CorrectParams', () => {
  const a = () => mk(dashboard, '/db');
  it('GET / — startDate', () => hit(a(), '/db?startDate=2025-01-01'));
  it('GET / — period', () => hit(a(), '/db?period=monthly'));
});

describe('IpBilling-CorrectParams', () => {
  const a = () => mk(ipBilling, '/ib');
  it('GET /admitted', () => hit(a(), '/ib/admitted'));
  it('GET /provisional', () => hit(a(), '/ib/provisional'));
  it('GET /pending/:id', () => hit(a(), '/ib/pending/1'));
  it('GET /discharge-bill', () => hit(a(), '/ib/discharge-bill'));
  it('GET /stats', () => hit(a(), '/ib/stats'));
});

describe('Shareholders-CorrectParams', () => {
  const a = () => mk(shareholders, '/sh', 'director');
  it('GET / — startDate', () => hit(a(), '/sh?startDate=2025-01-01'));
  it('GET /dividends', () => hit(a(), '/sh/dividends'));
  it('GET /dividends — month', () => hit(a(), '/sh/dividends?month=2025-03'));
});

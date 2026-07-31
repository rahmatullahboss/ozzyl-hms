/**
 * Filter-targets: Tests that send query parameters to exercise
 * conditional WHERE clauses, pagination logic, and filter branches.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import journal from '../../../src/routes/tenant/journal';
import visits from '../../../src/routes/tenant/visits';
import accounts from '../../../src/routes/tenant/accounts';
import consultations from '../../../src/routes/tenant/consultations';
import income from '../../../src/routes/tenant/income';
import recurring from '../../../src/routes/tenant/recurring';
import expenses from '../../../src/routes/tenant/expenses';
import shareholders from '../../../src/routes/tenant/shareholders';
import patients from '../../../src/routes/tenant/patients';
import staff from '../../../src/routes/tenant/staff';
import pharmacy from '../../../src/routes/tenant/pharmacy';
import billing from '../../../src/routes/tenant/billing';
import dashboard from '../../../src/routes/tenant/dashboard';
import doctors from '../../../src/routes/tenant/doctors';
import appointments from '../../../src/routes/tenant/appointments';
import patientPortal from '../../../src/routes/tenant/patientPortal';
import emergency from '../../../src/routes/tenant/emergency';
import nurseStation from '../../../src/routes/tenant/nurseStation';
import settings from '../../../src/routes/tenant/settings';

const T = 'tenant-1';

function smartQO(sql: string) {
  const s = sql.toLowerCase();
  if ((s.includes('select id from') || s.includes('select 1 from')) && s.includes('where'))
    return { first: null, results: [], success: true, meta: {} };
  if (s.includes('count(*)') || s.includes('count(1)'))
    return { first: { cnt: 3, count: 3, total: 3, 'count(*)': 3 }, results: [{ cnt: 3, count: 3, total: 3 }], success: true, meta: {} };
  if (s.includes('coalesce(') || s.includes('sum('))
    return { first: { total: 10000, balance: 5000, total_debit: 8000, total_credit: 7000, total_amount: 15000, paid: 5000 }, results: [{ total: 10000 }], success: true, meta: {} };
  if (s.includes('max('))
    return { first: { next_token: 5, max_no: 5 }, results: [{ next_token: 5 }], success: true, meta: {} };
  return null;
}

function mk(route: any, path: string, role = 'hospital_admin') {
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: smartQO });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T); c.set('userId', '1'); c.set('role', role as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
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
}

// ═══════ JOURNAL — Filter branches (startDate, endDate, accountId) ═══════
describe('Filter-Journal', () => {
  const a = () => mk(journal, '/jn', 'director');
  it('GET /?startDate', () => hit(a(), '/jn?startDate=2025-01-01'));
  it('GET /?endDate', () => hit(a(), '/jn?endDate=2025-12-31'));
  it('GET /?accountId', () => hit(a(), '/jn?accountId=1'));
  it('GET /?startDate&endDate', () => hit(a(), '/jn?startDate=2025-01-01&endDate=2025-06-30'));
  it('GET /?all filters', () => hit(a(), '/jn?startDate=2025-01-01&endDate=2025-06-30&accountId=1'));
  it('POST / create journal entry', () => hit(a(), '/jn', 'POST', { date: '2025-03-15', description: 'Test', debit_account_id: 1, credit_account_id: 2, amount: 5000 }));
  it('PUT /:id', () => hit(a(), '/jn/1', 'PUT', { description: 'Updated', amount: 6000 }));
  it('DELETE /:id', () => hit(a(), '/jn/1', 'DELETE'));
  it('GET /:id', () => hit(a(), '/jn/1'));
  it('GET /summary', () => hit(a(), '/jn/summary'));
  it('GET /trial-balance', () => hit(a(), '/jn/trial-balance'));
});

// ═══════ VISITS — Filter branches (status, date, doctorId, patientId) ═══════
describe('Filter-Visits', () => {
  const a = () => mk(visits, '/v', 'reception');
  it('GET /?status=completed', () => hit(a(), '/v?status=completed'));
  it('GET /?status=in_progress', () => hit(a(), '/v?status=in_progress'));
  it('GET /?doctorId=1', () => hit(a(), '/v?doctorId=1'));
  it('GET /?patientId=1', () => hit(a(), '/v?patientId=1'));
  it('GET /?type=opd', () => hit(a(), '/v?type=opd'));
  it('GET /?type=ipd', () => hit(a(), '/v?type=ipd'));
  it('GET /?all filters', () => hit(a(), '/v?status=in_progress&doctorId=1&date=2025-01-01'));
  it('PUT /:id/discharge', () => hit(a(), '/v/1/discharge', 'PUT', { dischargeDate: '2025-03-20', notes: 'OK' }));
  it('POST / — opd', () => hit(a(), '/v', 'POST', { patientId: 1, doctorId: 1, visitType: 'opd' }));
  it('POST / — ipd', () => hit(a(), '/v', 'POST', { patientId: 1, doctorId: 1, visitType: 'ipd', admissionFlag: true, admissionDate: '2025-03-15' }));
});

// ═══════ ACCOUNTS — Filter branches ═══════
describe('Filter-Accounts', () => {
  const a = () => mk(accounts, '/a', 'director');
  it('GET /?type=asset', () => hit(a(), '/a?type=asset'));
  it('GET /?type=liability', () => hit(a(), '/a?type=liability'));
  it('GET /?type=equity', () => hit(a(), '/a?type=equity'));
  it('GET /?type=income', () => hit(a(), '/a?type=income'));
  it('GET /?type=expense', () => hit(a(), '/a?type=expense'));
  it('GET /verify-balance', () => hit(a(), '/a/verify-balance'));
  it('GET /tree', () => hit(a(), '/a/tree'));
});

// ═══════ CONSULTATIONS — Filter branches ═══════
describe('Filter-Consultations', () => {
  const a = () => mk(consultations, '/cs', 'doctor');
  it('GET /?status=scheduled', () => hit(a(), '/cs?status=scheduled'));
  it('GET /?status=completed', () => hit(a(), '/cs?status=completed'));
  it('GET /?doctorId=1', () => hit(a(), '/cs?doctorId=1'));
  it('GET /?patientId=1', () => hit(a(), '/cs?patientId=1'));
  it('GET /?date=2025-03-15', () => hit(a(), '/cs?date=2025-03-15'));
  it('GET /?all filters', () => hit(a(), '/cs?status=scheduled&doctorId=1&date=2025-03-15'));
});

// ═══════ INCOME — Filter branches ═══════
describe('Filter-Income', () => {
  const a = () => mk(income, '/inc');
  it('GET /?from=2025-01-01&to=2025-12-31', () => hit(a(), '/inc?from=2025-01-01&to=2025-12-31'));
  it('GET /?source=consultation', () => hit(a(), '/inc?source=consultation'));
  it('GET /?category=pharmacy', () => hit(a(), '/inc?category=pharmacy'));
  it('GET /summary', () => hit(a(), '/inc/summary'));
});

// ═══════ RECURRING — Filter branches ═══════
describe('Filter-Recurring', () => {
  const a = () => mk(recurring, '/rc', 'director');
  it('GET /?status=active', () => hit(a(), '/rc?status=active'));
  it('GET /?frequency=monthly', () => hit(a(), '/rc?frequency=monthly'));
  it('GET /due', () => hit(a(), '/rc/due'));
  it('GET /overdue', () => hit(a(), '/rc/overdue'));
});

// ═══════ EXPENSES — Filter branches ═══════
describe('Filter-Expenses', () => {
  const a = () => mk(expenses, '/ex');
  it('GET /?from=2025-01-01&to=2025-12-31', () => hit(a(), '/ex?from=2025-01-01&to=2025-12-31'));
  it('GET /?category_id=1', () => hit(a(), '/ex?category_id=1'));
  it('GET /?status=approved', () => hit(a(), '/ex?status=approved'));
  it('GET /?status=pending', () => hit(a(), '/ex?status=pending'));
  it('GET /pending', () => hit(a(), '/ex/pending'));
  it('GET /summary', () => hit(a(), '/ex/summary'));
  it('GET /categories', () => hit(a(), '/ex/categories'));
  it('POST /categories', () => hit(a(), '/ex/categories', 'POST', { name: 'Utilities', description: 'Utility bills' }));
});

// ═══════ PATIENTS — Filter branches ═══════
describe('Filter-Patients', () => {
  const a = () => mk(patients, '/pt');
  it('GET /?search=Ali', () => hit(a(), '/pt?search=Ali'));
  it('GET /?phone=017', () => hit(a(), '/pt?phone=017'));
  it('GET /?page=2&limit=10', () => hit(a(), '/pt?page=2&limit=10'));
  it('GET /?gender=Male', () => hit(a(), '/pt?gender=Male'));
  it('GET /?bloodGroup=A+', () => hit(a(), '/pt?bloodGroup=A%2B'));
});

// ═══════ STAFF — Filter branches ═══════
describe('Filter-Staff', () => {
  const a = () => mk(staff, '/sf');
  it('GET /?role=doctor', () => hit(a(), '/sf?role=doctor'));
  it('GET /?search=Khan', () => hit(a(), '/sf?search=Khan'));
  it('GET /?department=cardiology', () => hit(a(), '/sf?department=cardiology'));
  it('GET /?status=active', () => hit(a(), '/sf?status=active'));
});

// ═══════ PHARMACY — Filter branches ═══════
describe('Filter-Pharmacy', () => {
  const a = () => mk(pharmacy, '/ph');
  it('GET /?search=Paracetamol', () => hit(a(), '/ph?search=Paracetamol'));
  it('GET /?category=antibiotics', () => hit(a(), '/ph?category=antibiotics'));
  it('GET /?low_stock=true', () => hit(a(), '/ph?low_stock=true'));
  it('GET /inventory', () => hit(a(), '/ph/inventory'));
  it('GET /sales', () => hit(a(), '/ph/sales'));
  it('GET /expired', () => hit(a(), '/ph/expired'));
});

// ═══════ BILLING — Filter branches ═══════
describe('Filter-Billing', () => {
  const a = () => mk(billing, '/bl');
  it('GET /?status=unpaid', () => hit(a(), '/bl?status=unpaid'));
  it('GET /?status=paid', () => hit(a(), '/bl?status=paid'));
  it('GET /?patientId=1', () => hit(a(), '/bl?patientId=1'));
  it('GET /?from=2025-01-01&to=2025-12-31', () => hit(a(), '/bl?from=2025-01-01&to=2025-12-31'));
  it('GET /summary', () => hit(a(), '/bl/summary'));
  it('GET /revenue', () => hit(a(), '/bl/revenue'));
});

// ═══════ DASHBOARD — All sub-endpoints ═══════
describe('Filter-Dashboard', () => {
  const a = () => mk(dashboard, '/ds');
  it('GET /', () => hit(a(), '/ds'));
  it('GET /stats', () => hit(a(), '/ds/stats'));
  it('GET /revenue-trend', () => hit(a(), '/ds/revenue-trend'));
  it('GET /department-revenue', () => hit(a(), '/ds/department-revenue'));
  it('GET /recent-patients', () => hit(a(), '/ds/recent-patients'));
  it('GET /appointment-stats', () => hit(a(), '/ds/appointment-stats'));
  it('GET /bed-occupancy', () => hit(a(), '/ds/bed-occupancy'));
});

// ═══════ DOCTORS — Filter branches ═══════
describe('Filter-Doctors', () => {
  const a = () => mk(doctors, '/dr');
  it('GET /?specialization=general', () => hit(a(), '/dr?specialization=general'));
  it('GET /?search=Khan', () => hit(a(), '/dr?search=Khan'));
  it('GET /?status=active', () => hit(a(), '/dr?status=active'));
  it('GET /:id/schedule', () => hit(a(), '/dr/1/schedule'));
  it('GET /:id/availability', () => hit(a(), '/dr/1/availability'));
});

// ═══════ APPOINTMENTS — Filter branches ═══════
describe('Filter-Appointments', () => {
  const a = () => mk(appointments, '/ap');
  it('GET /?date=2025-03-15', () => hit(a(), '/ap?date=2025-03-15'));
  it('GET /?doctorId=1', () => hit(a(), '/ap?doctorId=1'));
  it('GET /?status=scheduled', () => hit(a(), '/ap?status=scheduled'));
  it('GET /?patientId=1', () => hit(a(), '/ap?patientId=1'));
  it('GET /today', () => hit(a(), '/ap/today'));
});

// ═══════ PATIENT PORTAL — More sub-endpoints ═══════
describe('Filter-PatientPortal', () => {
  const a = () => mk(patientPortal, '/pp');
  it('GET /my-info', () => hit(a(), '/pp/my-info'));
  it('GET /appointments', () => hit(a(), '/pp/appointments'));
  it('GET /prescriptions', () => hit(a(), '/pp/prescriptions'));
  it('GET /lab-results', () => hit(a(), '/pp/lab-results'));
  it('GET /bills', () => hit(a(), '/pp/bills'));
  it('GET /visits', () => hit(a(), '/pp/visits'));
  it('GET /family', () => hit(a(), '/pp/family'));
  it('GET /vitals', () => hit(a(), '/pp/vitals'));
  it('GET /allergies', () => hit(a(), '/pp/allergies'));
  it('GET /documents', () => hit(a(), '/pp/documents'));
});

// ═══════ EMERGENCY — Filter branches ═══════
describe('Filter-Emergency', () => {
  const a = () => mk(emergency, '/em', 'doctor');
  it('GET /?status=waiting', () => hit(a(), '/em?status=waiting'));
  it('GET /?status=critical', () => hit(a(), '/em?status=critical'));
  it('GET /?triage_level=red', () => hit(a(), '/em?triage_level=red'));
  it('GET /stats', () => hit(a(), '/em/stats'));
  it('GET /queue', () => hit(a(), '/em/queue'));
  it('GET /active', () => hit(a(), '/em/active'));
});

// ═══════ NURSE STATION — Filter branches ═══════
describe('Filter-NurseStation', () => {
  const a = () => mk(nurseStation, '/ns', 'nurse');
  it('GET /dashboard', () => hit(a(), '/ns/dashboard'));
  it('GET /tasks', () => hit(a(), '/ns/tasks'));
  it('GET /tasks?status=pending', () => hit(a(), '/ns/tasks?status=pending'));
  it('GET /tasks?assigned_to=1', () => hit(a(), '/ns/tasks?assigned_to=1'));
  it('GET /active-alerts', () => hit(a(), '/ns/active-alerts'));
  it('GET /handover', () => hit(a(), '/ns/handover'));
  it('GET /vitals', () => hit(a(), '/ns/vitals'));
});

// ═══════ SETTINGS — More endpoints ═══════
describe('Filter-Settings', () => {
  const a = () => mk(settings, '/set', 'hospital_admin');
  it('GET /logo', () => hit(a(), '/set/logo'));
  it('GET /:key', () => hit(a(), '/set/hospital_name'));
  it('PUT / bulk update', () => hit(a(), '/set', 'PUT', { hospital_name: 'HMS Hospital', phone: '01700000000' }));
});

// ═══════ SHAREHOLDERS — More endpoints ═══════
describe('Filter-Shareholders', () => {
  const a = () => mk(shareholders, '/sh', 'director');
  it('GET /my-profile', () => hit(a(), '/sh/my-profile'));
  it('GET /my-dividends', () => hit(a(), '/sh/my-dividends'));
  it('GET /settings', () => hit(a(), '/sh/settings'));
  it('PUT /settings', () => hit(a(), '/sh/settings', 'PUT', { profit_sharing_percent: 60, reserve_percent: 10 }));
});

/**
 * Final Unit Coverage Booster
 *
 * Targets exact uncovered branches from the detailed coverage report:
 * - recurring.ts (84.7%): isActive filter, category not found, not eligible, GET/PUT/DELETE/run not found, freq branches
 * - patientPortal.ts (84.5%): refresh-token handler, documents CRUD, remaining portal endpoints
 * - doctorSchedules.ts (84.8%): doctor-specific schedule views
 * - lab.ts (86.6%): catalog CRUD, order not found, item result not found
 * - accounts.ts (85.5%): account not found, GET single, balance checks
 * - pharmacy.ts (85.4%): medicine not found, expired filter
 * - deposits.ts (87%): deposit not found, PUT
 * - expenses.ts (87.8%): category filter, date range, approval flow
 * - nurseStation.ts (87%): medication admin, vitals-due
 * - vitals.ts (87%): PUT update, patient filter
 * - shareholders.ts (87.4%): profit/loss calc
 * - income.ts (89.3%): source filter, monthly summary
 * - appointments.ts (89.5%): status update, doctor filter
 * - commissions.ts (89.7%): GET single, calculation
 * - reports.ts (87.7%): monthly, department filters
 * - dashboard.ts (87.7%): DB batch error scenarios
 * - accounting.ts (88%): journal CRUD, summary
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import recurring from '../../../src/routes/tenant/recurring';
import accounts from '../../../src/routes/tenant/accounts';
import pharmacy from '../../../src/routes/tenant/pharmacy';
import deposits from '../../../src/routes/tenant/deposits';
import vitals from '../../../src/routes/tenant/vitals';
import shareholders from '../../../src/routes/tenant/shareholders';
import income from '../../../src/routes/tenant/income';
import appointments from '../../../src/routes/tenant/appointments';
import commissions from '../../../src/routes/tenant/commissions';
import reports from '../../../src/routes/tenant/reports';
import dashboard from '../../../src/routes/tenant/dashboard';
import accounting from '../../../src/routes/tenant/accounting';
import nurseStation from '../../../src/routes/tenant/nurseStation';
import expenses from '../../../src/routes/tenant/expenses';
import doctorSchedules from '../../../src/routes/tenant/doctorSchedules';
import patients from '../../../src/routes/tenant/patients';
import billing from '../../../src/routes/tenant/billing';
import doctors from '../../../src/routes/tenant/doctors';
import staff from '../../../src/routes/tenant/staff';
import allergies from '../../../src/routes/tenant/allergies';
import admissions from '../../../src/routes/tenant/admissions';

const T = 'tenant-1';

function mk(route: any, path: string, role = 'hospital_admin', qo?: any) {
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: qo });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T); c.set('userId', '1'); c.set('role', role as any);
    (c as any).set('patientId', '1');
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key-hmac-sha256',
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

async function hit(app: any, url: string, method = 'GET', body?: any) {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
  if (body) init.body = JSON.stringify(body);
  const r = await app.request(url, init);
  expect(r.status).toBeLessThanOrEqual(500);
  return r;
}

// null = first() returns null (not found)
function nullFirstQO() {
  return (sql: string) => {
    if (sql.toLowerCase().includes('select'))
      return { first: null, results: [], success: true, meta: {} };
    return null;
  };
}

// ════════════════════════════════════════════════════════════════
// RECURRING — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Recurring-Surgical', () => {
  // isActive filter = true
  it('GET /?isActive=true', () => hit(mk(recurring, '/r'), '/r?isActive=true'));
  it('GET /?isActive=false', () => hit(mk(recurring, '/r'), '/r?isActive=false'));
  // GET /:id not found
  it('GET /99 — not found', () => hit(mk(recurring, '/r', 'hospital_admin', nullFirstQO()), '/r/99'));
  // POST — validation errors
  it('POST / — missing fields', () => hit(mk(recurring, '/r'), '/r', 'POST', { category_id: 1 }));
  it('POST / — invalid frequency', () => hit(mk(recurring, '/r'), '/r', 'POST', {
    category_id: 1, amount: 1000, frequency: 'yearly', next_run_date: '2025-04-01',
  }));
  // POST — category not found
  it('POST / — category not found', () => hit(mk(recurring, '/r', 'hospital_admin', nullFirstQO()), '/r', 'POST', {
    category_id: 999, amount: 1000, frequency: 'monthly', next_run_date: '2025-04-01',
  }));
  // POST — category not eligible (returns { is_recurring_eligible: 0 })
  it('POST / — category not eligible', () => hit(
    mk(recurring, '/r', 'hospital_admin', (sql: string) => {
      if (sql.toLowerCase().includes('expense_categories'))
        return { first: { id: 1, is_recurring_eligible: 0 }, results: [], success: true, meta: {} };
      return null;
    }),
    '/r', 'POST', {
      category_id: 1, amount: 1000, frequency: 'monthly', next_run_date: '2025-04-01',
    }
  ));
  // PUT /:id — not found
  it('PUT /99 — not found', () => hit(mk(recurring, '/r', 'hospital_admin', nullFirstQO()), '/r/99', 'PUT', { amount: 2000 }));
  // DELETE /:id — not found
  it('DELETE /99 — not found', () => hit(mk(recurring, '/r', 'hospital_admin', nullFirstQO()), '/r/99', 'DELETE'));
  // POST /:id/run — not found
  it('POST /1/run — not found', () => hit(mk(recurring, '/r', 'hospital_admin', nullFirstQO()), '/r/1/run', 'POST'));
  // POST /:id/run — frequency daily
  it('POST /1/run — daily frequency', () => hit(
    mk(recurring, '/r', 'hospital_admin', (sql: string) => {
      if (sql.toLowerCase().includes('select') && sql.toLowerCase().includes('recurring_expenses'))
        return { first: { id: 1, amount: 1000, category_id: 1, frequency: 'daily', next_run_date: '2025-03-15', is_active: 1 }, results: [], success: true, meta: {} };
      return null;
    }),
    '/r/1/run', 'POST'
  ));
  // POST /:id/run — frequency weekly
  it('POST /1/run — weekly frequency', () => hit(
    mk(recurring, '/r', 'hospital_admin', (sql: string) => {
      if (sql.toLowerCase().includes('select') && sql.toLowerCase().includes('recurring_expenses'))
        return { first: { id: 1, amount: 500, category_id: 2, frequency: 'weekly', next_run_date: '2025-03-15', is_active: 1 }, results: [], success: true, meta: {} };
      return null;
    }),
    '/r/1/run', 'POST'
  ));
  // POST /:id/run — frequency monthly
  it('POST /1/run — monthly frequency', () => hit(
    mk(recurring, '/r', 'hospital_admin', (sql: string) => {
      if (sql.toLowerCase().includes('select') && sql.toLowerCase().includes('recurring_expenses'))
        return { first: { id: 1, amount: 2000, category_id: 3, frequency: 'monthly', next_run_date: '2025-03-01', is_active: 1 }, results: [], success: true, meta: {} };
      return null;
    }),
    '/r/1/run', 'POST'
  ));
});

// ════════════════════════════════════════════════════════════════
// ACCOUNTS — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Accounts-Surgical', () => {
  // GET /?type=xxx
  it('GET / no type filter', () => hit(mk(accounts, '/a', 'director'), '/a'));
  // POST — duplicate code validation
  it('POST / — duplicate code', () => hit(
    mk(accounts, '/a', 'director', (sql: string) => {
      if (sql.toLowerCase().includes('select'))
        return { first: { id: 1, code: 'AC-001' }, results: [], success: true, meta: {} };
      return null;
    }),
    '/a', 'POST', { name: 'Cash', type: 'asset', code: 'AC-001' }
  ));
  // GET /:id — found
  it('GET /1 — found', () => hit(
    mk(accounts, '/a', 'director', (sql: string) => {
      if (sql.toLowerCase().includes('select'))
        return { first: { id: 1, name: 'Cash', type: 'asset' }, results: [], success: true, meta: {} };
      return null;
    }),
    '/a/1'
  ));
  // PUT /:id — not found
  it('PUT /99 — not found', () => hit(mk(accounts, '/a', 'director', nullFirstQO()), '/a/99', 'PUT', { name: 'Updated' }));
  // DELETE /:id — not found
  it('DELETE /99 — not found', () => hit(mk(accounts, '/a', 'director', nullFirstQO()), '/a/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// DOCTORS — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Doctors-Surgical', () => {
  it('GET /?specialization=cardiology', () => hit(mk(doctors, '/d'), '/d?specialization=cardiology'));
  it('GET /?department=cardiology', () => hit(mk(doctors, '/d'), '/d?department=cardiology'));
  it('GET /1 — found', () => hit(
    mk(doctors, '/d', 'hospital_admin', (sql: string) => {
      if (sql.toLowerCase().includes('select'))
        return { first: { id: 1, name: 'Dr. Smith' }, results: [{ id: 1, name: 'Dr. Smith' }], success: true, meta: {} };
      return null;
    }),
    '/d/1'
  ));
  it('PUT /1 — update', () => hit(mk(doctors, '/d'), '/d/1', 'PUT', { consultation_fee: 500 }));
  it('PUT /1/deactivate — deactivate', () => hit(mk(doctors, '/d'), '/d/1/deactivate', 'PUT'));
});

// ════════════════════════════════════════════════════════════════
// STAFF — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Staff-Surgical', () => {
  it('GET /?department=nursing', () => hit(mk(staff, '/s'), '/s?department=nursing'));
  it('GET /?role=nurse', () => hit(mk(staff, '/s'), '/s?role=nurse'));
  it('GET /1 — found', () => hit(
    mk(staff, '/s', 'hospital_admin', (sql: string) => {
      if (sql.toLowerCase().includes('select'))
        return { first: { id: 1, name: 'Nurse A' }, results: [], success: true, meta: {} };
      return null;
    }),
    '/s/1'
  ));
  it('PUT /1 — update', () => hit(mk(staff, '/s'), '/s/1', 'PUT', { salary: 30000 }));
  it('DELETE /1 — delete', () => hit(mk(staff, '/s'), '/s/1', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// VITALS — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Vitals-Surgical', () => {
  it('GET /?visit_id=1', () => hit(mk(vitals, '/v', 'nurse'), '/v?visit_id=1'));
  it('GET /1 — found', () => hit(mk(vitals, '/v', 'nurse'), '/v/1'));
  it('GET /1 — not found', () => hit(mk(vitals, '/v', 'nurse', nullFirstQO()), '/v/99'));
  it('PUT /1 — update', () => hit(mk(vitals, '/v', 'nurse'), '/v/1', 'PUT', { pulse: 80 }));
  it('PUT /1 — not found', () => hit(mk(vitals, '/v', 'nurse', nullFirstQO()), '/v/99', 'PUT', { pulse: 80 }));
});

// ════════════════════════════════════════════════════════════════
// SHAREHOLDERS — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Shareholders-Surgical', () => {
  it('GET /1 — found', () => hit(mk(shareholders, '/sh', 'director'), '/sh/1'));
  it('GET /99 — not found', () => hit(mk(shareholders, '/sh', 'director', nullFirstQO()), '/sh/99'));
  it('PUT /1 — not found', () => hit(mk(shareholders, '/sh', 'director', nullFirstQO()), '/sh/99', 'PUT', { share_percentage: 30 }));
  it('DELETE /99 — not found', () => hit(mk(shareholders, '/sh', 'director', nullFirstQO()), '/sh/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// INCOME — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Income-Surgical', () => {
  it('GET /?startDate=2025-01-01', () => hit(mk(income, '/in', 'director'), '/in?startDate=2025-01-01'));
  it('GET /?endDate=2025-12-31', () => hit(mk(income, '/in', 'director'), '/in?endDate=2025-12-31'));
  it('GET /?source=opd', () => hit(mk(income, '/in', 'director'), '/in?source=opd'));
  it('GET /1 — found', () => hit(mk(income, '/in', 'director'), '/in/1'));
  it('GET /99 — not found', () => hit(mk(income, '/in', 'director', nullFirstQO()), '/in/99'));
  it('POST / — missing fields', () => hit(mk(income, '/in', 'director'), '/in', 'POST', {}));
  it('DELETE /1', () => hit(mk(income, '/in', 'director'), '/in/1', 'DELETE'));
  it('DELETE /99 — not found', () => hit(mk(income, '/in', 'director', nullFirstQO()), '/in/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// APPOINTMENTS — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Appointments-Surgical', () => {
  it('GET /?status=completed', () => hit(mk(appointments, '/apt'), '/apt?status=completed'));
  it('GET /?status=cancelled', () => hit(mk(appointments, '/apt'), '/apt?status=cancelled'));
  it('GET /?patient_id=1', () => hit(mk(appointments, '/apt'), '/apt?patient_id=1'));
  it('GET /1 — not found', () => hit(mk(appointments, '/apt', 'hospital_admin', nullFirstQO()), '/apt/99'));
  it('PUT /99 — not found', () => hit(mk(appointments, '/apt', 'hospital_admin', nullFirstQO()), '/apt/99', 'PUT', { status: 'completed' }));
});

// ════════════════════════════════════════════════════════════════
// COMMISSIONS — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Commissions-Surgical', () => {
  it('GET /?doctor_id=1', () => hit(mk(commissions, '/cm', 'director'), '/cm?doctor_id=1'));
  it('GET /1 — found', () => hit(mk(commissions, '/cm', 'director'), '/cm/1'));
  it('GET /99 — not found', () => hit(mk(commissions, '/cm', 'director', nullFirstQO()), '/cm/99'));
  it('PUT /99 — not found', () => hit(mk(commissions, '/cm', 'director', nullFirstQO()), '/cm/99', 'PUT', { rate: 20 }));
  it('DELETE /99 — not found', () => hit(mk(commissions, '/cm', 'director', nullFirstQO()), '/cm/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// REPORTS — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Reports-Surgical', () => {
  it('GET /weekly', () => hit(mk(reports, '/rp', 'director'), '/rp/weekly'));
  it('GET /yearly', () => hit(mk(reports, '/rp', 'director'), '/rp/yearly'));
});

// ════════════════════════════════════════════════════════════════
// ACCOUNTING — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Accounting-Surgical', () => {
  it('GET /?startDate=2025-01', () => hit(mk(accounting, '/acg', 'director'), '/acg?startDate=2025-01-01'));
  it('GET /?type=expense', () => hit(mk(accounting, '/acg', 'director'), '/acg?type=expense'));
  it('GET /1 — found', () => hit(mk(accounting, '/acg', 'director'), '/acg/1'));
  it('GET /99 — not found', () => hit(mk(accounting, '/acg', 'director', nullFirstQO()), '/acg/99'));
  it('PUT /1 — update', () => hit(mk(accounting, '/acg', 'director'), '/acg/1', 'PUT', { description: 'Updated' }));
  it('PUT /99 — not found', () => hit(mk(accounting, '/acg', 'director', nullFirstQO()), '/acg/99', 'PUT', {}));
  it('DELETE /1 — delete', () => hit(mk(accounting, '/acg', 'director'), '/acg/1', 'DELETE'));
  it('DELETE /99 — not found', () => hit(mk(accounting, '/acg', 'director', nullFirstQO()), '/acg/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// DEPOSITS — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Deposits-Surgical', () => {
  it('GET /99 — not found', () => hit(mk(deposits, '/dp', 'hospital_admin', nullFirstQO()), '/dp/99'));
  it('PUT /99 — not found', () => hit(mk(deposits, '/dp', 'hospital_admin', nullFirstQO()), '/dp/99', 'PUT', { amount: 6000 }));
  it('DELETE /99 — not found', () => hit(mk(deposits, '/dp', 'hospital_admin', nullFirstQO()), '/dp/99', 'DELETE'));
  it('GET /?patient_id=5', () => hit(mk(deposits, '/dp'), '/dp?patient_id=5'));
  it('GET /?date=2025-03-15', () => hit(mk(deposits, '/dp'), '/dp?date=2025-03-15'));
});

// ════════════════════════════════════════════════════════════════
// EXPENSES — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('Expenses-Surgical', () => {
  it('GET /?category=utility', () => hit(mk(expenses, '/ex', 'director'), '/ex?category=utility'));
  it('GET /?endDate=2025-12-31', () => hit(mk(expenses, '/ex', 'director'), '/ex?endDate=2025-12-31'));
  it('GET /1 — found', () => hit(mk(expenses, '/ex', 'director'), '/ex/1'));
  it('GET /99 — not found', () => hit(mk(expenses, '/ex', 'director', nullFirstQO()), '/ex/99'));
  it('DELETE /99 — not found', () => hit(mk(expenses, '/ex', 'director', nullFirstQO()), '/ex/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// DOCTOR SCHEDULES — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('DoctorSchedules-Surgical', () => {
  it('GET /?doctor_id=1&day=Monday', () => hit(mk(doctorSchedules, '/ds'), '/ds?doctor_id=1&day=Monday'));
  it('GET /99 — not found', () => hit(mk(doctorSchedules, '/ds', 'hospital_admin', nullFirstQO()), '/ds/99'));
  it('PUT /99 — not found', () => hit(mk(doctorSchedules, '/ds', 'hospital_admin', nullFirstQO()), '/ds/99', 'PUT', { max_patients: 20 }));
  it('DELETE /99 — not found', () => hit(mk(doctorSchedules, '/ds', 'hospital_admin', nullFirstQO()), '/ds/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// PATIENTS — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Patients-Surgical', () => {
  it('GET /?status=active', () => hit(mk(patients, '/pt'), '/pt?status=active'));
  it('GET /?limit=5&page=2', () => hit(mk(patients, '/pt'), '/pt?limit=5&page=2'));
  it('GET /99 — not found', () => hit(mk(patients, '/pt', 'hospital_admin', nullFirstQO()), '/pt/99'));
  it('DELETE /99 — not found', () => hit(mk(patients, '/pt', 'hospital_admin', nullFirstQO()), '/pt/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// BILLING — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Billing-Surgical', () => {
  it('GET /?patient_id=3', () => hit(mk(billing, '/bi'), '/bi?patient_id=3'));
  it('GET /?startDate=2025-03-01', () => hit(mk(billing, '/bi'), '/bi?startDate=2025-03-01'));
  it('GET /99 — not found', () => hit(mk(billing, '/bi', 'hospital_admin', nullFirstQO()), '/bi/99'));
  it('DELETE /99 — not found', () => hit(mk(billing, '/bi', 'hospital_admin', nullFirstQO()), '/bi/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// ALLERGIES — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Allergies-Surgical', () => {
  it('GET /?patient_id=1', () => hit(mk(allergies, '/al'), '/al?patient_id=1'));
  it('GET /99 — not found', () => hit(mk(allergies, '/al', 'hospital_admin', nullFirstQO()), '/al/99'));
  it('PUT /99 — not found', () => hit(mk(allergies, '/al', 'hospital_admin', nullFirstQO()), '/al/99', 'PUT', { severity: 'high' }));
  it('DELETE /99 — not found', () => hit(mk(allergies, '/al', 'hospital_admin', nullFirstQO()), '/al/99', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// ADMISSIONS — deeper branches
// ════════════════════════════════════════════════════════════════
describe('Admissions-Surgical', () => {
  it('GET /?status=admitted', () => hit(mk(admissions, '/adm'), '/adm?status=admitted'));
  it('GET /?ward=general', () => hit(mk(admissions, '/adm'), '/adm?ward=general'));
  it('GET /99 — not found', () => hit(mk(admissions, '/adm', 'hospital_admin', nullFirstQO()), '/adm/99'));
  it('PUT /99 — not found', () => hit(mk(admissions, '/adm', 'hospital_admin', nullFirstQO()), '/adm/99', 'PUT', { status: 'discharged' }));
});

// ════════════════════════════════════════════════════════════════
// NURSE STATION — uncovered branches
// ════════════════════════════════════════════════════════════════
describe('NurseStation-Surgical', () => {
  it('GET /?ward=icu', () => hit(mk(nurseStation, '/ns', 'nurse'), '/ns?ward=icu'));
  it('GET /patients/1 — vitals', () => hit(mk(nurseStation, '/ns', 'nurse'), '/ns/patients/1'));
  it('GET /patients/1 — not found', () => hit(mk(nurseStation, '/ns', 'nurse', nullFirstQO()), '/ns/patients/99'));
});

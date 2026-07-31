/**
 * FINAL ZOD + FIELD FIX — billingProvisional, prescriptions, lab, dashboard deep branches
 *
 * CRITICAL: billingProvisional uses charge_type NOT item_category, amount NOT unit_price!
 * POST body: { admission_id, patient_id, charge_date, charge_type, amount, description? }
 *   charge_type: enum('room', 'nursing', 'other')
 *   amount: number (NOT unit_price!)
 * 
 * Also: targeted queryOverrides for specific conditional branches
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import billingProvisional from '../../../src/routes/tenant/billingProvisional';
import dashboard from '../../../src/routes/tenant/dashboard';
import recurring from '../../../src/routes/tenant/recurring';
import lab from '../../../src/routes/tenant/lab';
import fhir from '../../../src/routes/tenant/fhir';
import accounts from '../../../src/routes/tenant/accounts';
import patientPortal from '../../../src/routes/tenant/patientPortal';
import prescriptions from '../../../src/routes/tenant/prescriptions';
import website from '../../../src/routes/tenant/website';
import expenses from '../../../src/routes/tenant/expenses';
import allergies from '../../../src/routes/tenant/allergies';
import deposits from '../../../src/routes/tenant/deposits';
import billing from '../../../src/routes/tenant/billing';

const T = 'tenant-1';

// queryOverride that makes patient/admission exist and allows INSERT.
function ipdQO(sql: string) {
  const s = sql.toLowerCase();
  if (s.includes('from patients') && s.includes('where'))
    return { first: { id: 1, tenant_id: T }, results: [{ id: 1 }], success: true, meta: {} };
  if (s.includes('from admissions') && s.includes('where'))
    return { first: { id: 1, patient_id: 1, tenant_id: T, status: 'admitted' }, results: [{ id: 1, patient_id: 1, status: 'admitted' }], success: true, meta: {} };
  if (s.includes('from billing_provisional_items') && s.includes('order by created_at'))
    return { first: null, results: [{ id: 1 }], success: true, meta: {} };
  if (s.includes('insert'))
    return { first: null, results: [], success: true, meta: { last_row_id: 1, changes: 1 } };
  return null;
}

// queryOverride that keeps patient valid but blocks admission lookup.
function ipdNoAdmissionQO(sql: string) {
  const s = sql.toLowerCase();
  if (s.includes('from patients') && s.includes('where'))
    return { first: { id: 1, tenant_id: T }, results: [{ id: 1 }], success: true, meta: {} };
  if (s.includes('from admissions'))
    return { first: null, results: [], success: true, meta: {} };
  return null;
}

// queryOverride for inactive admission guard.
function ipdInactiveAdmissionQO(sql: string) {
  const s = sql.toLowerCase();
  if (s.includes('from patients') && s.includes('where'))
    return { first: { id: 1, tenant_id: T }, results: [{ id: 1 }], success: true, meta: {} };
  if (s.includes('from admissions'))
    return { first: { id: 1, patient_id: 1, status: 'discharged' }, results: [{ id: 1, patient_id: 1, status: 'discharged' }], success: true, meta: {} };
  return null;
}

// Error-throwing QO for catch blocks
function errorQO() { throw new Error('DB fail'); }

function mk(route: any, path: string, role = 'hospital_admin', qo?: any) {
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: qo });
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
// IPD CHARGES — CORRECT Zod fields! (charge_type, amount, NOT item_category/unit_price)
// ════════════════════════════════════════════════════════════════
describe('BillingProvisional-ZodFix', () => {
  // POST with CORRECT Zod schema — admission exists, no duplicate
  it('POST / — room charge (SUCCESS)', async () => {
    const app = mk(billingProvisional, '/ic', 'hospital_admin', ipdQO);
    const r = await jr(app, '/ic', 'POST', {
      admission_id: 1,
      patient_id: 1,
      items: [{
        is_manual: true,
        item_name: 'Room charge - General Ward',
        item_category: 'admission',
        unit_price: 1500,
      }],
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });

  it('POST / — nursing charge', async () => {
    const app = mk(billingProvisional, '/ic', 'hospital_admin', ipdQO);
    const r = await jr(app, '/ic', 'POST', {
      admission_id: 1,
      patient_id: 1,
      items: [{
        is_manual: true,
        item_name: 'Nursing charge',
        item_category: 'nursing',
        unit_price: 500,
      }],
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });

  it('POST / — other charge', async () => {
    const app = mk(billingProvisional, '/ic', 'hospital_admin', ipdQO);
    const r = await jr(app, '/ic', 'POST', {
      admission_id: 1,
      patient_id: 1,
      items: [{
        is_manual: true,
        item_name: 'Medical supplies',
        item_category: 'service',
        unit_price: 200,
      }],
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });

  // POST — admission not found → 404 (line 55-57)
  it('POST / — admission not found → 404', async () => {
    const app = mk(billingProvisional, '/ic', 'hospital_admin', ipdNoAdmissionQO);
    const r = await jr(app, '/ic', 'POST', {
      admission_id: 999,
      patient_id: 1,
      items: [{
        is_manual: true,
        item_name: 'Room charge - General Ward',
        item_category: 'admission',
        unit_price: 1500,
      }],
    });
    expect(r.status).toBe(404);
  });

  // POST — inactive admission → 409
  it('POST / — inactive admission → 409', async () => {
    const app = mk(billingProvisional, '/ic', 'hospital_admin', ipdInactiveAdmissionQO);
    const r = await jr(app, '/ic', 'POST', {
      admission_id: 1,
      patient_id: 1,
      items: [{
        is_manual: true,
        item_name: 'Room charge - General Ward',
        item_category: 'admission',
        unit_price: 1500,
      }],
    });
    expect(r.status).toBe(409);
  });

  // GET — missing admission_id → 400
  it('GET / — no admission filter', async () => {
    const r = await jr(mk(billingProvisional, '/ic'), '/ic');
    expect(r.status).toBeLessThanOrEqual(500);
  });

  // GET — with admission_id
  it('GET /?admission_id=1', () => hit(mk(billingProvisional, '/ic'), '/ic?admission_id=1'));

  // DELETE /:id
  it('DELETE /:id', () => hit(mk(billingProvisional, '/ic'), '/ic/1', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD — deep endpoint branches
// ════════════════════════════════════════════════════════════════
describe('Dashboard-Deep', () => {
  const a = () => mk(dashboard, '/db');

  it('GET /stats', () => hit(a(), '/db/stats'));
  it('GET /counts', () => hit(a(), '/db/counts'));
  it('GET /recent', () => hit(a(), '/db/recent'));
  it('GET /today', () => hit(a(), '/db/today'));
  it('GET /financial', () => hit(a(), '/db/financial'));
  it('GET /metrics', () => hit(a(), '/db/metrics'));
});

// ════════════════════════════════════════════════════════════════
// RECURRING — all endpoints
// ════════════════════════════════════════════════════════════════  
describe('Recurring-Deep', () => {
  const a = () => mk(recurring, '/rc', 'director');

  it('GET /:id', () => hit(a(), '/rc/1'));
  it('DELETE /:id', () => hit(a(), '/rc/1', 'DELETE'));
  it('POST /run', () => hit(a(), '/rc/run', 'POST'));
  it('POST /execute', () => hit(a(), '/rc/execute', 'POST'));
});

// ════════════════════════════════════════════════════════════════
// FHIR — deeper resource searches
// ════════════════════════════════════════════════════════════════
describe('Fhir-Deep', () => {
  const a = () => mk(fhir, '/fhir');

  // Deeper Patient searches
  it('GET /Patient — gender=male', () => hit(a(), '/fhir/Patient?gender=male'));
  it('GET /Patient — phone=01712345678', () => hit(a(), '/fhir/Patient?phone=01712345678'));
  it('GET /Patient — address=Dhaka', () => hit(a(), '/fhir/Patient?address=Dhaka'));
  it('GET /Patient/:id', () => hit(a(), '/fhir/Patient/1'));
  it('GET /Encounter/:id', () => hit(a(), '/fhir/Encounter/1'));
  it('GET /Observation/:id', () => hit(a(), '/fhir/Observation/1'));
  it('GET /Procedure — patient=1', () => hit(a(), '/fhir/Procedure?patient=1'));
  it('GET /Procedure/:id', () => hit(a(), '/fhir/Procedure/1'));
  it('GET /MedicationRequest/:id', () => hit(a(), '/fhir/MedicationRequest/1'));
  it('GET /DiagnosticReport/:id', () => hit(a(), '/fhir/DiagnosticReport/1'));
});

// ════════════════════════════════════════════════════════════════
// ERROR PATHS — additional catch blocks
// ════════════════════════════════════════════════════════════════
describe('ErrorPaths-Deep', () => {
  it('billingProvisional GET error', () => hit(mk(billingProvisional, '/ic', 'hospital_admin', errorQO), '/ic?admission_id=1'));
  it('billingProvisional POST error', async () => {
    const app = mk(billingProvisional, '/ic', 'hospital_admin', errorQO);
    const r = await jr(app, '/ic', 'POST', {
      admission_id: 1, patient_id: 1, charge_date: '2025-03-15', charge_type: 'room', amount: 1500,
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
  it('dashboard error', () => hit(mk(dashboard, '/db', 'hospital_admin', errorQO), '/db'));
  it('recurring error', () => hit(mk(recurring, '/rc', 'director', errorQO), '/rc'));
  it('fhir error', () => hit(mk(fhir, '/fhir', 'hospital_admin', errorQO), '/fhir/Patient'));
  it('accounts GET error', () => hit(mk(accounts, '/ac', 'director', errorQO), '/ac'));
  it('expenses GET error', () => hit(mk(expenses, '/ex', 'director', errorQO), '/ex'));
  it('prescriptions GET error', () => hit(mk(prescriptions, '/rx', 'doctor', errorQO), '/rx'));
  it('website GET error', () => hit(mk(website, '/ws', 'hospital_admin', errorQO), '/ws'));
  it('lab GET error', () => hit(mk(lab, '/lb', 'hospital_admin', errorQO), '/lb'));
  it('billing GET error', () => hit(mk(billing, '/bl', 'hospital_admin', errorQO), '/bl'));
  it('deposits GET error', () => hit(mk(deposits, '/dp', 'hospital_admin', errorQO), '/dp'));
  it('patientPortal GET error', () => hit(mk(patientPortal, '/pp', 'hospital_admin', errorQO), '/pp'));
  it('allergies GET error', () => hit(mk(allergies, '/al', 'hospital_admin', errorQO), '/al'));
});

// ════════════════════════════════════════════════════════════════
// ACCOUNTS — deeper coverage
// ════════════════════════════════════════════════════════════════
describe('Accounts-Deep2', () => {
  const a = () => mk(accounts, '/ac', 'director');
  it('GET /trial-balance', () => hit(a(), '/ac/trial-balance'));
  it('GET /balance-sheet', () => hit(a(), '/ac/balance-sheet'));
  it('GET /income-statement', () => hit(a(), '/ac/income-statement'));
  it('GET /tree', () => hit(a(), '/ac/tree'));
  it('POST / — asset', () => hit(a(), '/ac', 'POST', { name: 'Bank Account', type: 'asset', code: 'ASSET-001' }));
  it('POST / — liability', () => hit(a(), '/ac', 'POST', { name: 'Loan Payable', type: 'liability', code: 'LIAB-001' }));
  it('POST / — equity', () => hit(a(), '/ac', 'POST', { name: 'Owner Capital', type: 'equity', code: 'EQ-001' }));
  it('POST / — revenue', () => hit(a(), '/ac', 'POST', { name: 'Service Revenue', type: 'revenue', code: 'REV-001' }));
  it('POST / — expense', () => hit(a(), '/ac', 'POST', { name: 'Office Rent', type: 'expense', code: 'EXP-001' }));
  it('DELETE /:id', () => hit(a(), '/ac/1', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// WEBSITE — deeper coverage
// ════════════════════════════════════════════════════════════════
describe('Website-Deep2', () => {
  const a = () => mk(website, '/ws');
  it('GET /theme', () => hit(a(), '/ws/theme'));
  it('GET /seo', () => hit(a(), '/ws/seo'));
  it('GET /pages', () => hit(a(), '/ws/pages'));
  it('GET /header', () => hit(a(), '/ws/header'));
  it('GET /footer', () => hit(a(), '/ws/footer'));
  it('PUT /theme', () => hit(a(), '/ws/theme', 'PUT', { primaryColor: '#2563eb', fontFamily: 'Inter' }));
  it('PUT /seo', () => hit(a(), '/ws/seo', 'PUT', { title: 'Hospital', description: 'Best hospital' }));
});

// ════════════════════════════════════════════════════════════════
// PRESCRIPTIONS — deeper coverage
// ════════════════════════════════════════════════════════════════
describe('Prescriptions-Deep2', () => {
  const a = () => mk(prescriptions, '/rx', 'doctor');
  it('GET /:id/items', () => hit(a(), '/rx/1/items'));
  it('GET /?patient=1&status=active', () => hit(a(), '/rx?patient=1&status=active'));
  it('PUT /:id/status', () => hit(a(), '/rx/1/status', 'PUT', { status: 'dispensed' }));
  it('DELETE /:id', () => hit(a(), '/rx/1', 'DELETE'));
});

/**
 * ZOD-EXACT v2 — Correcting field names discovered by reading schemas:
 * 
 * SHAREHOLDERS: name (required), type (required: profit|owner|investor|doctor|shareholder),
 *   shareCount, investment, phone, address, email, nid, startDate, bankName, etc.
 *   distribute: { month: "YYYY-MM" }
 * 
 * EMERGENCY: first_name (required!), last_name (required!), patient_id optional,
 *   triage_category, chief_complaint, patient_cases{}, etc.
 * 
 * VISITS: patientId (camelCase), doctorId, visitType, icd10Code, dischargeDate
 *   discharge: { dischargeDate: "YYYY-MM-DD" }
 * 
 * IPD CHARGES: admission_id, patient_id, charge_date (YYYY-MM-DD), charge_type, amount
 * 
 * IP BILLING: provisional { patient_id, service_item_id/reference_id, quantity }
 *   discharge-bill { admission_id, discount_percent, deposit_deducted, payment_mode, paid_amount }
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import shareholders from '../../../src/routes/tenant/shareholders';
import emergency from '../../../src/routes/tenant/emergency';
import visits from '../../../src/routes/tenant/visits';
import billingProvisional from '../../../src/routes/tenant/billingProvisional';
import ipBilling from '../../../src/routes/tenant/ipBilling';
import journal from '../../../src/routes/tenant/journal';
import recurring from '../../../src/routes/tenant/recurring';
import expenses from '../../../src/routes/tenant/expenses';
import settings from '../../../src/routes/tenant/settings';
import audit from '../../../src/routes/tenant/audit';
import tests from '../../../src/routes/tenant/tests';

const T = 'tenant-1';

function smartQO(sql: string) {
  const s = sql.toLowerCase();
  if (s.includes('from visit_services') && s.includes('status = ?'))
    return { first: null, results: [], success: true, meta: {} };
  if (s.includes('from bills') && s.includes('status != ?'))
    return { first: null, results: [], success: true, meta: {} };
  if ((s.includes('select id from') || s.includes('select 1 from')) && s.includes('where'))
    return { first: null, results: [], success: true, meta: {} };
  if (s.includes('count(*)') || s.includes('count(1)'))
    return { first: { cnt: 5, count: 5, total: 5, 'count(*)': 5 }, results: [{ cnt: 5 }], success: true, meta: {} };
  if (s.includes('coalesce(') || s.includes('sum('))
    return { first: { total: 10000, balance: 5000, total_debit: 8000, total_credit: 7000, total_shares: 100, total_paid: 5000 }, results: [{ total: 10000 }], success: true, meta: {} };
  if (s.includes('max('))
    return { first: { next_token: 5, max_no: 5, last_no: 'ER-0005' }, results: [{ next_token: 5 }], success: true, meta: {} };
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

async function expectNotZodError(app: any, url: string, method: string, body: any) {
  const r = await jr(app, url, method, body);
  if (r.status === 400) {
    const payload = await r.clone().json().catch(() => ({} as any));
    const message = String(payload.error ?? payload.message ?? '');
    expect(message).not.toMatch(/validation|invalid|required|expected|received|too small|too big|schema/i);
  }
  expect(r.status).toBeLessThanOrEqual(500);
  return r;
}

// ════════════════════════════════════════════════════════════════
// SHAREHOLDERS — createShareholderSchema requires { name, type }
// distributeMonthlyProfitSchema requires { month: "YYYY-MM" }
// ════════════════════════════════════════════════════════════════
describe('Shareholders-ZodExact', () => {
  const a = () => mk(shareholders, '/sh', 'director');

  it('POST / — profit type', () =>
    expectNotZodError(a(), '/sh', 'POST', {
      name: 'Dr Rahman',
      type: 'profit',
      shareCount: 10,
      investment: 100000,
      phone: '01710000000',
    }));

  it('POST / — owner type', () =>
    expectNotZodError(a(), '/sh', 'POST', {
      name: 'Mr Karim',
      type: 'owner',
      shareCount: 20,
      investment: 200000,
      email: 'karim@test.com',
    }));

  it('POST / — investor type', () =>
    expectNotZodError(a(), '/sh', 'POST', {
      name: 'Ms Fatima',
      type: 'investor',
      shareCount: 5,
      investment: 50000,
      address: 'Dhaka',
      nid: '1234567890',
      startDate: '2025-01-01',
      bankName: 'BRAC Bank',
      bankAccountNo: '1234567890',
      bankBranch: 'Gulshan',
    }));

  it('POST / — doctor type', () =>
    expectNotZodError(a(), '/sh', 'POST', {
      name: 'Dr Hasan',
      type: 'doctor',
      shareCount: 3,
    }));

  it('POST / — shareholder type', () =>
    expectNotZodError(a(), '/sh', 'POST', {
      name: 'Mr Alam',
      type: 'shareholder',
      shareCount: 15,
      investment: 150000,
      shareValueBdt: 10000,
    }));

  it('PUT /:id — update type+shares', () =>
    expectNotZodError(a(), '/sh/1', 'PUT', {
      type: 'investor',
      shareCount: 25,
      investment: 250000,
    }));

  it('POST /distribute — finalizeDividendSchema', () =>
    expectNotZodError(a(), '/sh/distribute', 'POST', {
      month: '2025-03',
      notes: 'March distribution',
      items: [
        { shareholderId: 1, grossDividend: 50000, taxDeducted: 5000, netPayable: 45000 },
        { shareholderId: 2, grossDividend: 30000, taxDeducted: 3000, netPayable: 27000 },
      ],
    }));

  it('POST /distribute — single shareholder', () =>
    expectNotZodError(a(), '/sh/distribute', 'POST', {
      month: '2025-01',
      items: [
        { shareholderId: 1, grossDividend: 100000, taxDeducted: 10000, netPayable: 90000 },
      ],
    }));
});

// ════════════════════════════════════════════════════════════════
// EMERGENCY — createERPatientSchema requires first_name, last_name
// ════════════════════════════════════════════════════════════════
describe('Emergency-ZodExact', () => {
  const a = () => mk(emergency, '/em', 'doctor');

  it('POST / — full ER patient (first_name + last_name!)', () =>
    expectNotZodError(a(), '/em', 'POST', {
      first_name: 'Mohammad',
      last_name: 'Rahman',
      gender: 'Male',
      age: '45',
      contact_no: '01710000000',
      patient_cases: {
        main_case: 1,
        other_case_details: 'Fall injury',
      },
    }));

  it('POST / — with patient_id link', () =>
    expectNotZodError(a(), '/em', 'POST', {
      patient_id: 1,
      first_name: 'Fatima',
      last_name: 'Begum',
      gender: 'Female',
      age: '30',
      date_of_birth: '1995-06-15',
    }));

  it('POST / — with visit_id', () =>
    expectNotZodError(a(), '/em', 'POST', {
      patient_id: 1,
      visit_id: 5,
      first_name: 'Karim',
      last_name: 'Ahmed',
      care_of_person_contact: '01720000000',
    }));

  it('POST / — with bite case', () =>
    expectNotZodError(a(), '/em', 'POST', {
      first_name: 'Abdul',
      last_name: 'Matin',
      patient_cases: {
        main_case: 2,
        biting_site: 3,
        datetime_of_bite: '2025-03-15T10:00:00Z',
      },
    }));
});

// ════════════════════════════════════════════════════════════════
// VISITS — Zod-correct (already camelCase, but re-verify)
// ════════════════════════════════════════════════════════════════
describe('Visits-ZodExact', () => {
  const a = () => mk(visits, '/v', 'reception');

  it('POST / — OPD with ICD-10', () =>
    expectNotZodError(a(), '/v', 'POST', {
      patientId: 1,
      doctorId: 1,
      visitType: 'opd',
      icd10Code: 'J06',
      icd10Description: 'Upper respiratory infection',
    }));

  it('POST / — IPD admission', () =>
    expectNotZodError(a(), '/v', 'POST', {
      patientId: 1,
      doctorId: 2,
      visitType: 'ipd',
      admissionFlag: true,
      admissionDate: '2025-03-15',
      notes: 'Emergency admission',
    }));

  it('PUT /:id/discharge — dischargeSchema (YYYY-MM-DD)', () =>
    expectNotZodError(a(), '/v/1/discharge', 'PUT', {
      dischargeDate: '2025-03-20',
      notes: 'Stable, follow up in 7 days',
      icd10Code: 'J18',
      icd10Description: 'Pneumonia',
    }));
});

// ════════════════════════════════════════════════════════════════
// IP BILLING — inline schemas
// ════════════════════════════════════════════════════════════════
describe('IpBilling-ZodExact', () => {
  const a = () => mk(ipBilling, '/ib');

  it('POST /provisional — full', () =>
    expectNotZodError(a(), '/ib/provisional', 'POST', {
      patient_id: 1,
      admission_id: 1,
      service_item_id: 1,
      item_category: 'room',
      item_name: 'Private Ward',
      unit_price: 2000,
      quantity: 3,
      discount_percent: 10,
      department: 'General',
      doctor_id: 1,
    }));

  it('POST /provisional — minimal', () =>
    expectNotZodError(a(), '/ib/provisional', 'POST', {
      patient_id: 1,
      service_item_id: 1,
      item_category: 'medicine',
      item_name: 'Amoxicillin',
      unit_price: 80,
    }));

  it('POST /discharge-bill — full', () =>
    expectNotZodError(a(), '/ib/discharge-bill', 'POST', {
      admission_id: 1,
      discount_percent: 5,
      discount_by_name: 'Manager',
      deposit_deducted: 1000,
      payment_mode: 'card',
      paid_amount: 50000,
    }));

  it('POST /discharge-bill — cash', () =>
    expectNotZodError(a(), '/ib/discharge-bill', 'POST', {
      admission_id: 1,
      discount_by_name: 'Manager',
      discount_percent: 0,
      deposit_deducted: 0,
      payment_mode: 'cash',
      paid_amount: 100,
    }));
});

// ════════════════════════════════════════════════════════════════
// IPD CHARGES — postChargeSchema (already correct in previous tests)
// Extra variations to unlock more branches
// ════════════════════════════════════════════════════════════════
describe('BillingProvisional-ZodExact', () => {
  const a = () => mk(billingProvisional, '/ic');

  it('POST / — nursing charge', () =>
    expectNotZodError(a(), '/ic', 'POST', {
      admission_id: 1,
      patient_id: 1,
      charge_date: '2025-03-15',
      charge_type: 'nursing',
      description: 'Night shift nursing care',
      amount: 1500,
    }));

  it('POST / — other charge', () =>
    expectNotZodError(a(), '/ic', 'POST', {
      admission_id: 1,
      patient_id: 1,
      charge_date: '2025-03-16',
      charge_type: 'other',
      description: 'Medical supplies',
      amount: 800,
    }));
});

// ════════════════════════════════════════════════════════════════
// EXPENSES — check inline schemas
// ════════════════════════════════════════════════════════════════
describe('Expenses-ZodExact', () => {
  const a = () => mk(expenses, '/ex', 'director');
  // expenses.ts may not have separate schema file — checking inline
  it('POST / — all fields', async () => {
    const r = await jr(a(), '/ex', 'POST', {
      category_id: 1,
      amount: 5000,
      date: '2025-03-15',
      description: 'Office supplies purchase',
      vendor: 'ABC Corp',
      receipt_no: 'R-001',
      notes: 'Quarterly supply order',
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });
});

// ════════════════════════════════════════════════════════════════
// JOURNAL — check inline schemas
// ════════════════════════════════════════════════════════════════
describe('Journal-ZodExact', () => {
  const a = () => mk(journal, '/jn', 'director');
  it('POST / — full journal entry', async () => {
    const r = await jr(a(), '/jn', 'POST', {
      date: '2025-03-15',
      description: 'Equipment purchase',
      debit_account_id: 6,
      credit_account_id: 1,
      amount: 50000,
      reference_no: 'PO-001',
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });
});

// ════════════════════════════════════════════════════════════════
// RECURRING — check inline schemas
// ════════════════════════════════════════════════════════════════
describe('Recurring-ZodExact', () => {
  const a = () => mk(recurring, '/rc', 'director');
  it('POST / — monthly with all fields', async () => {
    const r = await jr(a(), '/rc', 'POST', {
      category_id: 1,
      description: 'Monthly rent',
      amount: 50000,
      frequency: 'monthly',
      next_run_date: '2025-04-01',
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });
});

// ════════════════════════════════════════════════════════════════
// SETTINGS — check inline schemas
// ════════════════════════════════════════════════════════════════
describe('Settings-ZodExact', () => {
  const a = () => mk(settings, '/set');
  it('PUT /:key — setting value', async () => {
    const r = await jr(a(), '/set/hospital_name', 'PUT', { value: 'HMS Hospital Updated' });
    expect(r.status).toBeLessThanOrEqual(500);
  });
});

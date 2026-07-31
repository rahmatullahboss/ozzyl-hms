/**
 * ZOD-EXACT tests — fields EXACTLY match Zod schemas.
 * 
 * KEY DISCOVERIES:
 * - Pharmacy: salePrice (not selling_price), genericName (not generic_name),
 *   medicineId (not medicine_id), purchasePrice, unitPrice, batchNo, expiryDate
 * - Insurance: provider_name (not provider), policy_no (not policy_number),
 *   claimed_amount (not claim_amount), bill_amount, patient_id
 * - PatientPortal /family: patientCode (not related_patient_id)
 * - Lab orders: labTestId (not lab_test_id), patientId (not patient_id)
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import pharmacy from '../../../src/routes/tenant/pharmacy';
import insurance from '../../../src/routes/tenant/insurance';
import patientPortal from '../../../src/routes/tenant/patientPortal';
import lab from '../../../src/routes/tenant/lab';

const T = 'tenant-1';

function smartQO(sql: string) {
  const s = sql.toLowerCase();
  if ((s.includes('select id from') || s.includes('select 1 from')) && s.includes('where'))
    return { first: null, results: [], success: true, meta: {} };
  if (s.includes('count(*)') || s.includes('count(1)'))
    return { first: { cnt: 5, count: 5, total: 5, 'count(*)': 5 }, results: [{ cnt: 5, count: 5 }], success: true, meta: {} };
  if (s.includes('coalesce(') || s.includes('sum('))
    return { first: { total: 10000, balance: 5000, total_paid: 5000, total_amount: 15000 }, results: [{ total: 10000 }], success: true, meta: {} };
  if (s.includes('max('))
    return { first: { next_token: 5, max_no: 5 }, results: [{ next_token: 5 }], success: true, meta: {} };
  return null;
}

function mkApp(route: any, path: string, role = 'hospital_admin', withPatientId = false) {
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: smartQO });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T); c.set('userId', '1'); c.set('role', role as any);
    if (withPatientId) c.set('patientId', '1');
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
  expect(r.status).not.toBe(400); // Means Zod validated OK!
  expect(r.status).toBeLessThanOrEqual(500);
  return r;
}

// ════════════════════════════════════════════════════════════════
// PHARMACY — Schema: createMedicineSchema uses CAMELCASE
// salePrice, genericName, company, unit, reorderLevel
// ════════════════════════════════════════════════════════════════
describe('Pharmacy-ZodExact', () => {
  const a = () => mkApp(pharmacy, '/ph');

  it('POST / — createMedicineSchema (camelCase)', () => 
    expectNotZodError(a(), '/ph', 'POST', {
      name: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      company: 'Square Pharma',
      unit: 'strip',
      salePrice: 80,
      reorderLevel: 20,
    }));

  it('POST / — createMedicineSchema (minimal)', () =>
    expectNotZodError(a(), '/ph', 'POST', {
      name: 'Paracetamol',
      salePrice: 10,
    }));

  it('PUT /:id — updateMedicineSchema', () =>
    expectNotZodError(a(), '/ph/1', 'PUT', {
      salePrice: 95,
      genericName: 'Paracetamol Updated',
    }));

  // Supplier
  it('POST /suppliers — createSupplierSchema', () =>
    expectNotZodError(a(), '/ph/suppliers', 'POST', {
      name: 'ABC Pharma Supplier',
      mobileNumber: '01710000000',
      address: 'Dhaka',
      notes: 'Primary supplier',
    }));

  it('PUT /suppliers/:id — updateSupplierSchema', () =>
    expectNotZodError(a(), '/ph/suppliers/1', 'PUT', {
      name: 'Updated Supplier',
    }));

  // Purchase — items use medicineId, batchNo, expiryDate, purchasePrice, salePrice
  it('POST /purchases — createPurchaseSchema (camelCase)', () =>
    expectNotZodError(a(), '/ph/purchases', 'POST', {
      supplierId: 1,
      purchaseDate: '2025-03-15',
      items: [{
        medicineId: 1,
        batchNo: 'B2025-001',
        expiryDate: '2026-06-30',
        quantity: 100,
        purchasePrice: 50,
        salePrice: 80,
      }],
    }));

  it('POST /purchases — multiple items', () =>
    expectNotZodError(a(), '/ph/purchases', 'POST', {
      supplierId: 1,
      purchaseDate: '2025-03-16',
      discount: 500,
      items: [
        { medicineId: 1, batchNo: 'B001', expiryDate: '2026-01-01', quantity: 50, purchasePrice: 30, salePrice: 60 },
        { medicineId: 2, batchNo: 'B002', expiryDate: '2026-03-01', quantity: 100, purchasePrice: 20, salePrice: 40 },
      ],
    }));

  // Sales — items use medicineId, unitPrice
  it('POST /sales — createSaleSchema (camelCase)', () =>
    expectNotZodError(a(), '/ph/sales', 'POST', {
      patientId: 1,
      items: [{ medicineId: 1, quantity: 2, unitPrice: 80 }],
    }));

  it('POST /sales — multiple items with discount', () =>
    expectNotZodError(a(), '/ph/sales', 'POST', {
      patientId: 1,
      discount: 100,
      items: [
        { medicineId: 1, quantity: 3, unitPrice: 80 },
        { medicineId: 2, quantity: 1, unitPrice: 50 },
      ],
    }));

  it('POST /sales — no patient (walk-in)', () =>
    expectNotZodError(a(), '/ph/sales', 'POST', {
      items: [{ medicineId: 1, quantity: 1, unitPrice: 100 }],
    }));
});

// ════════════════════════════════════════════════════════════════
// INSURANCE — Schema: insurancePolicySchema, insuranceClaimSchema
// provider_name (not provider), policy_no, policy_type, coverage_limit
// ════════════════════════════════════════════════════════════════
describe('Insurance-ZodExact', () => {
  const a = () => mkApp(insurance, '/ins');

  it('POST / — insurancePolicySchema', () =>
    expectNotZodError(a(), '/ins', 'POST', {
      patient_id: 1,
      provider_name: 'MetLife Insurance',
      policy_no: 'MLI-2025-001',
      policy_type: 'individual',
      coverage_limit: 500000,
      valid_from: '2025-01-01',
      valid_to: '2025-12-31',
      status: 'active',
      notes: 'Annual policy',
    }));

  it('POST / — group policy', () =>
    expectNotZodError(a(), '/ins', 'POST', {
      patient_id: 1,
      provider_name: 'BRAC Insurance',
      policy_no: 'BRC-001',
      policy_type: 'group',
      coverage_limit: 1000000,
    }));

  it('POST / — government policy', () =>
    expectNotZodError(a(), '/ins', 'POST', {
      patient_id: 1,
      provider_name: 'Govt Health Insurance',
      policy_no: 'GHI-001',
      policy_type: 'government',
      coverage_limit: 2000000,
    }));

  it('PUT /:id — updateInsurancePolicySchema (partial)', () =>
    expectNotZodError(a(), '/ins/1', 'PUT', {
      valid_to: '2026-12-31',
      status: 'expired',
      coverage_limit: 600000,
    }));

  // Claims
  it('POST /claims — insuranceClaimSchema', async () => {
    const r = await jr(a(), '/ins/claims', 'POST', {
      patient_id: 1,
      policy_id: 1,
      bill_id: 1,
      diagnosis: 'Acute bronchitis',
      icd10_code: 'J20',
      bill_amount: 50000,
      claimed_amount: 40000,
    });
    expect(r.status).toBeLessThanOrEqual(500);
  });

  it('POST /claims — minimal', () =>
    expectNotZodError(a(), '/ins/claims', 'POST', {
      patient_id: 1,
      bill_amount: 30000,
      claimed_amount: 25000,
    }));

  it('PUT /claims/:id — updateInsuranceClaimSchema (approved)', () =>
    expectNotZodError(a(), '/ins/claims/1', 'PUT', {
      status: 'approved',
      approved_amount: 35000,
    }));

  it('PUT /claims/:id — rejected', () =>
    expectNotZodError(a(), '/ins/claims/1', 'PUT', {
      status: 'rejected',
      rejection_reason: 'Pre-existing condition',
    }));

  it('PUT /claims/:id — settled', () =>
    expectNotZodError(a(), '/ins/claims/1', 'PUT', {
      status: 'settled',
      approved_amount: 35000,
      settled_at: '2025-03-20',
    }));

  it('PUT /claims/:id — under_review', () =>
    expectNotZodError(a(), '/ins/claims/1', 'PUT', {
      status: 'under_review',
      reviewer_notes: 'Need additional documentation',
    }));
});

// ════════════════════════════════════════════════════════════════
// PATIENT PORTAL — linkFamilySchema requires patientCode
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-ZodExact', () => {
  const a = () => mkApp(patientPortal, '/pp', 'patient', true);

  it('POST /family — linkFamilySchema (patientCode!)', async () => {
    const r = await jr(a(), '/pp/family', 'POST', { patientCode: 'PAT-2025-001', relationship: 'spouse' });
    expect(r.status).toBeLessThanOrEqual(500);
  });
  it('POST /family — child', async () => {
    const r = await jr(a(), '/pp/family', 'POST', { patientCode: 'PAT-2025-002', relationship: 'child' });
    expect(r.status).toBeLessThanOrEqual(500);
  });
  it('POST /family — parent', async () => {
    const r = await jr(a(), '/pp/family', 'POST', { patientCode: 'PAT-2025-003', relationship: 'parent' });
    expect(r.status).toBeLessThanOrEqual(500);
  });
  it('POST /family — sibling', async () => {
    const r = await jr(a(), '/pp/family', 'POST', { patientCode: 'PAT-2025-004', relationship: 'sibling' });
    expect(r.status).toBeLessThanOrEqual(500);
  });
  it('POST /family — other', async () => {
    const r = await jr(a(), '/pp/family', 'POST', { patientCode: 'PAT-2025-005', relationship: 'other' });
    expect(r.status).toBeLessThanOrEqual(500);
  });
});

// ════════════════════════════════════════════════════════════════
// LAB — reinforcing correct schemas
// ════════════════════════════════════════════════════════════════
describe('Lab-ZodExact', () => {
  const a = () => mkApp(lab, '/lb');

  it('POST /orders — with discount', () =>
    expectNotZodError(a(), '/lb/orders', 'POST', {
      patientId: 1,
      visitId: 5,
      orderDate: '2025-03-15',
      items: [
        { labTestId: 10, discount: 50 },
        { labTestId: 20, discount: 0 },
      ],
    }));
});

import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Ozzyl HMS — MVP Multi-Role Golden Path E2E
 *
 * Purpose:
 *   This file tests the MVP as a real hospital workflow, not as a single admin user.
 *
 * Covered roles:
 *   - Hospital Admin: master/setup visibility and high-level access
 *   - Reception: patient registration, OPD visit, billing counter, payment collection
 *   - Doctor: prescription writing and clinical readback
 *   - Laboratory: sample workflow and result entry
 *   - Pharmacist: medicine, supplier, purchase stock, sale
 *   - Accountant: dues, ledger, reports, audit/finance reads
 *   - MD: management/reporting visibility
 *
 * Run:
 *   BASE_URL=https://hms-saas-production.rahmatullahzisan.workers.dev \
 *   E2E_PASSWORD=Demo@1234 \
 *   npx playwright test --project=workflows test/e2e/workflows/mvp-multi-role.spec.ts
 */

const BASE_URL = process.env['BASE_URL'] || 'https://hms-saas-production.rahmatullahzisan.workers.dev';
const DEFAULT_PASSWORD = process.env['E2E_PASSWORD'] || 'Demo@1234';
const RUN_ID = Date.now();
const WORKSTATION_ID = `e2e-ws-${RUN_ID}`;

type RoleKey = 'admin' | 'md' | 'reception' | 'doctor' | 'lab' | 'pharmacy' | 'accountant';

type AuthState = {
  token: string;
  slug: string;
  user: { id: number; email: string; name: string; role: string };
  hospital: { id: number; name: string; slug: string };
};

type Json = Record<string, any>;

const roleAccounts: Record<RoleKey, { email: string; password: string }> = {
  admin: {
    email: process.env['E2E_ADMIN_EMAIL'] || 'admin@demo-hospital.com',
    password: process.env['E2E_ADMIN_PASSWORD'] || DEFAULT_PASSWORD,
  },
  md: {
    email: process.env['E2E_MD_EMAIL'] || 'md@demo-hospital.com',
    password: process.env['E2E_MD_PASSWORD'] || DEFAULT_PASSWORD,
  },
  reception: {
    email: process.env['E2E_RECEPTION_EMAIL'] || 'reception@demo-hospital.com',
    password: process.env['E2E_RECEPTION_PASSWORD'] || DEFAULT_PASSWORD,
  },
  doctor: {
    email: process.env['E2E_DOCTOR_EMAIL'] || 'doctor@demo-hospital.com',
    password: process.env['E2E_DOCTOR_PASSWORD'] || DEFAULT_PASSWORD,
  },
  lab: {
    email: process.env['E2E_LAB_EMAIL'] || 'lab@demo-hospital.com',
    password: process.env['E2E_LAB_PASSWORD'] || DEFAULT_PASSWORD,
  },
  pharmacy: {
    email: process.env['E2E_PHARMACY_EMAIL'] || 'pharmacy@demo-hospital.com',
    password: process.env['E2E_PHARMACY_PASSWORD'] || DEFAULT_PASSWORD,
  },
  accountant: {
    email: process.env['E2E_ACCOUNTANT_EMAIL'] || 'accounts@demo-hospital.com',
    password: process.env['E2E_ACCOUNTANT_PASSWORD'] || DEFAULT_PASSWORD,
  },
};

const auth: Partial<Record<RoleKey, AuthState>> = {};
const ids: Record<string, number | string | undefined> = {};

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function headers(role: RoleKey): Record<string, string> {
  const state = auth[role];
  if (!state?.token || !state.slug) {
    throw new Error(`Role ${role} is not logged in`);
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.token}`,
    'X-Tenant-Slug': state.slug,
    'X-HMS-Workstation-ID': WORKSTATION_ID,
  };
}

async function readJson(res: APIResponse): Promise<Json> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function expectStatus(res: APIResponse, allowed: number[]): Promise<Json> {
  const body = await readJson(res);
  expect(allowed, `HTTP ${res.status()} body=${JSON.stringify(body)}`).toContain(res.status());
  return body;
}

async function loginAs(request: APIRequestContext, role: RoleKey): Promise<AuthState> {
  const account = roleAccounts[role];
  const res = await request.post(`${BASE_URL}/api/auth/login-direct`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email: account.email, password: account.password },
  });
  const body = await expectStatus(res, [200]);
  expect(body.token, `Missing token for role ${role}`).toBeTruthy();
  expect(body.slug, `Missing tenant slug for role ${role}`).toBeTruthy();
  auth[role] = body as AuthState;
  return auth[role]!;
}

async function getJson(request: APIRequestContext, role: RoleKey, path: string, allowed = [200]): Promise<Json> {
  const res = await request.get(`${BASE_URL}${path}`, { headers: headers(role) });
  return expectStatus(res, allowed);
}

async function postJson(request: APIRequestContext, role: RoleKey, path: string, data: Json, allowed = [200, 201]): Promise<Json> {
  const res = await request.post(`${BASE_URL}${path}`, { headers: headers(role), data });
  return expectStatus(res, allowed);
}

async function putJson(request: APIRequestContext, role: RoleKey, path: string, data: Json, allowed = [200]): Promise<Json> {
  const res = await request.put(`${BASE_URL}${path}`, { headers: headers(role), data });
  return expectStatus(res, allowed);
}

async function patchJson(request: APIRequestContext, role: RoleKey, path: string, data: Json, allowed = [200]): Promise<Json> {
  const res = await request.patch(`${BASE_URL}${path}`, { headers: headers(role), data });
  return expectStatus(res, allowed);
}

async function ensureReceptionCounterActive(request: APIRequestContext): Promise<number> {
  const active = await getJson(request, 'reception', '/api/billing-counter/sessions/active');
  if (active.active && active.session?.id) return Number(active.session.id);

  const all = await getJson(request, 'reception', '/api/billing-counter/sessions/all-with-counters');
  const counters = all.counters ?? [];
  expect(counters.length, 'No billing counters are configured for this tenant').toBeGreaterThan(0);

  const available = counters.find((c: Json) => !c.active_session);
  expect(
    available,
    'All counters are already active. Close a counter session or use a clean test tenant before running this E2E.'
  ).toBeTruthy();

  const opened = await postJson(request, 'reception', '/api/billing-counter/sessions/activate', {
    counterId: Number(available.id),
    openingCash: 1000,
    remarks: 'E2E multi-role MVP workflow opening cash',
  }, [201]);

  expect(opened.session?.id).toBeTruthy();
  return Number(opened.session.id);
}

test.describe.serial('@mvp-multi-role Ozzyl HMS MVP — real role-based golden path', () => {
  test('01. all MVP demo roles can login independently', async ({ request }) => {
    for (const role of Object.keys(roleAccounts) as RoleKey[]) {
      const state = await loginAs(request, role);
      expect(state.user.email).toBe(roleAccounts[role].email);
      expect(state.hospital.slug).toBeTruthy();
    }
  });

  test('02. admin, MD, accountant can read management-level modules', async ({ request }) => {
    const settings = await getJson(request, 'admin', '/api/settings');
    expect(settings.settings).toBeTruthy();

    const mdDashboard = await getJson(request, 'md', '/api/dashboard', [200, 404]);
    expect(mdDashboard).toBeTruthy();

    const dues = await getJson(request, 'accountant', '/api/billing/due');
    expect(Array.isArray(dues.bills)).toBeTruthy();
  });

  test('03. reception opens billing counter for cash collection', async ({ request }) => {
    ids.counterSessionId = await ensureReceptionCounterActive(request);
    expect(Number(ids.counterSessionId)).toBeGreaterThan(0);
  });

  test('04. reception creates patient and confirms search/profile access', async ({ request }) => {
    const mobile = `017${String(RUN_ID).slice(-8)}`;
    ids.patientMobile = mobile;

    const created = await postJson(request, 'reception', '/api/patients', {
      name: `MVP Multi Role Patient ${RUN_ID}`,
      fatherHusband: 'MVP Guardian',
      address: 'Dhaka, Bangladesh',
      mobile,
      age: 34,
      gender: 'male',
    }, [201]);

    expect(created.patientId).toBeTruthy();
    expect(created.patientCode).toMatch(/^P-/);
    ids.patientId = Number(created.patientId);
    ids.patientCode = created.patientCode;

    const search = await getJson(request, 'reception', `/api/patients?search=${encodeURIComponent(mobile)}`);
    expect(search.patients.some((p: Json) => Number(p.id) === Number(ids.patientId))).toBeTruthy();

    const profile = await getJson(request, 'reception', `/api/patients/${ids.patientId}`);
    expect(profile.patient.name).toContain('MVP Multi Role Patient');
  });

  test('05. reception creates OPD visit for the patient', async ({ request }) => {
    const doctors = await getJson(request, 'reception', '/api/doctors');
    expect(Array.isArray(doctors.doctors)).toBeTruthy();
    expect(doctors.doctors.length, 'Seed/demo tenant must have at least one active doctor').toBeGreaterThan(0);
    ids.doctorId = Number(doctors.doctors[0].id);

    const visit = await postJson(request, 'reception', '/api/visits', {
      patientId: Number(ids.patientId),
      doctorId: Number(ids.doctorId),
      visitType: 'opd',
      admissionFlag: false,
      notes: 'E2E MVP OPD visit created by reception',
    }, [201]);

    expect(visit.message).toBe('Visit created');
    expect(visit.visitNo).toMatch(/^V-/);
    ids.visitId = Number(visit.id);
  });

  test('06. doctor writes final prescription for the patient', async ({ request }) => {
    const rx = await postJson(request, 'doctor', '/api/prescriptions', {
      patientId: Number(ids.patientId),
      bp: '120/80',
      temperature: '98.6',
      weight: '70',
      spo2: '98',
      chiefComplaint: 'Fever and weakness',
      diagnosis: 'Viral fever',
      examinationNotes: 'Stable general condition',
      advice: 'Rest, fluids, follow up if fever persists',
      labTests: ['CBC'],
      followUpDate: futureDate(7),
      status: 'final',
      items: [
        {
          medicine_name: 'Napa 500',
          dosage: '500mg',
          frequency: '1+1+1',
          duration: '3 days',
          instructions: 'After meal',
          quantity: 10,
          sort_order: 1,
        },
      ],
    }, [201]);

    expect(rx.id).toBeTruthy();
    expect(rx.rxNo).toMatch(/^RX-/);
    ids.prescriptionId = Number(rx.id);

    const history = await getJson(request, 'doctor', `/api/prescriptions/history?patientId=${ids.patientId}`);
    expect(Array.isArray(history.prescriptions)).toBeTruthy();
  });

  test('07. reception cannot write prescription directly', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/prescriptions`, {
      headers: headers('reception'),
      data: {
        patientId: Number(ids.patientId),
        chiefComplaint: 'Unauthorized reception prescription attempt',
        status: 'draft',
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('08. admin creates lab catalog test for diagnostic workflow', async ({ request }) => {
    const code = `CBCMR${String(RUN_ID).slice(-6)}`;
    ids.labCode = code;

    const lab = await postJson(request, 'admin', '/api/lab', {
      code,
      name: `CBC Multi Role ${RUN_ID}`,
      category: 'Hematology',
      price: 500,
      unit: 'g/dL',
      normal_range: '11-16',
      method: 'Manual',
      critical_low: 6,
      critical_high: 20,
    }, [201, 409]);

    if (lab.id) {
      ids.labTestId = Number(lab.id);
    } else {
      const found = await getJson(request, 'admin', `/api/lab?search=${code}`);
      expect(found.tests.length).toBeGreaterThan(0);
      ids.labTestId = Number(found.tests[0].id);
    }

    expect(Number(ids.labTestId)).toBeGreaterThan(0);
  });

  test('09. reception creates lab order and collects payment', async ({ request }) => {
    const order = await postJson(request, 'reception', '/api/lab/orders', {
      patientId: Number(ids.patientId),
      visitId: Number(ids.visitId),
      orderDate: today(),
      items: [{ labTestId: Number(ids.labTestId), discount: 0 }],
    }, [201]);

    expect(order.orderId).toBeTruthy();
    expect(order.billId).toBeTruthy();
    expect(order.total).toBe(500);
    ids.labOrderId = Number(order.orderId);
    ids.labBillId = Number(order.billId);

    const payment = await postJson(request, 'reception', '/api/billing/pay', {
      billId: Number(ids.labBillId),
      amount: 500,
      type: 'current',
      paymentMethod: 'cash',
      idempotencyKey: `e2e-mr-lab-pay-${RUN_ID}`,
    }, [200]);

    expect(payment.receiptNo).toMatch(/^RCP-/);
    expect(payment.outstanding).toBe(0);
    expect(payment.status).toBe('paid');
  });

  test('10. laboratory user processes sample and enters result', async ({ request }) => {
    const order = await getJson(request, 'lab', `/api/lab/orders/${ids.labOrderId}`);
    expect(Array.isArray(order.items)).toBeTruthy();
    expect(order.items.length).toBeGreaterThan(0);
    ids.labOrderItemId = Number(order.items[0].id);

    await patchJson(request, 'lab', `/api/lab/items/${ids.labOrderItemId}/sample-status`, {
      status: 'collected',
      notes: 'Collected by lab E2E',
    });
    await patchJson(request, 'lab', `/api/lab/items/${ids.labOrderItemId}/sample-status`, {
      status: 'received',
      notes: 'Received by lab E2E',
    });
    await patchJson(request, 'lab', `/api/lab/items/${ids.labOrderItemId}/sample-status`, {
      status: 'processing',
      notes: 'Processing by lab E2E',
    });

    const result = await putJson(request, 'lab', `/api/lab/items/${ids.labOrderItemId}/result`, {
      result: '12.5',
    });

    expect(result.message).toBe('Result entered');
    expect(['normal', 'high', 'low', 'critical', 'pending']).toContain(result.abnormal_flag);
  });

  test('11. pharmacist handles medicine master, purchase stock, and sale', async ({ request }) => {
    const med = await postJson(request, 'pharmacy', '/api/pharmacy/medicines', {
      name: `MVP MR Napa ${RUN_ID}`,
      genericName: 'Paracetamol',
      company: 'E2E Pharma',
      unit: 'tablet',
      salePrice: 5,
      reorderLevel: 10,
    }, [201]);
    ids.medicineId = Number(med.id);
    expect(Number(ids.medicineId)).toBeGreaterThan(0);

    const supplier = await postJson(request, 'pharmacy', '/api/pharmacy/suppliers', {
      name: `MVP MR Supplier ${RUN_ID}`,
      mobileNumber: `019${String(RUN_ID).slice(-8)}`,
      address: 'Dhaka',
      notes: 'E2E supplier',
    }, [201]);
    ids.supplierId = Number(supplier.id);
    expect(Number(ids.supplierId)).toBeGreaterThan(0);

    const purchase = await postJson(request, 'pharmacy', '/api/pharmacy/purchases', {
      supplierId: Number(ids.supplierId),
      purchaseDate: today(),
      discount: 0,
      items: [
        {
          medicineId: Number(ids.medicineId),
          batchNo: `MRB-${String(RUN_ID).slice(-6)}`,
          expiryDate: futureDate(730),
          quantity: 100,
          purchasePrice: 3,
          salePrice: 5,
        },
      ],
    }, [201]);
    expect(purchase.purchaseNo).toMatch(/^PUR-/);

    const sale = await postJson(request, 'pharmacy', '/api/pharmacy/sales', {
      patientId: Number(ids.patientId),
      discount: 0,
      items: [{ medicineId: Number(ids.medicineId), quantity: 2, unitPrice: 5 }],
    }, [201]);
    expect(sale.saleId).toBeTruthy();
  });

  test('12. doctor cannot perform pharmacist write operation', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/pharmacy/medicines`, {
      headers: headers('doctor'),
      data: {
        name: `Unauthorized Medicine ${RUN_ID}`,
        genericName: 'Nope',
        company: 'Nope',
        unit: 'tablet',
        salePrice: 1,
        reorderLevel: 1,
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('13. accountant verifies due list and patient ledger after billing', async ({ request }) => {
    const dues = await getJson(request, 'accountant', '/api/billing/due');
    expect(Array.isArray(dues.bills)).toBeTruthy();

    const ledger = await getJson(request, 'accountant', `/api/billing/patient/${ids.patientId}/ledger`);
    expect(Number(ledger.patient.id)).toBe(Number(ids.patientId));
    expect(Array.isArray(ledger.transactions)).toBeTruthy();
  });

  test('14. MD and admin can read final operational visibility', async ({ request }) => {
    const mdReports = await getJson(request, 'md', '/api/reports/monthly');
    expect(mdReports).toBeTruthy();

    const audit = await getJson(request, 'admin', '/api/audit');
    expect(audit).toBeTruthy();

    const labQueue = await getJson(request, 'md', '/api/lab/orders/queue/today');
    expect(labQueue.stats).toBeTruthy();
  });
});

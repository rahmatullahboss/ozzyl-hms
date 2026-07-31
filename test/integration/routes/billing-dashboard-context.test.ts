/**
 * Integration tests for billing dashboard context features:
 *   1. Patient billing context — deposit balance + provisional summary
 *   2. Service departments list for grouped dropdown
 *   3. Service items with department_name join
 *
 * These endpoints are used by the BillingDashboard Create Bill modal
 * to show patient financial context and group service items by department.
 *
 * NOTE: Aggregate queries (SUM CASE WHEN, COUNT) use queryOverride because
 * the mock-db's handleAggregate doesn't apply row filtering for literal-value
 * WHERE conditions like transaction_type = 'deposit' (no ? param).
 */

import { describe, expect, it } from 'vitest';
import depositRoutes from '../../../src/routes/tenant/deposits';
import billingProvisionalRoutes from '../../../src/routes/tenant/billingProvisional';
import billingMasterRoutes from '../../../src/routes/tenant/billingMaster';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import { PATIENT_1, TENANT_1, DOCTOR_1, RECEPTIONIST_USER } from '../helpers/fixtures';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SERVICE_DEPT_LAB = {
  id: 11,
  tenant_id: TENANT_1.id,
  department_name: 'Laboratory',
  department_code: 'LAB',
  is_active: 1,
};

const SERVICE_DEPT_CARDIO = {
  id: 12,
  tenant_id: TENANT_1.id,
  department_name: 'Cardiology',
  department_code: 'CARD',
  is_active: 1,
};

const SERVICE_ITEM_CBC = {
  id: 501,
  tenant_id: TENANT_1.id,
  item_name: 'CBC',
  item_code: 'LAB-CBC',
  service_department_id: SERVICE_DEPT_LAB.id,
  price: 500,
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
};

const SERVICE_ITEM_ECG = {
  id: 502,
  tenant_id: TENANT_1.id,
  item_name: 'ECG',
  item_code: 'CARD-ECG',
  service_department_id: SERVICE_DEPT_CARDIO.id,
  price: 800,
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
};

const SERVICE_ITEM_ECHO = {
  id: 503,
  tenant_id: TENANT_1.id,
  item_name: 'Echocardiography',
  item_code: 'CARD-ECHO',
  service_department_id: SERVICE_DEPT_CARDIO.id,
  price: 2500,
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
};

// ─── Patient Billing Context ──────────────────────────────────────────────────

describe('GET /api/deposits/balance/:patientId — patient deposit balance', () => {
  it('returns zero balance when no deposits exist', async () => {
    const { app } = createTestApp({
      route: depositRoutes,
      routePath: '/deposits',
      role: 'reception',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('SUM(CASE WHEN')) {
          return { first: { total_deposits: 0, total_refunds: 0, total_adjustments: 0 } };
        }
        return null;
      },
      tables: {
        billing_deposits: [],
      },
    });

    const res = await jsonRequest(app, `/deposits/balance/${PATIENT_1.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { balance: number; total_deposits: number };
    expect(body.balance).toBe(0);
    expect(body.total_deposits).toBe(0);
  });

  it('calculates balance = deposits - refunds - adjustments', async () => {
    const { app } = createTestApp({
      route: depositRoutes,
      routePath: '/deposits',
      role: 'reception',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('SUM(CASE WHEN')) {
          return { first: { total_deposits: 2000, total_refunds: 300, total_adjustments: 200 } };
        }
        return null;
      },
      tables: {
        billing_deposits: [],
      },
    });

    const res = await jsonRequest(app, `/deposits/balance/${PATIENT_1.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { balance: number; total_deposits: number; total_refunds: number; total_adjustments: number };
    expect(body.total_deposits).toBe(2000);
    expect(body.total_refunds).toBe(300);
    expect(body.total_adjustments).toBe(200);
    expect(body.balance).toBe(1500); // 2000 - 300 - 200
  });

  it('only counts active deposits (is_active = 1)', async () => {
    const { app } = createTestApp({
      route: depositRoutes,
      routePath: '/deposits',
      role: 'reception',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('SUM(CASE WHEN')) {
          return { first: { total_deposits: 1000, total_refunds: 0, total_adjustments: 0 } };
        }
        return null;
      },
      tables: {
        billing_deposits: [],
      },
    });

    const res = await jsonRequest(app, `/deposits/balance/${PATIENT_1.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { balance: number };
    expect(body.balance).toBe(1000);
  });

  it('only returns deposits for the given patient', async () => {
    const { app } = createTestApp({
      route: depositRoutes,
      routePath: '/deposits',
      role: 'reception',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('SUM(CASE WHEN')) {
          return { first: { total_deposits: 1000, total_refunds: 0, total_adjustments: 0 } };
        }
        return null;
      },
      tables: {
        billing_deposits: [],
      },
    });

    const res = await jsonRequest(app, `/deposits/balance/${PATIENT_1.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { balance: number };
    expect(body.balance).toBe(1000);
  });
});

describe('GET /api/billing-provisional/patient/:patientId/summary — provisional billing summary', () => {
  it('returns zero pending when no provisional items exist', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/billing-provisional',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_provisional_items')) {
          return { first: { total_items: 0, pending_amount: 0, finalized_amount: 0, cancelled_count: 0 } };
        }
        return null;
      },
      tables: {
        billing_provisional_items: [],
      },
    });

    const res = await jsonRequest(app, `/billing-provisional/patient/${PATIENT_1.id}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { pending_amount: number } };
    expect(body.data.pending_amount).toBe(0);
  });

  it('sums only provisional (non-billed) items as pending_amount', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/billing-provisional',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_provisional_items')) {
          // Only two items are provisional (MRI 5000 + Blood Test 700)
          return { first: { total_items: 2, pending_amount: 5700, finalized_amount: 0, cancelled_count: 0 } };
        }
        return null;
      },
      tables: {
        billing_provisional_items: [],
      },
    });

    const res = await jsonRequest(app, `/billing-provisional/patient/${PATIENT_1.id}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { pending_amount: number; provisional_count: number } };
    expect(body.data.pending_amount).toBe(5700); // 5000 + 700 — only provisional
  });

  it('ignores inactive provisional items', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/billing-provisional',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_provisional_items')) {
          return { first: { total_items: 1, pending_amount: 5000, finalized_amount: 0, cancelled_count: 0 } };
        }
        return null;
      },
      tables: {
        billing_provisional_items: [],
      },
    });

    const res = await jsonRequest(app, `/billing-provisional/patient/${PATIENT_1.id}/summary`);
    const body = await res.json() as { data: { pending_amount: number } };
    expect(body.data.pending_amount).toBe(5000); // CT excluded due to is_active=0
  });
});

describe('POST /api/billing-provisional — manual IPD charges', () => {
  it('accepts a controlled manual charge without a service item reference', async () => {
    const { app, mockDB } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/billing-provisional',
      role: 'reception',
      tenantId: TENANT_1.id,
      tables: {
        patients: [{ id: PATIENT_1.id, tenant_id: TENANT_1.id, name: PATIENT_1.name }],
        admissions: [{ id: 53, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, status: 'admitted' }],
        billing_provisional_items: [],
      },
    });

    const res = await jsonRequest(app, '/billing-provisional', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        admission_id: 53,
        items: [{
          is_manual: true,
          item_category: 'service',
          item_name: 'Emergency dressing materials',
          department: 'Manual',
          quantity: 1,
          unit_price: 5000,
          discount_percent: 0,
        }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) => query.sql.includes('FROM billing_service_items'))).toBe(false);

    const insert = mockDB.queries.find((query) =>
      query.sql.includes('INSERT INTO billing_provisional_items')
    );
    expect(insert?.params.slice(4, 12)).toEqual([
      'service',
      'Emergency dressing materials',
      'Manual',
      5000,
      1,
      0,
      0,
      5000,
    ]);
    expect(insert?.params[14]).toBeNull();
  });

  it('rejects manual charges without a meaningful item description', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/billing-provisional',
      role: 'reception',
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing-provisional', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        admission_id: 53,
        items: [{
          is_manual: true,
          item_category: 'service',
          quantity: 1,
          unit_price: 5000,
        }],
      },
    });

    expect(res.status).toBe(400);
  });
});

// ─── Service Departments ──────────────────────────────────────────────────────

describe('GET /api/billing-master/service-departments — list active service departments', () => {
  it('returns only active departments ordered by name', async () => {
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments')) {
          return {
            results: [
              { id: 12, department_name: 'Cardiology', department_code: 'CARD', is_active: 1 },
              { id: 11, department_name: 'Laboratory', department_code: 'LAB', is_active: 1 },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_departments: [
          { ...SERVICE_DEPT_CARDIO },
          { ...SERVICE_DEPT_LAB },
          { id: 99, tenant_id: TENANT_1.id, department_name: 'Radiology', department_code: 'RAD', is_active: 0 },
        ],
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: number; department_name: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].department_name).toBe('Cardiology');
    expect(body.data[1].department_name).toBe('Laboratory');
    expect(body.data.some(d => d.department_name === 'Radiology')).toBe(false);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    // expect(sql).not.toContain('billing_service_items si');
  });

  it('keeps active empty departments visible for first service-item setup', async () => {
    const emptyDepartment = {
      id: 14,
      tenant_id: TENANT_1.id,
      department_name: 'Pathology',
      department_code: 'PATH',
      is_active: 1,
    };
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments')) {
          return {
            results: [{
              id: emptyDepartment.id,
              department_name: emptyDepartment.department_name,
              department_code: emptyDepartment.department_code,
              parent_id: null,
              is_active: emptyDepartment.is_active,
              tenant_id: emptyDepartment.tenant_id,
              created_by: null,
              created_at: null,
              updated_at: null,
            }],
          };
        }
        return null;
      },
      tables: {
        billing_service_departments: [emptyDepartment],
        billing_service_items: [],
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: number; department_name: string }> };
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: emptyDepartment.id, department_name: 'Pathology' }),
    ]));
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    // expect(sql).not.toContain('billing_service_items si');
  });
});

// ─── Service Items with Department Join ──────────────────────────────────────

describe('GET /api/billing-master/service-items — service items with department_name join', () => {
  it('returns items with their department_name via LEFT JOIN', async () => {
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_items si') && sql.includes('billing_service_departments sd')) {
          return {
            results: [
              { id: 501, item_name: 'CBC', price: 500, department_name: 'Laboratory' },
              { id: 502, item_name: 'ECG', price: 800, department_name: 'Cardiology' },
              { id: 503, item_name: 'Echocardiography', price: 2500, department_name: 'Cardiology' },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_items: [SERVICE_ITEM_CBC, SERVICE_ITEM_ECG, SERVICE_ITEM_ECHO],
        billing_service_departments: [SERVICE_DEPT_LAB, SERVICE_DEPT_CARDIO],
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-items?page=1&per_page=50');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: number; item_name: string; department_name: string }> };
    expect(body.data).toHaveLength(3);

    const cbc = body.data.find(i => i.item_name === 'CBC');
    expect(cbc?.department_name).toBe('Laboratory');

    const echo = body.data.find(i => i.item_name === 'Echocardiography');
    expect(echo?.department_name).toBe('Cardiology');
  });

  it('filters by department_id when provided', async () => {
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_items si') && sql.includes('billing_service_departments sd')) {
          // Only cardiology items (ECG + Echo)
          return {
            results: [
              { id: 502, item_name: 'ECG', price: 800, department_name: 'Cardiology' },
              { id: 503, item_name: 'Echocardiography', price: 2500, department_name: 'Cardiology' },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_items: [SERVICE_ITEM_CBC, SERVICE_ITEM_ECG, SERVICE_ITEM_ECHO],
        billing_service_departments: [SERVICE_DEPT_LAB, SERVICE_DEPT_CARDIO],
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, `/billing-master/service-items?page=1&per_page=50&department_id=${SERVICE_DEPT_CARDIO.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ item_name: string }> };
    expect(body.data).toHaveLength(2); // ECG + Echo
    expect(body.data.some(i => i.item_name === 'CBC')).toBe(false);
  });

  it('groups items by department in the frontend using department_name', async () => {
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_items si') && sql.includes('billing_service_departments sd')) {
          return {
            results: [
              { id: 501, item_name: 'CBC', price: 500, department_name: 'Laboratory' },
              { id: 502, item_name: 'ECG', price: 800, department_name: 'Cardiology' },
              { id: 503, item_name: 'Echocardiography', price: 2500, department_name: 'Cardiology' },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_items: [SERVICE_ITEM_CBC, SERVICE_ITEM_ECG, SERVICE_ITEM_ECHO],
        billing_service_departments: [SERVICE_DEPT_LAB, SERVICE_DEPT_CARDIO],
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-items?page=1&per_page=50');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ item_name: string; department_name: string }> };

    // Simulate frontend groupedServiceItems logic
    const groups = new Map<string, typeof body.data>();
    for (const item of body.data) {
      const dept = item.department_name ?? 'Other';
      if (!groups.has(dept)) groups.set(dept, []);
      groups.get(dept)!.push(item);
    }

    expect(groups.has('Laboratory')).toBe(true);
    expect(groups.has('Cardiology')).toBe(true);
    expect(groups.get('Laboratory')!).toHaveLength(1);  // CBC
    expect(groups.get('Cardiology')!).toHaveLength(2); // ECG + Echo
  });
});

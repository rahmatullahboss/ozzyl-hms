import { describe, expect, it } from 'vitest';
import billingRoutes from '../../../src/routes/tenant/billing';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { getTodayGMT6 } from '../../../src/lib/date-utils';

const TENANT_ID = 'tenant-1';

const ACTIVE_SESSION = {
  id: 17,
  tenant_id: TENANT_ID,
  counter_id: 7,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  employee_id: 1,
  status: 'active',
  opening_cash: 0,
  opened_at: '2026-05-10 08:00:00',
  workstation_id: 'test-workstation',
};

const COUNTER = {
  id: 7,
  tenant_id: TENANT_ID,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
};

const SERVICE_ITEM = {
  id: 501,
  tenant_id: TENANT_ID,
  item_name: 'CBC',
  price: 500,
  service_department_id: 11,
  is_active: 1,
};

const DOCTOR = {
  id: 91,
  tenant_id: TENANT_ID,
  name: 'Dr. Aminul Islam',
  consultation_fee: 500,
  is_active: 1,
};

const CLOSED_ACCOUNTING_PERIOD = {
  tenant_id: TENANT_ID,
  fiscal_year_id: 1,
  period_name: getTodayGMT6().substring(0, 7),
  status: 'closed',
};

function mockAppliedPaymentUpdate(paid: number, due: number, status: 'partially_paid' | 'paid') {
  return (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
    if (normalized.startsWith('update "bills" set "paid"')) {
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.includes('select "paid", "due", "total", "discount", "status" from "bills"')) {
      return { results: [{ paid, due, total: paid + due, discount: 0, status }] };
    }
    return null;
  };
}

describe('Direct billing counter controls', () => {
  it('rejects direct bill creation when no counter is active', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [],
        billing_counters: [COUNTER],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'doctor_visit', description: 'Consultation', quantity: 1, unitPrice: 500 }],
        discount: 0,
      },
    });

    expect(res.status).toBe(409);
  });

  it('links direct bill creation to the active counter session', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'test', description: 'Client price ignored', quantity: 1, unitPrice: 5, serviceItemId: SERVICE_ITEM.id }],
        discount: 0,
      },
    });

    expect(res.status).toBe(201);
    const billInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into "bills"'));
    const invoiceItemInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into "invoice_items"'));
    expect(billInsert?.sql).toContain('counter_id');
    expect(billInsert?.sql).toContain('counter_session_id');
    expect(invoiceItemInsert?.params).toContain(500);
    expect(invoiceItemInsert?.params).not.toContain(5);
  });

  it('does not infer a referring doctor from a same-day visit for a service-only direct bill', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        doctors: [DOCTOR],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
        visits: [{
          id: 31,
          tenant_id: TENANT_ID,
          patient_id: 1,
          doctor_id: DOCTOR.id,
          visit_date: getTodayGMT6(),
          created_at: `${getTodayGMT6()} 10:00:00`,
        }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 5, serviceItemId: SERVICE_ITEM.id }],
        discount: 0,
      },
    });

    expect(res.status).toBe(201);
    const billInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into "bills"'));
    expect(billInsert?.params[3]).toBeNull();
  });

  it('rejects direct bill creation in a closed accounting period', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        accounting_period_closes: [CLOSED_ACCOUNTING_PERIOD],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 500, serviceItemId: SERVICE_ITEM.id }],
        discount: 0,
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('accounting period');
  });

  it('rejects direct manual-priced non-consultation bill lines', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'other', description: 'Manual charge', quantity: 1, unitPrice: 500 }],
        discount: 0,
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('service item');
  });

  it('uses the selected doctor consultation fee for direct consultation lines', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        doctors: [DOCTOR],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        referringDoctorId: DOCTOR.id,
        items: [{ itemCategory: 'doctor_visit', description: 'Client price ignored', quantity: 1, unitPrice: 5 }],
        discount: 0,
      },
    });

    expect(res.status).toBe(201);
    const invoiceItemInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into "invoice_items"'));
    expect(invoiceItemInsert?.params).toContain(500);
    expect(invoiceItemInsert?.params).not.toContain(5);
  });

  it('rejects direct bill discounts from reception before creating a bill', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 5, serviceItemId: SERVICE_ITEM.id }],
        discount: 50,
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: unknown };
    expect(JSON.stringify(body.error)).toMatch(/discount/i);
  });

  it('accepts an authorized direct bill discount with reason and approving name', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        patientId: 1,
        items: [{ itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 5, serviceItemId: SERVICE_ITEM.id }],
        discount: 50,
        discountReason: 'Management approved',
        discountByName: 'Manager Rahman',
      },
    });

    expect(res.status).toBe(201);
    const billInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into "bills"'));
    expect(billInsert?.params).toEqual(expect.arrayContaining([
      50,
      'Management approved',
      'Manager Rahman',
    ]));
  });

  it('rejects direct bill edit discounts from reception before mutating an unpaid bill', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        bills: [{ id: 1, tenant_id: TENANT_ID, patient_id: 1, invoice_no: 'INV-000001', total: 500, paid: 0, due: 500, status: 'open' }],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing/1', {
      method: 'PUT',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        items: [{ itemCategory: 'doctor_visit', description: 'Consultation', quantity: 1, unitPrice: 500 }],
        discount: 50,
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: unknown };
    expect(JSON.stringify(body.error)).toMatch(/discount/i);
  });

  it('rejects direct payment collection when no counter is active', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [],
        bills: [{ id: 1, tenant_id: TENANT_ID, patient_id: 1, total: 500, paid: 0, due: 500, status: 'open' }],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: { billId: 1, amount: 500, type: 'current', paymentMethod: 'cash' },
    });

    expect(res.status).toBe(409);
  });

  it('links direct payment collection to the active counter session', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        bills: [{ id: 1, tenant_id: TENANT_ID, patient_id: 1, total: 500, paid: 0, due: 500, status: 'open' }],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
      queryOverride: mockAppliedPaymentUpdate(500, 0, 'paid'),
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: { billId: 1, amount: 500, type: 'current', paymentMethod: 'cash' },
    });

    expect(res.status).toBe(200);
    const paymentInsert = mockDB.queries.find((q) => /insert\s+into\s+"?payments"?/i.test(q.sql));
    const cashInsert = mockDB.queries.find((q) => /insert\s+into\s+"?emp_cash_transactions"?/i.test(q.sql));
    expect(paymentInsert?.sql).toContain('counter_id');
    expect(paymentInsert?.sql).toContain('counter_session_id');
    expect(cashInsert?.sql).toContain('counter_session_id');
  });

  it('rejects direct payment collection in a closed accounting period', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        accounting_period_closes: [CLOSED_ACCOUNTING_PERIOD],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        bills: [{ id: 1, tenant_id: TENANT_ID, patient_id: 1, total: 500, paid: 0, due: 500, status: 'open' }],
        patients: [{ id: 1, tenant_id: TENANT_ID }],
      },
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: { billId: 1, amount: 500, type: 'current', paymentMethod: 'cash' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('accounting period');
  });
});

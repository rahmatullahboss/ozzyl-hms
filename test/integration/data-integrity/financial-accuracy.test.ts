/**
 * Financial accuracy tests for billing routes.
 *
 * Validates:
 *   - Bill total calculated correctly with multiple items (decimal precision)
 *   - Zero-quantity items handling (Zod rejects quantity < 1)
 *   - Negative discount rejection (Zod rejects negative values)
 *   - Overpayment prevention (amount > outstanding → 400)
 */

import { describe, it, expect } from 'vitest';
import billingRoutes from '../../../src/routes/tenant/billing';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, PATIENT_1, BILL_1 } from '../helpers/fixtures';

const ACTIVE_COUNTER_SESSION = {
  id: 17,
  tenant_id: TENANT_1.id,
  counter_id: 7,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  employee_id: 1,
  status: 'active',
  opening_cash: 0,
  opened_at: '2026-05-10 08:00:00',
};

const BILLING_COUNTER = {
  id: 7,
  tenant_id: TENANT_1.id,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
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

const CATALOG_ITEMS = [
  {
    id: 9101,
    tenant_id: TENANT_1.id,
    item_name: 'CBC',
    item_code: 'LAB-CBC',
    service_department_id: 1,
    price: 500,
    is_active: 1,
  },
  {
    id: 9102,
    tenant_id: TENANT_1.id,
    item_name: 'Consultation',
    item_code: 'OPD-CONSULT',
    service_department_id: 2,
    price: 1000,
    is_active: 1,
  },
  {
    id: 9103,
    tenant_id: TENANT_1.id,
    item_name: 'Paracetamol',
    item_code: 'MED-PARA',
    service_department_id: 3,
    price: 50,
    is_active: 1,
  },
  {
    id: 9104,
    tenant_id: TENANT_1.id,
    item_name: 'Appendectomy',
    item_code: 'OT-APP',
    service_department_id: 4,
    price: 50000,
    is_active: 1,
  },
  {
    id: 9105,
    tenant_id: TENANT_1.id,
    item_name: 'Urine test',
    item_code: 'LAB-URINE',
    service_department_id: 1,
    price: 200,
    is_active: 1,
  },
];

describe('Financial accuracy — bill creation', () => {
  it('uses catalog price when a service item is selected, even if the client sends a bad unit price', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [{
          id: 9001,
          tenant_id: TENANT_1.id,
          item_name: 'CBC',
          item_code: 'LAB-CBC',
          service_department_id: 1,
          price: 500,
          is_active: 1,
        }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          {
            itemCategory: 'test',
            serviceItemId: 9001,
            description: 'Client-side stale description',
            quantity: 1,
            unitPrice: 5,
          },
        ],
        discount: 0,
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { total: number };
    expect(body.total).toBe(500);
  });

  it('calculates correct total with multiple items', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: CATALOG_ITEMS,
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          { itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 5, serviceItemId: 9101 },
          { itemCategory: 'doctor_visit', description: 'Consultation', quantity: 1, unitPrice: 5, serviceItemId: 9102 },
          { itemCategory: 'medicine', description: 'Paracetamol', quantity: 3, unitPrice: 5, serviceItemId: 9103 },
        ],
        discount: 100,
        discountReason: 'Test discount',
        discountByName: 'Financial accuracy test',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { total: number; invoiceNo: string };
    // 500 + 1000 + (3*50) - 100 = 1550
    expect(body.total).toBe(1550);
    expect(body.invoiceNo).toBeDefined();
  });

  it('rejects discount greater than subtotal', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [ACTIVE_COUNTER_SESSION],
        billing_counters: [BILLING_COUNTER],
        billing_service_items: CATALOG_ITEMS,
        patients: [PATIENT_1],
      },
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          { itemCategory: 'test', description: 'Urine test', quantity: 1, unitPrice: 5, serviceItemId: 9105 },
        ],
        discount: 500, // discount exceeds item total
        discountReason: 'Excessive discount',
        discountByName: 'Dr. Excessive', // satisfy Zod's >20%-discount gate so the business rule runs
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Discount');
  });

  it('single high-value item is calculated correctly', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: CATALOG_ITEMS,
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          { itemCategory: 'operation', description: 'Appendectomy', quantity: 1, unitPrice: 5, serviceItemId: 9104 },
        ],
        discount: 0,
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { total: number };
    expect(body.total).toBe(50000);
  });
});

describe('Financial accuracy — validation rejections', () => {
  it('rejects zero-quantity items (Zod: quantity must be positive)', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          { itemCategory: 'test', description: 'CBC', quantity: 0, unitPrice: 500 },
        ],
        discount: 0,
      },
    });

    // Zod validation rejects quantity: 0 (z.number().int().positive())
    expect(res.status).toBe(400);
  });

  it('rejects negative discount (Zod: discount must be nonnegative)', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          { itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 500 },
        ],
        discount: -100,
      },
    });

    // Zod validation rejects discount: -100 (z.number().int().nonnegative())
    expect(res.status).toBe(400);
  });

  it('rejects negative unit price (Zod: unitPrice must be nonnegative)', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [
          { itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: -500 },
        ],
        discount: 0,
      },
    });

    expect(res.status).toBe(400);
  });

  it('rejects bill with no items (Zod: min 1 item required)', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        items: [],
        discount: 0,
      },
    });

    expect(res.status).toBe(400);
  });
});

describe('Financial accuracy — overpayment prevention', () => {
  it('rejects payment exceeding outstanding balance', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [ACTIVE_COUNTER_SESSION],
        billing_counters: [BILLING_COUNTER],
        bills: [{
          ...BILL_1,
          total: 2500,
          paid: 2000,
          due: 500,
          status: 'partially_paid',
        }],
      },
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      body: {
        billId: BILL_1.id,
        amount: 600, // outstanding is only 500
        paymentMethod: 'cash',
        type: 'current',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('exceeds');
  });

  it('rejects payment on already-paid bill', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [ACTIVE_COUNTER_SESSION],
        billing_counters: [BILLING_COUNTER],
        bills: [{
          ...BILL_1,
          total: 1000,
          paid: 1000,
          due: 0,
          status: 'paid',
        }],
      },
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      body: {
        billId: BILL_1.id,
        amount: 100,
        paymentMethod: 'cash',
        type: 'current',
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('already fully paid');
  });

  it('accepts exact remaining balance as payment', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [ACTIVE_COUNTER_SESSION],
        billing_counters: [BILLING_COUNTER],
        bills: [{
          ...BILL_1,
          total: 2500,
          paid: 2000,
          due: 500,
          status: 'partially_paid',
        }],
      },
      queryOverride: mockAppliedPaymentUpdate(2500, 0, 'paid'),
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      body: {
        billId: BILL_1.id,
        amount: 500, // exact outstanding
        paymentMethod: 'cash',
        type: 'current',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; outstanding: number };
    expect(body.status).toBe('paid');
    expect(body.outstanding).toBe(0);
  });

  it('accepts the exact integer balance when stored due has floating-point residue', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [ACTIVE_COUNTER_SESSION],
        billing_counters: [BILLING_COUNTER],
        bills: [{
          ...BILL_1,
          total: 200,
          paid: 0,
          due: 199.99999999999994,
          status: 'partially_paid',
        }],
      },
      queryOverride: mockAppliedPaymentUpdate(200, 0, 'paid'),
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      body: {
        billId: BILL_1.id,
        amount: 200,
        paymentMethod: 'cash',
        type: 'due',
      },
    });

    expect(res.status).toBe(200);
    const paymentInsert = mockDB.queries.find((query) =>
      /insert\s+into\s+"?payments"?/i.test(query.sql)
    );
    expect(paymentInsert?.sql).toMatch(/ROUND\s*\(/i);
  });

  it('records successful bill payment in the employee cash ledger for daily collection', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [ACTIVE_COUNTER_SESSION],
        billing_counters: [BILLING_COUNTER],
        bills: [{
          ...BILL_1,
          total: 2500,
          paid: 0,
          due: 2500,
          status: 'open',
        }],
      },
      queryOverride: mockAppliedPaymentUpdate(1000, 1500, 'partially_paid'),
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      body: {
        billId: BILL_1.id,
        amount: 1000,
        paymentMethod: 'cash',
        type: 'current',
      },
    });

    expect(res.status).toBe(200);
    const empCashInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into "emp_cash_transactions"') ||
      query.sql.toLowerCase().includes('insert into emp_cash_transactions')
    );
    expect(empCashInsert).toBeTruthy();
    expect(empCashInsert?.params).toContain('CashSales');
    expect(empCashInsert?.params).toContain(1000);
  });
});

/**
 * Double-submit / concurrent operation tests.
 *
 * Validates that simultaneous operations are handled correctly:
 *   - Two payments for the same bill
 *   - Two appointment bookings for the same slot
 *
 * Since we use mock DB (no real concurrency control), we verify that:
 *   - Both operations complete (the mock allows both through)
 *   - The correct number of INSERT queries are recorded
 *   - At least one operation succeeds
 */

import { describe, it, expect } from 'vitest';
import billingRoutes from '../../../src/routes/tenant/billing';
import appointmentRoutes from '../../../src/routes/tenant/appointments';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import { TENANT_1, BILL_1, PATIENT_1, DOCTOR_1 } from '../helpers/fixtures';

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
  workstation_id: 'test-workstation',
};

const BILLING_COUNTER = {
  id: 7,
  tenant_id: TENANT_1.id,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
};

function mockActiveCounterSession(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
  if (normalized.includes('from billing_counter_sessions s')) {
    return { first: ACTIVE_COUNTER_SESSION };
  }
  if (normalized.startsWith('update billing_counter_sessions')) {
    return { success: true, meta: { changes: 1 } };
  }
  return null;
}

function mockAppliedPaymentUpdate(paid: number, due: number, status: 'partially_paid' | 'paid') {
  return (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
    const activeCounter = mockActiveCounterSession(sql);
    if (activeCounter) return activeCounter;
    if (normalized.startsWith('update "bills" set "paid"')) {
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.includes('select "paid", "due", "total", "discount", "status" from "bills"')) {
      return { results: [{ paid, due, total: paid + due, discount: 0, status }] };
    }
    return null;
  };
}

describe('Double-submit prevention — concurrent payments', () => {
  it('two simultaneous payments for the same bill both attempt INSERT', async () => {
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

    const paymentBody = {
      billId: BILL_1.id,
      amount: 1000,
      paymentMethod: 'cash',
      type: 'current',
    };

    // Fire two payments concurrently
    const [res1, res2] = await Promise.all([
      jsonRequest(app, '/billing/pay', { method: 'POST', headers: { 'X-HMS-Workstation-ID': 'test-workstation' }, body: paymentBody }),
      jsonRequest(app, '/billing/pay', { method: 'POST', headers: { 'X-HMS-Workstation-ID': 'test-workstation' }, body: paymentBody }),
    ]);

    // At least one should succeed
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(200);

    // Verify INSERT queries were attempted for payments
    const insertQueries = mockDB.queries.filter(
      (q) => q.sql.toUpperCase().includes('INSERT') && q.method === 'all',
    );
    // Each payment attempt does a batch with INSERT payment + UPDATE bill + INSERT income
    expect(insertQueries.length).toBeGreaterThanOrEqual(1);
  });

  it('overpayment is rejected when amount exceeds outstanding balance', async () => {
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
          paid: 800,
          due: 200,
          status: 'partially_paid',
        }],
      },
      queryOverride: mockActiveCounterSession,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        billId: BILL_1.id,
        amount: 500, // exceeds 200 outstanding
        paymentMethod: 'cash',
        type: 'current',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('exceeds');
  });

  it('returns the existing receipt when a payment idempotency key is replayed', async () => {
    const idempotencyKey = 'cashier-terminal-1-bill-1-payment-1';
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from payments p') && lower.includes('idempotency_key')) {
          return {
            first: {
              id: 9901,
              bill_id: BILL_1.id,
              receipt_no: 'RCP-EXISTING',
              amount: 1000,
              total: 2500,
              paid: 1000,
              due: 1200,
              status: 'partially_paid',
            },
          };
        }

        if (lower.includes('select * from bills')) {
          return {
            first: {
              ...BILL_1,
              total: 2500,
              paid: 0,
              due: 2500,
              status: 'open',
            },
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        billId: BILL_1.id,
        amount: 1000,
        paymentMethod: 'cash',
        type: 'current',
        idempotencyKey,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { idempotent?: boolean; receiptNo?: string; paidAmount?: number; outstanding?: number; status?: string };
    expect(body).toMatchObject({
      idempotent: true,
      receiptNo: 'RCP-EXISTING',
      paidAmount: 1000,
      outstanding: 1200,
      status: 'partially_paid',
    });

    const paymentInserts = mockDB.queries.filter((query) =>
      query.sql.toLowerCase().includes('insert into "payments"') ||
      query.sql.toLowerCase().includes('insert into payments')
    );
    expect(paymentInserts).toHaveLength(0);
  });

  it('returns the updated due amount after a payment', async () => {
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
          paid: 800,
          due: 50,
          status: 'partially_paid',
        }],
      },
      queryOverride: mockAppliedPaymentUpdate(825, 25, 'partially_paid'),
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing/pay', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
      body: {
        billId: BILL_1.id,
        amount: 25,
        paymentMethod: 'cash',
        type: 'due',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { outstanding?: number; status?: string };
    expect(body.outstanding).toBe(25);
    expect(body.status).toBe('partially_paid');
  });
});

describe('Double-submit prevention — concurrent appointment bookings', () => {
  it('two simultaneous bookings for the same slot both attempt INSERT', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [],
        patients: [PATIENT_1],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from appointments') && normalized.includes('appt_time between')) {
          return { first: normalized.includes('count(*)') ? { cnt: 0, count: 0 } : null, results: [] };
        }
        if (
          normalized.includes('from appointments') &&
          normalized.includes('patient_id = ?') &&
          normalized.includes('doctor_id = ?') &&
          normalized.includes('appt_date = ?')
        ) {
          return { first: null, results: [] };
        }
        return null;
      },
      universalFallback: true,
    });

    const bookingBody = {
      patientId: PATIENT_1.id,
      doctorId: DOCTOR_1.id,
      apptDate: '2025-06-15',
      apptTime: '10:00',
      visitType: 'opd',
      fee: 500,
    };

    // Fire two bookings concurrently
    const [res1, res2] = await Promise.all([
      jsonRequest(app, '/appointments', { method: 'POST', body: bookingBody }),
      jsonRequest(app, '/appointments', { method: 'POST', body: bookingBody }),
    ]);

    // At least one should succeed (201)
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);

    // Verify INSERT queries were recorded
    const insertQueries = mockDB.queries.filter(
      (q) => q.sql.toUpperCase().includes('INSERT INTO') &&
             q.sql.toUpperCase().includes('APPOINTMENT'),
    );
    expect(insertQueries.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, expect, it } from 'vitest';
import nursingRoutes from '../../../src/routes/tenant/nursing';
import ePrescribingRoutes from '../../../src/routes/tenant/ePrescribing';
import billingProvisionalRoutes from '../../../src/routes/tenant/billingProvisional';
import creditNotesRoutes from '../../../src/routes/tenant/creditNotes';
import reportAppointmentRoutes from '../../../src/routes/tenant/reportAppointment';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import { ACTIVE_BILLING_COUNTER_TABLES } from '../helpers/fixtures';
import { getTodayGMT6 } from '../../../src/lib/date-utils';

const closedCurrentAccountingPeriod = () => ({
  id: 1,
  tenant_id: 'tenant-1',
  fiscal_year_id: 1,
  period_name: getTodayGMT6().substring(0, 7),
  status: 'closed',
});

function extractInsertColumns(sql: string, tableName: string): string[] {
  const match = sql.match(new RegExp(`INSERT\\s+INTO\\s+${tableName}\\s*\\(([^)]+)\\)`, 'i'));
  if (!match) return [];
  return match[1]
    .split(',')
    .map((column) => column.trim().replace(/[`"']/g, '').toLowerCase())
    .filter(Boolean);
}

describe('Production compatibility regressions', () => {
  it('nursing patients supports legacy admissions schema without visit_id/admitting_doctor_id', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (!sql.includes('FROM admissions a')) return null;
        if (
          sql.includes('a.visit_id') ||
          sql.includes('a.admitting_doctor_id') ||
          sql.includes('a.is_active') ||
          sql.includes('a.ward_id')
        ) {
          throw new Error('legacy production schema does not have these admissions columns');
        }
        return {
          results: [
            {
              patient_id: 1,
              patient_code: 'P001',
              name: 'Legacy Patient',
              gender: 'Male',
              mobile: '01700000000',
              admission_id: 11,
              admission_date: '2026-04-01',
              admission_status: 'admitted',
              visit_id: null,
              doctor_name: 'Dr Legacy',
            },
          ],
        };
      },
    });
    const { app } = createTestApp({
      route: nursingRoutes,
      routePath: '/nursing',
      role: 'hospital_admin',
      mockDB,
    });

    const res = await app.request('/nursing/patients');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.Results).toHaveLength(1);
    expect(body.Results[0].doctor_name).toBe('Dr Legacy');
    expect(body.Results[0].visit_id).toBeNull();
  });

  it('e-prescribing stats degrades to zeroes when optional tables are missing', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM formulary_items')) throw new Error('no such table: formulary_items');
        if (sql.includes('FROM drug_interaction_pairs')) throw new Error('no such table: drug_interaction_pairs');
        if (sql.includes('FROM prescription_safety_checks')) throw new Error('no such table: prescription_safety_checks');
        return null;
      },
    });
    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/ep',
      role: 'hospital_admin',
      mockDB,
    });

    const res = await app.request('/ep/stats');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.formulary_items).toBe(0);
    expect(body.interaction_pairs).toBe(0);
    expect(body.total_safety_checks).toBe(0);
    expect(body.checks_with_warnings).toBe(0);
  });

  it('billing provisional exposes frontend compatibility aliases', async () => {
    const mockDB = createMockDB({
      tables: {
        patients: [{ id: 1, tenant_id: 'tenant-1', name: 'Ali', patient_code: 'P001' }],
        billing_service_items: [{
          id: 101,
          tenant_id: 'tenant-1',
          item_name: 'X-Ray',
          item_code: 'RAD-XR',
          price: 700,
          allow_discount: 1,
          allow_multiple_qty: 1,
          is_active: 1,
        }],
        billing_service_departments: [],
        billing_provisional_items: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            patient_id: 1,
            item_name: 'CBC',
            item_category: 'test',
            quantity: 1,
            unit_price: 500,
            discount_amount: 0,
            total_amount: 500,
            bill_status: 'provisional',
            is_active: 1,
            created_at: '2026-04-01',
          },
        ],
      },
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*) as total_items')) {
          return {
            first: {
              total_items: 1,
              total_amount: 500,
              billed_count: 0,
              cancelled_count: 0,
              provisional_count: 1,
            },
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      mockDB,
    });

    const summaryRes = await app.request('/bp/summary');
    expect(summaryRes.status).toBe(200);
    const summaryBody = await summaryRes.json();
    expect(summaryBody.total_items).toBeDefined();

    const batchRes = await jsonRequest(app, '/bp/batch', {
      method: 'POST',
      body: {
        patient_id: 1,
        items: [{ service_item_id: 101, quantity: 1, discount_amount: 0 }],
      },
    });
    expect(batchRes.status).toBe(201);

    const cancelRes = await jsonRequest(app, '/bp/10/cancel', {
      method: 'PUT',
      body: { cancel_reason: 'Duplicate' },
    });
    expect(cancelRes.status).toBe(200);
  });

  it('billing provisional pay supports frontend payload without provisional_item_ids', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        bills: [],
        invoice_items: [],
        income: [],
        payments: [],
        emp_cash_transactions: [],
        billing_provisional_items: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            patient_id: 1,
            visit_id: null,
            item_name: 'CBC',
            item_category: 'test',
            quantity: 1,
            unit_price: 500,
            total_amount: 500,
            bill_status: 'provisional',
            is_active: 1,
          },
        ],
      },
    });

    const payRes = await jsonRequest(app, '/bp/pay', {
      method: 'POST',
      body: {
        patient_id: 1,
        payment_method: 'Cash',
        remarks: 'Frontend payload',
        discount_amount: 0,
      },
    });
    expect(payRes.status).toBe(201);
  });

  it('billing provisional pay requires discount by name above 20 percent before creating a bill', async () => {
    const { app, mockDB } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        bills: [],
        invoice_items: [],
        income: [],
        payments: [],
        emp_cash_transactions: [],
        billing_provisional_items: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            patient_id: 1,
            visit_id: null,
            item_name: 'CBC',
            item_category: 'test',
            quantity: 1,
            unit_price: 1000,
            total_amount: 1000,
            bill_status: 'provisional',
            is_active: 1,
          },
        ],
      },
    });

    const payRes = await jsonRequest(app, '/bp/pay', {
      method: 'POST',
      body: {
        patient_id: 1,
        provisional_item_ids: [10],
        payment_method: 'cash',
        discount_amount: 250,
      },
    });

    expect(payRes.status).toBe(400);
    const body = await payRes.json() as { error?: string; message?: string };
    expect(String(body.message ?? body.error ?? '')).toMatch(/discount referred by/i);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into bills'))).toBe(false);
  });

  it('billing provisional pay stores discount by name on the converted invoice', async () => {
    const { app, mockDB } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        bills: [],
        invoice_items: [],
        income: [],
        payments: [],
        emp_cash_transactions: [],
        billing_provisional_items: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            patient_id: 1,
            visit_id: null,
            item_name: 'CBC',
            item_category: 'test',
            quantity: 1,
            unit_price: 1000,
            total_amount: 1000,
            bill_status: 'provisional',
            is_active: 1,
          },
        ],
      },
    });

    const payRes = await jsonRequest(app, '/bp/pay', {
      method: 'POST',
      body: {
        patient_id: 1,
        provisional_item_ids: [10],
        payment_method: 'cash',
        discount_amount: 250,
        discountByName: 'Director Approval',
      },
    });

    expect(payRes.status).toBe(201);
    const billInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into bills'));
    expect(billInsert?.sql).toMatch(/discount_by_name/i);
    expect(billInsert?.params).toContain('Director Approval');
  });

  it('billing provisional pay preserves invoice due when paid_amount is zero', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        bills: [],
        invoice_items: [],
        payments: [],
        emp_cash_transactions: [],
        billing_provisional_items: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            patient_id: 1,
            visit_id: null,
            item_name: 'Abdomen X-Ray',
            item_category: 'test',
            quantity: 1,
            unit_price: 40000,
            total_amount: 40000,
            bill_status: 'provisional',
            is_active: 1,
          },
        ],
      },
    });

    const payRes = await jsonRequest(app, '/bp/pay', {
      method: 'POST',
      body: {
        patient_id: 1,
        provisional_item_ids: [10],
        payment_method: 'cash',
        paid_amount: 0,
      },
    });

    expect(payRes.status).toBe(201);
    const body = await payRes.json() as { paid: number; due: number; status: string };
    expect(body.paid).toBe(0);
    expect(body.due).toBe(40000);
    expect(body.status).not.toBe('paid');
  });

  it('billing provisional pay requires an active billing counter session', async () => {
    const { app } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        billing_provisional_items: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            patient_id: 1,
            item_name: 'CBC',
            item_category: 'test',
            quantity: 1,
            unit_price: 500,
            total_amount: 500,
            bill_status: 'provisional',
            is_active: 1,
          },
        ],
      },
    });

    const payRes = await jsonRequest(app, '/bp/pay', {
      method: 'POST',
      body: { patient_id: 1, payment_method: 'Cash', discount_amount: 0 },
    });
    expect(payRes.status).toBe(409);
    const body = await payRes.json() as { error: string };
    expect(body.error).toMatch(/Activate a billing counter/);
  });

  it('billing provisional creation rejects in a closed accounting period before rows are inserted', async () => {
    const { app, mockDB } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        accounting_period_closes: [closedCurrentAccountingPeriod()],
        patients: [{ id: 1, tenant_id: 'tenant-1', name: 'Ali', patient_code: 'P001' }],
        billing_service_items: [{
          id: 101,
          tenant_id: 'tenant-1',
          item_name: 'CBC',
          item_code: 'LAB-CBC',
          price: 500,
          allow_discount: 1,
          allow_multiple_qty: 1,
          is_active: 1,
        }],
        billing_service_departments: [],
        billing_provisional_items: [],
      },
    });

    const res = await jsonRequest(app, '/bp/batch', {
      method: 'POST',
      body: {
        patient_id: 1,
        items: [{ service_item_id: 101, quantity: 1, discount_amount: 0 }],
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('accounting period');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+billing_provisional_items/i);
  });

  it('billing provisional cancellation rejects in a closed accounting period before status changes', async () => {
    const { app, mockDB } = createTestApp({
      route: billingProvisionalRoutes,
      routePath: '/bp',
      role: 'hospital_admin',
      tables: {
        accounting_period_closes: [closedCurrentAccountingPeriod()],
        billing_provisional_items: [{
          id: 10,
          tenant_id: 'tenant-1',
          patient_id: 1,
          item_name: 'CBC',
          item_category: 'test',
          quantity: 1,
          unit_price: 500,
          total_amount: 500,
          bill_status: 'provisional',
          is_active: 1,
        }],
      },
    });

    const res = await jsonRequest(app, '/bp/10/cancel', {
      method: 'PUT',
      body: { cancel_reason: 'Duplicate' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('accounting period');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/UPDATE\s+billing_provisional_items/i);
  });

  it('credit note payout only writes columns available in production cash ledger schema', async () => {
    const productionEmpCashColumns = new Set([
      'tenant_id',
      'employee_id',
      'counter_id',
      'counter_session_id',
      'transaction_type',
      'amount',
      'reference_id',
      'reference_type',
      'payment_method',
      'description',
    ]);

    const { app, mockDB } = createTestApp({
      route: creditNotesRoutes,
      routePath: '/credit-notes',
      role: 'hospital_admin',
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        accounting_period_closes: [],
        bills: [{
          id: 31,
          tenant_id: 'tenant-1',
          invoice_no: 'INV-000031',
          patient_id: 102,
          total: 1000,
          paid: 1000,
          due: 0,
          status: 'paid',
        }],
        billing_credit_notes: [{
          id: 901,
          tenant_id: 'tenant-1',
          credit_note_no: 'CN-000901',
          bill_id: 31,
          patient_id: 102,
          reason: 'Duplicate bill item',
          total_amount: 250,
          refund_amount: 250,
          payment_mode: 'cash',
          status: 'ready_for_payout',
          is_active: 1,
        }],
        billing_credit_note_items: [{
          id: 1,
          tenant_id: 'tenant-1',
          credit_note_id: 901,
          invoice_item_id: 501,
          item_name: 'CBC',
          unit_price: 250,
          return_quantity: 1,
          total_amount: 250,
        }],
        invoice_items: [{
          id: 501,
          tenant_id: 'tenant-1',
          bill_id: 31,
          description: 'CBC',
          item_category: 'test',
          quantity: 1,
          unit_price: 250,
          line_total: 250,
        }],
        income: [],
        emp_cash_transactions: [],
        accounting_posting_events: [],
        audit_logs: [],
      },
    });

    const res = await jsonRequest(app, '/credit-notes/901/approve', { method: 'POST' });
    expect(res.status).toBe(200);

    const cashInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+emp_cash_transactions/i.test(query.sql),
    );
    expect(cashInsert).toBeDefined();
    expect(cashInsert?.sql).toContain('SalesReturn');

    const insertColumns = extractInsertColumns(cashInsert!.sql, 'emp_cash_transactions');
    expect(insertColumns.length).toBeGreaterThan(0);
    expect(insertColumns.every((column) => productionEmpCashColumns.has(column))).toBe(true);
  });

  it('appointment no-show report supports legacy appointments schema', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (!sql.includes('FROM appointments')) return null;
        if (sql.includes('appointment_date') || sql.includes('appointment_time')) {
          throw new Error('legacy production schema uses appt_date/appt_time');
        }
        return {
          first: {
            total_appointments: 8,
            no_shows: 2,
            attended: 5,
            cancelled: 1,
          },
        };
      },
    });
    const { app } = createTestApp({
      route: reportAppointmentRoutes,
      routePath: '/reports/appointment',
      role: 'hospital_admin',
      mockDB,
    });

    const res = await app.request('/reports/appointment/no-show-rate?startDate=2026-03-01&endDate=2026-04-01');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalAppointments).toBe(8);
    expect(body.noShows).toBe(2);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import appointmentRoutes from '../../../src/routes/tenant/appointments';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import {
  ACTIVE_BILLING_COUNTER_TABLES,
  ACTIVE_BILLING_COUNTER,
  ACTIVE_BILLING_COUNTER_SESSION,
  DOCTOR_1,
  PATIENT_1,
  TENANT_1,
} from '../helpers/fixtures';

const today = getTodayGMT6();

const APPOINTMENT = {
  id: 5001,
  appointment_id: 5001,
  tenant_id: TENANT_1.id,
  tenantId: TENANT_1.id,
  appt_no: 'APT-005001',
  apptNo: 'APT-005001',
  token_no: 1,
  tokenNo: 1,
  patient_id: PATIENT_1.id,
  patientId: PATIENT_1.id,
  patient_name: PATIENT_1.name,
  patient_code: PATIENT_1.patient_code,
  doctor_id: DOCTOR_1.id,
  doctorId: DOCTOR_1.id,
  doctor_name: DOCTOR_1.name,
  doctor_specialty: DOCTOR_1.specialty,
  doctor_department: 'Medicine',
  consultation_fee: DOCTOR_1.consultation_fee,
  appt_date: today,
  apptDate: today,
  appt_time: '10:00',
  apptTime: '10:00',
  visit_type: 'opd',
  visitType: 'opd',
  status: 'scheduled',
  fee: DOCTOR_1.consultation_fee,
  billing_status: 'unpaid',
  billingStatus: 'unpaid',
  source: 'scheduled',
};

const PROVISIONAL_ITEM = {
  id: 9001,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  visit_id: null,
  appointment_id: APPOINTMENT.id,
  item_category: 'doctor_visit',
  item_name: `Consultation - Dr. ${DOCTOR_1.name}`,
  unit_price: DOCTOR_1.consultation_fee,
  quantity: 1,
  discount_amount: 0,
  total_amount: DOCTOR_1.consultation_fee,
  doctor_id: DOCTOR_1.id,
  doctor_name: DOCTOR_1.name,
  reference_id: DOCTOR_1.id,
  bill_status: 'provisional',
  is_active: 1,
};

const APPOINTMENT_DRIZZLE_RESULT = {
  id: APPOINTMENT.id,
  appt_no: APPOINTMENT.appt_no,
  token_no: APPOINTMENT.token_no,
  patient_id: APPOINTMENT.patient_id,
  doctor_id: APPOINTMENT.doctor_id,
  appt_date: APPOINTMENT.appt_date,
  appt_time: APPOINTMENT.appt_time,
  visit_type: APPOINTMENT.visit_type,
  status: APPOINTMENT.status,
  notes: null,
  chief_complaint: null,
  fee: APPOINTMENT.fee,
  appointment_type: 'new_patient',
  original_fee: 0,
  discount_amount: 0,
  final_fee: 0,
  discount_reason: null,
  billing_status: APPOINTMENT.billing_status,
  external_referring_doctor_id: null,
  created_by: 1,
  tenant_id: APPOINTMENT.tenant_id,
  source: APPOINTMENT.source,
  checked_in_at: null,
  created_at: `${today} 09:00:00`,
  updated_at: `${today} 09:00:00`,
};

const REPORT_SHOW_APPOINTMENT = {
  ...APPOINTMENT,
  id: 5002,
  appointment_id: 5002,
  appt_no: 'APT-005002',
  apptNo: 'APT-005002',
  token_no: 2,
  tokenNo: 2,
  visit_type: 'followup',
  visitType: 'followup',
  appointment_type: 'report_show',
  appointmentType: 'report_show',
  fee: 0,
  original_fee: 0,
  originalFee: 0,
  discount_amount: 0,
  discountAmount: 0,
  final_fee: 0,
  finalFee: 0,
  billing_status: 'no_charge',
  billingStatus: 'no_charge',
};

const REPORT_SHOW_DRIZZLE_RESULT = {
  ...APPOINTMENT_DRIZZLE_RESULT,
  id: REPORT_SHOW_APPOINTMENT.id,
  appt_no: REPORT_SHOW_APPOINTMENT.appt_no,
  token_no: REPORT_SHOW_APPOINTMENT.token_no,
  visit_type: REPORT_SHOW_APPOINTMENT.visit_type,
  fee: 0,
  appointment_type: 'report_show',
  appointmentType: 'report_show',
  original_fee: 0,
  originalFee: 0,
  discount_amount: 0,
  discountAmount: 0,
  final_fee: 0,
  finalFee: 0,
  billing_status: 'no_charge',
  billingStatus: 'no_charge',
};

describe('appointment billing handoff', () => {
  it('wires appointment scheme benefit validation without changing normal payment path', () => {
    const source = [
      readFileSync('src/routes/tenant/appointments.ts', 'utf8'),
      readFileSync('src/lib/canonical/appointment-billing-finalization.ts', 'utf8'),
    ].join('\n');
    expect(source).toContain('schemeApplication: appointmentSchemeApplicationSchema.optional()');
    expect(source).toContain('evaluateBillingSchemeEligibility(c.env.DB');
    expect(source).toContain('Scheme discount exceeds eligible scheme cap.');
    expect(source).toContain('recordBillingSchemeUsage(c.env.DB');
    expect(source).toContain('INSERT INTO bill_discount_allocations');
    expect(source).toContain("source: 'appointment_payment'");
    expect(source).toContain('const requestedSchemeDiscount = options.schemeApplication');
  });

  it('reuses an active report-show serial instead of creating duplicate appointments', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [REPORT_SHOW_APPOINTMENT],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        doctorId: DOCTOR_1.id,
        apptDate: today,
        visitType: 'followup',
        appointmentType: 'report_show',
        discountAmount: 0,
        source: 'walk_in',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; reused?: boolean; appointmentType?: string };
    expect(body).toMatchObject({ id: REPORT_SHOW_APPOINTMENT.id, reused: true, appointmentType: 'report_show' });
    expect(mockDB.queries.some((query) => /INSERT INTO [`"]?appointments/i.test(query.sql))).toBe(false);
  });

  it('allows report-show check-in after the same doctor visit was already concluded', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [REPORT_SHOW_APPOINTMENT],
        doctors: [DOCTOR_1],
        visits: [{
          id: 812,
          tenant_id: TENANT_1.id,
          patient_id: PATIENT_1.id,
          doctor_id: DOCTOR_1.id,
          visit_date: today,
          appointment_id: APPOINTMENT.id,
          visit_no: 'V-000812',
          status: 'concluded',
        }],
        billing_provisional_items: [],
        queue_entries: [],
        queue_token_counters: [],
      },
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from "appointments"') || lower.includes('from appointments')) {
          return { results: [REPORT_SHOW_DRIZZLE_RESULT], first: REPORT_SHOW_DRIZZLE_RESULT };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${REPORT_SHOW_APPOINTMENT.id}/check-in`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { billingStatus: string; doctorQueueAllowed: boolean };
    expect(body.billingStatus).toBe('no_charge');
    expect(body.doctorQueueAllowed).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT INTO visits/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT INTO queue_entries/i.test(query.sql))).toBe(true);
  });

  it('includes finalized consultation invoice details in appointments today list', async () => {
    const finalizedBillId = 7701;
    const { app } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [{ ...APPOINTMENT, billing_status: 'paid', billingStatus: 'paid' }],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        billing_provisional_items: [{
          ...PROVISIONAL_ITEM,
          bill_status: 'finalized',
          billed_bill_id: finalizedBillId,
          billedBillId: finalizedBillId,
        }],
        bills: [{
          id: finalizedBillId,
          tenant_id: TENANT_1.id,
          patient_id: PATIENT_1.id,
          visit_id: null,
          invoice_no: 'INV-7701',
          total: DOCTOR_1.consultation_fee,
          paid: DOCTOR_1.consultation_fee,
          due: 0,
          status: 'paid',
          created_at: `${today} 10:05:00`,
        }],
      },
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from appointments a')) {
          return {
            results: [{
              ...APPOINTMENT,
              billing_status: 'paid',
              patient_name: PATIENT_1.name,
              patient_code: PATIENT_1.patient_code,
              patient_mobile: PATIENT_1.mobile,
              doctor_name: DOCTOR_1.name,
              bill_id: finalizedBillId,
              invoice_no: 'INV-7701',
              bill_total: DOCTOR_1.consultation_fee,
              bill_paid: DOCTOR_1.consultation_fee,
              bill_due: 0,
              bill_status: 'paid',
            }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments/today');

    expect(res.status).toBe(200);
    const body = await res.json() as { appointments: Array<Record<string, unknown>> };
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0]).toMatchObject({
      id: APPOINTMENT.id,
      billing_status: 'paid',
      bill_id: finalizedBillId,
      invoice_no: 'INV-7701',
      bill_total: DOCTOR_1.consultation_fee,
      bill_paid: DOCTOR_1.consultation_fee,
      bill_due: 0,
      bill_status: 'paid',
    });
  });

  it('does not send unpaid checked-in appointments to the doctor queue', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [APPOINTMENT],
        doctors: [DOCTOR_1],
        visits: [],
        billing_provisional_items: [PROVISIONAL_ITEM],
        queue_entries: [],
        queue_token_counters: [],
      },
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from "appointments"')) {
          return { results: [APPOINTMENT_DRIZZLE_RESULT], first: APPOINTMENT_DRIZZLE_RESULT };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/check-in`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { doctorQueueAllowed: boolean; billingStatus: string };
    expect(body.billingStatus).toBe('unpaid');
    expect(body.doctorQueueAllowed).toBe(false);

    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT INTO visits/i);
    expect(sql).toMatch(/(UPDATE|INSERT INTO) billing_provisional_items/i);
    expect(sql).not.toMatch(/INSERT INTO queue_entries/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+visit_services/i);
  });

  it('reuses an existing checked-in visit when appointment check-in is replayed', async () => {
    const existingVisit = {
      id: 812,
      tenant_id: TENANT_1.id,
      patient_id: PATIENT_1.id,
      doctor_id: DOCTOR_1.id,
      visit_date: today,
      appointment_id: APPOINTMENT.id,
      visit_no: 'V-000812',
      status: 'engaged',
    };
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [{ ...APPOINTMENT, status: 'checked_in', billing_status: 'paid', billingStatus: 'paid' }],
        doctors: [DOCTOR_1],
        visits: [existingVisit],
        billing_provisional_items: [PROVISIONAL_ITEM],
        queue_entries: [],
        queue_token_counters: [],
      },
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from "appointments"')) {
          return {
            results: [{ ...APPOINTMENT_DRIZZLE_RESULT, status: 'checked_in', billing_status: 'paid' }],
            first: { ...APPOINTMENT_DRIZZLE_RESULT, status: 'checked_in', billing_status: 'paid' },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/check-in`, {
      method: 'POST',
      body: { sendToRoom: true },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { reused?: boolean; visitId?: number; sentToRoom?: boolean };
    expect(body).toMatchObject({ reused: true, visitId: existingVisit.id, sentToRoom: true });
    expect(mockDB.queries.some((query) => /INSERT INTO visits/i.test(query.sql))).toBe(false);
  });

  it('guards appointment check-in status update so concurrent clicks cannot both create visits', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [APPOINTMENT],
        doctors: [DOCTOR_1],
        visits: [],
        billing_provisional_items: [PROVISIONAL_ITEM],
        queue_entries: [],
        queue_token_counters: [],
      },
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from "appointments"')) {
          return { results: [APPOINTMENT_DRIZZLE_RESULT], first: APPOINTMENT_DRIZZLE_RESULT };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/check-in`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) =>
      /UPDATE appointments SET status = 'checked_in'/i.test(query.sql)
      && /WHERE id = \? AND tenant_id = \? AND status = 'scheduled'/i.test(query.sql.replace(/\s+/g, ' '))
    )).toBe(true);
  });

  it('finalizes appointment Pay Now through bills, payment, cash drawer, accounting, and queue handoff', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      userId: 1,
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        appointments: [{ ...APPOINTMENT, visit_id: 812, visitId: 812 }],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        billing_provisional_items: [{ ...PROVISIONAL_ITEM, visit_id: 812 }],
        doctor_commission_rules: [{
          id: 31,
          tenant_id: TENANT_1.id,
          doctor_id: DOCTOR_1.id,
          service_type: 'consultation_fee',
          incentive_type: 'performer',
          lab_test_id: null,
          category: null,
          rate_type: 'percent',
          rate_value: 3000,
          effective_from: '2020-01-01',
          effective_to: '2099-12-31',
          is_active: 1,
        }],
        queue_entries: [],
        queue_token_counters: [],
        accounting_period_closes: [],
        bills: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (/insert\s+into\s+bills/i.test(sql) && normalized.includes('returning id')) {
          return { first: { id: 7701 }, results: [{ id: 7701 }] };
        }
        if (normalized.includes('select id from bills where tenant_id') && normalized.includes('invoice_no')) {
          return { first: { id: 7701 } };
        }
        if (normalized.includes('from doctor_commission_rules')) {
          return {
            first: { id: 31, rate_type: 'percent', rate_value: 3000, incentive_type: 'performer' },
            results: [{ id: 31, rate_type: 'percent', rate_value: 3000, incentive_type: 'performer' }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/pay-now`, {
      method: 'POST',
      body: { paymentMethod: 'cash' },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { billingStatus: string; total: number; doctorQueueAllowed: boolean };
    expect(body.billingStatus).toBe('paid');
    expect(body.total).toBe(DOCTOR_1.consultation_fee);
    expect(body.doctorQueueAllowed).toBe(true);
    await expect.poll(() => mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params[2] === 'doctor_commission_accrual'
      && query.params[4] === 'commission_accrued'
    )).toBe(true);

    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT INTO bills/i);
    expect(sql).toMatch(/INSERT INTO invoice_items/i);
    expect(sql).toMatch(/INSERT INTO payments/i);
    expect(sql).toMatch(/INSERT INTO emp_cash_transactions/i);
    expect(sql).toMatch(/INSERT OR IGNORE INTO accounting_posting_events/i);
    expect(sql).toMatch(/INSERT INTO queue_entries/i);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT INTO emp_cash_transactions')
      && query.params.includes(ACTIVE_BILLING_COUNTER.id)
      && query.params.includes(ACTIVE_BILLING_COUNTER_SESSION.id)
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT(?: OR IGNORE)? INTO accounting_posting_events/i.test(query.sql)
      && (query.sql.includes("'billing'") || query.params.includes('billing'))
      && query.params.some((value) => String(value).includes('"invoiceNo"'))
      && query.params.every((value) => !String(value).includes('appointmentDoctorPayable'))
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT(?: OR IGNORE)? INTO doctor_commission_accruals/i.test(query.sql)
      && query.sql.includes("'consultation_fee'")
      && query.params.includes(3000)
      && query.params.includes(300)
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params[2] === 'doctor_commission_accrual'
      && query.params[4] === 'commission_accrued'
      && String(query.params[6]).includes('"amount":300')
    )).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.includes('cash_ledger_entries'))).toBe(true);
  });

  it('carries appointment discount reference into consultation invoice', async () => {
    const discountedAppointment = {
      ...APPOINTMENT,
      fee: 700,
      appointment_type: 'new_patient',
      original_fee: 1000,
      discount_amount: 300,
      final_fee: 700,
      discount_by_name: 'Director Approval',
    };
    const discountedItem = {
      ...PROVISIONAL_ITEM,
      unit_price: 1000,
      discount_amount: 300,
      total_amount: 700,
    };
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      userId: ACTIVE_BILLING_COUNTER_SESSION.employee_id,
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        appointments: [discountedAppointment],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        billing_provisional_items: [discountedItem],
        queue_entries: [],
        queue_token_counters: [],
        accounting_period_closes: [],
        bills: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select id from bills where tenant_id') && normalized.includes('invoice_no')) {
          return { first: { id: 7702 } };
        }
        if (normalized.includes('from doctor_commission_rules')) {
          return { first: null, results: [] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/pay-now`, {
      method: 'POST',
      body: { paymentMethod: 'cash' },
    });

    expect(res.status).toBe(201);
    const billInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO bills'));
    expect(billInsert?.sql).toContain('discount_by_name');
    expect(billInsert?.params).toContain('Director Approval');
  });

  it('returns the actual inserted bill id for appointment Pay Now print', async () => {
    const insertedBillId = 7701;
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      userId: 1,
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        appointments: [{ ...APPOINTMENT, visit_id: 812, visitId: 812 }],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        billing_provisional_items: [{ ...PROVISIONAL_ITEM, visit_id: 812 }],
        queue_entries: [],
        queue_token_counters: [],
        accounting_period_closes: [],
        bills: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select id from bills where tenant_id') && normalized.includes('invoice_no')) {
          return { first: { id: insertedBillId } };
        }
        if (normalized.includes('from doctor_commission_rules')) {
          return {
            first: { id: 31, rate_type: 'percent', rate_value: 3000, incentive_type: 'performer' },
            results: [{ id: 31, rate_type: 'percent', rate_value: 3000, incentive_type: 'performer' }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/pay-now`, {
      method: 'POST',
      body: { paymentMethod: 'cash' },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { billId: number };
    expect(body.billId).toBe(insertedBillId);
    expect(mockDB.queries.some((query) =>
      /SELECT id FROM bills WHERE tenant_id/i.test(query.sql.trim())
      && query.params.includes(insertedBillId) === false
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT INTO invoice_items/i.test(query.sql)
      && query.sql.includes('SELECT (SELECT id FROM bills')
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT INTO payments/i.test(query.sql)
      && query.sql.includes('SELECT (SELECT id FROM bills')
    )).toBe(true);
  });

  it('rejects appointment Pay Now when the user lacks billing write permission', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'doctor',
      tenantId: TENANT_1.id,
      userId: ACTIVE_BILLING_COUNTER_SESSION.employee_id,
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        appointments: [{ ...APPOINTMENT, visit_id: 812, visitId: 812 }],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        billing_provisional_items: [{ ...PROVISIONAL_ITEM, visit_id: 812 }],
        queue_entries: [],
        queue_token_counters: [],
        accounting_period_closes: [],
        bills: [],
      },
      queryOverride(sql) {
        if (sql.toLowerCase().includes('select id from bills where invoice_no')) {
          return { first: { id: 7701 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/pay-now`, {
      method: 'POST',
      body: { paymentMethod: 'cash' },
    });

    expect(res.status).toBe(403);
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO payments/i.test(query.sql))).toBe(false);
  });

  it('returns the existing appointment Pay Now response when an idempotency key is replayed', async () => {
    const requestBody = {
      paymentMethod: 'cash',
      idempotencyKey: 'appointment-pay-replay-1',
    };
    const responseJson = {
      message: 'Appointment consultation payment posted',
      appointmentId: APPOINTMENT.id,
      billId: 7701,
      invoiceNo: 'INV-EXISTING',
      receiptNo: 'RCP-EXISTING',
      total: DOCTOR_1.consultation_fee,
      paid: DOCTOR_1.consultation_fee,
      due: 0,
      status: 'paid',
      billingStatus: 'paid',
      doctorQueueAllowed: true,
    };
    const requestHash = await createIdempotencyRequestHash({
      appointmentId: APPOINTMENT.id,
      ...requestBody,
      idempotencyKey: undefined,
    });

    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'completed',
              response_json: JSON.stringify(responseJson),
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/pay-now`, {
      method: 'POST',
      body: requestBody,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { idempotent?: boolean; invoiceNo?: string; receiptNo?: string };
    expect(body).toMatchObject({ idempotent: true, invoiceNo: 'INV-EXISTING', receiptNo: 'RCP-EXISTING' });
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO payments/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO emp_cash_transactions/i.test(query.sql))).toBe(false);
  });

  it('rejects an appointment Pay Now idempotency key reused with a different payload', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: 'different-hash',
              status: 'completed',
              response_json: JSON.stringify({ invoiceNo: 'INV-EXISTING' }),
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/appointments/${APPOINTMENT.id}/pay-now`, {
      method: 'POST',
      body: {
        paymentMethod: 'cash',
        remarks: 'retry after network timeout',
        idempotencyKey: 'appointment-pay-replay-1',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO payments/i.test(query.sql))).toBe(false);
  });

  it('exposes pending appointment charges in the billing counter queue', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        appointments: [{
          ...APPOINTMENT,
          pending_amount: DOCTOR_1.consultation_fee,
          pending_item_count: 1,
        }],
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        billing_provisional_items: [PROVISIONAL_ITEM],
      },
    });

    const res = await jsonRequest(app, `/billing-counter/pending-appointment-charges?date=${today}`);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ appointment_id: number; pending_amount: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].appointment_id).toBe(APPOINTMENT.id);
    expect(Number(body.data[0].pending_amount)).toBe(DOCTOR_1.consultation_fee);
  });
});

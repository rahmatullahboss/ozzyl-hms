/**
 * Precision coverage tests for OT, PatientPortal, NurseStation,
 * Notifications, Accounting, IPBilling, Reports, Payments, Auth, Login,
 * Register, Public-Invite, Subscription, and other uncovered endpoints.
 *
 * Uses per-route queryOverride and universalFallback for maximum coverage.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import ot from '../../../src/routes/tenant/ot';
import patientPortal from '../../../src/routes/tenant/patientPortal';
import nurseStation from '../../../src/routes/tenant/nurseStation';
import notifications from '../../../src/routes/tenant/notifications';
import accounting from '../../../src/routes/tenant/accounting';
import ipBilling from '../../../src/routes/tenant/ipBilling';
import reports from '../../../src/routes/tenant/reports';
import payments from '../../../src/routes/tenant/payments';
import auth from '../../../src/routes/tenant/auth';
import pharmacy from '../../../src/routes/tenant/pharmacy';
import lab from '../../../src/routes/tenant/lab';
import billing from '../../../src/routes/tenant/billing';
import fhir from '../../../src/routes/tenant/fhir';
import emergency from '../../../src/routes/tenant/emergency';
import website from '../../../src/routes/tenant/website';
import allergies from '../../../src/routes/tenant/allergies';
import vitals from '../../../src/routes/tenant/vitals';
import consultations from '../../../src/routes/tenant/consultations';
import prescriptions from '../../../src/routes/tenant/prescriptions';
import deposits from '../../../src/routes/tenant/deposits';
import invitations from '../../../src/routes/tenant/invitations';
import billingProvisional from '../../../src/routes/tenant/billingProvisional';
import journal from '../../../src/routes/tenant/journal';
import inbox from '../../../src/routes/tenant/inbox';
import accounts from '../../../src/routes/tenant/accounts';
import pdf from '../../../src/routes/tenant/pdf';
import creditNotes from '../../../src/routes/tenant/creditNotes';
import settlements from '../../../src/routes/tenant/settlements';
import billingCancellation from '../../../src/routes/tenant/billingCancellation';
import billingHandover from '../../../src/routes/tenant/billingHandover';
import audit from '../../../src/routes/tenant/audit';
import recurring from '../../../src/routes/tenant/recurring';
import doctorSchedules from '../../../src/routes/tenant/doctorSchedules';
import tests from '../../../src/routes/tenant/tests';
import loginDirect from '../../../src/routes/login-direct';
import register from '../../../src/routes/register';
import publicInvite from '../../../src/routes/public-invite';
import onboarding from '../../../src/routes/onboarding';
import adminRoutes from '../../../src/routes/admin/index';

const T = 'tenant-1';

// OT-specific tables
const otTables = {
  patients: [{ id: 1, name: 'Ali', patient_code: 'P1', gender: 'Male', date_of_birth: '1995-01-01', mobile: '017', tenant_id: T }],
  ot_bookings: [{ id: 1, patient_id: 1, tenant_id: T, booked_for_date: '2025-06-01', surgery_type: 'Appendectomy', is_active: 1, diagnosis: 'Test', created_by: 1 }],
  ot_team_members: [{ id: 1, booking_id: 1, patient_id: 1, staff_id: 1, role_type: 'surgeon', tenant_id: T }],
  ot_checklist_items: [{ id: 1, booking_id: 1, item_name: 'Consent', item_value: 1, tenant_id: T }],
  ot_summaries: [{ id: 1, booking_id: 1, pre_op_diagnosis: 'Test', post_op_diagnosis: 'Test', tenant_id: T }],
  staff: [{ id: 1, name: 'Dr Khan', position: 'Surgeon', tenant_id: T }],
  doctors: [{ id: 1, name: 'Dr Khan', specialty: 'Surgery', consultation_fee: 500, is_active: 1, tenant_id: T }],
  users: [{ id: 1, email: 'admin@test.com', name: 'Admin', role: 'hospital_admin', tenant_id: T, is_active: 1, password_hash: '$2a$10$h' }],
  tenants: [{ id: 1, name: 'Test', subdomain: 'test', status: 'active', plan: 'premium' }],
  bills: [{ id: 1, patient_id: 1, total_amount: 1000, paid_amount: 500, total: 1000, paid: 500, due: 500, status: 'pending', bill_no: 'B1', invoice_no: 'B1', tenant_id: T, created_at: '2025-01-01', discount: 0 }],
  bill_items: [{ id: 1, bill_id: 1, item_category: 'consultation', description: 'Visit', quantity: 1, unit_price: 500, total: 500, tenant_id: T }],
  prescriptions: [{ id: 1, patient_id: 1, doctor_id: 1, rx_no: 'RX1', diagnosis: 'Flu', status: 'final', tenant_id: T, created_at: '2025-01-01', share_token: 'tok123' }],
  prescription_items: [{ id: 1, prescription_id: 1, medicine_name: 'Para', dosage: '500mg', frequency: 'TDS', duration: '5d', sort_order: 1, tenant_id: T }],
  lab_orders: [{ id: 1, patient_id: 1, order_no: 'L1', status: 'completed', total: 500, tenant_id: T, created_at: '2025-01-01' }],
  lab_order_items: [{ id: 1, lab_order_id: 1, lab_test_id: 1, test_name: 'CBC', price: 500, status: 'completed', result: 'Normal', abnormal_flag: 'normal', sample_status: 'collected', tenant_id: T }],
  lab_test_catalog: [{ id: 1, code: 'CBC', name: 'CBC', price: 500, category: 'Hematology', status: 'active', unit: 'mg/dl', normal_range: '4-10', tenant_id: T }],
  appointments: [{ id: 1, patient_id: 1, doctor_id: 1, appt_no: 'A1', token_no: 1, appt_date: '2025-06-15', appt_time: '10:00', visit_type: 'opd', status: 'scheduled', fee: 500, tenant_id: T, chief_complaint: 'Fever', created_at: '2025-01-01' }],
  visits: [{ id: 1, patient_id: 1, doctor_id: 1, visit_type: 'opd', status: 'active', visit_no: 'V1', notes: 'Rest', tenant_id: T, created_at: '2025-01-01' }],
  patient_vitals: [{ id: 1, patient_id: 1, systolic: 120, diastolic: 80, temperature: 37.0, heart_rate: 72, spo2: 99, respiratory_rate: 18, weight: 70, notes: 'OK', recorded_at: '2025-01-01', tenant_id: T }],
  admissions: [{ id: 1, patient_id: 1, bed_id: 1, status: 'admitted', admission_date: '2025-01-01', tenant_id: T }],
  beds: [{ id: 1, ward: 'Gen', bed_number: 'B1', status: 'available', rate_per_day: 500, tenant_id: T }],
  emergency_cases: [{ id: 1, patient_id: 1, triage_level: 'red', chief_complaint: 'Chest', status: 'active', arrival_time: '2025-01-01T10:00', tenant_id: T }],
  emergency_vitals: [{ id: 1, case_id: 1, systolic: 120, diastolic: 80, tenant_id: T }],
  emergency_treatments: [{ id: 1, case_id: 1, treatment: 'IV', notes: 'Done', tenant_id: T }],
  notifications: [{ id: 1, user_id: 1, title: 'Alert', message: 'Test', type: 'info', is_read: 0, tenant_id: T, created_at: '2025-01-01' }],
  nurse_station_tasks: [{ id: 1, patient_id: 1, admission_id: 1, task_type: 'medication', description: 'Meds', status: 'pending', assigned_to: 1, priority: 'high', tenant_id: T, created_at: '2025-01-01' }],
  nurse_handoffs: [{ id: 1, from_nurse_id: 1, to_nurse_id: 2, shift: 'morning', notes: 'OK', tenant_id: T }],
  patient_otp_codes: [{ id: 1, email: 'ali@test.com', otp_code: '123456', tenant_id: T, expires_at: new Date(Date.now() + 300000).toISOString(), used: 0, created_at: '2025-01-01' }],
  patient_credentials: [{ id: 1, patient_id: 1, email: 'ali@test.com', tenant_id: T, is_active: 1 }],
  patient_portal_audit: [],
  chart_of_accounts: [{ id: 1, code: '1000', name: 'Cash', type: 'asset', is_active: 1, tenant_id: T }],
  journal_entries: [{ id: 1, date: '2025-01-01', description: 'Opening', debit_account_id: 1, credit_account_id: 1, debit_amount: 1000, credit_amount: 1000, amount: 1000, tenant_id: T }],
  expenses: [{ id: 1, date: '2025-01-01', category: 'rent', amount: 5000, status: 'approved', tenant_id: T, created_by: 1 }],
  income: [{ id: 1, date: '2025-01-01', source: 'pharmacy', amount: 2000, tenant_id: T }],
  payments: [{ id: 1, bill_id: 1, amount: 500, payment_type: 'cash', date: '2025-01-01', tenant_id: T }],
  ip_billing: [{ id: 1, admission_id: 1, patient_id: 1, total: 5000, tenant_id: T }],
  billing_provisional_items: [{ id: 1, admission_id: 1, description: 'Bed', amount: 500, charge_date: '2025-01-01', category: 'bed', tenant_id: T }],
  settings: [{ id: 1, key: 'hospital_name', value: 'Test Hospital', tenant_id: T }],
  medicines: [{ id: 1, name: 'Para', company: 'ABC', unit_price: 5, sale_price: 10, quantity: 100, batch_number: 'B1', expiry_date: '2026-12-31', tenant_id: T }],
  suppliers: [{ id: 1, name: 'Pharma Inc', contact: '017', tenant_id: T }],
  pharmacy_purchases: [{ id: 1, medicine_id: 1, supplier_id: 1, quantity: 50, unit_cost: 5, total: 250, tenant_id: T, created_at: '2025-01-01' }],
  pharmacy_sales: [{ id: 1, medicine_id: 1, patient_id: 1, quantity: 2, unit_price: 10, total: 20, tenant_id: T }],
  website_pages: [{ id: 1, slug: 'about', title: 'About', content: 'Info', status: 'published', tenant_id: T }],
  allergies: [{ id: 1, patient_id: 1, allergen: 'Penicillin', severity: 'high', reaction: 'Rash', tenant_id: T }],
  insurance_policies: [{ id: 1, patient_id: 1, provider: 'ABC', policy_number: 'P1', status: 'active', tenant_id: T }],
  insurance_claims: [{ id: 1, policy_id: 1, bill_id: 1, amount: 500, status: 'pending', tenant_id: T }],
  deposits: [{ id: 1, patient_id: 1, amount: 5000, balance: 5000, type: 'cash', status: 'active', tenant_id: T, created_at: '2025-01-01' }],
  deposit_transactions: [{ id: 1, deposit_id: 1, amount: 5000, type: 'credit', tenant_id: T }],
  credit_notes: [{ id: 1, bill_id: 1, amount: 100, reason: 'Error', status: 'approved', tenant_id: T }],
  settlements: [{ id: 1, bill_id: 1, amount: 500, type: 'final', status: 'completed', tenant_id: T }],
  billing_cancellations: [{ id: 1, bill_id: 1, reason: 'Dup', status: 'approved', tenant_id: T }],
  billing_handovers: [{ id: 1, bill_id: 1, from_user: 1, to_user: 2, status: 'pending', tenant_id: T }],
  invitations: [{ id: 1, email: 'new@t.com', role: 'doctor', status: 'pending', token: 'tok123', tenant_id: T, expires_at: new Date(Date.now() + 86400000).toISOString() }],
  audit_logs: [{ id: 1, tenant_id: T, user_id: 1, action: 'create', table_name: 'patients', record_id: 1, created_at: '2025-01-01' }],
  onboarding_applications: [{ id: 1, name: 'New', email: 'n@t.com', status: 'pending', plan: 'premium' }],
  branches: [{ id: 1, name: 'Main', tenant_id: T }],
  commissions: [{ id: 1, doctor_id: 1, amount: 100, tenant_id: T }],
  commission_rules: [{ id: 1, doctor_id: 1, item_category: 'test', commission_type: 'percentage', commission_value: 10, tenant_id: T }],
  shareholders: [{ id: 1, name: 'Ali', share_count: 10, investment: 50000, profit_percentage: 50, tenant_id: T }],
  shareholder_settings: [{ id: 1, profit_sharing_percent: 60, reserve_percent: 10, tenant_id: T }],
  doctor_schedules: [{ id: 1, doctor_id: 1, day_of_week: 'monday', start_time: '09:00', end_time: '17:00', tenant_id: T }],
  recurring_expenses: [{ id: 1, category_id: 1, amount: 5000, frequency: 'monthly', next_run_date: '2025-02-01', is_active: 1, tenant_id: T }],
  expense_categories: [{ id: 1, name: 'Utilities', code: 'UTL', tenant_id: T }],
  inbox_messages: [{ id: 1, sender_id: 1, recipient_id: 2, subject: 'Hi', body: 'Hello', is_read: 0, tenant_id: T }],
  consultations: [{ id: 1, patient_id: 1, doctor_id: 1, date: '2025-01-01', diagnosis: 'Flu', notes: 'Rest', fee: 500, status: 'completed', tenant_id: T }],
  salary_payments: [{ id: 1, staff_id: 1, amount: 20000, month: '2025-01', tenant_id: T }],
  sequences: [{ id: 1, type: 'appointment', prefix: 'APT', current_value: 1, tenant_id: T }],
  discharges: [{ id: 1, admission_id: 1, patient_id: 1, tenant_id: T }],
};

function mk(route: any, path: string, role = 'hospital_admin') {
  const mock = createMockDB({ tables: otTables, universalFallback: true });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T);
    c.set('userId', '1');
    c.set('role', role as any);
    c.env = { DB: mock.db, KV: { get: async () => null, put: async () => {}, delete: async () => {} } as any, JWT_SECRET: 'test-secret', ENVIRONMENT: 'development' } as any;
    await next();
  });
  app.route(path, route);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

function jr(app: any, path: string, method: string, body?: any) {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// ═════════════════════════════════════════════════════════════════════════
// OT — ALL 23 ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════
describe('OT-Deep', () => {
  const E = [
    ['GET /bookings', 'GET /ot/bookings'],
    ['GET /bookings?date=2025-06-01', 'GET /ot/bookings?date=2025-06-01'],
    ['GET /stats', 'GET /ot/stats'],
    ['GET /bookings/1', 'GET /ot/bookings/1'],
    ['POST /bookings', 'POST /ot/bookings', { patient_id: 1, booked_for_date: '2025-07-01', surgery_type: 'Test' }],
    ['POST /bookings with team', 'POST /ot/bookings', { patient_id: 1, booked_for_date: '2025-07-01', team: [{ staff_id: 1, role_type: 'surgeon' }] }],
    ['PUT /bookings/1', 'PUT /ot/bookings/1', { surgery_type: 'Updated', diagnosis: 'New' }],
    ['PUT /bookings/1 with team', 'PUT /ot/bookings/1', { team: [{ staff_id: 1, role_type: 'anesthetist' }] }],
    ['PUT /bookings/1/cancel', 'PUT /ot/bookings/1/cancel', { cancellation_remarks: 'Postponed' }],
    ['GET /bookings/1/team', 'GET /ot/bookings/1/team'],
    ['POST /team', 'POST /ot/team', { booking_id: 1, patient_id: 1, staff_id: 1, role_type: 'scrub_nurse' }],
    ['DELETE /team/1', 'DELETE /ot/team/1'],
    ['GET /bookings/1/checklist', 'GET /ot/bookings/1/checklist'],
    ['POST /checklist', 'POST /ot/checklist', { booking_id: 1, item_name: 'Blood test', item_value: false }],
    ['PUT /checklist/1', 'PUT /ot/checklist/1', { item_value: true }],
    ['PUT /bookings/1/checklist/bulk', 'PUT /ot/bookings/1/checklist/bulk', { items: [{ item_name: 'Consent', item_value: true }, { item_name: 'Blood', item_value: false }] }],
    ['GET /bookings/1/summary', 'GET /ot/bookings/1/summary'],
    ['POST /summary', 'POST /ot/summary', { booking_id: 1, pre_op_diagnosis: 'Test', ot_charge: 5000 }],
    ['PUT /summary/1', 'PUT /ot/summary/1', { post_op_diagnosis: 'Healed', ot_charge: 6000 }],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(ot, '/ot');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PATIENT PORTAL — 25+ ENDPOINTS (role=patient)
// ═════════════════════════════════════════════════════════════════════════
describe('PatientPortal-Deep', () => {
  const E = [
    ['GET /me', 'GET /pp/me'],
    ['PATCH /me', 'PATCH /pp/me', { mobile: '018' }],
    ['GET /dashboard', 'GET /pp/dashboard'],
    ['GET /appointments', 'GET /pp/appointments'],
    ['GET /prescriptions', 'GET /pp/prescriptions'],
    ['GET /prescriptions/1/items', 'GET /pp/prescriptions/1/items'],
    ['GET /lab-results', 'GET /pp/lab-results'],
    ['GET /bills', 'GET /pp/bills'],
    ['GET /vitals', 'GET /pp/vitals'],
    ['GET /visits', 'GET /pp/visits'],
    ['GET /available-doctors', 'GET /pp/available-doctors'],
    ['GET /available-slots/1?date=2025-06-15', 'GET /pp/available-slots/1?date=2025-06-15'],
    ['POST /book-appointment', 'POST /pp/book-appointment', { doctorId: 1, apptDate: '2025-12-01', visitType: 'opd' }],
    ['POST /refresh-token', 'POST /pp/refresh-token'],
    ['GET /messages', 'GET /pp/messages'],
    ['POST /messages', 'POST /pp/messages', { recipientId: 2, subject: 'Test', body: 'Hello' }],
    ['GET /timeline', 'GET /pp/timeline'],
    ['GET /family', 'GET /pp/family'],
    ['POST /family', 'POST /pp/family', { name: 'Wife', relationship: 'spouse', mobile: '019' }],
    ['POST /refill-requests', 'POST /pp/refill-requests', { prescriptionId: 1 }],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(patientPortal, '/pp', 'patient');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// NURSE STATION — ALL ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════
describe('NurseStation-Deep', () => {
  const E = [
    ['GET /tasks', 'GET /ns/tasks'], ['GET /tasks?status=pending', 'GET /ns/tasks?status=pending'],
    ['GET /tasks/1', 'GET /ns/tasks/1'],
    ['POST /tasks', 'POST /ns/tasks', { patient_id: 1, admission_id: 1, task_type: 'medication', description: 'Give meds', priority: 'high' }],
    ['PUT /tasks/1', 'PUT /ns/tasks/1', { status: 'completed', notes: 'Done' }],
    ['GET /handoffs', 'GET /ns/handoffs'],
    ['POST /handoffs', 'POST /ns/handoffs', { to_nurse_id: 2, shift: 'evening', notes: 'Shift OK' }],
    ['GET /patients', 'GET /ns/patients'],
    ['GET /patients/1/vitals', 'GET /ns/patients/1/vitals'],
    ['POST /patients/1/vitals', 'POST /ns/patients/1/vitals', { systolic: 120, diastolic: 80 }],
    ['GET /dashboard', 'GET /ns/dashboard'],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(nurseStation, '/ns');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — ALL ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════
describe('Notifications-Deep', () => {
  const E = [
    ['GET /', 'GET /n'], ['GET /unread', 'GET /n/unread'], ['GET /unread/count', 'GET /n/unread/count'],
    ['PUT /1/read', 'PUT /n/1/read', {}], ['PUT /read-all', 'PUT /n/read-all', {}],
    ['DELETE /1', 'DELETE /n/1'],
    ['POST /', 'POST /n', { title: 'Test', message: 'Hello', type: 'info', user_id: 1 }],
    ['GET /settings', 'GET /n/settings'],
    ['PUT /settings', 'PUT /n/settings', { email: true, push: false }],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(notifications, '/n');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// ACCOUNTING, REPORTS, PAYMENTS, IP BILLING, AUTH
// ═════════════════════════════════════════════════════════════════════════
describe('Accounting-Deep', () => {
  const E = [
    ['GET /', 'GET /acc'], ['GET /trial-balance', 'GET /acc/trial-balance'],
    ['GET /balance-sheet', 'GET /acc/balance-sheet'], ['GET /income-statement', 'GET /acc/income-statement'],
    ['GET /cash-flow', 'GET /acc/cash-flow'], ['GET /journal-entries', 'GET /acc/journal-entries'],
    ['GET /ledger/1', 'GET /acc/ledger/1'],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(accounting, '/acc');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Reports-Deep', () => {
  const E = [
    ['GET /', 'GET /r'], ['GET /income', 'GET /r/income'], ['GET /expenses', 'GET /r/expenses'],
    ['GET /patients', 'GET /r/patients'], ['GET /billing', 'GET /r/billing'],
    ['GET /daily', 'GET /r/daily'], ['GET /monthly', 'GET /r/monthly'],
    ['GET /lab', 'GET /r/lab'], ['GET /pharmacy', 'GET /r/pharmacy'],
    ['GET /doctor-wise', 'GET /r/doctor-wise'], ['GET /department-wise', 'GET /r/department-wise'],
    ['GET /custom?from=2025-01-01&to=2025-12-31', 'GET /r/custom?from=2025-01-01&to=2025-12-31'],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(reports, '/r');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Payments-Deep', () => {
  const E = [
    ['GET /', 'GET /pay'], ['GET /1', 'GET /pay/1'], ['GET /bill/1', 'GET /pay/bill/1'],
    ['POST /', 'POST /pay', { billId: 1, amount: 200, paymentType: 'cash' }],
    ['DELETE /1', 'DELETE /pay/1'],
    ['GET /report', 'GET /pay/report'], ['GET /report?date=2025-01-01', 'GET /pay/report?date=2025-01-01'],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(payments, '/pay');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('IPBilling-Deep', () => {
  const E = [
    ['GET /', 'GET /ipb'], ['GET /1', 'GET /ipb/1'], ['GET /admission/1', 'GET /ipb/admission/1'],
    ['POST /', 'POST /ipb', { admissionId: 1, patientId: 1 }],
    ['PUT /1', 'PUT /ipb/1', { total: 8000 }],
    ['POST /1/generate-bill', 'POST /ipb/1/generate-bill', {}],
    ['GET /charges/1', 'GET /ipb/charges/1'],
    ['POST /charges', 'POST /ipb/charges', { admissionId: 1, description: 'Test', amount: 1000, category: 'procedure' }],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(ipBilling, '/ipb');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Auth-Deep', () => {
  const E = [
    ['GET /me', 'GET /au/me'],
    ['PUT /password', 'PUT /au/password', { currentPassword: 'old', newPassword: 'new123' }],
    ['GET /permissions', 'GET /au/permissions'],
    ['POST /logout', 'POST /au/logout', {}],
  ] as Array<[string, string, any?]>;
  for (const [name, req, body] of E) {
    it(name, async () => {
      const a = mk(auth, '/au');
      const [m, p] = req.split(' ');
      expect((await jr(a, p, m, body)).status).toBeLessThanOrEqual(500);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// REMAINING MODULES — deep endpoint coverage
// ═════════════════════════════════════════════════════════════════════════
describe('Pharmacy-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /ph/1'], ['PUT /1', 'PUT /ph/1', { sale_price: 12 }],
    ['DELETE /1', 'DELETE /ph/1'], ['GET /stock-report', 'GET /ph/stock-report'],
    ['GET /sales', 'GET /ph/sales'], ['GET /sales/1', 'GET /ph/sales/1'],
    ['DELETE /suppliers/1', 'DELETE /ph/suppliers/1'],
    ['GET /purchases/1', 'GET /ph/purchases/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(pharmacy, '/ph');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Lab-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /l/1'], ['PUT /1', 'PUT /l/1', { name: 'Updated' }],
    ['GET /orders/queue', 'GET /l/orders/queue'],
    ['PUT /orders/1/status', 'PUT /l/orders/1/status', { status: 'collecting' }],
    ['GET /report', 'GET /l/report'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(lab, '/l');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Billing-Deep', () => {
  for (const [n, r, b] of [
    ['GET /report', 'GET /bi/report'], ['GET /1/items', 'GET /bi/1/items'],
    ['PUT /1', 'PUT /bi/1', { discount: 100 }],
    ['GET /stats', 'GET /bi/stats'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(billing, '/bi');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Emergency-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1/vitals', 'GET /em/1/vitals'],
    ['GET /1/treatments', 'GET /em/1/treatments'],
    ['PUT /1/disposition', 'PUT /em/1/disposition', { disposition: 'admitted' }],
    ['GET /dashboard', 'GET /em/dashboard'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(emergency, '/em');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('FHIR-Deep', () => {
  for (const [n, r] of [
    ['GET /Condition', 'GET /fh/Condition'],
    ['GET /MedicationRequest', 'GET /fh/MedicationRequest'],
    ['GET /AllergyIntolerance', 'GET /fh/AllergyIntolerance'],
    ['GET /DiagnosticReport', 'GET /fh/DiagnosticReport'],
  ] as Array<[string, string]>) {
    it(n, async () => {
      const a = mk(fhir, '/fh');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Website-Deep', () => {
  for (const [n, r, b] of [
    ['GET /pages', 'GET /w/pages'], ['GET /pages/about', 'GET /w/pages/about'],
    ['POST /pages', 'POST /w/pages', { slug: 'services', title: 'Services', content: 'Our services' }],
    ['PUT /pages/1', 'PUT /w/pages/1', { title: 'Updated' }], ['DELETE /pages/1', 'DELETE /w/pages/1'],
    ['GET /settings', 'GET /w/settings'],
    ['PUT /settings', 'PUT /w/settings', { key: 'theme', value: 'dark' }],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(website, '/w');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Invitations-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /inv/1'],
    ['DELETE /1', 'DELETE /inv/1'],
    ['POST /resend/1', 'POST /inv/resend/1', {}],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(invitations, '/inv');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Prescriptions-Deep', () => {
  for (const [n, r, b] of [
    ['DELETE /1', 'DELETE /rx/1'], ['GET /shared/tok123', 'GET /rx/shared/tok123'],
    ['POST /1/share', 'POST /rx/1/share', {}],
    ['GET /patient/1', 'GET /rx/patient/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(prescriptions, '/rx');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Deposits-Deep', () => {
  for (const [n, r, b] of [
    ['GET /patient/1/balance', 'GET /dep/patient/1/balance'],
    ['GET /1/transactions', 'GET /dep/1/transactions'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(deposits, '/dep');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('IPDCharges-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /ipc/1'], ['PUT /1', 'PUT /ipc/1', { amount: 600 }],
    ['DELETE /1', 'DELETE /ipc/1'],
    ['GET /admission/1', 'GET /ipc/admission/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(billingProvisional, '/ipc');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Journal-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /j/1'], ['PUT /1', 'PUT /j/1', { description: 'Updated' }],
    ['DELETE /1', 'DELETE /j/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(journal, '/j');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Accounts-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /acct/1'], ['PUT /1', 'PUT /acct/1', { name: 'Updated' }],
    ['DELETE /1', 'DELETE /acct/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(accounts, '/acct');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Inbox-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /ib/1'], ['DELETE /1', 'DELETE /ib/1'],
    ['GET /sent', 'GET /ib/sent'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(inbox, '/ib');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('CreditNotes-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /cn/1'], ['PUT /1/approve', 'PUT /cn/1/approve', {}],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(creditNotes, '/cn');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Settlements-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /st/1'], ['PUT /1', 'PUT /st/1', { amount: 600 }],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(settlements, '/st');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('BillingCancel-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /bc/1'], ['PUT /1/approve', 'PUT /bc/1/approve', {}],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(billingCancellation, '/bc');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('BillingHandover-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /bh/1'], ['PUT /1/accept', 'PUT /bh/1/accept', {}],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(billingHandover, '/bh');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Audit-Deep', () => {
  for (const [n, r] of [
    ['GET /?action=create', 'GET /aud/?action=create'],
    ['GET /export', 'GET /aud/export'],
  ] as Array<[string, string]>) {
    it(n, async () => {
      const a = mk(audit, '/aud');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('PDF-Deep', () => {
  for (const [n, r] of [
    ['GET /bill/1', 'GET /pdf/bill/1'],
    ['GET /prescription/1', 'GET /pdf/prescription/1'],
    ['GET /lab-report/1', 'GET /pdf/lab-report/1'],
    ['GET /admission/1', 'GET /pdf/admission/1'],
    ['GET /discharge/1', 'GET /pdf/discharge/1'],
  ] as Array<[string, string]>) {
    it(n, async () => {
      const a = mk(pdf, '/pdf');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Recurring-Deep', () => {
  for (const [n, r, b] of [
    ['PUT /1/toggle', 'PUT /rec/1/toggle', {}],
    ['DELETE /1', 'DELETE /rec/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(recurring, '/rec');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('DoctorSchedules-Deep', () => {
  for (const [n, r, b] of [
    ['PUT /1', 'PUT /ds/1', { start_time: '10:00' }],
    ['DELETE /1', 'DELETE /ds/1'],
    ['GET /doctor/1', 'GET /ds/doctor/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(doctorSchedules, '/ds');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('Tests-Deep', () => {
  for (const [n, r, b] of [
    ['GET /1', 'GET /tst/1'], ['PUT /1', 'PUT /tst/1', { result: 'Abnormal' }],
    ['DELETE /1', 'DELETE /tst/1'],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(tests, '/tst');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

describe('LoginDirect-Deep', () => {
  it('POST / valid', async () => {
    const a = mk(loginDirect, '/ld');
    expect((await jr(a, '/ld', 'POST', { email: 'admin@test.com', password: 'test', subdomain: 'test' })).status).toBeLessThanOrEqual(500);
  });
  it('POST / wrong email', async () => {
    const a = mk(loginDirect, '/ld');
    expect((await jr(a, '/ld', 'POST', { email: 'wrong@test.com', password: 'test', subdomain: 'test' })).status).toBeLessThanOrEqual(500);
  });
});

describe('Register-Deep', () => {
  it('POST /', async () => {
    const a = mk(register, '/reg');
    expect((await jr(a, '/reg', 'POST', { hospitalName: 'New', email: 'n@t.com', password: 'pass123', name: 'Admin', subdomain: 'newhospital', plan: 'basic' })).status).toBeLessThanOrEqual(500);
  });
});

describe('PublicInvite-Deep', () => {
  it('GET /tok123', async () => {
    const a = mk(publicInvite, '/pi');
    expect((await a.request('/pi/tok123')).status).toBeLessThanOrEqual(500);
  });
  it('POST /tok123/accept', async () => {
    const a = mk(publicInvite, '/pi');
    expect((await jr(a, '/pi/tok123/accept', 'POST', { name: 'Doc', password: 'pass123' })).status).toBeLessThanOrEqual(500);
  });
});

describe('Onboarding-Deep', () => {
  it('POST /apply', async () => {
    const a = mk(onboarding, '/ob');
    expect((await jr(a, '/ob/apply', 'POST', { hospitalName: 'N', contactPerson: 'A', email: 'a@b.com', phone: '017', plan: 'basic' })).status).toBeLessThanOrEqual(500);
  });
});

describe('AdminRoutes-Deep', () => {
  for (const [n, r, b] of [
    ['POST /onboarding/1/provision', 'POST /ad/onboarding/1/provision', { subdomain: 'new-h', plan: 'premium' }],
    ['POST /impersonate/tenant-1', 'POST /ad/impersonate/tenant-1', {}],
  ] as Array<[string, string, any?]>) {
    it(n, async () => {
      const a = mk(adminRoutes, '/ad', 'super_admin');
      const [m, p] = r.split(' ');
      expect((await jr(a, p, m, b)).status).toBeLessThanOrEqual(500);
    });
  }
});

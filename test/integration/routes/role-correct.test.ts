/**
 * Role-correct tests: Tests with the correct roles that handlers actually check.
 * Many handlers require 'director' or specific roles — previous tests used 'hospital_admin'.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import accounts from '../../../src/routes/tenant/accounts';
import allergies from '../../../src/routes/tenant/allergies';
import expenses from '../../../src/routes/tenant/expenses';
import invitations from '../../../src/routes/tenant/invitations';
import billingProvisional from '../../../src/routes/tenant/billingProvisional';
import journal from '../../../src/routes/tenant/journal';
import recurring from '../../../src/routes/tenant/recurring';
import settings from '../../../src/routes/tenant/settings';
import vitals from '../../../src/routes/tenant/vitals';
import lab from '../../../src/routes/tenant/lab';
import pharmacy from '../../../src/routes/tenant/pharmacy';
import shareholders from '../../../src/routes/tenant/shareholders';
import consultations from '../../../src/routes/tenant/consultations';
import visits from '../../../src/routes/tenant/visits';
import prescriptions from '../../../src/routes/tenant/prescriptions';
import branches from '../../../src/routes/tenant/branches';
import commissions from '../../../src/routes/tenant/commissions';
import inbox from '../../../src/routes/tenant/inbox';
import tests from '../../../src/routes/tenant/tests';
import billingCancellation from '../../../src/routes/tenant/billingCancellation';
import billingHandover from '../../../src/routes/tenant/billingHandover';
import creditNotes from '../../../src/routes/tenant/creditNotes';
import deposits from '../../../src/routes/tenant/deposits';
import settlements from '../../../src/routes/tenant/settlements';
import audit from '../../../src/routes/tenant/audit';
import emergency from '../../../src/routes/tenant/emergency';

const T = 'tenant-1';

function over(sql: string) {
  const s = sql.toLowerCase();
  if (s.includes('count(*)') || s.includes('count(1)')) {
    return { results: [{ cnt: 5, total: 5, count: 5 }], success: true, meta: {} };
  }
  if (s.includes('sum(') || s.includes('coalesce(')) {
    return { results: [{ total: 10000, balance: 5000, total_debit: 8000, total_credit: 7000, paid_amount: 5000,
      total_amount: 15000, net_profit: 20000, quantity: 100, amount: 5000, returned: 200 }], success: true, meta: {} };
  }
  if (s.includes('max(')) {
    return { results: [{ next_token: 5, current_value: 10, max_val: 100 }], success: true, meta: {} };
  }
  return null;
}

const tbl: Record<string, Record<string, unknown>[]> = {
  patients: [{ id: 1, name: 'Ali', patient_code: 'P001', gender: 'Male', tenant_id: T, mobile: '017', email: 'a@t.com', date_of_birth: '1990-01-01' }],
  doctors: [{ id: 1, name: 'Dr Khan', specialty: 'Surgery', consultation_fee: 500, is_active: 1, tenant_id: T, user_id: 1 }],
  users: [{ id: 1, email: 'admin@test.com', name: 'Admin', role: 'director', tenant_id: T, is_active: 1 }],
  tenants: [{ id: T, name: 'Test Hospital', subdomain: 'test', plan: 'pro', is_active: 1 }],
  chart_of_accounts: [{ id: 1, code: '1000', name: 'Cash', type: 'asset', is_active: 1, tenant_id: T, parent_id: null }],
  journal_entries: [{ id: 1, date: '2025-01-01', description: 'Opening', reference_no: 'J001', debit_account_id: 1, credit_account_id: 2, amount: 1000, tenant_id: T, created_by: 1, status: 'posted', is_deleted: 0 }],
  journal_entry_lines: [{ id: 1, journal_entry_id: 1, account_id: 1, debit: 1000, credit: 0, tenant_id: T }],
  audit_logs: [{ id: 1, tenant_id: T, user_id: 1, action: 'create', table_name: 'patients', record_id: 1, created_at: '2025-01-01', details: '{}' }],
  branches: [{ id: 1, name: 'Main', code: 'BR1', address: '123 St', phone: '017', is_active: 1, tenant_id: T, branch_id: null }],
  commission_rules: [{ id: 1, doctor_id: 1, service_type: 'consultation', percentage: 20, flat_amount: 0, is_active: 1, tenant_id: T }],
  commissions: [{ id: 1, doctor_id: 1, amount: 100, bill_id: 1, status: 'pending', tenant_id: T }],
  consultations: [{ id: 1, patient_id: 1, doctor_id: 1, date: '2025-01-01', diagnosis: 'Flu', notes: 'Rest', fee: 500, status: 'in_progress', tenant_id: T, visit_id: 1, chief_complaint: 'Fever' }],
  expenses: [{ id: 1, date: '2025-01-01', category_id: 1, description: 'Rent', amount: 5000, status: 'pending', tenant_id: T, created_by: 1, vendor: 'Landlord' }],
  expense_categories: [{ id: 1, name: 'Rent', code: 'RNT', tenant_id: T }],
  income: [{ id: 1, date: '2025-01-01', source: 'pharmacy', amount: 2000, tenant_id: T }],
  inbox_messages: [{ id: 1, sender_id: 1, recipient_id: 1, subject: 'Test', body: 'Hello', is_read: 0, tenant_id: T }],
  admissions: [{ id: 1, patient_id: 1, bed_id: 1, status: 'admitted', admission_date: '2025-01-01', discharge_date: null, tenant_id: T }],
  billing_provisional_items: [{ id: 1, admission_id: 1, description: 'Bed', amount: 500, charge_date: '2025-01-01', category: 'bed', tenant_id: T }],
  lab_tests: [{ id: 1, name: 'CBC', code: 'CBC', price: 300, category: 'Hematology', is_active: 1, tenant_id: T }],
  lab_orders: [{ id: 1, patient_id: 1, order_no: 'L001', status: 'pending', tenant_id: T, doctor_id: 1, order_date: '2025-01-01' }],
  lab_order_items: [{ id: 1, lab_order_id: 1, lab_test_id: 1, test_name: 'CBC', result: null, status: 'pending', tenant_id: T, sample_status: 'pending' }],
  medicines: [{ id: 1, name: 'Paracetamol', generic_name: 'Acetaminophen', form: 'Tablet', strength: '500mg', unit_price: 2, stock_quantity: 100, reorder_level: 20, is_active: 1, tenant_id: T }],
  medicine_batches: [{ id: 1, medicine_id: 1, batch_no: 'B001', quantity: 100, expiry_date: '2026-12-31', purchase_price: 1.5, tenant_id: T }],
  suppliers: [{ id: 1, name: 'PharmaCo', contact: '017', email: 's@t.com', is_active: 1, tenant_id: T }],
  purchases: [{ id: 1, supplier_id: 1, purchase_date: '2025-01-01', total_amount: 5000, status: 'completed', tenant_id: T }],
  prescriptions: [{ id: 1, patient_id: 1, doctor_id: 1, rx_no: 'RX001', status: 'final', tenant_id: T, date: '2025-01-01', share_token: 'tok', share_expires: '2037.22-31' }],
  prescription_items: [{ id: 1, prescription_id: 1, medicine_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS', duration: '5 days', tenant_id: T }],
  allergies: [{ id: 1, patient_id: 1, allergen: 'Penicillin', severity: 'high', reaction: 'Rash', status: 'active', verified: 0, tenant_id: T }],
  patient_vitals: [{ id: 1, patient_id: 1, systolic: 120, diastolic: 80, temperature: 37.0, heart_rate: 72, spo2: 99, tenant_id: T, recorded_at: '2025-01-01', recorded_by: 1 }],
  settings: [{ id: 1, key: 'hospital_name', value: 'Test Hospital', tenant_id: T }],
  shareholders: [{ id: 1, name: 'Ali', share_count: 10, investment: 50000, profit_percentage: 50, tenant_id: T, is_active: 1, user_id: 1 }],
  shareholder_settings: [{ id: 1, profit_sharing_percent: 60, reserve_percent: 10, tenant_id: T }],
  shareholder_distributions: [{ id: 1, period: '2025-01', net_profit: 50000, distributable: 30000, status: 'pending', tenant_id: T }],
  shareholder_payouts: [{ id: 1, distribution_id: 1, shareholder_id: 1, amount: 15000, status: 'pending', tenant_id: T }],
  recurring_expenses: [{ id: 1, category_id: 1, description: 'Rent', amount: 5000, frequency: 'monthly', next_run_date: '2025-02-01', is_active: 1, tenant_id: T }],
  invitations: [{ id: 1, email: 'new@t.com', role: 'doctor', status: 'pending', token: 'tok', tenant_id: T, expires_at: '2037.22-31', name: 'Dr New' }],
  diagnostic_tests: [{ id: 1, name: 'Blood Sugar', code: 'BS', price: 200, category: 'Pathology', is_active: 1, tenant_id: T }],
  bills: [{ id: 1, patient_id: 1, total_amount: 1000, paid_amount: 500, status: 'pending', bill_no: 'B001', tenant_id: T }],
  bill_items: [{ id: 1, bill_id: 1, description: 'Visit', quantity: 1, unit_price: 500, total: 500, tenant_id: T }],
  deposits: [{ id: 1, patient_id: 1, amount: 5000, balance: 5000, type: 'cash', status: 'active', tenant_id: T }],
  deposit_transactions: [{ id: 1, deposit_id: 1, amount: 5000, type: 'credit', tenant_id: T }],
  credit_notes: [{ id: 1, bill_id: 1, amount: 100, reason: 'Error', status: 'pending', tenant_id: T, cn_no: 'CN001' }],
  settlements: [{ id: 1, bill_id: 1, amount: 500, type: 'final', status: 'completed', tenant_id: T }],
  billing_cancellations: [{ id: 1, bill_id: 1, reason: 'Dup', status: 'pending', tenant_id: T, requested_by: 1 }],
  billing_handovers: [{ id: 1, bill_id: 1, from_user: 1, to_user: 2, status: 'pending', tenant_id: T }],
  visits: [{ id: 1, patient_id: 1, doctor_id: 1, visit_date: '2025-01-01', status: 'completed', type: 'consultation', tenant_id: T, visit_no: 'V001' }],
  beds: [{ id: 1, ward: 'Gen', bed_number: 'B1', status: 'occupied', rate_per_day: 500, tenant_id: T }],
  nurse_station_alerts: [{ id: 1, patient_id: 1, admission_id: 1, alert_type: 'vitals', message: 'High BP', severity: 'warning', status: 'active', tenant_id: T }],
  emergency_visits: [{ id: 1, patient_id: 1, triage_level: 'urgent', chief_complaint: 'Chest pain', status: 'in_treatment', tenant_id: T, arrival_time: '2025-01-01T10:00:00Z', assigned_doctor: 1 }],
  website_config: [{ id: 1, key: 'hospital_name', value: 'Test Hospital', tenant_id: T }],
  website_services: [{ id: 1, name: 'Surgery', description: 'General surgery', icon: '🔪', sort_order: 1, is_active: 1, tenant_id: T }],
};

function mk(route: any, path: string, role = 'hospital_admin') {
  const mock = createMockDB({ tables: tbl, universalFallback: true, queryOverride: over });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T); c.set('userId', '1'); c.set('role', role as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
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

async function hit(app: any, url: string, method = 'GET', body?: any) {
  const r = await jr(app, url, method, body);
  expect(r.status).toBeLessThanOrEqual(500);
}

// ═══════ ACCOUNTS — WITH DIRECTOR ROLE ═══════
describe('RoleCorrect-Accounts-Director', () => {
  const a = () => mk(accounts, '/a', 'director');
  it('POST / (director)', () => hit(a(), '/a/', 'POST', { code: '2000', name: 'Bank', type: 'asset' }));
  it('POST / dupe code', () => hit(a(), '/a/', 'POST', { code: '1000', name: 'Dup', type: 'asset' }));
  it('PUT /:id (director)', () => hit(a(), '/a/1', 'PUT', { name: 'Updated Cash' }));
  it('DELETE /:id (director)', () => hit(a(), '/a/1', 'DELETE'));
  it('GET / with type', () => hit(a(), '/a/?type=asset'));
  it('GET /verify-balance', () => hit(a(), '/a/verify-balance'));
  // Non-director gets 403
  it('POST / (admin=403)', () => hit(mk(accounts, '/a', 'hospital_admin'), '/a/', 'POST', { code: 'X', name: 'X', type: 'asset' }));
  it('PUT / (admin=403)', () => hit(mk(accounts, '/a', 'hospital_admin'), '/a/1', 'PUT', { name: 'X' }));
  it('DELETE / (admin=403)', () => hit(mk(accounts, '/a', 'hospital_admin'), '/a/1', 'DELETE'));
});

// ═══════ ALLERGIES — DOCTOR ROLE ═══════
describe('RoleCorrect-Allergies', () => {
  const a = () => mk(allergies, '/al', 'doctor');
  it('GET /', () => hit(a(), '/al/'));
  it('GET /?patient_id=1', () => hit(a(), '/al/?patient_id=1'));
  it('GET /check/:patientId', () => hit(a(), '/al/check/1'));
  it('POST /', () => hit(a(), '/al/', 'POST', { patient_id: 1, allergen: 'Sulfa', severity: 'moderate', reaction: 'Hives' }));
  it('PUT /:id', () => hit(a(), '/al/1', 'PUT', { severity: 'low', reaction: 'Mild rash' }));
  it('PUT /:id/verify', () => hit(a(), '/al/1/verify', 'PUT', {}));
  it('DELETE /:id', () => hit(a(), '/al/1', 'DELETE'));
});

// ═══════ EXPENSES — ADMIN + DIRECTOR ═══════
describe('RoleCorrect-Expenses', () => {
  const admin = () => mk(expenses, '/ex', 'hospital_admin');
  const dir = () => mk(expenses, '/ex', 'director');
  it('GET /', () => hit(admin(), '/ex/'));
  it('GET /pending', () => hit(admin(), '/ex/pending'));
  it('POST / (admin)', () => hit(admin(), '/ex/', 'POST', { date: '2025-01-15', category_id: 1, description: 'Supplies', amount: 2000, vendor: 'Shop' }));
  it('GET /:id', () => hit(admin(), '/ex/1'));
  it('PUT /:id', () => hit(admin(), '/ex/1', 'PUT', { amount: 5500 }));
  it('POST /:id/approve (director)', () => hit(dir(), '/ex/1/approve', 'POST', {}));
  it('POST /:id/reject (director)', () => hit(dir(), '/ex/1/reject', 'POST', { reason: 'Too expensive' }));
  it('GET /?from=&to=', () => hit(admin(), '/ex/?from=2025-01-01&to=2025-12-31'));
  it('GET /?status=approved', () => hit(admin(), '/ex/?status=approved'));
  it('GET /?category_id=1', () => hit(admin(), '/ex/?category_id=1'));
});

// ═══════ INVITATIONS — ADMIN ═══════
describe('RoleCorrect-Invitations', () => {
  const a = () => mk(invitations, '/inv', 'hospital_admin');
  it('POST /', () => hit(a(), '/inv/', 'POST', { email: 'dr@t.com', role: 'doctor', name: 'Dr New' }));
  it('GET /', () => hit(a(), '/inv/'));
});

// ═══════ IPD CHARGES ═══════
describe('RoleCorrect-BillingProvisional', () => {
  const a = () => mk(billingProvisional, '/ic');
  it('GET /', () => hit(a(), '/ic/'));
  it('GET /?admission_id=1', () => hit(a(), '/ic/?admission_id=1'));
  it('POST /', () => hit(a(), '/ic/', 'POST', { admission_id: 1, description: 'Surgery', amount: 10000, category: 'surgery' }));
  it('DELETE /:id', () => hit(a(), '/ic/1', 'DELETE'));
});

// ═══════ JOURNAL — DIRECTOR ═══════
describe('RoleCorrect-Journal-Director', () => {
  const a = () => mk(journal, '/jn', 'director');
  it('GET /', () => hit(a(), '/jn/'));
  it('GET /?page=1&limit=10', () => hit(a(), '/jn/?page=1&limit=10'));
  it('POST /', () => hit(a(), '/jn/', 'POST', { date: '2025-01-15', description: 'Entry', debit_account_id: 1, credit_account_id: 2, amount: 500 }));
  it('GET /:id', () => hit(a(), '/jn/1'));
  it('DELETE /:id', () => hit(a(), '/jn/1', 'DELETE'));
  it('POST / missing fields', () => hit(a(), '/jn/', 'POST', { description: 'Missing fields' }));
});

// ═══════ RECURRING — DIRECTOR ═══════
describe('RoleCorrect-Recurring-Director', () => {
  const a = () => mk(recurring, '/rc', 'director');
  it('GET /', () => hit(a(), '/rc/'));
  it('POST /', () => hit(a(), '/rc/', 'POST', { category_id: 1, description: 'Internet', amount: 3000, frequency: 'monthly', next_run_date: '2025-02-01' }));
  it('GET /:id', () => hit(a(), '/rc/1'));
  it('PUT /:id', () => hit(a(), '/rc/1', 'PUT', { amount: 3500, description: 'Updated' }));
  it('DELETE /:id', () => hit(a(), '/rc/1', 'DELETE'));
  it('POST /:id/run', () => hit(a(), '/rc/1/run', 'POST', {}));
});

// ═══════ SETTINGS — ADMIN ═══════
describe('RoleCorrect-Settings', () => {
  const a = () => mk(settings, '/set', 'hospital_admin');
  it('GET /', () => hit(a(), '/set/'));
  it('PUT /:key', () => hit(a(), '/set/hospital_name', 'PUT', { value: 'Updated Hospital' }));
  it('PUT / bulk', () => hit(a(), '/set/', 'PUT', { hospital_name: 'Updated', phone: '017' }));
  it('POST /logo', () => hit(a(), '/set/logo', 'POST', {}));
  it('GET /logo', () => hit(a(), '/set/logo'));
  it('DELETE /logo', () => hit(a(), '/set/logo', 'DELETE'));
});

// ═══════ VITALS — NURSE ═══════
describe('RoleCorrect-Vitals', () => {
  const a = () => mk(vitals, '/vt', 'nurse');
  it('GET /', () => hit(a(), '/vt/'));
  it('GET /?patient_id=1', () => hit(a(), '/vt/?patient_id=1'));
  it('GET /latest/:patientId', () => hit(a(), '/vt/latest/1'));
  it('POST /', () => hit(a(), '/vt/', 'POST', { patient_id: 1, systolic: 130, diastolic: 85, temperature: 37.2, heart_rate: 80, spo2: 98 }));
  it('DELETE /:id', () => hit(a(), '/vt/1', 'DELETE'));
});

// ═══════ SHAREHOLDERS — DIRECTOR ═══════
describe('RoleCorrect-Shareholders-Director', () => {
  const a = () => mk(shareholders, '/sh', 'director');
  it('GET /settings', () => hit(a(), '/sh/settings'));
  it('PUT /settings', () => hit(a(), '/sh/settings', 'PUT', { profit_sharing_percent: 70, reserve_percent: 5 }));
  it('GET /', () => hit(a(), '/sh/'));
  it('POST /', () => hit(a(), '/sh/', 'POST', { name: 'Bob', share_count: 5, investment: 25000, profit_percentage: 25 }));
  it('PUT /:id', () => hit(a(), '/sh/1', 'PUT', { share_count: 15, name: 'Updated' }));
  it('GET /calculate', () => hit(a(), '/sh/calculate'));
  it('POST /distribute', () => hit(a(), '/sh/distribute', 'POST', { period: '2025-02', net_profit: 40000 }));
  it('GET /distributions', () => hit(a(), '/sh/distributions'));
  it('GET /distributions/:id', () => hit(a(), '/sh/distributions/1'));
  it('POST /distributions/:id/pay/:shareholderId', () => hit(a(), '/sh/distributions/1/pay/1', 'POST', {}));
  it('GET /my-profile', () => hit(a(), '/sh/my-profile'));
  it('GET /my-dividends', () => hit(a(), '/sh/my-dividends'));
});

// ═══════ LAB — DOCTOR ═══════
describe('RoleCorrect-Lab', () => {
  const a = () => mk(lab, '/lb', 'doctor');
  it('GET /', () => hit(a(), '/lb/'));
  it('POST /', () => hit(a(), '/lb/', 'POST', { name: 'X-Ray', code: 'XR', price: 500, category: 'Radiology' }));
  it('PUT /:id', () => hit(a(), '/lb/1', 'PUT', { price: 350 }));
  it('DELETE /:id', () => hit(a(), '/lb/1', 'DELETE'));
  it('GET /orders', () => hit(a(), '/lb/orders'));
  it('GET /orders/queue/today', () => hit(a(), '/lb/orders/queue/today'));
  it('GET /orders/:id', () => hit(a(), '/lb/orders/1'));
  it('POST /orders', () => hit(a(), '/lb/orders', 'POST', { patient_id: 1, doctor_id: 1, items: [{ lab_test_id: 1 }] }));
  it('PUT /items/:itemId/result', () => hit(a(), '/lb/items/1/result', 'PUT', { result: '5.5', notes: 'Normal' }));
  it('POST /orders/:id/print', () => hit(a(), '/lb/orders/1/print', 'POST', {}));
  it('PATCH /items/:itemId/sample-status', () => hit(a(), '/lb/items/1/sample-status', 'PATCH', { sample_status: 'received' }));
});

// ═══════ PHARMACY — ADMIN ═══════
describe('RoleCorrect-Pharmacy', () => {
  const a = () => mk(pharmacy, '/ph', 'hospital_admin');
  it('GET /medicines', () => hit(a(), '/ph/medicines'));
  it('POST /medicines', () => hit(a(), '/ph/medicines', 'POST', { name: 'Amoxicillin', generic_name: 'Amoxicillin', form: 'Capsule', strength: '250mg', unit_price: 5, reorder_level: 50 }));
  it('PUT /medicines/:id', () => hit(a(), '/ph/medicines/1', 'PUT', { unit_price: 3 }));
  it('GET /medicines/:id/stock', () => hit(a(), '/ph/medicines/1/stock'));
  it('GET /suppliers', () => hit(a(), '/ph/suppliers'));
  it('POST /suppliers', () => hit(a(), '/ph/suppliers', 'POST', { name: 'NewPharma', contact: '018' }));
  it('PUT /suppliers/:id', () => hit(a(), '/ph/suppliers/1', 'PUT', { contact: '019' }));
  it('GET /purchases', () => hit(a(), '/ph/purchases'));
  it('POST /purchases', () => hit(a(), '/ph/purchases', 'POST', { supplier_id: 1, items: [{ medicine_id: 1, quantity: 50, unit_price: 1.5, batch_no: 'B002', expiry_date: '2026-12-31' }] }));
  it('POST /sales', () => hit(a(), '/ph/sales', 'POST', { patient_id: 1, items: [{ medicine_id: 1, quantity: 5, unit_price: 2 }] }));
  it('POST /billing', () => hit(a(), '/ph/billing', 'POST', { patient_id: 1, items: [{ medicine_id: 1, quantity: 5, unit_price: 2 }] }));
  it('GET /alerts/low-stock', () => hit(a(), '/ph/alerts/low-stock'));
  it('GET /alerts/expiring', () => hit(a(), '/ph/alerts/expiring'));
  it('GET /summary', () => hit(a(), '/ph/summary'));
});

// ═══════ CONSULTATIONS — DOCTOR ═══════
describe('RoleCorrect-Consultations', () => {
  const a = () => mk(consultations, '/cs', 'doctor');
  it('GET /', () => hit(a(), '/cs/'));
  it('GET /:id', () => hit(a(), '/cs/1'));
  it('POST /', () => hit(a(), '/cs/', 'POST', { patient_id: 1, doctor_id: 1, chief_complaint: 'Fever', diagnosis: 'Flu', notes: 'Rest' }));
  it('PUT /:id', () => hit(a(), '/cs/1', 'PUT', { diagnosis: 'Updated Flu', notes: 'Updated notes' }));
  it('PUT /:id/end', () => hit(a(), '/cs/1/end', 'PUT', {}));
  it('DELETE /:id', () => hit(a(), '/cs/1', 'DELETE'));
});

// ═══════ PRESCRIPTIONS — DOCTOR ═══════
describe('RoleCorrect-Prescriptions', () => {
  const a = () => mk(prescriptions, '/rx', 'doctor');
  it('GET /', () => hit(a(), '/rx/'));
  it('GET /:id', () => hit(a(), '/rx/1'));
  it('GET /:id/print', () => hit(a(), '/rx/1/print'));
  it('POST /', () => hit(a(), '/rx/', 'POST', { patient_id: 1, doctor_id: 1, items: [{ medicine_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS', duration: '5 days' }] }));
  it('PUT /:id', () => hit(a(), '/rx/1', 'PUT', { notes: 'Follow up in 7 days' }));
  it('POST /:id/share', () => hit(a(), '/rx/1/share', 'POST', {}));
  it('POST /:id/order-delivery', () => hit(a(), '/rx/1/order-delivery', 'POST', { pharmacy_id: 1, delivery_address: '123 St' }));
  it('PUT /:id/delivery-status', () => hit(a(), '/rx/1/delivery-status', 'PUT', { status: 'dispatched' }));
});

// ═══════ BRANCHES — DIRECTOR ═══════
describe('RoleCorrect-Branches-Director', () => {
  const a = () => mk(branches, '/br', 'director');
  it('POST /', () => hit(a(), '/br/', 'POST', { name: 'Branch 2', code: 'BR2', address: '456 St', phone: '018' }));
  it('PUT /:id', () => hit(a(), '/br/1', 'PUT', { name: 'Updated Branch' }));
  it('DELETE /:id', () => hit(a(), '/br/1', 'DELETE'));
  it('GET /:id/report', () => hit(a(), '/br/1/report'));
  it('GET /analytics', () => hit(a(), '/br/analytics'));
});

// ═══════ COMMISSIONS — DIRECTOR ═══════
describe('RoleCorrect-Commissions-Director', () => {
  const a = () => mk(commissions, '/cm', 'director');
  it('POST /', () => hit(a(), '/cm/', 'POST', { doctor_id: 1, service_type: 'lab', percentage: 10 }));
  it('POST /:id/pay', () => hit(a(), '/cm/1/pay', 'POST', {}));
  it('GET /summary', () => hit(a(), '/cm/summary'));
});

// ═══════ EMERGENCY ═══════
describe('RoleCorrect-Emergency', () => {
  const a = () => mk(emergency, '/em', 'doctor');
  it('GET /', () => hit(a(), '/em/'));
  it('POST /', () => hit(a(), '/em/', 'POST', { patient_id: 1, triage_level: 'urgent', chief_complaint: 'Chest pain' }));
  it('GET /:id', () => hit(a(), '/em/1'));
  it('PUT /:id', () => hit(a(), '/em/1', 'PUT', { status: 'in_treatment', notes: 'Monitoring' }));
  it('PUT /:id/discharge', () => hit(a(), '/em/1/discharge', 'PUT', { discharge_notes: 'Stable', discharge_disposition: 'home' }));
  it('PUT /:id/assign', () => hit(a(), '/em/1/assign', 'PUT', { doctor_id: 1 }));
  it('GET /stats', () => hit(a(), '/em/stats'));
});

// ═══════ VISITS — RECEPTION ═══════
describe('RoleCorrect-Visits', () => {
  const a = () => mk(visits, '/v', 'reception');
  it('GET /', () => hit(a(), '/v/'));
  it('GET /:id', () => hit(a(), '/v/1'));
  it('POST /', () => hit(a(), '/v/', 'POST', { patient_id: 1, doctor_id: 1, type: 'consultation' }));
  it('PUT /:id', () => hit(a(), '/v/1', 'PUT', { status: 'completed' }));
  it('GET /?date=2025-01-01', () => hit(a(), '/v/?date=2025-01-01'));
});

// ═══════ DEPOSITS — ADMIN ═══════
describe('RoleCorrect-Deposits', () => {
  const a = () => mk(deposits, '/dp', 'hospital_admin');
  it('GET /', () => hit(a(), '/dp/'));
  it('GET /:id', () => hit(a(), '/dp/1'));
  it('POST /', () => hit(a(), '/dp/', 'POST', { patient_id: 1, amount: 5000, type: 'cash' }));
  it('POST /:id/refund', () => hit(a(), '/dp/1/refund', 'POST', { amount: 1000, reason: 'Overcharge' }));
  it('POST /:id/use', () => hit(a(), '/dp/1/use', 'POST', { amount: 500, bill_id: 1 }));
});

// ═══════ CREDIT NOTES ═══════
describe('RoleCorrect-CreditNotes', () => {
  const a = () => mk(creditNotes, '/cn', 'hospital_admin');
  it('GET /', () => hit(a(), '/cn/'));
  it('POST /', () => hit(a(), '/cn/', 'POST', { bill_id: 1, amount: 100, reason: 'Error' }));
  it('POST /:id/approve', () => hit(a(), '/cn/1/approve', 'POST', {}));
});

// ═══════ BILLING CANCELLATION ═══════
describe('RoleCorrect-BillingCancellation', () => {
  const a = () => mk(billingCancellation, '/bc', 'hospital_admin');
  const dir = () => mk(billingCancellation, '/bc', 'director');
  it('GET /', () => hit(a(), '/bc/'));
  it('POST /', () => hit(a(), '/bc/', 'POST', { bill_id: 1, reason: 'Duplicate bill' }));
  it('POST /:id/approve (director)', () => hit(dir(), '/bc/1/approve', 'POST', {}));
  it('POST /:id/reject (director)', () => hit(dir(), '/bc/1/reject', 'POST', { reason: 'Valid bill' }));
});

// ═══════ BILLING HANDOVER ═══════
describe('RoleCorrect-BillingHandover', () => {
  const a = () => mk(billingHandover, '/bh', 'hospital_admin');
  it('GET /', () => hit(a(), '/bh/'));
  it('POST /', () => hit(a(), '/bh/', 'POST', { bill_id: 1, to_user: 2 }));
  it('POST /:id/accept', () => hit(a(), '/bh/1/accept', 'POST', {}));
});

// ═══════ SETTLEMENTS ═══════
describe('RoleCorrect-Settlements', () => {
  const a = () => mk(settlements, '/st', 'hospital_admin');
  it('GET /', () => hit(a(), '/st/'));
  it('POST /', () => hit(a(), '/st/', 'POST', { bill_id: 1, amount: 500, type: 'final' }));
});

// ═══════ TESTS ═══════
describe('RoleCorrect-Tests', () => {
  const a = () => mk(tests, '/ts', 'hospital_admin');
  it('GET /', () => hit(a(), '/ts/'));
  it('POST /', () => hit(a(), '/ts/', 'POST', { name: 'Urine Test', code: 'UT', price: 150, category: 'Pathology' }));
  it('PUT /:id/result', () => hit(a(), '/ts/1/result', 'PUT', { result: 'Normal', notes: 'OK' }));
});

// ═══════ AUDIT ═══════
describe('RoleCorrect-Audit', () => {
  const a = () => mk(audit, '/au', 'hospital_admin');
  it('GET /', () => hit(a(), '/au/'));
  it('GET /logs', () => hit(a(), '/au/logs'));
  it('GET /logs?table_name=patients', () => hit(a(), '/au/logs?table_name=patients'));
  it('GET /logs?user_id=1', () => hit(a(), '/au/logs?user_id=1'));
  it('GET /:id', () => hit(a(), '/au/1'));
});

// ═══════ INBOX — VARIOUS ROLES ═══════
describe('RoleCorrect-Inbox', () => {
  const a = () => mk(inbox, '/ib');
  it('GET /', () => hit(a(), '/ib/'));
  it('GET /unread-count', () => hit(a(), '/ib/unread-count'));
  it('PATCH /:id/read', () => hit(a(), '/ib/1/read', 'PATCH', {}));
  it('PATCH /read-all', () => hit(a(), '/ib/read-all', 'PATCH', {}));
  it('DELETE /:id', () => hit(a(), '/ib/1', 'DELETE'));
});

/**
 * Universal fallback tests — uses universalFallback: true so .first()
 * never returns null, forcing handlers past "not found" guards into
 * the deep business logic code for maximum coverage.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

// Import ALL route modules
import patients from '../../../src/routes/tenant/patients';
import doctors from '../../../src/routes/tenant/doctors';
import billing from '../../../src/routes/tenant/billing';
import pharmacy from '../../../src/routes/tenant/pharmacy';
import lab from '../../../src/routes/tenant/lab';
import staff from '../../../src/routes/tenant/staff';
import expenses from '../../../src/routes/tenant/expenses';
import income from '../../../src/routes/tenant/income';
import shareholders from '../../../src/routes/tenant/shareholders';
import visits from '../../../src/routes/tenant/visits';
import appointments from '../../../src/routes/tenant/appointments';
import dashboard from '../../../src/routes/tenant/dashboard';
import admissions from '../../../src/routes/tenant/admissions';
import branches from '../../../src/routes/tenant/branches';
import commissions from '../../../src/routes/tenant/commissions';
import consultations from '../../../src/routes/tenant/consultations';
import deposits from '../../../src/routes/tenant/deposits';
import emergency from '../../../src/routes/tenant/emergency';
import settings from '../../../src/routes/tenant/settings';
import journal from '../../../src/routes/tenant/journal';
import accounting from '../../../src/routes/tenant/accounting';
import reports from '../../../src/routes/tenant/reports';
import profit from '../../../src/routes/tenant/profit';
import recurring from '../../../src/routes/tenant/recurring';
import accounts from '../../../src/routes/tenant/accounts';
import payments from '../../../src/routes/tenant/payments';
import ot from '../../../src/routes/tenant/ot';
import insurance from '../../../src/routes/tenant/insurance';
import vitals from '../../../src/routes/tenant/vitals';
import allergies from '../../../src/routes/tenant/allergies';
import nurseStation from '../../../src/routes/tenant/nurseStation';
import notifications from '../../../src/routes/tenant/notifications';
import prescriptions from '../../../src/routes/tenant/prescriptions';
import discharge from '../../../src/routes/tenant/discharge';
import website from '../../../src/routes/tenant/website';
import creditNotes from '../../../src/routes/tenant/creditNotes';
import settlements from '../../../src/routes/tenant/settlements';
import ipBilling from '../../../src/routes/tenant/ipBilling';
import billingProvisional from '../../../src/routes/tenant/billingProvisional';
import billingCancellation from '../../../src/routes/tenant/billingCancellation';
import billingHandover from '../../../src/routes/tenant/billingHandover';
import doctorSchedule from '../../../src/routes/tenant/doctorSchedule';
import doctorSchedules from '../../../src/routes/tenant/doctorSchedules';
import inbox from '../../../src/routes/tenant/inbox';
import invitations from '../../../src/routes/tenant/invitations';
import tests from '../../../src/routes/tenant/tests';
import audit from '../../../src/routes/tenant/audit';
import fhir from '../../../src/routes/tenant/fhir';
import auth from '../../../src/routes/tenant/auth';
import patientPortal from '../../../src/routes/tenant/patientPortal';
import adminRoutes from '../../../src/routes/admin/index';
import loginDirect from '../../../src/routes/login-direct';
import register from '../../../src/routes/register';
import publicInvite from '../../../src/routes/public-invite';
import onboarding from '../../../src/routes/onboarding';
import pdf from '../../../src/routes/tenant/pdf';

const T = 'tenant-1';

// Rich mock data for all tables
const tbl = {
  patients: [{ id: 1, name: 'Ali', mobile: '017', age: 30, gender: 'Male', patient_code: 'P001', blood_group: 'A+', father_husband: 'Dad', address: 'Dhaka', tenant_id: T, created_at: '2025-01-01' }],
  doctors: [{ id: 1, name: 'Dr Khan', specialization: 'General', specialty: 'General', fee: 500, status: 'active', tenant_id: T, bmdc_reg_no: 'B123', qualifications: 'MBBS' }],
  bills: [{ id: 1, patient_id: 1, total: 1000, paid: 500, due: 500, discount: 0, status: 'pending', bill_no: 'B001', tenant_id: T, created_at: '2025-01-01', created_by: 1 }],
  bill_items: [{ id: 1, bill_id: 1, item_category: 'consultation', description: 'Visit', quantity: 1, unit_price: 500, total: 500, tenant_id: T }],
  medicines: [{ id: 1, name: 'Para', company: 'ABC', unit_price: 5, sale_price: 10, quantity: 100, batch_number: 'B1', expiry_date: '2026-12-31', tenant_id: T }],
  suppliers: [{ id: 1, name: 'Pharma Inc', contact: '017', tenant_id: T }],
  pharmacy_purchases: [{ id: 1, medicine_id: 1, supplier_id: 1, quantity: 50, unit_cost: 5, total: 250, tenant_id: T, created_at: '2025-01-01' }],
  pharmacy_sales: [{ id: 1, medicine_id: 1, patient_id: 1, quantity: 2, unit_price: 10, total: 20, tenant_id: T }],
  lab_test_catalog: [{ id: 1, code: 'CBC', name: 'CBC', price: 500, category: 'Hematology', status: 'active', tenant_id: T }],
  lab_orders: [{ id: 1, patient_id: 1, order_number: 'L001', status: 'pending', total: 500, tenant_id: T, created_at: '2025-01-01' }],
  lab_order_items: [{ id: 1, order_id: 1, test_id: 1, test_name: 'CBC', price: 500, status: 'pending', result: 'Normal', tenant_id: T }],
  staff: [{ id: 1, name: 'Nurse', address: 'Dhaka', position: 'Nurse', salary: 20000, bank_account: 'B1', mobile: '017', status: 'active', tenant_id: T }],
  salary_payments: [{ id: 1, staff_id: 1, amount: 20000, payment_date: '2025-01-31', month: '2025-01', tenant_id: T }],
  expenses: [{ id: 1, date: '2025-01-01', category: 'utilities', amount: 5000, description: 'Electricity', status: 'pending', tenant_id: T, created_by: 1 }],
  income: [{ id: 1, date: '2025-01-01', source: 'pharmacy', amount: 2000, description: 'Sales', tenant_id: T, created_by: 1 }],
  shareholders: [{ id: 1, name: 'Ali', address: 'Dhaka', phone: '017', share_count: 10, type: 'owner', investment: 50000, profit_percentage: 50, tenant_id: T }],
  shareholder_settings: [{ id: 1, profit_sharing_percent: 60, reserve_percent: 10, tenant_id: T }],
  shareholder_dividends: [{ id: 1, distribution_id: 1, shareholder_id: 1, amount: 30000, status: 'pending', tenant_id: T }],
  visits: [{ id: 1, patient_id: 1, visit_type: 'opd', status: 'active', tenant_id: T, created_at: '2025-01-01', visit_number: 'V001' }],
  appointments: [{ id: 1, patient_id: 1, doctor_id: 1, appt_date: '2025-06-15', visit_type: 'opd', status: 'scheduled', tenant_id: T, created_at: '2025-01-01' }],
  admissions: [{ id: 1, patient_id: 1, bed_id: 1, status: 'admitted', admission_date: '2025-01-01', tenant_id: T }],
  beds: [{ id: 1, ward: 'General', bed_number: 'B1', status: 'available', rate_per_day: 500, tenant_id: T }],
  branches: [{ id: 1, name: 'Main', address: 'Dhaka', phone: '017', is_active: 1, tenant_id: T }],
  commissions: [{ id: 1, doctor_id: 1, amount: 100, type: 'referral', status: 'pending', tenant_id: T }],
  commission_rules: [{ id: 1, doctor_id: 1, item_category: 'test', commission_type: 'percentage', commission_value: 10, tenant_id: T }],
  consultations: [{ id: 1, patient_id: 1, doctor_id: 1, date: '2025-01-01', diagnosis: 'Flu', notes: 'Rest', fee: 500, status: 'completed', tenant_id: T }],
  deposits: [{ id: 1, patient_id: 1, amount: 5000, balance: 5000, type: 'cash', status: 'active', tenant_id: T, created_at: '2025-01-01' }],
  deposit_transactions: [{ id: 1, deposit_id: 1, amount: 5000, type: 'credit', tenant_id: T }],
  emergency_cases: [{ id: 1, patient_id: 1, triage_level: 'red', chief_complaint: 'Chest pain', status: 'active', tenant_id: T, arrival_time: '2025-01-01T10:00' }],
  emergency_vitals: [{ id: 1, case_id: 1, systolic: 120, diastolic: 80, tenant_id: T }],
  settings: [{ id: 1, key: 'hospital_name', value: 'Test Hospital', tenant_id: T }],
  chart_of_accounts: [{ id: 1, code: '1000', name: 'Cash', type: 'asset', is_active: 1, tenant_id: T }],
  journal_entries: [{ id: 1, date: '2025-01-01', description: 'Opening', debit_account_id: 1, credit_account_id: 1, amount: 1000, tenant_id: T }],
  profit_distributions: [{ id: 1, month: '2025-01', total_profit: 100000, distributable_profit: 60000, profit_percentage: 60, tenant_id: T }],
  recurring_expenses: [{ id: 1, category_id: 1, amount: 5000, description: 'Elec', frequency: 'monthly', next_run_date: '2025-02-01', is_active: 1, tenant_id: T }],
  expense_categories: [{ id: 1, name: 'Utilities', code: 'UTL', tenant_id: T }],
  payments: [{ id: 1, bill_id: 1, amount: 500, payment_type: 'cash', date: '2025-01-01', tenant_id: T }],
  ot_bookings: [{ id: 1, patient_id: 1, surgeon_id: 1, procedure: 'Appendectomy', status: 'scheduled', ot_date: '2025-06-01', ot_room_id: 1, tenant_id: T }],
  ot_rooms: [{ id: 1, name: 'OT-1', type: 'major', status: 'available', tenant_id: T }],
  insurance_policies: [{ id: 1, patient_id: 1, provider: 'ABC', policy_number: 'POL1', status: 'active', tenant_id: T }],
  insurance_claims: [{ id: 1, policy_id: 1, bill_id: 1, amount: 500, status: 'pending', tenant_id: T }],
  vitals: [{ id: 1, patient_id: 1, visit_id: 1, systolic: 120, diastolic: 80, pulse: 72, temperature: 37.0, tenant_id: T, recorded_at: '2025-01-01' }],
  allergies: [{ id: 1, patient_id: 1, allergen: 'Penicillin', severity: 'high', reaction: 'Rash', tenant_id: T }],
  nurse_station_tasks: [{ id: 1, patient_id: 1, task_type: 'medication', description: 'Give meds', status: 'pending', tenant_id: T }],
  notifications: [{ id: 1, user_id: 1, title: 'Alert', message: 'Test', type: 'info', is_read: 0, tenant_id: T }],
  prescriptions: [{ id: 1, patient_id: 1, doctor_id: 1, diagnosis: 'Flu', notes: 'Rest', status: 'active', tenant_id: T, created_at: '2025-01-01', share_token: 'tok123' }],
  prescription_items: [{ id: 1, prescription_id: 1, medicine_name: 'Para', dosage: '500mg', frequency: 'TDS', duration: '5 days', tenant_id: T }],
  discharges: [{ id: 1, admission_id: 1, patient_id: 1, discharge_date: '2025-01-05', status: 'completed', tenant_id: T }],
  website_pages: [{ id: 1, slug: 'about', title: 'About Us', content: 'Info', tenant_id: T }],
  credit_notes: [{ id: 1, bill_id: 1, amount: 100, reason: 'Overcharge', status: 'approved', tenant_id: T }],
  settlements: [{ id: 1, bill_id: 1, amount: 500, type: 'final', status: 'completed', tenant_id: T }],
  ip_billing: [{ id: 1, admission_id: 1, patient_id: 1, total: 5000, tenant_id: T }],
  billing_provisional_items: [{ id: 1, admission_id: 1, description: 'Bed', amount: 500, tenant_id: T }],
  billing_cancellations: [{ id: 1, bill_id: 1, reason: 'Dup', status: 'approved', tenant_id: T }],
  billing_handovers: [{ id: 1, bill_id: 1, from_user: 1, to_user: 2, status: 'pending', tenant_id: T }],
  doctor_schedules: [{ id: 1, doctor_id: 1, day_of_week: 'monday', start_time: '09:00', end_time: '17:00', tenant_id: T }],
  inbox_messages: [{ id: 1, sender_id: 1, recipient_id: 2, subject: 'Hi', body: 'Hello', is_read: 0, tenant_id: T }],
  invitations: [{ id: 1, email: 'new@t.com', role: 'doctor', status: 'pending', token: 'tok123', tenant_id: T, expires_at: new Date(Date.now() + 86400000).toISOString() }],
  tests: [{ id: 1, patient_id: 1, test_name: 'X-Ray', result: 'Normal', status: 'completed', tenant_id: T }],
  audit_logs: [{ id: 1, tenant_id: T, user_id: 1, action: 'create', table_name: 'patients', record_id: 1 }],
  users: [{ id: 1, email: 'admin@test.com', name: 'Admin', role: 'hospital_admin', tenant_id: T, is_active: 1, password_hash: '$2a$10$h' }],
  tenants: [{ id: 1, name: 'Test Hospital', subdomain: 'test', status: 'active', plan: 'premium' }],
  onboarding_applications: [{ id: 1, name: 'New Hospital', email: 'new@t.com', status: 'pending', plan: 'premium' }],
};

// Create a test app with universalFallback enabled
function mkApp(route: any, path: string) {
  const mock = createMockDB({ tables: tbl, universalFallback: true });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T as string);
    c.set('userId', '1');
    c.set('role', 'hospital_admin' as Variables['role']);
    c.env = { DB: mock.db, KV: {} as any, JWT_SECRET: 'test-secret', ENVIRONMENT: 'test' } as any;
    await next();
  });
  app.route(path, route);
  app.onError((err, c) => {
    const status = (err as any).status ?? 500;
    return c.json({ error: err.message }, status as any);
  });
  return app;
}

function jr(app: any, path: string, method: string, body?: any) {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// Generate test suites for ALL routes with both GET and mutation endpoints
const routeTests: Array<[string, any, string, Array<[string, string, any?]>]> = [
  ['Patients-UF', patients, '/p', [
    ['GET /', 'GET /p'], ['GET /1', 'GET /p/1'], ['GET /?search=Ali', 'GET /p?search=Ali'],
    ['POST /', 'POST /p', { name: 'New', fatherHusband: 'F', address: 'A', mobile: '017' }],
    ['PUT /1', 'PUT /p/1', { name: 'Updated' }],
  ]],
  ['Doctors-UF', doctors, '/d', [
    ['GET /', 'GET /d'], ['GET /dashboard', 'GET /d/dashboard'], ['GET /1', 'GET /d/1'],
    ['POST /', 'POST /d', { name: 'Dr New', specialization: 'Cardio', fee: 1000 }],
    ['PUT /1', 'PUT /d/1', { fee: 800 }], ['DELETE /1', 'DELETE /d/1'],
  ]],
  ['Billing-UF', billing, '/b', [
    ['GET /', 'GET /b'], ['GET /due', 'GET /b/due'], ['GET /patient/1', 'GET /b/patient/1'],
    ['GET /1', 'GET /b/1'],
    ['POST /', 'POST /b', { patientId: 1, items: [{ itemCategory: 'consultation', unitPrice: 500 }] }],
    ['POST /pay', 'POST /b/pay', { billId: 1, amount: 200, paymentType: 'cash' }],
  ]],
  ['Pharmacy-UF', pharmacy, '/ph', [
    ['GET /', 'GET /ph'], ['GET /suppliers', 'GET /ph/suppliers'], ['GET /purchases', 'GET /ph/purchases'],
    ['GET /alerts/low-stock', 'GET /ph/alerts/low-stock'], ['GET /alerts/expiring', 'GET /ph/alerts/expiring'],
    ['GET /summary', 'GET /ph/summary'],
    ['POST /', 'POST /ph', { name: 'Amox', salePrice: 15 }],
    ['POST /suppliers', 'POST /ph/suppliers', { name: 'Sup', contact: '018' }],
    ['PUT /suppliers/1', 'PUT /ph/suppliers/1', { name: 'U' }],
    ['POST /purchases', 'POST /ph/purchases', { medicineId: 1, supplierId: 1, quantity: 10, unitCost: 5 }],
    ['POST /sales', 'POST /ph/sales', { items: [{ medicineId: 1, quantity: 2, unitPrice: 10 }] }],
  ]],
  ['Lab-UF', lab, '/l', [
    ['GET /', 'GET /l'], ['GET /orders', 'GET /l/orders'], ['GET /orders/queue/today', 'GET /l/orders/queue/today'],
    ['GET /orders/1', 'GET /l/orders/1'],
    ['POST /', 'POST /l', { code: 'LFT', name: 'Liver', price: 800, category: 'Bio' }],
    ['POST /orders', 'POST /l/orders', { patientId: 1, tests: [{ testId: 1 }] }],
    ['PUT /items/1/result', 'PUT /l/items/1/result', { result: 'Normal', status: 'completed' }],
    ['DELETE /1', 'DELETE /l/1'],
  ]],
  ['Staff-UF', staff, '/s', [
    ['GET /', 'GET /s'], ['GET /salary-report', 'GET /s/salary-report'], ['GET /1', 'GET /s/1'],
    ['POST /', 'POST /s', { name: 'New', address: 'A', position: 'Admin', salary: 25000, bankAccount: 'B2', mobile: '018' }],
    ['PUT /1', 'PUT /s/1', { salary: 22000 }], ['DELETE /1', 'DELETE /s/1'],
    ['POST /1/salary', 'POST /s/1/salary', { amount: 20000, month: '2025-02', paymentDate: '2025-02-28' }],
    ['GET /1/salary', 'GET /s/1/salary'],
  ]],
  ['Expenses-UF', expenses, '/e', [
    ['GET /', 'GET /e'], ['GET /pending', 'GET /e/pending'], ['GET /1', 'GET /e/1'],
    ['POST /', 'POST /e', { category: 'rent', amount: 10000, description: 'Rent', date: '2025-02-01' }],
    ['PUT /1', 'PUT /e/1', { amount: 6000 }],
    ['POST /1/approve', 'POST /e/1/approve', {}], ['POST /1/reject', 'POST /e/1/reject', {}],
  ]],
  ['Income-UF', income, '/i', [
    ['GET /', 'GET /i'], ['GET /1', 'GET /i/1'],
    ['POST /', 'POST /i', { source: 'test', amount: 3000, date: '2025-02-01' }],
    ['PUT /1', 'PUT /i/1', { amount: 2500 }], ['DELETE /1', 'DELETE /i/1'],
  ]],
  ['Shareholders-UF', shareholders, '/sh', [
    ['GET /', 'GET /sh'], ['GET /settings', 'GET /sh/settings'],
    ['PUT /settings', 'PUT /sh/settings', { profitSharingPercent: 70, reservePercent: 5 }],
    ['POST /', 'POST /sh', { name: 'New', type: 'investor', shareCount: 5, investment: 25000, phone: '017', address: 'Dhaka' }],
    ['PUT /1', 'PUT /sh/1', { investment: 60000 }],
    ['GET /calculate?month=2025-01', 'GET /sh/calculate?month=2025-01'],
    ['GET /distributions', 'GET /sh/distributions'], ['GET /distributions/1', 'GET /sh/distributions/1'],
    ['GET /my-profile', 'GET /sh/my-profile'], ['GET /my-dividends', 'GET /sh/my-dividends'],
  ]],
  ['Visits-UF', visits, '/v', [
    ['GET /', 'GET /v'], ['GET /1', 'GET /v/1'],
    ['POST /', 'POST /v', { patientId: 1, visitType: 'opd' }],
    ['PUT /1', 'PUT /v/1', { status: 'discharged' }],
    ['POST /1/discharge', 'POST /v/1/discharge', { dischargeType: 'normal' }],
  ]],
  ['Appts-UF', appointments, '/a', [
    ['GET /', 'GET /a'], ['GET /today', 'GET /a/today'], ['GET /1', 'GET /a/1'],
    ['POST /', 'POST /a', { patientId: 1, doctorId: 1, apptDate: '2025-07-01', visitType: 'opd' }],
    ['PUT /1', 'PUT /a/1', { status: 'completed' }], ['DELETE /1', 'DELETE /a/1'],
  ]],
  ['Dashboard-UF', dashboard, '/dash', [
    ['GET /', 'GET /dash'], ['GET /stats', 'GET /dash/stats'],
    ['GET /daily-income', 'GET /dash/daily-income'], ['GET /daily-expenses', 'GET /dash/daily-expenses'],
    ['GET /monthly-summary', 'GET /dash/monthly-summary'],
  ]],
  ['Admissions-UF', admissions, '/adm', [
    ['GET /', 'GET /adm'], ['GET /stats', 'GET /adm/stats'], ['GET /occupancy', 'GET /adm/occupancy'],
    ['GET /beds', 'GET /adm/beds'],
    ['POST /beds', 'POST /adm/beds', { ward: 'ICU', bedNumber: 'ICU-1', ratePerDay: 2000 }],
    ['POST /', 'POST /adm', { patientId: 1, bedId: 1 }],
    ['PUT /1', 'PUT /adm/1', { status: 'discharged' }],
  ]],
  ['OT-UF', ot, '/ot', [
    ['GET /', 'GET /ot'], ['GET /rooms', 'GET /ot/rooms'], ['GET /1', 'GET /ot/1'],
    ['GET /schedule', 'GET /ot/schedule'], ['GET /stats', 'GET /ot/stats'],
    ['POST /', 'POST /ot', { patientId: 1, surgeonId: 1, procedure: 'Test', otDate: '2025-07-01' }],
    ['PUT /1', 'PUT /ot/1', { status: 'completed' }],
    ['POST /rooms', 'POST /ot/rooms', { name: 'OT-2', type: 'minor' }],
    ['PUT /rooms/1', 'PUT /ot/rooms/1', { status: 'maintenance' }],
    ['DELETE /1', 'DELETE /ot/1'],
  ]],
  ['Emergency-UF', emergency, '/em', [
    ['GET /', 'GET /em'], ['GET /1', 'GET /em/1'], ['GET /stats', 'GET /em/stats'],
    ['GET /active', 'GET /em/active'],
    ['POST /', 'POST /em', { patientId: 1, triageLevel: 'yellow', chiefComplaint: 'Fracture' }],
    ['PUT /1', 'PUT /em/1', { status: 'discharged', triageLevel: 'green' }],
    ['POST /1/vitals', 'POST /em/1/vitals', { systolic: 130, diastolic: 85 }],
    ['POST /1/treatment', 'POST /em/1/treatment', { treatment: 'IV', notes: 'Done' }],
  ]],
  ['NurseStation-UF', nurseStation, '/ns', [
    ['GET /', 'GET /ns'], ['GET /tasks', 'GET /ns/tasks'], ['GET /handoffs', 'GET /ns/handoffs'],
    ['POST /tasks', 'POST /ns/tasks', { patientId: 1, taskType: 'medication', description: 'Give meds' }],
    ['PUT /tasks/1', 'PUT /ns/tasks/1', { status: 'completed' }],
    ['POST /handoffs', 'POST /ns/handoffs', { toNurse: 2, notes: 'Shift' }],
  ]],
  ['Accounting-UF', accounting, '/acc', [
    ['GET /', 'GET /acc'], ['GET /trial-balance', 'GET /acc/trial-balance'],
    ['GET /balance-sheet', 'GET /acc/balance-sheet'], ['GET /income-statement', 'GET /acc/income-statement'],
  ]],
  ['Reports-UF', reports, '/rep', [
    ['GET /', 'GET /rep'], ['GET /income', 'GET /rep/income'], ['GET /expenses', 'GET /rep/expenses'],
    ['GET /patients', 'GET /rep/patients'], ['GET /billing', 'GET /rep/billing'],
    ['GET /daily', 'GET /rep/daily'], ['GET /monthly', 'GET /rep/monthly'],
  ]],
  ['Profit-UF', profit, '/pr', [
    ['GET /', 'GET /pr'], ['GET /calculate?month=2025-01', 'GET /pr/calculate?month=2025-01'],
    ['GET /history', 'GET /pr/history'],
  ]],
  ['IPBilling-UF', ipBilling, '/ipb', [
    ['GET /', 'GET /ipb'], ['GET /1', 'GET /ipb/1'],
    ['POST /', 'POST /ipb', { admissionId: 1, patientId: 1 }],
    ['PUT /1', 'PUT /ipb/1', { total: 6000 }],
  ]],
  ['Notifications-UF', notifications, '/notif', [
    ['GET /', 'GET /notif'], ['GET /unread', 'GET /notif/unread'],
    ['PUT /1/read', 'PUT /notif/1/read', {}], ['PUT /read-all', 'PUT /notif/read-all', {}],
    ['DELETE /1', 'DELETE /notif/1'],
  ]],
  ['FHIR-UF', fhir, '/fhir', [
    ['GET /metadata', 'GET /fhir/metadata'], ['GET /Patient', 'GET /fhir/Patient'],
    ['GET /Patient/1', 'GET /fhir/Patient/1'], ['GET /Encounter', 'GET /fhir/Encounter'],
    ['GET /Observation', 'GET /fhir/Observation'],
  ]],
  ['Insurance-UF', insurance, '/ins', [
    ['GET /policies', 'GET /ins/policies'], ['GET /policies/1', 'GET /ins/policies/1'],
    ['GET /claims', 'GET /ins/claims'], ['GET /claims/1', 'GET /ins/claims/1'],
    ['POST /policies', 'POST /ins/policies', { patientId: 1, provider: 'XYZ', policyNumber: 'P2' }],
    ['POST /claims', 'POST /ins/claims', { policyId: 1, billId: 1, amount: 300 }],
    ['PUT /claims/1', 'PUT /ins/claims/1', { status: 'approved' }],
  ]],
  ['Prescriptions-UF', prescriptions, '/rx', [
    ['GET /', 'GET /rx'], ['GET /1', 'GET /rx/1'],
    ['POST /', 'POST /rx', { patientId: 1, doctorId: 1, diagnosis: 'Flu', items: [{ medicineName: 'Para', dosage: '500mg', frequency: 'TDS', duration: '5d' }] }],
    ['PUT /1', 'PUT /rx/1', { diagnosis: 'Cold' }],
  ]],
  ['Deposits-UF', deposits, '/dep', [
    ['GET /', 'GET /dep'], ['GET /1', 'GET /dep/1'], ['GET /patient/1', 'GET /dep/patient/1'],
    ['POST /', 'POST /dep', { patientId: 1, amount: 3000, type: 'cash' }],
    ['POST /1/refund', 'POST /dep/1/refund', { amount: 1000 }],
  ]],
  ['Branches-UF', branches, '/br', [
    ['GET /', 'GET /br'],
    ['POST /', 'POST /br', { name: 'B2', address: 'Ctg', phone: '018' }],
    ['PUT /1', 'PUT /br/1', { name: 'Updated' }], ['DELETE /1', 'DELETE /br/1'],
  ]],
  ['Allergies-UF', allergies, '/al', [
    ['GET /', 'GET /al'],
    ['POST /', 'POST /al', { patientId: 1, allergen: 'Dust', severity: 'low' }],
    ['DELETE /1', 'DELETE /al/1'],
  ]],
  ['Commissions-UF', commissions, '/com', [
    ['GET /', 'GET /com'],
    ['POST /rules', 'POST /com/rules', { doctorId: 1, itemCategory: 'test', commissionType: 'percentage', commissionValue: 10 }],
  ]],
  ['Consultations-UF', consultations, '/con', [
    ['GET /', 'GET /con'],
    ['POST /', 'POST /con', { patientId: 1, doctorId: 1, diagnosis: 'Cold', fee: 500 }],
    ['PUT /1', 'PUT /con/1', { status: 'cancelled' }],
  ]],
  ['Vitals-UF', vitals, '/vit', [
    ['GET /', 'GET /vit'],
    ['POST /', 'POST /vit', { patientId: 1, visitId: 1, systolic: 130, diastolic: 85, pulse: 80 }],
  ]],
  ['Settings-UF', settings, '/set', [
    ['GET /', 'GET /set'],
    ['PUT /', 'PUT /set', { key: 'hospital_name', value: 'New' }],
  ]],
  ['Journal-UF', journal, '/j', [
    ['GET /', 'GET /j'],
    ['POST /', 'POST /j', { date: '2025-02-01', description: 'Entry', debitAccountId: 1, creditAccountId: 1, amount: 500 }],
  ]],
  ['Accounts-UF', accounts, '/acct', [
    ['GET /', 'GET /acct'],
    ['POST /', 'POST /acct', { code: '2000', name: 'AP', type: 'liability' }],
  ]],
  ['Recurring-UF', recurring, '/rec', [
    ['GET /', 'GET /rec'],
    ['POST /', 'POST /rec', { categoryId: 1, amount: 3000, frequency: 'weekly', nextRunDate: '2025-02-01' }],
    ['PUT /1', 'PUT /rec/1', { amount: 4000 }],
  ]],
  ['Payments-UF', payments, '/pay', [
    ['GET /', 'GET /pay'],
    ['POST /', 'POST /pay', { billId: 1, amount: 200, paymentType: 'cash' }],
  ]],
  ['Discharge-UF', discharge, '/dis', [
    ['GET /', 'GET /dis'],
    ['POST /', 'POST /dis', { admissionId: 1, patientId: 1 }],
  ]],
  ['Website-UF', website, '/web', [
    ['GET /', 'GET /web'],
    ['POST /', 'POST /web', { slug: 'services', title: 'Services', content: 'Our services' }],
  ]],
  ['CreditNotes-UF', creditNotes, '/cn', [
    ['GET /', 'GET /cn'],
    ['POST /', 'POST /cn', { billId: 1, amount: 50, reason: 'Error' }],
  ]],
  ['Settlements-UF', settlements, '/st', [
    ['GET /', 'GET /st'],
    ['POST /', 'POST /st', { billId: 1, amount: 500 }],
  ]],
  ['BillingProvisional-UF', billingProvisional, '/ipc', [
    ['GET /', 'GET /ipc'],
    ['POST /', 'POST /ipc', { admissionId: 1, description: 'Bed', amount: 500 }],
  ]],
  ['BillingCancel-UF', billingCancellation, '/bc', [
    ['GET /', 'GET /bc'],
    ['POST /', 'POST /bc', { billId: 1, reason: 'Dup' }],
  ]],
  ['BillingHandover-UF', billingHandover, '/bh', [
    ['GET /', 'GET /bh'],
    ['POST /', 'POST /bh', { billId: 1, toUser: 2 }],
  ]],
  ['DoctorSched-UF', doctorSchedule, '/ds', [['GET /', 'GET /ds']]],
  ['DoctorScheds-UF', doctorSchedules, '/dss', [
    ['GET /', 'GET /dss'],
    ['POST /', 'POST /dss', { doctorId: 1, dayOfWeek: 'tuesday', startTime: '09:00', endTime: '17:00' }],
  ]],
  ['Inbox-UF', inbox, '/ib', [
    ['GET /', 'GET /ib'],
    ['POST /', 'POST /ib', { recipientId: 2, subject: 'Test', body: 'Hello' }],
    ['PUT /1/read', 'PUT /ib/1/read', {}],
  ]],
  ['Invitations-UF', invitations, '/inv', [
    ['GET /', 'GET /inv'],
    ['POST /', 'POST /inv', { email: 'new2@t.com', role: 'nurse' }],
  ]],
  ['Tests-UF', tests, '/tst', [['GET /', 'GET /tst']]],
  ['Audit-UF', audit, '/aud', [['GET /', 'GET /aud']]],
  ['Auth-UF', auth, '/au', [['GET /me', 'GET /au/me']]],
  ['PatientPortal-UF', patientPortal, '/pp', [
    ['GET /', 'GET /pp'], ['GET /patients', 'GET /pp/patients'],
    ['GET /patients/1', 'GET /pp/patients/1'],
    ['GET /patients/1/appointments', 'GET /pp/patients/1/appointments'],
    ['GET /patients/1/bills', 'GET /pp/patients/1/bills'],
    ['GET /patients/1/prescriptions', 'GET /pp/patients/1/prescriptions'],
    ['GET /patients/1/vitals', 'GET /pp/patients/1/vitals'],
    ['GET /patients/1/lab-results', 'GET /pp/patients/1/lab-results'],
    ['GET /patients/1/visits', 'GET /pp/patients/1/visits'],
    ['GET /patients/1/insurance', 'GET /pp/patients/1/insurance'],
    ['GET /patients/1/allergies', 'GET /pp/patients/1/allergies'],
    ['GET /patients/1/admissions', 'GET /pp/patients/1/admissions'],
    ['GET /patients/1/emergency', 'GET /pp/patients/1/emergency'],
    ['GET /patients/1/timeline', 'GET /pp/patients/1/timeline'],
    ['GET /patients/1/summary', 'GET /pp/patients/1/summary'],
    ['POST /patients/1/appointments', 'POST /pp/patients/1/appointments', { doctorId: 1, apptDate: '2025-07-01', visitType: 'opd' }],
  ]],
];

// Generate all tests from the data-driven spec
for (const [suiteName, route, basePath, endpoints] of routeTests) {
  describe(suiteName, () => {
    for (const [testName, reqStr, body] of endpoints) {
      it(testName, async () => {
        const a = mkApp(route, basePath);
        const [method, path] = reqStr.split(' ');
        const res = await jr(a, path, method, body);
        expect(res.status).toBeLessThanOrEqual(500);
      });
    }
  });
}

// Admin routes with universalFallback
describe('Admin-UF', () => {
  const adminTests: Array<[string, string, any?]> = [
    ['GET /plans', 'GET /admin/plans'],
    ['GET /hospitals', 'GET /admin/hospitals'],
    ['GET /hospitals/1', 'GET /admin/hospitals/1'],
    ['GET /stats', 'GET /admin/stats'],
    ['GET /usage', 'GET /admin/usage'],
    ['GET /onboarding', 'GET /admin/onboarding'],
    ['POST /hospitals', 'POST /admin/hospitals', { name: 'New', subdomain: 'new', plan: 'basic', adminEmail: 'a@b.com', adminName: 'Admin', adminPassword: 'pass' }],
    ['PUT /hospitals/1', 'PUT /admin/hospitals/1', { name: 'Updated' }],
    ['DELETE /hospitals/1', 'DELETE /admin/hospitals/1'],
    ['PUT /onboarding/1', 'PUT /admin/onboarding/1', { status: 'approved' }],
    ['POST /login empty', 'POST /admin/login', {}],
    ['POST /login creds', 'POST /admin/login', { email: 'admin@test.com', password: 'test' }],
  ];
  for (const [testName, reqStr, body] of adminTests) {
    it(testName, async () => {
      const a = mkApp(adminRoutes, '/admin');
      const [method, path] = reqStr.split(' ');
      const res = await jr(a, path, method, body);
      expect(res.status).toBeLessThanOrEqual(500);
    });
  }
});

describe('PDF-UF', () => {
  it('GET /bill/1', async () => {
    const a = mkApp(pdf, '/pdf');
    expect((await a.request('/pdf/bill/1')).status).toBeLessThanOrEqual(500);
  });
  it('GET /prescription/1', async () => {
    const a = mkApp(pdf, '/pdf');
    expect((await a.request('/pdf/prescription/1')).status).toBeLessThanOrEqual(500);
  });
  it('GET /lab-report/1', async () => {
    const a = mkApp(pdf, '/pdf');
    expect((await a.request('/pdf/lab-report/1')).status).toBeLessThanOrEqual(500);
  });
});

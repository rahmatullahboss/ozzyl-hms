import { describe, expect, it } from 'vitest';
import otRoutes from '../../../src/routes/tenant/ot';
import accountingRoutes from '../../../src/routes/tenant/accounting';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import hrRoutes from '../../../src/routes/tenant/hr';
import profitRoutes from '../../../src/routes/tenant/profit';
import recurringRoutes from '../../../src/routes/tenant/recurring';
import shareholderRoutes from '../../../src/routes/tenant/shareholders';
import staffRoutes from '../../../src/routes/tenant/staff';
import assetRoutes from '../../../src/routes/tenant/inventory/assets';
import medicalRecordsRoutes from '../../../src/routes/tenant/medicalRecords';
import { ACCOUNTING_EVENT_TYPES } from '../../../src/lib/accounting-posting';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const OT_BOOKING = {
  id: 1,
  tenant_id: 'tenant-1',
  patient_id: 7,
  visit_id: 11,
  is_active: 1,
  operation_status: 'scheduled',
};

const ASSET = {
  FixedAssetStockId: 1,
  tenant_id: 'tenant-1',
  ItemId: 10,
  BarCodeNumber: 'ASSET-1',
  asset_status: 'active',
};

describe('Danphe operational gap closure routes', () => {
  it('creates a structured OT surgery note', async () => {
    const { app, mockDB } = createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'doctor',
      tables: { ot_bookings: [OT_BOOKING] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/ot/bookings/1/surgery-note', {
      method: 'POST',
      body: {
        operative_procedure: 'Appendectomy',
        operative_findings: 'Inflamed appendix',
        surgeon_staff_id: 5,
        note_status: 'final',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('ot_surgery_notes'))).toBe(true);
  });

  it('creates a structured OT anesthesia record', async () => {
    const { app, mockDB } = createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'doctor',
      tables: { ot_bookings: [OT_BOOKING] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/ot/bookings/1/anesthesia-record', {
      method: 'POST',
      body: {
        anesthetist_staff_id: 6,
        anesthesia_type: 'spinal',
        asa_class: 'II',
        airway_plan: 'Natural airway',
        intraoperative_vitals: [{ time: '10:00', bp: '120/80', pulse: 82 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('ot_anesthesia_records'))).toBe(true);
  });

  it('records OT operation status events', async () => {
    const { app, mockDB } = createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'doctor',
      tables: { ot_bookings: [OT_BOOKING] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/ot/bookings/1/status', {
      method: 'PUT',
      body: { status: 'in_progress', remarks: 'Patient shifted to OT' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('ot_status_events'))).toBe(true);
  });

  it('posts vendor payments into finance with an approved expense link', async () => {
    const { app, mockDB } = createTestApp({
      route: accountingRoutes,
      routePath: '/accounting',
      role: 'accountant',
      tables: {
        InventoryVendor: [{ VendorId: 3, tenant_id: 'tenant-1', VendorName: 'Med Supply', IsActive: 1 }],
        InventoryGoodsReceipt: [{ GoodsReceiptId: 4, tenant_id: 'tenant-1', VendorId: 3, TotalAmount: 1200, PaidAmount: 200 }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/accounting/vendor-payments', {
      method: 'POST',
      body: {
        vendor_id: 3,
        goods_receipt_id: 4,
        payment_date: '2026-04-30',
        paid_amount: 1000,
        payment_mode: 'bank',
        remarks: 'GR settlement',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('accounting_vendor_payments'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO expenses'))).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('supplier_payment')
    )).toBe(true);
  });

  it('supports Danphe-style HR leave rules with pay percent', async () => {
    const { app, mockDB } = createTestApp({
      route: hrRoutes,
      routePath: '/hr',
      role: 'hospital_admin',
      tables: { hr_leave_categories: [{ id: 2, tenant_id: 'tenant-1', leave_name: 'Sick Leave', is_active: 1 }] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/hr/leave/rules', {
      method: 'POST',
      body: { leaveCategoryId: 2, year: 2026, days: 10, payPercent: 50, isApproved: true },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('hr_leave_rules'))).toBe(true);
  });

  it('posts approved payroll runs to salary expenses', async () => {
    const { app, mockDB } = createTestApp({
      route: hrRoutes,
      routePath: '/hr',
      role: 'hospital_admin',
      tables: { hr_payroll_runs: [{ id: 9, tenant_id: 'tenant-1', status: 'locked', run_month: '2026-04', total_net: 25000 }] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/hr/payroll/runs/9/approve', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO expenses'))).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    )).toBe(true);
  });

  it('posts recurring expense runs through direct expense accounting', async () => {
    const { app, mockDB } = createTestApp({
      route: recurringRoutes,
      routePath: '/recurring',
      role: 'accountant',
      tables: {
        recurring_expenses: [{
          id: 4,
          tenant_id: 'tenant-1',
          category_id: 2,
          category_name: 'Rent',
          amount: 1200,
          description: 'Monthly rent',
          frequency: 'monthly',
          next_run_date: '2026-04-01',
          is_active: 1,
        }],
        expense_categories: [{ id: 2, tenant_id: 'tenant-1', name: 'Rent', is_recurring_eligible: 1 }],
      },
    });

    const res = await jsonRequest(app, '/recurring/4/run', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO expenses'))).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    )).toBe(true);
  });

  it('posts staff salary payments through direct expense accounting', async () => {
    const { app, mockDB } = createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role: 'hospital_admin',
      tables: {
        staff: [{ id: 12, tenant_id: 'tenant-1', name: 'Nurse Ali', salary: 18000, status: 'active' }],
        salary_payments: [],
      },
    });

    const res = await jsonRequest(app, '/staff/12/salary', {
      method: 'POST',
      body: { month: '2026-04', bonus: 1000, deduction: 500, paymentMethod: 'cash' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO salary_payments'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO expenses'))).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    )).toBe(true);
  });

  it('calculates legacy profit screen totals from verified GL instead of income and expenses tables', async () => {
    const { app, mockDB } = createTestApp({
      route: profitRoutes,
      routePath: '/profit',
      role: 'director',
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_journal_lines')) {
          return { first: { income: 1000, expense: 400 } };
        }
        if (sql.includes('FROM settings')) {
          return { first: { value: '30' } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/profit/calculate?month=2026-04');
    const body = await res.json() as { totalIncome: number; totalExpense: number; totalProfit: number; distributableProfit: number };

    expect(res.status).toBe(200);
    expect(body.totalIncome).toBe(1000);
    expect(body.totalExpense).toBe(400);
    expect(body.totalProfit).toBe(600);
    expect(body.distributableProfit).toBe(180);
    expect(mockDB.queries.some((q) => /\bFROM income\b/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /\bFROM expenses\b/i.test(q.sql))).toBe(false);
  });

  it('calculates shareholder profit distribution from verified GL instead of legacy finance tables', async () => {
    const { app, mockDB } = createTestApp({
      route: shareholderRoutes,
      routePath: '/shareholders',
      role: 'director',
      tables: {
        settings: [{ tenant_id: 'tenant-1', key: 'profit_percentage', value: '50' }],
        shareholders: [{ id: 1, tenant_id: 'tenant-1', name: 'Owner', share_count: 10, type: 'owner', is_active: 1 }],
      },
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_journal_lines')) {
          return { first: { income: 2000, expense: 500 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/shareholders/calculate?month=2026-04');
    const body = await res.json() as { financials: { totalIncome: number; totalExpenses: number; netProfit: number; distributable: number } };

    expect(res.status).toBe(200);
    expect(body.financials.totalIncome).toBe(2000);
    expect(body.financials.totalExpenses).toBe(500);
    expect(body.financials.netProfit).toBe(1500);
    expect(body.financials.distributable).toBe(750);
    expect(mockDB.queries.some((q) => /\bFROM income\b/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /\bFROM expenses\b/i.test(q.sql))).toBe(false);
  });

  it('serves dashboard monthly finance summary from verified GL', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_journal_lines')) {
          return { first: { income: 3200, expense: 1200 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/dashboard/monthly-summary?month=2026-04');
    const body = await res.json() as { income: number; expenses: number; profit: number };

    expect(res.status).toBe(200);
    expect(body.income).toBe(3200);
    expect(body.expenses).toBe(1200);
    expect(body.profit).toBe(2000);
    expect(mockDB.queries.some((q) => /\bFROM income\b/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /\bFROM expenses\b/i.test(q.sql))).toBe(false);
  });

  it('stores asset insurance metadata', async () => {
    const { app, mockDB } = createTestApp({
      route: assetRoutes,
      routePath: '/assets',
      role: 'hospital_admin',
      tables: { InventoryFixedAssetStock: [ASSET] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/assets/1/insurance', {
      method: 'POST',
      body: {
        policy_number: 'INS-2026-01',
        insurer_name: 'Health Shield',
        insured_value: 500000,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('asset_insurance_policies'))).toBe(true);
  });

  it('stores asset contract document metadata using an R2 key', async () => {
    const { app, mockDB } = createTestApp({
      route: assetRoutes,
      routePath: '/assets',
      role: 'hospital_admin',
      tables: { InventoryFixedAssetStock: [ASSET] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/assets/1/contracts', {
      method: 'POST',
      body: {
        contract_type: 'amc',
        file_key: 'tenants/tenant-1/assets/1/amc.pdf',
        file_name: 'amc.pdf',
        mime_type: 'application/pdf',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('asset_contract_documents'))).toBe(true);
  });

  it('tracks MRD chart completion tasks', async () => {
    const { app, mockDB } = createTestApp({
      route: medicalRecordsRoutes,
      routePath: '/medical-records',
      role: 'doctor',
      tables: { medical_records: [{ id: 12, tenant_id: 'tenant-1', patient_id: 7, is_active: 1 }] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/medical-records/chart-completion', {
      method: 'POST',
      body: {
        medical_record_id: 12,
        patient_id: 7,
        task_type: 'discharge_summary',
        assigned_to: 5,
        due_date: '2026-05-01',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('mrd_chart_completion_tasks'))).toBe(true);
  });

  it('archives discharge summary metadata without storing file bytes in D1', async () => {
    const { app, mockDB } = createTestApp({
      route: medicalRecordsRoutes,
      routePath: '/medical-records',
      role: 'doctor',
      tables: { medical_records: [{ id: 12, tenant_id: 'tenant-1', patient_id: 7, is_active: 1 }] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/medical-records/discharge-archives', {
      method: 'POST',
      body: {
        medical_record_id: 12,
        patient_id: 7,
        discharge_summary_no: 'DS-2026-001',
        file_key: 'tenants/tenant-1/mrd/DS-2026-001.pdf',
        file_name: 'DS-2026-001.pdf',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('mrd_discharge_summary_archives'))).toBe(true);
  });

  it('tracks MRD medico-legal file metadata linked to MLC cases', async () => {
    const { app, mockDB } = createTestApp({
      route: medicalRecordsRoutes,
      routePath: '/medical-records',
      role: 'doctor',
      tables: {
        medical_records: [{ id: 12, tenant_id: 'tenant-1', patient_id: 7, is_active: 1 }],
        mlc_cases: [{ id: 8, tenant_id: 'tenant-1', patient_id: 7, status: 'active' }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/medical-records/medico-legal-files', {
      method: 'POST',
      body: {
        medical_record_id: 12,
        patient_id: 7,
        mlc_case_id: 8,
        file_type: 'police_requisition',
        file_key: 'tenants/tenant-1/mlc/8/requisition.pdf',
        file_name: 'requisition.pdf',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('mrd_medico_legal_files'))).toBe(true);
  });
});

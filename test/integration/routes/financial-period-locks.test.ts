import { describe, expect, it } from 'vitest';
import accountingRoutes from '../../../src/routes/tenant/accounting';
import commissionRoutes from '../../../src/routes/tenant/commissions';
import expenseRoutes from '../../../src/routes/tenant/expenses';
import hrRoutes from '../../../src/routes/tenant/hr';
import incomeRoutes from '../../../src/routes/tenant/income';
import paymentRoutes from '../../../src/routes/tenant/payments';
import profitRoutes from '../../../src/routes/tenant/profit';
import recurringRoutes from '../../../src/routes/tenant/recurring';
import shareholderRoutes from '../../../src/routes/tenant/shareholders';
import staffRoutes from '../../../src/routes/tenant/staff';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const closedPeriodRow = (periodName: string) => ({
  id: 1,
  tenant_id: 'tenant-1',
  fiscal_year_id: 1,
  period_name: periodName,
  status: 'closed',
});

describe('financial route accounting period locks', () => {
  it('rejects direct income creation in a closed accounting period', async () => {
    const { app, mockDB } = createTestApp({
      route: incomeRoutes,
      routePath: '/income',
      role: 'accountant',
      tables: {
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/income', {
      method: 'POST',
      body: {
        date: '2026-04-15',
        source: 'other',
        amount: 500,
        description: 'Closed-period income',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO income/i.test(q.sql))).toBe(false);
  });

  it('rejects direct income updates that mutate a closed accounting period', async () => {
    const { app, mockDB } = createTestApp({
      route: incomeRoutes,
      routePath: '/income',
      role: 'accountant',
      tables: {
        income: [{
          id: 2,
          tenant_id: 'tenant-1',
          date: '2026-04-20',
          source: 'other',
          amount: 800,
          description: 'Existing income',
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/income/2', {
      method: 'PUT',
      body: { amount: 900 },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE income SET/i.test(q.sql))).toBe(false);
  });

  it('rejects expense approval in a closed accounting period', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'director',
      tables: {
        expenses: [{
          id: 3,
          tenant_id: 'tenant-1',
          date: '2026-04-12',
          category: 'rent',
          amount: 12000,
          status: 'pending',
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/expenses/3/approve', { method: 'POST' });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE expenses SET status = 'approved'/i.test(q.sql))).toBe(false);
  });

  it('rejects vendor payments in a closed accounting period before financial rows are written', async () => {
    const { app, mockDB } = createTestApp({
      route: accountingRoutes,
      routePath: '/accounting',
      role: 'accountant',
      tables: {
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/accounting/vendor-payments', {
      method: 'POST',
      body: {
        vendor_id: 3,
        goods_receipt_id: 4,
        payment_date: '2026-04-30',
        paid_amount: 1000,
        payment_mode: 'bank',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO expenses/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT INTO accounting_vendor_payments/i.test(q.sql))).toBe(false);
  });

  it('rejects gateway payment verification in a closed accounting period before locking the gateway log', async () => {
    const todayPeriod = getTodayGMT6().slice(0, 7);
    const { app, mockDB } = createTestApp({
      route: paymentRoutes,
      routePath: '/payments',
      role: 'hospital_admin',
      tables: {
        payment_gateway_logs: [{
          id: 5,
          tenant_id: 'tenant-1',
          gateway: 'bkash',
          payment_id: 'pg-closed-1',
          bill_id: 11,
          amount: 500,
          status: 'pending',
        }],
        accounting_period_closes: [closedPeriodRow(todayPeriod)],
      },
    });

    const res = await jsonRequest(app, '/payments/verify', {
      method: 'POST',
      body: {
        paymentId: 'pg-closed-1',
        gateway: 'bkash',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE payment_gateway_logs SET status = 'verifying'/i.test(q.sql))).toBe(false);
  });

  it('rejects recurring expense runs in a closed accounting period before expense rows are written', async () => {
    const todayPeriod = getTodayGMT6().slice(0, 7);
    const { app, mockDB } = createTestApp({
      route: recurringRoutes,
      routePath: '/recurring',
      role: 'accountant',
      tables: {
        recurring_expenses: [{
          id: 8,
          tenant_id: 'tenant-1',
          category_id: 2,
          amount: 2500,
          description: 'Monthly rent',
          frequency: 'monthly',
          next_run_date: `${todayPeriod}-01`,
          is_active: 1,
        }],
        accounting_period_closes: [closedPeriodRow(todayPeriod)],
      },
    });

    const res = await jsonRequest(app, '/recurring/8/run', { method: 'POST' });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO expenses/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE recurring_expenses SET next_run_date/i.test(q.sql))).toBe(false);
  });

  it('rejects payroll run approval in a closed accounting period before posting salary expense', async () => {
    const { app, mockDB } = createTestApp({
      route: hrRoutes,
      routePath: '/hr',
      role: 'hospital_admin',
      tables: {
        hr_payroll_runs: [{
          id: 9,
          tenant_id: 'tenant-1',
          status: 'locked',
          run_month: '2026-04',
          total_net: 25000,
          expense_id: null,
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/hr/payroll/runs/9/approve', { method: 'POST' });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO expenses/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE hr_payroll_runs\s+SET status = 'approved'/i.test(q.sql))).toBe(false);
  });

  it('rejects staff salary payments in a closed accounting period before salary and expense rows are written', async () => {
    const todayPeriod = getTodayGMT6().slice(0, 7);
    const { app, mockDB } = createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role: 'hospital_admin',
      tables: {
        staff: [{
          id: 12,
          tenant_id: 'tenant-1',
          name: 'Nurse A',
          salary: 18000,
          status: 'active',
        }],
        salary_payments: [],
        accounting_period_closes: [closedPeriodRow(todayPeriod)],
      },
    });

    const res = await jsonRequest(app, '/staff/12/salary', {
      method: 'POST',
      body: {
        month: todayPeriod,
        bonus: 0,
        deduction: 0,
        paymentMethod: 'cash',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO salary_payments/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT INTO expenses/i.test(q.sql))).toBe(false);
  });

  it('rejects single doctor commission payments in a closed accounting period before settlement, posting, or accrual writes', async () => {
    const { app, mockDB } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tables: {
        doctor_commission_accruals: [{
          id: 21,
          tenant_id: 'tenant-1',
          doctor_id: 5,
          commission_amount: 700,
          status: 'accrued',
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/commissions/doctor-accruals/21/pay', {
      method: 'POST',
      body: { paidDate: '2026-04-17', paymentMode: 'cash' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO doctor_commission_settlements/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE doctor_commission_accruals/i.test(q.sql))).toBe(false);
  });

  it('rejects bulk doctor commission settlement in a closed accounting period before settlement or posting writes', async () => {
    const { app, mockDB } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tables: {
        doctor_commission_accruals: [{
          id: 22,
          tenant_id: 'tenant-1',
          doctor_id: 5,
          commission_amount: 800,
          status: 'approved',
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/commissions/settle', {
      method: 'POST',
      body: {
        doctorId: 5,
        accrualIds: [22],
        paymentMode: 'bank',
        settlementDate: '2026-04-18',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO doctor_commission_settlements/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE doctor_commission_accruals/i.test(q.sql))).toBe(false);
  });

  it('rejects legacy marketing commission payments in a closed accounting period before marking paid', async () => {
    const { app, mockDB } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tables: {
        commissions: [{
          id: 23,
          tenant_id: 'tenant-1',
          paid_status: 'unpaid',
          commission_amount: 500,
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/commissions/23/pay', {
      method: 'POST',
      body: { paidDate: '2026-04-19', paymentMode: 'cash' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE commissions SET paid_status = 'paid'/i.test(q.sql))).toBe(false);
  });

  it('rejects legacy profit distribution approval in a closed accounting period before distribution writes', async () => {
    const { app, mockDB } = createTestApp({
      route: profitRoutes,
      routePath: '/profit',
      role: 'director',
      tables: {
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/profit/distribute', {
      method: 'POST',
      body: { month: '2026-04' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO profit_distributions/i.test(q.sql))).toBe(false);
  });

  it('rejects shareholder profit distribution in a closed accounting period before payout or posting writes', async () => {
    const { app, mockDB } = createTestApp({
      route: shareholderRoutes,
      routePath: '/shareholders',
      role: 'director',
      tables: {
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/shareholders/distribute', {
      method: 'POST',
      body: {
        month: '2026-04',
        items: [{ shareholderId: 1, grossDividend: 1000, taxDeducted: 0, netPayable: 1000 }],
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO profit_distributions/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT INTO shareholder_distributions/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);
  });

  it('rejects shareholder dividend payment in a closed accounting period before paid status or posting writes', async () => {
    const todayPeriod = getTodayGMT6().slice(0, 7);
    const { app, mockDB } = createTestApp({
      route: shareholderRoutes,
      routePath: '/shareholders',
      role: 'accountant',
      tables: {
        shareholder_distributions: [{
          id: 31,
          distribution_id: 4,
          shareholder_id: 9,
          tenant_id: 'tenant-1',
          net_payable: 1200,
          paid_status: 'unpaid',
        }],
        profit_distributions: [{
          id: 4,
          tenant_id: 'tenant-1',
          month: todayPeriod,
        }],
        accounting_period_closes: [closedPeriodRow(todayPeriod)],
      },
    });

    const res = await jsonRequest(app, '/shareholders/distributions/4/pay/9', {
      method: 'POST',
      body: { paymentMode: 'cash' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE shareholder_distributions/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);
  });
});

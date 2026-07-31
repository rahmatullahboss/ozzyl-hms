import { describe, expect, it } from 'vitest';
import accountingRoutes from '../../../src/routes/tenant/accounting';
import reportsRoutes from '../../../src/routes/tenant/reports';
import { createTestApp } from '../helpers/test-app';

describe('accounting report source of truth', () => {
  it('rejects accounting reports without a backend finance role', async () => {
    const { app } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
    });

    const res = await app.request('/reports/pl?startDate=2026-05-01&endDate=2026-05-31');

    expect(res.status).toBe(403);
  });

  it('builds the P&L report from verified accounting vouchers, not legacy income/expenses tables', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
    });

    const res = await app.request('/reports/pl?startDate=2026-05-01&endDate=2026-05-31');

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM accounting_journal_lines'))).toBe(true);
    expect(mockDB.queries.some((q) => /\bFROM income\b/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /\bFROM expenses\b/i.test(q.sql))).toBe(false);
  });

  it('keeps deactivated historical revenue and expense accounts in P&L totals', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'accountant',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes("a.type in ('revenue', 'expense')")) {
          return { first: { income: 100.005, expense: 20.115 } };
        }
        if (lower.includes('group by a.id') && lower.includes('a.type = ?')) {
          const type = params[3];
          if (type === 'revenue') {
            return { results: [{ name: 'Old Service Revenue', code: '4100', amount: 100.005, count: 1 }] };
          }
          if (type === 'expense') {
            return { results: [{ name: 'Old Expense', code: '5900', amount: 20.115, count: 1 }] };
          }
        }
        return null;
      },
    });

    const res = await app.request('/reports/pl?startDate=2026-05-01&endDate=2026-05-31');
    const body = await res.json() as {
      income: { total: number; items: Array<{ total: number }> };
      expenses: { total: number; items: Array<{ total: number }> };
      netProfit: number;
    };

    expect(res.status).toBe(200);
    expect(body.income.total).toBe(100.01);
    expect(body.income.items[0].total).toBe(100.01);
    expect(body.expenses.total).toBe(20.12);
    expect(body.expenses.items[0].total).toBe(20.12);
    expect(body.netProfit).toBe(79.89);
    const glQueries = mockDB.queries.filter((q) => q.sql.includes('FROM accounting_journal_lines jl'));
    expect(glQueries.some((q) => /COALESCE\(a\.is_active,\s*1\)\s*=\s*1/i.test(q.sql))).toBe(false);
  });

  it('rejects P&L report requests with an inverted date range', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'accountant',
    });

    const res = await app.request('/reports/pl?startDate=2026-06-01&endDate=2026-05-01');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/startDate must be on or before endDate/i);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM accounting_journal_lines'))).toBe(false);
  });

  it('builds the accounting dashboard summary from verified accounting vouchers', async () => {
    const { app, mockDB } = createTestApp({
      route: accountingRoutes,
      routePath: '/accounting',
      role: 'accountant',
    });

    const res = await app.request('/accounting/summary');

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM accounting_journal_lines'))).toBe(true);
    expect(mockDB.queries.some((q) => /\bFROM income\b/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /\bFROM expenses\b/i.test(q.sql))).toBe(false);
  });

  it('adds accountant operational finance metrics to the dashboard summary', async () => {
    const { app, mockDB } = createTestApp({
      route: accountingRoutes,
      routePath: '/accounting',
      role: 'accountant',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes("a.type in ('revenue', 'expense')")) {
          return { first: { income: 1000, expense: 200 } };
        }
        if (lower.includes('as today_collection_total')) {
          return { first: { today_collection_total: 1200 } };
        }
        if (lower.includes('as pending_handover_amount')) {
          return { first: { pending_handover_amount: 700, pending_handover_count: 2 } };
        }
        if (lower.includes('as patient_due_total')) {
          return { first: { patient_due_total: 650 } };
        }
        if (lower.includes('as patient_advance_total')) {
          return { first: { patient_advance_total: 950 } };
        }
        if (lower.includes('as refund_today_total')) {
          return { first: { refund_today_total: 100 } };
        }
        if (lower.includes('as discount_today_total')) {
          return { first: { discount_today_total: 50 } };
        }
        if (lower.includes("m.mapping_key = 'doctor_commission_payable'")) {
          return { first: { doctor_payable_total: 300 } };
        }
        if (lower.includes("m.mapping_key = 'accounts_payable'")) {
          return { first: { supplier_payable_total: 400 } };
        }
        if (lower.includes('as pending_posting_events')) {
          return { first: { pending_posting_events: 4 } };
        }
        return null;
      },
    });

    const res = await app.request('/accounting/summary');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      operations: {
        todayCollection: number;
        pendingHandoverAmount: number;
        pendingHandoverCount: number;
        patientDue: number;
        patientAdvance: number;
        todayRefunds: number;
        todayDiscounts: number;
        doctorPayable: number;
        supplierPayable: number;
        pendingPostingEvents: number;
      };
    };
    expect(body.operations).toEqual({
      todayCollection: 1200,
      pendingHandoverAmount: 700,
      pendingHandoverCount: 2,
      patientDue: 650,
      patientAdvance: 950,
      todayRefunds: 100,
      todayDiscounts: 50,
      doctorPayable: 300,
      supplierPayable: 400,
      pendingPostingEvents: 4,
    });
    expect(mockDB.queries.some((q) => q.sql.includes('FROM emp_cash_transactions'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM billing_handovers'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes("m.mapping_key = 'doctor_commission_payable'"))).toBe(true);
    const refundSummaryQuery = mockDB.queries.find((q) => q.sql.includes('FROM pharmacy_returns'));
    expect(refundSummaryQuery?.sql).toContain('COALESCE(total_return_amount, 0) AS amount, created_at AS refund_date');
    expect(refundSummaryQuery?.sql).not.toContain('return_date AS refund_date');
    const discountSummaryQuery = mockDB.queries.find((q) => q.sql.includes('FROM billing_settlements'));
    expect(discountSummaryQuery?.sql).toContain('created_at AS discount_date');
    expect(discountSummaryQuery?.sql).not.toContain('settlement_date AS discount_date');
    expect(discountSummaryQuery?.sql).toContain('is_active = 1');
    expect(discountSummaryQuery?.sql).not.toContain("status = 'approved'");
  });

  it('serves trial balance with the correctly spelled route alias', async () => {
    const { app } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
      tables: {
        fiscal_years: [{
          id: 1,
          tenant_id: 'tenant-1',
          is_active: 1,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          fiscal_year_name: 'FY 2026',
        }],
        chart_of_accounts: [],
      },
    });

    const res = await app.request('/reports/trial-balance');

    expect(res.status).toBe(200);
  });

  it('keeps historical inactive accounts in trial balance and reports balance status', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select id from fiscal_years')) {
          return { first: { id: 1 } };
        }
        if (lower.includes('select * from fiscal_years')) {
          return { first: { id: 1, start_date: '2026-01-01', end_date: '2026-12-31', fiscal_year_name: 'FY 2026' } };
        }
        if (lower.includes('from chart_of_accounts a') && lower.includes('accounting_journal_lines')) {
          return {
            results: [
              { id: 1, code: '1100', name: 'Cash', type: 'asset', is_active: 1, total_debit: 100.005, total_credit: 0 },
              { id: 2, code: '5999', name: 'Old Expense', type: 'expense', is_active: 0, total_debit: 0, total_credit: 100.005 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/trial-balance?asOfDate=2026-06-30');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      asOfDate: string;
      accounts: Array<{ code: string; debit: number; credit: number; isActive: boolean }>;
      totals: { totalDebit: number; totalCredit: number; difference: number; isBalanced: boolean };
    };
    expect(body.asOfDate).toBe('2026-06-30');
    expect(body.accounts).toContainEqual(expect.objectContaining({ code: '5999', isActive: false, credit: 100.01 }));
    expect(body.totals).toEqual({ totalDebit: 100.01, totalCredit: 100.01, difference: 0, isBalanced: true });
    const trialQuery = mockDB.queries.find((q) => q.sql.includes('FROM chart_of_accounts a') && q.sql.includes('accounting_journal_lines'));
    expect(trialQuery?.sql).toMatch(/HAVING\s+a\.is_active = 1\s+OR/i);
  });

  it('returns a clear error when the requested trial-balance fiscal year is missing', async () => {
    const { app } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select * from fiscal_years')) return { first: null };
        return null;
      },
    });

    const res = await app.request('/reports/trial-balance?fiscalYearId=999');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/Fiscal year not found/i);
  });

  it('does not include the first day of the next month in monthly GL summary', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
    });

    const res = await app.request('/reports/monthly-summary?month=2026-02');

    expect(res.status).toBe(200);
    const glQuery = mockDB.queries.find((q) => q.sql.includes('FROM accounting_journal_lines'));
    expect(glQuery?.params).toContain('2026-02-01');
    expect(glQuery?.params).toContain('2026-02-28');
    expect(glQuery?.params).not.toContain('2026-03-01');
  });

  it('includes current year earnings in balance sheet equity so totals reconcile', async () => {
    const { app } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select id from fiscal_years')) {
          return { first: { id: 1 } };
        }
        if (lower.includes('select * from fiscal_years')) {
          return { first: { id: 1, start_date: '2026-01-01', end_date: '2026-12-31', fiscal_year_name: 'FY 2026' } };
        }
        if (lower.includes('where a.tenant_id = ? and a.type = ?')) {
          const type = params[3];
          if (type === 'asset') return { results: [{ name: 'Cash', amount: 1500 }] };
          if (type === 'liability') return { results: [{ name: 'Accounts Payable', amount: 500 }] };
          if (type === 'equity') return { results: [{ name: 'Capital Account', amount: 700 }] };
        }
        if (lower.includes('from accounting_journal_lines') && lower.includes("a.type in ('revenue', 'expense')")) {
          return { first: { income: 500, expense: 200 } };
        }
        return null;
      },
    });

    const res = await app.request('/reports/balance-sheet');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      equity: { items: Array<{ name: string; amount: number }>; total: number };
      totals: { liabilitiesAndEquity: number; difference: number; isBalanced: boolean };
    };
    expect(body.equity.items).toContainEqual({ name: 'Current Year Earnings', amount: 300 });
    expect(body.equity.total).toBe(1000);
    expect(body.totals.liabilitiesAndEquity).toBe(1500);
    expect(body.totals.difference).toBe(0);
    expect(body.totals.isBalanced).toBe(true);
  });

  it('keeps historical inactive balance sheet accounts and supports as-of reporting', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'accountant',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select id from fiscal_years')) {
          return { first: { id: 1 } };
        }
        if (lower.includes('select * from fiscal_years')) {
          return { first: { id: 1, start_date: '2026-01-01', end_date: '2026-12-31', fiscal_year_name: 'FY 2026' } };
        }
        if (lower.includes('where a.tenant_id = ? and a.type = ?')) {
          const type = params[3];
          if (type === 'asset') {
            return { results: [{ code: '1100', name: 'Old Cash', is_active: 0, amount: 1500.005 }] };
          }
          if (type === 'liability') {
            return { results: [{ code: '2100', name: 'Loan Payable', is_active: 1, amount: 500 }] };
          }
          if (type === 'equity') {
            return { results: [{ code: '3100', name: 'Capital Account', is_active: 1, amount: 700 }] };
          }
        }
        if (lower.includes('from accounting_journal_lines') && lower.includes("a.type in ('revenue', 'expense')")) {
          return { first: { income: 500, expense: 200 } };
        }
        return null;
      },
    });

    const res = await app.request('/reports/balance-sheet?asOfDate=2026-06-30');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      asOfDate: string;
      assets: { items: Array<{ code: string; name: string; amount: number; isActive: boolean }>; total: number };
      totals: { assets: number; liabilitiesAndEquity: number; difference: number; isBalanced: boolean };
    };
    expect(body.asOfDate).toBe('2026-06-30');
    expect(body.assets.items).toContainEqual({
      code: '1100',
      name: 'Old Cash',
      amount: 1500.01,
      isActive: false,
    });
    expect(body.totals).toEqual({
      assets: 1500.01,
      liabilitiesAndEquity: 1500,
      difference: 0.01,
      isBalanced: false,
    });
    const accountQueries = mockDB.queries.filter((q) => q.sql.includes('FROM chart_of_accounts a') && q.sql.includes('a.type = ?'));
    expect(accountQueries.every((q) => q.params.includes('2026-06-30'))).toBe(true);
    expect(accountQueries.every((q) => /HAVING\s+a\.is_active = 1\s+OR/i.test(q.sql))).toBe(true);
  });

  it('returns a clear error when the requested balance-sheet fiscal year is missing', async () => {
    const { app } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select * from fiscal_years')) return { first: null };
        return null;
      },
    });

    const res = await app.request('/reports/balance-sheet?fiscalYearId=999');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/Fiscal year not found/i);
  });

  it('returns a rounded general ledger statement with debit and credit summary totals', async () => {
    const { app } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'accountant',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from chart_of_accounts')) {
          return { first: { id: 10, code: '1100', name: 'Cash in Hand', type: 'asset' } };
        }
        if (lower.includes('sum(jl.debit_amount - jl.credit_amount)')) {
          return { first: { opening: 100.105 } };
        }
        if (lower.includes('v.entry_date as date') && lower.includes('jl.debit_amount as debit')) {
          return {
            results: [
              {
                date: '2026-05-13',
                voucherNumber: 'RV-0001',
                description: 'OPD payment',
                debit: 50.255,
                credit: 0,
              },
              {
                date: '2026-05-13',
                voucherNumber: 'PMTV-0001',
                description: 'Refund paid',
                debit: 0,
                credit: 20.115,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/reports/ledger?ledgerId=10&startDate=2026-05-13&endDate=2026-05-13');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      opening: number;
      transactions: Array<{ debit: number; credit: number; balance: number }>;
      closing: number;
      summary: { totalDebit: number; totalCredit: number; transactionCount: number };
    };
    expect(body.opening).toBe(100.11);
    expect(body.transactions[0]).toMatchObject({ debit: 50.26, credit: 0, balance: 150.37 });
    expect(body.transactions[1]).toMatchObject({ debit: 0, credit: 20.12, balance: 130.25 });
    expect(body.closing).toBe(130.25);
    expect(body.summary).toEqual({ totalDebit: 50.26, totalCredit: 20.12, transactionCount: 2 });
  });

  it('accepts general ledger account and date range aliases used by report callers', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'accountant',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from chart_of_accounts')) {
          return { first: { id: 10, code: '1100', name: 'Cash in Hand', type: 'asset' } };
        }
        if (lower.includes('sum(jl.debit_amount - jl.credit_amount)')) {
          return { first: { opening: 0 } };
        }
        if (lower.includes('v.entry_date as date') && lower.includes('jl.debit_amount as debit')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await app.request('/reports/ledger?accountId=10&from=2026-05-01&to=2026-05-31');

    expect(res.status).toBe(200);
    const body = await res.json() as { startDate: string; endDate: string; summary: { transactionCount: number } };
    expect(body.startDate).toBe('2026-05-01');
    expect(body.endDate).toBe('2026-05-31');
    expect(body.summary.transactionCount).toBe(0);
    expect(mockDB.queries.some((q) => q.params.includes('2026-05-01'))).toBe(true);
    expect(mockDB.queries.some((q) => q.params.includes('2026-05-31'))).toBe(true);
  });
});

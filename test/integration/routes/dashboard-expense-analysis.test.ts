import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type ExpenseAnalysisResponse = {
  period: { startDate: string; endDate: string; label: string };
  totals: { transactions: number; paidAmount: number };
  rows: Array<{
    id: string;
    occurredAt: string;
    category: string;
    detail: string;
    paidAmount: number;
    paymentMethod: string;
    status: string;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
};

describe('executive paid expense analysis', () => {
  it('returns each paid operating expense and doctor payout as a separate row', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_expense:analysis')) {
          expect(lower).toContain("coalesce(e.status, 'approved') != 'rejected'");
          expect(lower).toContain("coalesce(e.payment_status, 'unpaid') = 'paid'");
          expect(lower).toContain('e.cash_movement_id is not null');
          expect(lower).toContain("reference_type in ('doctor_commission_settlement', 'doctor_payout')");
          expect(lower).toContain("movement_type = 'cash_out'");
          expect(lower).toContain('union all');
          expect(lower).toContain("'expense-' || cast(e.id as text)");
          expect(lower).toContain("'doctor-payout-' || cast(m.id as text)");
          expect(lower).not.toContain('json_group_array');
          expect(lower).not.toContain('group by category');
          expect(lower).toContain('order by paid_amount desc');
          expect(params.at(-2)).toBe(25);
          expect(params.at(-1)).toBe(0);
          return {
            results: [
              {
                id: 'expense-1',
                occurred_at: '2026-07-10',
                category: 'utilities',
                detail: 'Electricity bill',
                paid_amount: 500,
                payment_method: 'cash',
                status: 'paid',
                total_rows: 3,
                overall_transactions: 3,
                overall_paid_amount: 1000,
              },
              {
                id: 'expense-2',
                occurred_at: '2026-07-10',
                category: 'supplies',
                detail: 'No description provided',
                paid_amount: 200,
                payment_method: 'bank_transfer',
                status: 'paid',
                total_rows: 3,
                overall_transactions: 3,
                overall_paid_amount: 1000,
              },
              {
                id: 'doctor-payout-3',
                occurred_at: '2026-07-10 12:00:00',
                category: 'Doctor payouts',
                detail: 'July doctor settlement',
                paid_amount: 300,
                payment_method: 'cash',
                status: 'paid',
                total_rows: 3,
                overall_transactions: 3,
                overall_paid_amount: 1000,
              },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/expense-analysis?date=2026-07-10&sortBy=paidAmount&sortDirection=desc&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as ExpenseAnalysisResponse;
    expect(body.rows).toEqual([
      {
        id: 'expense-1',
        occurredAt: '2026-07-10',
        category: 'utilities',
        detail: 'Electricity bill',
        paidAmount: 500,
        paymentMethod: 'cash',
        status: 'paid',
      },
      {
        id: 'expense-2',
        occurredAt: '2026-07-10',
        category: 'supplies',
        detail: 'No description provided',
        paidAmount: 200,
        paymentMethod: 'bank_transfer',
        status: 'paid',
      },
      {
        id: 'doctor-payout-3',
        occurredAt: '2026-07-10 12:00:00',
        category: 'Doctor payouts',
        detail: 'July doctor settlement',
        paidAmount: 300,
        paymentMethod: 'cash',
        status: 'paid',
      },
    ]);
    expect(body.totals).toEqual({ transactions: 3, paidAmount: 1000 });
    expect(body.totalRows).toBe(3);
    expect(body.rows.map((row) => row.category)).not.toContain('salary');
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_expense:analysis'))).toHaveLength(1);
  });

  it('searches both category and transaction detail without regrouping rows', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => sql.includes('executive_expense:analysis') ? {
        results: [{
          id: 'expense-7',
          occurred_at: '2026-07-10',
          category: 'utilities',
          detail: 'Generator fuel',
          paid_amount: 250,
          payment_method: 'bank_transfer',
          status: 'paid',
          total_rows: 1,
          overall_transactions: 1,
          overall_paid_amount: 250,
        }],
      } : null,
    });

    const response = await app.request('/dashboard/expense-analysis?search=generator&pageSize=50');
    expect(response.status).toBe(200);
    const body = await response.json() as ExpenseAnalysisResponse;
    expect(body.rows[0]).toEqual({
      id: 'expense-7',
      occurredAt: '2026-07-10',
      category: 'utilities',
      detail: 'Generator fuel',
      paidAmount: 250,
      paymentMethod: 'bank_transfer',
      status: 'paid',
    });
    const query = mockDB.queries.find((entry) => entry.sql.includes('executive_expense:analysis'));
    expect(query?.params.filter((param) => param === '%generator%')).toHaveLength(2);
  });

  it('maps missing transaction fields to safe display fallbacks', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.includes('executive_expense:analysis') ? {
        results: [{
          id: 'expense-9',
          occurred_at: null,
          category: 'misc',
          detail: null,
          paid_amount: 100,
          payment_method: null,
          status: null,
          total_rows: 1,
          overall_transactions: 1,
          overall_paid_amount: 100,
        }],
      } : null,
    });

    const response = await app.request('/dashboard/expense-analysis');
    expect(response.status).toBe(200);
    const body = await response.json() as ExpenseAnalysisResponse;
    expect(body.rows[0]).toEqual({
      id: 'expense-9',
      occurredAt: '',
      category: 'misc',
      detail: 'No description provided',
      paidAmount: 100,
      paymentMethod: '',
      status: '',
    });
  });

  it('rejects unsafe sort or page-size input before SQL', async () => {
    const { app, mockDB } = createTestApp({ route: dashboardRoutes, routePath: '/dashboard', role: 'hospital_admin', tenantId: 'tenant-1' });
    expect((await app.request('/dashboard/expense-analysis?sortBy=sql')).status).toBe(400);
    expect((await app.request('/dashboard/expense-analysis?pageSize=75')).status).toBe(400);
    expect(mockDB.queries).toHaveLength(0);
  });
});

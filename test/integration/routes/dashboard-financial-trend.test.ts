import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type TrendResponse = {
  reportKey: string;
  period: { startDate: string; endDate: string };
  dateBasis: string;
  granularity: 'daily' | 'monthly';
  requestedSeries: string[];
  points: Array<{ bucket: string; collection: number; expense: number; result: number }>;
  totals: { collection: number; expense: number; result: number };
  reconciliation: Record<string, { status: string; summaryTotal: number; detailTotal: number }>;
};

describe('dashboard reconciled financial trend', () => {
  it('aggregates short ranges daily and reconciles collection, expense, and result', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('dashboard_financial_trend:collection')) {
          expect(lower).toContain("'+6 hours'");
          expect(lower).not.toContain('billing_deposits');
          expect(params).toEqual(['tenant-1', '2026-07-01', '2026-07-03']);
          return { results: [
            { bucket: '2026-07-01', amount: 600, row_count: 2 },
            { bucket: '2026-07-02', amount: 400, row_count: 1 },
          ] };
        }
        if (lower.includes('dashboard_financial_trend:expense')) {
          expect(lower).toContain('doctor_commission_settlement');
          expect(params).toEqual([
            'tenant-1', '2026-07-01', '2026-07-03',
            'tenant-1', '2026-07-01', '2026-07-03',
          ]);
          return { results: [
            { bucket: '2026-07-01', amount: 100, row_count: 1 },
            { bucket: '2026-07-03', amount: 50, row_count: 1 },
          ] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/financial-trend?startDate=2026-07-01&endDate=2026-07-03&series=collection,expense,result');
    expect(response.status).toBe(200);
    const body = await response.json() as TrendResponse;
    expect(body).toMatchObject({
      reportKey: 'admin_financial_trend',
      period: { startDate: '2026-07-01', endDate: '2026-07-03' },
      dateBasis: 'payment_and_paid_expense_date',
      granularity: 'daily',
      requestedSeries: ['collection', 'expense', 'result'],
      totals: { collection: 1000, expense: 150, result: 850 },
    });
    expect(body.points).toEqual([
      { bucket: '2026-07-01', label: '2026-07-01', collection: 600, expense: 100, result: 500 },
      { bucket: '2026-07-02', label: '2026-07-02', collection: 400, expense: 0, result: 400 },
      { bucket: '2026-07-03', label: '2026-07-03', collection: 0, expense: 50, result: -50 },
    ]);
    expect(body.reconciliation.collection.status).toBe('reconciled');
    expect(body.reconciliation.expense.status).toBe('reconciled');
    expect(body.reconciliation.result).toMatchObject({ summaryTotal: 850, detailTotal: 850, status: 'reconciled' });
  });

  it('uses monthly aggregation for long ranges', async () => {
    const sqlSeen: string[] = [];
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('dashboard_financial_trend:')) {
          sqlSeen.push(lower);
          return { results: [] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/financial-trend?startDate=2026-01-01&endDate=2026-07-31');
    expect(response.status).toBe(200);
    const body = await response.json() as TrendResponse;
    expect(body.granularity).toBe('monthly');
    expect(sqlSeen).toHaveLength(2);
    expect(sqlSeen.every((sql) => sql.includes('substr('))).toBe(true);
  });

  it('rejects unsupported series and invalid periods', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });
    expect((await app.request('/dashboard/financial-trend?startDate=2026-07-01&endDate=2026-07-03&series=forecast')).status).toBe(400);
    expect((await app.request('/dashboard/financial-trend?startDate=2026-07-31&endDate=2026-07-01')).status).toBe(400);
  });
});

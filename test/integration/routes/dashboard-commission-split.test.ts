import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type SummaryBody = {
  metrics: Array<{ metric: string; total: number; valueType: 'money' | 'count' }>;
};

type BreakdownBody = {
  metric: string;
  total: number;
  sources: Array<{ label: string; amount: number; count: number }>;
  rows: Array<{ serviceNames?: string; amount: number }>;
};

describe('dashboard doctor commission partitions', () => {
  it('calculates visit, test, other, and total commission from one grouped source scan', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_commission:totals')) {
          expect(lower).toContain("coalesce(dca.status, 'accrued') != 'cancelled'");
          expect(lower).toContain('group by dca.source_type');
          expect(params).toEqual(['tenant-1', '2026-07-10', '2026-07-10']);
          return {
            results: [
              { source_type: 'consultation_fee', amount: 100, row_count: 1 },
              { source_type: 'lab_test', amount: 200, row_count: 1 },
              { source_type: 'referral', amount: 50, row_count: 1 },
              { source_type: 'procedure', amount: 30, row_count: 1 },
              { source_type: 'ipd_round', amount: 20, row_count: 1 },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request(
      '/dashboard/kpi-summary?date=2026-07-10&metrics=visit_commission,test_commission,other_doctor_commission,total_commission',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as SummaryBody;
    expect(body.metrics).toEqual([
      expect.objectContaining({ metric: 'visit_commission', total: 100, valueType: 'money' }),
      expect.objectContaining({ metric: 'test_commission', total: 250, valueType: 'money' }),
      expect.objectContaining({ metric: 'total_commission', total: 400, valueType: 'money' }),
      expect.objectContaining({ metric: 'other_doctor_commission', total: 50, valueType: 'money' }),
    ]);

    const commissionQueries = mockDB.queries.filter((query) => query.sql.includes('executive_commission:totals'));
    expect(commissionQueries).toHaveLength(1);
    expect(mockDB.queries.some((query) => query.sql.includes('executive_commission:details'))).toBe(false);
  });

  it.each([
    {
      metric: 'visit_commission',
      expectedTypes: ['consultation_fee'],
      amount: 100,
    },
    {
      metric: 'test_commission',
      expectedTypes: ['lab_test', 'referral'],
      amount: 250,
    },
    {
      metric: 'other_doctor_commission',
      expectedTypes: ['procedure', 'ipd_round'],
      amount: 50,
    },
  ])('restricts $metric drilldown to its own source types', async ({ metric, expectedTypes, amount }) => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        if (sql.includes(`executive_commission:${metric}:sources`)) {
          expect(params.slice(3)).toEqual(expectedTypes);
          return { results: [{ source_label: 'Dr A', amount, row_count: expectedTypes.length }] };
        }
        if (sql.includes(`executive_commission:${metric}:details`)) {
          expect(params.slice(3, 3 + expectedTypes.length)).toEqual(expectedTypes);
          return {
            results: expectedTypes.map((sourceType, index) => ({
              id: `${metric}-${index}`,
              occurred_at: '2026-07-10',
              source_type: 'commission',
              source_label: 'Dr A',
              reference_no: `ACCRUAL-${index + 1}`,
              amount: amount / expectedTypes.length,
              status: 'approved',
              service_names: sourceType,
            })),
          };
        }
        return null;
      },
    });

    const response = await app.request(`/dashboard/kpi-breakdown?metric=${metric}&date=2026-07-10`);

    expect(response.status).toBe(200);
    const body = await response.json() as BreakdownBody;
    expect(body.metric).toBe(metric);
    expect(body.total).toBe(amount);
    expect(body.rows.map((row) => row.serviceNames)).toEqual(expectedTypes);
    expect(body.sources).toEqual([{ label: 'Dr A', amount, count: expectedTypes.length }]);

    const allSql = mockDB.queries.map((query) => query.sql).join('\n');
    for (const sourceType of expectedTypes) {
      expect(allSql).not.toContain(`'${sourceType}'`);
    }
  });

  it('rejects unsupported client-defined commission formulas', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=commission_sql');
    expect(response.status).toBe(400);
    expect(mockDB.queries).toHaveLength(0);
  });
});

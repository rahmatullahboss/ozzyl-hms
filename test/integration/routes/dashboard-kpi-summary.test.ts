import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

describe('dashboard KPI summary endpoint', () => {
  it('returns the complete server-whitelisted card set in one source-only response', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/dashboard/kpi-summary?date=2026-07-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      period: { startDate: string; endDate: string };
      metrics: Array<{ metric: string; total: number; valueType: 'money' | 'count' }>;
    };

    expect(body.period).toMatchObject({ startDate: '2026-07-10', endDate: '2026-07-10' });
    expect(body.metrics.map((item) => item.metric)).toEqual([
      'accounting_income',
      'accounting_expenses',
      'accounting_profit',
      'opd_income',
      'lab_income',
      'ipd_collection',
      'ot_income',
      'pharmacy_income',
      'radiology_income',
      'deposit_collection',
      'uncategorized_income',
      'visit_commission',
      'test_commission',
      'total_commission',
      'other_doctor_commission',
      'total_visits',
      'lab_tests_completed',
      'cash_received',
      'cash_movement',
      'drawer_cash',
      'pending_approvals',
      'inventory_stock_skus',
      'inventory_low_stock',
      'inventory_out_of_stock',
      'inventory_expiring_soon',
      'inventory_expired',
      'inventory_pending_purchase',
      'lab_reagent_consumed',
      'lab_reagent_stock_skus',
      'lab_reagent_low_stock',
      'lab_reagent_out_of_stock',
      'lab_reagent_expiring_soon',
      'lab_reagent_qc_issues',
      'unmapped_lab_tests',
      'consumption_exceptions',
      'radiology_exams_completed',
      'radiology_stock_skus',
      'radiology_low_stock',
      'radiology_out_of_stock',
      'radiology_expiring_soon',
      'radiology_issue_lines',
    ]);
    expect(body.metrics.find((item) => item.metric === 'total_visits')?.valueType).toBe('count');
    expect(body.metrics.find((item) => item.metric === 'pending_approvals')?.valueType).toBe('count');
    expect(body.metrics.every((item) => Number.isFinite(item.total))).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('limit ? offset ?'))).toBe(false);
  });

  it('returns only requested enabled metrics and skips disabled inventory domains', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_inventory:inventory_low_stock:summary')) return { results: [{ total: 4 }] };
        if (lower.includes('executive_inventory:radiology_exams_completed:summary')) return { results: [{ total: 6 }] };
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-summary?date=2026-07-10&metrics=inventory_low_stock,radiology_exams_completed');
    expect(response.status).toBe(200);
    const body = await response.json() as { metrics: Array<{ metric: string; total: number }> };
    expect(body.metrics).toEqual([
      expect.objectContaining({ metric: 'inventory_low_stock', total: 4 }),
      expect.objectContaining({ metric: 'radiology_exams_completed', total: 6 }),
    ]);
    const inventoryQueries = mockDB.queries.map((query) => query.sql).filter((sql) => sql.includes('executive_inventory:'));
    expect(inventoryQueries.some((sql) => sql.includes('inventory_low_stock:summary'))).toBe(true);
    expect(inventoryQueries.some((sql) => sql.includes('radiology_exams_completed:summary'))).toBe(true);
    expect(inventoryQueries.some((sql) => sql.includes('lab_tests_completed:summary'))).toBe(false);
    expect(inventoryQueries.some((sql) => sql.includes('inventory_stock_skus:summary'))).toBe(false);

    const allSql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(allSql).not.toContain('payment_allocations');
    expect(allSql).not.toContain('from expenses e');
    expect(allSql).not.toContain('from cash_drawer_movements');
    expect(allSql).not.toContain('from billing_counter_sessions s');
  });

  it('ignores panel registry keys instead of executing panel or KPI SQL through the card summary', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/dashboard/kpi-summary?date=2026-07-10&metrics=doctor_performance_table,reagent_reconciliation_table');
    expect(response.status).toBe(200);
    const body = await response.json() as { metrics: unknown[] };
    expect(body.metrics).toEqual([]);
    expect(mockDB.queries).toHaveLength(0);
  });

  it('returns each non-IPD collection category from one shared allocation query', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payment_allocations') && lower.includes('group by source_label')) {
          return {
            results: [
              { source_label: 'OPD', amount: 500, row_count: 2 },
              { source_label: 'OT', amount: 200, row_count: 1 },
              { source_label: 'Pharmacy', amount: 100, row_count: 1 },
              { source_label: 'Radiology', amount: 75, row_count: 1 },
              { source_label: 'Uncategorized', amount: 25, row_count: 1 },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-summary?date=2026-07-10&metrics=opd_income,ot_income,pharmacy_income,radiology_income,uncategorized_income');
    expect(response.status).toBe(200);
    const body = await response.json() as { metrics: Array<{ metric: string; total: number }> };
    expect(body.metrics).toEqual([
      expect.objectContaining({ metric: 'opd_income', total: 500 }),
      expect.objectContaining({ metric: 'ot_income', total: 200 }),
      expect.objectContaining({ metric: 'pharmacy_income', total: 100 }),
      expect.objectContaining({ metric: 'radiology_income', total: 75 }),
      expect.objectContaining({ metric: 'uncategorized_income', total: 25 }),
    ]);
    expect(mockDB.queries.filter((query) => query.sql.toLowerCase().includes('from payment_allocations')).length).toBe(1);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('from billing_deposits d'))).toBe(false);
  });

  it('includes patient deposits in Total Collection and calculates Net Income from the complete expense total', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payment_allocations') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'OPD', amount: 14_700, row_count: 12 }] };
        }
        if (lower.includes('from billing_deposits d') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'deposit_collection', amount: 300, row_count: 1 }] };
        }
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'Operating expenses', amount: 2_190, row_count: 3 }] };
        }
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement') && lower.includes('group by')) {
          return { results: [{ source_label: 'Doctor payouts', amount: 5_528, row_count: 4 }] };
        }
        if (lower.includes("transaction_type = 'salesreturn'")) return { results: [] };
        return null;
      },
    });

    const response = await app.request('/dashboard/kpi-summary?date=2026-07-10&metrics=accounting_income,accounting_expenses,accounting_profit');
    expect(response.status).toBe(200);
    const body = await response.json() as { metrics: Array<{ metric: string; total: number }> };

    expect(body.metrics).toEqual([
      expect.objectContaining({ metric: 'accounting_income', total: 15_000 }),
      expect.objectContaining({ metric: 'accounting_expenses', total: 7_718 }),
      expect.objectContaining({ metric: 'accounting_profit', total: 7_282 }),
    ]);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('from billing_deposits d'))).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('limit ? offset ?'))).toBe(false);
  });

  it('keeps the Net Income card total equal to its drilldown total', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payment_allocations') && lower.includes('group by source_label')) {
          if (lower.includes('where source_label in (?)')) {
            return { results: [{ source_label: 'Other', amount: 0, row_count: 0 }] };
          }
          return { results: [{ source_label: 'OPD', amount: 1000, row_count: 2 }] };
        }
        if (lower.includes('from payment_allocations pa') && lower.includes('order by pa.occurred_at desc')) {
          return { results: [] };
        }
        if (lower.includes("where source_label = 'lab'") && lower.includes('group by service_name')) {
          return { results: [] };
        }
        if (lower.includes("where pa.source_label = 'lab'")) return { results: [] };
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'utilities', amount: 200, row_count: 1 }] };
        }
        if (lower.includes('from expenses e') && lower.includes('order by occurred_at desc')) return { results: [] };
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement') && lower.includes('group by')) {
          return { results: [{ source_label: 'Doctor payouts', amount: 300, row_count: 1 }] };
        }
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement')) return { results: [] };
        if (lower.includes('from emp_cash_transactions') && lower.includes("transaction_type = 'salesreturn'") && lower.includes('group by')) {
          return { results: [{ source_label: 'Sales returns / refunds', amount: 100, row_count: 1 }] };
        }
        if (lower.includes('from emp_cash_transactions') && lower.includes("transaction_type = 'salesreturn'")) return { results: [] };
        return null;
      },
    });

    const summaryRes = await app.request('/dashboard/kpi-summary?date=2026-07-10');
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json() as { metrics: Array<{ metric: string; total: number }> };
    const cardTotal = summary.metrics.find((item) => item.metric === 'accounting_profit')?.total;

    const drilldownRes = await app.request('/dashboard/kpi-breakdown?metric=accounting_profit&date=2026-07-10');
    expect(drilldownRes.status).toBe(200);
    const drilldown = await drilldownRes.json() as { total: number };

    expect(cardTotal).toBe(500);
    expect(drilldown.total).toBe(500);
    expect(cardTotal).toBe(drilldown.total);
  });

  it('sums every active drawer instead of using only the first counter', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from billing_counter_sessions s') && lower.includes("s.status = 'active'")) {
          return {
            results: [
              { id: 'drawer-1', occurred_at: '2026-07-10', source_type: 'drawer', source_label: 'Counter A', reference_no: 'SESSION-1', amount: 120, status: 'active' },
              { id: 'drawer-2', occurred_at: '2026-07-10', source_type: 'drawer', source_label: 'Counter B', reference_no: 'SESSION-2', amount: 180, status: 'active' },
            ],
          };
        }
        return null;
      },
    });

    const summaryRes = await app.request('/dashboard/kpi-summary?date=2026-07-10');
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json() as { metrics: Array<{ metric: string; total: number }> };
    expect(summary.metrics.find((item) => item.metric === 'drawer_cash')?.total).toBe(300);

    const drilldownRes = await app.request('/dashboard/kpi-breakdown?metric=drawer_cash&date=2026-07-10&pageSize=1');
    expect(drilldownRes.status).toBe(200);
    const drilldown = await drilldownRes.json() as { total: number; totalRows: number; rows: unknown[] };
    expect(drilldown.total).toBe(300);
    expect(drilldown.totalRows).toBe(2);
    expect(drilldown.rows).toHaveLength(2);
  });

  it('resolves an explicit custom executive date range', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/dashboard/kpi-summary?preset=custom&startDate=2026-07-01&endDate=2026-07-31&metrics=inventory_low_stock');
    expect(res.status).toBe(200);
    const body = await res.json() as { period: { startDate: string; endDate: string; label: string } };
    expect(body.period).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      label: '2026-07-01 → 2026-07-31',
    });
  });

  it('rejects malformed and inverted date ranges before querying KPI sources', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const malformed = await app.request('/dashboard/kpi-summary?date=10-07-2026');
    expect(malformed.status).toBe(400);

    const inverted = await app.request('/dashboard/kpi-summary?preset=custom&startDate=2026-07-31&endDate=2026-07-01');
    expect(inverted.status).toBe(400);
    expect(mockDB.queries).toHaveLength(0);
  });
});

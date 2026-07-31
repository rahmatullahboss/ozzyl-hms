import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp, jsonRequest } from '../helpers/test-app';

type ConfigResponse = {
  dashboardKey: string;
  items: Array<{
    metricKey: string;
    section: 'management' | 'doctor_performance' | 'test_performance' | 'income_analysis' | 'expense_analysis' | 'cash_control' | 'approvals' | 'inventory' | 'lab_reagent' | 'radiology_stock';
    kind: 'card' | 'panel';
    enabled: boolean;
    position: number;
    label: string;
    labelOverride: string | null;
  }>;
};

describe('dashboard KPI tenant configuration', () => {
  it('returns safe registry defaults when a tenant has no overrides', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.toLowerCase().includes('from dashboard_kpi_config') ? { results: [] } : null,
    });

    const res = await app.request('/dashboard/kpi-config');
    expect(res.status).toBe(200);
    const body = await res.json() as ConfigResponse;
    expect(body.dashboardKey).toBe('executive');
    expect(body.items.map((item) => item.metricKey)).toEqual([
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
      'doctor_performance_table',
      'uncategorized_income',
      'total_visits',
      'visit_commission',
      'test_commission',
      'total_commission',
      'other_doctor_commission',
      'test_volume_table',
      'lab_tests_completed',
      'income_service_breakdown',
      'expense_source_breakdown',
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
      'reagent_reconciliation_table',
      'radiology_exams_completed',
      'radiology_stock_skus',
      'radiology_low_stock',
      'radiology_out_of_stock',
      'radiology_expiring_soon',
      'radiology_issue_lines',
    ]);
    expect(body.items.find((item) => item.metricKey === 'accounting_income')).toMatchObject({ label: 'Total Collection', kind: 'card', enabled: true, position: 0, section: 'management' });
    expect(body.items.find((item) => item.metricKey === 'doctor_performance_table')).toMatchObject({ kind: 'panel', enabled: true, position: 10, section: 'doctor_performance' });
    expect(body.items.find((item) => item.metricKey === 'total_visits')).toMatchObject({ kind: 'card', enabled: false, position: 11, section: 'doctor_performance' });
    expect(body.items.find((item) => item.metricKey === 'reagent_reconciliation_table')).toMatchObject({ kind: 'panel', position: 89, section: 'lab_reagent' });
    expect(body.items.findIndex((item) => item.metricKey === 'inventory_stock_skus')).toBeGreaterThan(body.items.findIndex((item) => item.metricKey === 'pending_approvals'));
  });

  it('merges only tenant-scoped persisted overrides into the registry', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-2',
      queryOverride: (sql) => sql.toLowerCase().includes('from dashboard_kpi_config')
        ? { results: [{ metric_key: 'lab_income', enabled: 0, position: 1, label_override: 'Diagnostics' }] }
        : null,
    });

    const res = await app.request('/dashboard/kpi-config');
    expect(res.status).toBe(200);
    const body = await res.json() as ConfigResponse;
    expect(body.items.find((item) => item.metricKey === 'lab_income')).toMatchObject({ enabled: false, position: 1, label: 'Diagnostics', labelOverride: 'Diagnostics' });
    const select = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from dashboard_kpi_config'));
    expect(select?.params).toEqual(['tenant-2', 'executive']);
  });

  it('rejects unknown metrics and arbitrary formula fields before writing', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/dashboard/kpi-config', {
      method: 'PUT',
      body: {
        items: [{ metricKey: 'custom_sql', enabled: true, position: 0, labelOverride: 'Unsafe', formula: 'SELECT * FROM users' }],
      },
    });
    expect(res.status).toBe(400);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into dashboard_kpi_config'))).toBe(false);
  });

  it('upserts validated overrides with tenant and actor scoping', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 77,
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('insert into dashboard_kpi_config')) return { success: true, meta: { changes: 1 } };
        if (sql.toLowerCase().includes('from dashboard_kpi_config')) return { results: [{ metric_key: 'lab_income', enabled: 1, position: 0, label_override: 'Diagnostics' }] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/dashboard/kpi-config', {
      method: 'PUT',
      body: { items: [{ metricKey: 'lab_income', enabled: true, position: 0, labelOverride: 'Diagnostics' }] },
    });
    expect(res.status).toBe(200);
    const insert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into dashboard_kpi_config'));
    expect(insert?.params).toEqual(['tenant-1', 'executive', 'lab_income', 1, 0, 'Diagnostics', '77']);
  });

  it('returns the complete persisted configuration after a partial update', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 77,
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('insert into dashboard_kpi_config')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('from dashboard_kpi_config')) {
          return {
            results: [
              { metric_key: 'accounting_income', enabled: 0, position: 9, label_override: 'Collections' },
              { metric_key: 'lab_income', enabled: 1, position: 0, label_override: 'Diagnostics' },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/dashboard/kpi-config', {
      method: 'PUT',
      body: { items: [{ metricKey: 'lab_income', enabled: true, position: 0, labelOverride: 'Diagnostics' }] },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as ConfigResponse;
    expect(body.items.find((item) => item.metricKey === 'accounting_income')).toMatchObject({
      enabled: false,
      position: 9,
      label: 'Collections',
    });
    expect(body.items.find((item) => item.metricKey === 'lab_income')).toMatchObject({
      enabled: true,
      position: 0,
      label: 'Diagnostics',
    });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('from dashboard_kpi_config'))).toBe(true);
  });

  it('allows finance users to read configuration but not edit it', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.toLowerCase().includes('from dashboard_kpi_config') ? { results: [] } : null,
    });

    expect((await app.request('/dashboard/kpi-config')).status).toBe(200);
    const put = await jsonRequest(app, '/dashboard/kpi-config', { method: 'PUT', body: { items: [] } });
    expect(put.status).toBe(403);
  });
});

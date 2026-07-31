import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

describe('admin dashboard control-room KPI drilldowns', () => {
  it('accepts billing, due, deposit, and drawer metrics', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('billing_counter_sessions')) return { results: [] };
        if (lower.includes('union all')) return { results: [] };
        if (lower.includes('group by source_label')) return { results: [] };
        if (lower.includes('as total') || lower.includes('as row_count')) return { results: [{ total: 0, row_count: 0 }] };
        return null;
      },
    });

    for (const metric of ['cash_received', 'billing_collection', 'due_collection', 'deposit_collection', 'drawer_cash']) {
      const res = await app.request(`/dashboard/kpi-breakdown?metric=${metric}&date=2026-06-23`);
      expect(res.status).toBe(200);
      const body = await res.json() as { metric: string; sources: unknown[]; rows: unknown[] };
      expect(body.metric).toBe(metric);
      expect(Array.isArray(body.sources)).toBe(true);
      expect(Array.isArray(body.rows)).toBe(true);
    }
  });
});

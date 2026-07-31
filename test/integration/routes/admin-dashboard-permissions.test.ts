import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

const enabledFlag = {
  tenant_id: 'tenant-1',
  flag_key: 'admin_command_center_v2',
  mode: 'shadow',
  is_enabled: 1,
};

describe('admin dashboard overview permissions', () => {
  it('rejects roles outside the existing admin dashboard allow-list', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'reception',
      tenantId: 'tenant-1',
      tables: { canonical_feature_flags: [enabledFlag] },
    });

    const response = await app.request('/dashboard/admin-overview-v2?preset=today');
    expect(response.status).toBe(403);
  });

  it('maps accountant to the accountant preset and excludes inventory-only fields', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      tenantId: 'tenant-1',
      tables: { canonical_feature_flags: [enabledFlag] },
    });

    const response = await app.request('/dashboard/admin-overview-v2?preset=today');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.filters.rolePreset).toBe('accountant');
    expect(body.primaryMetrics.map((metric: any) => metric.key)).not.toContain('critical_inventory_exceptions');
    expect(body.permissions.financialOverviewVisible).toBe(true);
  });

  it('maps manager to operations preset and does not expose patient identifiers', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'manager',
      tenantId: 'tenant-1',
      tables: { canonical_feature_flags: [enabledFlag] },
    });

    const response = await app.request('/dashboard/admin-overview-v2?preset=today');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.filters.rolePreset).toBe('manager_operations');
    expect(body.permissions.patientIdentifiersVisible).toBe(false);
  });
});

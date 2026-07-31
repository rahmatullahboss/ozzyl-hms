import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

const enabledFlag = {
  tenant_id: 'tenant-1',
  flag_key: 'admin_command_center_v2',
  mode: 'shadow',
  is_enabled: 1,
};

describe('admin dashboard overview v2 route', () => {
  it('keeps the new endpoint hidden while existing KPI summary remains available when the flag is off', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const overview = await app.request('/dashboard/admin-overview-v2?preset=today');
    expect(overview.status).toBe(404);

    const legacy = await app.request('/dashboard/kpi-summary?preset=today&metrics=pending_approvals');
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({
      metrics: [{ metric: 'pending_approvals', total: 0 }],
    });
  });

  it('exposes the command center on the exact comparison preview host without a tenant flag', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const preview = await app.request('https://command-center.ozzyl.com/dashboard/admin-overview-v2?preset=today');
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ reportKey: 'admin_control_center' });

    const normal = await app.request('https://hms.ozzyl.com/dashboard/admin-overview-v2?preset=today');
    expect(normal.status).toBe(404);
  });

  it('exposes the command center for the exact dashboard-v2 comparison route token', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const preview = await app.request('/dashboard/admin-overview-v2?preset=today&preview=dashboard-v2');
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ reportKey: 'admin_control_center' });

    const malformed = await app.request('/dashboard/admin-overview-v2?preset=today&preview=dashboard-v2-extra');
    expect(malformed.status).toBe(404);
  });

  it('returns a bounded semantic overview for an enabled tenant', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { canonical_feature_flags: [enabledFlag] },
    });

    const response = await app.request('/dashboard/admin-overview-v2?preset=today');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;

    expect(body).toMatchObject({
      reportKey: 'admin_control_center',
      reportVersion: '2.0.0',
      timezone: 'Asia/Dhaka',
      currencyCode: 'BDT',
      moneyUnit: 'major',
      filters: {
        preset: 'today',
        rolePreset: 'hospital_admin',
      },
    });
    expect(typeof body.generatedAt).toBe('string');
    expect(body.primaryMetrics.length).toBeLessThanOrEqual(10);
    expect(body.health).toHaveProperty('state');
    expect(body.health).toHaveProperty('warnings');

    const unsupported = body.primaryMetrics.find((metric: any) => metric.key === 'doctor_payable_outstanding');
    expect(unsupported).toMatchObject({
      value: null,
      sourceStatus: { state: 'unavailable' },
    });
  });

  it('returns comparison period metadata when requested', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { canonical_feature_flags: [enabledFlag] },
    });

    const response = await app.request('/dashboard/admin-overview-v2?preset=7d&comparisonMode=previous_period');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.comparisonPeriod).toMatchObject({
      startDate: expect.any(String),
      endDate: expect.any(String),
      label: expect.any(String),
    });
  });

  it('rejects an invalid reporting period', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { canonical_feature_flags: [enabledFlag] },
    });

    const response = await app.request('/dashboard/admin-overview-v2?preset=custom&startDate=2026-07-31&endDate=2026-07-01');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid dashboard reporting context' });
  });
});

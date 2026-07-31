import { describe, it, expect } from 'vitest';
import admissionsRoute from '../src/routes/tenant/admissions';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: admissionsRoute,
    routePath: '/admissions',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin IPD Monitor — /api/admissions/stats', () => {
  it('returns frontend-required stats shape with cleaning, maintenance, reserved, occupancyPercentage', async () => {
    const { app } = makeApp();

    const res = await app.request('/admissions/stats');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;

    // Frontend IPDMonitor.tsx:39-50 expects these exact fields
    expect(stats).toHaveProperty('totalBeds');
    expect(stats).toHaveProperty('occupied');
    expect(stats).toHaveProperty('available');
    expect(stats).toHaveProperty('cleaning');
    expect(stats).toHaveProperty('maintenance');
    expect(stats).toHaveProperty('reserved');
    expect(stats).toHaveProperty('occupancyPercentage');
    expect(stats).toHaveProperty('dischargesToday');
    expect(stats).toHaveProperty('avgStayDays');
  });

  it('returns wards array for bed map view', async () => {
    const { app } = makeApp();

    const res = await app.request('/admissions/stats');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('wards');
    expect(Array.isArray(body.wards)).toBe(true);
  });

  it('returns admissions array for patient list view', async () => {
    const { app } = makeApp();

    const res = await app.request('/admissions/stats');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('admissions');
    expect(Array.isArray(body.admissions)).toBe(true);
  });

  it('returns dischargePending array for discharge pending view', async () => {
    const { app } = makeApp();

    const res = await app.request('/admissions/stats');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('dischargePending');
    expect(Array.isArray(body.dischargePending)).toBe(true);
  });
});

describe('Admin IPD Monitor — empty-data path', () => {
  it('returns 200 with zero stats and empty arrays when no beds/admissions exist', async () => {
    const { app } = createTestApp({
      route: admissionsRoute,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admissions/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    expect(stats.totalBeds).toBe(0);
    expect(stats.occupied).toBe(0);
    expect(stats.available).toBe(0);
    expect(stats.occupancyPercentage).toBe(0);
    expect(Array.isArray(body.wards)).toBe(true);
    expect(Array.isArray(body.admissions)).toBe(true);
    expect(Array.isArray(body.dischargePending)).toBe(true);
  });

  it('returns single ward when exactly one bed exists', async () => {
    const { app } = createTestApp({
      route: admissionsRoute,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
      tables: {
        beds: [{ id: 1, tenant_id: TENANT_ID, bed_number: 'A-01', ward_name: 'General', status: 'available' }],
        admissions: [],
      },
    });
    const res = await app.request('/admissions/stats');
    const body = await res.json() as Record<string, unknown>;
    const wards = body.wards as Array<{ name: string; beds: unknown[] }>;
    expect(wards.length).toBe(1);
    expect(wards[0].name).toBe('General');
    expect(wards[0].beds.length).toBe(1);
  });
});

describe('Admin IPD Monitor — auth boundary', () => {
  it('requires tenantId: returns 401/403 when no tenant is set', async () => {
    // No-tenant case: requireTenantId throws → onError returns 401/403
    const { app } = createTestAppNoRole({
      route: admissionsRoute,
      routePath: '/admissions',
      tenantId: '', // no tenant
    });
    const res = await app.request('/admissions/stats');
    expect([401, 403]).toContain(res.status);
  });
});

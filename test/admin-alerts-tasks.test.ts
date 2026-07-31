import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/withActionCenterCollections';
import { createTestApp } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp() {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
  });
}

describe('Admin Alerts & Tasks endpoints (tenant-scoped, not super-admin)', () => {
  it('GET /admin/alerts returns alerts array + summary with totals', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('alerts');
    expect(Array.isArray(body.alerts)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('total');
    expect(summary).toHaveProperty('critical');
    expect(summary).toHaveProperty('warning');
    expect(summary).toHaveProperty('info');
  });

  it('GET /admin/tasks returns tasks array + summary with totals', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/tasks');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('tasks');
    expect(Array.isArray(body.tasks)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('total');
    expect(summary).toHaveProperty('pending');
    expect(summary).toHaveProperty('inProgress');
    expect(summary).toHaveProperty('completed');
    expect(summary).toHaveProperty('overdue');
  });
});

describe('Admin Alerts — empty-data path', () => {
  it('returns 200 with valid shape (catch block returns empty defaults)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.alerts)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(typeof summary.total).toBe('number');
    expect(typeof summary.critical).toBe('number');
    expect(typeof summary.warning).toBe('number');
    expect(typeof summary.info).toBe('number');
  });
});

describe('Admin Tasks — empty-data path', () => {
  it('returns 200 with valid shape (catch block returns empty defaults)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/tasks');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.tasks)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(typeof summary.total).toBe('number');
    expect(typeof summary.pending).toBe('number');
    expect(typeof summary.inProgress).toBe('number');
    expect(typeof summary.completed).toBe('number');
    expect(typeof summary.overdue).toBe('number');
  });
});

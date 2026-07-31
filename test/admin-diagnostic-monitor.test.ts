import { describe, it, expect } from 'vitest';
import labRoute from '../src/routes/tenant/lab';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: labRoute,
    routePath: '/lab',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin Diagnostic Monitor — /api/lab/orders/queue/today', () => {
  it('returns stats with totalToday, samplePending, processing, reportReady, delayed, critical', async () => {
    const { app } = makeApp();
    const res = await app.request('/lab/orders/queue/today');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    expect(stats).toHaveProperty('totalToday');
    expect(stats).toHaveProperty('samplePending');
    expect(stats).toHaveProperty('processing');
    expect(stats).toHaveProperty('reportReady');
    expect(stats).toHaveProperty('delayed');
    expect(stats).toHaveProperty('critical');
  });

  it('returns items array and criticalAlerts array', async () => {
    const { app } = makeApp();
    const res = await app.request('/lab/orders/queue/today');
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body).toHaveProperty('criticalAlerts');
    expect(Array.isArray(body.criticalAlerts)).toBe(true);
  });
});

describe('Admin Diagnostic Monitor — empty queue', () => {
  it('returns 200 with valid shape (universalFallback may produce rows)', async () => {
    const { app } = createTestApp({
      route: labRoute,
      routePath: '/lab',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/lab/orders/queue/today');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    // Pin the contract shape — universalFallback mock returns a generic
    // row so stats may be 1 not 0, but the field types must be numeric.
    expect(typeof stats.totalToday).toBe('number');
    expect(typeof stats.samplePending).toBe('number');
    expect(typeof stats.processing).toBe('number');
    expect(typeof stats.reportReady).toBe('number');
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.criticalAlerts)).toBe(true);
  });
});

describe('Admin Diagnostic Monitor — tenant auth boundary', () => {
  it('returns 401/403 when no tenant is set', async () => {
    const { app } = createTestAppNoRole({
      route: labRoute,
      routePath: '/lab',
      tenantId: '',
    });
    const res = await app.request('/lab/orders/queue/today');
    expect([401, 403]).toContain(res.status);
  });
});

import { describe, it, expect } from 'vitest';
import queueRoute from '../src/routes/tenant/queue';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: queueRoute,
    routePath: '/queue',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin OPD Monitor — /api/queue/tokens/overview', () => {
  it('returns stats and tokens at root (NOT wrapped in Results)', async () => {
    const { app } = makeApp();

    const res = await app.request('/queue/tokens/overview');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;

    // Frontend OPDMonitor.tsx:25-36 expects these at root
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('tokens');
    expect(body).toHaveProperty('delayedDoctors');
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(Array.isArray(body.delayedDoctors)).toBe(true);
  });

  it('stats object has frontend-required fields', async () => {
    const { app } = makeApp();

    const res = await app.request('/queue/tokens/overview');
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;

    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('waiting');
    expect(stats).toHaveProperty('serving');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('noShow');
    expect(stats).toHaveProperty('cancelled');
  });
});

describe('Admin OPD Monitor — empty-data path', () => {
  it('returns 200 with zero stats and empty tokens array when no queue rows exist', async () => {
    const { app } = createTestApp({
      route: queueRoute,
      routePath: '/queue',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/queue/tokens/overview');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    expect(stats.total).toBe(0);
    expect(stats.waiting).toBe(0);
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(Array.isArray(body.delayedDoctors)).toBe(true);
  });
});

describe('Admin OPD Monitor — date filter', () => {
  it('returns 200 with stats for an explicit date', async () => {
    const { app } = makeApp();
    const res = await app.request('/queue/tokens/overview?date=2026-06-11');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('stats');
  });
});

describe('Admin OPD Monitor — tenant auth boundary', () => {
  it('returns 401/403 when no tenant is set', async () => {
    const { app } = createTestAppNoRole({
      route: queueRoute,
      routePath: '/queue',
      tenantId: '',
    });
    const res = await app.request('/queue/tokens/overview');
    expect([401, 403]).toContain(res.status);
  });
});

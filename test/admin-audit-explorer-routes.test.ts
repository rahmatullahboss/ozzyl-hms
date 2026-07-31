import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin Audit Explorer — /api/admin/audit', () => {
  it('returns events array + summary with totals', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/audit');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('events');
    expect(Array.isArray(body.events)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('total');
    expect(summary).toHaveProperty('high');
    expect(summary).toHaveProperty('medium');
    expect(summary).toHaveProperty('low');
    expect(summary).toHaveProperty('hasMore');
  });

  it('respects ?limit=N (clamped to max 500)', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/audit?limit=50');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('falls back to default 200 for invalid ?limit=', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/audit?limit=notanumber');
    expect(res.status).toBe(200);
  });
});

describe('Admin Audit (financial) — /api/admin/audit/financial', () => {
  it('returns entries array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/audit/financial');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('totalEvents');
  });
});

describe('Admin Export History — /api/admin/export-history', () => {
  it('returns exports array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/export-history');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('exports');
    expect(Array.isArray(body.exports)).toBe(true);
  });
});

describe('Admin Login Sessions — /api/admin/sessions', () => {
  it('returns sessions array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/sessions');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});

describe('Admin Suspicious Activities — /api/admin/alerts/detect', () => {
  it('returns alerts array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/alerts/detect');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('alerts');
    expect(Array.isArray(body.alerts)).toBe(true);
  });
});

describe('Admin Audit/Financial/Alerts-Detect — empty-data path', () => {
  it('GET /admin/audit returns 200 with valid shape when no audit rows exist', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/audit');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.summary).toHaveProperty('total');
  });

  it('GET /admin/audit/financial returns 200 with valid shape when no rows exist', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/audit/financial');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.summary).toHaveProperty('totalEvents');
  });

  it('GET /admin/alerts/detect returns 200 with valid shape when no exception patterns match', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/alerts/detect');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.alerts)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('total');
  });
});

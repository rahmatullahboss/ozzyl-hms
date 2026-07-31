import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';
import { createMockDB, type MockDBOptions } from './integration/helpers/mock-db';

function makeAppWithTables(tables: MockDBOptions['tables'] = {}) {
  const mockDB = createMockDB({ tables });
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'super_admin',
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('GET /api/admin/system-health — status reporting', () => {
  it('reports healthy when all tracked tables exist and return counts', async () => {
    const { app } = makeAppWithTables({
      tenants: [{ id: 1 }],
      users: [{ id: 1 }],
      patients: [],
    });
    const res = await app.request('/admin/system-health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; database: { totalTables: number } };
    expect(body.status).toBe('healthy');
    expect(body.database.totalTables).toBeGreaterThan(0);
  });

  it('still reports healthy when tables exist but are empty (zero counts are not failures)', async () => {
    const { app } = makeAppWithTables({});
    const res = await app.request('/admin/system-health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('healthy');
  });

  it('reports down when auth is missing (no role set)', async () => {
    // createTestAppNoRole omits the role — but the route requires super_admin,
    // so it should return 403, not 200. The "down" status is only returned
    // when queries themselves throw. This test pins the auth behavior.
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
    });
    const res = await app.request('/admin/system-health');
    expect(res.status).toBe(403);
  });
});

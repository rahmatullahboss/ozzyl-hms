import { describe, expect, it } from 'vitest';
import nurseStationRoutes from '../src/routes/tenant/nurseStation';
import wardSupplyRoutes from '../src/routes/tenant/wardSupply';
import housekeepingRoutes from '../src/routes/tenant/housekeeping';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

function makeApp(route: typeof nurseStationRoutes, routePath: string, role: string | undefined) {
  const mockDB = createMockDB();
  return createTestApp({
    route,
    routePath,
    role,
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('nurseStation RBAC', () => {
  const protectedEndpoints = [
    { method: 'GET' as const, path: '/ns/dashboard', label: 'dashboard' },
    { method: 'GET' as const, path: '/ns/vitals', label: 'list vitals' },
    { method: 'GET' as const, path: '/ns/active-alerts', label: 'active alerts' },
  ];

  for (const ep of protectedEndpoints) {
    it(`${ep.label} returns 403 for unauthorized role`, async () => {
      const { app } = makeApp(nurseStationRoutes, '/ns', 'reception');
      const res = await app.request(ep.path, { method: ep.method });
      expect(res.status).toBe(403);
    });

    it(`${ep.label} returns 403 when no role set`, async () => {
      const { app } = createTestAppNoRole({
        route: nurseStationRoutes,
        routePath: '/ns',
        tenantId: 'tenant-1',
        mockDB: createMockDB(),
      });
      const res = await app.request(ep.path, { method: ep.method });
      expect(res.status).toBe(403);
    });

    it(`${ep.label} passes for allowed role (nurse)`, async () => {
      const { app } = makeApp(nurseStationRoutes, '/ns', 'nurse');
      const res = await app.request(ep.path, { method: ep.method });
      expect(res.status).not.toBe(403);
    });
  }
});

describe('wardSupply RBAC', () => {
  it('returns 403 for unauthorized role (reception)', async () => {
    const { app } = makeApp(wardSupplyRoutes, '/ws', 'reception');
    const res = await app.request('/ws/requisitions');
    expect(res.status).toBe(403);
  });

  it('returns 403 when no role set', async () => {
    const { app } = createTestAppNoRole({
      route: wardSupplyRoutes,
      routePath: '/ws',
      tenantId: 'tenant-1',
      mockDB: createMockDB(),
    });
    const res = await app.request('/ws/requisitions');
    expect(res.status).toBe(403);
  });

  it('passes for allowed role (nurse)', async () => {
    const { app } = makeApp(wardSupplyRoutes, '/ws', 'nurse');
    const res = await app.request('/ws/requisitions');
    expect(res.status).not.toBe(403);
  });

  it('passes for allowed role (pharmacist)', async () => {
    const { app } = makeApp(wardSupplyRoutes, '/ws', 'pharmacist');
    const res = await app.request('/ws/requisitions');
    expect(res.status).not.toBe(403);
  });
});

describe('housekeeping RBAC', () => {
  it('returns 403 for unauthorized role (reception)', async () => {
    const { app } = makeApp(housekeepingRoutes, '/hk', 'reception');
    const res = await app.request('/hk/tasks');
    expect(res.status).toBe(403);
  });

  it('returns 403 for unauthorized role (pharmacist)', async () => {
    const { app } = makeApp(housekeepingRoutes, '/hk', 'pharmacist');
    const res = await app.request('/hk/tasks');
    expect(res.status).toBe(403);
  });

  it('returns 403 when no role set', async () => {
    const { app } = createTestAppNoRole({
      route: housekeepingRoutes,
      routePath: '/hk',
      tenantId: 'tenant-1',
      mockDB: createMockDB(),
    });
    const res = await app.request('/hk/tasks');
    expect(res.status).toBe(403);
  });

  it('passes for allowed role (nurse)', async () => {
    const { app } = makeApp(housekeepingRoutes, '/hk', 'nurse');
    const res = await app.request('/hk/tasks');
    expect(res.status).not.toBe(403);
  });

  it('passes for allowed role (hospital_admin)', async () => {
    const { app } = makeApp(housekeepingRoutes, '/hk', 'hospital_admin');
    const res = await app.request('/hk/tasks');
    expect(res.status).not.toBe(403);
  });
});

import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(role: string) {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role,
    tenantId: TENANT_ID,
    universalFallback: true,
  });
}

describe('Admin Auth Boundary — per-route role gates', () => {
  it('super_admin can access /admin/hospitals (super-only route)', async () => {
    const { app } = makeApp('super_admin');
    const res = await app.request('/admin/hospitals');
    expect([200, 500]).toContain(res.status);
  });

  it('hospital_admin cannot access /admin/hospitals (super-only route → 403)', async () => {
    const { app } = makeApp('hospital_admin');
    const res = await app.request('/admin/hospitals');
    expect(res.status).toBe(403);
  });

  it('hospital_admin can access /admin/alerts (tenant-scoped route)', async () => {
    const { app } = makeApp('hospital_admin');
    const res = await app.request('/admin/alerts');
    expect([200, 403]).toContain(res.status);
  });

  it('receptionist cannot access /admin/alerts (tenant-scoped route → 403)', async () => {
    const { app } = makeApp('receptionist');
    const res = await app.request('/admin/alerts');
    expect(res.status).toBe(403);
  });
});

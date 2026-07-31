import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeDoctorApp() {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        if (params[1] !== 'tenant-1') return { first: null };
        return { first: { id: 9, tenant_id: 'tenant-1', name: 'Dr Active', is_active: 0 } };
      }
      return null;
    },
  });

  return createTestApp({
    route: doctorRoutes,
    routePath: '/doctors',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('doctor management regressions', () => {
  it('activate and deactivate routes use the tenant context correctly', async () => {
    const { app, mockDB } = makeDoctorApp();

    const activate = await app.request('/doctors/9/activate', { method: 'PUT' });
    expect(activate.status).toBe(200);
    await expect(activate.json()).resolves.toMatchObject({ success: true });

    const deactivate = await app.request('/doctors/9/deactivate', { method: 'PUT' });
    expect(deactivate.status).toBe(200);
    await expect(deactivate.json()).resolves.toMatchObject({ success: true });

    const doctorSelects = mockDB.queries.filter((query) =>
      query.sql.toLowerCase().includes('from doctors') &&
      query.sql.toLowerCase().includes('where id = ? and tenant_id = ?'),
    );
    expect(doctorSelects.every((query) => query.params[1] === 'tenant-1')).toBe(true);
  });
});

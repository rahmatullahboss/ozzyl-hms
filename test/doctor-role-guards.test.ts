import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeApp(role: string) {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      // Mock doctor lookup for activate/deactivate/publish/delete
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        if (params[1] !== 'tenant-1') return { first: null };
        return { first: { id: Number(params[0]), tenant_id: 'tenant-1', name: 'Dr Test', is_active: 1, is_marketplace_visible: 0 } };
      }
      // Mock site settings query (triggered by triggerSiteReRender)
      if (s.includes('from hospital_site_settings')) {
        return { first: null };
      }
      return null;
    },
  });

  return createTestApp({
    route: doctorRoutes,
    routePath: '/doctors',
    role,
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('doctor admin role guards', () => {
  const adminEndpoints: Array<{ method: string; path: string; body?: unknown; label: string }> = [
    { method: 'POST', path: '/doctors', body: { name: 'Dr New', consultationFee: 500 }, label: 'create doctor' },
    { method: 'PUT', path: '/doctors/1', body: { name: 'Dr Updated' }, label: 'update doctor' },
    { method: 'POST', path: '/doctors/1/publish', label: 'publish doctor' },
    { method: 'PUT', path: '/doctors/1/activate', label: 'activate doctor' },
    { method: 'PUT', path: '/doctors/1/deactivate', label: 'deactivate doctor' },
  ];

  for (const endpoint of adminEndpoints) {
    it(`${endpoint.label} returns 403 for doctor role`, async () => {
      const { app } = makeApp('doctor');
      const init: RequestInit = { method: endpoint.method as 'POST' | 'PUT' | 'DELETE' };
      if (endpoint.body) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(endpoint.body);
      }
      const res = await app.request(endpoint.path, init);
      expect(res.status).toBe(403);
    });

    it(`${endpoint.label} returns 403 for nurse role`, async () => {
      const { app } = makeApp('nurse');
      const init: RequestInit = { method: endpoint.method as 'POST' | 'PUT' | 'DELETE' };
      if (endpoint.body) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(endpoint.body);
      }
      const res = await app.request(endpoint.path, init);
      expect(res.status).toBe(403);
    });

    it(`${endpoint.label} succeeds for hospital_admin role`, async () => {
      const { app } = makeApp('hospital_admin');
      const init: RequestInit = { method: endpoint.method as 'POST' | 'PUT' | 'DELETE' };
      if (endpoint.body) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(endpoint.body);
      }
      const res = await app.request(endpoint.path, init);
      // Should not be 403 (may be 200, 201, or 404 depending on mock data)
      expect(res.status).not.toBe(403);
    });
  }
});

describe('doctor dashboard profile resolution', () => {
  it('returns 403 for non-doctor roles before trying profile resolution', async () => {
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'reception',
      tenantId: 'tenant-1',
      mockDB: createMockDB(),
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(403);
  });

  it('returns 404 when user_id and staff.doctor_id have no match (no name fallback)', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: null };
        }
        if (s.includes('from staff')) {
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 999,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'No doctor profile linked');
  });

  it('returns 404 when no doctor profile is linked', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: null };
        }
        if (s.includes('from staff')) {
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 999,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'No doctor profile linked');
  });

  it('resolves doctor via user_id match', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: { id: 5, name: 'Dr Direct', specialty: 'Cardiology', department: 'Medicine', qualifications: 'MBBS', consultation_fee: 500 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(200);
  });

  it('resolves doctor via staff.doctor_id when user_id has no match', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        // user_id direct match — nothing
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: null };
        }
        // staff join — found
        if (s.includes('from staff')) {
          return { first: { id: 7, name: 'Dr ViaStaff', specialty: 'Surgery', department: 'Surgery', qualifications: 'MBBS, FCPS', consultation_fee: 800 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(200);
  });
});

describe('doctor dashboard mutation role guards', () => {
  function makeLinkedNonDoctorDashboardApp() {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 10, name: 'Dr Linked' } };
        }
        if (lower.includes('from appointments') && lower.includes('doctor_id = ?')) {
          return { first: { id: 100, doctor_id: 10, patient_id: 50, status: 'checked_in', appt_date: '2026-06-08', appt_time: null } };
        }
        return null;
      },
      universalFallback: true,
    });

    return createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    }).app;
  }

  it.each([
    ['PUT', '/doctors/dashboard/appointments/100/status', { status: 'completed' }],
    ['PUT', '/doctors/dashboard/appointments/100/reassign', { doctorId: 20, reason: 'Covering duty' }],
    ['POST', '/doctors/dashboard/appointments/100/complete-consultation', { soap: { assessment: 'Stable' }, completeVisit: true }],
  ])('returns 403 for linked non-doctor on %s %s', async (method, path, body) => {
    const app = makeLinkedNonDoctorDashboardApp();
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(403);
  });
});

describe('doctor list performer filters', () => {
  it('filters performer lookup by active lab-test commission rule', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors')) {
          capturedSql = sql;
          capturedParams = params;
          return { results: [{ id: 10, name: 'Dr Performer', specialty: 'Radiology', is_active: 1 }] };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'reception',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/doctors?service_type=lab_test&incentive_type=performer');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.doctors).toHaveLength(1);
    expect(capturedSql).toContain('doctor_commission_rules r');
    expect(capturedSql).toContain('r.is_active = 1');
    expect(capturedSql).toContain('r.service_type = ?');
    expect(capturedSql).toContain('r.incentive_type = ?');
    expect(capturedParams).toEqual(['tenant-1', 'lab_test', 'performer']);
  });
});


describe('doctor permissions in authz catalog', () => {
  it('doctor role includes schedule:read and doctor:read', async () => {
    const { getPermissionsForRole } = await import('../packages/shared/src/authz');
    const perms = getPermissionsForRole('doctor');
    expect(perms).toContain('schedule:read');
    expect(perms).toContain('doctor:read');
  });

  it('ALL_PERMISSIONS includes doctor:read and doctor:write', async () => {
    const { ALL_PERMISSIONS } = await import('../packages/shared/src/authz');
    expect(ALL_PERMISSIONS).toContain('doctor:read');
    expect(ALL_PERMISSIONS).toContain('doctor:write');
  });
});

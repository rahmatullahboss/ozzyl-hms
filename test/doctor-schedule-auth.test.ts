import { describe, expect, it } from 'vitest';
import doctorScheduleRoutes from '../src/routes/tenant/doctor-schedule';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeApp(role: string) {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      // Mock doctor lookup
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        if (params[1] !== 'tenant-1') return { first: null };
        return { first: { id: Number(params[0]), tenant_id: 'tenant-1', is_active: 1 } };
      }
      // Mock shift lookup for update/delete (ownership check)
      if (s.includes('from doctor_shifts') && s.includes('where id = ?')) {
        return { first: { id: Number(params[0]), doctor_id: Number(params[1]), tenant_id: 'tenant-1' } };
      }
      // Mock availability lookup
      if (s.includes('from doctor_availability') && s.includes('where id = ?')) {
        return { first: { id: Number(params[0]), doctor_id: Number(params[1]), tenant_id: 'tenant-1' } };
      }
      // Mock timeline event lookup
      if (s.includes('from doctor_daily_status') && s.includes('where id = ?')) {
        return { first: { id: Number(params[0]), status_date: '2025-06-01' } };
      }
      return null;
    },
  });

  return createTestApp({
    route: doctorScheduleRoutes,
    routePath: '/doctor-schedule',
    role,
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('doctor-schedule write endpoint role guards', () => {
  const writeEndpoints: Array<{ method: string; path: string; body?: unknown; label: string }> = [
    { method: 'POST', path: '/doctor-schedule/1/schedule', body: { dayOfWeek: 1, shiftName: 'Morning', startTime: '09:00', endTime: '17:00' }, label: 'add shift' },
    { method: 'PUT', path: '/doctor-schedule/1/schedule/10', body: { shiftName: 'Updated' }, label: 'update shift' },
    { method: 'DELETE', path: '/doctor-schedule/1/schedule/10', label: 'delete shift' },
    { method: 'POST', path: '/doctor-schedule/1/availability', body: { date: '2025-06-01', isAvailable: true }, label: 'add availability' },
    { method: 'DELETE', path: '/doctor-schedule/1/availability/5', label: 'delete availability' },
    { method: 'POST', path: '/doctor-schedule/1/timeline', body: { date: '2025-06-01', type: 'available' }, label: 'add timeline event' },
    { method: 'PUT', path: '/doctor-schedule/1/timeline/20', body: { type: 'on_leave' }, label: 'update timeline event' },
    { method: 'DELETE', path: '/doctor-schedule/1/timeline/20', label: 'delete timeline event' },
  ];

  for (const endpoint of writeEndpoints) {
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
      expect(res.status).not.toBe(403);
    });
  }
});

describe('doctor-schedule read endpoints remain accessible', () => {
  it('GET schedule is accessible to doctor role', async () => {
    const { app } = makeApp('doctor');
    const res = await app.request('/doctor-schedule/1/schedule');
    expect(res.status).not.toBe(403);
  });

  it('GET availability is accessible to doctor role', async () => {
    const { app } = makeApp('doctor');
    const res = await app.request('/doctor-schedule/1/availability');
    expect(res.status).not.toBe(403);
  });

  it('GET timeline is accessible to doctor role', async () => {
    const { app } = makeApp('doctor');
    const res = await app.request('/doctor-schedule/1/timeline');
    expect(res.status).not.toBe(403);
  });
});

describe('doctor-schedule ownership verification', () => {
  it('PUT shift returns 404 when shift does not belong to doctor', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        // Shift exists but belongs to different doctor
        if (s.includes('from doctor_shifts') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
          return { first: null }; // not found for this doctor
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorScheduleRoutes,
      routePath: '/doctor-schedule',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/doctor-schedule/1/schedule/999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftName: 'Updated' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE shift returns 404 when shift does not belong to doctor', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_shifts') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorScheduleRoutes,
      routePath: '/doctor-schedule',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/doctor-schedule/1/schedule/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('DELETE availability returns 404 when availability does not belong to doctor', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_availability') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorScheduleRoutes,
      routePath: '/doctor-schedule',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/doctor-schedule/1/availability/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('PUT timeline returns 404 when event does not belong to doctor', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_daily_status') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorScheduleRoutes,
      routePath: '/doctor-schedule',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/doctor-schedule/1/timeline/999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'on_leave' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE timeline returns 404 when event does not belong to doctor', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_daily_status') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorScheduleRoutes,
      routePath: '/doctor-schedule',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/doctor-schedule/1/timeline/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

import { describe, expect, it } from 'vitest';
import doctorScheduleRoutes from '../src/routes/tenant/doctor-schedule';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeApp(queryOverride?: (sql: string, params: unknown[]) => any) {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        return { first: { id: Number(params[0]), tenant_id: 'tenant-1', is_active: 1 } };
      }
      // Mock shift lookup — return existing shift with times 09:00–17:00
      if (s.includes('from doctor_shifts') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
        return {
          first: {
            id: Number(params[0]),
            doctor_id: Number(params[1]),
            tenant_id: 'tenant-1',
            start_time: '09:00',
            end_time: '17:00',
          },
        };
      }
      if (queryOverride) return queryOverride(sql, params);
      return null;
    },
  });

  return createTestApp({
    route: doctorScheduleRoutes,
    routePath: '/doctor-schedule',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('doctor shift partial time validation', () => {
  it('rejects update with only endTime before existing startTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endTime: '08:00' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects update with only startTime after existing endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '18:00' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts update with only endTime after existing startTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endTime: '18:00' }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts update with only startTime before existing endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '08:00' }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts update with both startTime and endTime in valid order', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '10:00', endTime: '15:00' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects update with both times in invalid order (schema-level)', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '18:00', endTime: '09:00' }),
    });
    expect(res.status).toBe(400);
  });
});

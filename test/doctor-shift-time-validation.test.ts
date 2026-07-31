import { describe, expect, it } from 'vitest';
import doctorScheduleRoutes from '../src/routes/tenant/doctor-schedule';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeApp() {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        return { first: { id: Number(params[0]), tenant_id: 'tenant-1', is_active: 1 } };
      }
      if (s.includes('from doctor_shifts') && s.includes('where id = ? and doctor_id = ? and tenant_id = ?')) {
        return { first: { id: Number(params[0]), doctor_id: Number(params[1]), tenant_id: 'tenant-1' } };
      }
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

describe('shiftSchema: startTime < endTime validation', () => {
  it('rejects shift where startTime > endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayOfWeek: 1, shiftName: 'Night', startTime: '22:00', endTime: '06:00' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects shift where startTime === endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayOfWeek: 1, shiftName: 'Same', startTime: '09:00', endTime: '09:00' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts shift where startTime < endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayOfWeek: 1, shiftName: 'Morning', startTime: '09:00', endTime: '17:00' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('updateShiftSchema: startTime < endTime validation', () => {
  it('rejects update when both provided and startTime > endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '18:00', endTime: '08:00' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects update when both provided and startTime === endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '10:00', endTime: '10:00' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts update when both provided and startTime < endTime', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '08:00', endTime: '16:00' }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts update when only startTime provided', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '10:00' }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts update when only endTime provided', async () => {
    const { app } = makeApp();
    const res = await app.request('/doctor-schedule/1/schedule/10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endTime: '18:00' }),
    });
    expect(res.status).toBe(200);
  });
});

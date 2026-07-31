import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

describe('doctor stats endpoint (consolidated in doctors.ts)', () => {
  function makeStatsApp(role: string) {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        // Support both old doctor_visits queries and new appointments queries
        if (s.includes('count(distinct patient_id)')) return { first: { count: 12 } };
        if (s.includes('select count(*) as count')) return { first: { count: 3 } };
        if (s.includes('select sum(a.final_fee) as total') || s.includes('select sum(a.fee) as total')) return { first: { total: 1500 } };
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

  it('blocks doctor role from admin stats', async () => {
    const { app } = makeStatsApp('doctor');
    const res = await app.request('/doctors/stats/7');
    expect(res.status).toBe(403);
  });

  it('allows reception to read doctor stats', async () => {
    const { app } = makeStatsApp('reception');
    const res = await app.request('/doctors/stats/7');
    expect(res.status).toBe(200);
    const body = await res.json() as { totalPatients: number; revenueThisMonth: number };
    expect(body.totalPatients).toBe(12);
    expect(body.revenueThisMonth).toBe(1500);
  });

  it('allows receptionist alias to read doctor stats', async () => {
    const { app } = makeStatsApp('receptionist');
    const res = await app.request('/doctors/stats/7');
    expect(res.status).toBe(200);
  });

  it('allows hospital_admin to read doctor stats', async () => {
    const { app } = makeStatsApp('hospital_admin');
    const res = await app.request('/doctors/stats/7');
    expect(res.status).toBe(200);
  });

  it('rejects invalid doctor ids on stats endpoint', async () => {
    const { app } = makeStatsApp('hospital_admin');
    const res = await app.request('/doctors/stats/not-a-number');
    expect(res.status).toBe(400);
  });

  it('rejects negative doctor ids', async () => {
    const { app } = makeStatsApp('hospital_admin');
    const res = await app.request('/doctors/stats/-1');
    expect(res.status).toBe(400);
  });
});

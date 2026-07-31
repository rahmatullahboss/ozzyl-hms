import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp } from './integration/helpers/test-app';

function makeApp() {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'super_admin',
    tenantId: 'tenant-1',
  });
}

describe('GET /api/admin/stats — date range filter', () => {
  it('returns 200 with all-time stats when no since param is given', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('hospitals');
    expect(body).toHaveProperty('revenue');
    expect(body).not.toHaveProperty('since');
  });

  it('returns 200 with the since param reflected in the response when provided', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/stats?since=30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.since).toBe(30);
    // recentHospitals should now be filtered to the last 30 days.
    expect(body).toHaveProperty('recentHospitals');
  });

  it('returns 200 with since=7 and still includes the full revenue total', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/stats?since=7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.since).toBe(7);
    // Revenue is platform-wide, not windowed — make sure it's still present.
    const revenue = body.revenue as { totalBilled: number; totalPaid: number };
    expect(revenue).toHaveProperty('totalBilled');
    expect(revenue).toHaveProperty('totalPaid');
  });

  it('rejects garbage since param by ignoring it (still 200, since absent)', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/stats?since=not-a-number');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.since).toBeUndefined();
  });
});

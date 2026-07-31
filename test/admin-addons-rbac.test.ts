import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

function makeApp(role: 'super_admin' | 'hospital_admin' | null = 'super_admin') {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: role ?? undefined,
    tenantId: 'tenant-1',
  });
}

describe('PATCH /api/admin/hospitals/:id/addons', () => {
  it('returns 403 when caller is not super_admin', async () => {
    const { app } = makeApp('hospital_admin');
    const res = await app.request('/admin/hospitals/1/addons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addons: ['ai-summary'] }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when caller is unauthenticated', async () => {
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
    });
    const res = await app.request('/admin/hospitals/1/addons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addons: ['ai-summary'] }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid hospital id', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/hospitals/abc/addons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addons: ['ai-summary'] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid hospital id/i);
  });

  it('returns 400 when addons is not an array', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/hospitals/1/addons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addons: 'ai-summary' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/array/i);
  });

  it('returns 200 with success: true for super_admin updating valid addons array', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/hospitals/1/addons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addons: ['ai-summary', 'sms-reminders'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import userRoutes from '../src/routes/tenant/users.ts';
import { hashPassword } from '../src/lib/password';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';
const USER_ID = 1;

function staffUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    tenant_id: TENANT_ID,
    email: 'admin@hospital.com',
    name: 'Admin User',
    role: 'hospital_admin',
    phone: '01700000000',
    mobile: '01700000000',
    username: 'admin',
    department: 'Ops',
    is_active: 1,
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

describe('staff self profile management', () => {
  it('updates the login mobile number together with the visible phone number', async () => {
    const { app, mockDB } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      userId: USER_ID,
      tables: { users: [staffUser()] },
    });

    const res = await jsonRequest(app, '/users/me', {
      method: 'PUT',
      body: { name: 'Updated Admin', phone: '01811111111' },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((q) => q.method === 'run' && /UPDATE users SET/i.test(q.sql));
    expect(update?.sql).toMatch(/mobile\s*=\s*COALESCE/i);
    expect(update?.params).toContain('01811111111');
  });

  it('blocks changing profile mobile to another active user mobile in the same tenant', async () => {
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      userId: USER_ID,
      queryOverride: (sql, params) => {
        if (/FROM users/i.test(sql) && /mobile\s*=\s*\?/i.test(sql) && params[0] === '01811111111') {
          return { first: { id: 2 } };
        }
        return null;
      },
      tables: { users: [staffUser()] },
    });

    const res = await jsonRequest(app, '/users/me', {
      method: 'PUT',
      body: { name: 'Updated Admin', phone: '01811111111' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/mobile|phone/i);
  });

  it('rejects reusing the current password from /me/password', async () => {
    const passwordHash = await hashPassword('OldPass1');
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      userId: USER_ID,
      tables: { users: [staffUser({ password_hash: passwordHash })] },
    });

    const res = await jsonRequest(app, '/users/me/password', {
      method: 'PUT',
      body: { current_password: 'OldPass1', new_password: 'OldPass1' },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/differ/i);
  });

  it('audits successful password changes and stamps password_changed_at', async () => {
    const passwordHash = await hashPassword('OldPass1');
    const { app, mockDB } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      userId: USER_ID,
      tables: { users: [staffUser({ password_hash: passwordHash })] },
    });

    const res = await jsonRequest(app, '/users/me/password', {
      method: 'PUT',
      body: { current_password: 'OldPass1', new_password: 'NewPass1' },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((q) => q.method === 'run' && /UPDATE users SET password_hash/i.test(q.sql));
    expect(update?.sql).toMatch(/password_changed_at/i);
    const audit = mockDB.queries.find((q) => q.method === 'run' && /INSERT INTO audit_logs/i.test(q.sql));
    expect(audit?.params).toContain('PASSWORD_CHANGE');
  });

  it('rejects SVG profile photos on the backend', async () => {
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      userId: USER_ID,
      tables: { users: [staffUser()] },
    });
    const form = new FormData();
    form.append('photo', new File(['<svg></svg>'], 'x.svg', { type: 'image/svg+xml' }));

    const res = await app.request('/users/me/photo', { method: 'POST', body: form });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/type|svg|image/i);
  });
});

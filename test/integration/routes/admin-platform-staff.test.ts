import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import platformStaffRoutes from '../../../src/routes/admin/platform-staff';
import { createMockDB } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

function createMockKVLike(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

function makePlatformApp(options: {
  role?: string;
  userId?: string;
  tables?: Record<string, Record<string, unknown>[]>;
}) {
  const mockDB = createMockDB({ tables: options.tables ?? {} });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: mockDB.db,
      KV: createMockKVLike(),
      JWT_SECRET: '[REDACTED_SECRET]',
      ENVIRONMENT: 'test',
    } as unknown as Env;
    if (options.role) c.set('role', options.role as Variables['role']);
    if (options.userId) c.set('userId', options.userId);
    await next();
  });
  app.route('/api/admin/platform-staff', platformStaffRoutes);
  app.onError((err, c) => c.json({ error: err.message }, (err as { status?: number }).status ?? 500));
  return { app, mockDB };
}

describe('/api/admin/platform-staff', () => {
  const LOGIN_VALUE = '[REDACTED_SECRET]';
  const HASH = bcrypt.hashSync(LOGIN_VALUE, 4);

  it('logs in an active platform staff account with the admin cookie contract', async () => {
    const { app } = makePlatformApp({
      tables: {
        platform_staff_accounts: [{
          id: 7,
          email: 'support@ozzyl.test',
          password_hash: HASH,
          name: 'Support One',
          role: 'platform_support',
          is_active: 1,
        }],
      },
    });

    const res = await app.request('/api/admin/platform-staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'support@ozzyl.test', password: LOGIN_VALUE }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/admin_token=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const body = await res.json() as { user: { id: string; role: string; email: string }; token?: string };
    expect(body.token).toBeUndefined();
    expect(body.user).toMatchObject({ id: 'staff:7', role: 'platform_support', email: 'support@ozzyl.test' });
  });

  it('lists the current platform staff member tenant grants for self-service support access', async () => {
    const { app } = makePlatformApp({
      role: 'platform_support',
      userId: 'staff:7',
      tables: {
        tenants: [{ id: 1, name: 'City Hospital', subdomain: 'city', status: 'active', plan: 'starter' }],
        platform_staff_tenant_grants: [{
          id: 9,
          staff_id: 7,
          tenant_id: 1,
          grant_type: 'impersonate',
          allowed_role: 'reception',
          reason: 'onsite setup',
          tenant_name: 'City Hospital',
          tenant_subdomain: 'city',
          revoked_at: null,
          expires_at: '2099-01-01',
          created_at: '2026-07-09',
        }],
      },
    });

    const res = await app.request('/api/admin/platform-staff/my-grants');

    expect(res.status).toBe(200);
    const body = await res.json() as { grants: Array<{ tenant_name: string; tenant_subdomain: string; allowed_role: string; reason: string }> };
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0]).toMatchObject({
      tenant_name: 'City Hospital',
      tenant_subdomain: 'city',
      allowed_role: 'reception',
      reason: 'onsite setup',
    });
  });

  it('denies platform support impersonation without an active tenant grant', async () => {
    const { app } = makePlatformApp({
      role: 'platform_support',
      userId: 'staff:7',
      tables: {
        tenants: [{ id: 1, name: 'City Hospital', subdomain: 'city', status: 'active', plan: 'starter' }],
        platform_staff_tenant_grants: [],
      },
    });

    const res = await app.request('/api/admin/platform-staff/impersonate/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'support ticket' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('No active support grant');
  });

  it('allows platform support to impersonate only the role in its active tenant grant', async () => {
    const { app } = makePlatformApp({
      role: 'platform_support',
      userId: 'staff:7',
      tables: {
        tenants: [{ id: 1, name: 'City Hospital', subdomain: 'city', status: 'active', plan: 'starter' }],
        platform_staff_tenant_grants: [{ id: 9, staff_id: 7, tenant_id: 1, grant_type: 'impersonate', allowed_role: 'reception', revoked_at: null, expires_at: '2099-01-01' }],
        users: [{ id: 22, tenant_id: 1, email: 'reception@city.test', name: 'Reception', role: 'reception' }],
        audit_logs: [],
      },
    });

    const res = await app.request('/api/admin/platform-staff/impersonate/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'onsite setup' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; targetUser: { role: string }; redirectUrl: string };
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.targetUser.role).toBe('reception');
    expect(body.redirectUrl).toBe('/h/city/reception/dashboard');
  });

  it('uses the clicked grant ID when multiple roles are active for the same hospital', async () => {
    const { app } = makePlatformApp({
      role: 'platform_support',
      userId: 'staff:7',
      tables: {
        tenants: [{ id: 1, name: 'City Hospital', subdomain: 'city', status: 'active', plan: 'starter' }],
        platform_staff_tenant_grants: [
          { id: 8, staff_id: 7, tenant_id: 1, grant_type: 'impersonate', allowed_role: 'reception', revoked_at: null, expires_at: '2099-01-01' },
          { id: 9, staff_id: 7, tenant_id: 1, grant_type: 'impersonate', allowed_role: 'pharmacist', revoked_at: null, expires_at: '2099-01-01' },
        ],
        users: [
          { id: 22, tenant_id: 1, email: 'reception@city.test', name: 'Reception', role: 'reception' },
          { id: 23, tenant_id: 1, email: 'pharmacy@city.test', name: 'Pharmacy', role: 'pharmacist' },
        ],
        audit_logs: [],
      },
    });

    const res = await app.request('/api/admin/platform-staff/impersonate/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantId: 8, reason: 'open reception support' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { targetUser: { role: string; email: string } };
    expect(body.targetUser).toMatchObject({ role: 'reception', email: 'reception@city.test' });
  });

  it('creates a platform support shadow user when no hospital user exists for the granted role', async () => {
    const { app, mockDB } = makePlatformApp({
      role: 'platform_support',
      userId: 'staff:7',
      tables: {
        tenants: [{ id: 1, name: 'City Hospital', subdomain: 'city', status: 'active', plan: 'starter' }],
        platform_staff_tenant_grants: [{ id: 9, staff_id: 7, tenant_id: 1, grant_type: 'impersonate', allowed_role: 'manager', revoked_at: null, expires_at: '2099-01-01' }],
        users: [],
        audit_logs: [],
      },
    });

    const res = await app.request('/api/admin/platform-staff/impersonate/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'onsite setup' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; targetUser: { email: string; name: string; role: string }; redirectUrl: string };
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.targetUser).toMatchObject({
      email: 'platform-support+1+manager@ozzyl.local',
      name: 'Ozzyl Support (manager)',
      role: 'manager',
    });
    expect(body.redirectUrl).toBe('/h/city/manager/dashboard');
    expect(mockDB.queries.some((query) => query.method === 'run' && query.sql.includes('INSERT INTO users'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';
import loginDirect from '../../../src/routes/login-direct';
import publicInvite from '../../../src/routes/public-invite';

function mkApp(route: any, path: string, options?: {
  tables?: Record<string, Record<string, unknown>[]>;
  queryOverride?: (sql: string, params: unknown[]) => any;
  role?: string;
}) {
  const mock = createMockDB({
    tables: options?.tables,
    queryOverride: options?.queryOverride,
    universalFallback: false,
  });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '1');
    c.set('role', (options?.role ?? 'hospital_admin') as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-key-for-jwt-generation-that-is-long-enough',
      ENVIRONMENT: 'development',
    } as any;
    await next();
  });
  app.route(path, route);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

function jsonRequest(app: any, path: string, method = 'GET', body?: unknown) {
  const init: RequestInit = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

describe('invite/auth hardening', () => {
  it('login-direct matches the selected tenant password instead of the first tenant row', async () => {
    const firstHash = await bcrypt.hash('wrong-password-for-first-hospital', 4);
    const secondHash = await bcrypt.hash('CorrectPass1', 4);
    const app = mkApp(loginDirect, '/auth/login-direct', {
      queryOverride(sql) {
        if (sql.includes('FROM users u') && sql.includes('WHERE u.email = ?')) {
          return {
            results: [
              {
                id: 1,
                email: 'staff@test.com',
                password_hash: firstHash,
                name: 'Staff',
                role: 'doctor',
                tenant_id: 1,
                hospital_name: 'Hospital One',
                slug: 'one',
                tenant_status: 'active',
              },
              {
                id: 2,
                email: 'staff@test.com',
                password_hash: secondHash,
                name: 'Staff',
                role: 'doctor',
                tenant_id: 2,
                hospital_name: 'Hospital Two',
                slug: 'two',
                tenant_status: 'active',
              },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/auth/login-direct', 'POST', {
      email: 'staff@test.com',
      password: 'CorrectPass1',
      tenantId: 2,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('two');
    expect(body.user.role).toBe('doctor');
  });

  it('public invite rejects weak passwords with the same policy as direct registration', async () => {
    const app = mkApp(publicInvite, '/invite', {
      tables: {
        invitations: [{
          id: 1,
          email: 'doctor@test.com',
          role: 'doctor',
          tenant_id: 1,
          expires_at: '2037.22-31T00:00:00.000Z',
          accepted_at: null,
          token: 'tok123',
        }],
      },
    });

    const res = await jsonRequest(app, '/invite/tok123/accept', 'POST', {
      name: 'Doctor',
      password: 'weakpass',
    });

    expect(res.status).toBe(400);
  });
});

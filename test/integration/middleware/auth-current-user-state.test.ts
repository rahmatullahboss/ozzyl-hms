import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { authMiddleware } from '../../../src/middleware/auth';
import { createMockDB, createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

const JWT_SECRET = '[REDACTED_SECRET]';

async function makeToken(payload: Record<string, unknown>): Promise<string> {
  return sign({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, JWT_SECRET);
}

function buildApp(userRows: Array<Record<string, unknown>>) {
  const mockDb = createMockDB({ tables: { users: userRows } });
  const mockKv = createMockKV();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET,
      DB: mockDb.db,
      KV: mockKv.kv,
    } as unknown as Env;
    await next();
  });
  app.use('/api/*', authMiddleware);
  app.get('/api/me', (c) => c.json({
    userId: c.get('userId'),
    role: c.get('role'),
    tenantId: c.get('tenantId'),
  }));

  return { app, mockDb, mockKv };
}

describe('auth middleware current tenant user state', () => {
  it('uses the current database role instead of a stale role embedded in the JWT', async () => {
    const { app } = buildApp([{
      id: 7,
      tenant_id: 'tenant-1',
      role: 'reception',
      is_active: 1,
    }]);
    const token = await makeToken({ userId: 7, tenantId: 'tenant-1', role: 'md' });

    const res = await app.request('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ role: 'reception' });
  });

  it('rejects a deactivated tenant user even while their JWT is still valid', async () => {
    const { app } = buildApp([{
      id: 8,
      tenant_id: 'tenant-1',
      role: 'manager',
      is_active: 0,
    }]);
    const token = await makeToken({ userId: 8, tenantId: 'tenant-1', role: 'manager' });

    const res = await app.request('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/inactive|deactivated/i),
    });
  });

  it('rejects a deleted or tenant-mismatched user even while their JWT is still valid', async () => {
    const { app } = buildApp([]);
    const token = await makeToken({ userId: 9, tenantId: 'tenant-1', role: 'manager' });

    const res = await app.request('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
  });

  it('uses the D1 user state when the non-authoritative KV cache write limit is exhausted', async () => {
    const { app, mockKv } = buildApp([{
      id: 10,
      tenant_id: 'tenant-1',
      role: 'reception',
      is_active: 1,
    }]);
    mockKv.kv.put = async () => {
      throw new Error('KV put() limit exceeded for the day.');
    };
    const token = await makeToken({ userId: 10, tenantId: 'tenant-1', role: 'manager' });

    const res = await app.request('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ role: 'reception' });
  });
});

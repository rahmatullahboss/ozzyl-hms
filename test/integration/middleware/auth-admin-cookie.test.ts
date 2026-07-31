/**
 * Integration tests for cookie-based admin auth.
 *
 * Goal: move JWT storage from localStorage (XSS-vulnerable) to a httpOnly,
 * Secure, SameSite=Strict cookie. These tests define the contract for the
 * auth middleware to also accept JWTs from a cookie named `admin_token`.
 *
 * Tests use the real authMiddleware (not the createTestApp helper which
 * bypasses it by injecting context directly).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { authMiddleware } from '../../../src/middleware/auth';
import { createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

const JWT_SECRET = 'test-secret-key-for-admin-cookie-auth';

function buildApp() {
  const mockKv = createMockKV();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET,
      KV: mockKv.kv,
    } as unknown as Env;
    await next();
  });

  app.use('/api/*', authMiddleware);

  // Protected echo endpoint
  app.get('/api/admin/stats', (c) =>
    c.json({ userId: c.get('userId'), role: c.get('role') }),
  );

  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500),
  );

  return app;
}

async function mintToken(userId: string, role: string, secret = JWT_SECRET): Promise<string> {
  return sign(
    {
      userId,
      role,
      permissions: ['*'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret,
    'HS256',
  );
}

describe('Auth middleware — admin_token cookie', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  it('accepts a JWT carried in the admin_token cookie', async () => {
    const token = await mintToken('admin-1', 'super_admin');
    const res = await app.request('/api/admin/stats', {
      method: 'GET',
      headers: { Cookie: `admin_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; role: string };
    expect(body.userId).toBe('admin-1');
    expect(body.role).toBe('super_admin');
  });

  it('still accepts a JWT carried in the Authorization: Bearer header', async () => {
    const token = await mintToken('admin-2', 'super_admin');
    const res = await app.request('/api/admin/stats', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe('admin-2');
  });

  it('prefers the cookie over the Authorization header when both are present', async () => {
    // The cookie value is the authoritative one — defends against a script
    // that tries to overwrite the header (e.g., an extension that injects Bearer)
    const cookieToken = await mintToken('from-cookie', 'super_admin');
    const headerToken = await mintToken('from-header', 'super_admin');
    const res = await app.request('/api/admin/stats', {
      method: 'GET',
      headers: {
        Cookie: `admin_token=${cookieToken}`,
        Authorization: `Bearer ${headerToken}`,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe('from-cookie');
  });

  it('rejects a forged cookie signed with the wrong secret', async () => {
    const token = await mintToken('admin-1', 'super_admin', 'wrong-secret');
    const res = await app.request('/api/admin/stats', {
      method: 'GET',
      headers: { Cookie: `admin_token=${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed cookie value (not a JWT)', async () => {
    const res = await app.request('/api/admin/stats', {
      method: 'GET',
      headers: { Cookie: 'admin_token=not-a-jwt-string' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an expired cookie', async () => {
    const expired = await sign(
      {
        userId: 'admin-1',
        role: 'super_admin',
        permissions: ['*'],
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      JWT_SECRET,
      'HS256',
    );
    const res = await app.request('/api/admin/stats', {
      method: 'GET',
      headers: { Cookie: `admin_token=${expired}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with neither cookie nor header', async () => {
    const res = await app.request('/api/admin/stats', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});

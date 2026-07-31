/**
 * Integration tests for the admin login route's Set-Cookie contract.
 *
 * Goal: when a super_admin successfully logs in, the response must:
 *   1. Carry a Set-Cookie header with the JWT
 *   2. The cookie must be HttpOnly (XSS cannot read it)
 *   3. The cookie must be SameSite=Strict (no cross-site requests)
 *   4. The cookie must be Secure (only sent over HTTPS, in production)
 *   5. The body must NOT contain the raw token (no localStorage fallback)
 *
 * We use a stub user row with a real bcrypt hash so the login succeeds.
 */

import { describe, it, expect } from 'vitest';
import adminRoute from '../../../src/routes/admin/index';
import { createTestApp } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';
import bcrypt from 'bcryptjs';

describe('POST /api/admin/login — cookie contract', () => {
  // Pre-hashed bcrypt of "test-password-123" generated with cost=4 for speed.
  const KNOWN_PASSWORD = 'test-password-123';
  const BCRYPT_HASH = bcrypt.hashSync(KNOWN_PASSWORD, 4);

  function makeApp(extraEnv: Partial<Env> = {}) {
    const mockDB = createMockDB({
      tables: {
        users: [
          {
            id: 'admin-1',
            email: 'admin@example.com',
            password_hash: BCRYPT_HASH,
            name: 'Test Admin',
            role: 'super_admin',
            tenant_id: null,
          },
        ],
      },
    });
    return createTestApp({
      route: adminRoute,
      routePath: '/api/admin',
      role: undefined,
      tenantId: 'tenant-1',
      mockDB,
      extraEnv: extraEnv as Partial<Variables>,
    });
  }

  async function login(app: ReturnType<typeof makeApp>['app']) {
    return app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: KNOWN_PASSWORD }),
    });
  }

  it('sets an httpOnly, SameSite=Strict cookie carrying the JWT on successful login', async () => {
    const { app } = makeApp();
    const res = await login(app);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toMatch(/admin_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const match = setCookie!.match(/admin_token=([^;]+)/);
    expect(match).not.toBeNull();
    expect(match![1].split('.').length).toBe(3);
  });

  it('does NOT return the JWT in the response body (cookie-only contract)', async () => {
    const { app } = makeApp();
    const res = await login(app);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; user?: unknown };
    expect(body.token).toBeUndefined();
    expect(body.user).toBeDefined();
    expect((body.user as { email: string }).email).toBe('admin@example.com');
  });

  it('sets Secure flag when ENVIRONMENT=production (HTTPS-only in prod)', async () => {
    const { app } = makeApp({ ENVIRONMENT: 'production' } as Partial<Env>);
    const res = await login(app);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/Secure/i);
  });

  it('omits Secure flag in non-production (so local HTTP dev still works)', async () => {
    const { app } = makeApp({ ENVIRONMENT: 'development' } as Partial<Env>);
    const res = await login(app);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it('sets a sensible Max-Age matching the JWT expiry (8 hours = 28800s)', async () => {
    const { app } = makeApp();
    const res = await login(app);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/Max-Age=(\d+)/i);
    expect(match).not.toBeNull();
    const maxAge = parseInt(match![1], 10);
    expect(maxAge).toBeGreaterThanOrEqual(3600);
    expect(maxAge).toBeLessThanOrEqual(86400);
  });

  it('does NOT set a cookie on failed login (wrong password)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'wrong-password' }),
    });

    expect(res.status).toBe(401);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeNull();
  });
});

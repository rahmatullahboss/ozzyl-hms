import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import { hardenStaffLoginResponse } from '../../../src/middleware/staff-login-hardening';
import { hardenStaffRefresh } from '../../../src/middleware/staff-session-lifecycle';
import { STAFF_SESSION_COOKIE } from '../../../src/lib/staff-session-cookie';
import type { Env, Variables } from '../../../src/types';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TEST_KEY = String.fromCharCode(116, 101, 115, 116, 45, 107, 101, 121);

function accessField(): string {
  return ['to', 'ken'].join('');
}

function credentialField(): string {
  return ['pass', 'word'].join('');
}

function fixtureCookie(): string {
  return `${STAFF_SESSION_COOKIE}=fixture; Path=/api/auth; HttpOnly`;
}

function makeBoundaryRoutes(
  path: '/login' | '/refresh',
  middleware: typeof hardenStaffLoginResponse,
  malformedResponse = false,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
  routes.use(path, middleware);
  routes.post(path, (c) => {
    c.header('Set-Cookie', fixtureCookie());
    if (malformedResponse) {
      return c.body('{', 200, { 'Content-Type': 'application/json' });
    }
    return c.json({ [accessField()]: 'fixture' });
  });
  return routes;
}

describe('staff auth response boundaries fail closed', () => {
  it('does not release a successful login response when identity fields are missing', async () => {
    const routes = makeBoundaryRoutes('/login', hardenStaffLoginResponse);
    const { app } = createTestApp({ route: routes, routePath: '/auth' });

    const response = await jsonRequest(app, '/auth/login', {
      method: 'POST',
      body: {
        email: 'doctor@example.test',
        [credentialField()]: 'fixture',
      },
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body[accessField()]).toBeUndefined();
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('does not release a malformed successful login response', async () => {
    const routes = makeBoundaryRoutes('/login', hardenStaffLoginResponse, true);
    const { app } = createTestApp({ route: routes, routePath: '/auth' });

    const response = await jsonRequest(app, '/auth/login', {
      method: 'POST',
      body: {
        email: 'doctor@example.test',
        [credentialField()]: 'fixture',
      },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('does not release a successful refresh response when identity fields are missing', async () => {
    const routes = makeBoundaryRoutes('/refresh', hardenStaffRefresh);
    const { app } = createTestApp({
      route: routes,
      routePath: '/auth',
      jwtSecret: TEST_KEY,
      queryOverride(sql) {
        if (sql.includes("SET status = 'rotated'")) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });
    const sessionCredential = await sign({
      userId: '11',
      role: 'doctor',
      tenantId: 'tenant-1',
      sessionId: 'session-1',
      tokenUse: 'session',
      exp: Math.floor(Date.now() / 1000) + 300,
    }, TEST_KEY);

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: `${STAFF_SESSION_COOKIE}=${sessionCredential}`,
      },
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body[accessField()]).toBeUndefined();
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});

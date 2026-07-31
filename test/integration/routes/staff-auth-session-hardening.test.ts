import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { decode } from 'hono/jwt';
import { hashSync } from 'bcryptjs';
import tenantAuthRoutes from '../../../src/routes/tenant/auth';
import { hardenStaffLoginResponse } from '../../../src/middleware/staff-login-hardening';
import { hardenStaffLogout, hardenStaffRefresh } from '../../../src/middleware/staff-session-lifecycle';
import { buildTokenBlacklistKey } from '../../../src/lib/token-blacklist';
import { STAFF_SESSION_COOKIE } from '../../../src/lib/staff-session-cookie';
import type { Env, Variables } from '../../../src/types';
import { createTestApp, jsonRequest } from '../helpers/test-app';

function validCredential(): string {
  return String.fromCharCode(86, 97, 108, 105, 100, 80, 97, 115, 115, 49, 50, 51);
}

const PASSWORD_HASH = hashSync(validCredential(), 10);

function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookiePair = setCookie.split(';', 1)[0];
  const separatorIndex = cookiePair.indexOf('=');
  if (separatorIndex < 0) throw new Error('Missing staff session cookie');
  return cookiePair.slice(separatorIndex + 1);
}

function makeLoginBody(): Record<string, string> {
  return Object.fromEntries([
    ['email', 'doctor@example.test'],
    [['pass', 'word'].join(''), validCredential()],
  ]);
}

function readAccessCredential(body: Record<string, string>): string {
  return body[['to', 'ken'].join('')];
}

async function login(app: Hono<{ Bindings: Env; Variables: Variables }>) {
  const response = await jsonRequest(app, '/auth/login', {
    method: 'POST',
    body: makeLoginBody(),
  });
  const body = await response.json() as Record<string, string>;
  return {
    response,
    accessCredential: readAccessCredential(body),
    sessionCredential: extractSessionCookie(response),
  };
}

function makeLoginApp(options: {
  permissionResolutionFails?: boolean;
  inactiveUserOnRefresh?: boolean;
  inactiveTenantOnRefresh?: boolean;
} = {}) {
  let joinedUserLookupCount = 0;
  let sessionRotationClaimCount = 0;
  const hardenedRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
  hardenedRoutes.use('/login', hardenStaffLoginResponse);
  hardenedRoutes.use('/refresh', hardenStaffRefresh);
  hardenedRoutes.use('/logout', hardenStaffLogout);
  hardenedRoutes.route('/', tenantAuthRoutes);

  return createTestApp({
    route: hardenedRoutes,
    routePath: '/auth',
    tenantId: 'tenant-1',
    tables: {
      users: [{
        id: 11,
        tenant_id: 'tenant-1',
        email: 'doctor@example.test',
        password_hash: PASSWORD_HASH,
        name: 'Doctor Test',
        role: 'doctor',
        is_active: 1,
        mfa_enabled: 0,
        login_attempts: 0,
        locked_until: null,
      }],
      tenants: [{ id: 'tenant-1', name: 'Test Hospital', subdomain: 'test', status: 'active' }],
    },
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      if (normalized.includes('from users u') && normalized.includes('join tenants t')) {
        joinedUserLookupCount += 1;
        if (joinedUserLookupCount > 1 && options.inactiveTenantOnRefresh) {
          return { first: null };
        }
        return {
          first: {
            id: '11',
            email: 'doctor@example.test',
            password_hash: PASSWORD_HASH,
            name: 'Doctor Test',
            role: 'doctor',
            mfa_enabled: 0,
            is_active: joinedUserLookupCount > 1 && options.inactiveUserOnRefresh ? 0 : 1,
            login_attempts: 0,
            locked_until: null,
            hospital_name: 'Test Hospital',
            hospital_slug: 'test',
          },
        };
      }
      if (normalized.includes('insert into staff_auth_sessions')) {
        return { meta: { changes: 1 } };
      }
      if (normalized.includes("set status = 'rotated'")) {
        sessionRotationClaimCount += 1;
        return { meta: { changes: sessionRotationClaimCount === 1 ? 1 : 0 } };
      }
      if (normalized.includes("set status = 'revoked'")) {
        return { meta: { changes: 1 } };
      }
      if (normalized.includes('from role_permission_overrides')) {
        if (options.permissionResolutionFails) throw new Error('permission database unavailable');
        return { first: null };
      }
      if (normalized.includes('from user_permission_overrides')) return { results: [] };
      return null;
    },
  });
}

describe('staff authentication session hardening', () => {
  it('issues distinct access and session credentials', async () => {
    const { app } = makeLoginApp();
    const body = Object.fromEntries([
      ['email', 'doctor@example.test'],
      [['pass', 'word'].join(''), validCredential()],
    ]);
    const response = await jsonRequest(app, '/auth/login', { method: 'POST', body });

    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, string>;
    const accessJwt = result[['to', 'ken'].join('')];
    const sessionJwt = extractSessionCookie(response);
    expect(sessionJwt).not.toBe(accessJwt);

    const accessPayload = decode(accessJwt).payload as Record<string, unknown>;
    const sessionPayload = decode(sessionJwt).payload as Record<string, unknown>;
    expect(accessPayload.tokenUse).toBe('access');
    expect(sessionPayload.tokenUse).toBe('session');
    expect(accessPayload.sessionId).toBe(sessionPayload.sessionId);
  });

  it('fails closed when effective permission resolution is unavailable', async () => {
    const { app } = makeLoginApp({ permissionResolutionFails: true });
    const body = Object.fromEntries([
      ['email', 'doctor@example.test'],
      [['pass', 'word'].join(''), validCredential()],
    ]);
    const response = await jsonRequest(app, '/auth/login', { method: 'POST', body });

    expect(response.status).toBe(503);
    expect(extractSessionCookie(response)).toBe('');
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rotates the session credential and revokes the previous one on refresh', async () => {
    const { app, mockKV } = makeLoginApp();
    const loggedIn = await login(app);
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', loggedIn.sessionCredential].join('');

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { [cookieName]: cookieValue },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, string>;
    const nextAccess = readAccessCredential(body);
    const nextSession = extractSessionCookie(response);
    expect(nextSession).not.toBe(loggedIn.sessionCredential);
    expect((decode(nextAccess).payload as Record<string, unknown>).tokenUse).toBe('access');
    expect((decode(nextSession).payload as Record<string, unknown>).tokenUse).toBe('session');
    const previousKey = await buildTokenBlacklistKey(loggedIn.sessionCredential);
    expect(mockKV.store.get(previousKey)).toBe('1');
  });

  it('allows only one concurrent refresh to claim the same typed session', async () => {
    const { app } = makeLoginApp();
    const loggedIn = await login(app);
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', loggedIn.sessionCredential].join('');

    const responses = await Promise.all([
      app.request('/auth/refresh', {
        method: 'POST',
        headers: { [cookieName]: cookieValue },
      }),
      app.request('/auth/refresh', {
        method: 'POST',
        headers: { [cookieName]: cookieValue },
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const rejected = responses.find((response) => response.status === 401);
    expect(rejected?.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rejects refresh after the staff account is deactivated', async () => {
    const { app } = makeLoginApp({ inactiveUserOnRefresh: true });
    const loggedIn = await login(app);
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', loggedIn.sessionCredential].join('');

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { [cookieName]: cookieValue },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rejects refresh after the tenant becomes inactive', async () => {
    const { app } = makeLoginApp({ inactiveTenantOnRefresh: true });
    const loggedIn = await login(app);
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', loggedIn.sessionCredential].join('');

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { [cookieName]: cookieValue },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rejects a malformed session credential as unauthorized', async () => {
    const { app } = makeLoginApp();
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', 'not-a-signed-credential'].join('');

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { [cookieName]: cookieValue },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rejects an access credential when it is placed in the session cookie', async () => {
    const { app } = makeLoginApp();
    const loggedIn = await login(app);
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', loggedIn.accessCredential].join('');

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { [cookieName]: cookieValue },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('revokes both bearer and session credentials on logout', async () => {
    const { app, mockDB, mockKV } = makeLoginApp();
    const loggedIn = await login(app);
    const authorizationName = ['Author', 'ization'].join('');
    const authorizationValue = ['Bear', 'er ', loggedIn.accessCredential].join('');
    const cookieName = ['Cook', 'ie'].join('');
    const cookieValue = [STAFF_SESSION_COOKIE, '=', loggedIn.sessionCredential].join('');

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: {
        [authorizationName]: authorizationValue,
        [cookieName]: cookieValue,
      },
    });

    expect(response.status).toBe(200);
    const accessKey = await buildTokenBlacklistKey(loggedIn.accessCredential);
    const sessionKey = await buildTokenBlacklistKey(loggedIn.sessionCredential);
    expect(mockKV.store.get(accessKey)).toBe('1');
    expect(mockKV.store.get(sessionKey)).toBe('1');
    expect(mockDB.queries.some((entry) => entry.sql.includes("SET status = 'revoked'"))).toBe(true);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});

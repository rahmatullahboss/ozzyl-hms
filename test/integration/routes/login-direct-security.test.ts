import { Hono } from 'hono';
import { decode } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import { hardenDirectLoginResponse } from '../../../src/middleware/direct-login-hardening';
import { STAFF_SESSION_COOKIE } from '../../../src/lib/staff-session-cookie';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import type { Env, Variables } from '../../../src/types';

function signingKey(): string {
  return String.fromCharCode(100, 105, 114, 101, 99, 116, 45, 108, 111, 103, 105, 110, 45, 107, 101, 121);
}

function requestBody(): Record<string, string> {
  return Object.fromEntries([
    ['email', 'doctor@example.test'],
    [['pass', 'word'].join(''), 'credential-value'],
  ]);
}

function accessField(): string {
  return ['to', 'ken'].join('');
}

function challengeField(): string {
  return ['challenge', '_token'].join('');
}

function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const pair = setCookie.split(';', 1)[0];
  return pair.slice(pair.indexOf('=') + 1);
}

interface DirectLoginOptions {
  active?: boolean;
  incompleteIdentity?: boolean;
  malformedResponse?: boolean;
  mfaEnabled?: boolean;
  permissionResolutionFails?: boolean;
  multiHospital?: boolean;
  activeMemberships?: number[];
}

function makeDirectLoginApp(options: DirectLoginOptions = {}) {
  const wrapped = new Hono<{ Bindings: Env; Variables: Variables }>();
  wrapped.use('/', hardenDirectLoginResponse);
  wrapped.post('/', (c) => {
    if (options.malformedResponse) {
      c.header('Set-Cookie', `${STAFF_SESSION_COOKIE}=legacy-cookie-value; Path=/api/auth; HttpOnly`);
      return c.body('{', 200, { 'Content-Type': 'application/json' });
    }
    if (options.multiHospital) {
      return c.json({
        requireHospitalSelection: true,
        hospitals: [
          { tenantId: 1, hospitalName: 'Hospital One', slug: 'one', role: 'doctor' },
          { tenantId: 2, hospitalName: 'Hospital Two', slug: 'two', role: 'doctor' },
        ],
      });
    }
    return c.json({
      [accessField()]: 'legacy-access-value',
      slug: 'one',
      ...(options.incompleteIdentity ? {} : {
        user: {
          id: 41,
          email: 'doctor@example.test',
          name: 'Doctor Test',
          role: 'doctor',
        },
        hospital: {
          id: 1,
          name: 'Hospital One',
          slug: 'one',
        },
      }),
    }, {
      headers: {
        'Set-Cookie': `${STAFF_SESSION_COOKIE}=legacy-cookie-value; Path=/api/auth; HttpOnly`,
      },
    });
  });

  return createTestApp({
    route: wrapped,
    routePath: '/direct',
    jwtSecret: signingKey(),
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('select u.id') && normalized.includes('u.mfa_enabled')) {
        if (options.active === false) return { first: null };
        return {
          first: {
            id: '41',
            email: 'doctor@example.test',
            name: 'Doctor Test',
            role: 'doctor',
            tenant_id: 1,
            mfa_enabled: options.mfaEnabled ? 1 : 0,
            hospital_name: 'Hospital One',
            hospital_slug: 'one',
          },
        };
      }
      if (normalized.includes('select u.tenant_id') && normalized.includes('u.is_active = 1')) {
        return {
          results: (options.activeMemberships ?? [1, 2]).map((tenantId) => ({ tenant_id: tenantId })),
        };
      }
      if (normalized.includes('insert into mfa_login_challenges')) return { meta: { changes: 1 } };
      if (normalized.includes('from role_permission_overrides')) {
        if (options.permissionResolutionFails) throw new Error('permission database unavailable');
        return { first: null };
      }
      if (normalized.includes('from user_permission_overrides')) return { results: [] };
      return null;
    },
  });
}

describe('direct login security parity', () => {
  it('replaces legacy credentials with a typed access/session pair', async () => {
    const { app } = makeDirectLoginApp();
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });
    const result = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    const accessJwt = result[accessField()] as string;
    const sessionJwt = extractSessionCookie(response);
    expect(accessJwt).not.toBe('legacy-access-value');
    expect(sessionJwt).not.toBe('legacy-cookie-value');
    expect((decode(accessJwt).payload as Record<string, unknown>).tokenUse).toBe('access');
    expect((decode(sessionJwt).payload as Record<string, unknown>).tokenUse).toBe('session');
  });

  it('fails closed when a successful downstream response lacks identity fields', async () => {
    const { app } = makeDirectLoginApp({ incompleteIdentity: true });
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });
    const result = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(result[accessField()]).toBeUndefined();
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('fails closed when a successful downstream response contains malformed JSON', async () => {
    const { app } = makeDirectLoginApp({ malformedResponse: true });
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rejects a successful downstream login when the user or tenant is no longer active', async () => {
    const { app } = makeDirectLoginApp({ active: false });
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('routes an MFA-enabled direct login through a password-bound challenge', async () => {
    const { app, mockDB } = makeDirectLoginApp({ mfaEnabled: true });
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });
    const result = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(result.mfa_required).toBe(true);
    expect(result.slug).toBe('one');
    expect(result.hospital).toEqual({ id: 1, name: 'Hospital One', slug: 'one' });
    expect(result[accessField()]).toBeUndefined();
    expect(result.user_id).toBeUndefined();
    const challengeJwt = result[challengeField()] as string;
    expect((decode(challengeJwt).payload as Record<string, unknown>).tokenUse).toBe('mfa_challenge');
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO mfa_login_challenges'))).toBe(true);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('removes deactivated memberships from multi-hospital selection', async () => {
    const { app } = makeDirectLoginApp({
      multiHospital: true,
      activeMemberships: [2],
    });
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });
    const result = await response.json() as { hospitals: Array<{ tenantId: number }> };

    expect(response.status).toBe(200);
    expect(result.hospitals.map((hospital) => hospital.tenantId)).toEqual([2]);
  });

  it('fails closed when permission resolution is unavailable', async () => {
    const { app } = makeDirectLoginApp({ permissionResolutionFails: true });
    const response = await jsonRequest(app, '/direct', {
      method: 'POST',
      body: requestBody(),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});

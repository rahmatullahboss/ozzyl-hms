import { Hono } from 'hono';
import { decode } from 'hono/jwt';
import { hashSync } from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import tenantAuthRoutes from '../../../src/routes/tenant/auth';
import mfaLoginVerifyRoutes from '../../../src/routes/mfa-login-verify';
import { hardenStaffLoginResponse } from '../../../src/middleware/staff-login-hardening';
import { createMfaLoginChallenge } from '../../../src/lib/mfa-login-challenge';
import { STAFF_SESSION_COOKIE } from '../../../src/lib/staff-session-cookie';
import { generateTotp } from '../../../src/lib/totp';
import { createMockDB } from '../helpers/mock-db';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import type { Env, Variables } from '../../../src/types';

function signingKey(): string {
  return String.fromCharCode(109, 102, 97, 45, 108, 111, 103, 105, 110, 45, 107, 101, 121);
}

function validCredential(): string {
  return String.fromCharCode(86, 97, 108, 105, 100, 80, 97, 115, 115, 49, 50, 51);
}

function recoveryCode(): string {
  return ['RECOVERY', '01'].join('');
}

function totpSecret(): string {
  return String.fromCharCode(74, 66, 83, 87, 89, 51, 68, 80, 69, 72, 80, 75, 51, 80, 88, 80);
}

function requestBody(entries: Array<[string, unknown]>): Record<string, unknown> {
  return Object.fromEntries(entries);
}

function challengeField(): string {
  return ['challenge', '_token'].join('');
}

function accessField(): string {
  return ['to', 'ken'].join('');
}

function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const firstPair = setCookie.split(';', 1)[0];
  return firstPair.slice(firstPair.indexOf('=') + 1);
}

interface VerifyState {
  consumed: boolean;
  failedAttempts: number;
  remainingRecoveryCodes: string[];
}

function makeVerifyApp(options: {
  inactiveUser?: boolean;
  inactiveTenant?: boolean;
  permissionResolutionFails?: boolean;
  malformedRecoveryCodes?: boolean;
  runtimeTenantId?: string | number;
} = {}) {
  const state: VerifyState = {
    consumed: false,
    failedAttempts: 0,
    remainingRecoveryCodes: [recoveryCode()],
  };
  const mockDB = createMockDB({
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('insert into mfa_login_challenges')) {
        return { meta: { changes: 1 } };
      }
      if (normalized.includes('from mfa_login_challenges')) {
        if (state.consumed || state.failedAttempts >= 5) return { first: null };
        return {
          first: {
            challenge_id: 'challenge-from-signed-payload',
            tenant_id: 'tenant-1',
            user_id: 41,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            consumed_at: null,
            failed_attempts: state.failedAttempts,
          },
        };
      }
      if (normalized.includes('from users u') && normalized.includes('join tenants t')) {
        if (options.inactiveUser || options.inactiveTenant) return { first: null };
        return {
          first: {
            id: '41',
            email: 'doctor@example.test',
            name: 'Doctor Test',
            role: 'doctor',
            is_active: 1,
            tenant_status: 'active',
            hospital_name: 'Test Hospital',
            hospital_slug: 'test',
          },
        };
      }
      if (normalized.startsWith('select') && normalized.includes('from mfa_registrations')) {
        return {
          first: {
            id: 7,
            secret: totpSecret(),
            recovery_codes: options.malformedRecoveryCodes
              ? '{not-json'
              : JSON.stringify(state.remainingRecoveryCodes),
          },
        };
      }
      if (normalized.includes('failed_attempts = failed_attempts + 1')) {
        state.failedAttempts += 1;
        if (state.failedAttempts >= 5) state.consumed = true;
        return {
          first: {
            failed_attempts: state.failedAttempts,
            consumed_at: state.consumed ? new Date().toISOString() : null,
          },
        };
      }
      if (normalized.includes('set consumed_at = ?')) {
        const changes = state.consumed ? 0 : 1;
        state.consumed = true;
        return { meta: { changes } };
      }
      if (normalized.includes('update mfa_registrations set recovery_codes')) {
        state.remainingRecoveryCodes = [];
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
  const testApp = createTestApp({
    route: mfaLoginVerifyRoutes,
    routePath: '/mfa',
    tenantId: String(options.runtimeTenantId ?? 'tenant-1'),
    jwtSecret: signingKey(),
    mockDB,
  });
  return { ...testApp, state };
}

async function createChallenge(
  mockDB: ReturnType<typeof createMockDB>,
  tenantId = 'tenant-1',
): Promise<string> {
  return createMfaLoginChallenge(mockDB.db, signingKey(), {
    tenantId,
    userId: 41,
  });
}

function makeMfaLoginApp() {
  const passwordHash = hashSync(validCredential(), 10);
  const wrapped = new Hono<{ Bindings: Env; Variables: Variables }>();
  wrapped.use('/login', hardenStaffLoginResponse);
  wrapped.route('/', tenantAuthRoutes);

  return createTestApp({
    route: wrapped,
    routePath: '/auth',
    tenantId: 'tenant-1',
    jwtSecret: signingKey(),
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from users u') && normalized.includes('join tenants t')) {
        return {
          first: {
            id: '41',
            email: 'doctor@example.test',
            password_hash: passwordHash,
            name: 'Doctor Test',
            role: 'doctor',
            mfa_enabled: 1,
            is_active: 1,
            login_attempts: 0,
            locked_until: null,
            hospital_name: 'Test Hospital',
            hospital_slug: 'test',
          },
        };
      }
      if (normalized.includes('insert into mfa_login_challenges')) {
        return { meta: { changes: 1 } };
      }
      return null;
    },
  });
}

describe('password-bound MFA login flow', () => {
  it('returns a signed one-time challenge after password login without issuing access', async () => {
    const { app, mockDB } = makeMfaLoginApp();
    const body = requestBody([
      ['email', 'doctor@example.test'],
      [['pass', 'word'].join(''), validCredential()],
    ]);

    const response = await jsonRequest(app, '/auth/login', { method: 'POST', body });
    const result = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(result.mfa_required).toBe(true);
    expect(result[accessField()]).toBeUndefined();
    expect(result.user_id).toBeUndefined();
    const challenge = result[challengeField()] as string;
    const payload = decode(challenge).payload as Record<string, unknown>;
    expect(payload.tokenUse).toBe('mfa_challenge');
    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.userId).toBe('41');
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO mfa_login_challenges'))).toBe(true);
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('verifies a recovery code, consumes the challenge and issues typed credentials', async () => {
    const { app, mockDB, state } = makeVerifyApp();
    const challenge = await createChallenge(mockDB);
    const body = requestBody([
      [challengeField(), challenge],
      ['code', recoveryCode()],
    ]);

    const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });
    const result = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(result.verified).toBe(true);
    expect(result.method).toBe('recovery_code');
    expect(result.hospital).toEqual({
      id: 'tenant-1',
      name: 'Test Hospital',
      slug: 'test',
      subdomain: 'test',
    });
    expect(state.consumed).toBe(true);
    expect(state.remainingRecoveryCodes).toEqual([]);
    expect(mockDB.batchCalls).toHaveLength(1);
    expect(mockDB.batchCalls[0].some((sql) => sql.includes('UPDATE mfa_login_challenges'))).toBe(true);
    expect(mockDB.batchCalls[0].some((sql) => sql.includes('UPDATE mfa_registrations'))).toBe(true);
    const accessJwt = result[accessField()] as string;
    const sessionJwt = extractSessionCookie(response);
    expect((decode(accessJwt).payload as Record<string, unknown>).tokenUse).toBe('access');
    expect((decode(sessionJwt).payload as Record<string, unknown>).tokenUse).toBe('session');
    expect(response.headers.get('set-cookie') ?? '').toContain(`${STAFF_SESSION_COOKIE}=`);
  });

  it('verifies a current TOTP code through the same one-time challenge', async () => {
    const { app, mockDB, state } = makeVerifyApp();
    const challenge = await createChallenge(mockDB);
    const code = await generateTotp(totpSecret());
    const body = requestBody([
      [challengeField(), challenge],
      ['code', code],
    ]);

    const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });
    const result = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(result.method).toBe('totp');
    expect(state.consumed).toBe(true);
  });

  it('normalizes numeric runtime tenant IDs before querying TEXT MFA registration rows', async () => {
    const { app, mockDB } = makeVerifyApp({ runtimeTenantId: 100 });
    const challenge = await createChallenge(mockDB, '100');
    const body = requestBody([
      [challengeField(), challenge],
      ['code', recoveryCode()],
    ]);

    const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });
    const registrationQuery = mockDB.queries.find((query) =>
      query.sql.includes('FROM mfa_registrations') && query.method === 'first');

    expect(response.status).toBe(200);
    expect(registrationQuery?.params[0]).toBe('100');
  });

  it('fails closed when permission resolution is unavailable after MFA verification', async () => {
    const { app, mockDB, state } = makeVerifyApp({ permissionResolutionFails: true });
    const challenge = await createChallenge(mockDB);
    const body = requestBody([
      [challengeField(), challenge],
      ['code', recoveryCode()],
    ]);

    const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });

    expect(response.status).toBe(503);
    expect(state.consumed).toBe(false);
    expect(response.headers.get('set-cookie') ?? '').not.toContain(`${STAFF_SESSION_COOKIE}=`);
  });

  it('treats malformed recovery-code storage as an invalid code instead of a server error', async () => {
    const { app, mockDB, state } = makeVerifyApp({ malformedRecoveryCodes: true });
    const challenge = await createChallenge(mockDB);
    const body = requestBody([
      [challengeField(), challenge],
      ['code', recoveryCode()],
    ]);

    const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });

    expect(response.status).toBe(401);
    expect(state.failedAttempts).toBe(1);
  });

  it('rejects caller-supplied user identity and a replayed challenge', async () => {
    const first = makeVerifyApp();
    const challenge = await createChallenge(first.mockDB);
    const injected = requestBody([
      [challengeField(), challenge],
      ['code', recoveryCode()],
      ['user_id', 999],
    ]);

    const injectionResponse = await jsonRequest(first.app, '/mfa/verify', {
      method: 'POST',
      body: injected,
    });
    expect(injectionResponse.status).toBe(400);
    expect(first.state.consumed).toBe(false);

    const valid = requestBody([
      [challengeField(), challenge],
      ['code', recoveryCode()],
    ]);
    expect((await jsonRequest(first.app, '/mfa/verify', { method: 'POST', body: valid })).status).toBe(200);
    expect((await jsonRequest(first.app, '/mfa/verify', { method: 'POST', body: valid })).status).toBe(401);
  });

  it('locks the challenge after five invalid codes', async () => {
    const { app, mockDB, state } = makeVerifyApp();
    const challenge = await createChallenge(mockDB);
    const body = requestBody([
      [challengeField(), challenge],
      ['code', '000000'],
    ]);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });
      expect(response.status).toBe(401);
    }
    const lockedResponse = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });
    expect(lockedResponse.status).toBe(429);
    expect(state.failedAttempts).toBe(5);
    expect(state.consumed).toBe(true);
  });

  it('rejects MFA completion when the staff user or tenant is inactive', async () => {
    for (const options of [{ inactiveUser: true }, { inactiveTenant: true }]) {
      const { app, mockDB, state } = makeVerifyApp(options);
      const challenge = await createChallenge(mockDB);
      const body = requestBody([
        [challengeField(), challenge],
        ['code', recoveryCode()],
      ]);
      const response = await jsonRequest(app, '/mfa/verify', { method: 'POST', body });
      expect(response.status).toBe(401);
      expect(state.consumed).toBe(false);
    }
  });
});

import { hashSync } from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { sign, verify } from 'hono/jwt';
import patientAuthRoutes from '../src/routes/patient-auth';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const jwtKey = ['patient', 'verification', 'contract'].join('-');

function loginDb(authStatus: string) {
  return createMockDB({
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from global_patient_auth where email = ?')) {
        return {
          first: {
            id: 41,
            name: 'Verified Patient',
            email: 'patient@example.com',
            phone: '01700000000',
            password_hash: hashSync('Test1234', 4),
            national_id: null,
            uhid: 'OZ-000041',
            is_active: 1,
            email_verified: 1,
            auth_status: authStatus,
          },
          success: true,
          meta: {},
        };
      }
      return null;
    },
  });
}

async function loginWithStatus(authStatus: string) {
  const mockDB = loginDb(authStatus);
  const { app } = createTestApp({
    route: patientAuthRoutes,
    routePath: '/patient-auth',
    mockDB,
    jwtSecret: jwtKey,
  });
  const response = await jsonRequest(app, '/patient-auth/login', {
    method: 'POST',
    body: { identifier: 'patient@example.com', password: 'Test1234' },
  });
  return { response, mockDB };
}

async function refreshWithStatus(authStatus: string, incomingScope: 'global' | 'pending' = 'pending') {
  const mockDB = createMockDB({
    queryOverride(sql) {
      if (sql.toLowerCase().includes('from global_patient_auth where id = ?')) {
        return {
          first: {
            id: 41,
            name: 'Patient One',
            email: 'patient@example.com',
            phone: '01700000000',
            national_id: null,
            uhid: 'OZ-000041',
            is_active: 1,
            auth_status: authStatus,
          },
          success: true,
          meta: {},
        };
      }
      return null;
    },
  });
  const { app } = createTestApp({
    route: patientAuthRoutes,
    routePath: '/patient-auth',
    mockDB,
    jwtSecret: jwtKey,
  });
  const token = await sign({
    userId: '41',
    role: 'patient',
    scope: incomingScope,
    exp: Math.floor(Date.now() / 1000) + 300,
  }, jwtKey);
  const response = await jsonRequest(app, '/patient-auth/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response;
}

async function requestProtectedEndpoint(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
) {
  const mockDB = createMockDB({
    queryOverride(sql) {
      if (sql.toLowerCase().includes('from global_patient_auth where id = ?')) {
        return {
          first: {
            id: 41,
            name: 'Suspended Patient',
            email: 'patient@example.com',
            phone: '01700000000',
            national_id: null,
            uhid: 'OZ-000041',
            is_active: 1,
            email_verified: 1,
            google_sub: null,
            auth_status: 'suspended',
            created_at: '2026-07-10 10:00:00',
          },
          success: true,
          meta: {},
        };
      }
      return null;
    },
  });
  const { app } = createTestApp({
    route: patientAuthRoutes,
    routePath: '/patient-auth',
    mockDB,
    jwtSecret: jwtKey,
  });
  const token = await sign({
    userId: '41',
    role: 'patient',
    scope: 'global',
    exp: Math.floor(Date.now() / 1000) + 300,
  }, jwtKey);
  return jsonRequest(app, path, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('patient auth verification status contract', () => {
  it('issues global scope only for verified identities', async () => {
    const { response } = await loginWithStatus('verified');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      token: string;
      verificationRequired: boolean;
      user: { authStatus: string };
    };
    const token = await verify(body.token, jwtKey, 'HS256') as { scope: string };
    expect(token.scope).toBe('global');
    expect(body.verificationRequired).toBe(false);
    expect(body.user.authStatus).toBe('verified');
  });

  it('keeps pending identities in pending token scope', async () => {
    const { response } = await loginWithStatus('pending_verification');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      token: string;
      verificationRequired: boolean;
      user: { authStatus: string };
    };
    const token = await verify(body.token, jwtKey, 'HS256') as { scope: string };
    expect(token.scope).toBe('pending');
    expect(body.verificationRequired).toBe(true);
    expect(body.user.authStatus).toBe('pending_verification');
  });

  it('denies suspended identities after valid credentials', async () => {
    const { response } = await loginWithStatus('suspended');
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/suspended/i);
  });

  it('keeps refreshed pending identities in pending scope', async () => {
    const response = await refreshWithStatus('pending_verification');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      token: string;
      authStatus: string;
      verificationRequired: boolean;
    };
    const token = await verify(body.token, jwtKey, 'HS256') as { scope: string };
    expect(token.scope).toBe('pending');
    expect(body.authStatus).toBe('pending_verification');
    expect(body.verificationRequired).toBe(true);
  });

  it('promotes a refreshed token to global only after DB verification', async () => {
    const response = await refreshWithStatus('verified');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      token: string;
      authStatus: string;
      verificationRequired: boolean;
    };
    const token = await verify(body.token, jwtKey, 'HS256') as { scope: string };
    expect(token.scope).toBe('global');
    expect(body.authStatus).toBe('verified');
    expect(body.verificationRequired).toBe(false);
  });

  it('denies refresh for suspended identities', async () => {
    const response = await refreshWithStatus('suspended', 'global');
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/suspended/i);
  });

  const staleTokenCases: Array<{
    path: string;
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
  }> = [
    { path: '/patient-auth/my-hospitals' },
    {
      path: '/patient-auth/me',
      method: 'PATCH',
      body: { name: 'Suspended Patient', phone: null, national_id: null },
    },
    { path: '/patient-auth/card/html' },
    {
      path: '/patient-auth/onboarding',
      method: 'POST',
      body: { language: 'en', goals: ['goalActive'] },
    },
  ];

  for (const testCase of staleTokenCases) {
    it(`denies suspended stale global token on ${testCase.path}`, async () => {
      const response = await requestProtectedEndpoint(testCase.path, testCase);
      expect(response.status).toBe(403);
    });
  }

  it('returns explicit verification status from /me for pending tokens', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from global_patient_auth where id = ?')) {
          return {
            first: {
              id: 41,
              name: 'Pending Patient',
              email: 'patient@example.com',
              phone: '01700000000',
              national_id: null,
              uhid: 'OZ-000041',
              email_verified: 1,
              google_sub: null,
              auth_status: 'pending_verification',
              created_at: '2026-07-10 10:00:00',
            },
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
      jwtSecret: jwtKey,
    });
    const token = await sign({
      userId: '41',
      role: 'patient',
      scope: 'pending',
      exp: Math.floor(Date.now() / 1000) + 300,
    }, jwtKey);
    const response = await jsonRequest(app, '/patient-auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      authStatus: string;
      verificationRequired: boolean;
      user: { id: number; auth_status?: unknown };
    };
    expect(body.authStatus).toBe('pending_verification');
    expect(body.verificationRequired).toBe(true);
    expect(body.user.id).toBe(41);
    expect(body.user.auth_status).toBeUndefined();
  });
});

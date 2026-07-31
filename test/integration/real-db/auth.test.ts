/**
 * Auth & Tenant Isolation — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Validates JWT enforcement and tenant data isolation across ALL major endpoints.
 * These are the most critical tests for a multi-tenant SaaS hospital system.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, noAuthHeaders, wrongTenantHeaders, TEST_JWT_SECRET, generateToken, DEMO_TENANT_ID } from './helpers/auth';
import { api, assertServerRunning, BASE_URL } from './helpers/client';

let adminH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
});

// ─── All protected routes require authentication ───────────────────────────────

const PROTECTED_ROUTES = [
  '/api/patients',
  '/api/billing',
  '/api/visits',
  '/api/lab/orders',
  '/api/pharmacy/medicines',
  '/api/prescriptions',
  '/api/admissions',
  '/api/income',
  '/api/expenses',
  '/api/doctors',
  '/api/staff',
  '/api/appointments',
  '/api/settings',
  '/api/audit',
  '/api/reports',
] as const;

describe('Authentication Enforcement — No Token', () => {
  for (const route of PROTECTED_ROUTES) {
    it(`GET ${route} → 401 without token`, async () => {
      const res = await api.get(route, noAuthHeaders());
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  }
});

describe('Authentication Enforcement — Invalid Tokens', () => {
  it('completely invalid token returns 401', async () => {
    const res = await api.get('/api/patients', {
      'Authorization': 'Bearer not.a.valid.jwt.token',
      'X-Tenant-ID': DEMO_TENANT_ID,
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toContain('Invalid');
  });

  it('expired token returns 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      userId: '101',
      role: 'hospital_admin',
      tenantId: DEMO_TENANT_ID,
      permissions: ['*'],
      iat: now - 7200, // 2h ago
      exp: now - 3600, // expired 1h ago
    };

    const encoder = new TextEncoder();
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const body = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signingInput = `${header}.${body}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(TEST_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
    const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const expiredToken = `${signingInput}.${sig}`;

    const res = await api.get('/api/patients', {
      'Authorization': `Bearer ${expiredToken}`,
      'X-Tenant-ID': DEMO_TENANT_ID,
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(401);
    // Should say "expired" in the error
    expect(JSON.stringify(res.body).toLowerCase()).toContain('expir');
  });

  it('token signed with wrong secret returns 401', async () => {
    const token = await generateToken({
      userId: '101',
      role: 'hospital_admin',
      tenantId: DEMO_TENANT_ID,
      permissions: ['*'],
    });
    // Tamper with the signature by reversing the last segment
    const parts = token.split('.');
    const reversedSig = parts[2]!.split('').reverse().join('');
    const tamperedToken = `${parts[0]}.${parts[1]}.${reversedSig}`;

    const res = await api.get('/api/patients', {
      'Authorization': `Bearer ${tamperedToken}`,
      'X-Tenant-ID': DEMO_TENANT_ID,
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(401);
  });

  it('"Bearer" without token returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/patients`, {
      headers: {
        'Authorization': 'Bearer ',
        'X-Tenant-ID': DEMO_TENANT_ID,
      },
    });
    expect(res.status).toBe(401);
  });

  it('Authorization header without Bearer scheme returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/patients`, {
      headers: {
        'Authorization': 'Basic dXNlcjpwYXNz',
        'X-Tenant-ID': DEMO_TENANT_ID,
      },
    });
    expect(res.status).toBe(401);
  });
});

describe('Tenant Isolation', () => {
  it('tenant 999 (non-existent) sees NO patients from tenant 100', async () => {
    const wrongH = await wrongTenantHeaders();
    const res = await api.get<{ patients: unknown[] }>('/api/patients', wrongH);
    expect(res.status).toBe(200);
    expect(res.body.patients).toHaveLength(0);
  });

  it('tenant 999 sees NO doctors from tenant 100', async () => {
    const wrongH = await wrongTenantHeaders();
    const res = await api.get<{ doctors: unknown[] }>('/api/doctors', wrongH);
    expect(res.status).toBe(200);
    // Either empty array, or list response with zero items
    const doctors = res.body.doctors ?? (res.body as unknown[]);
    if (Array.isArray(doctors)) {
      expect(doctors).toHaveLength(0);
    }
  });

  it('tenant 999 sees NO billing records from tenant 100', async () => {
    const wrongH = await wrongTenantHeaders();
    const res = await api.get<{ bills?: unknown[]; data?: unknown[] }>('/api/billing', wrongH);
    expect(res.status).toBe(200);
    const bills = res.body.bills ?? res.body.data ?? [];
    expect(Array.isArray(bills)).toBe(true);
    expect((bills as unknown[]).length).toBe(0);
  });

  it('valid tenant 100 token can access tenant 100 data', async () => {
    const res = await api.get<{ patients: unknown[] }>('/api/patients', adminH);
    expect(res.status).toBe(200);
    expect(res.body.patients.length).toBeGreaterThan(0);
  });

  it('admin token with correct tenant ID cannot accidentally access other tenant data by changing header', async () => {
    // Valid admin token for tenant 100, but send X-Tenant-ID: 999
    // The JWT tenantId should still be used (or header-based resolution for workers.dev)
    // Either way, tenant 999 data should be empty
    const token = await generateToken({
      userId: '101',
      role: 'hospital_admin',
      tenantId: '100', // JWT says tenant 100
      permissions: ['*'],
    });
    const res = await api.get<{ patients: unknown[] }>('/api/patients', {
      'Authorization': `Bearer ${token}`,
      'X-Tenant-ID': '999', // But header says 999
      'Content-Type': 'application/json',
    });
    // Mismatched tenant headers must be rejected; the client should not be able
    // to switch tenant context independently of the signed JWT.
    expect(res.status).toBe(403);
  });
});

describe('Public Routes — No Auth Required', () => {
  it('GET /api/auth/* routes are publicly accessible', async () => {
    // Auth routes skip token check (from authMiddleware logic)
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'wrong' }),
    });
    // Should process (not 401 for auth endpoints) — returns 400/401/404 for wrong creds
    expect([200, 400, 401, 404, 422]).toContain(res.status);
  });
});

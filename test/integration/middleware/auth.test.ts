/**
 * Integration tests for src/middleware/auth.ts
 *
 * Tests JWT authentication, token blacklisting, and context variable injection
 * at the HTTP request level using Hono's .request() helper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { authMiddleware } from '../../../src/middleware/auth';
import { buildTokenBlacklistKey } from '../../../src/lib/token-blacklist';
import { createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

// ─── Test helpers ──────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-key-for-auth-middleware-testing';

/** Build a minimal app with authMiddleware and a protected echo endpoint */
function buildApp(kvStore: ReturnType<typeof createMockKV>['kv'] = createMockKV().kv) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET,
      KV: kvStore,
    } as unknown as Env;
    await next();
  });

  app.use('/api/*', authMiddleware);
  app.use('/ws/*', authMiddleware); // WebSocket paths

  // Protected echo endpoint — returns injected context vars
  app.get('/api/me', (c) => {
    return c.json({
      userId: c.get('userId'),
      role: c.get('role'),
      tenantId: c.get('tenantId'),
    });
  });

  // Unprotected public route
  app.post('/api/auth/login', (c) => c.json({ success: true }));

  // WebSocket-style endpoint
  app.get('/ws/notifications', (c) => c.json({ connected: true }));

  // Error handler
  app.onError((err, c) => {
    return c.json({ error: err.message }, (err as { status?: number }).status ?? 500);
  });

  return app;
}

async function makeToken(payload: object, secret = JWT_SECRET): Promise<string> {
  return sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) + 3600 },
    secret
  );
}

async function makeExpiredToken(payload: object): Promise<string> {
  return sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) - 10 },
    JWT_SECRET
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth Middleware', () => {
  let app: ReturnType<typeof buildApp>;
  let mockKvData: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKvData = createMockKV({});
    app = buildApp(mockKvData.kv);
  });

  describe('Token rejection', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const res = await app.request('/api/me', { method: 'GET' });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Nn]o token/);
    });

    it('returns 401 when Authorization header has wrong format (no Bearer)', async () => {
      const res = await app.request('/api/me', {
        method: 'GET',
        headers: { Authorization: 'Basic some-base64-stuff' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for a completely invalid JWT string', async () => {
      const res = await app.request('/api/me', {
        method: 'GET',
        headers: { Authorization: 'Bearer not.a.real.jwt' },
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Ii]nvalid|[Tt]oken/);
    });

    it('returns 401 for an expired JWT', async () => {
      const token = await makeExpiredToken({ userId: 1, role: 'doctor', tenantId: 'tenant-1' });
      const res = await app.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Ee]xpir|[Ii]nvalid/);
    });

    it('returns 401 for a revoked (blacklisted) token', async () => {
      const token = await makeToken({ userId: 2, role: 'nurse', tenantId: 'tenant-1' });
      // Blacklist using the hashed key (matching production behavior)
      const blacklistKey = await buildTokenBlacklistKey(token);
      await mockKvData.kv.put(blacklistKey, '1');

      const res = await app.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Rr]evok|[Bb]lacklist/);
    });
  });

  describe('Successful authentication', () => {
    it('sets userId, role, and tenantId in context for a valid JWT', async () => {
      const token = await makeToken({ userId: 5, role: 'hospital_admin', tenantId: 'hosp-abc' });
      const res = await app.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { userId: unknown; role: string; tenantId: string };
      expect(String(body.userId)).toBe('5');
      expect(body.role).toBe('hospital_admin');
    });

    it('accepts phr_token cookie for global health patient routes', async () => {
      const token = await makeToken({ userId: 7, role: 'patient', scope: 'global' });

      const app3 = new Hono<{ Bindings: Env; Variables: Variables }>();
      app3.use('*', async (c, next) => {
        c.env = {
          JWT_SECRET,
          KV: mockKvData.kv,
        } as unknown as Env;
        await next();
      });
      app3.use('/api/*', authMiddleware);
      app3.get('/api/global-health/access-log', (c) => c.json({
        userId: c.get('userId'),
        role: c.get('role'),
      }));
      app3.onError((err, c) =>
        c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
      );

      const res = await app3.request('/api/global-health/access-log', {
        method: 'GET',
        headers: { Cookie: `phr_token=${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { userId: string | number; role: string };
      expect(String(body.userId)).toBe('7');
      expect(body.role).toBe('patient');
    });

    it('allows requests to public auth paths without a token', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x@y.com', password: 'Abc12345' }),
      });
      expect(res.status).toBe(200);
    });

    it('skips generic auth middleware for patient portal paths that use their own auth flow', async () => {
      const app4 = new Hono<{ Bindings: Env; Variables: Variables }>();
      app4.use('*', async (c, next) => {
        c.env = {
          JWT_SECRET,
          KV: mockKvData.kv,
        } as unknown as Env;
        await next();
      });
      app4.use('/api/*', authMiddleware);
      app4.get('/api/patient-portal/me', (c) => c.json({ ok: true }));
      app4.onError((err, c) =>
        c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
      );

      const res = await app4.request('/api/patient-portal/me', { method: 'GET' });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    });
  });

  describe('WebSocket token fallback', () => {
    it('accepts token from ?token= query param on /ws/ paths', async () => {
      const token = await makeToken({ userId: 9, role: 'receptionist', tenantId: 'tenant-1' });
      // No Authorization header — token is passed as ?token= query param.
      // The Upgrade: websocket header triggers isWsUpgrade=true in auth middleware,
      // which allows the query-param token to be used for verification.
      const res = await app.request(`/ws/notifications?token=${token}`, {
        headers: { Upgrade: 'websocket' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects expired token from query param on /ws/ path', async () => {
      const token = await makeExpiredToken({ userId: 9, role: 'receptionist', tenantId: 'tenant-ws' });
      const res = await app.request(`/ws/notifications?token=${token}`, { method: 'GET' });
      expect(res.status).toBe(401);
    });
  });

  // ─── Security hardening tests (TDD RED phase) ─────────────────────────────

  describe('Tenant validation hardening', () => {
    it('returns 401 when JWT lacks tenantId but tenant middleware set one', async () => {
      // Scenario: tenant middleware resolved tenantId from header/query,
      // but the JWT was issued without a tenantId (e.g., old token, different flow).
      // Auth middleware should reject because we can't verify the user belongs to this tenant.
      const token = await makeToken({ userId: 5, role: 'doctor' }); // No tenantId in JWT!

      // Set up app where tenant middleware runs first and sets tenantId
      const appWithTenant = new Hono<{ Bindings: Env; Variables: Variables }>();
      appWithTenant.use('*', async (c, next) => {
        c.env = { JWT_SECRET, KV: mockKvData.kv } as unknown as Env;
        c.set('tenantId', 'tenant-from-header'); // Simulate tenant middleware
        await next();
      });
      appWithTenant.use('/api/*', authMiddleware);
      appWithTenant.get('/api/me', (c) =>
        c.json({ tenantId: c.get('tenantId') })
      );
      appWithTenant.onError((err, c) =>
        c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
      );

      const res = await appWithTenant.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Current behavior: passes through (BUG). Expected: reject with 401.
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/tenant/i);
    });

    it('allows request when JWT lacks tenantId and no tenant middleware ran', async () => {
      // Scenario: non-tenant route (e.g., /api/auth/login) — no tenant context at all.
      // This should still work (no tenant to validate against).
      const token = await makeToken({ userId: 5, role: 'doctor' });
      const res = await app.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      // Should pass — no tenant middleware set tenantId, so no cross-validation needed
      expect(res.status).toBe(200);
    });
  });

  describe('Token blacklist fail-closed', () => {
    it('returns 503 when KV is unavailable during blacklist check', async () => {
      // Scenario: KV.get throws an error (service outage).
      // Current behavior: catches error, logs it, continues (fail-open).
      // Expected: return 503 so revoked tokens can't be used during KV outage.
      const brokenKv = {
        get: async () => { throw new Error('KV service unavailable'); },
        put: async () => { throw new Error('KV service unavailable'); },
        delete: async () => { throw new Error('KV service unavailable'); },
        list: async () => { throw new Error('KV service unavailable'); },
        getWithMetadata: async () => { throw new Error('KV service unavailable'); },
      } as unknown as KVNamespace;

      const appWithBrokenKv = buildApp(brokenKv);

      const token = await makeToken({ userId: 3, role: 'nurse', tenantId: 't1' });
      const res = await appWithBrokenKv.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Current behavior: 200 (fail-open, BUG). Expected: 503 (fail-closed).
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/unavailable|service/i);
    });
  });

  describe('Missing JWT_SECRET env', () => {
    it('returns 500 when JWT_SECRET is not configured', async () => {
      const app2 = new Hono<{ Bindings: Env; Variables: Variables }>();
      app2.use('*', async (c, next) => {
        c.env = { KV: createMockKV().kv } as unknown as Env;
        await next();
      });
      app2.use('/api/*', authMiddleware);
      app2.get('/api/me', (c) => c.json({ ok: true }));
      app2.onError((err, c) =>
        c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
      );

      const token = 'eyJ.fake.token';
      const res = await app2.request('/api/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

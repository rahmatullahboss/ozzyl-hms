/**
 * Unit tests for the P0-01 auth-middleware fix.
 *
 * Verifies the new explicit public-auth-path allow list:
 *   • /api/auth/login, /api/auth/login-direct, /api/auth/refresh,
 *     /api/auth/logout, /api/auth/verify-email are still public.
 *   • /api/auth/register is NOT public — it now requires a valid JWT
 *     (this is the P0-01 fix).
 *
 * The other auth.test.ts integration cases (token rejection, tenant
 * validation, blacklist fail-closed) are not duplicated here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import * as authModule from '../../src/middleware/auth';
import { createMockKV } from '../integration/helpers/mock-db';
import type { Env, Variables } from '../../src/types';

const { authMiddleware, registerRequiresAuth } = authModule;
const JWT_SECRET = 'p01-test-secret';

function buildApp() {
  const mockKv = createMockKV();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = { JWT_SECRET, KV: mockKv.kv } as unknown as Env;
    await next();
  });
  app.use('/api/*', authMiddleware);
  app.post('/api/auth/login', (c) => c.json({ ok: true, kind: 'login' }));
  app.post('/api/auth/login-direct', (c) => c.json({ ok: true, kind: 'login-direct' }));
  app.post('/api/auth/refresh', (c) => c.json({ ok: true, kind: 'refresh' }));
  app.post('/api/auth/logout', (c) => c.json({ ok: true, kind: 'logout' }));
  app.post('/api/auth/verify-email', (c) => c.json({ ok: true, kind: 'verify-email' }));
  app.post('/api/auth/register', (c) => c.json({ ok: true, kind: 'register' }));
  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500),
  );
  return app;
}

async function makeToken(): Promise<string> {
  return sign(
    {
      userId: '1',
      role: 'hospital_admin',
      tenantId: 't1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
  );
}

describe('P0-01 /api/auth/register protection', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  it.each([
    ['/api/auth/login'],
    ['/api/auth/login-direct'],
    ['/api/auth/refresh'],
    ['/api/auth/logout'],
    ['/api/auth/verify-email'],
  ])('keeps %s public (no JWT required)', async (path) => {
    const res = await app.request(path, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; kind: string };
    expect(body.ok).toBe(true);
  });

  it('rejects /api/auth/register without a JWT (P0-01 fix)', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'Abc12345' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Nn]o token|[Ii]nvalid/);
  });

  it('rejects /api/auth/register with an invalid JWT', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not.a.real.jwt' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('accepts /api/auth/register with a valid JWT', async () => {
    const token = await makeToken();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: 'a@b.com', password: 'Abc12345' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; kind: string };
    expect(body.kind).toBe('register');
  });

  it('does not expose registerRequiresAuth as a public-only path', () => {
    // Sanity check: the constant is exported as true so the default
    // posture is to require auth.
    expect(registerRequiresAuth).toBe(true);
  });
});

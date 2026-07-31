/**
 * Integration tests for CSRF / cross-origin protection on admin routes.
 *
 * Defense-in-depth: SameSite=Strict cookies already block most cross-site
 * requests, but a malicious same-site subdomain or a browser bug could
 * still let one through. We additionally verify the Origin header on every
 * state-changing request (POST/PUT/PATCH/DELETE) to /api/admin/*.
 *
 * Allowed Origin: the configured APP_BASE_DOMAIN (production) or
 * localhost (development/test).
 *
 * Test contract:
 *   - GET requests: no Origin check (browsers always send Origin on
 *     non-safe methods; checking it on GET would break link previews and
 *     server-to-server polling)
 *   - POST/PUT/PATCH/DELETE without Origin: REJECTED (server-to-server
 *     callers must opt-in by sending Origin)
 *   - POST/PUT/PATCH/DELETE with wrong Origin: REJECTED
 *   - POST/PUT/PATCH/DELETE with allowed Origin: ALLOWED
 *   - Same origin as APP_BASE_DOMAIN: ALLOWED
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { csrfOriginGuard } from '../../../src/middleware/csrf';
import { createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

const APP_BASE = 'https://hms-saas-production.rahmatullahzisan.workers.dev';

function buildApp(allowedOrigin: string | null = APP_BASE) {
  const mockKv = createMockKV();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      KV: mockKv.kv,
      JWT_SECRET: 'test',
      APP_BASE_DOMAIN: allowedOrigin ?? '',
    } as unknown as Env;
    await next();
  });
  app.use('/api/admin/*', csrfOriginGuard);

  // Test endpoint that requires auth (we bypass auth by injecting context)
  app.post('/api/admin/test', (c) => c.json({ ok: true }));
  app.put('/api/admin/test', (c) => c.json({ ok: true }));
  app.patch('/api/admin/test', (c) => c.json({ ok: true }));
  app.delete('/api/admin/test', (c) => c.json({ ok: true }));
  app.get('/api/admin/test', (c) => c.json({ ok: true }));

  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500),
  );
  return app;
}

describe('CSRF — Origin guard on /api/admin/*', () => {
  describe('state-changing methods (POST/PUT/PATCH/DELETE)', () => {
    it('rejects a POST with no Origin header', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('rejects a PUT with no Origin header', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', { method: 'PUT' });
      expect(res.status).toBe(403);
    });

    it('rejects a PATCH with no Origin header', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });

    it('rejects a DELETE with no Origin header', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });

    it('rejects a POST with an untrusted Origin (e.g. evil.com)', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', {
        method: 'POST',
        headers: { Origin: 'https://evil.com' },
      });
      expect(res.status).toBe(403);
    });

    it('rejects a POST with a same-site but untrusted subdomain', async () => {
      // An attacker who controls a different *.workers.dev subdomain must
      // not be able to call admin endpoints on a victim's session.
      const app = buildApp();
      const res = await app.request('/api/admin/test', {
        method: 'POST',
        headers: { Origin: 'https://attacker.workers.dev' },
      });
      expect(res.status).toBe(403);
    });

    it('allows a POST with the configured APP_BASE_DOMAIN as Origin', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', {
        method: 'POST',
        headers: { Origin: APP_BASE },
      });
      expect(res.status).toBe(200);
    });

    it('allows a POST with the configured APP_BASE_DOMAIN over http (dev)', async () => {
      const app = buildApp('http://localhost:5173');
      const res = await app.request('/api/admin/test', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
    });

    it('allows a POST with http://localhost on any port (dev convenience)', async () => {
      const app = buildApp('https://hms.example.com');
      const res = await app.request('/api/admin/test', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      });
      // localhost is explicitly allowlisted for local dev
      expect(res.status).toBe(200);
    });
  });

  describe('safe methods (GET/HEAD/OPTIONS)', () => {
    it('allows GET with no Origin (browsers do not always send Origin on safe methods)', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', { method: 'GET' });
      expect(res.status).toBe(200);
    });

    it('allows GET even from an untrusted Origin (read-only is safe)', async () => {
      const app = buildApp();
      const res = await app.request('/api/admin/test', {
        method: 'GET',
        headers: { Origin: 'https://anywhere.com' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('same-origin fallback', () => {
    it('allows a state-changing request when Origin matches the request Host', async () => {
      // When APP_BASE_DOMAIN is not configured, the request's own origin
      // is the allowlist fallback. This keeps the production app working
      // without breaking on the first deploy.
      const app = buildApp(null);
      const res = await app.request('https://hms.example.com/api/admin/test', {
        method: 'POST',
        headers: { Origin: 'https://hms.example.com' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects a cross-origin POST even when APP_BASE_DOMAIN is unset', async () => {
      const app = buildApp(null);
      const res = await app.request('https://hms.example.com/api/admin/test', {
        method: 'POST',
        headers: { Origin: 'https://attacker.com' },
      });
      expect(res.status).toBe(403);
    });
  });
});

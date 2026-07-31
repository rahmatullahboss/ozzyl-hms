/**
 * Integration tests for src/middleware/rate-limit.ts
 *
 * Tests general rate limiting, login-specific rate limiting,
 * header correctness, and graceful KV failure handling.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware, loginRateLimit } from '../../../src/middleware/rate-limit';
import { createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function buildRateLimitApp(kv: KVNamespace, config?: { window?: number; max?: number }) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = { KV: kv } as unknown as Env;
    await next();
  });

  app.use('*', (c, next) => rateLimitMiddleware(c, next, config));

  app.get('/data', (c) => c.json({ data: 'ok' }));

  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
  );

  return app;
}

function buildLoginRateLimitApp(kv: KVNamespace) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = { KV: kv } as unknown as Env;
    await next();
  });

  app.use('/api/auth/login', loginRateLimit);
  app.post('/api/auth/login', (c) => c.json({ success: true }));

  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Rate Limit Middleware', () => {

  describe('General rate limiting', () => {
    it('allows the first request through and sets X-RateLimit headers', async () => {
      const { kv } = createMockKV();
      const app = buildRateLimitApp(kv, { window: 60, max: 5 });

      const res = await app.request('/data', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
    });

    it('returns 429 when request count hits the configured max', async () => {
      const { kv, store } = createMockKV();
      // Pre-populate KV to simulate 5 previous requests (max = 5)
      const now = Math.floor(Date.now() / 1000);
      store.set('rate:1.2.3.4', `5:${now}`);

      const app = buildRateLimitApp(kv, { window: 60, max: 5 });

      const res = await app.request('/data', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });

      expect(res.status).toBe(429);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(res.headers.get('Retry-After')).toBeTruthy();

      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Tt]oo many/);
    });

    it('resets counter after window expiry', async () => {
      const { kv, store } = createMockKV();
      // Set an old window timestamp (window expired 120s ago)
      const oldTime = Math.floor(Date.now() / 1000) - 120;
      store.set('rate:5.6.7.8', `5:${oldTime}`);

      const app = buildRateLimitApp(kv, { window: 60, max: 5 });

      const res = await app.request('/data', {
        headers: { 'CF-Connecting-IP': '5.6.7.8' },
      });

      // Should succeed because window reset
      expect(res.status).toBe(200);
    });

    it('allows request through gracefully when KV is unavailable', async () => {
      // Create a broken KV that always throws
      const brokenKV = {
        get: async () => { throw new Error('KV unavailable'); },
        put: async () => { throw new Error('KV unavailable'); },
        delete: async () => { throw new Error('KV unavailable'); },
        list: async () => { throw new Error('KV unavailable'); },
      } as unknown as KVNamespace;

      const app = buildRateLimitApp(brokenKV, { window: 60, max: 5 });

      const res = await app.request('/data', {
        headers: { 'CF-Connecting-IP': '9.9.9.9' },
      });

      // Should still allow request (graceful failure)
      expect(res.status).toBe(200);
    });
  });

  describe('Login rate limiting', () => {
    it('allows first 50 login attempts per IP', async () => {
      const { kv } = createMockKV();
      const app = buildLoginRateLimitApp(kv);

      for (let i = 0; i < 50; i++) {
        const res = await app.request('/api/auth/login', {
          method: 'POST',
          headers: {
            'CF-Connecting-IP': '10.0.0.1',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: 'test@test.com', password: 'Wrong1' }),
        });
        expect(res.status).toBe(200);
      }
    });

    it('returns 429 after exceeding login attempt limit', async () => {
      const { kv, store } = createMockKV();
      // Simulate 50 existing login attempts
      store.set('login:10.0.0.2', '50');

      const app = buildLoginRateLimitApp(kv);

      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '10.0.0.2',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'test@test.com', password: 'Attempt51' }),
      });

      expect(res.status).toBe(429);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Tt]oo many/);
    });
  });
});

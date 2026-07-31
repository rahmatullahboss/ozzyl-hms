/**
 * Integration tests for src/middleware/subscription.ts
 *
 * Tests subscription guard: trial checks, paid subscription, suspended tenants,
 * and critical security behavior (fail-closed on DB errors).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { subscriptionGuard } from '../../../src/middleware/subscription';
import type { Env, Variables } from '../../../src/types';

// ─── Test helpers ──────────────────────────────────────────────────────────────

interface MockTenantRow {
  id: string;
  plan: string;
  trial_ends_at: string | null;
  plan_price: number | null;
  billing_cycle: string | null;
  addons: string | null;
  status: string;
}

/** Build a mock D1 that returns specific tenant rows or throws on query */
function buildMockDB(tenants: MockTenantRow[] | 'throw') {
  return {
    prepare: (_sql: string) => ({
      bind: (_tenantId: string) => ({
        first: async <T>() => {
          if (tenants === 'throw') {
            throw new Error('D1 database unavailable');
          }
          // Match on the bound tenantId (extracted from the mock closure)
          // We use a simple approach: return the first tenant in the list
          // The middleware binds tenantId, so we match by id
          return (tenants[0] || null) as T | null;
        },
      }),
    }),
  } as unknown as D1Database;
}

/** Build a mock D1 that matches tenantId properly */
function buildMockDBWithLookup(tenants: MockTenantRow[] | 'throw') {
  return {
    prepare: (_sql: string) => ({
      bind: (tenantId: string) => ({
        first: async <T>() => {
          if (tenants === 'throw') {
            throw new Error('D1 database unavailable');
          }
          const found = tenants.find((t) => t.id === tenantId) || null;
          return found as T | null;
        },
      }),
    }),
  } as unknown as D1Database;
}

/** Future date (30 days from now) */
function futureDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

/** Past date (30 days ago) */
function pastDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
}

function buildApp(db: D1Database, options?: { role?: string; tenantId?: string }) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = { DB: db } as unknown as Env;
    c.set('role', options?.role || 'hospital_admin');
    if (options?.tenantId !== undefined) {
      c.set('tenantId', options.tenantId);
    }
    await next();
  });

  app.use('/api/*', subscriptionGuard);

  app.get('/api/test', (c) => c.json({ ok: true }));

  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
  );

  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Subscription Middleware', () => {

  describe('Super admin bypass', () => {
    it('allows super_admin to skip subscription check entirely', async () => {
      const db = buildMockDB([]);
      const app = buildApp(db, { role: 'super_admin', tenantId: 't1' });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });
  });

  describe('No tenant context', () => {
    it('skips check when tenantId is not set (public routes)', async () => {
      const db = buildMockDB([]);
      const app = buildApp(db, { role: 'hospital_admin', tenantId: undefined as unknown as string });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });
  });

  describe('Active subscription', () => {
    it('allows access when tenant has active paid subscription', async () => {
      const db = buildMockDBWithLookup([{
        id: 't1', plan: 'professional', trial_ends_at: null,
        plan_price: 4999, billing_cycle: 'monthly', addons: '[]', status: 'active',
      }]);
      const app = buildApp(db, { tenantId: 't1' });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });

    it('allows access when tenant has active trial', async () => {
      const db = buildMockDBWithLookup([{
        id: 't1', plan: 'starter', trial_ends_at: futureDate(),
        plan_price: null, billing_cycle: null, addons: '[]', status: 'active',
      }]);
      const app = buildApp(db, { tenantId: 't1' });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });
  });

  describe('Expired subscription', () => {
    it('returns 402 when trial expired and no paid plan', async () => {
      const db = buildMockDBWithLookup([{
        id: 't1', plan: 'starter', trial_ends_at: pastDate(),
        plan_price: null, billing_cycle: null, addons: '[]', status: 'active',
      }]);
      const app = buildApp(db, { tenantId: 't1' });
      const res = await app.request('/api/test');
      expect(res.status).toBe(402);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/subscription/i);
    });
  });

  describe('Suspended tenant', () => {
    it('returns 403 when tenant is suspended', async () => {
      const db = buildMockDBWithLookup([{
        id: 't1', plan: 'professional', trial_ends_at: futureDate(),
        plan_price: 4999, billing_cycle: 'monthly', addons: '[]', status: 'suspended',
      }]);
      const app = buildApp(db, { tenantId: 't1' });
      const res = await app.request('/api/test');
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/suspend/i);
    });
  });

  describe('Tenant not found', () => {
    it('returns 404 when tenant does not exist in DB', async () => {
      const db = buildMockDBWithLookup([]); // No tenants
      const app = buildApp(db, { tenantId: 'nonexistent' });
      const res = await app.request('/api/test');
      expect(res.status).toBe(404);
    });
  });

  // ─── Security hardening: fail-closed on DB error ─────────────────────────

  describe('DB failure behavior (security hardening)', () => {
    it('returns 503 when D1 is unavailable instead of failing open', async () => {
      // SECURITY BUG: Currently, catch block does `return next()` (fail-open).
      // If D1 is down, expired trials and suspended tenants get full access.
      // Fix: return 503 so subscription gating is enforced even during outages.
      const db = buildMockDB('throw');
      const app = buildApp(db, { tenantId: 't1' });
      const res = await app.request('/api/test');

      // Current behavior: 200 (fail-open, BUG). Expected: 503 (fail-closed).
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/unavailable|service|subscription/i);
    });
  });
});

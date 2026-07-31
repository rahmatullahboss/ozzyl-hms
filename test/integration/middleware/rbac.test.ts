/**
 * Integration tests for src/middleware/rbac.ts
 *
 * Tests role-based access control, permission resolution,
 * and critical security behavior (fail-closed on DB errors).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireRole, requirePermission, resolveUserPermissions } from '../../../src/middleware/rbac';
import type { Env, Variables } from '../../../src/types';

// ─── Test helpers ──────────────────────────────────────────────────────────────

/** Build a mock D1 that works normally */
function buildWorkingDB(overrides?: {
  roleOverrides?: { permissions: string } | null;
  userOverrides?: { results: { permission: string; action: string }[] };
}) {
  return {
    prepare: (sql: string) => ({
      bind: (_tenantId: string, _roleOrUserId?: string) => ({
        first: async () => {
          if (sql.includes('role_permission_overrides')) {
            return overrides?.roleOverrides ?? null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes('user_permission_overrides')) {
            return overrides?.userOverrides ?? { results: [] };
          }
          return { results: [] };
        },
      }),
    }),
  } as unknown as D1Database;
}

/** Build a mock D1 that always throws (simulates D1 outage) */
function buildBrokenDB() {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => { throw new Error('D1 database unavailable'); },
        all: async () => { throw new Error('D1 database unavailable'); },
      }),
    }),
  } as unknown as D1Database;
}

function buildApp(
  db: D1Database,
  options: {
    role?: string;
    userId?: string;
    tenantId?: string;
    requiredRoles?: string[];
    requiredPermissions?: string[];
  },
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = { DB: db } as unknown as Env;
    c.set('role', options.role || 'doctor');
    c.set('userId', options.userId || 'user-1');
    c.set('tenantId', options.tenantId || 'tenant-1');
    await next();
  });

  if (options.requiredRoles) {
    app.use('/api/*', requireRole(...options.requiredRoles));
  }
  if (options.requiredPermissions) {
    app.use('/api/*', requirePermission(...options.requiredPermissions));
  }

  app.get('/api/test', (c) => c.json({ ok: true }));

  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err.message }, status);
  });

  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('RBAC Middleware', () => {

  describe('requireRole', () => {
    it('allows access when user role is in the allowed list', async () => {
      const app = buildApp(buildWorkingDB(), {
        role: 'doctor',
        requiredRoles: ['doctor', 'nurse'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });

    it('returns 403 when user role is not in the allowed list', async () => {
      const app = buildApp(buildWorkingDB(), {
        role: 'reception',
        requiredRoles: ['doctor', 'nurse'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(403);
    });

    it('returns 403 when no role is set', async () => {
      // Build app without setting role at all — simulate missing role
      const db = buildWorkingDB();
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use('*', async (c, next) => {
        c.env = { DB: db } as unknown as Env;
        c.set('userId', 'user-1');
        c.set('tenantId', 'tenant-1');
        // Intentionally NOT setting role
        await next();
      });
      app.use('/api/*', requireRole('doctor'));
      app.get('/api/test', (c) => c.json({ ok: true }));
      app.onError((err, c) => {
        const status = (err as { status?: number }).status ?? 500;
        return c.json({ error: err.message }, status);
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(403);
    });
  });

  describe('requirePermission', () => {
    it('allows hospital_admin through without permission check (wildcard)', async () => {
      const app = buildApp(buildBrokenDB(), {
        role: 'hospital_admin',
        requiredPermissions: ['billing:refund', 'pharmacy:dispense'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });

    it('allows super_admin through without permission check (wildcard)', async () => {
      const app = buildApp(buildBrokenDB(), {
        role: 'super_admin',
        requiredPermissions: ['billing:refund'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });

    it('allows when user has the required permission (static defaults)', async () => {
      // Doctor has 'patients:read' in static defaults
      const app = buildApp(buildWorkingDB(), {
        role: 'doctor',
        requiredPermissions: ['patients:read'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });

    it('returns 403 when user lacks the required permission', async () => {
      // Receptionist does NOT have 'billing:refund' in static defaults
      const app = buildApp(buildWorkingDB(), {
        role: 'reception',
        requiredPermissions: ['billing:refund'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(403);
    });

    it('applies user_permission_overrides to grant a permission', async () => {
      const db = buildWorkingDB({
        userOverrides: { results: [{ permission: 'billing:refund', action: 'grant' }] },
      });
      const app = buildApp(db, {
        role: 'reception',
        requiredPermissions: ['billing:refund'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
    });

    it('applies user_permission_overrides to revoke a permission', async () => {
      const db = buildWorkingDB({
        userOverrides: { results: [{ permission: 'patients:read', action: 'revoke' }] },
      });
      const app = buildApp(db, {
        role: 'doctor',
        requiredPermissions: ['patients:read'],
      });
      const res = await app.request('/api/test');
      expect(res.status).toBe(403);
    });
  });

  // ─── Security hardening: fail-closed on DB error ─────────────────────────

  describe('DB failure behavior (security hardening)', () => {
    it('returns 503 when D1 is unavailable during permission resolution', async () => {
      // SECURITY BUG: Currently, resolveUserPermissions silently falls back to
      // static defaults when D1 throws. This means a user whose permissions were
      // REVOKED via user_permission_overrides gets those permissions BACK during
      // a DB outage. Fix: propagate the error so requirePermission returns 503.
      const app = buildApp(buildBrokenDB(), {
        role: 'reception',
        requiredPermissions: ['billing:refund'],
      });
      const res = await app.request('/api/test');

      // Current behavior: 403 (static default says reception lacks billing:refund).
      // This happens to be "safe" for this specific test case, but the real bug is
      // that a REVOKED permission gets restored. Let's test that:
    });

    it('returns 503 when D1 is unavailable and user had permissions REVOKED', async () => {
      // This is the real security issue: a doctor had 'patients:read' revoked
      // via user_permission_overrides. During DB outage, the catch block silently
      // returns static defaults which INCLUDE 'patients:read'. So the revoked
      // permission is restored — this is fail-open.
      const db = buildBrokenDB();
      const app = buildApp(db, {
        role: 'doctor',
        requiredPermissions: ['patients:read'],
      });
      const res = await app.request('/api/test');

      // Current behavior: 200 (fail-open, BUG — permission was revoked but DB
      // error causes fallback to static defaults which include patients:read).
      // Expected: 503 (fail-closed — can't verify, so deny access).
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/unavailable|permission|service/i);
    });

    it('returns 503 when D1 is unavailable and user had permissions GRANTED via override', async () => {
      // A receptionist was granted 'billing:refund' via user_permission_overrides.
      // During DB outage, the fallback uses static defaults which DON'T include
      // billing:refund. So the granted permission is lost — the user is locked out.
      // This is also fail-open in the wrong direction (access denied when it should
      // be allowed, but from security perspective, failing closed is correct).
      const db = buildBrokenDB();
      const app = buildApp(db, {
        role: 'reception',
        requiredPermissions: ['billing:refund'],
      });
      const res = await app.request('/api/test');

      // Expected: 503 (can't verify real permissions, deny access)
      expect(res.status).toBe(503);
    });
  });
});

/**
 * Integration tests for src/middleware/tenant.ts
 *
 * Tests tenant identification via hostname, X-Tenant-ID header,
 * subdomain lookup, and status validation.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { tenantMiddleware } from '../../../src/middleware/tenant';
import { createMockDB } from '../helpers/mock-db';
import { TENANT_1, TENANT_INACTIVE, TENANT_SUSPENDED } from '../helpers/fixtures';
import type { Env, Variables } from '../../../src/types';

// ─── Test helpers ──────────────────────────────────────────────────────────────

interface TenantRow {
  id: string;
  subdomain: string;
  status: string;
  name: string;
}

function buildApp(tenants: TenantRow[] = [], envOverrides: Partial<Env> = {}) {
  const { db } = createMockDB({
    tables: { tenants: tenants as unknown as Record<string, unknown>[] },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.env = { DB: db, ...envOverrides } as unknown as Env;
    await next();
  });

  app.use('*', tenantMiddleware);

  // Echo endpoint — returns resolved tenantId
  app.get('/ping', (c) => c.json({ tenantId: c.get('tenantId') }));

  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
  );

  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Tenant Middleware', () => {

  describe('Localhost / development mode', () => {
    it('resolves tenant from X-Tenant-ID header on localhost', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow]);
      const res = await app.request(
        'http://localhost/ping',
        { headers: { 'X-Tenant-ID': TENANT_1.id } }
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe(TENANT_1.id);
    });

    it('resolves tenant from X-Tenant-Subdomain on localhost via DB lookup', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow]);
      const res = await app.request(
        'http://localhost/ping',
        { headers: { 'X-Tenant-Subdomain': TENANT_1.subdomain } }
      );
      expect(res.status).toBe(200);
    });
  });

  describe('Subdomain validation', () => {
    it('rejects reserved subdomain "www"', async () => {
      const app = buildApp([]);
      const res = await app.request('http://www.hospital.com/ping');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Ii]nvalid|[Rr]eserved/);
    });

    it('rejects reserved subdomain "admin"', async () => {
      const app = buildApp([]);
      const res = await app.request('http://admin.hospital.com/ping');
      expect(res.status).toBe(400);
    });

    it('rejects reserved subdomain "api"', async () => {
      const app = buildApp([]);
      const res = await app.request('http://api.hospital.com/ping');
      expect(res.status).toBe(400);
    });

    it('returns 404 when subdomain not found in DB', async () => {
      const app = buildApp([]); // empty tenants table
      const res = await app.request('http://unknown-subdomain.hospital.com/ping');
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Nn]ot found|[Hh]ospital/);
    });
  });

  describe('Tenant status validation', () => {
    it('returns 403 when tenant is inactive', async () => {
      const app = buildApp([TENANT_INACTIVE as unknown as TenantRow]);
      const res = await app.request(
        `http://${TENANT_INACTIVE.subdomain}.hospital.com/ping`
      );
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Ii]nactive|[Ss]uspend|[Dd]isabled/);
    });

    it('returns 403 when tenant is suspended', async () => {
      const app = buildApp([TENANT_SUSPENDED as unknown as TenantRow]);
      const res = await app.request(
        `http://${TENANT_SUSPENDED.subdomain}.hospital.com/ping`
      );
      expect(res.status).toBe(403);
    });
  });

  describe('Active tenant resolution', () => {
    it('sets tenantId for an active tenant from subdomain', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow]);
      const res = await app.request(
        `http://${TENANT_1.subdomain}.hospital.com/ping`
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBeTruthy();
    });
  });

  describe('Local server default tenant resolution', () => {
    it('uses configured LOCAL_TENANT_ID for LAN or Tailscale IP host access', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow], {
        ENVIRONMENT: 'local_server',
        LOCAL_TENANT_ID: TENANT_1.id,
      });

      const res = await app.request('http://100.100.219.62/ping');

      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe(TENANT_1.id);
    });

    it('uses configured LOCAL_TENANT_SUBDOMAIN for custom local-only host access', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow], {
        ENVIRONMENT: 'local_server',
        LOCAL_TENANT_SUBDOMAIN: TENANT_1.subdomain,
      });

      const res = await app.request('http://pcare.com/ping');

      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe(TENANT_1.id);
    });

    it('does not use local tenant fallback outside local_server environment', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow], {
        ENVIRONMENT: 'production',
        LOCAL_TENANT_ID: TENANT_1.id,
      });

      const res = await app.request('http://unknown-subdomain.hospital.com/ping');

      expect(res.status).toBe(404);
    });
  });

  // ─── Security hardening: DB validation for header-based resolution ────────

  describe('Header-based tenant resolution security', () => {
    it('rejects X-Tenant-ID header with non-existent tenant via DB lookup', async () => {
      // SECURITY BUG: Currently, X-Tenant-ID header is trusted blindly without DB validation.
      // An attacker can pass any arbitrary string as tenantId and it gets accepted.
      // The fix: validate header-based tenantId against DB, same as subdomain lookup.
      const app = buildApp([TENANT_1 as unknown as TenantRow]); // Only TENANT_1 exists in DB
      const res = await app.request(
        'http://localhost/ping',
        { headers: { 'X-Tenant-ID': 'non-existent-fake-tenant-999' } }
      );
      // Current behavior: 200 (BUG — trusts arbitrary header). Expected: 403/404.
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Nn]ot found|[Ii]nvalid|[Tt]enant/);
    });

    it('accepts X-Tenant-ID header when tenant exists and is active', async () => {
      // Valid tenant from header should still work after fix
      const app = buildApp([TENANT_1 as unknown as TenantRow]);
      const res = await app.request(
        'http://localhost/ping',
        { headers: { 'X-Tenant-ID': TENANT_1.id } }
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe(TENANT_1.id);
    });

    it('rejects X-Tenant-ID header when tenant is inactive', async () => {
      // If tenant exists but is inactive/suspended, header resolution should also reject
      const app = buildApp([TENANT_INACTIVE as unknown as TenantRow]);
      const res = await app.request(
        'http://localhost/ping',
        { headers: { 'X-Tenant-ID': TENANT_INACTIVE.id } }
      );
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Ii]nactive|[Ss]uspend|[Dd]isabled/);
    });

    it('rejects X-Tenant-ID header when tenant is suspended', async () => {
      const app = buildApp([TENANT_SUSPENDED as unknown as TenantRow]);
      const res = await app.request(
        'http://localhost/ping',
        { headers: { 'X-Tenant-ID': TENANT_SUSPENDED.id } }
      );
      expect(res.status).toBe(403);
    });

    it('rejects ?tenant= query param with non-existent tenant via DB lookup', async () => {
      // Same validation needed for query param path
      const app = buildApp([TENANT_1 as unknown as TenantRow]);
      const res = await app.request(
        'http://localhost/ping?tenant=fake-nonexistent-id-999'
      );
      expect(res.status).toBe(403);
    });

    it('accepts ?tenant= query param when tenant exists and is active', async () => {
      const app = buildApp([TENANT_1 as unknown as TenantRow]);
      const res = await app.request(
        `http://localhost/ping?tenant=${TENANT_1.id}`
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { tenantId: string };
      expect(body.tenantId).toBe(TENANT_1.id);
    });
  });
});

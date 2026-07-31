import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { aiFeatureGuard } from '../src/middleware/ai-guard';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import type { Env, Variables } from '../src/types';

function createGuardTestApp(options: {
  role?: string;
  tenantId?: string;
  mockDB?: ReturnType<typeof createMockDB>;
} = {}) {
  const { role, tenantId, mockDB } = options;
  const db = mockDB ?? createMockDB();

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    if (tenantId !== undefined) {
      c.set('tenantId', tenantId as Variables['tenantId']);
    }
    c.set('userId', '1');
    if (role) {
      c.set('role', role as Variables['role']);
    }
    c.env = {
      DB: db.db,
      KV: {} as KVNamespace,
      JWT_SECRET: 'test-secret',
      ENVIRONMENT: 'test',
    } as unknown as Env;
    await next();
  });

  app.route('/ai', (() => {
    const route = new Hono<{ Bindings: Env; Variables: Variables }>();
    route.use('/*', aiFeatureGuard);
    route.get('/', (c) => c.json({ ok: true }));
    return route;
  })());

  return { app, mockDB: db };
}

describe('AI Feature Guard middleware', () => {
  it('super admin bypasses check → 200', async () => {
    const { app } = createGuardTestApp({ role: 'super_admin' });

    const res = await app.request('/ai');

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('no tenant context → 400', async () => {
    const { app } = createGuardTestApp({ role: 'doctor' });

    const res = await app.request('/ai');

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Tenant context required');
  });

  it('tenant not found → 404', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from tenants')) {
          return { results: [], first: null };
        }
        return null;
      },
    });

    const { app } = createGuardTestApp({
      role: 'doctor',
      tenantId: 'tenant-missing',
      mockDB,
    });

    const res = await app.request('/ai');

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Tenant not found');
  });

  it('tenant has ai-summary addon → 200', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from tenants')) {
          return {
            results: [{ addons: JSON.stringify(['ai-summary', 'lab-module']), ai_enabled: 0 }],
            first: { addons: JSON.stringify(['ai-summary', 'lab-module']), ai_enabled: 0 },
          };
        }
        return null;
      },
    });

    const { app } = createGuardTestApp({
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/ai');

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('tenant has ai_enabled=1 → 200', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from tenants')) {
          return {
            results: [{ addons: '[]', ai_enabled: 1 }],
            first: { addons: '[]', ai_enabled: 1 },
          };
        }
        return null;
      },
    });

    const { app } = createGuardTestApp({
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/ai');

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('tenant has no AI → 402', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from tenants')) {
          return {
            results: [{ addons: '["lab-module"]', ai_enabled: 0 }],
            first: { addons: '["lab-module"]', ai_enabled: 0 },
          };
        }
        return null;
      },
    });

    const { app } = createGuardTestApp({
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/ai');

    expect(res.status).toBe(402);
    const body = await res.json() as { error: string; upgradeUrl: string };
    expect(body.error).toBe('AI feature not enabled');
    expect(body.upgradeUrl).toBe('/api/subscribe/ai-summary');
  });

  it('invalid addons JSON → still checks ai_enabled flag', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from tenants')) {
          return {
            results: [{ addons: 'not-valid-json{{{', ai_enabled: 1 }],
            first: { addons: 'not-valid-json{{{', ai_enabled: 1 },
          };
        }
        return null;
      },
    });

    const { app } = createGuardTestApp({
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/ai');

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('DB error → 500', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from tenants')) {
          throw new Error('Database connection failed');
        }
        return null;
      },
    });

    const { app } = createGuardTestApp({
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await app.request('/ai');

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Feature check failed');
  });
});

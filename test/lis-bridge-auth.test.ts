import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import { authMiddleware } from '../src/middleware/auth';
import { lisBridgeAuthMiddleware } from '../src/middleware/lis-bridge-auth';

const BRIDGE_VALUE = ['bridge', 'value'].join('-');
const WRONG_BRIDGE_VALUE = ['wrong', 'value'].join('-');

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ keys: [] }),
    } as unknown as KVNamespace,
    UPLOADS: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    JWT_SECRET: ['jwt', 'value'].join('-'),
    ENVIRONMENT: 'development',
    ALLOWED_ORIGINS: '',
    LIS_BRIDGE_API_KEY: BRIDGE_VALUE,
    LIS_BRIDGE_USER_ID: '42',
    ...overrides,
  };
}

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('/api/*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    await next();
  });
  app.use('/api/*', lisBridgeAuthMiddleware);
  app.use('/api/*', async (c, next) => {
    if (c.get('lisBridgeAuth')) {
      await next();
      return;
    }
    return authMiddleware(c, next);
  });

  app.post('/api/lab-machines/hl7/receive', (c) => c.json({
    bridge: c.get('lisBridgeAuth'),
    role: c.get('role'),
    userId: c.get('userId'),
  }));
  app.get('/api/lab-machines', (c) => c.json({ ok: true, role: c.get('role') }));
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

  return app;
}

describe('LIS bridge authentication', () => {
  it('allows a configured bridge value on analyzer ingest endpoints without staff JWT', async () => {
    const res = await createApp().request('/api/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'X-LIS-Bridge-Key': BRIDGE_VALUE },
    }, createEnv());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      bridge: true,
      role: 'laboratory',
      userId: '42',
    });
  });

  it('fails closed when the legacy bridge audit actor is missing', async () => {
    const res = await createApp().request('/api/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'X-LIS-Bridge-Key': BRIDGE_VALUE },
    }, createEnv({ LIS_BRIDGE_USER_ID: undefined }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'LIS bridge audit actor is not configured',
    });
  });

  it('does not let the bridge value unlock the general machine settings API', async () => {
    const res = await createApp().request('/api/lab-machines', {
      method: 'GET',
      headers: { 'X-LIS-Bridge-Key': BRIDGE_VALUE },
    }, createEnv());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'No token provided' });
  });

  it('rejects a wrong bridge value before analyzer payload processing', async () => {
    const res = await createApp().request('/api/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'X-LIS-Bridge-Key': WRONG_BRIDGE_VALUE },
    }, createEnv());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid LIS bridge key' });
  });

  it('fails closed when a bridge value is supplied but the server value is missing', async () => {
    const res = await createApp().request('/api/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'X-LIS-Bridge-Key': BRIDGE_VALUE },
    }, createEnv({ LIS_BRIDGE_API_KEY: undefined }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'LIS bridge authentication is not configured' });
  });
});

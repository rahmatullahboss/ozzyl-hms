import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env, Variables } from '../src/types';
import { lisBridgeAuthMiddleware } from '../src/middleware/lis-bridge-auth';
import {
  createLisBridgeRequestSignature,
  sha256Hex,
} from '../src/lib/lis-bridge-signing';

function createNonceDb() {
  const nonces = new Set<string>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (sql.includes('INSERT INTO lis_bridge_request_nonces')) {
                const nonceKey = `${params[0]}:${params[1]}:${params[2]}`;
                if (nonces.has(nonceKey)) throw new Error('UNIQUE constraint failed: lis_bridge_request_nonces');
                nonces.add(nonceKey);
              }
              return { success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, nonces };
}

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('/api/*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    await next();
  });
  app.use('/api/*', lisBridgeAuthMiddleware);
  app.post('/api/lab-machines/:machineId/receive', (c) => c.json({
    bridge: c.get('lisBridgeAuth'),
    role: c.get('role'),
    userId: c.get('userId'),
  }));
  app.onError((error, c) => c.json({ error: error.message }, (error as any).status ?? 500));
  return app;
}

function createEnv(
  db: D1Database,
  keyOverrides: Record<string, unknown> = {},
): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    UPLOADS: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    JWT_SECRET: 'test-' + 'jwt',
    ENVIRONMENT: 'development',
    ALLOWED_ORIGINS: '',
    LIS_BRIDGE_KEYS_JSON: JSON.stringify({
      'key-1': {
        secret: 'signed-' + 'secret',
        tenantId: 'tenant-1',
        userId: '42',
        allowedMachineIds: [7],
        ...keyOverrides,
      },
    }),
    LIS_BRIDGE_ALLOW_LEGACY_KEY: 'false',
  } as Env;
}

async function signedHeaders(input: {
  method?: string;
  path?: string;
  body: string;
  timestamp?: number;
  nonce?: string;
  deliveryId?: string;
  secret?: string;
}) {
  const method = input.method ?? 'POST';
  const path = input.path ?? '/api/lab-machines/7/receive';
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? 'nonce-1';
  const deliveryId = input.deliveryId ?? 'delivery-1';
  const bodyHash = await sha256Hex(input.body);
  const signature = await createLisBridgeRequestSignature(input.secret ?? 'signed-' + 'secret', {
    method,
    path,
    timestamp,
    nonce,
    deliveryId,
    bodySha256: bodyHash,
  });
  return {
    'content-type': 'application/json',
    'X-LIS-Key-Id': 'key-1',
    'X-LIS-Timestamp': String(timestamp),
    'X-LIS-Nonce': nonce,
    'X-LIS-Delivery-Id': deliveryId,
    'X-LIS-Body-SHA256': bodyHash,
    'X-LIS-Signature': signature,
  };
}

describe('signed LIS bridge authentication', () => {
  it('accepts a valid per-key signed request and binds the configured audit actor', async () => {
    const { db } = createNonceDb();
    const body = JSON.stringify({ barcode: 'BC-1', results: [] });
    const response = await createApp().request('/api/lab-machines/7/receive', {
      method: 'POST',
      headers: await signedHeaders({ body }),
      body,
    }, createEnv(db));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ bridge: true, role: 'laboratory', userId: '42' });
  });

  it('fails closed when a signed key has no positive audit actor configured', async () => {
    const { db } = createNonceDb();
    const body = JSON.stringify({ barcode: 'BC-1', results: [] });
    const response = await createApp().request('/api/lab-machines/7/receive', {
      method: 'POST',
      headers: await signedHeaders({ body }),
      body,
    }, createEnv(db, { userId: undefined }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'LIS bridge audit actor is not configured',
    });
  });

  it('rejects body tampering even when the signature headers are otherwise valid', async () => {
    const { db } = createNonceDb();
    const signedBody = JSON.stringify({ barcode: 'BC-1', results: [] });
    const tamperedBody = JSON.stringify({ barcode: 'BC-2', results: [] });
    const response = await createApp().request('/api/lab-machines/7/receive', {
      method: 'POST',
      headers: await signedHeaders({ body: signedBody }),
      body: tamperedBody,
    }, createEnv(db));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid LIS bridge body hash' });
  });

  it('rejects an expired signed request', async () => {
    const { db } = createNonceDb();
    const body = '{}';
    const response = await createApp().request('/api/lab-machines/7/receive', {
      method: 'POST',
      headers: await signedHeaders({ body, timestamp: Math.floor(Date.now() / 1000) - 600 }),
      body,
    }, createEnv(db));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Expired LIS bridge request' });
  });

  it('rejects a replayed nonce after the first signed request succeeds', async () => {
    const { db } = createNonceDb();
    const app = createApp();
    const env = createEnv(db);
    const body = '{}';
    const headers = await signedHeaders({ body, nonce: 'replay-nonce', deliveryId: 'delivery-replay' });

    const first = await app.request('/api/lab-machines/7/receive', { method: 'POST', headers, body }, env);
    const second = await app.request('/api/lab-machines/7/receive', { method: 'POST', headers, body }, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: 'Replayed LIS bridge request' });
  });

  it('rejects a key scoped to another tenant', async () => {
    const { db } = createNonceDb();
    const body = '{}';
    const response = await createApp().request('/api/lab-machines/7/receive', {
      method: 'POST',
      headers: await signedHeaders({ body }),
      body,
    }, createEnv(db, { tenantId: 'tenant-2' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'LIS bridge key is not authorized for this tenant' });
  });

  it('rejects revoked and machine-scope-mismatched keys', async () => {
    for (const keyOverrides of [{ revoked: true }, { allowedMachineIds: [8] }]) {
      const { db } = createNonceDb();
      const body = '{}';
      const response = await createApp().request('/api/lab-machines/7/receive', {
        method: 'POST',
        headers: await signedHeaders({ body }),
        body,
      }, createEnv(db, keyOverrides));

      expect(response.status).toBe(keyOverrides.revoked ? 401 : 403);
    }
  });
});

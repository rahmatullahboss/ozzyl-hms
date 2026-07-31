import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

function createEnv(overrides: Partial<Env> = {}) {
  const mockDB = createMockDB();
  const mockKV = createMockKV();
  return {
    env: {
      DB: mockDB.db,
      KV: mockKV.kv,
      UPLOADS: { list: async () => ({ objects: [], truncated: false }), get: async () => null },
      ASSETS: { fetch: async () => new Response('asset') },
      JWT_SECRET: 'test-jwt-secret',
      ENVIRONMENT: 'local_server',
      ALLOWED_ORIGINS: '',
      HMS_LOCAL_SERVER_SYNC_SECRET: '0123456789abcdef0123456789abcdef',
      ...overrides,
    } as unknown as Env,
  };
}

function adminAuthHeader() {
  return {};
}

function signedSyncHeaders(version: string, body: string) {
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', '0123456789abcdef0123456789abcdef')
    .update(`${version}\n${timestamp}\n${body}`)
    .digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Sync-Schema-Version': version,
    'X-Sync-Timestamp': timestamp,
    'X-Sync-Signature': signature,
  };
}

describe('local schema-sync routes', () => {
  it('GET /api/local-server/schema-sync/status requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request('http://localhost/api/local-server/schema-sync/status'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/local-server/schema-sync/approvals requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request('http://localhost/api/local-server/schema-sync/approvals'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('POST /api/local-server/schema-sync/sync (internal) accepts a manifest body', async () => {
    const { env } = createEnv();
    const body = {
      version: '2026-06-07T00:00:00Z',
      migrations: [
        { filename: '0334_add_x.sql', order: 334, safety: 'safe', contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', sql: 'CREATE TABLE x (id INTEGER);' },
      ],
    };
    const rawBody = JSON.stringify(body);
    const res = await worker.fetch(
      new Request('http://localhost/api/local-server/schema-sync/sync', {
        method: 'POST',
        headers: signedSyncHeaders(body.version, rawBody),
        body: rawBody,
      }),
      env,
    );
    expect([200, 202]).toContain(res.status);
  });
});

describe('local schema-sync admin endpoints (when authenticated)', () => {
  function adminAuthedRequest(path: string, init: RequestInit = {}) {
    return new Request(`http://localhost${path}`, init);
  }

  it('GET /api/local-server/schema-sync/approvals requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      adminAuthedRequest('/api/local-server/schema-sync/approvals'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/local-server/schema-sync/log requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      adminAuthedRequest('/api/local-server/schema-sync/log'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('POST approve requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      adminAuthedRequest('/api/local-server/schema-sync/approvals/0334d_drop_x.sql/approve', {
        method: 'POST',
      }),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });
});

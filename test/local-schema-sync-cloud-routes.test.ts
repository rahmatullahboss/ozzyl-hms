import { gzipSync } from 'node:zlib';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { MIGRATIONS, MIGRATIONS_CHECKSUM, MIGRATIONS_VERSION } from '../src/data/schema-migrations.generated';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

function createManifestObject() {
  const manifest = {
    version: MIGRATIONS_VERSION,
    checksum: MIGRATIONS_CHECKSUM,
    migrations: MIGRATIONS.map((migration) => ({ ...migration, sql: '-- test migration sql' })),
  };
  const bytes = gzipSync(JSON.stringify(manifest));
  return {
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function createEnv() {
  const mockDB = createMockDB();
  const mockKV = createMockKV();
  return {
    env: {
      DB: mockDB.db,
      KV: mockKV.kv,
      UPLOADS: { list: async () => ({ objects: [], truncated: false }), get: async () => createManifestObject() },
      ASSETS: { fetch: async () => new Response('asset') },
      JWT_SECRET: 'test-jwt-secret',
      ENVIRONMENT: 'production',
      ALLOWED_ORIGINS: '',
      CLOUD_SYNC_TOKEN: 'cloud-sync-secret',
    } as unknown as Env,
  };
}

function authedRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: 'Bearer cloud-sync-secret' },
  });
}

describe('cloud schema manifest endpoints', () => {
  it('GET /api/sync/schema/manifest/checksum requires bearer auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request('http://localhost/api/sync/schema/manifest/checksum'),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/sync/schema/manifest/checksum returns version + checksum', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(authedRequest('/api/sync/schema/manifest/checksum'), env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(typeof body.version).toBe('string');
    expect(typeof body.checksum).toBe('string');
    expect(body.checksum as string).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(typeof body.migrationCount).toBe('number');
    expect(body.migrationCount as number).toBeGreaterThan(0);
  });

  it('GET /api/sync/schema/manifest returns the migrations list', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(authedRequest('/api/sync/schema/manifest'), env);
    const body = (await res.json()) as { migrations: Record<string, unknown>[]; version: string };
    expect(res.status).toBe(200);
    expect(Array.isArray(body.migrations)).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.migrations.length).toBeGreaterThan(0);
    const first = body.migrations[0];
    expect(typeof first.filename).toBe('string');
    expect(typeof first.order).toBe('number');
    expect(first.safety === 'safe' || first.safety === 'destructive').toBe(true);
    expect(typeof first.contentHash).toBe('string');
    expect(typeof first.sql).toBe('string');
  });
});

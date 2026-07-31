import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { getBoundD1, getTenantD1, resolveTenantDbRoute, resolveTenantDbRouteFromEnv } from '../src/lib/tenant-db';

function makeD1(row?: Record<string, unknown> | null): D1Database {
  return {
    prepare() {
      const statement = {
        first: async () => row ?? null,
        bind: () => statement,
      };
      return statement;
    },
  } as unknown as D1Database;
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: makeD1(),
    KV: {} as KVNamespace,
    UPLOADS: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    JWT_SECRET: 'test',
    ENVIRONMENT: 'test',
    ALLOWED_ORIGINS: 'http://localhost',
    ...overrides,
  } as Env;
}

describe('tenant DB routing', () => {
  it('falls back to default DB when no route exists', async () => {
    const route = await resolveTenantDbRoute(fakeEnv(), 'hospital-a');
    expect(route).toMatchObject({ tenantId: 'hospital-a', shardKey: 'main', dbBinding: 'DB', source: 'default' });
  });

  it('resolves object env map routes', () => {
    const route = resolveTenantDbRouteFromEnv(fakeEnv({
      HMS_TENANT_DB_ROUTES_JSON: JSON.stringify({ 'hospital-a': 'DB_SHARD_01' }),
    }), 'hospital-a');
    expect(route).toMatchObject({ tenantId: 'hospital-a', dbBinding: 'DB_SHARD_01', source: 'env' });
  });

  it('resolves registry rows from tenant_db_routes', async () => {
    const route = await resolveTenantDbRoute(fakeEnv({
      DB: makeD1({ tenant_id: 'hospital-a', shard_key: 'shard-01', db_binding: 'DB_SHARD_01', status: 'active' }),
    }), 'hospital-a');
    expect(route).toMatchObject({ tenantId: 'hospital-a', shardKey: 'shard-01', dbBinding: 'DB_SHARD_01', source: 'registry' });
  });


  it('resolves object-valued env map routes', () => {
    const route = resolveTenantDbRouteFromEnv(fakeEnv({
      HMS_TENANT_DB_ROUTES_JSON: JSON.stringify({
        'hospital-a': { shardKey: 'shard-02', dbBinding: 'DB_SHARD_02', status: 'readonly' },
      }),
    }), 'hospital-a');
    expect(route).toMatchObject({ tenantId: 'hospital-a', shardKey: 'shard-02', dbBinding: 'DB_SHARD_02', status: 'readonly', source: 'env' });
  });

  it('ignores invalid env map JSON', () => {
    const route = resolveTenantDbRouteFromEnv(fakeEnv({ HMS_TENANT_DB_ROUTES_JSON: '{bad-json' }), 'hospital-a');
    expect(route).toBeNull();
  });

  it('ignores disabled registry rows', async () => {
    const route = await resolveTenantDbRoute(fakeEnv({
      DB: makeD1({ tenant_id: 'hospital-a', shard_key: 'old-shard', db_binding: 'DB_SHARD_01', status: 'disabled' }),
    }), 'hospital-a');
    expect(route).toMatchObject({ tenantId: 'hospital-a', shardKey: 'main', dbBinding: 'DB', source: 'default' });
  });

  it('falls back to default DB when mapped shard binding is missing', async () => {
    const env = fakeEnv({ HMS_TENANT_DB_ROUTES_JSON: JSON.stringify({ 'hospital-a': 'DB_SHARD_99' }) });
    await expect(getTenantD1(env, 'hospital-a')).resolves.toBe(env.DB);
  });

  it('returns shard binding object when available', () => {
    const shard = makeD1();
    expect(getBoundD1(fakeEnv({ DB_SHARD_01: shard }), 'DB_SHARD_01')).toBe(shard);
  });
});

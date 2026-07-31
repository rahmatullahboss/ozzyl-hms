import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock getDb to return our mock DB directly
vi.mock('../../src/db', () => ({
  getDb: (db: any) => db,
}));

import { resolveUserPermissionsCached, invalidatePermissionCache } from '../../src/middleware/rbac';

// ─── Mock factories ─────────────────────────────────────────────────────────

function makeMockDb(overrides?: { permissions?: string; userOverrides?: Array<{ permission: string; action: string }> }) {
  return {
    $client: {
      prepare: vi.fn((sql: string) => ({
        bind: (..._params: unknown[]) => ({
          first: async <T>() => {
            if (sql.includes('role_permission_overrides')) {
              return (overrides?.permissions ? { permissions: overrides.permissions } : null) as T;
            }
            return null as T;
          },
          all: async <T>() => ({
            results: (overrides?.userOverrides ?? []) as T[],
            success: true,
          }),
        }),
      })),
    },
  };
}

function makeMockKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: any) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

describe('resolveUserPermissionsCached', () => {
  const tenantId = 'tenant-1';
  const userId = 'user-1';
  const role = 'doctor';

  it('returns permissions from DB on first call (cache miss)', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();

    const perms = await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    expect(perms).toContain('patients:read');
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('returns permissions from KV cache on second call (cache hit)', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();

    const perms1 = await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);
    const perms2 = await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    expect(perms1).toEqual(perms2);
    // DB should only be queried once (first call)
    expect(kv.get).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('applies user permission overrides on top of base permissions', async () => {
    const db = makeMockDb({
      userOverrides: [
        { permission: 'billing:refund', action: 'grant' },
        { permission: 'patients:write', action: 'revoke' },
      ],
    });
    const kv = makeMockKv();

    const perms = await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    expect(perms).toContain('billing:refund');
    expect(perms).not.toContain('patients:write');
  });

  it('uses tenant role override when available', async () => {
    const db = makeMockDb({
      permissions: JSON.stringify(['custom:permission', 'another:permission']),
    });
    const kv = makeMockKv();

    const perms = await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    expect(perms).toContain('custom:permission');
    expect(perms).toContain('another:permission');
  });

  it('cache key includes tenantId, role, and userId', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();

    await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    const cacheKey = kv.put.mock.calls[0][0] as string;
    expect(cacheKey).toContain(tenantId);
    expect(cacheKey).toContain(role);
    expect(cacheKey).toContain(userId);
  });

  it('cache has TTL', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();

    await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    const options = kv.put.mock.calls[0][2] as { expirationTtl?: number };
    expect(options?.expirationTtl).toBeGreaterThan(0);
  });

  it('invalidates cache when permissions change', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();

    await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);
    expect(kv.put).toHaveBeenCalledTimes(1);

    await invalidatePermissionCache(kv as any, tenantId, userId, role);
    expect(kv.delete).toHaveBeenCalledTimes(1);

    await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);
    expect(kv.put).toHaveBeenCalledTimes(2);
  });

  it('falls back to DB when KV read fails', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();
    kv.get.mockRejectedValueOnce(new Error('KV unavailable'));

    const perms = await resolveUserPermissionsCached(db as any, kv as any, tenantId, role, userId);

    expect(perms).toContain('patients:read');
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('hospital_admin bypasses cache (wildcard)', async () => {
    const db = makeMockDb();
    const kv = makeMockKv();

    const perms = await resolveUserPermissionsCached(db as any, kv as any, tenantId, 'hospital_admin', userId);

    expect(perms).toContain('*');
    expect(db.$client.prepare).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });
});

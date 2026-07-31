import { normalizeRole } from './authz';

export interface CurrentTenantUserState {
  role: string;
  isActive: boolean;
}

interface CachedTenantUserState {
  exists: boolean;
  role?: string;
  isActive?: boolean;
}

const USER_AUTH_STATE_TTL_SECONDS = 300;

async function cacheCurrentUserState(
  kv: KVNamespace,
  cacheKey: string,
  value: CachedTenantUserState,
): Promise<void> {
  try {
    await kv.put(cacheKey, JSON.stringify(value), {
      expirationTtl: USER_AUTH_STATE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn('Current user authorization state cache write failed; using D1 result:', error);
  }
}

export function buildCurrentUserAuthStateKey(tenantId: string, userId: string): string {
  return `auth:user-state:${tenantId}:${userId}`;
}

export async function resolveCurrentTenantUserState(
  db: D1Database,
  kv: KVNamespace,
  tenantId: string,
  userId: string,
): Promise<CurrentTenantUserState | null> {
  const cacheKey = buildCurrentUserAuthStateKey(tenantId, userId);
  const cached = await kv.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CachedTenantUserState;
      if (!parsed.exists) return null;
      if (typeof parsed.role === 'string' && typeof parsed.isActive === 'boolean') {
        return { role: parsed.role, isActive: parsed.isActive };
      }
    } catch {
      await kv.delete(cacheKey);
    }
  }

  const user = await db.prepare(
    'SELECT role, is_active FROM users WHERE id = ? AND tenant_id = ? LIMIT 1',
  ).bind(userId, tenantId).first<{ role: string; is_active: number | boolean }>();

  if (!user) {
    await cacheCurrentUserState(kv, cacheKey, { exists: false });
    return null;
  }

  const state: CurrentTenantUserState = {
    role: normalizeRole(user.role) || user.role,
    isActive: user.is_active === true || Number(user.is_active) === 1,
  };
  await cacheCurrentUserState(kv, cacheKey, {
    exists: true,
    role: state.role,
    isActive: state.isActive,
  });
  return state;
}

export async function invalidateCurrentTenantUserState(
  kv: KVNamespace | undefined,
  tenantId: string,
  userId: string,
): Promise<void> {
  if (!kv) return;
  await kv.delete(buildCurrentUserAuthStateKey(tenantId, userId));
}

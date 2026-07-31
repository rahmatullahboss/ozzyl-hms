import { getDb, type DrizzleDb } from '../db';
import type { Env } from '../types';

export type TenantDbRouteSource = 'default' | 'env' | 'registry';
export type TenantDbRouteStatus = 'active' | 'migrating' | 'readonly' | 'disabled';

export interface TenantDbRoute {
  tenantId: string | null;
  shardKey: string;
  dbBinding: string;
  status: TenantDbRouteStatus;
  source: TenantDbRouteSource;
}

interface TenantDbRouteRow {
  tenant_id: string;
  shard_key: string | null;
  db_binding: string | null;
  status: TenantDbRouteStatus | null;
}

const DEFAULT_DB_BINDING = 'DB';
const DEFAULT_SHARD_KEY = 'main';
const VALID_BINDING_RE = /^[A-Z][A-Z0-9_]*$/;

function normalizeTenantId(tenantId: string | null | undefined): string | null {
  const value = tenantId?.trim();
  return value ? value : null;
}

function normalizeBinding(binding: string | null | undefined): string {
  const value = binding?.trim() || DEFAULT_DB_BINDING;
  return VALID_BINDING_RE.test(value) ? value : DEFAULT_DB_BINDING;
}

function normalizeStatus(status: string | null | undefined): TenantDbRouteStatus {
  if (status === 'migrating' || status === 'readonly' || status === 'disabled') return status;
  return 'active';
}

function defaultRoute(tenantId: string | null): TenantDbRoute {
  return {
    tenantId,
    shardKey: DEFAULT_SHARD_KEY,
    dbBinding: DEFAULT_DB_BINDING,
    status: 'active',
    source: 'default',
  };
}

export function resolveTenantDbRouteFromEnv(env: Env, tenantId: string | null | undefined): TenantDbRoute | null {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId || !env.HMS_TENANT_DB_ROUTES_JSON) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.HMS_TENANT_DB_ROUTES_JSON);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    const match = parsed.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const value = entry as Record<string, unknown>;
      return String(value.tenantId ?? value.tenant_id ?? '').trim() === normalizedTenantId;
    }) as Record<string, unknown> | undefined;
    if (!match) return null;
    return {
      tenantId: normalizedTenantId,
      shardKey: String(match.shardKey ?? match.shard_key ?? DEFAULT_SHARD_KEY),
      dbBinding: normalizeBinding(String(match.dbBinding ?? match.db_binding ?? DEFAULT_DB_BINDING)),
      status: normalizeStatus(String(match.status ?? 'active')),
      source: 'env',
    };
  }

  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>)[normalizedTenantId];
    if (typeof value === 'string') {
      return {
        tenantId: normalizedTenantId,
        shardKey: value === DEFAULT_DB_BINDING ? DEFAULT_SHARD_KEY : value.toLowerCase(),
        dbBinding: normalizeBinding(value),
        status: 'active',
        source: 'env',
      };
    }
    if (value && typeof value === 'object') {
      const route = value as Record<string, unknown>;
      return {
        tenantId: normalizedTenantId,
        shardKey: String(route.shardKey ?? route.shard_key ?? DEFAULT_SHARD_KEY),
        dbBinding: normalizeBinding(String(route.dbBinding ?? route.db_binding ?? DEFAULT_DB_BINDING)),
        status: normalizeStatus(String(route.status ?? 'active')),
        source: 'env',
      };
    }
  }

  return null;
}

export async function lookupTenantDbRoute(registryDb: D1Database, tenantId: string | null | undefined): Promise<TenantDbRoute | null> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return null;

  try {
    const row = await registryDb
      .prepare('SELECT tenant_id, shard_key, db_binding, status FROM tenant_db_routes WHERE tenant_id = ? LIMIT 1')
      .bind(normalizedTenantId)
      .first<TenantDbRouteRow>();

    if (!row) return null;
    if (normalizeStatus(row.status || 'active') === 'disabled') return null;

    return {
      tenantId: normalizedTenantId,
      shardKey: row.shard_key || DEFAULT_SHARD_KEY,
      dbBinding: normalizeBinding(row.db_binding || DEFAULT_DB_BINDING),
      status: normalizeStatus(row.status || 'active'),
      source: 'registry',
    };
  } catch {
    return null;
  }
}

export function getBoundD1(env: Env, bindingName: string): D1Database | null {
  const candidate = (env as unknown as Record<string, unknown>)[bindingName];
  if (candidate && typeof candidate === 'object' && 'prepare' in candidate) {
    return candidate as D1Database;
  }
  return null;
}

export async function resolveTenantDbRoute(env: Env, tenantId: string | null | undefined): Promise<TenantDbRoute> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  return (
    resolveTenantDbRouteFromEnv(env, normalizedTenantId) ||
    (await lookupTenantDbRoute(env.DB, normalizedTenantId)) ||
    defaultRoute(normalizedTenantId)
  );
}

export async function getTenantD1(env: Env, tenantId: string | null | undefined): Promise<D1Database> {
  const route = await resolveTenantDbRoute(env, tenantId);
  return getBoundD1(env, route.dbBinding) || env.DB;
}

export async function getTenantDrizzle(env: Env, tenantId: string | null | undefined): Promise<DrizzleDb> {
  return getDb(await getTenantD1(env, tenantId));
}

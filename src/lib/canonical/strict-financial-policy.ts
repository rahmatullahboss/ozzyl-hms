import type { CanonicalBatchDatabase } from './command-batch';

export const STRICT_FINANCIAL_FLAG_KEY = 'canonical_financial_dual_write_v1';
export const STRICT_FINANCIAL_TENANT_ID = '100';

export type FinancialWritePolicy = 'legacy' | 'shadow' | 'strict';

export interface ResolvedFinancialPolicy {
  enabled: boolean;
  writePolicy: FinancialWritePolicy;
}

export type CanonicalStrictFinancialErrorCode =
  | 'CANONICAL_STRICT_POLICY_INVALID'
  | 'CANONICAL_STRICT_WRITE_FAILED'
  | 'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED';

export class CanonicalStrictFinancialError extends Error {
  readonly status = 409;

  constructor(
    readonly code: CanonicalStrictFinancialErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CanonicalStrictFinancialError';
  }
}

interface StrictFinancialFlagRow {
  tenant_id: string;
  flag_key: string;
  domain: string;
  mode: string;
  is_enabled: number;
  config_json: string | null;
}

function invalidPolicy(): CanonicalStrictFinancialError {
  return new CanonicalStrictFinancialError(
    'CANONICAL_STRICT_POLICY_INVALID',
    'Canonical financial shadow/strict policy is invalid',
  );
}

function parseStrictFinancialConfig(value: string | null): {
  writePolicy: string;
  tenantScope: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? 'null');
  } catch {
    throw invalidPolicy();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidPolicy();

  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'tenantScope,writePolicy'
    || typeof record.writePolicy !== 'string'
    || !Array.isArray(record.tenantScope)
    || record.tenantScope.some((item) => typeof item !== 'string')
  ) {
    throw invalidPolicy();
  }

  return {
    writePolicy: record.writePolicy,
    tenantScope: record.tenantScope as string[],
  };
}

export async function resolveStrictFinancialPolicy(
  db: CanonicalBatchDatabase,
  tenantId: string,
): Promise<ResolvedFinancialPolicy> {
  const normalizedTenantId = String(tenantId ?? '').trim();
  if (!normalizedTenantId) return { enabled: false, writePolicy: 'legacy' };

  let row: StrictFinancialFlagRow | null;
  try {
    row = await db
      .prepare(
        `SELECT tenant_id, flag_key, domain, mode, is_enabled, config_json
         FROM canonical_feature_flags
         WHERE tenant_id = ? AND flag_key = ?
           AND (effective_at_utc IS NULL OR effective_at_utc <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           AND (expires_at_utc IS NULL OR expires_at_utc >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ORDER BY version DESC, id DESC
         LIMIT 1`,
      )
      .bind(normalizedTenantId, STRICT_FINANCIAL_FLAG_KEY)
      .first<StrictFinancialFlagRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) {
      return { enabled: false, writePolicy: 'legacy' };
    }
    throw error;
  }

  if (!row || row.is_enabled !== 1 || row.mode === 'disabled') {
    return { enabled: false, writePolicy: 'legacy' };
  }

  const config = parseStrictFinancialConfig(row.config_json);
  const exactTenantScope = JSON.stringify(config.tenantScope) === JSON.stringify([normalizedTenantId]);
  const exactShadowMode = row.mode === 'shadow' && config.writePolicy === 'shadow';
  const exactStrictMode = row.mode === 'shadow'
    && config.writePolicy === 'strict'
    && normalizedTenantId === STRICT_FINANCIAL_TENANT_ID;

  if (
    row.tenant_id !== normalizedTenantId
    || row.flag_key !== STRICT_FINANCIAL_FLAG_KEY
    || row.domain !== 'financial'
    || !exactTenantScope
    || (!exactShadowMode && !exactStrictMode)
  ) {
    throw invalidPolicy();
  }

  return {
    enabled: true,
    writePolicy: exactStrictMode ? 'strict' : 'shadow',
  };
}

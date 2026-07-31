export const FINANCIAL_SHADOW_FLAG_KEY = 'canonical_financial_dual_write_v1';
export const TENANT_100_FINANCIAL_STRICT_CONFIG = '{"tenantScope":["100"],"writePolicy":"strict"}';
export const TENANT_100_FINANCIAL_SHADOW_CONFIG = '{"tenantScope":["100"],"writePolicy":"shadow"}';
export const TENANT_100_FINANCIAL_SHADOW_APPROVAL = 'CDB101-TENANT100-NONBLOCKING-SHADOW-20260720';

export interface Tenant100FinancialShadowGateway {
  readFlag(): Promise<Array<Record<string, unknown>>>;
  writeFlag(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

export type AllTenantFinancialShadowAction = 'enable' | 'disable';

export interface AllTenantFinancialShadowSqlInput {
  action: AllTenantFinancialShadowAction;
  operator: string;
  effectiveAtUtc: string;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertUtc(value: string): void {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error('effectiveAtUtc must be a valid UTC timestamp ending in Z');
  }
}

export function buildTenant100StrictToShadowSql(input: {
  operator: string;
  effectiveAtUtc: string;
  expectedVersion: number;
}): string {
  assertUtc(input.effectiveAtUtc);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error('expectedVersion must be a positive integer');
  }
  const operator = sqlString(input.operator.trim());
  const effectiveAtUtc = sqlString(input.effectiveAtUtc);
  return `UPDATE canonical_feature_flags
SET config_json = '${TENANT_100_FINANCIAL_SHADOW_CONFIG}',
    version = version + 1,
    effective_at_utc = ${effectiveAtUtc},
    expires_at_utc = NULL,
    updated_by_public_id = ${operator},
    updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE tenant_id = '100'
  AND flag_key = '${FINANCIAL_SHADOW_FLAG_KEY}'
  AND domain = 'financial'
  AND mode = 'shadow'
  AND is_enabled = 1
  AND version = ${input.expectedVersion}
  AND config_json = '${TENANT_100_FINANCIAL_STRICT_CONFIG}';`;
}

function isExactTenant100FinancialPolicy(
  row: Record<string, unknown>,
  configJson: string,
  version: number,
): boolean {
  return row.tenant_id === '100'
    && row.flag_key === FINANCIAL_SHADOW_FLAG_KEY
    && row.domain === 'financial'
    && row.mode === 'shadow'
    && Number(row.is_enabled) === 1
    && Number(row.version) === version
    && row.config_json === configJson;
}

export async function executeTenant100StrictToShadow(
  input: {
    operator: string;
    effectiveAtUtc: string;
    expectedVersion: number;
    approval: string;
    execute: boolean;
  },
  gateway: Tenant100FinancialShadowGateway,
): Promise<{
  transitioned: true;
  previousVersion: number;
  currentVersion: number;
  writePolicy: 'shadow';
}> {
  if (!input.execute) throw new Error('Explicit execute switch is required');
  if (input.approval !== TENANT_100_FINANCIAL_SHADOW_APPROVAL) {
    throw new Error('Tenant 100 financial shadow approval mismatch');
  }

  const before = await gateway.readFlag();
  if (
    before.length !== 1
    || !isExactTenant100FinancialPolicy(
      before[0],
      TENANT_100_FINANCIAL_STRICT_CONFIG,
      input.expectedVersion,
    )
  ) {
    throw new Error('Tenant 100 flag is not the exact active strict policy expected for transition');
  }

  const write = await gateway.writeFlag(buildTenant100StrictToShadowSql(input));
  if (write.changes !== 1 || write.rowsWritten < 1) {
    throw new Error('Tenant 100 financial shadow transition did not update exactly one row');
  }

  const currentVersion = input.expectedVersion + 1;
  const after = await gateway.readFlag();
  if (
    after.length !== 1
    || !isExactTenant100FinancialPolicy(
      after[0],
      TENANT_100_FINANCIAL_SHADOW_CONFIG,
      currentVersion,
    )
  ) {
    throw new Error('Tenant 100 financial shadow transition post-state verification failed');
  }

  return {
    transitioned: true,
    previousVersion: input.expectedVersion,
    currentVersion,
    writePolicy: 'shadow',
  };
}

export function buildAllTenantFinancialShadowSql(
  input: AllTenantFinancialShadowSqlInput,
): string {
  assertUtc(input.effectiveAtUtc);
  const operator = sqlString(input.operator.trim());
  const effectiveAtUtc = sqlString(input.effectiveAtUtc);

  if (input.action === 'disable') {
    return `UPDATE canonical_feature_flags
SET mode = 'disabled',
    is_enabled = 0,
    version = version + 1,
    updated_by_public_id = ${operator},
    updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE flag_key = '${FINANCIAL_SHADOW_FLAG_KEY}'
  AND domain = 'financial'
  AND mode = 'shadow'
  AND is_enabled = 1
  AND json_extract(config_json, '$.writePolicy') = 'shadow'
  AND tenant_id IN (SELECT CAST(id AS TEXT) FROM tenants WHERE status = 'active');`;
  }

  return `INSERT INTO canonical_feature_flags (
  tenant_id, flag_key, domain, mode, is_enabled, version, config_json,
  effective_at_utc, expires_at_utc, updated_by_public_id, updated_at_utc
)
SELECT
  CAST(t.id AS TEXT),
  '${FINANCIAL_SHADOW_FLAG_KEY}',
  'financial',
  'shadow',1,
  1,
  json_object('tenantScope', json_array(CAST(t.id AS TEXT)), 'writePolicy', 'shadow'),
  ${effectiveAtUtc},
  NULL,
  ${operator},
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM tenants t
WHERE t.status = 'active'
ON CONFLICT(tenant_id,flag_key) DO UPDATE SET
  domain = 'financial',
  mode = 'shadow',
  is_enabled = 1,
  version = canonical_feature_flags.version + 1,
  config_json = json_object(
    'tenantScope', json_array(canonical_feature_flags.tenant_id),
    'writePolicy', 'shadow'
  ),
  effective_at_utc = excluded.effective_at_utc,
  expires_at_utc = NULL,
  updated_by_public_id = excluded.updated_by_public_id,
  updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now');`;
}

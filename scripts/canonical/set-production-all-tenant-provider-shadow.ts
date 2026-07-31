export const ALL_TENANT_PROVIDER_SHADOW_FLAGS = [
  { flagKey: 'canonical_invoice_provider_v1', domain: 'finance' },
  { flagKey: 'canonical_payment_provider_v1', domain: 'finance' },
  { flagKey: 'canonical_deposit_provider_v1', domain: 'finance' },
  { flagKey: 'canonical_patient_identity_provider_v1', domain: 'identity' },
  { flagKey: 'canonical_practitioner_provider_v1', domain: 'practitioner' },
  { flagKey: 'canonical_appointment_provider_v1', domain: 'appointment' },
  { flagKey: 'canonical_encounter_provider_v1', domain: 'encounter' },
  { flagKey: 'canonical_admission_bed_provider_v1', domain: 'admission_bed' },
  { flagKey: 'canonical_compensation_accrual_provider_v1', domain: 'compensation' },
] as const;

export type AllTenantProviderShadowAction = 'enable' | 'disable';

export interface AllTenantProviderShadowSqlInput {
  action: AllTenantProviderShadowAction;
  operator: string;
  effectiveAtUtc: string;
}

export interface AllTenantProviderShadowAggregateRow extends Record<string, unknown> {
  flag_key: unknown;
  expected_tenant_count: unknown;
  shadow_enabled_count: unknown;
  missing_count: unknown;
  non_shadow_count: unknown;
}

export interface AllTenantProviderShadowScopeReceipt {
  evidenceReady: true;
  activationReady: boolean;
  providerCount: number;
  activeTenantCount: number;
  issueCount: number;
  issues: string[];
  aggregateOnly: true;
  productionMutationPerformed: false;
  rowsWritten: 0;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertUtc(value: string): void {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error('effectiveAtUtc must be a valid UTC timestamp ending in Z');
  }
}

function flagValuesSql(): string {
  return ALL_TENANT_PROVIDER_SHADOW_FLAGS
    .map((flag) => `('${flag.flagKey}','${flag.domain}')`)
    .join(',\n    ');
}

function flagKeyListSql(): string {
  return ALL_TENANT_PROVIDER_SHADOW_FLAGS
    .map((flag) => `'${flag.flagKey}'`)
    .join(',');
}

export function buildAllTenantProviderShadowSql(
  input: AllTenantProviderShadowSqlInput,
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
WHERE flag_key IN (${flagKeyListSql()})
  AND mode = 'shadow'
  AND is_enabled = 1
  AND json_extract(config_json, '$.responseAuthority') = 'legacy'
  AND json_extract(config_json, '$.readPolicy') = 'shadow'
  AND tenant_id IN (SELECT CAST(id AS TEXT) FROM tenants WHERE status = 'active');`;
  }

  return `WITH provider_flags(flag_key,domain) AS (
  VALUES
    ${flagValuesSql()}
)
INSERT INTO canonical_feature_flags (
  tenant_id,flag_key,domain,mode,is_enabled,version,config_json,
  effective_at_utc,expires_at_utc,updated_by_public_id,updated_at_utc
)
SELECT
  CAST(t.id AS TEXT),
  f.flag_key,
  f.domain,
  'shadow',
  1,
  1,
  json_object(
    'tenantScope',json_array(CAST(t.id AS TEXT)),
    'readPolicy','shadow',
    'responseAuthority','legacy'
  ),
  ${effectiveAtUtc},
  NULL,
  ${operator},
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM tenants t
CROSS JOIN provider_flags f
WHERE t.status = 'active'
ON CONFLICT(tenant_id,flag_key) DO UPDATE SET
  domain = excluded.domain,
  mode = 'shadow',
  is_enabled = 1,
  version = canonical_feature_flags.version + 1,
  config_json = excluded.config_json,
  effective_at_utc = excluded.effective_at_utc,
  expires_at_utc = NULL,
  updated_by_public_id = excluded.updated_by_public_id,
  updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now');`;
}

export function buildAllTenantProviderShadowVerificationSql(): string {
  return `WITH active_tenants AS (
  SELECT CAST(id AS TEXT) AS tenant_id
  FROM tenants
  WHERE status = 'active'
),
provider_flags(flag_key,domain) AS (
  VALUES
    ${flagValuesSql()}
),
expected AS (
  SELECT a.tenant_id,f.flag_key,f.domain
  FROM active_tenants a
  CROSS JOIN provider_flags f
)
SELECT
  e.flag_key,
  COUNT(*) AS expected_tenant_count,
  SUM(CASE
    WHEN c.mode = 'shadow'
      AND c.is_enabled = 1
      AND json_extract(c.config_json, '$.readPolicy') = 'shadow'
      AND json_extract(c.config_json, '$.responseAuthority') = 'legacy'
    THEN 1 ELSE 0 END
  ) AS shadow_enabled_count,
  SUM(CASE WHEN c.tenant_id IS NULL THEN 1 ELSE 0 END) AS missing_count,
  SUM(CASE
    WHEN c.tenant_id IS NOT NULL AND NOT (
      c.mode = 'shadow'
      AND c.is_enabled = 1
      AND json_extract(c.config_json, '$.readPolicy') = 'shadow'
      AND json_extract(c.config_json, '$.responseAuthority') = 'legacy'
    ) THEN 1 ELSE 0 END
  ) AS non_shadow_count
FROM expected e
LEFT JOIN canonical_feature_flags c
  ON c.tenant_id = e.tenant_id
 AND c.flag_key = e.flag_key
GROUP BY e.flag_key
ORDER BY e.flag_key;`;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

export function evaluateAllTenantProviderShadowScope(
  rows: readonly AllTenantProviderShadowAggregateRow[],
): AllTenantProviderShadowScopeReceipt {
  const expectedKeys = new Set(ALL_TENANT_PROVIDER_SHADOW_FLAGS.map((flag) => flag.flagKey));
  const seen = new Set<string>();
  const issues: string[] = [];
  let activeTenantCount: number | null = null;

  for (const row of rows) {
    if (typeof row.flag_key !== 'string' || !expectedKeys.has(row.flag_key as never)) {
      throw new Error('provider shadow evidence contains an unexpected flag key');
    }
    const flagKey = row.flag_key;
    if (seen.has(flagKey)) throw new Error(`duplicate provider shadow evidence: ${flagKey}`);
    seen.add(flagKey);

    const expectedTenantCount = nonNegativeInteger(
      row.expected_tenant_count,
      `expected_tenant_count:${flagKey}`,
    );
    const shadowEnabledCount = nonNegativeInteger(
      row.shadow_enabled_count,
      `shadow_enabled_count:${flagKey}`,
    );
    const missingCount = nonNegativeInteger(row.missing_count, `missing_count:${flagKey}`);
    const nonShadowCount = nonNegativeInteger(row.non_shadow_count, `non_shadow_count:${flagKey}`);

    if (activeTenantCount == null) activeTenantCount = expectedTenantCount;
    else if (expectedTenantCount !== activeTenantCount) {
      issues.push(`PROVIDER_SHADOW_ACTIVE_TENANT_COUNT_MISMATCH:${flagKey}`);
    }
    if (missingCount > 0 || shadowEnabledCount !== expectedTenantCount) {
      issues.push(`PROVIDER_SHADOW_INCOMPLETE:${flagKey}`);
    }
    if (nonShadowCount > 0) issues.push(`PROVIDER_SHADOW_NON_SHADOW:${flagKey}`);
  }

  for (const flag of ALL_TENANT_PROVIDER_SHADOW_FLAGS) {
    if (!seen.has(flag.flagKey)) issues.push(`PROVIDER_SHADOW_EVIDENCE_MISSING:${flag.flagKey}`);
  }

  const uniqueIssues = [...new Set(issues)];
  return {
    evidenceReady: true,
    activationReady: uniqueIssues.length === 0
      && rows.length === ALL_TENANT_PROVIDER_SHADOW_FLAGS.length,
    providerCount: rows.length,
    activeTenantCount: activeTenantCount ?? 0,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    aggregateOnly: true,
    productionMutationPerformed: false,
    rowsWritten: 0,
  };
}

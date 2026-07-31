import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const FINANCIAL_STRICT_FLAG_KEY = 'canonical_financial_dual_write_v1';
export const FINANCIAL_STRICT_CONFIG = '{"tenantScope":["100"],"writePolicy":"strict"}';

export type FinancialStrictFlagAction = 'enable' | 'disable';

export interface FinancialStrictFlagExecutionInput {
  action: FinancialStrictFlagAction;
  evidence: FinancialStrictActivationEvidence;
  atUtc: string;
  effectiveAtUtc: string;
  approval: string | null;
  execute: boolean;
}

export interface FinancialStrictFlagExecutionResult {
  allowed: boolean;
  issues: string[];
  action: FinancialStrictFlagAction;
  externalCommandCount: number;
  productionMutationPerformed: boolean;
}

export interface FinancialStrictDeploymentVersion {
  versionId: string;
  percentage: number;
}

export interface FinancialStrictExecutionGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readDeploymentVersions(): Promise<FinancialStrictDeploymentVersion[]>;
  readFlag(): Promise<Array<Record<string, unknown>>>;
  writeFlag(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

export interface FinancialStrictActivationEvidence {
  schemaVersion: 1;
  authorizationId: string;
  tenantId: string;
  operator: string;
  productionDatabaseId: string;
  candidateVersionId: string;
  candidateCommit: string;
  observedAtUtc: string;
  expiresAtUtc: string;
  baselineBundleSha256: string;
  sourceExportSha256: string;
  reconciliationReady: boolean;
  tenant101LegacySmokePassed: boolean;
  tenant100DualWriteAtomicSmokePassed: boolean;
  rollbackRehearsalPassed: boolean;
}

function utcMillis(value: string): number {
  return value.endsWith('Z') ? Date.parse(value) : Number.NaN;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function safeHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function validateFinancialStrictActivationEvidence(
  evidence: FinancialStrictActivationEvidence,
  atUtc: string,
): string[] {
  const issues: string[] = [];
  const at = utcMillis(atUtc);
  const observed = utcMillis(evidence.observedAtUtc);
  const expires = utcMillis(evidence.expiresAtUtc);
  if (evidence.schemaVersion !== 1) issues.push('CDB101_FINANCIAL_EVIDENCE_VERSION_INVALID');
  if (evidence.tenantId !== '100') issues.push('CDB101_FINANCIAL_TENANT_INVALID');
  if (evidence.operator !== 'Rahmatullah Zisan') issues.push('CDB101_FINANCIAL_OPERATOR_INVALID');
  if (evidence.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) issues.push('CDB101_FINANCIAL_DATABASE_INVALID');
  if (!/^[a-f0-9]{40}$/.test(evidence.candidateCommit)) issues.push('CDB101_FINANCIAL_CANDIDATE_COMMIT_INVALID');
  if (!evidence.candidateVersionId.trim()) issues.push('CDB101_FINANCIAL_CANDIDATE_VERSION_INVALID');
  if (!safeHash(evidence.baselineBundleSha256)) issues.push('CDB101_FINANCIAL_BASELINE_HASH_INVALID');
  if (!safeHash(evidence.sourceExportSha256)) issues.push('CDB101_FINANCIAL_SOURCE_HASH_INVALID');
  if (!Number.isFinite(at) || !Number.isFinite(observed) || !Number.isFinite(expires) || observed > at || expires <= at) {
    issues.push('CDB101_FINANCIAL_AUTHORIZATION_WINDOW_INVALID');
  }
  if (!evidence.reconciliationReady) issues.push('CDB101_FINANCIAL_RECONCILIATION_NOT_READY');
  if (!evidence.tenant101LegacySmokePassed) issues.push('CDB101_FINANCIAL_TENANT101_SMOKE_MISSING');
  if (!evidence.tenant100DualWriteAtomicSmokePassed) issues.push('CDB101_FINANCIAL_ATOMIC_SMOKE_MISSING');
  if (!evidence.rollbackRehearsalPassed) issues.push('CDB101_FINANCIAL_ROLLBACK_REHEARSAL_MISSING');
  if (!evidence.authorizationId.trim()) issues.push('CDB101_FINANCIAL_AUTHORIZATION_ID_INVALID');
  return [...new Set(issues)];
}

export function buildFinancialStrictFlagSql(input: {
  action: FinancialStrictFlagAction;
  evidence: FinancialStrictActivationEvidence;
  effectiveAtUtc: string;
}): string {
  const operator = sqlString(input.evidence.operator);
  if (input.action === 'disable') {
    return `UPDATE canonical_feature_flags
SET mode = 'disabled', is_enabled = 0, version = version + 1,
    updated_by_public_id = ${operator}, updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE tenant_id = '100'
  AND flag_key = '${FINANCIAL_STRICT_FLAG_KEY}'
  AND domain = 'financial'
  AND mode = 'shadow'
  AND is_enabled = 1
  AND config_json = '${FINANCIAL_STRICT_CONFIG}';`;
  }

  return `INSERT INTO canonical_feature_flags (
  tenant_id,flag_key,domain,mode,is_enabled,version,config_json,
  effective_at_utc,expires_at_utc,updated_by_public_id,updated_at_utc
) VALUES ('100','${FINANCIAL_STRICT_FLAG_KEY}','financial','shadow',1,1,
  '${FINANCIAL_STRICT_CONFIG}',${sqlString(input.effectiveAtUtc)},NULL,${operator},
  strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(tenant_id,flag_key) DO UPDATE SET
  domain = 'financial', mode = 'shadow', is_enabled = 1,
  version = canonical_feature_flags.version + 1,
  config_json = '${FINANCIAL_STRICT_CONFIG}',
  effective_at_utc = excluded.effective_at_utc, expires_at_utc = NULL,
  updated_by_public_id = excluded.updated_by_public_id,
  updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE canonical_feature_flags.tenant_id = '100'
  AND canonical_feature_flags.flag_key = '${FINANCIAL_STRICT_FLAG_KEY}'
  AND (
    canonical_feature_flags.is_enabled = 0
    OR canonical_feature_flags.mode = 'disabled'
  );`;
}

function validateFinancialStrictExecutionInput(
  input: FinancialStrictFlagExecutionInput,
): string[] {
  const issues = validateFinancialStrictActivationEvidence(input.evidence, input.atUtc);
  const at = utcMillis(input.atUtc);
  const effective = utcMillis(input.effectiveAtUtc);
  if (!Number.isFinite(effective) || !Number.isFinite(at) || effective > at) {
    issues.push('CDB101_FINANCIAL_EFFECTIVE_TIME_INVALID');
  }
  if (!input.execute) issues.push('CDB101_FINANCIAL_EXECUTE_SWITCH_MISSING');
  if (!input.evidence.authorizationId || input.approval !== input.evidence.authorizationId) {
    issues.push('CDB101_FINANCIAL_APPROVAL_MISMATCH');
  }
  return [...new Set(issues)];
}

function exactStrictRow(row: Record<string, unknown>): boolean {
  return row.tenant_id === '100'
    && row.flag_key === FINANCIAL_STRICT_FLAG_KEY
    && row.domain === 'financial'
    && row.mode === 'shadow'
    && Number(row.is_enabled) === 1
    && row.config_json === FINANCIAL_STRICT_CONFIG;
}

export async function executeFinancialStrictFlagChange(
  input: FinancialStrictFlagExecutionInput,
  gateway: FinancialStrictExecutionGateway,
): Promise<FinancialStrictFlagExecutionResult> {
  const issues = validateFinancialStrictExecutionInput(input);
  if (issues.length > 0) {
    return {
      allowed: false,
      issues,
      action: input.action,
      externalCommandCount: 0,
      productionMutationPerformed: false,
    };
  }

  let externalCommandCount = 0;
  externalCommandCount += 1;
  const database = await gateway.readDatabaseIdentity();
  if (database.uuid !== CDB101_PRODUCTION_DATABASE_ID || database.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production database identity verification failed');
  }

  externalCommandCount += 1;
  const deploymentVersions = await gateway.readDeploymentVersions();
  const baselineVersions = deploymentVersions.filter((version) => version.percentage === 100);
  const evidenceCandidates = deploymentVersions.filter((version) => (
    version.versionId === input.evidence.candidateVersionId && version.percentage === 0
  ));
  if (
    deploymentVersions.length !== 2
    || baselineVersions.length !== 1
    || evidenceCandidates.length !== 1
  ) {
    throw new Error('Financial strict deployment must preserve one 100-percent baseline and the evidence candidate at zero traffic');
  }

  externalCommandCount += 1;
  const beforeRows = await gateway.readFlag();
  if (beforeRows.length > 1) throw new Error('Financial strict flag lookup returned multiple rows');
  if (input.action === 'enable') {
    const safe = beforeRows.length === 0
      || Number(beforeRows[0].is_enabled) === 0
      || beforeRows[0].mode === 'disabled';
    if (!safe) throw new Error('Financial strict flag previous state is unsafe');
  } else if (beforeRows.length !== 1 || !exactStrictRow(beforeRows[0])) {
    throw new Error('Financial strict rollback target does not match the exact active flag');
  }

  externalCommandCount += 1;
  const write = await gateway.writeFlag(buildFinancialStrictFlagSql({
    action: input.action,
    evidence: input.evidence,
    effectiveAtUtc: input.effectiveAtUtc,
  }));
  if (write.changes !== 1 || write.rowsWritten < 1) {
    throw new Error('Financial strict flag write did not change exactly one row');
  }

  externalCommandCount += 1;
  const afterRows = await gateway.readFlag();
  const verified = input.action === 'enable'
    ? afterRows.length === 1 && exactStrictRow(afterRows[0])
    : afterRows.length === 1
      && afterRows[0].tenant_id === '100'
      && afterRows[0].flag_key === FINANCIAL_STRICT_FLAG_KEY
      && afterRows[0].mode === 'disabled'
      && Number(afterRows[0].is_enabled) === 0;
  if (!verified) throw new Error('Financial strict flag post-write verification failed');

  return {
    allowed: true,
    issues: [],
    action: input.action,
    externalCommandCount,
    productionMutationPerformed: true,
  };
}

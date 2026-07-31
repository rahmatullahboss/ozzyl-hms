import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssueCode,
} from './protected-json-document';
import {
  CDB_V1_070A_ACTIVE_TENANT_IDS,
  CDB_V1_070A_BACKFILL_PATHS,
  CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT,
  CDB_V1_070A_MIGRATION_NAMES,
  CDB_V1_070A_PROVIDER_KEYS,
  evaluateAllTenantShadowExecutionPackage,
  type AllTenantShadowExecutionPackage,
} from './all-tenant-shadow-execution-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const CDB_V1_070_PACKAGE_PATH =
  'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';

export interface AllTenantShadowAuthorizationRepositoryBinding {
  candidateBranch: 'main';
  candidateCommit: string;
  buildSha: string;
  minimumImplementationCommit: typeof CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT;
  packagePath: typeof CDB_V1_070_PACKAGE_PATH;
  packageSha256: string;
  packagePreparationCommit: string;
  migrationManifestPath: string;
  migrationManifestSha256: string;
  migrationCount: 504;
}

export interface AllTenantShadowExecutionAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'all_tenant_legacy_primary_shadow_execution';
  target: {
    platform: 'cloudflare_d1';
    databaseName: string;
    databaseUuid: string;
    environment: 'production';
    remote: true;
  };
  timing: {
    issuedAtUtc: string;
    windowStartUtc: string;
    windowEndUtc: string;
    expiresAtUtc: string;
  };
  owner: {
    ownerId: string;
    displayName: string;
    approved: boolean;
    approvalSource: 'user_explicit_all_tenant_legacy_primary_shadow_authorization';
    ownerModel: 'single_operator_risk_accepted';
    executionOwnerId: string;
    rollbackOwnerId: string;
    observationOwnerId: string;
    riskAcceptanceEvidenceId: string;
    riskAcceptanceEvidenceSha256: string;
    noTechnicalBackupAccepted: boolean;
    noMonitoringBackupAccepted: boolean;
    automaticAbortOnOperatorUnavailable: boolean;
  };
  activeTenantEvidence: {
    evidenceId: string;
    evidenceSha256: string;
    capturedAtUtc: string;
    allActiveTenants: boolean;
    tenantIds: string[];
  };
  repository: AllTenantShadowAuthorizationRepositoryBinding;
  deployment: {
    authorized: boolean;
    workerVersionId: string;
    previousWorkerVersionId: string;
    buildManifestSha256: string;
    routeFingerprintSha256: string;
    legacyDefaultVerified: boolean;
    previousWorkerRetained: boolean;
  };
  productionSnapshot: {
    bookmarkId: string;
    sha256: string;
    capturedAtUtc: string;
  };
  backupExport: {
    evidenceId: string;
    sha256: string;
    capturedAtUtc: string;
    restoreAuthorityConfirmed: boolean;
  };
  migrations: {
    authorized: boolean;
    serial: boolean;
    destructiveAllowed: boolean;
    dataPreservingTableRebuildsAuthorized: boolean;
    zeroRowLossRequired: boolean;
    tableRebuildEntries: Array<{
      name: string;
      sha256: string;
      rowParityEvidenceId: string;
      rowParityEvidenceSha256: string;
      maxExclusiveLockMs: number;
    }>;
    entries: Array<{ name: string; sha256: string }>;
  };
  backfills: {
    authorized: boolean;
    tenantIds: string[];
    secondPassRequired: boolean;
    entries: Array<{ path: string; sha256: string; partitionLimit: number }>;
  };
  providers: {
    authorized: boolean;
    tenantIds: string[];
    keys: string[];
    mode: 'shadow';
    responseAuthority: 'legacy';
    expectedFlagRowCount: number;
  };
  observation: {
    durationMinutes: number;
    maxP95LatencyMs: number;
    maxErrorRate: number;
    dailySummaryRequired: boolean;
  };
  acceptance: {
    integrityCheck: 'ok';
    foreignKeyViolations: number;
    criticalUnexplainedVarianceCount: number;
    providerErrorCount: number;
    mappingAmbiguityCount: number;
    crossTenantReferenceCount: number;
    secondPassNewBusinessRows: number;
    missingProviderFlagRows: number;
    nonShadowProviderFlagRows: number;
  };
  procedure: {
    deployLegacyDefaultFirst: boolean;
    captureTimeTravelBeforeMigration: boolean;
    verifyBackupExportBeforeMigration: boolean;
    serialMigrations: boolean;
    boundedBackfills: boolean;
    secondPassRequired: boolean;
    preActivationReconciliation: boolean;
    activateAllTenantShadow: boolean;
    postActivationScopeVerification: boolean;
    dailyObservation: boolean;
    immediateProviderDisableRollback: boolean;
    immediateWorkerRollback: boolean;
    noUserFacingDowntime: boolean;
  };
  rollback: {
    previousWorkerVersionId: string;
    disableAllNineProviders: boolean;
    restoreLegacyResponseAuthority: boolean;
    retainCanonicalEvidence: boolean;
    stopOnFirstFailure: boolean;
  };
  permissions: {
    productionRead: boolean;
    deployment: boolean;
    trafficChange: boolean;
    productionSchemaMigration: boolean;
    productionBackfill: boolean;
    providerShadowActivation: boolean;
    canonicalReadPromotion: boolean;
    canonicalWritePromotion: boolean;
    localSyncActivation: boolean;
    legacyRetirement: boolean;
    destructiveAction: boolean;
    remoteDatabaseDeletion: boolean;
    push: boolean;
    cdbToMainIntegration: boolean;
  };
  confirmation: {
    deployToken: string;
    migrationToken: string;
    backfillToken: string;
    shadowActivationToken: string;
    rollbackToken: string;
  };
}

export type AllTenantShadowExecutionAuthorizationIssueCode =
  | 'CDBV1070_AUTHORIZATION_INVALID_JSON'
  | 'CDBV1070_AUTHORIZATION_DUPLICATE_KEY'
  | 'CDBV1070_AUTHORIZATION_UNSAFE_KEY'
  | 'CDBV1070_AUTHORIZATION_TOO_LARGE'
  | 'CDBV1070_AUTHORIZATION_TOO_DEEP'
  | 'CDBV1070_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDBV1070_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDBV1070_AUTHORIZATION_FILE_PROTECTION_INVALID'
  | 'CDBV1070_AUTHORIZATION_UNKNOWN_FIELD'
  | 'CDBV1070_AUTHORIZATION_SENSITIVE_FIELD'
  | 'CDBV1070_AUTHORIZATION_SCHEMA_INVALID'
  | 'CDBV1070_AUTHORIZATION_TARGET_INVALID'
  | 'CDBV1070_AUTHORIZATION_BINDING_INVALID'
  | 'CDBV1070_AUTHORIZATION_SCOPE_INVALID'
  | 'CDBV1070_AUTHORIZATION_TIMING_INVALID'
  | 'CDBV1070_AUTHORIZATION_EXPIRED'
  | 'CDBV1070_AUTHORIZATION_OWNER_INVALID'
  | 'CDBV1070_AUTHORIZATION_DEPLOYMENT_INVALID'
  | 'CDBV1070_AUTHORIZATION_MIGRATION_INVALID'
  | 'CDBV1070_AUTHORIZATION_BACKFILL_INVALID'
  | 'CDBV1070_AUTHORIZATION_PROVIDER_INVALID'
  | 'CDBV1070_AUTHORIZATION_OBSERVATION_INVALID'
  | 'CDBV1070_AUTHORIZATION_ACCEPTANCE_INVALID'
  | 'CDBV1070_AUTHORIZATION_PROCEDURE_INVALID'
  | 'CDBV1070_AUTHORIZATION_ROLLBACK_INVALID'
  | 'CDBV1070_AUTHORIZATION_PERMISSION_INVALID'
  | 'CDBV1070_AUTHORIZATION_CONFIRMATION_INVALID';

export interface AllTenantShadowExecutionAuthorizationIssue {
  code: AllTenantShadowExecutionAuthorizationIssueCode;
  gate:
    | 'document'
    | 'file'
    | 'target'
    | 'binding'
    | 'scope'
    | 'timing'
    | 'authorization';
}

export interface AllTenantShadowExecutionAuthorizationResult {
  documentReady: boolean;
  executionReady: boolean;
  issues: AllTenantShadowExecutionAuthorizationIssue[];
  authorization: AllTenantShadowExecutionAuthorization | null;
}

export interface AllTenantShadowExecutionAuthorizationPlan {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION';
  authorizationId: string;
  productionDatabaseUuid: string;
  candidateCommit: string;
  workerVersionId: string;
  previousWorkerVersionId: string;
  tenantCount: number;
  migrationCount: number;
  backfillCount: number;
  providerCount: number;
  expectedProviderFlagRowCount: number;
  observationDurationMinutes: number;
  phases: readonly string[];
  abortConditions: readonly string[];
  finalResponseAuthority: 'legacy';
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
}

const DOCUMENT_OPTIONS = { maxBytes: 512 * 1024, maxDepth: 18 } as const;
const SENSITIVE_KEYS = new Set([
  'header',
  'headers',
  'cookie',
  'cookies',
  'token',
  'password',
  'secret',
  'credential',
  'credentials',
  'databaseurl',
  'rawoutput',
  'sql',
  'command',
  'environmentvariable',
  'apikey',
  'privatekey',
]);

const ROOT_KEYS = new Set([
  'schemaVersion',
  'authorizationId',
  'operation',
  'target',
  'timing',
  'owner',
  'activeTenantEvidence',
  'repository',
  'deployment',
  'productionSnapshot',
  'backupExport',
  'migrations',
  'backfills',
  'providers',
  'observation',
  'acceptance',
  'procedure',
  'rollback',
  'permissions',
  'confirmation',
]);
const TARGET_KEYS = new Set(['platform', 'databaseName', 'databaseUuid', 'environment', 'remote']);
const TIMING_KEYS = new Set(['issuedAtUtc', 'windowStartUtc', 'windowEndUtc', 'expiresAtUtc']);
const OWNER_KEYS = new Set([
  'ownerId',
  'displayName',
  'approved',
  'approvalSource',
  'ownerModel',
  'executionOwnerId',
  'rollbackOwnerId',
  'observationOwnerId',
  'riskAcceptanceEvidenceId',
  'riskAcceptanceEvidenceSha256',
  'noTechnicalBackupAccepted',
  'noMonitoringBackupAccepted',
  'automaticAbortOnOperatorUnavailable',
]);
const ACTIVE_TENANT_KEYS = new Set([
  'evidenceId',
  'evidenceSha256',
  'capturedAtUtc',
  'allActiveTenants',
  'tenantIds',
]);
const REPOSITORY_KEYS = new Set([
  'candidateBranch',
  'candidateCommit',
  'buildSha',
  'minimumImplementationCommit',
  'packagePath',
  'packageSha256',
  'packagePreparationCommit',
  'migrationManifestPath',
  'migrationManifestSha256',
  'migrationCount',
]);
const DEPLOYMENT_KEYS = new Set([
  'authorized',
  'workerVersionId',
  'previousWorkerVersionId',
  'buildManifestSha256',
  'routeFingerprintSha256',
  'legacyDefaultVerified',
  'previousWorkerRetained',
]);
const SNAPSHOT_KEYS = new Set(['bookmarkId', 'sha256', 'capturedAtUtc']);
const BACKUP_KEYS = new Set(['evidenceId', 'sha256', 'capturedAtUtc', 'restoreAuthorityConfirmed']);
const MIGRATIONS_KEYS = new Set([
  'authorized',
  'serial',
  'destructiveAllowed',
  'dataPreservingTableRebuildsAuthorized',
  'zeroRowLossRequired',
  'tableRebuildEntries',
  'entries',
]);
const MIGRATION_ENTRY_KEYS = new Set(['name', 'sha256']);
const TABLE_REBUILD_ENTRY_KEYS = new Set([
  'name',
  'sha256',
  'rowParityEvidenceId',
  'rowParityEvidenceSha256',
  'maxExclusiveLockMs',
]);
const BACKFILLS_KEYS = new Set(['authorized', 'tenantIds', 'secondPassRequired', 'entries']);
const BACKFILL_ENTRY_KEYS = new Set(['path', 'sha256', 'partitionLimit']);
const PROVIDERS_KEYS = new Set([
  'authorized',
  'tenantIds',
  'keys',
  'mode',
  'responseAuthority',
  'expectedFlagRowCount',
]);
const OBSERVATION_KEYS = new Set([
  'durationMinutes',
  'maxP95LatencyMs',
  'maxErrorRate',
  'dailySummaryRequired',
]);
const ACCEPTANCE_KEYS = new Set([
  'integrityCheck',
  'foreignKeyViolations',
  'criticalUnexplainedVarianceCount',
  'providerErrorCount',
  'mappingAmbiguityCount',
  'crossTenantReferenceCount',
  'secondPassNewBusinessRows',
  'missingProviderFlagRows',
  'nonShadowProviderFlagRows',
]);
const PROCEDURE_KEYS = new Set([
  'deployLegacyDefaultFirst',
  'captureTimeTravelBeforeMigration',
  'verifyBackupExportBeforeMigration',
  'serialMigrations',
  'boundedBackfills',
  'secondPassRequired',
  'preActivationReconciliation',
  'activateAllTenantShadow',
  'postActivationScopeVerification',
  'dailyObservation',
  'immediateProviderDisableRollback',
  'immediateWorkerRollback',
  'noUserFacingDowntime',
]);
const ROLLBACK_KEYS = new Set([
  'previousWorkerVersionId',
  'disableAllNineProviders',
  'restoreLegacyResponseAuthority',
  'retainCanonicalEvidence',
  'stopOnFirstFailure',
]);
const PERMISSION_KEYS = new Set([
  'productionRead',
  'deployment',
  'trafficChange',
  'productionSchemaMigration',
  'productionBackfill',
  'providerShadowActivation',
  'canonicalReadPromotion',
  'canonicalWritePromotion',
  'localSyncActivation',
  'legacyRetirement',
  'destructiveAction',
  'remoteDatabaseDeletion',
  'push',
  'cdbToMainIntegration',
]);
const CONFIRMATION_KEYS = new Set([
  'deployToken',
  'migrationToken',
  'backfillToken',
  'shadowActivationToken',
  'rollbackToken',
]);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function packageBytes(document: AllTenantShadowExecutionPackage): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function exactArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validGitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function gitCommitExists(root: string, commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function addIssue(
  issues: AllTenantShadowExecutionAuthorizationIssue[],
  code: AllTenantShadowExecutionAuthorizationIssueCode,
  gate: AllTenantShadowExecutionAuthorizationIssue['gate'],
): void {
  if (!issues.some((issue) => issue.code === code && issue.gate === gate)) {
    issues.push({ code, gate });
  }
}

function unknownKeys(value: unknown, allowed: ReadonlySet<string>): boolean {
  const entry = object(value);
  return !entry || Object.keys(entry).some((key) => !allowed.has(key));
}

function mapDocumentIssue(
  code: ProtectedJsonDocumentIssueCode,
): AllTenantShadowExecutionAuthorizationIssueCode {
  switch (code) {
    case 'INVALID_JSON': return 'CDBV1070_AUTHORIZATION_INVALID_JSON';
    case 'DUPLICATE_KEY': return 'CDBV1070_AUTHORIZATION_DUPLICATE_KEY';
    case 'UNSAFE_KEY': return 'CDBV1070_AUTHORIZATION_UNSAFE_KEY';
    case 'TOO_LARGE': return 'CDBV1070_AUTHORIZATION_TOO_LARGE';
    case 'TOO_DEEP': return 'CDBV1070_AUTHORIZATION_TOO_DEEP';
    case 'FILE_UNAVAILABLE': return 'CDBV1070_AUTHORIZATION_FILE_UNAVAILABLE';
    case 'FILE_INSIDE_REPOSITORY': return 'CDBV1070_AUTHORIZATION_FILE_INSIDE_REPOSITORY';
    case 'FILE_PROTECTION_INVALID': return 'CDBV1070_AUTHORIZATION_FILE_PROTECTION_INVALID';
  }
}

export function buildAllTenantShadowAuthorizationRepositoryBinding(
  repositoryRootInput: string,
  packageDocument: AllTenantShadowExecutionPackage,
  candidateCommit: string,
  buildSha: string,
): AllTenantShadowAuthorizationRepositoryBinding {
  const repositoryRoot = resolve(repositoryRootInput);
  if (!validGitSha(candidateCommit) || !gitCommitExists(repositoryRoot, candidateCommit)) {
    throw new Error('candidateCommit must be an existing 40-character Git commit');
  }
  if (!validGitSha(buildSha)) throw new Error('buildSha must be one 40-character Git SHA');
  if (!isAncestor(repositoryRoot, CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT, candidateCommit)) {
    throw new Error('candidateCommit does not contain the minimum all-tenant shadow implementation');
  }
  const packageEvaluation = evaluateAllTenantShadowExecutionPackage(repositoryRoot, packageDocument);
  if (!packageEvaluation.packageReady || packageEvaluation.issues.length > 0) {
    throw new Error(`repository package is invalid: ${packageEvaluation.issues.join(', ')}`);
  }
  return {
    candidateBranch: 'main',
    candidateCommit,
    buildSha,
    minimumImplementationCommit: CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT,
    packagePath: CDB_V1_070_PACKAGE_PATH,
    packageSha256: sha256(packageBytes(packageDocument)),
    packagePreparationCommit: packageDocument.preparation.repositoryCommit,
    migrationManifestPath: packageDocument.bindings.migrationManifestPath,
    migrationManifestSha256: packageDocument.bindings.migrationManifestSha256,
    migrationCount: 504,
  };
}

export function buildAllTenantShadowConfirmationTokens(
  authorization: AllTenantShadowExecutionAuthorization,
): AllTenantShadowExecutionAuthorization['confirmation'] {
  const migrationBinding = [
    authorization.migrations.entries
      .map((entry) => `${entry.name}:${entry.sha256}`)
      .join('|'),
    authorization.migrations.tableRebuildEntries
      .map((entry) => [
        entry.name,
        entry.sha256,
        entry.rowParityEvidenceId,
        entry.rowParityEvidenceSha256,
        String(entry.maxExclusiveLockMs),
      ].join(':'))
      .join('|'),
  ].join('\u0001');
  const backfillBinding = authorization.backfills.entries
    .map((entry) => `${entry.path}:${entry.sha256}:${entry.partitionLimit}`)
    .join('|');
  const tenantBinding = authorization.activeTenantEvidence.tenantIds.join(',');
  const providerBinding = authorization.providers.keys.join(',');
  return {
    deployToken: sha256([
      'cdbv1070',
      'deploy',
      authorization.target.databaseUuid,
      authorization.repository.candidateCommit,
      authorization.deployment.workerVersionId,
      authorization.deployment.previousWorkerVersionId,
    ].join('\0')),
    migrationToken: sha256([
      'cdbv1070',
      'migration',
      authorization.target.databaseUuid,
      authorization.repository.candidateCommit,
      migrationBinding,
    ].join('\0')),
    backfillToken: sha256([
      'cdbv1070',
      'backfill',
      authorization.target.databaseUuid,
      tenantBinding,
      backfillBinding,
    ].join('\0')),
    shadowActivationToken: sha256([
      'cdbv1070',
      'shadow',
      authorization.target.databaseUuid,
      tenantBinding,
      providerBinding,
      String(authorization.providers.expectedFlagRowCount),
      authorization.providers.responseAuthority,
    ].join('\0')),
    rollbackToken: sha256([
      'cdbv1070',
      'rollback',
      authorization.target.databaseUuid,
      authorization.rollback.previousWorkerVersionId,
      providerBinding,
      authorization.providers.responseAuthority,
    ].join('\0')),
  };
}

function evaluateValue(
  value: unknown,
  repositoryRootInput: string,
  packageDocument: AllTenantShadowExecutionPackage,
  atUtc: string,
): AllTenantShadowExecutionAuthorizationResult {
  const repositoryRoot = resolve(repositoryRootInput);
  const issues: AllTenantShadowExecutionAuthorizationIssue[] = [];
  const root = object(value);
  if (!root) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_SCHEMA_INVALID', 'document');
    return { documentReady: false, executionReady: false, issues, authorization: null };
  }

  if (containsNormalizedKey(value, SENSITIVE_KEYS)) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_SENSITIVE_FIELD', 'document');
  }

  const nestedUnknown = [
    [value, ROOT_KEYS],
    [root.target, TARGET_KEYS],
    [root.timing, TIMING_KEYS],
    [root.owner, OWNER_KEYS],
    [root.activeTenantEvidence, ACTIVE_TENANT_KEYS],
    [root.repository, REPOSITORY_KEYS],
    [root.deployment, DEPLOYMENT_KEYS],
    [root.productionSnapshot, SNAPSHOT_KEYS],
    [root.backupExport, BACKUP_KEYS],
    [root.migrations, MIGRATIONS_KEYS],
    [root.backfills, BACKFILLS_KEYS],
    [root.providers, PROVIDERS_KEYS],
    [root.observation, OBSERVATION_KEYS],
    [root.acceptance, ACCEPTANCE_KEYS],
    [root.procedure, PROCEDURE_KEYS],
    [root.rollback, ROLLBACK_KEYS],
    [root.permissions, PERMISSION_KEYS],
    [root.confirmation, CONFIRMATION_KEYS],
  ] as Array<[unknown, ReadonlySet<string>]>;
  if (nestedUnknown.some(([entry, keys]) => unknownKeys(entry, keys))) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_UNKNOWN_FIELD', 'document');
  }
  const migrationObject = object(root.migrations);
  const backfillObject = object(root.backfills);
  if (
    (Array.isArray(migrationObject?.entries)
      && migrationObject.entries.some((entry) => unknownKeys(entry, MIGRATION_ENTRY_KEYS)))
    || (Array.isArray(migrationObject?.tableRebuildEntries)
      && migrationObject.tableRebuildEntries.some((entry) => unknownKeys(entry, TABLE_REBUILD_ENTRY_KEYS)))
    || (Array.isArray(backfillObject?.entries)
      && backfillObject.entries.some((entry) => unknownKeys(entry, BACKFILL_ENTRY_KEYS)))
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_UNKNOWN_FIELD', 'document');
  }

  if (
    root.schemaVersion !== 1
    || root.operation !== 'all_tenant_legacy_primary_shadow_execution'
    || !nonEmpty(root.authorizationId)
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_SCHEMA_INVALID', 'document');
  }

  const target = object(root.target);
  if (
    target?.platform !== 'cloudflare_d1'
    || target?.databaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || target?.databaseUuid !== CDB101_PRODUCTION_DATABASE_ID
    || target?.environment !== 'production'
    || target?.remote !== true
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_TARGET_INVALID', 'target');
  }

  const packageEvaluation = evaluateAllTenantShadowExecutionPackage(repositoryRoot, packageDocument);
  if (!packageEvaluation.packageReady || packageEvaluation.issues.length > 0) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_BINDING_INVALID', 'binding');
  }
  const repository = object(root.repository);
  const candidateCommit = repository?.candidateCommit;
  if (
    repository?.candidateBranch !== 'main'
    || !validGitSha(candidateCommit)
    || !gitCommitExists(repositoryRoot, candidateCommit)
    || !validGitSha(repository?.buildSha)
    || repository?.minimumImplementationCommit !== CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT
    || !isAncestor(repositoryRoot, CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT, candidateCommit)
    || repository?.packagePath !== CDB_V1_070_PACKAGE_PATH
    || repository?.packageSha256 !== sha256(packageBytes(packageDocument))
    || repository?.packagePreparationCommit !== packageDocument.preparation.repositoryCommit
    || repository?.migrationManifestPath !== packageDocument.bindings.migrationManifestPath
    || repository?.migrationManifestSha256 !== packageDocument.bindings.migrationManifestSha256
    || repository?.migrationCount !== 504
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_BINDING_INVALID', 'binding');
  }

  const timing = object(root.timing);
  const nowMs = Date.parse(atUtc);
  const issuedMs = validDate(timing?.issuedAtUtc) ? Date.parse(timing.issuedAtUtc) : Number.NaN;
  const startMs = validDate(timing?.windowStartUtc) ? Date.parse(timing.windowStartUtc) : Number.NaN;
  const endMs = validDate(timing?.windowEndUtc) ? Date.parse(timing.windowEndUtc) : Number.NaN;
  const expiresMs = validDate(timing?.expiresAtUtc) ? Date.parse(timing.expiresAtUtc) : Number.NaN;
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(issuedMs)
    || !Number.isFinite(startMs)
    || !Number.isFinite(endMs)
    || !Number.isFinite(expiresMs)
    || !(issuedMs <= startMs && startMs < endMs && endMs <= expiresMs)
    || nowMs < issuedMs
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_TIMING_INVALID', 'timing');
  } else {
    if (nowMs > expiresMs || nowMs > endMs) {
      addIssue(issues, 'CDBV1070_AUTHORIZATION_EXPIRED', 'timing');
    }
    if (nowMs < startMs) {
      addIssue(issues, 'CDBV1070_AUTHORIZATION_TIMING_INVALID', 'timing');
    }
  }

  const owner = object(root.owner);
  const ownerId = owner?.ownerId;
  if (
    !nonEmpty(ownerId)
    || !nonEmpty(owner?.displayName)
    || owner?.approved !== true
    || owner?.approvalSource !== 'user_explicit_all_tenant_legacy_primary_shadow_authorization'
    || owner?.ownerModel !== 'single_operator_risk_accepted'
    || owner?.executionOwnerId !== ownerId
    || owner?.rollbackOwnerId !== ownerId
    || owner?.observationOwnerId !== ownerId
    || !nonEmpty(owner?.riskAcceptanceEvidenceId)
    || !validSha256(owner?.riskAcceptanceEvidenceSha256)
    || owner?.noTechnicalBackupAccepted !== true
    || owner?.noMonitoringBackupAccepted !== true
    || owner?.automaticAbortOnOperatorUnavailable !== true
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_OWNER_INVALID', 'authorization');
  }

  const tenantEvidence = object(root.activeTenantEvidence);
  const tenantIds = stringArray(tenantEvidence?.tenantIds);
  const capturedAtMs = validDate(tenantEvidence?.capturedAtUtc)
    ? Date.parse(tenantEvidence.capturedAtUtc)
    : Number.NaN;
  if (
    !nonEmpty(tenantEvidence?.evidenceId)
    || !validSha256(tenantEvidence?.evidenceSha256)
    || tenantEvidence?.allActiveTenants !== true
    || !exactArray(tenantIds, CDB_V1_070A_ACTIVE_TENANT_IDS)
    || !Number.isFinite(capturedAtMs)
    || capturedAtMs > nowMs
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_SCOPE_INVALID', 'scope');
  }

  const deployment = object(root.deployment);
  if (
    deployment?.authorized !== true
    || !nonEmpty(deployment?.workerVersionId)
    || !nonEmpty(deployment?.previousWorkerVersionId)
    || deployment?.workerVersionId === deployment?.previousWorkerVersionId
    || !validSha256(deployment?.buildManifestSha256)
    || !validSha256(deployment?.routeFingerprintSha256)
    || deployment?.legacyDefaultVerified !== true
    || deployment?.previousWorkerRetained !== true
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_DEPLOYMENT_INVALID', 'authorization');
  }

  const snapshot = object(root.productionSnapshot);
  const backup = object(root.backupExport);
  const snapshotCapturedMs = validDate(snapshot?.capturedAtUtc)
    ? Date.parse(snapshot.capturedAtUtc)
    : Number.NaN;
  const backupCapturedMs = validDate(backup?.capturedAtUtc)
    ? Date.parse(backup.capturedAtUtc)
    : Number.NaN;
  if (
    !nonEmpty(snapshot?.bookmarkId)
    || !validSha256(snapshot?.sha256)
    || !Number.isFinite(snapshotCapturedMs)
    || snapshotCapturedMs > nowMs
    || !nonEmpty(backup?.evidenceId)
    || !validSha256(backup?.sha256)
    || !Number.isFinite(backupCapturedMs)
    || backupCapturedMs > nowMs
    || backup?.restoreAuthorityConfirmed !== true
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_BINDING_INVALID', 'binding');
  }

  const migrationEntries = Array.isArray(migrationObject?.entries)
    ? migrationObject.entries.map(object)
    : [];
  const expectedTableRebuildEntries = packageDocument.migrations.filter(
    (entry) => entry.migrationClass === 'data_preserving_table_rebuild',
  );
  const tableRebuildEntries = Array.isArray(migrationObject?.tableRebuildEntries)
    ? migrationObject.tableRebuildEntries.map(object)
    : [];
  if (
    migrationObject?.authorized !== true
    || migrationObject?.serial !== true
    || migrationObject?.destructiveAllowed !== false
    || migrationObject?.dataPreservingTableRebuildsAuthorized !== true
    || migrationObject?.zeroRowLossRequired !== true
    || migrationEntries.length !== packageDocument.migrations.length
    || tableRebuildEntries.length !== expectedTableRebuildEntries.length
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_MIGRATION_INVALID', 'authorization');
  } else {
    for (let index = 0; index < packageDocument.migrations.length; index += 1) {
      const actual = migrationEntries[index];
      const expected = packageDocument.migrations[index];
      if (actual?.name !== expected.name || actual?.sha256 !== expected.sha256) {
        addIssue(issues, 'CDBV1070_AUTHORIZATION_MIGRATION_INVALID', 'authorization');
        break;
      }
    }
    for (let index = 0; index < expectedTableRebuildEntries.length; index += 1) {
      const actual = tableRebuildEntries[index];
      const expected = expectedTableRebuildEntries[index];
      if (
        actual?.name !== expected.name
        || actual?.sha256 !== expected.sha256
        || !nonEmpty(actual?.rowParityEvidenceId)
        || !validSha256(actual?.rowParityEvidenceSha256)
        || !Number.isInteger(actual?.maxExclusiveLockMs)
        || Number(actual?.maxExclusiveLockMs) <= 0
      ) {
        addIssue(issues, 'CDBV1070_AUTHORIZATION_MIGRATION_INVALID', 'authorization');
        break;
      }
    }
  }

  const backfillEntries = Array.isArray(backfillObject?.entries)
    ? backfillObject.entries.map(object)
    : [];
  const backfillTenantIds = stringArray(backfillObject?.tenantIds);
  if (
    backfillObject?.authorized !== true
    || backfillObject?.secondPassRequired !== true
    || !exactArray(backfillTenantIds, CDB_V1_070A_ACTIVE_TENANT_IDS)
    || backfillEntries.length !== packageDocument.backfills.length
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_BACKFILL_INVALID', 'authorization');
  } else {
    for (let index = 0; index < packageDocument.backfills.length; index += 1) {
      const actual = backfillEntries[index];
      const expected = packageDocument.backfills[index];
      if (
        actual?.path !== expected.path
        || actual?.sha256 !== expected.sha256
        || actual?.partitionLimit !== 100
      ) {
        addIssue(issues, 'CDBV1070_AUTHORIZATION_BACKFILL_INVALID', 'authorization');
        break;
      }
    }
  }

  const providers = object(root.providers);
  if (
    providers?.authorized !== true
    || !exactArray(stringArray(providers?.tenantIds), CDB_V1_070A_ACTIVE_TENANT_IDS)
    || !exactArray(stringArray(providers?.keys), CDB_V1_070A_PROVIDER_KEYS)
    || providers?.mode !== 'shadow'
    || providers?.responseAuthority !== 'legacy'
    || providers?.expectedFlagRowCount
      !== CDB_V1_070A_ACTIVE_TENANT_IDS.length * CDB_V1_070A_PROVIDER_KEYS.length
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_PROVIDER_INVALID', 'authorization');
  }

  if (
    !exactArray(tenantIds, backfillTenantIds)
    || !exactArray(tenantIds, stringArray(providers?.tenantIds))
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_SCOPE_INVALID', 'scope');
  }

  const observation = object(root.observation);
  if (
    typeof observation?.durationMinutes !== 'number'
    || !Number.isInteger(observation.durationMinutes)
    || observation.durationMinutes < packageDocument.acceptance.minimumObservationMinutes
    || typeof observation?.maxP95LatencyMs !== 'number'
    || !Number.isFinite(observation.maxP95LatencyMs)
    || observation.maxP95LatencyMs <= 0
    || typeof observation?.maxErrorRate !== 'number'
    || !Number.isFinite(observation.maxErrorRate)
    || observation.maxErrorRate < 0
    || observation.maxErrorRate > 1
    || observation?.dailySummaryRequired !== true
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_OBSERVATION_INVALID', 'authorization');
  }

  const acceptance = object(root.acceptance);
  const requiredAcceptance: Record<string, unknown> = {
    integrityCheck: 'ok',
    foreignKeyViolations: 0,
    criticalUnexplainedVarianceCount: 0,
    providerErrorCount: 0,
    mappingAmbiguityCount: 0,
    crossTenantReferenceCount: 0,
    secondPassNewBusinessRows: 0,
    missingProviderFlagRows: 0,
    nonShadowProviderFlagRows: 0,
  };
  if (Object.entries(requiredAcceptance).some(([key, expected]) => acceptance?.[key] !== expected)) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_ACCEPTANCE_INVALID', 'authorization');
  }

  const procedure = object(root.procedure);
  if (Array.from(PROCEDURE_KEYS).some((key) => procedure?.[key] !== true)) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_PROCEDURE_INVALID', 'authorization');
  }

  const rollback = object(root.rollback);
  if (
    rollback?.previousWorkerVersionId !== deployment?.previousWorkerVersionId
    || rollback?.disableAllNineProviders !== true
    || rollback?.restoreLegacyResponseAuthority !== true
    || rollback?.retainCanonicalEvidence !== true
    || rollback?.stopOnFirstFailure !== true
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_ROLLBACK_INVALID', 'authorization');
  }

  const permissions = object(root.permissions);
  const requiredTruePermissions = [
    'productionRead',
    'deployment',
    'trafficChange',
    'productionSchemaMigration',
    'productionBackfill',
    'providerShadowActivation',
  ];
  const requiredFalsePermissions = [
    'canonicalReadPromotion',
    'canonicalWritePromotion',
    'localSyncActivation',
    'legacyRetirement',
    'destructiveAction',
    'remoteDatabaseDeletion',
    'push',
    'cdbToMainIntegration',
  ];
  if (
    requiredTruePermissions.some((key) => permissions?.[key] !== true)
    || requiredFalsePermissions.some((key) => permissions?.[key] !== false)
  ) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_PERMISSION_INVALID', 'authorization');
  }

  const typedAuthorization = value as AllTenantShadowExecutionAuthorization;
  const expectedConfirmation = buildAllTenantShadowConfirmationTokens(typedAuthorization);
  const confirmation = object(root.confirmation);
  if (Object.entries(expectedConfirmation).some(([key, expected]) => confirmation?.[key] !== expected)) {
    addIssue(issues, 'CDBV1070_AUTHORIZATION_CONFIRMATION_INVALID', 'authorization');
  }

  const documentBlockingCodes = new Set<AllTenantShadowExecutionAuthorizationIssueCode>([
    'CDBV1070_AUTHORIZATION_INVALID_JSON',
    'CDBV1070_AUTHORIZATION_DUPLICATE_KEY',
    'CDBV1070_AUTHORIZATION_UNSAFE_KEY',
    'CDBV1070_AUTHORIZATION_TOO_LARGE',
    'CDBV1070_AUTHORIZATION_TOO_DEEP',
    'CDBV1070_AUTHORIZATION_FILE_UNAVAILABLE',
    'CDBV1070_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    'CDBV1070_AUTHORIZATION_FILE_PROTECTION_INVALID',
    'CDBV1070_AUTHORIZATION_UNKNOWN_FIELD',
    'CDBV1070_AUTHORIZATION_SENSITIVE_FIELD',
    'CDBV1070_AUTHORIZATION_SCHEMA_INVALID',
  ]);
  const documentReady = !issues.some((issue) => documentBlockingCodes.has(issue.code));
  const executionReady = issues.length === 0;
  return {
    documentReady,
    executionReady,
    issues,
    authorization: documentReady ? typedAuthorization : null,
  };
}

export function parseAllTenantShadowExecutionAuthorizationJson(
  text: string,
  repositoryRoot: string,
  packageDocument: AllTenantShadowExecutionPackage,
  atUtc: string,
): AllTenantShadowExecutionAuthorizationResult {
  const parsed = parseStrictJsonDocument(text, DOCUMENT_OPTIONS);
  if (!parsed.ready) {
    return {
      documentReady: false,
      executionReady: false,
      issues: parsed.issues.map((issue) => ({
        code: mapDocumentIssue(issue.code),
        gate: issue.gate,
      })),
      authorization: null,
    };
  }
  return evaluateValue(parsed.value, repositoryRoot, packageDocument, atUtc);
}

export function loadAllTenantShadowExecutionAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  packageDocument: AllTenantShadowExecutionPackage,
  atUtc: string,
): AllTenantShadowExecutionAuthorizationResult {
  const loaded = loadProtectedJsonDocument(
    authorizationPath,
    repositoryRoot,
    DOCUMENT_OPTIONS,
  );
  if (!loaded.ready) {
    return {
      documentReady: false,
      executionReady: false,
      issues: loaded.issues.map((issue) => ({
        code: mapDocumentIssue(issue.code),
        gate: issue.gate,
      })),
      authorization: null,
    };
  }
  return evaluateValue(loaded.value, repositoryRoot, packageDocument, atUtc);
}

export function buildAllTenantShadowAuthorizationPlan(
  result: AllTenantShadowExecutionAuthorizationResult,
): AllTenantShadowExecutionAuthorizationPlan {
  if (!result.executionReady || !result.authorization) {
    throw new Error('all-tenant shadow execution authorization is not ready');
  }
  const authorization = result.authorization;
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION',
    authorizationId: authorization.authorizationId,
    productionDatabaseUuid: authorization.target.databaseUuid,
    candidateCommit: authorization.repository.candidateCommit,
    workerVersionId: authorization.deployment.workerVersionId,
    previousWorkerVersionId: authorization.deployment.previousWorkerVersionId,
    tenantCount: authorization.activeTenantEvidence.tenantIds.length,
    migrationCount: authorization.migrations.entries.length,
    backfillCount: authorization.backfills.entries.length,
    providerCount: authorization.providers.keys.length,
    expectedProviderFlagRowCount: authorization.providers.expectedFlagRowCount,
    observationDurationMinutes: authorization.observation.durationMinutes,
    phases: [
      'candidate_preflight',
      'backup_verification',
      'legacy_default_deployment',
      'migration',
      'backfill',
      'reconciliation',
      'shadow_activation',
      'scope_verification',
      'observation',
      'rollback',
    ],
    abortConditions: [
      'candidate or database binding mismatch',
      'active tenant scope mismatch',
      'snapshot or backup evidence mismatch',
      'migration or backfill scope mismatch',
      'non-zero integrity, variance, mapping, provider, or scope issue',
      'Legacy response authority or rollback unavailable',
    ],
    finalResponseAuthority: 'legacy',
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}

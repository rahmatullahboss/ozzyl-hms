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
  CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT,
  CDB_V1_070B_PACKAGE_PATH,
  evaluateAllTenantShadowPreparationPackage,
  type AllTenantShadowPreparationPackage,
} from './all-tenant-shadow-preparation-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import {
  CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE,
  CDB101_PRODUCTION_WORKER_ENTRYPOINT,
  CDB101_PRODUCTION_WORKER_ENVIRONMENT,
  CDB101_PRODUCTION_WORKER_ROUTES,
  CDB101_PRODUCTION_WORKER_SERVICE,
} from './reporting-worker-build-version-evidence';

const HISTORICAL_EXECUTION_PACKAGE_PATH =
  'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';
const MIGRATION_MANIFEST_PATH = 'src/data/schema-migrations.generated.ts';
const DOCUMENT_OPTIONS = { maxBytes: 384 * 1024, maxDepth: 18 } as const;

export interface AllTenantShadowPreparationRepositoryBinding {
  candidateBranch: 'main';
  candidateCommit: string;
  buildSha: string;
  minimumImplementationCommit: typeof CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT;
  preparationPackagePath: typeof CDB_V1_070B_PACKAGE_PATH;
  preparationPackageSha256: string;
  preparationPackageCommit: string;
  historicalExecutionPackagePath: typeof HISTORICAL_EXECUTION_PACKAGE_PATH;
  historicalExecutionPackageSha256: string;
  migrationManifestPath: typeof MIGRATION_MANIFEST_PATH;
  migrationManifestSha256: string;
  migrationCount: 504;
  mainIntegrationEvidenceId: string;
  mainIntegrationEvidenceSha256: string;
}

export interface AllTenantShadowPreparationAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'all_tenant_shadow_preparation_evidence_capture';
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
    approvalSource: 'user_explicit_all_tenant_shadow_preparation_evidence_authorization';
    ownerModel: 'single_operator_risk_accepted';
    executionOwnerId: string;
    rollbackOwnerId: string;
    evidenceCustodianId: string;
    riskAcceptanceEvidenceId: string;
    riskAcceptanceEvidenceSha256: string;
    automaticAbortOnOperatorUnavailable: boolean;
  };
  repository: AllTenantShadowPreparationRepositoryBinding;
  worker: {
    serviceName: string;
    environment: string;
    entrypoint: string;
    compatibilityDate: string;
    routes: string[];
    uploadAtZeroTraffic: boolean;
    expectedCandidateTrafficPercentage: number;
    retainPreviousActiveVersion: boolean;
    expectedPreviousTrafficPercentage: number;
  };
  scope: {
    tenantIds: string[];
    allActiveTenantAggregateRead: boolean;
    migrationLedgerAggregateRead: boolean;
    workerMetadataRead: boolean;
    routeMetadataRead: boolean;
    phiReadAllowed: boolean;
    rowLevelPatientReadAllowed: boolean;
  };
  evidenceOutput: {
    receiptId: string;
    protectedDirectoryEvidenceId: string;
    retentionDays: number;
  };
  procedure: {
    verifyCandidateBuildLocally: boolean;
    uploadCandidateAtZeroTraffic: boolean;
    capturePreviousActiveVersion: boolean;
    captureExactRoutes: boolean;
    captureActiveTenantAggregate: boolean;
    captureMigrationLedgerAggregate: boolean;
    captureTimeTravelBookmark: boolean;
    captureProtectedExport: boolean;
    verifyZeroProductionRowsWritten: boolean;
    verifyZeroMigrationsApplied: boolean;
    verifyZeroBackfillsExecuted: boolean;
    verifyZeroProviderFlagsChanged: boolean;
    verifyTrafficUnchanged: boolean;
    preserveLegacyAuthority: boolean;
    stopOnFirstFailure: boolean;
  };
  permissions: {
    productionRead: boolean;
    workerVersionUpload: boolean;
    workerTrafficAssignment: boolean;
    timeTravelBookmarkCapture: boolean;
    backupExportCapture: boolean;
    productionSchemaMigration: boolean;
    productionBackfill: boolean;
    providerFlagChange: boolean;
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
    readToken: string;
    versionUploadToken: string;
    backupCaptureToken: string;
    abortToken: string;
  };
}

export type AllTenantShadowPreparationAuthorizationIssueCode =
  | 'CDBV1070B_AUTHORIZATION_INVALID_JSON'
  | 'CDBV1070B_AUTHORIZATION_DUPLICATE_KEY'
  | 'CDBV1070B_AUTHORIZATION_UNSAFE_KEY'
  | 'CDBV1070B_AUTHORIZATION_TOO_LARGE'
  | 'CDBV1070B_AUTHORIZATION_TOO_DEEP'
  | 'CDBV1070B_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDBV1070B_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDBV1070B_AUTHORIZATION_FILE_PROTECTION_INVALID'
  | 'CDBV1070B_AUTHORIZATION_UNKNOWN_FIELD'
  | 'CDBV1070B_AUTHORIZATION_SENSITIVE_FIELD'
  | 'CDBV1070B_AUTHORIZATION_SCHEMA_INVALID'
  | 'CDBV1070B_AUTHORIZATION_TARGET_INVALID'
  | 'CDBV1070B_AUTHORIZATION_BINDING_INVALID'
  | 'CDBV1070B_AUTHORIZATION_TIMING_INVALID'
  | 'CDBV1070B_AUTHORIZATION_EXPIRED'
  | 'CDBV1070B_AUTHORIZATION_OWNER_INVALID'
  | 'CDBV1070B_AUTHORIZATION_WORKER_INVALID'
  | 'CDBV1070B_AUTHORIZATION_SCOPE_INVALID'
  | 'CDBV1070B_AUTHORIZATION_EVIDENCE_OUTPUT_INVALID'
  | 'CDBV1070B_AUTHORIZATION_PROCEDURE_INVALID'
  | 'CDBV1070B_AUTHORIZATION_PERMISSION_INVALID'
  | 'CDBV1070B_AUTHORIZATION_CONFIRMATION_INVALID';

export interface AllTenantShadowPreparationAuthorizationIssue {
  code: AllTenantShadowPreparationAuthorizationIssueCode;
  gate: 'document' | 'file' | 'target' | 'binding' | 'timing' | 'authorization' | 'worker' | 'scope';
}

export interface AllTenantShadowPreparationAuthorizationResult {
  documentReady: boolean;
  authorizationReady: boolean;
  issues: AllTenantShadowPreparationAuthorizationIssue[];
  authorization: AllTenantShadowPreparationAuthorization | null;
}

export interface AllTenantShadowPreparationAuthorizationPlan {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE';
  authorizationId: string;
  productionDatabaseUuid: string;
  candidateCommit: string;
  tenantCount: number;
  routeCount: number;
  candidateTrafficPercentage: 0;
  previousTrafficPercentage: 100;
  phases: readonly string[];
  finalResponseAuthority: 'legacy';
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
  workerVersionUploadPerformed: false;
  trafficChanged: false;
}

const SENSITIVE_KEYS = new Set([
  'header', 'headers', 'cookie', 'cookies', 'token', 'password', 'secret', 'credential',
  'credentials', 'databaseurl', 'rawoutput', 'sql', 'command', 'environmentvariable',
  'apikey', 'privatekey', 'accountid', 'email',
]);

const ROOT_KEYS = new Set([
  'schemaVersion', 'authorizationId', 'operation', 'target', 'timing', 'owner',
  'repository', 'worker', 'scope', 'evidenceOutput', 'procedure', 'permissions', 'confirmation',
]);
const TARGET_KEYS = new Set(['platform', 'databaseName', 'databaseUuid', 'environment', 'remote']);
const TIMING_KEYS = new Set(['issuedAtUtc', 'windowStartUtc', 'windowEndUtc', 'expiresAtUtc']);
const OWNER_KEYS = new Set([
  'ownerId', 'displayName', 'approved', 'approvalSource', 'ownerModel', 'executionOwnerId',
  'rollbackOwnerId', 'evidenceCustodianId', 'riskAcceptanceEvidenceId',
  'riskAcceptanceEvidenceSha256', 'automaticAbortOnOperatorUnavailable',
]);
const REPOSITORY_KEYS = new Set([
  'candidateBranch', 'candidateCommit', 'buildSha', 'minimumImplementationCommit',
  'preparationPackagePath', 'preparationPackageSha256', 'preparationPackageCommit',
  'historicalExecutionPackagePath', 'historicalExecutionPackageSha256',
  'migrationManifestPath', 'migrationManifestSha256', 'migrationCount',
  'mainIntegrationEvidenceId', 'mainIntegrationEvidenceSha256',
]);
const WORKER_KEYS = new Set([
  'serviceName', 'environment', 'entrypoint', 'compatibilityDate', 'routes',
  'uploadAtZeroTraffic', 'expectedCandidateTrafficPercentage', 'retainPreviousActiveVersion',
  'expectedPreviousTrafficPercentage',
]);
const SCOPE_KEYS = new Set([
  'tenantIds', 'allActiveTenantAggregateRead', 'migrationLedgerAggregateRead',
  'workerMetadataRead', 'routeMetadataRead', 'phiReadAllowed', 'rowLevelPatientReadAllowed',
]);
const EVIDENCE_OUTPUT_KEYS = new Set(['receiptId', 'protectedDirectoryEvidenceId', 'retentionDays']);
const PROCEDURE_KEYS = new Set([
  'verifyCandidateBuildLocally', 'uploadCandidateAtZeroTraffic', 'capturePreviousActiveVersion',
  'captureExactRoutes', 'captureActiveTenantAggregate', 'captureMigrationLedgerAggregate',
  'captureTimeTravelBookmark', 'captureProtectedExport', 'verifyZeroProductionRowsWritten',
  'verifyZeroMigrationsApplied', 'verifyZeroBackfillsExecuted', 'verifyZeroProviderFlagsChanged',
  'verifyTrafficUnchanged', 'preserveLegacyAuthority', 'stopOnFirstFailure',
]);
const PERMISSION_KEYS = new Set([
  'productionRead', 'workerVersionUpload', 'workerTrafficAssignment', 'timeTravelBookmarkCapture',
  'backupExportCapture', 'productionSchemaMigration', 'productionBackfill', 'providerFlagChange',
  'canonicalReadPromotion', 'canonicalWritePromotion', 'localSyncActivation', 'legacyRetirement',
  'destructiveAction', 'remoteDatabaseDeletion', 'push', 'cdbToMainIntegration',
]);
const CONFIRMATION_KEYS = new Set(['readToken', 'versionUploadToken', 'backupCaptureToken', 'abortToken']);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function packageBytes(document: AllTenantShadowPreparationPackage): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_:\-.]{2,159}$/i.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameArray(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function addIssue(
  issues: AllTenantShadowPreparationAuthorizationIssue[],
  code: AllTenantShadowPreparationAuthorizationIssueCode,
  gate: AllTenantShadowPreparationAuthorizationIssue['gate'],
): void {
  if (!issues.some((entry) => entry.code === code && entry.gate === gate)) issues.push({ code, gate });
}

function unknownFields(value: Record<string, unknown> | null, allowed: ReadonlySet<string>): boolean {
  return !value || Object.keys(value).some((key) => !allowed.has(key));
}

function gitCommitExists(root: string, commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
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

function mapProtectedIssue(
  code: ProtectedJsonDocumentIssueCode,
): AllTenantShadowPreparationAuthorizationIssue {
  const mapping: Record<ProtectedJsonDocumentIssueCode, AllTenantShadowPreparationAuthorizationIssueCode> = {
    INVALID_JSON: 'CDBV1070B_AUTHORIZATION_INVALID_JSON',
    DUPLICATE_KEY: 'CDBV1070B_AUTHORIZATION_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDBV1070B_AUTHORIZATION_UNSAFE_KEY',
    TOO_LARGE: 'CDBV1070B_AUTHORIZATION_TOO_LARGE',
    TOO_DEEP: 'CDBV1070B_AUTHORIZATION_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDBV1070B_AUTHORIZATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDBV1070B_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDBV1070B_AUTHORIZATION_FILE_PROTECTION_INVALID',
  };
  return {
    code: mapping[code],
    gate: code.startsWith('FILE_') ? 'file' : 'document',
  };
}

export function buildAllTenantShadowPreparationRepositoryBinding(
  repositoryRootInput: string,
  packageDocument: AllTenantShadowPreparationPackage,
  candidateCommit: string,
  buildSha: string,
  mainIntegrationEvidenceId: string,
  mainIntegrationEvidenceSha256: string,
): AllTenantShadowPreparationRepositoryBinding {
  const root = resolve(repositoryRootInput);
  const evaluation = evaluateAllTenantShadowPreparationPackage(root, packageDocument);
  if (!evaluation.packageReady) throw new Error(`preparation package is invalid: ${evaluation.issues.join(', ')}`);
  if (!isGitSha(candidateCommit) || !gitCommitExists(root, candidateCommit)) {
    throw new Error('candidateCommit must be an existing 40-character Git commit');
  }
  if (!isAncestor(root, CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT, candidateCommit)) {
    throw new Error('candidateCommit does not contain the minimum staged preparation implementation');
  }
  if (!isGitSha(buildSha)) throw new Error('buildSha must be one 40-character Git SHA');
  if (!safeIdentifier(mainIntegrationEvidenceId) || !isSha256(mainIntegrationEvidenceSha256)) {
    throw new Error('main integration evidence is invalid');
  }
  return {
    candidateBranch: 'main',
    candidateCommit,
    buildSha,
    minimumImplementationCommit: CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT,
    preparationPackagePath: CDB_V1_070B_PACKAGE_PATH,
    preparationPackageSha256: sha256(packageBytes(packageDocument)),
    preparationPackageCommit: packageDocument.preparation.repositoryCommit,
    historicalExecutionPackagePath: HISTORICAL_EXECUTION_PACKAGE_PATH,
    historicalExecutionPackageSha256: packageDocument.bindings.historicalExecutionPackageSha256,
    migrationManifestPath: MIGRATION_MANIFEST_PATH,
    migrationManifestSha256: packageDocument.bindings.migrationManifestSha256,
    migrationCount: 504,
    mainIntegrationEvidenceId,
    mainIntegrationEvidenceSha256,
  };
}

export function buildAllTenantShadowPreparationConfirmationTokens(
  authorization: AllTenantShadowPreparationAuthorization,
): AllTenantShadowPreparationAuthorization['confirmation'] {
  const tenantBinding = authorization.scope.tenantIds.join(',');
  const routeBinding = authorization.worker.routes.join(',');
  return {
    readToken: sha256([
      'cdbv1070b', 'read', authorization.target.databaseUuid,
      authorization.repository.candidateCommit, tenantBinding,
      String(authorization.scope.allActiveTenantAggregateRead),
      String(authorization.scope.migrationLedgerAggregateRead),
    ].join('\0')),
    versionUploadToken: sha256([
      'cdbv1070b', 'version-upload', authorization.worker.serviceName,
      authorization.repository.candidateCommit, authorization.repository.buildSha,
      routeBinding, String(authorization.worker.expectedCandidateTrafficPercentage),
    ].join('\0')),
    backupCaptureToken: sha256([
      'cdbv1070b', 'backup-capture', authorization.target.databaseUuid,
      authorization.evidenceOutput.receiptId,
      authorization.evidenceOutput.protectedDirectoryEvidenceId,
      String(authorization.permissions.timeTravelBookmarkCapture),
      String(authorization.permissions.backupExportCapture),
    ].join('\0')),
    abortToken: sha256([
      'cdbv1070b', 'abort', authorization.target.databaseUuid,
      authorization.repository.candidateCommit, authorization.owner.rollbackOwnerId,
      routeBinding, 'legacy',
    ].join('\0')),
  };
}

function evaluateValue(
  value: unknown,
  repositoryRootInput: string,
  packageDocument: AllTenantShadowPreparationPackage,
  atUtc: string,
): AllTenantShadowPreparationAuthorizationResult {
  const root = resolve(repositoryRootInput);
  const issues: AllTenantShadowPreparationAuthorizationIssue[] = [];
  const document = object(value);
  if (!document) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_SCHEMA_INVALID', 'document');
    return { documentReady: false, authorizationReady: false, issues, authorization: null };
  }

  if (containsNormalizedKey(document, SENSITIVE_KEYS)) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_SENSITIVE_FIELD', 'document');
  }

  const target = object(document.target);
  const timing = object(document.timing);
  const owner = object(document.owner);
  const repository = object(document.repository);
  const worker = object(document.worker);
  const scope = object(document.scope);
  const evidenceOutput = object(document.evidenceOutput);
  const procedure = object(document.procedure);
  const permissions = object(document.permissions);
  const confirmation = object(document.confirmation);

  const unknown = unknownFields(document, ROOT_KEYS)
    || unknownFields(target, TARGET_KEYS)
    || unknownFields(timing, TIMING_KEYS)
    || unknownFields(owner, OWNER_KEYS)
    || unknownFields(repository, REPOSITORY_KEYS)
    || unknownFields(worker, WORKER_KEYS)
    || unknownFields(scope, SCOPE_KEYS)
    || unknownFields(evidenceOutput, EVIDENCE_OUTPUT_KEYS)
    || unknownFields(procedure, PROCEDURE_KEYS)
    || unknownFields(permissions, PERMISSION_KEYS)
    || unknownFields(confirmation, CONFIRMATION_KEYS);
  if (unknown) addIssue(issues, 'CDBV1070B_AUTHORIZATION_UNKNOWN_FIELD', 'document');

  if (document.schemaVersion !== 1
    || document.operation !== 'all_tenant_shadow_preparation_evidence_capture'
    || !safeIdentifier(document.authorizationId)) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_SCHEMA_INVALID', 'document');
  }

  if (!target
    || target.platform !== 'cloudflare_d1'
    || target.databaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || target.databaseUuid !== CDB101_PRODUCTION_DATABASE_ID
    || target.environment !== 'production'
    || target.remote !== true) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_TARGET_INVALID', 'target');
  }

  const issuedAt = parseUtc(timing?.issuedAtUtc);
  const windowStart = parseUtc(timing?.windowStartUtc);
  const windowEnd = parseUtc(timing?.windowEndUtc);
  const expiresAt = parseUtc(timing?.expiresAtUtc);
  const evaluatedAt = parseUtc(atUtc);
  if (issuedAt === null || windowStart === null || windowEnd === null || expiresAt === null
    || evaluatedAt === null || issuedAt > windowStart || windowStart >= windowEnd || windowEnd > expiresAt) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_TIMING_INVALID', 'timing');
  } else if (evaluatedAt < issuedAt || evaluatedAt > expiresAt || evaluatedAt < windowStart || evaluatedAt > windowEnd) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_EXPIRED', 'timing');
  }

  if (!owner
    || !safeIdentifier(owner.ownerId)
    || !nonEmpty(owner.displayName)
    || owner.approved !== true
    || owner.approvalSource !== 'user_explicit_all_tenant_shadow_preparation_evidence_authorization'
    || owner.ownerModel !== 'single_operator_risk_accepted'
    || !safeIdentifier(owner.executionOwnerId)
    || !safeIdentifier(owner.rollbackOwnerId)
    || !safeIdentifier(owner.evidenceCustodianId)
    || !safeIdentifier(owner.riskAcceptanceEvidenceId)
    || !isSha256(owner.riskAcceptanceEvidenceSha256)
    || owner.automaticAbortOnOperatorUnavailable !== true) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_OWNER_INVALID', 'authorization');
  }

  let expectedRepository: AllTenantShadowPreparationRepositoryBinding | null = null;
  if (repository
    && isGitSha(repository.candidateCommit)
    && isGitSha(repository.buildSha)
    && safeIdentifier(repository.mainIntegrationEvidenceId)
    && isSha256(repository.mainIntegrationEvidenceSha256)) {
    try {
      expectedRepository = buildAllTenantShadowPreparationRepositoryBinding(
        root,
        packageDocument,
        repository.candidateCommit,
        repository.buildSha,
        repository.mainIntegrationEvidenceId,
        repository.mainIntegrationEvidenceSha256,
      );
    } catch {
      expectedRepository = null;
    }
  }
  if (!expectedRepository || JSON.stringify(repository) !== JSON.stringify(expectedRepository)) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_BINDING_INVALID', 'binding');
  }

  if (!worker
    || worker.serviceName !== CDB101_PRODUCTION_WORKER_SERVICE
    || worker.environment !== CDB101_PRODUCTION_WORKER_ENVIRONMENT
    || worker.entrypoint !== CDB101_PRODUCTION_WORKER_ENTRYPOINT
    || worker.compatibilityDate !== CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE
    || !sameArray(worker.routes, CDB101_PRODUCTION_WORKER_ROUTES)
    || worker.uploadAtZeroTraffic !== true
    || worker.expectedCandidateTrafficPercentage !== 0
    || worker.retainPreviousActiveVersion !== true
    || worker.expectedPreviousTrafficPercentage !== 100) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_WORKER_INVALID', 'worker');
  }

  if (!scope
    || !sameArray(scope.tenantIds, ['1', '100', '101', '102'])
    || scope.allActiveTenantAggregateRead !== true
    || scope.migrationLedgerAggregateRead !== true
    || scope.workerMetadataRead !== true
    || scope.routeMetadataRead !== true
    || scope.phiReadAllowed !== false
    || scope.rowLevelPatientReadAllowed !== false) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_SCOPE_INVALID', 'scope');
  }

  if (!evidenceOutput
    || !safeIdentifier(evidenceOutput.receiptId)
    || !safeIdentifier(evidenceOutput.protectedDirectoryEvidenceId)
    || typeof evidenceOutput.retentionDays !== 'number'
    || !Number.isSafeInteger(evidenceOutput.retentionDays)
    || evidenceOutput.retentionDays < 7
    || evidenceOutput.retentionDays > 365) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_EVIDENCE_OUTPUT_INVALID', 'authorization');
  }

  if (!procedure || Object.values(procedure).some((entry) => entry !== true)) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_PROCEDURE_INVALID', 'authorization');
  }

  const expectedPermissions: Record<string, boolean> = {
    productionRead: true,
    workerVersionUpload: true,
    workerTrafficAssignment: false,
    timeTravelBookmarkCapture: true,
    backupExportCapture: true,
    productionSchemaMigration: false,
    productionBackfill: false,
    providerFlagChange: false,
    canonicalReadPromotion: false,
    canonicalWritePromotion: false,
    localSyncActivation: false,
    legacyRetirement: false,
    destructiveAction: false,
    remoteDatabaseDeletion: false,
    push: false,
    cdbToMainIntegration: false,
  };
  if (!permissions || Object.entries(expectedPermissions).some(([key, expected]) => permissions[key] !== expected)) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_PERMISSION_INVALID', 'authorization');
  }

  const authorization = document as unknown as AllTenantShadowPreparationAuthorization;
  let expectedConfirmation: AllTenantShadowPreparationAuthorization['confirmation'] | null = null;
  try {
    expectedConfirmation = buildAllTenantShadowPreparationConfirmationTokens(authorization);
  } catch {
    expectedConfirmation = null;
  }
  if (!confirmation || !expectedConfirmation
    || Object.entries(expectedConfirmation).some(([key, expected]) => confirmation[key] !== expected)) {
    addIssue(issues, 'CDBV1070B_AUTHORIZATION_CONFIRMATION_INVALID', 'authorization');
  }

  const documentBlockingCodes = new Set<AllTenantShadowPreparationAuthorizationIssueCode>([
    'CDBV1070B_AUTHORIZATION_INVALID_JSON',
    'CDBV1070B_AUTHORIZATION_DUPLICATE_KEY',
    'CDBV1070B_AUTHORIZATION_UNSAFE_KEY',
    'CDBV1070B_AUTHORIZATION_TOO_LARGE',
    'CDBV1070B_AUTHORIZATION_TOO_DEEP',
    'CDBV1070B_AUTHORIZATION_UNKNOWN_FIELD',
    'CDBV1070B_AUTHORIZATION_SENSITIVE_FIELD',
    'CDBV1070B_AUTHORIZATION_SCHEMA_INVALID',
  ]);
  const documentReady = !issues.some((entry) => documentBlockingCodes.has(entry.code));
  const authorizationReady = issues.length === 0;
  return {
    documentReady,
    authorizationReady,
    issues,
    authorization: authorizationReady ? authorization : null,
  };
}

export function parseAllTenantShadowPreparationAuthorizationJson(
  text: string,
  repositoryRoot: string,
  packageDocument: AllTenantShadowPreparationPackage,
  atUtc = new Date().toISOString(),
): AllTenantShadowPreparationAuthorizationResult {
  const parsed = parseStrictJsonDocument(text, DOCUMENT_OPTIONS);
  if (!parsed.ready) {
    return {
      documentReady: false,
      authorizationReady: false,
      issues: parsed.issues.map((entry) => mapProtectedIssue(entry.code)),
      authorization: null,
    };
  }
  return evaluateValue(parsed.value, repositoryRoot, packageDocument, atUtc);
}

export function loadAllTenantShadowPreparationAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  packageDocument: AllTenantShadowPreparationPackage,
  atUtc = new Date().toISOString(),
): AllTenantShadowPreparationAuthorizationResult {
  const loaded = loadProtectedJsonDocument(authorizationPath, repositoryRoot, DOCUMENT_OPTIONS);
  if (!loaded.ready) {
    return {
      documentReady: false,
      authorizationReady: false,
      issues: loaded.issues.map((entry) => mapProtectedIssue(entry.code)),
      authorization: null,
    };
  }
  return evaluateValue(loaded.value, repositoryRoot, packageDocument, atUtc);
}

export function buildAllTenantShadowPreparationAuthorizationPlan(
  result: AllTenantShadowPreparationAuthorizationResult,
): AllTenantShadowPreparationAuthorizationPlan | null {
  const authorization = result.authorization;
  if (!result.authorizationReady || !authorization) return null;
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE',
    authorizationId: authorization.authorizationId,
    productionDatabaseUuid: authorization.target.databaseUuid,
    candidateCommit: authorization.repository.candidateCommit,
    tenantCount: authorization.scope.tenantIds.length,
    routeCount: authorization.worker.routes.length,
    candidateTrafficPercentage: 0,
    previousTrafficPercentage: 100,
    phases: [
      'candidate_build_verification',
      'zero_traffic_version_upload',
      'aggregate_production_read',
      'time_travel_bookmark_capture',
      'protected_export_capture',
      'preparation_evidence_verification',
    ],
    finalResponseAuthority: 'legacy',
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
    workerVersionUploadPerformed: false,
    trafficChanged: false,
  };
}

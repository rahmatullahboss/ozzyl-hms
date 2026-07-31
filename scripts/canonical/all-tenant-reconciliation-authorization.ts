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
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT,
  CDB_V1_070C_PACKAGE_PATH,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
  evaluateAllTenantReconciliationPackage,
  type AllTenantReconciliationArchivalForeignKeyGroup,
  type AllTenantReconciliationMigration,
  type AllTenantReconciliationPackage,
} from './all-tenant-reconciliation-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

const DOCUMENT_OPTIONS = { maxBytes: 512 * 1024, maxDepth: 24 } as const;

export interface AllTenantReconciliationRepositoryBinding {
  candidateBranch: 'main';
  candidateCommit: string;
  buildSha: string;
  minimumImplementationCommit: typeof CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT;
  packagePath: typeof CDB_V1_070C_PACKAGE_PATH;
  packageSha256: string;
  packagePreparationCommit: string;
  gateAPreparationReceiptId: string;
  gateAPreparationReceiptSha256: string;
  gateBPreparationReceiptId: string;
  gateBPreparationReceiptSha256: string;
}

export interface AllTenantReconciliationAuthorizationEntry extends AllTenantReconciliationMigration {
  schemaEvidenceId: string;
  schemaEvidenceSha256: string;
  ledgerEvidenceId: string;
  ledgerEvidenceSha256: string;
  ledgerEntryInitiallyAbsent: true;
  postSchemaExact: true;
  maximumLedgerRowsWritten: 1;
}

export interface AllTenantReconciliationAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'all_tenant_schema_ledger_archival_fk_reconciliation';
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
    approvalSource: 'user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization';
    ownerModel: 'single_operator_risk_accepted';
    executionOwnerId: string;
    rollbackOwnerId: string;
    evidenceCustodianId: string;
    riskAcceptanceEvidenceId: string;
    riskAcceptanceEvidenceSha256: string;
    automaticAbortOnOperatorUnavailable: boolean;
  };
  repository: AllTenantReconciliationRepositoryBinding;
  scope: {
    tenantIds: string[];
    phiReadAllowed: false;
    rowLevelPatientReadAllowed: false;
  };
  reconciliation: {
    expectedPendingMigrationCountBefore: 29;
    expectedPendingMigrationCountAfter: 25;
    expectedLedgerRowsWritten: 4;
    atomic: true;
    entries: AllTenantReconciliationAuthorizationEntry[];
  };
  foreignKeyDisposition: {
    evidenceId: string;
    evidenceSha256: string;
    rawArchivalViolationCount: 41;
    formallyWaivedViolationCount: 41;
    effectiveUnwaivedViolationCount: 0;
    activeViolationCount: 0;
    unknownViolationCount: 0;
    groups: AllTenantReconciliationArchivalForeignKeyGroup[];
    archivalTableConfirmed: true;
    activeWriterDisabledConfirmed: true;
    excludedFromCanonicalImportConfirmed: true;
    excludedFromReportingConfirmed: true;
    removalPhase: 'legacy_retirement_p11';
    archivalTableMutationAllowed: false;
    archivalTableDeletionAllowed: false;
  };
  evidenceOutput: {
    receiptId: string;
    protectedDirectoryEvidenceId: string;
    retentionDays: number;
  };
  procedure: {
    verifyCandidateAndPackage: true;
    captureFreshAggregateSchemaEvidence: true;
    captureFreshMigrationLedgerEvidence: true;
    stopIfAnyLedgerEntryExists: true;
    verifyExactPostSchemaBeforeWrite: true;
    reconcileExactlyFourLedgerRowsAtomically: true;
    executeNoMigrationSqlOrDdl: true;
    writeNoBusinessRows: true;
    refreshProtectedArchivalFkDispositionEvidence: true;
    verifyZeroActiveAndUnknownFkViolations: true;
    preserveRawArchivalRows: true;
    preserveLegacyAuthority: true;
    verifyTrafficUnchanged: true;
    stopOnFirstFailure: true;
  };
  permissions: {
    productionRead: true;
    migrationLedgerReconciliation: true;
    archivalFkDispositionEvidenceRefresh: true;
    migrationSqlExecution: false;
    productionDdl: false;
    businessTableWrite: false;
    productionBackfill: false;
    providerFlagChange: false;
    workerVersionUpload: false;
    deployment: false;
    trafficChange: false;
    routeChange: false;
    canonicalReadPromotion: false;
    canonicalWritePromotion: false;
    localSyncActivation: false;
    legacyRetirement: false;
    archivalTableMutation: false;
    archivalTableDeletion: false;
    destructiveAction: false;
    remoteDatabaseDeletion: false;
    push: false;
    cdbToMainIntegration: false;
  };
  confirmation: {
    readToken: string;
    ledgerReconciliationToken: string;
    archivalDispositionToken: string;
    abortToken: string;
  };
}

export type AllTenantReconciliationAuthorizationIssueCode =
  | 'CDBV1070C_AUTHORIZATION_INVALID_JSON'
  | 'CDBV1070C_AUTHORIZATION_DUPLICATE_KEY'
  | 'CDBV1070C_AUTHORIZATION_UNSAFE_KEY'
  | 'CDBV1070C_AUTHORIZATION_TOO_LARGE'
  | 'CDBV1070C_AUTHORIZATION_TOO_DEEP'
  | 'CDBV1070C_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDBV1070C_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDBV1070C_AUTHORIZATION_FILE_PROTECTION_INVALID'
  | 'CDBV1070C_AUTHORIZATION_UNKNOWN_FIELD'
  | 'CDBV1070C_AUTHORIZATION_SENSITIVE_FIELD'
  | 'CDBV1070C_AUTHORIZATION_SCHEMA_INVALID'
  | 'CDBV1070C_AUTHORIZATION_TARGET_INVALID'
  | 'CDBV1070C_AUTHORIZATION_BINDING_INVALID'
  | 'CDBV1070C_AUTHORIZATION_TIMING_INVALID'
  | 'CDBV1070C_AUTHORIZATION_EXPIRED'
  | 'CDBV1070C_AUTHORIZATION_OWNER_INVALID'
  | 'CDBV1070C_AUTHORIZATION_SCOPE_INVALID'
  | 'CDBV1070C_AUTHORIZATION_RECONCILIATION_INVALID'
  | 'CDBV1070C_AUTHORIZATION_FK_DISPOSITION_INVALID'
  | 'CDBV1070C_AUTHORIZATION_EVIDENCE_OUTPUT_INVALID'
  | 'CDBV1070C_AUTHORIZATION_PROCEDURE_INVALID'
  | 'CDBV1070C_AUTHORIZATION_PERMISSION_INVALID'
  | 'CDBV1070C_AUTHORIZATION_CONFIRMATION_INVALID';

export interface AllTenantReconciliationAuthorizationIssue {
  code: AllTenantReconciliationAuthorizationIssueCode;
  gate: 'document' | 'file' | 'target' | 'binding' | 'timing' | 'authorization' | 'scope';
}

export interface AllTenantReconciliationAuthorizationResult {
  documentReady: boolean;
  authorizationReady: boolean;
  issues: AllTenantReconciliationAuthorizationIssue[];
  authorization: AllTenantReconciliationAuthorization | null;
}

export interface AllTenantReconciliationAuthorizationPlan {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION';
  authorizationId: string;
  productionDatabaseUuid: string;
  candidateCommit: string;
  tenantCount: 4;
  migrationLedgerEntryCount: 4;
  rawArchivalForeignKeyViolations: 41;
  formallyWaivedArchivalForeignKeyViolations: 41;
  effectiveUnwaivedForeignKeyViolations: 0;
  phases: readonly string[];
  finalResponseAuthority: 'legacy';
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
  migrationLedgerRowsWritten: 0;
  trafficChanged: false;
}

const SENSITIVE_KEYS = new Set([
  'header', 'headers', 'cookie', 'cookies', 'token', 'password', 'secret', 'credential',
  'credentials', 'databaseurl', 'rawoutput', 'sql', 'command', 'environmentvariable',
  'apikey', 'privatekey', 'accountid', 'email', 'rowid', 'patientid', 'patientname',
]);

const ROOT_KEYS = new Set([
  'schemaVersion', 'authorizationId', 'operation', 'target', 'timing', 'owner', 'repository',
  'scope', 'reconciliation', 'foreignKeyDisposition', 'evidenceOutput', 'procedure',
  'permissions', 'confirmation',
]);
const TARGET_KEYS = new Set(['platform', 'databaseName', 'databaseUuid', 'environment', 'remote']);
const TIMING_KEYS = new Set(['issuedAtUtc', 'windowStartUtc', 'windowEndUtc', 'expiresAtUtc']);
const OWNER_KEYS = new Set([
  'ownerId', 'displayName', 'approved', 'approvalSource', 'ownerModel', 'executionOwnerId',
  'rollbackOwnerId', 'evidenceCustodianId', 'riskAcceptanceEvidenceId',
  'riskAcceptanceEvidenceSha256', 'automaticAbortOnOperatorUnavailable',
]);
const REPOSITORY_KEYS = new Set([
  'candidateBranch', 'candidateCommit', 'buildSha', 'minimumImplementationCommit', 'packagePath',
  'packageSha256', 'packagePreparationCommit', 'gateAPreparationReceiptId',
  'gateAPreparationReceiptSha256', 'gateBPreparationReceiptId', 'gateBPreparationReceiptSha256',
]);
const SCOPE_KEYS = new Set(['tenantIds', 'phiReadAllowed', 'rowLevelPatientReadAllowed']);
const RECONCILIATION_KEYS = new Set([
  'expectedPendingMigrationCountBefore', 'expectedPendingMigrationCountAfter',
  'expectedLedgerRowsWritten', 'atomic', 'entries',
]);
const RECONCILIATION_ENTRY_KEYS = new Set([
  'name', 'sha256', 'action', 'schemaEvidenceId', 'schemaEvidenceSha256', 'ledgerEvidenceId',
  'ledgerEvidenceSha256', 'ledgerEntryInitiallyAbsent', 'postSchemaExact', 'maximumLedgerRowsWritten',
]);
const FK_KEYS = new Set([
  'evidenceId', 'evidenceSha256', 'rawArchivalViolationCount', 'formallyWaivedViolationCount',
  'effectiveUnwaivedViolationCount', 'activeViolationCount', 'unknownViolationCount', 'groups',
  'archivalTableConfirmed', 'activeWriterDisabledConfirmed', 'excludedFromCanonicalImportConfirmed',
  'excludedFromReportingConfirmed', 'removalPhase', 'archivalTableMutationAllowed',
  'archivalTableDeletionAllowed',
]);
const FK_GROUP_KEYS = new Set([
  'childTable', 'parentTable', 'rawViolationCount', 'formallyWaivedViolationCount',
  'effectiveUnwaivedViolationCount', 'disposition', 'removalPhase',
]);
const EVIDENCE_OUTPUT_KEYS = new Set(['receiptId', 'protectedDirectoryEvidenceId', 'retentionDays']);
const PROCEDURE_KEYS = new Set([
  'verifyCandidateAndPackage', 'captureFreshAggregateSchemaEvidence',
  'captureFreshMigrationLedgerEvidence', 'stopIfAnyLedgerEntryExists',
  'verifyExactPostSchemaBeforeWrite', 'reconcileExactlyFourLedgerRowsAtomically',
  'executeNoMigrationSqlOrDdl', 'writeNoBusinessRows',
  'refreshProtectedArchivalFkDispositionEvidence', 'verifyZeroActiveAndUnknownFkViolations',
  'preserveRawArchivalRows', 'preserveLegacyAuthority', 'verifyTrafficUnchanged', 'stopOnFirstFailure',
]);
const PERMISSION_KEYS = new Set([
  'productionRead', 'migrationLedgerReconciliation', 'archivalFkDispositionEvidenceRefresh',
  'migrationSqlExecution', 'productionDdl', 'businessTableWrite', 'productionBackfill',
  'providerFlagChange', 'workerVersionUpload', 'deployment', 'trafficChange', 'routeChange',
  'canonicalReadPromotion', 'canonicalWritePromotion', 'localSyncActivation', 'legacyRetirement',
  'archivalTableMutation', 'archivalTableDeletion', 'destructiveAction', 'remoteDatabaseDeletion',
  'push', 'cdbToMainIntegration',
]);
const CONFIRMATION_KEYS = new Set([
  'readToken', 'ledgerReconciliationToken', 'archivalDispositionToken', 'abortToken',
]);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function packageBytes(document: AllTenantReconciliationPackage): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_:\-.]{2,191}$/i.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unknownFields(value: Record<string, unknown> | null, allowed: ReadonlySet<string>): boolean {
  return !value || Object.keys(value).some((key) => !allowed.has(key));
}

function addIssue(
  issues: AllTenantReconciliationAuthorizationIssue[],
  code: AllTenantReconciliationAuthorizationIssueCode,
  gate: AllTenantReconciliationAuthorizationIssue['gate'],
): void {
  if (!issues.some((issue) => issue.code === code && issue.gate === gate)) issues.push({ code, gate });
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
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function mapProtectedIssue(code: ProtectedJsonDocumentIssueCode): AllTenantReconciliationAuthorizationIssue {
  const mapping: Record<ProtectedJsonDocumentIssueCode, AllTenantReconciliationAuthorizationIssueCode> = {
    INVALID_JSON: 'CDBV1070C_AUTHORIZATION_INVALID_JSON',
    DUPLICATE_KEY: 'CDBV1070C_AUTHORIZATION_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDBV1070C_AUTHORIZATION_UNSAFE_KEY',
    TOO_LARGE: 'CDBV1070C_AUTHORIZATION_TOO_LARGE',
    TOO_DEEP: 'CDBV1070C_AUTHORIZATION_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDBV1070C_AUTHORIZATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDBV1070C_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDBV1070C_AUTHORIZATION_FILE_PROTECTION_INVALID',
  };
  return { code: mapping[code], gate: code.startsWith('FILE_') ? 'file' : 'document' };
}

export function buildAllTenantReconciliationRepositoryBinding(
  repositoryRootInput: string,
  packageDocument: AllTenantReconciliationPackage,
  candidateCommit: string,
  buildSha: string,
  gateAPreparationReceiptId: string,
  gateAPreparationReceiptSha256: string,
  gateBPreparationReceiptId: string,
  gateBPreparationReceiptSha256: string,
): AllTenantReconciliationRepositoryBinding {
  const root = resolve(repositoryRootInput);
  const evaluation = evaluateAllTenantReconciliationPackage(root, packageDocument);
  if (!evaluation.packageReady) throw new Error(`reconciliation package is invalid: ${evaluation.issues.join(', ')}`);
  if (!isGitSha(candidateCommit) || !gitCommitExists(root, candidateCommit)) {
    throw new Error('candidateCommit must be an existing 40-character Git commit');
  }
  if (!isAncestor(root, CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT, candidateCommit)) {
    throw new Error('candidateCommit does not contain the Gate C implementation baseline');
  }
  if (!isGitSha(buildSha)) throw new Error('buildSha must be one 40-character Git SHA');
  if (!safeIdentifier(gateAPreparationReceiptId) || !isSha256(gateAPreparationReceiptSha256)
    || !safeIdentifier(gateBPreparationReceiptId) || !isSha256(gateBPreparationReceiptSha256)) {
    throw new Error('Gate A or Gate B preparation evidence binding is invalid');
  }
  return {
    candidateBranch: 'main',
    candidateCommit,
    buildSha,
    minimumImplementationCommit: CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT,
    packagePath: CDB_V1_070C_PACKAGE_PATH,
    packageSha256: sha256(packageBytes(packageDocument)),
    packagePreparationCommit: packageDocument.preparation.repositoryCommit,
    gateAPreparationReceiptId,
    gateAPreparationReceiptSha256,
    gateBPreparationReceiptId,
    gateBPreparationReceiptSha256,
  };
}

export function buildAllTenantReconciliationConfirmationTokens(
  authorization: AllTenantReconciliationAuthorization,
): AllTenantReconciliationAuthorization['confirmation'] {
  const tenants = authorization.scope.tenantIds.join(',');
  const entries = authorization.reconciliation.entries.map((entry) => [
    entry.name,
    entry.sha256,
    entry.schemaEvidenceId,
    entry.schemaEvidenceSha256,
    entry.ledgerEvidenceId,
    entry.ledgerEvidenceSha256,
  ].join(':')).join('|');
  const groups = authorization.foreignKeyDisposition.groups.map((group) => [
    group.childTable,
    group.parentTable,
    group.rawViolationCount,
    group.formallyWaivedViolationCount,
    group.effectiveUnwaivedViolationCount,
  ].join(':')).join('|');
  return {
    readToken: sha256([
      'cdbv1070c', 'read', authorization.target.databaseUuid,
      authorization.repository.candidateCommit, tenants,
      authorization.repository.gateAPreparationReceiptSha256,
      authorization.repository.gateBPreparationReceiptSha256,
    ].join('\0')),
    ledgerReconciliationToken: sha256([
      'cdbv1070c', 'ledger-reconciliation', authorization.target.databaseUuid,
      authorization.repository.candidateCommit, entries,
      String(authorization.reconciliation.expectedPendingMigrationCountBefore),
      String(authorization.reconciliation.expectedPendingMigrationCountAfter),
      String(authorization.reconciliation.expectedLedgerRowsWritten),
    ].join('\0')),
    archivalDispositionToken: sha256([
      'cdbv1070c', 'archival-fk-disposition', authorization.target.databaseUuid,
      authorization.foreignKeyDisposition.evidenceId,
      authorization.foreignKeyDisposition.evidenceSha256,
      groups,
      String(authorization.foreignKeyDisposition.rawArchivalViolationCount),
      String(authorization.foreignKeyDisposition.effectiveUnwaivedViolationCount),
    ].join('\0')),
    abortToken: sha256([
      'cdbv1070c', 'abort', authorization.target.databaseUuid,
      authorization.repository.candidateCommit,
      authorization.owner.rollbackOwnerId,
      'legacy',
    ].join('\0')),
  };
}

function evaluateValue(
  value: unknown,
  repositoryRootInput: string,
  packageDocument: AllTenantReconciliationPackage,
  atUtc: string,
): AllTenantReconciliationAuthorizationResult {
  const root = resolve(repositoryRootInput);
  const issues: AllTenantReconciliationAuthorizationIssue[] = [];
  const document = object(value);
  if (!document) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_SCHEMA_INVALID', 'document');
    return { documentReady: false, authorizationReady: false, issues, authorization: null };
  }
  if (containsNormalizedKey(document, SENSITIVE_KEYS)) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_SENSITIVE_FIELD', 'document');
  }

  const target = object(document.target);
  const timing = object(document.timing);
  const owner = object(document.owner);
  const repository = object(document.repository);
  const scope = object(document.scope);
  const reconciliation = object(document.reconciliation);
  const entries = Array.isArray(reconciliation?.entries) ? reconciliation.entries : [];
  const foreignKeyDisposition = object(document.foreignKeyDisposition);
  const groups = Array.isArray(foreignKeyDisposition?.groups) ? foreignKeyDisposition.groups : [];
  const evidenceOutput = object(document.evidenceOutput);
  const procedure = object(document.procedure);
  const permissions = object(document.permissions);
  const confirmation = object(document.confirmation);

  const unknown = unknownFields(document, ROOT_KEYS)
    || unknownFields(target, TARGET_KEYS)
    || unknownFields(timing, TIMING_KEYS)
    || unknownFields(owner, OWNER_KEYS)
    || unknownFields(repository, REPOSITORY_KEYS)
    || unknownFields(scope, SCOPE_KEYS)
    || unknownFields(reconciliation, RECONCILIATION_KEYS)
    || entries.some((entry) => unknownFields(object(entry), RECONCILIATION_ENTRY_KEYS))
    || unknownFields(foreignKeyDisposition, FK_KEYS)
    || groups.some((group) => unknownFields(object(group), FK_GROUP_KEYS))
    || unknownFields(evidenceOutput, EVIDENCE_OUTPUT_KEYS)
    || unknownFields(procedure, PROCEDURE_KEYS)
    || unknownFields(permissions, PERMISSION_KEYS)
    || unknownFields(confirmation, CONFIRMATION_KEYS);
  if (unknown) addIssue(issues, 'CDBV1070C_AUTHORIZATION_UNKNOWN_FIELD', 'document');

  if (document.schemaVersion !== 1
    || document.operation !== 'all_tenant_schema_ledger_archival_fk_reconciliation'
    || !safeIdentifier(document.authorizationId)) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_SCHEMA_INVALID', 'document');
  }
  if (!target
    || target.platform !== 'cloudflare_d1'
    || target.databaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || target.databaseUuid !== CDB101_PRODUCTION_DATABASE_ID
    || target.environment !== 'production'
    || target.remote !== true) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_TARGET_INVALID', 'target');
  }

  const issuedAt = parseUtc(timing?.issuedAtUtc);
  const windowStart = parseUtc(timing?.windowStartUtc);
  const windowEnd = parseUtc(timing?.windowEndUtc);
  const expiresAt = parseUtc(timing?.expiresAtUtc);
  const evaluatedAt = parseUtc(atUtc);
  if (issuedAt === null || windowStart === null || windowEnd === null || expiresAt === null
    || evaluatedAt === null || issuedAt > windowStart || windowStart >= windowEnd || windowEnd > expiresAt) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_TIMING_INVALID', 'timing');
  } else if (evaluatedAt < issuedAt || evaluatedAt < windowStart || evaluatedAt > windowEnd || evaluatedAt > expiresAt) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_EXPIRED', 'timing');
  }

  if (!owner
    || !safeIdentifier(owner.ownerId)
    || !nonEmpty(owner.displayName)
    || owner.approved !== true
    || owner.approvalSource !== 'user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization'
    || owner.ownerModel !== 'single_operator_risk_accepted'
    || !safeIdentifier(owner.executionOwnerId)
    || !safeIdentifier(owner.rollbackOwnerId)
    || !safeIdentifier(owner.evidenceCustodianId)
    || !safeIdentifier(owner.riskAcceptanceEvidenceId)
    || !isSha256(owner.riskAcceptanceEvidenceSha256)
    || owner.automaticAbortOnOperatorUnavailable !== true) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_OWNER_INVALID', 'authorization');
  }

  let expectedRepository: AllTenantReconciliationRepositoryBinding | null = null;
  if (repository
    && isGitSha(repository.candidateCommit)
    && isGitSha(repository.buildSha)
    && safeIdentifier(repository.gateAPreparationReceiptId)
    && isSha256(repository.gateAPreparationReceiptSha256)
    && safeIdentifier(repository.gateBPreparationReceiptId)
    && isSha256(repository.gateBPreparationReceiptSha256)) {
    try {
      expectedRepository = buildAllTenantReconciliationRepositoryBinding(
        root,
        packageDocument,
        repository.candidateCommit,
        repository.buildSha,
        repository.gateAPreparationReceiptId,
        repository.gateAPreparationReceiptSha256,
        repository.gateBPreparationReceiptId,
        repository.gateBPreparationReceiptSha256,
      );
    } catch {
      expectedRepository = null;
    }
  }
  if (!expectedRepository || !sameJson(repository, expectedRepository)) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_BINDING_INVALID', 'binding');
  }

  if (!scope
    || !sameArray(scope.tenantIds, ['1', '100', '101', '102'])
    || scope.phiReadAllowed !== false
    || scope.rowLevelPatientReadAllowed !== false) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_SCOPE_INVALID', 'scope');
  }

  let reconciliationValid = Boolean(reconciliation)
    && reconciliation?.expectedPendingMigrationCountBefore === 29
    && reconciliation?.expectedPendingMigrationCountAfter === 25
    && reconciliation?.expectedLedgerRowsWritten === 4
    && reconciliation?.atomic === true
    && entries.length === CDB_V1_070C_RECONCILIATION_MIGRATIONS.length;
  if (reconciliationValid) {
    const seenEvidenceIds = new Set<string>();
    const seenEvidenceHashes = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = object(entries[index]);
      const expected = CDB_V1_070C_RECONCILIATION_MIGRATIONS[index];
      if (!entry
        || entry.name !== expected.name
        || entry.sha256 !== expected.sha256
        || entry.action !== expected.action
        || !safeIdentifier(entry.schemaEvidenceId)
        || !isSha256(entry.schemaEvidenceSha256)
        || !safeIdentifier(entry.ledgerEvidenceId)
        || !isSha256(entry.ledgerEvidenceSha256)
        || entry.ledgerEntryInitiallyAbsent !== true
        || entry.postSchemaExact !== true
        || entry.maximumLedgerRowsWritten !== 1) {
        reconciliationValid = false;
        break;
      }
      for (const id of [entry.schemaEvidenceId, entry.ledgerEvidenceId] as string[]) {
        if (seenEvidenceIds.has(id)) reconciliationValid = false;
        seenEvidenceIds.add(id);
      }
      for (const hash of [entry.schemaEvidenceSha256, entry.ledgerEvidenceSha256] as string[]) {
        if (seenEvidenceHashes.has(hash)) reconciliationValid = false;
        seenEvidenceHashes.add(hash);
      }
    }
  }
  if (!reconciliationValid) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_RECONCILIATION_INVALID', 'authorization');
  }

  const fkValid = Boolean(foreignKeyDisposition)
    && safeIdentifier(foreignKeyDisposition?.evidenceId)
    && isSha256(foreignKeyDisposition?.evidenceSha256)
    && foreignKeyDisposition?.rawArchivalViolationCount === 41
    && foreignKeyDisposition?.formallyWaivedViolationCount === 41
    && foreignKeyDisposition?.effectiveUnwaivedViolationCount === 0
    && foreignKeyDisposition?.activeViolationCount === 0
    && foreignKeyDisposition?.unknownViolationCount === 0
    && sameJson(groups, CDB_V1_070C_ARCHIVAL_FK_GROUPS)
    && foreignKeyDisposition?.archivalTableConfirmed === true
    && foreignKeyDisposition?.activeWriterDisabledConfirmed === true
    && foreignKeyDisposition?.excludedFromCanonicalImportConfirmed === true
    && foreignKeyDisposition?.excludedFromReportingConfirmed === true
    && foreignKeyDisposition?.removalPhase === 'legacy_retirement_p11'
    && foreignKeyDisposition?.archivalTableMutationAllowed === false
    && foreignKeyDisposition?.archivalTableDeletionAllowed === false;
  if (!fkValid) addIssue(issues, 'CDBV1070C_AUTHORIZATION_FK_DISPOSITION_INVALID', 'authorization');

  if (!evidenceOutput
    || !safeIdentifier(evidenceOutput.receiptId)
    || !safeIdentifier(evidenceOutput.protectedDirectoryEvidenceId)
    || typeof evidenceOutput.retentionDays !== 'number'
    || !Number.isSafeInteger(evidenceOutput.retentionDays)
    || evidenceOutput.retentionDays < 7
    || evidenceOutput.retentionDays > 365) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_EVIDENCE_OUTPUT_INVALID', 'authorization');
  }
  if (!procedure || Object.values(procedure).some((value) => value !== true)) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_PROCEDURE_INVALID', 'authorization');
  }
  const expectedPermissions: Record<string, boolean> = {
    productionRead: true,
    migrationLedgerReconciliation: true,
    archivalFkDispositionEvidenceRefresh: true,
    migrationSqlExecution: false,
    productionDdl: false,
    businessTableWrite: false,
    productionBackfill: false,
    providerFlagChange: false,
    workerVersionUpload: false,
    deployment: false,
    trafficChange: false,
    routeChange: false,
    canonicalReadPromotion: false,
    canonicalWritePromotion: false,
    localSyncActivation: false,
    legacyRetirement: false,
    archivalTableMutation: false,
    archivalTableDeletion: false,
    destructiveAction: false,
    remoteDatabaseDeletion: false,
    push: false,
    cdbToMainIntegration: false,
  };
  if (!permissions
    || Object.keys(permissions).length !== Object.keys(expectedPermissions).length
    || Object.entries(expectedPermissions).some(([key, expected]) => permissions[key] !== expected)) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_PERMISSION_INVALID', 'authorization');
  }

  const authorization = document as unknown as AllTenantReconciliationAuthorization;
  let expectedConfirmation: AllTenantReconciliationAuthorization['confirmation'] | null = null;
  try {
    expectedConfirmation = buildAllTenantReconciliationConfirmationTokens(authorization);
  } catch {
    expectedConfirmation = null;
  }
  if (!confirmation || !expectedConfirmation
    || Object.entries(expectedConfirmation).some(([key, expected]) => confirmation[key] !== expected)) {
    addIssue(issues, 'CDBV1070C_AUTHORIZATION_CONFIRMATION_INVALID', 'authorization');
  }

  const documentBlockingCodes = new Set<AllTenantReconciliationAuthorizationIssueCode>([
    'CDBV1070C_AUTHORIZATION_INVALID_JSON',
    'CDBV1070C_AUTHORIZATION_DUPLICATE_KEY',
    'CDBV1070C_AUTHORIZATION_UNSAFE_KEY',
    'CDBV1070C_AUTHORIZATION_TOO_LARGE',
    'CDBV1070C_AUTHORIZATION_TOO_DEEP',
    'CDBV1070C_AUTHORIZATION_UNKNOWN_FIELD',
    'CDBV1070C_AUTHORIZATION_SENSITIVE_FIELD',
    'CDBV1070C_AUTHORIZATION_SCHEMA_INVALID',
  ]);
  const documentReady = !issues.some((issue) => documentBlockingCodes.has(issue.code));
  const authorizationReady = issues.length === 0;
  return {
    documentReady,
    authorizationReady,
    issues,
    authorization: authorizationReady ? authorization : null,
  };
}

export function parseAllTenantReconciliationAuthorizationJson(
  text: string,
  repositoryRoot: string,
  packageDocument: AllTenantReconciliationPackage,
  atUtc = new Date().toISOString(),
): AllTenantReconciliationAuthorizationResult {
  const parsed = parseStrictJsonDocument(text, DOCUMENT_OPTIONS);
  if (!parsed.ready) {
    return {
      documentReady: false,
      authorizationReady: false,
      issues: parsed.issues.map((issue) => mapProtectedIssue(issue.code)),
      authorization: null,
    };
  }
  return evaluateValue(parsed.value, repositoryRoot, packageDocument, atUtc);
}

export function loadAllTenantReconciliationAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  packageDocument: AllTenantReconciliationPackage,
  atUtc = new Date().toISOString(),
): AllTenantReconciliationAuthorizationResult {
  const loaded = loadProtectedJsonDocument(authorizationPath, repositoryRoot, DOCUMENT_OPTIONS);
  if (!loaded.ready) {
    return {
      documentReady: false,
      authorizationReady: false,
      issues: loaded.issues.map((issue) => mapProtectedIssue(issue.code)),
      authorization: null,
    };
  }
  return evaluateValue(loaded.value, repositoryRoot, packageDocument, atUtc);
}

export function buildAllTenantReconciliationAuthorizationPlan(
  result: AllTenantReconciliationAuthorizationResult,
): AllTenantReconciliationAuthorizationPlan | null {
  const authorization = result.authorization;
  if (!result.authorizationReady || !authorization) return null;
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION',
    authorizationId: authorization.authorizationId,
    productionDatabaseUuid: authorization.target.databaseUuid,
    candidateCommit: authorization.repository.candidateCommit,
    tenantCount: 4,
    migrationLedgerEntryCount: 4,
    rawArchivalForeignKeyViolations: 41,
    formallyWaivedArchivalForeignKeyViolations: 41,
    effectiveUnwaivedForeignKeyViolations: 0,
    phases: [
      'fresh_aggregate_verification',
      'atomic_migration_ledger_reconciliation',
      'archival_fk_disposition_evidence_refresh',
      'reconciliation_evidence_verification',
    ],
    finalResponseAuthority: 'legacy',
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
    migrationLedgerRowsWritten: 0,
    trafficChanged: false,
  };
}

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssueCode,
} from './protected-json-document';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const CDB_V1_050_PACKAGE_PATH = 'docs/database/cdb-v1-040c-protected-clone-comparison-package.json';
export const CDB_V1_050_MIGRATION_MANIFEST_PATH = 'src/data/schema-migrations.generated.ts';
export const CDB_V1_050_BRANCH = 'program/cdb-main-continuous-20260725';

export const CDB_V1_050_PROVIDER_KEYS = [
  'canonical_invoice_provider_v1',
  'canonical_payment_provider_v1',
  'canonical_deposit_provider_v1',
  'canonical_patient_identity_provider_v1',
  'canonical_practitioner_provider_v1',
  'canonical_appointment_provider_v1',
  'canonical_encounter_provider_v1',
  'canonical_admission_bed_provider_v1',
  'canonical_compensation_accrual_provider_v1',
] as const;

export const CDB_V1_050_CONSUMER_IDS = [
  'cdb040b.billing-detail',
  'cdb040b.report',
  'cdb040b.dashboard',
  'cdb040b.export',
  'cdb040b.scheduled-job',
  'cdb040b.admin',
  'cdb040c.reception-patient-context.patient',
  'cdb040c.reception-patient-context.practitioner',
  'cdb040c.reception-patient-context.appointment',
  'cdb040c.reception-patient-context.encounter',
  'cdb040c.reception-patient-context.admission',
  'cdb040c.commission-accrual-admin',
] as const;

export const CDB_V1_050_SOURCE_TABLES = [
  'bills',
  'payments',
  'billing_deposits',
  'patients',
  'doctors',
  'appointments',
  'visits',
  'admissions',
  'doctor_commission_accruals',
] as const;

export interface ProtectedCloneMigrationBinding {
  name: string;
  sha256: string;
}

export interface ProtectedCloneBackfillBinding {
  path: string;
  sha256: string;
  partitionLimit: number;
}

export interface ProtectedCloneScopeRecord {
  tenantId: string;
  providerKey: string;
  consumerId: string;
  sourceTable: string;
  sourceRowKey: string;
}

export interface ProtectedCloneRepositoryBinding {
  branch: string;
  repositoryCommit: string;
  buildSha: string;
  packagePath: string;
  packageSha256: string;
  migrationManifestPath: string;
  migrationManifestSha256: string;
  migrationCount: number;
}

export interface ProtectedCloneRehearsalAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'protected_clone_migration_backfill_and_rollback_rehearsal';
  target: {
    platform: 'cloudflare_d1' | 'local_sqlite_d1_equivalent';
    accountIdSha256: string;
    databaseName: string;
    databaseUuid: string;
    environment: 'protected_clone';
    remote: boolean;
    productionDatabaseUuid: string;
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
    approvalSource: 'user_explicit_protected_clone_rehearsal_authorization';
    executionOwnerId: string;
    rollbackOwnerId: string;
    observationOwnerId: string;
  };
  sourceSnapshot: {
    identity: string;
    sha256: string;
    exportedAtUtc: string;
    readOnly: true;
    productionSourceMutationAllowed: false;
  };
  rollback: {
    backupIdentity: string;
    backupSha256: string;
    restoreAuthorityConfirmed: true;
    restoreOnAnyFailure: true;
    stopOnFirstFailure: true;
    rollbackProvider: 'legacy';
  };
  repository: ProtectedCloneRepositoryBinding;
  scope: {
    tenantIds: string[];
    maxRecords: number;
    records: ProtectedCloneScopeRecord[];
  };
  migrations: ProtectedCloneMigrationBinding[];
  backfills: ProtectedCloneBackfillBinding[];
  acceptance: {
    integrityCheck: 'ok';
    foreignKeyViolations: 0;
    criticalUnexplainedVarianceCount: 0;
    providerErrorCount: 0;
    mappingAmbiguityCount: 0;
    crossTenantReferenceCount: 0;
    latencyBudgetBreachCount: 0;
    secondPassNewBusinessRows: 0;
    sourceSnapshotMutationCount: 0;
  };
  procedure: {
    serialMigrations: true;
    boundedBackfills: true;
    secondPassRequired: true;
    sourceReadOnlyVerification: true;
    receptionSmoke: true;
    billingSmoke: true;
    paymentSmoke: true;
    commissionSmoke: true;
    providerPromotionRehearsal: true;
    immediateLegacyRollback: true;
    noConcurrentDeployment: true;
  };
  permissions: {
    protectedCloneRead: true;
    protectedCloneSchemaMigration: true;
    protectedCloneBackfill: true;
    providerPromotionRehearsal: true;
    rollbackRehearsal: true;
    productionRead: false;
    productionMutation: false;
    productionProviderActivation: false;
    deployment: false;
    trafficChange: false;
    localSyncActivation: false;
    legacyRetirement: false;
    remoteDatabaseDeletion: false;
    push: false;
    cdbToMainIntegration: false;
  };
}

export type ProtectedCloneRehearsalAuthorizationIssueCode =
  | 'CDBV1050_AUTHORIZATION_INVALID_JSON'
  | 'CDBV1050_AUTHORIZATION_DUPLICATE_KEY'
  | 'CDBV1050_AUTHORIZATION_UNSAFE_KEY'
  | 'CDBV1050_AUTHORIZATION_TOO_LARGE'
  | 'CDBV1050_AUTHORIZATION_TOO_DEEP'
  | 'CDBV1050_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDBV1050_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDBV1050_AUTHORIZATION_FILE_PROTECTION_INVALID'
  | 'CDBV1050_AUTHORIZATION_UNKNOWN_FIELD'
  | 'CDBV1050_AUTHORIZATION_SENSITIVE_FIELD'
  | 'CDBV1050_AUTHORIZATION_SCHEMA_INVALID'
  | 'CDBV1050_AUTHORIZATION_TARGET_INVALID'
  | 'CDBV1050_AUTHORIZATION_BINDING_INVALID'
  | 'CDBV1050_AUTHORIZATION_SCOPE_INVALID'
  | 'CDBV1050_AUTHORIZATION_MIGRATION_INVALID'
  | 'CDBV1050_AUTHORIZATION_BACKFILL_INVALID'
  | 'CDBV1050_AUTHORIZATION_PERMISSION_INVALID'
  | 'CDBV1050_AUTHORIZATION_TIMING_INVALID'
  | 'CDBV1050_AUTHORIZATION_EXPIRED'
  | 'CDBV1050_AUTHORIZATION_OWNER_INVALID'
  | 'CDBV1050_AUTHORIZATION_ROLLBACK_INVALID'
  | 'CDBV1050_AUTHORIZATION_ACCEPTANCE_INVALID'
  | 'CDBV1050_AUTHORIZATION_PROCEDURE_INVALID';

export interface ProtectedCloneRehearsalAuthorizationIssue {
  code: ProtectedCloneRehearsalAuthorizationIssueCode;
  gate: 'document' | 'file' | 'target' | 'binding' | 'scope' | 'timing' | 'authorization';
}

export interface ProtectedCloneRehearsalAuthorizationResult {
  documentReady: boolean;
  executionReady: boolean;
  issues: ProtectedCloneRehearsalAuthorizationIssue[];
  authorization: ProtectedCloneRehearsalAuthorization | null;
}

export interface ProtectedCloneRehearsalAuthorizationReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  executionReady: boolean;
  issueCount: number;
  tenantCount: number;
  recordCount: number;
  migrationCount: number;
  backfillCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  protectedCloneMutationPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
}

export interface ProtectedCloneRehearsalPlan {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL';
  authorizationId: string;
  targetPlatform: ProtectedCloneRehearsalAuthorization['target']['platform'];
  targetDatabaseUuid: string;
  repositoryCommit: string;
  buildSha: string;
  sourceSnapshotSha256: string;
  tenantCount: number;
  recordCount: number;
  migrationCount: number;
  backfillCount: number;
  phases: readonly string[];
  abortConditions: readonly string[];
  finalProvider: 'legacy';
  networkRequestPerformed: false;
  protectedCloneMutationPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
}

const ROOT_KEYS = new Set([
  'schemaVersion', 'authorizationId', 'operation', 'target', 'timing', 'owner',
  'sourceSnapshot', 'rollback', 'repository', 'scope', 'migrations', 'backfills',
  'acceptance', 'procedure', 'permissions',
]);
const TARGET_KEYS = new Set([
  'platform', 'accountIdSha256', 'databaseName', 'databaseUuid', 'environment',
  'remote', 'productionDatabaseUuid',
]);
const TIMING_KEYS = new Set(['issuedAtUtc', 'windowStartUtc', 'windowEndUtc', 'expiresAtUtc']);
const OWNER_KEYS = new Set([
  'ownerId', 'displayName', 'approved', 'approvalSource', 'executionOwnerId',
  'rollbackOwnerId', 'observationOwnerId',
]);
const SNAPSHOT_KEYS = new Set(['identity', 'sha256', 'exportedAtUtc', 'readOnly', 'productionSourceMutationAllowed']);
const ROLLBACK_KEYS = new Set([
  'backupIdentity', 'backupSha256', 'restoreAuthorityConfirmed', 'restoreOnAnyFailure',
  'stopOnFirstFailure', 'rollbackProvider',
]);
const REPOSITORY_KEYS = new Set([
  'branch', 'repositoryCommit', 'buildSha', 'packagePath', 'packageSha256',
  'migrationManifestPath', 'migrationManifestSha256', 'migrationCount',
]);
const SCOPE_KEYS = new Set(['tenantIds', 'maxRecords', 'records']);
const RECORD_KEYS = new Set(['tenantId', 'providerKey', 'consumerId', 'sourceTable', 'sourceRowKey']);
const MIGRATION_KEYS = new Set(['name', 'sha256']);
const BACKFILL_KEYS = new Set(['path', 'sha256', 'partitionLimit']);
const ACCEPTANCE_KEYS = new Set([
  'integrityCheck', 'foreignKeyViolations', 'criticalUnexplainedVarianceCount',
  'providerErrorCount', 'mappingAmbiguityCount', 'crossTenantReferenceCount',
  'latencyBudgetBreachCount', 'secondPassNewBusinessRows', 'sourceSnapshotMutationCount',
]);
const PROCEDURE_KEYS = new Set([
  'serialMigrations', 'boundedBackfills', 'secondPassRequired', 'sourceReadOnlyVerification',
  'receptionSmoke', 'billingSmoke', 'paymentSmoke', 'commissionSmoke',
  'providerPromotionRehearsal', 'immediateLegacyRollback', 'noConcurrentDeployment',
]);
const PERMISSION_KEYS = new Set([
  'protectedCloneRead', 'protectedCloneSchemaMigration', 'protectedCloneBackfill',
  'providerPromotionRehearsal', 'rollbackRehearsal', 'productionRead',
  'productionMutation', 'productionProviderActivation', 'deployment', 'trafficChange',
  'localSyncActivation', 'legacyRetirement', 'remoteDatabaseDeletion', 'push',
  'cdbToMainIntegration',
]);
const SENSITIVE_KEYS = new Set([
  'header', 'headers', 'cookie', 'cookies', 'token', 'password', 'secret',
  'credential', 'credentials', 'databaseurl', 'rawoutput', 'sql', 'command',
  'environmentvariable', 'apikey', 'privatekey',
]);
const DOCUMENT_OPTIONS = { maxBytes: 256 * 1024, maxDepth: 16 } as const;
const PROVIDER_KEYS = new Set<string>(CDB_V1_050_PROVIDER_KEYS);
const CONSUMER_IDS = new Set<string>(CDB_V1_050_CONSUMER_IDS);
const SOURCE_TABLES = new Set<string>(CDB_V1_050_SOURCE_TABLES);
const FINANCIAL_CONSUMERS = CDB_V1_050_CONSUMER_IDS.filter((consumerId) => consumerId.startsWith('cdb040b.'));
const ALLOWED_SCOPE_TUPLES = new Set<string>([
  ...FINANCIAL_CONSUMERS.flatMap((consumerId) => [
    `canonical_invoice_provider_v1\u0000${consumerId}\u0000bills`,
    `canonical_payment_provider_v1\u0000${consumerId}\u0000payments`,
    `canonical_deposit_provider_v1\u0000${consumerId}\u0000billing_deposits`,
  ]),
  'canonical_patient_identity_provider_v1\u0000cdb040c.reception-patient-context.patient\u0000patients',
  'canonical_practitioner_provider_v1\u0000cdb040c.reception-patient-context.practitioner\u0000doctors',
  'canonical_appointment_provider_v1\u0000cdb040c.reception-patient-context.appointment\u0000appointments',
  'canonical_encounter_provider_v1\u0000cdb040c.reception-patient-context.encounter\u0000visits',
  'canonical_admission_bed_provider_v1\u0000cdb040c.reception-patient-context.admission\u0000admissions',
  'canonical_compensation_accrual_provider_v1\u0000cdb040c.commission-accrual-admin\u0000doctor_commission_accruals',
]);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(repositoryRoot: string, relativePath: string): string {
  return sha256(readFileSync(resolve(repositoryRoot, relativePath)));
}

function repositoryHead(repositoryRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function repositoryBranch(repositoryRoot: string): string {
  return execFileSync('git', ['branch', '--show-current'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function migrationCount(repositoryRoot: string): number {
  const source = readFileSync(resolve(repositoryRoot, CDB_V1_050_MIGRATION_MANIFEST_PATH), 'utf8');
  return [...source.matchAll(/\n\s*filename:\s*"[^"]+"/g)].length;
}

export function buildProtectedCloneRepositoryBinding(repositoryRoot: string): ProtectedCloneRepositoryBinding {
  const commit = repositoryHead(repositoryRoot);
  return {
    branch: repositoryBranch(repositoryRoot),
    repositoryCommit: commit,
    buildSha: commit,
    packagePath: CDB_V1_050_PACKAGE_PATH,
    packageSha256: fileSha256(repositoryRoot, CDB_V1_050_PACKAGE_PATH),
    migrationManifestPath: CDB_V1_050_MIGRATION_MANIFEST_PATH,
    migrationManifestSha256: fileSha256(repositoryRoot, CDB_V1_050_MIGRATION_MANIFEST_PATH),
    migrationCount: migrationCount(repositoryRoot),
  };
}

function issue(
  code: ProtectedCloneRehearsalAuthorizationIssueCode,
  gate: ProtectedCloneRehearsalAuthorizationIssue['gate'],
): ProtectedCloneRehearsalAuthorizationIssue {
  return { code, gate };
}

function mapProtectedIssue(code: ProtectedJsonDocumentIssueCode): ProtectedCloneRehearsalAuthorizationIssue {
  const mapped: Record<ProtectedJsonDocumentIssueCode, ProtectedCloneRehearsalAuthorizationIssueCode> = {
    INVALID_JSON: 'CDBV1050_AUTHORIZATION_INVALID_JSON',
    DUPLICATE_KEY: 'CDBV1050_AUTHORIZATION_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDBV1050_AUTHORIZATION_UNSAFE_KEY',
    TOO_LARGE: 'CDBV1050_AUTHORIZATION_TOO_LARGE',
    TOO_DEEP: 'CDBV1050_AUTHORIZATION_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDBV1050_AUTHORIZATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDBV1050_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDBV1050_AUTHORIZATION_FILE_PROTECTION_INVALID',
  };
  return issue(mapped[code], code.startsWith('FILE_') ? 'file' : 'document');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  return isPlainRecord(value)
    && Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key));
}

function hasUnknownKeys(value: unknown, keys: ReadonlySet<string>): boolean {
  return isPlainRecord(value) && Object.keys(value).some((key) => !keys.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function sha256String(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function isInsideRepository(repositoryRoot: string, candidatePath: string): boolean {
  const repository = resolve(repositoryRoot);
  const candidate = resolve(candidatePath);
  const relation = relative(repository, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

function findUnknownField(value: unknown): boolean {
  if (!hasExactKeys(value, ROOT_KEYS)) return hasUnknownKeys(value, ROOT_KEYS);
  if (hasUnknownKeys(value.target, TARGET_KEYS)) return true;
  if (hasUnknownKeys(value.timing, TIMING_KEYS)) return true;
  if (hasUnknownKeys(value.owner, OWNER_KEYS)) return true;
  if (hasUnknownKeys(value.sourceSnapshot, SNAPSHOT_KEYS)) return true;
  if (hasUnknownKeys(value.rollback, ROLLBACK_KEYS)) return true;
  if (hasUnknownKeys(value.repository, REPOSITORY_KEYS)) return true;
  if (hasUnknownKeys(value.scope, SCOPE_KEYS)) return true;
  if (isPlainRecord(value.scope) && Array.isArray(value.scope.records)
    && value.scope.records.some((record) => hasUnknownKeys(record, RECORD_KEYS))) return true;
  if (Array.isArray(value.migrations)
    && value.migrations.some((entry) => hasUnknownKeys(entry, MIGRATION_KEYS))) return true;
  if (Array.isArray(value.backfills)
    && value.backfills.some((entry) => hasUnknownKeys(entry, BACKFILL_KEYS))) return true;
  if (hasUnknownKeys(value.acceptance, ACCEPTANCE_KEYS)) return true;
  if (hasUnknownKeys(value.procedure, PROCEDURE_KEYS)) return true;
  if (hasUnknownKeys(value.permissions, PERMISSION_KEYS)) return true;
  return false;
}

function validateSchema(value: unknown): value is ProtectedCloneRehearsalAuthorization {
  if (!hasExactKeys(value, ROOT_KEYS)) return false;
  if (!hasExactKeys(value.target, TARGET_KEYS)) return false;
  if (!hasExactKeys(value.timing, TIMING_KEYS)) return false;
  if (!hasExactKeys(value.owner, OWNER_KEYS)) return false;
  if (!hasExactKeys(value.sourceSnapshot, SNAPSHOT_KEYS)) return false;
  if (!hasExactKeys(value.rollback, ROLLBACK_KEYS)) return false;
  if (!hasExactKeys(value.repository, REPOSITORY_KEYS)) return false;
  if (!hasExactKeys(value.scope, SCOPE_KEYS)) return false;
  if (!Array.isArray(value.scope.tenantIds) || !Array.isArray(value.scope.records)) return false;
  if (value.scope.records.some((record) => !hasExactKeys(record, RECORD_KEYS))) return false;
  if (!Array.isArray(value.migrations) || value.migrations.some((entry) => !hasExactKeys(entry, MIGRATION_KEYS))) return false;
  if (!Array.isArray(value.backfills) || value.backfills.some((entry) => !hasExactKeys(entry, BACKFILL_KEYS))) return false;
  if (!hasExactKeys(value.acceptance, ACCEPTANCE_KEYS)) return false;
  if (!hasExactKeys(value.procedure, PROCEDURE_KEYS)) return false;
  if (!hasExactKeys(value.permissions, PERMISSION_KEYS)) return false;

  return value.schemaVersion === 1
    && nonEmptyString(value.authorizationId)
    && value.operation === 'protected_clone_migration_backfill_and_rollback_rehearsal'
    && (value.target.platform === 'cloudflare_d1' || value.target.platform === 'local_sqlite_d1_equivalent')
    && nonEmptyString(value.target.accountIdSha256)
    && nonEmptyString(value.target.databaseName)
    && nonEmptyString(value.target.databaseUuid)
    && value.target.environment === 'protected_clone'
    && typeof value.target.remote === 'boolean'
    && nonEmptyString(value.target.productionDatabaseUuid)
    && Object.values(value.timing).every(nonEmptyString)
    && nonEmptyString(value.owner.ownerId)
    && nonEmptyString(value.owner.displayName)
    && typeof value.owner.approved === 'boolean'
    && nonEmptyString(value.owner.approvalSource)
    && nonEmptyString(value.owner.executionOwnerId)
    && nonEmptyString(value.owner.rollbackOwnerId)
    && nonEmptyString(value.owner.observationOwnerId)
    && nonEmptyString(value.sourceSnapshot.identity)
    && nonEmptyString(value.sourceSnapshot.sha256)
    && nonEmptyString(value.sourceSnapshot.exportedAtUtc)
    && typeof value.sourceSnapshot.readOnly === 'boolean'
    && typeof value.sourceSnapshot.productionSourceMutationAllowed === 'boolean'
    && nonEmptyString(value.rollback.backupIdentity)
    && nonEmptyString(value.rollback.backupSha256)
    && typeof value.rollback.restoreAuthorityConfirmed === 'boolean'
    && typeof value.rollback.restoreOnAnyFailure === 'boolean'
    && typeof value.rollback.stopOnFirstFailure === 'boolean'
    && value.rollback.rollbackProvider === 'legacy'
    && Object.entries(value.repository).every(([key, entry]) => key === 'migrationCount' ? Number.isSafeInteger(entry) : nonEmptyString(entry))
    && value.scope.tenantIds.every(nonEmptyString)
    && Number.isSafeInteger(value.scope.maxRecords)
    && value.scope.records.every((record) => Object.values(record).every(nonEmptyString))
    && value.migrations.every((entry) => nonEmptyString(entry.name) && nonEmptyString(entry.sha256))
    && value.backfills.every((entry) => nonEmptyString(entry.path) && nonEmptyString(entry.sha256) && Number.isSafeInteger(entry.partitionLimit))
    && Object.values(value.acceptance).every((entry) => typeof entry === 'number' || entry === 'ok')
    && Object.values(value.procedure).every((entry) => typeof entry === 'boolean')
    && Object.values(value.permissions).every((entry) => typeof entry === 'boolean');
}

function repositoryBindingMatches(
  actual: ProtectedCloneRepositoryBinding,
  expected: ProtectedCloneRepositoryBinding,
): boolean {
  return actual.branch === expected.branch
    && actual.repositoryCommit === expected.repositoryCommit
    && actual.buildSha === expected.buildSha
    && actual.packagePath === expected.packagePath
    && actual.packageSha256 === expected.packageSha256
    && actual.migrationManifestPath === expected.migrationManifestPath
    && actual.migrationManifestSha256 === expected.migrationManifestSha256
    && actual.migrationCount === expected.migrationCount;
}

function validateTiming(
  timing: ProtectedCloneRehearsalAuthorization['timing'],
  nowUtc: string,
): 'valid' | 'invalid' | 'expired' {
  const issued = parseUtc(timing.issuedAtUtc);
  const start = parseUtc(timing.windowStartUtc);
  const end = parseUtc(timing.windowEndUtc);
  const expires = parseUtc(timing.expiresAtUtc);
  const now = parseUtc(nowUtc);
  if (issued == null || start == null || end == null || expires == null || now == null) return 'invalid';
  if (issued > start || start >= end || end > expires) return 'invalid';
  if (end - start > 4 * 60 * 60 * 1000 || expires - end > 60 * 60 * 1000) return 'invalid';
  if (now > expires) return 'expired';
  if (now < start || now > end) return 'invalid';
  return 'valid';
}

function validateMigrations(
  migrations: ProtectedCloneMigrationBinding[],
  repositoryRoot: string,
): boolean {
  if (migrations.length < 1 || migrations.length > 50) return false;
  const names = new Set<string>();
  for (const migration of migrations) {
    if (basename(migration.name) !== migration.name || !/^[0-9]{4}[a-z]?_[a-z0-9_]+\.sql$/.test(migration.name)) return false;
    if (!sha256String(migration.sha256) || names.has(migration.name)) return false;
    names.add(migration.name);
    try {
      if (fileSha256(repositoryRoot, `migrations/${migration.name}`) !== migration.sha256) return false;
    } catch {
      return false;
    }
  }
  return migrations.every((entry, index) => index === 0 || entry.name > migrations[index - 1].name);
}

function validateBackfills(
  backfills: ProtectedCloneBackfillBinding[],
  repositoryRoot: string,
): boolean {
  if (backfills.length < 1 || backfills.length > 30) return false;
  const paths = new Set<string>();
  for (const backfill of backfills) {
    if (!backfill.path.startsWith('scripts/canonical/') || !backfill.path.endsWith('.ts')) return false;
    if (!basename(backfill.path).includes('backfill') || !sha256String(backfill.sha256)) return false;
    if (!positiveInteger(backfill.partitionLimit) || backfill.partitionLimit > 10_000) return false;
    if (paths.has(backfill.path)) return false;
    paths.add(backfill.path);
    try {
      if (fileSha256(repositoryRoot, backfill.path) !== backfill.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function validateScope(scope: ProtectedCloneRehearsalAuthorization['scope']): boolean {
  if (scope.tenantIds.length < 1 || scope.tenantIds.length > 10) return false;
  if (new Set(scope.tenantIds).size !== scope.tenantIds.length) return false;
  if (!positiveInteger(scope.maxRecords) || scope.maxRecords > 100) return false;
  if (scope.records.length < 1 || scope.records.length > scope.maxRecords) return false;
  const tenants = new Set(scope.tenantIds);
  const keys = new Set<string>();
  for (const record of scope.records) {
    if (!tenants.has(record.tenantId)
      || !PROVIDER_KEYS.has(record.providerKey)
      || !CONSUMER_IDS.has(record.consumerId)
      || !SOURCE_TABLES.has(record.sourceTable)) return false;
    const tuple = `${record.providerKey}\u0000${record.consumerId}\u0000${record.sourceTable}`;
    if (!ALLOWED_SCOPE_TUPLES.has(tuple)) return false;
    const key = `${record.tenantId}\u0000${tuple}\u0000${record.sourceRowKey}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function permissionsMatch(value: ProtectedCloneRehearsalAuthorization['permissions']): boolean {
  return value.protectedCloneRead === true
    && value.protectedCloneSchemaMigration === true
    && value.protectedCloneBackfill === true
    && value.providerPromotionRehearsal === true
    && value.rollbackRehearsal === true
    && Object.entries(value)
      .filter(([key]) => ![
        'protectedCloneRead', 'protectedCloneSchemaMigration', 'protectedCloneBackfill',
        'providerPromotionRehearsal', 'rollbackRehearsal',
      ].includes(key))
      .every(([, permission]) => permission === false);
}

function acceptanceMatches(value: ProtectedCloneRehearsalAuthorization['acceptance']): boolean {
  return value.integrityCheck === 'ok'
    && Object.entries(value)
      .filter(([key]) => key !== 'integrityCheck')
      .every(([, amount]) => amount === 0);
}

function procedureMatches(value: ProtectedCloneRehearsalAuthorization['procedure']): boolean {
  return Object.values(value).every((enabled) => enabled === true);
}

function validateAuthorization(
  authorization: ProtectedCloneRehearsalAuthorization,
  repositoryRoot: string,
  nowUtc: string,
): ProtectedCloneRehearsalAuthorizationIssue[] {
  const issues: ProtectedCloneRehearsalAuthorizationIssue[] = [];
  const targetRemoteMatches = authorization.target.platform === 'cloudflare_d1'
    ? authorization.target.remote === true
    : authorization.target.remote === false;
  if (!sha256String(authorization.target.accountIdSha256)
    || !targetRemoteMatches
    || authorization.target.productionDatabaseUuid !== CDB101_PRODUCTION_DATABASE_ID
    || authorization.target.databaseUuid === CDB101_PRODUCTION_DATABASE_ID
    || authorization.target.databaseName === CDB101_PRODUCTION_DATABASE_NAME) {
    issues.push(issue('CDBV1050_AUTHORIZATION_TARGET_INVALID', 'target'));
  }

  const expectedRepository = buildProtectedCloneRepositoryBinding(repositoryRoot);
  if (expectedRepository.branch !== CDB_V1_050_BRANCH
    || !repositoryBindingMatches(authorization.repository, expectedRepository)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_BINDING_INVALID', 'binding'));
  }

  if (!validateScope(authorization.scope)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_SCOPE_INVALID', 'scope'));
  }
  if (!validateMigrations(authorization.migrations, repositoryRoot)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_MIGRATION_INVALID', 'binding'));
  }
  if (!validateBackfills(authorization.backfills, repositoryRoot)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_BACKFILL_INVALID', 'binding'));
  }
  if (!permissionsMatch(authorization.permissions)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_PERMISSION_INVALID', 'authorization'));
  }
  if (authorization.owner.ownerId !== 'rahmatullah-zisan'
    || authorization.owner.displayName !== 'Rahmatullah Zisan'
    || authorization.owner.approved !== true
    || authorization.owner.approvalSource !== 'user_explicit_protected_clone_rehearsal_authorization'
    || !nonEmptyString(authorization.owner.executionOwnerId)
    || !nonEmptyString(authorization.owner.rollbackOwnerId)
    || !nonEmptyString(authorization.owner.observationOwnerId)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_OWNER_INVALID', 'authorization'));
  }
  const snapshotExportedAt = parseUtc(authorization.sourceSnapshot.exportedAtUtc);
  const authorizationIssuedAt = parseUtc(authorization.timing.issuedAtUtc);
  if (!sha256String(authorization.sourceSnapshot.sha256)
    || snapshotExportedAt == null
    || authorizationIssuedAt == null
    || snapshotExportedAt > authorizationIssuedAt
    || authorization.sourceSnapshot.readOnly !== true
    || authorization.sourceSnapshot.productionSourceMutationAllowed !== false) {
    issues.push(issue('CDBV1050_AUTHORIZATION_BINDING_INVALID', 'binding'));
  }
  if (!sha256String(authorization.rollback.backupSha256)
    || authorization.rollback.restoreAuthorityConfirmed !== true
    || authorization.rollback.restoreOnAnyFailure !== true
    || authorization.rollback.stopOnFirstFailure !== true
    || authorization.rollback.rollbackProvider !== 'legacy') {
    issues.push(issue('CDBV1050_AUTHORIZATION_ROLLBACK_INVALID', 'authorization'));
  }
  if (!acceptanceMatches(authorization.acceptance)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_ACCEPTANCE_INVALID', 'authorization'));
  }
  if (!procedureMatches(authorization.procedure)) {
    issues.push(issue('CDBV1050_AUTHORIZATION_PROCEDURE_INVALID', 'authorization'));
  }
  const timing = validateTiming(authorization.timing, nowUtc);
  if (timing === 'expired') issues.push(issue('CDBV1050_AUTHORIZATION_EXPIRED', 'timing'));
  else if (timing === 'invalid') issues.push(issue('CDBV1050_AUTHORIZATION_TIMING_INVALID', 'timing'));
  return issues;
}

export function parseProtectedCloneRehearsalAuthorizationJson(
  text: string,
  repositoryRoot: string,
  nowUtc: string,
): ProtectedCloneRehearsalAuthorizationResult {
  const strict = parseStrictJsonDocument(text, DOCUMENT_OPTIONS);
  if (!strict.ready) {
    return {
      documentReady: false,
      executionReady: false,
      issues: strict.issues.map((entry) => mapProtectedIssue(entry.code)),
      authorization: null,
    };
  }
  if (containsNormalizedKey(strict.value, SENSITIVE_KEYS)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDBV1050_AUTHORIZATION_SENSITIVE_FIELD', 'document')],
      authorization: null,
    };
  }
  if (findUnknownField(strict.value)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDBV1050_AUTHORIZATION_UNKNOWN_FIELD', 'document')],
      authorization: null,
    };
  }
  if (!validateSchema(strict.value)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDBV1050_AUTHORIZATION_SCHEMA_INVALID', 'document')],
      authorization: null,
    };
  }
  const issues = validateAuthorization(strict.value, repositoryRoot, nowUtc);
  return {
    documentReady: true,
    executionReady: issues.length === 0,
    issues,
    authorization: strict.value,
  };
}

export function loadProtectedCloneRehearsalAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  nowUtc: string,
): ProtectedCloneRehearsalAuthorizationResult {
  if (isInsideRepository(repositoryRoot, authorizationPath)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDBV1050_AUTHORIZATION_FILE_INSIDE_REPOSITORY', 'file')],
      authorization: null,
    };
  }
  const loaded = loadProtectedJsonDocument(authorizationPath, repositoryRoot, DOCUMENT_OPTIONS);
  if (!loaded.ready) {
    return {
      documentReady: false,
      executionReady: false,
      issues: loaded.issues.map((entry) => mapProtectedIssue(entry.code)),
      authorization: null,
    };
  }
  return parseProtectedCloneRehearsalAuthorizationJson(JSON.stringify(loaded.value), repositoryRoot, nowUtc);
}

export function evaluateProtectedCloneRehearsalAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  nowUtc: string,
): ProtectedCloneRehearsalAuthorizationReceipt {
  const result = loadProtectedCloneRehearsalAuthorization(authorizationPath, repositoryRoot, nowUtc);
  return {
    schemaVersion: 1,
    documentReady: result.documentReady,
    executionReady: result.executionReady,
    issueCount: result.issues.length,
    tenantCount: result.authorization?.scope.tenantIds.length ?? 0,
    recordCount: result.authorization?.scope.records.length ?? 0,
    migrationCount: result.authorization?.migrations.length ?? 0,
    backfillCount: result.authorization?.backfills.length ?? 0,
    aggregateOnly: true,
    networkRequestPerformed: false,
    protectedCloneMutationPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}

export function buildProtectedCloneRehearsalPlan(
  result: ProtectedCloneRehearsalAuthorizationResult,
): ProtectedCloneRehearsalPlan {
  if (!result.executionReady || !result.authorization) {
    throw new Error('CDB-V1-050 authorization is not execution-ready');
  }
  const authorization = result.authorization;
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL',
    authorizationId: authorization.authorizationId,
    targetPlatform: authorization.target.platform,
    targetDatabaseUuid: authorization.target.databaseUuid,
    repositoryCommit: authorization.repository.repositoryCommit,
    buildSha: authorization.repository.buildSha,
    sourceSnapshotSha256: authorization.sourceSnapshot.sha256,
    tenantCount: authorization.scope.tenantIds.length,
    recordCount: authorization.scope.records.length,
    migrationCount: authorization.migrations.length,
    backfillCount: authorization.backfills.length,
    phases: [
      'verify exact target, snapshot, backup, repository and authorization window',
      'apply exact authorized migrations serially to the protected clone',
      'run exact bounded backfill partitions',
      'run mandatory zero-new-business-row second pass',
      'verify tenant isolation, mappings, foreign keys, integrity and financial minor-unit equations',
      'run Reception, billing, payment and commission smoke workflows',
      'rehearse Canonical provider selection and immediate legacy rollback',
      'prove source snapshot unchanged and emit sanitized aggregate receipt',
    ],
    abortConditions: [
      'target, snapshot, backup, repository commit or build binding mismatch',
      'authorization window invalid or expired',
      'missing or ambiguous source mapping',
      'cross-tenant reference or foreign-key violation',
      'integrity failure or source snapshot mutation',
      'provider error, latency breach or unexplained variance',
      'second pass creates any new business row',
      'legacy rollback cannot be completed immediately',
    ],
    finalProvider: 'legacy',
    networkRequestPerformed: false,
    protectedCloneMutationPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
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

export interface ProductionSchemaMigrationBinding {
  name: string;
  sha256: string;
}

export interface ProductionSchemaReceiptBindings {
  h1Path: string;
  h1Sha256: string;
  h2Path: string;
  h2Sha256: string;
  h2APath: string;
  h2ASha256: string;
}

export interface IdentityEpisodeProductionSchemaAuthorizationBindings {
  migrations: ProductionSchemaMigrationBinding[];
  receipts: ProductionSchemaReceiptBindings;
}

export interface IdentityEpisodeProductionSchemaAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'production_schema_migrations_only';
  database: {
    name: string;
    uuid: string;
    environment: 'production';
    remote: true;
  };
  timing: {
    issuedAtUtc: string;
    maintenanceStartUtc: string;
    maintenanceEndUtc: string;
    expiresAtUtc: string;
  };
  owner: {
    ownerId: string;
    displayName: string;
    approved: boolean;
    approvalSource: string;
  };
  rollback: {
    ownerId: string;
    restoreAuthorityConfirmed: boolean;
    protectedExportSha256: string;
    timeTravelEvidenceSha256: string;
    restoreOnAnyFailure: boolean;
    stopOnFirstFailure: boolean;
  };
  bindings: IdentityEpisodeProductionSchemaAuthorizationBindings;
  acceptance: {
    migrationLedgerBefore: number;
    migrationLedgerAfter: number;
    requiredAuthorityTablesAfter: number;
    encounterRowsBefore: number;
    encounterRowsAfter: number;
    bedStayRowsBefore: number;
    bedStayRowsAfter: number;
    activeForeignKeyViolations: number;
    integrityCheck: 'ok';
    migrationFailureTolerance: number;
  };
  procedure: {
    migrationOrder: string[];
    bookmarkBeforeFirstMigration: boolean;
    backupBeforeFirstMigration: boolean;
    serialApply: boolean;
    noConcurrentDeployment: boolean;
    postMigrationReadOnlyVerification: boolean;
  };
  permissions: {
    schemaMigration: boolean;
    productionBackfill: boolean;
    providerFlagChange: boolean;
    routeChange: boolean;
    trafficChange: boolean;
    deployment: boolean;
    receptionCutover: boolean;
    dataMutationOutsideMigration: boolean;
    localSyncActivation: boolean;
    legacyReaderRetirement: boolean;
    legacyWriterRetirement: boolean;
    remoteDatabaseDeletion: boolean;
    push: boolean;
    cdbToMainIntegration: boolean;
  };
}

export type IdentityEpisodeProductionSchemaAuthorizationIssueCode =
  | 'CDB113H3_AUTHORIZATION_INVALID_JSON'
  | 'CDB113H3_AUTHORIZATION_DUPLICATE_KEY'
  | 'CDB113H3_AUTHORIZATION_UNSAFE_KEY'
  | 'CDB113H3_AUTHORIZATION_TOO_LARGE'
  | 'CDB113H3_AUTHORIZATION_TOO_DEEP'
  | 'CDB113H3_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDB113H3_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDB113H3_AUTHORIZATION_FILE_PROTECTION_INVALID'
  | 'CDB113H3_AUTHORIZATION_UNKNOWN_FIELD'
  | 'CDB113H3_AUTHORIZATION_SENSITIVE_FIELD'
  | 'CDB113H3_AUTHORIZATION_SCHEMA_INVALID'
  | 'CDB113H3_AUTHORIZATION_SCOPE_INVALID'
  | 'CDB113H3_AUTHORIZATION_BINDING_INVALID'
  | 'CDB113H3_AUTHORIZATION_PERMISSION_INVALID'
  | 'CDB113H3_AUTHORIZATION_TIMING_INVALID'
  | 'CDB113H3_AUTHORIZATION_EXPIRED'
  | 'CDB113H3_AUTHORIZATION_OWNER_INVALID'
  | 'CDB113H3_AUTHORIZATION_ROLLBACK_INVALID'
  | 'CDB113H3_AUTHORIZATION_ACCEPTANCE_INVALID'
  | 'CDB113H3_AUTHORIZATION_PROCEDURE_INVALID';

export interface IdentityEpisodeProductionSchemaAuthorizationIssue {
  code: IdentityEpisodeProductionSchemaAuthorizationIssueCode;
  gate: 'document' | 'file' | 'scope' | 'binding' | 'timing' | 'authorization';
}

export interface IdentityEpisodeProductionSchemaAuthorizationResult {
  documentReady: boolean;
  executionReady: boolean;
  issues: IdentityEpisodeProductionSchemaAuthorizationIssue[];
  authorization: IdentityEpisodeProductionSchemaAuthorization | null;
}

export interface IdentityEpisodeProductionSchemaAuthorizationReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  executionReady: boolean;
  migrationCount: number;
  issueCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export const IDENTITY_EPISODE_PRODUCTION_SCHEMA_MIGRATIONS = [
  '0541_canonical_local_sync_protocol.sql',
  '0542_canonical_sync_inbox_lifecycle.sql',
  '0543_canonical_sync_outbox_lifecycle.sql',
  '0544_canonical_tenant_patient_links.sql',
  '0545_canonical_practitioner_operational_adoption.sql',
  '0546_canonical_appointment_authority.sql',
  '0547_patient_merge_map_hardening.sql',
  '0548_canonical_encounter_admission_bed_convergence.sql',
  '0549_approval_revision_policy.sql',
  '0550_canonical_credit_note_cash_refund_reversals.sql',
] as const;

const RECEIPT_PATHS = {
  h1Path: 'docs/database/migration-runs/production/CDB-113H1-protected-local-clone-migration-rehearsal.md',
  h2Path: 'docs/database/migration-runs/production/CDB-113H2-protected-clone-backfill-reconciliation.md',
  h2APath: 'docs/database/migration-runs/production/CDB-113H2A-main-sync-h2-evidence-revalidation.md',
} as const;

const ROOT_KEYS = new Set([
  'schemaVersion',
  'authorizationId',
  'operation',
  'database',
  'timing',
  'owner',
  'rollback',
  'bindings',
  'acceptance',
  'procedure',
  'permissions',
]);
const DATABASE_KEYS = new Set(['name', 'uuid', 'environment', 'remote']);
const TIMING_KEYS = new Set(['issuedAtUtc', 'maintenanceStartUtc', 'maintenanceEndUtc', 'expiresAtUtc']);
const OWNER_KEYS = new Set(['ownerId', 'displayName', 'approved', 'approvalSource']);
const ROLLBACK_KEYS = new Set([
  'ownerId',
  'restoreAuthorityConfirmed',
  'protectedExportSha256',
  'timeTravelEvidenceSha256',
  'restoreOnAnyFailure',
  'stopOnFirstFailure',
]);
const BINDING_KEYS = new Set(['migrations', 'receipts']);
const MIGRATION_KEYS = new Set(['name', 'sha256']);
const RECEIPT_KEYS = new Set(['h1Path', 'h1Sha256', 'h2Path', 'h2Sha256', 'h2APath', 'h2ASha256']);
const ACCEPTANCE_KEYS = new Set([
  'migrationLedgerBefore',
  'migrationLedgerAfter',
  'requiredAuthorityTablesAfter',
  'encounterRowsBefore',
  'encounterRowsAfter',
  'bedStayRowsBefore',
  'bedStayRowsAfter',
  'activeForeignKeyViolations',
  'integrityCheck',
  'migrationFailureTolerance',
]);
const PROCEDURE_KEYS = new Set([
  'migrationOrder',
  'bookmarkBeforeFirstMigration',
  'backupBeforeFirstMigration',
  'serialApply',
  'noConcurrentDeployment',
  'postMigrationReadOnlyVerification',
]);
const PERMISSION_KEYS = new Set([
  'schemaMigration',
  'productionBackfill',
  'providerFlagChange',
  'routeChange',
  'trafficChange',
  'deployment',
  'receptionCutover',
  'dataMutationOutsideMigration',
  'localSyncActivation',
  'legacyReaderRetirement',
  'legacyWriterRetirement',
  'remoteDatabaseDeletion',
  'push',
  'cdbToMainIntegration',
]);
const SENSITIVE_KEYS = new Set([
  'header',
  'headers',
  'authorization',
  'cookie',
  'cookies',
  'token',
  'password',
  'secret',
  'credential',
  'credentials',
  'rawoutput',
  'sql',
  'command',
  'environmentvariable',
  'exportpath',
  'bookmarkid',
]);
const DOCUMENT_OPTIONS = { maxBytes: 128 * 1024, maxDepth: 14 } as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(repositoryRoot: string, relativePath: string): string {
  return sha256(readFileSync(resolve(repositoryRoot, relativePath)));
}

export function buildIdentityEpisodeProductionSchemaAuthorizationBindings(
  repositoryRoot: string,
): IdentityEpisodeProductionSchemaAuthorizationBindings {
  const migrations = IDENTITY_EPISODE_PRODUCTION_SCHEMA_MIGRATIONS.map((name) => ({
    name,
    sha256: fileSha256(repositoryRoot, `migrations/${name}`),
  }));
  return {
    migrations,
    receipts: {
      h1Path: RECEIPT_PATHS.h1Path,
      h1Sha256: fileSha256(repositoryRoot, RECEIPT_PATHS.h1Path),
      h2Path: RECEIPT_PATHS.h2Path,
      h2Sha256: fileSha256(repositoryRoot, RECEIPT_PATHS.h2Path),
      h2APath: RECEIPT_PATHS.h2APath,
      h2ASha256: fileSha256(repositoryRoot, RECEIPT_PATHS.h2APath),
    },
  };
}

function issue(
  code: IdentityEpisodeProductionSchemaAuthorizationIssueCode,
  gate: IdentityEpisodeProductionSchemaAuthorizationIssue['gate'],
): IdentityEpisodeProductionSchemaAuthorizationIssue {
  return { code, gate };
}

function mapProtectedIssue(code: ProtectedJsonDocumentIssueCode): IdentityEpisodeProductionSchemaAuthorizationIssue {
  const mapped: Record<ProtectedJsonDocumentIssueCode, IdentityEpisodeProductionSchemaAuthorizationIssueCode> = {
    INVALID_JSON: 'CDB113H3_AUTHORIZATION_INVALID_JSON',
    DUPLICATE_KEY: 'CDB113H3_AUTHORIZATION_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB113H3_AUTHORIZATION_UNSAFE_KEY',
    TOO_LARGE: 'CDB113H3_AUTHORIZATION_TOO_LARGE',
    TOO_DEEP: 'CDB113H3_AUTHORIZATION_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB113H3_AUTHORIZATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB113H3_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB113H3_AUTHORIZATION_FILE_PROTECTION_INVALID',
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

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function findUnknownField(value: unknown): boolean {
  if (!hasExactKeys(value, ROOT_KEYS)) return hasUnknownKeys(value, ROOT_KEYS);
  if (hasUnknownKeys(value.database, DATABASE_KEYS)) return true;
  if (hasUnknownKeys(value.timing, TIMING_KEYS)) return true;
  if (hasUnknownKeys(value.owner, OWNER_KEYS)) return true;
  if (hasUnknownKeys(value.rollback, ROLLBACK_KEYS)) return true;
  if (hasUnknownKeys(value.bindings, BINDING_KEYS)) return true;
  if (isPlainRecord(value.bindings)) {
    if (Array.isArray(value.bindings.migrations)
      && value.bindings.migrations.some((entry) => hasUnknownKeys(entry, MIGRATION_KEYS))) return true;
    if (hasUnknownKeys(value.bindings.receipts, RECEIPT_KEYS)) return true;
  }
  if (hasUnknownKeys(value.acceptance, ACCEPTANCE_KEYS)) return true;
  if (hasUnknownKeys(value.procedure, PROCEDURE_KEYS)) return true;
  if (hasUnknownKeys(value.permissions, PERMISSION_KEYS)) return true;
  return false;
}

function validateSchema(value: unknown): value is IdentityEpisodeProductionSchemaAuthorization {
  if (!hasExactKeys(value, ROOT_KEYS)) return false;
  if (!hasExactKeys(value.database, DATABASE_KEYS)) return false;
  if (!hasExactKeys(value.timing, TIMING_KEYS)) return false;
  if (!hasExactKeys(value.owner, OWNER_KEYS)) return false;
  if (!hasExactKeys(value.rollback, ROLLBACK_KEYS)) return false;
  if (!hasExactKeys(value.bindings, BINDING_KEYS)) return false;
  if (!Array.isArray(value.bindings.migrations)
    || value.bindings.migrations.some((entry) => !hasExactKeys(entry, MIGRATION_KEYS))) return false;
  if (!hasExactKeys(value.bindings.receipts, RECEIPT_KEYS)) return false;
  if (!hasExactKeys(value.acceptance, ACCEPTANCE_KEYS)) return false;
  if (!hasExactKeys(value.procedure, PROCEDURE_KEYS)) return false;
  if (!hasExactKeys(value.permissions, PERMISSION_KEYS)) return false;

  return value.schemaVersion === 1
    && nonEmptyString(value.authorizationId)
    && value.operation === 'production_schema_migrations_only'
    && nonEmptyString(value.database.name)
    && nonEmptyString(value.database.uuid)
    && value.database.environment === 'production'
    && value.database.remote === true
    && Object.values(value.timing).every(nonEmptyString)
    && nonEmptyString(value.owner.ownerId)
    && nonEmptyString(value.owner.displayName)
    && typeof value.owner.approved === 'boolean'
    && nonEmptyString(value.owner.approvalSource)
    && nonEmptyString(value.rollback.ownerId)
    && typeof value.rollback.restoreAuthorityConfirmed === 'boolean'
    && nonEmptyString(value.rollback.protectedExportSha256)
    && nonEmptyString(value.rollback.timeTravelEvidenceSha256)
    && typeof value.rollback.restoreOnAnyFailure === 'boolean'
    && typeof value.rollback.stopOnFirstFailure === 'boolean'
    && value.bindings.migrations.every((entry) => nonEmptyString(entry.name) && nonEmptyString(entry.sha256))
    && Object.values(value.bindings.receipts).every(nonEmptyString)
    && Object.values(value.acceptance).every((entry) => typeof entry === 'number' || typeof entry === 'string')
    && Array.isArray(value.procedure.migrationOrder)
    && value.procedure.migrationOrder.every(nonEmptyString)
    && Object.entries(value.procedure)
      .filter(([key]) => key !== 'migrationOrder')
      .every(([, entry]) => typeof entry === 'boolean')
    && Object.values(value.permissions).every((entry) => typeof entry === 'boolean');
}

function bindingsMatch(
  actual: IdentityEpisodeProductionSchemaAuthorizationBindings,
  expected: IdentityEpisodeProductionSchemaAuthorizationBindings,
): boolean {
  if (actual.migrations.length !== expected.migrations.length) return false;
  for (let index = 0; index < expected.migrations.length; index += 1) {
    if (actual.migrations[index].name !== expected.migrations[index].name
      || actual.migrations[index].sha256 !== expected.migrations[index].sha256) return false;
  }
  return actual.receipts.h1Path === expected.receipts.h1Path
    && actual.receipts.h1Sha256 === expected.receipts.h1Sha256
    && actual.receipts.h2Path === expected.receipts.h2Path
    && actual.receipts.h2Sha256 === expected.receipts.h2Sha256
    && actual.receipts.h2APath === expected.receipts.h2APath
    && actual.receipts.h2ASha256 === expected.receipts.h2ASha256;
}

function validateTiming(
  timing: IdentityEpisodeProductionSchemaAuthorization['timing'],
  nowUtc: string,
): 'valid' | 'invalid' | 'expired' {
  const issued = parseUtc(timing.issuedAtUtc);
  const start = parseUtc(timing.maintenanceStartUtc);
  const end = parseUtc(timing.maintenanceEndUtc);
  const expires = parseUtc(timing.expiresAtUtc);
  const now = parseUtc(nowUtc);
  if (issued == null || start == null || end == null || expires == null || now == null) return 'invalid';
  if (issued > start || start >= end || end > expires) return 'invalid';
  if (end - start > 2 * 60 * 60 * 1000 || expires - end !== 30 * 60 * 1000) return 'invalid';
  if (now > expires) return 'expired';
  if (now < start || now > end) return 'invalid';
  return 'valid';
}

function acceptanceMatches(value: IdentityEpisodeProductionSchemaAuthorization['acceptance']): boolean {
  return value.migrationLedgerBefore === 487
    && value.migrationLedgerAfter === 497
    && value.requiredAuthorityTablesAfter === 4
    && value.encounterRowsBefore === 234
    && value.encounterRowsAfter === 234
    && value.bedStayRowsBefore === 28
    && value.bedStayRowsAfter === 28
    && value.activeForeignKeyViolations === 0
    && value.integrityCheck === 'ok'
    && value.migrationFailureTolerance === 0;
}

function procedureMatches(value: IdentityEpisodeProductionSchemaAuthorization['procedure']): boolean {
  return value.migrationOrder.length === IDENTITY_EPISODE_PRODUCTION_SCHEMA_MIGRATIONS.length
    && value.migrationOrder.every((name, index) => name === IDENTITY_EPISODE_PRODUCTION_SCHEMA_MIGRATIONS[index])
    && value.bookmarkBeforeFirstMigration === true
    && value.backupBeforeFirstMigration === true
    && value.serialApply === true
    && value.noConcurrentDeployment === true
    && value.postMigrationReadOnlyVerification === true;
}

function permissionsMatch(value: IdentityEpisodeProductionSchemaAuthorization['permissions']): boolean {
  return value.schemaMigration === true
    && Object.entries(value)
      .filter(([key]) => key !== 'schemaMigration')
      .every(([, permission]) => permission === false);
}

function validateAuthorization(
  authorization: IdentityEpisodeProductionSchemaAuthorization,
  repositoryRoot: string,
  nowUtc: string,
): IdentityEpisodeProductionSchemaAuthorizationIssue[] {
  const issues: IdentityEpisodeProductionSchemaAuthorizationIssue[] = [];
  if (authorization.database.name !== CDB101_PRODUCTION_DATABASE_NAME
    || authorization.database.uuid !== CDB101_PRODUCTION_DATABASE_ID
    || authorization.database.environment !== 'production'
    || authorization.database.remote !== true) {
    issues.push(issue('CDB113H3_AUTHORIZATION_SCOPE_INVALID', 'scope'));
  }

  const expectedBindings = buildIdentityEpisodeProductionSchemaAuthorizationBindings(repositoryRoot);
  if (!bindingsMatch(authorization.bindings, expectedBindings)) {
    issues.push(issue('CDB113H3_AUTHORIZATION_BINDING_INVALID', 'binding'));
  }

  if (!permissionsMatch(authorization.permissions)) {
    issues.push(issue('CDB113H3_AUTHORIZATION_PERMISSION_INVALID', 'authorization'));
  }

  if (authorization.owner.ownerId !== 'rahmatullah-zisan'
    || authorization.owner.displayName !== 'Rahmatullah Zisan'
    || authorization.owner.approved !== true
    || authorization.owner.approvalSource !== 'user_explicit_production_schema_migration_authorization') {
    issues.push(issue('CDB113H3_AUTHORIZATION_OWNER_INVALID', 'authorization'));
  }

  if (authorization.rollback.ownerId !== 'rahmatullah-zisan'
    || authorization.rollback.restoreAuthorityConfirmed !== true
    || !sha256String(authorization.rollback.protectedExportSha256)
    || !sha256String(authorization.rollback.timeTravelEvidenceSha256)
    || authorization.rollback.restoreOnAnyFailure !== true
    || authorization.rollback.stopOnFirstFailure !== true) {
    issues.push(issue('CDB113H3_AUTHORIZATION_ROLLBACK_INVALID', 'authorization'));
  }

  if (!acceptanceMatches(authorization.acceptance)) {
    issues.push(issue('CDB113H3_AUTHORIZATION_ACCEPTANCE_INVALID', 'authorization'));
  }

  if (!procedureMatches(authorization.procedure)) {
    issues.push(issue('CDB113H3_AUTHORIZATION_PROCEDURE_INVALID', 'authorization'));
  }

  const timing = validateTiming(authorization.timing, nowUtc);
  if (timing === 'expired') issues.push(issue('CDB113H3_AUTHORIZATION_EXPIRED', 'timing'));
  else if (timing === 'invalid') issues.push(issue('CDB113H3_AUTHORIZATION_TIMING_INVALID', 'timing'));

  return issues;
}

function isInsideRepository(repositoryRoot: string, candidatePath: string): boolean {
  const repository = resolve(repositoryRoot);
  const candidate = resolve(candidatePath);
  const relation = relative(repository, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

export function parseIdentityEpisodeProductionSchemaAuthorizationJson(
  text: string,
  repositoryRoot: string,
  nowUtc: string,
): IdentityEpisodeProductionSchemaAuthorizationResult {
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
      issues: [issue('CDB113H3_AUTHORIZATION_SENSITIVE_FIELD', 'document')],
      authorization: null,
    };
  }

  if (findUnknownField(strict.value)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDB113H3_AUTHORIZATION_UNKNOWN_FIELD', 'document')],
      authorization: null,
    };
  }

  if (!validateSchema(strict.value)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDB113H3_AUTHORIZATION_SCHEMA_INVALID', 'document')],
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

export function loadIdentityEpisodeProductionSchemaAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  nowUtc: string,
): IdentityEpisodeProductionSchemaAuthorizationResult {
  if (isInsideRepository(repositoryRoot, authorizationPath)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDB113H3_AUTHORIZATION_FILE_INSIDE_REPOSITORY', 'file')],
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
  return parseIdentityEpisodeProductionSchemaAuthorizationJson(
    JSON.stringify(loaded.value),
    repositoryRoot,
    nowUtc,
  );
}

export function evaluateIdentityEpisodeProductionSchemaAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  nowUtc: string,
): IdentityEpisodeProductionSchemaAuthorizationReceipt {
  const result = loadIdentityEpisodeProductionSchemaAuthorization(
    authorizationPath,
    repositoryRoot,
    nowUtc,
  );
  return {
    schemaVersion: 1,
    documentReady: result.documentReady,
    executionReady: result.executionReady,
    migrationCount: result.authorization?.bindings.migrations.length ?? 0,
    issueCount: result.issues.length,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
  };
}

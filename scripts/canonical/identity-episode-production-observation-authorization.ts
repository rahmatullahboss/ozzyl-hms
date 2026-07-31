import { relative, resolve, sep } from 'node:path';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssueCode,
} from './protected-json-document';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export type IdentityEpisodeObservationProvider =
  | 'patient_identity'
  | 'practitioner'
  | 'appointment'
  | 'encounter'
  | 'admission_bed';

export interface IdentityEpisodeObservationProviderScope {
  provider: IdentityEpisodeObservationProvider;
  consumerId: string;
  flagKey: string;
}

export interface IdentityEpisodeObservationAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'read_only_controlled_probe';
  database: {
    name: string;
    uuid: string;
    environment: 'production';
    remote: true;
  };
  tenantId: '100';
  providers: IdentityEpisodeObservationProviderScope[];
  timing: {
    issuedAtUtc: string;
    observationStartUtc: string;
    observationEndUtc: string;
    expiresAtUtc: string;
  };
  thresholds: {
    measuredIterations: number;
    p95DurationMs: number;
    maxDurationMs: number;
    acceptedExceptionIds: string[];
  };
  commits: {
    implementation: string;
    metadata: string;
    mainSync: string;
    design: string;
  };
  owner: {
    ownerId: string;
    displayName: string;
    approved: boolean;
    approvalSource: string;
  };
  permissions: {
    providerFlagChange: boolean;
    routeChange: boolean;
    trafficChange: boolean;
    deployment: boolean;
    migration: boolean;
    backfill: boolean;
    dataMutation: boolean;
    localSyncActivation: boolean;
    legacyReaderRetirement: boolean;
    legacyWriterRetirement: boolean;
    push: boolean;
    cdbToMainIntegration: boolean;
    canonicalPromotion: boolean;
  };
}

export type IdentityEpisodeObservationAuthorizationIssueCode =
  | 'CDB113G_AUTHORIZATION_INVALID_JSON'
  | 'CDB113G_AUTHORIZATION_DUPLICATE_KEY'
  | 'CDB113G_AUTHORIZATION_UNSAFE_KEY'
  | 'CDB113G_AUTHORIZATION_TOO_LARGE'
  | 'CDB113G_AUTHORIZATION_TOO_DEEP'
  | 'CDB113G_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDB113G_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDB113G_AUTHORIZATION_FILE_PROTECTION_INVALID'
  | 'CDB113G_AUTHORIZATION_UNKNOWN_FIELD'
  | 'CDB113G_AUTHORIZATION_SENSITIVE_FIELD'
  | 'CDB113G_AUTHORIZATION_SCHEMA_INVALID'
  | 'CDB113G_AUTHORIZATION_SCOPE_INVALID'
  | 'CDB113G_AUTHORIZATION_PERMISSION_INVALID'
  | 'CDB113G_AUTHORIZATION_TIMING_INVALID'
  | 'CDB113G_AUTHORIZATION_EXPIRED'
  | 'CDB113G_AUTHORIZATION_COMMIT_INVALID'
  | 'CDB113G_AUTHORIZATION_THRESHOLD_INVALID'
  | 'CDB113G_AUTHORIZATION_OWNER_INVALID';

export interface IdentityEpisodeObservationAuthorizationIssue {
  code: IdentityEpisodeObservationAuthorizationIssueCode;
  gate: 'document' | 'file' | 'scope' | 'timing' | 'authorization';
}

export interface IdentityEpisodeObservationAuthorizationResult {
  documentReady: boolean;
  executionReady: boolean;
  issues: IdentityEpisodeObservationAuthorizationIssue[];
  authorization: IdentityEpisodeObservationAuthorization | null;
}

export interface IdentityEpisodeObservationAuthorizationReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  executionReady: boolean;
  providerCount: number;
  issueCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export const IDENTITY_EPISODE_OBSERVATION_PROVIDERS: IdentityEpisodeObservationProviderScope[] = [
  {
    provider: 'patient_identity',
    consumerId: 'cdb113f_patient_detail',
    flagKey: 'canonical_patient_identity_provider_v1',
  },
  {
    provider: 'practitioner',
    consumerId: 'cdb113f_practitioner_detail',
    flagKey: 'canonical_practitioner_provider_v1',
  },
  {
    provider: 'appointment',
    consumerId: 'cdb113f_appointment_detail',
    flagKey: 'canonical_appointment_provider_v1',
  },
  {
    provider: 'encounter',
    consumerId: 'cdb113f_encounter_detail',
    flagKey: 'canonical_encounter_provider_v1',
  },
  {
    provider: 'admission_bed',
    consumerId: 'cdb113f_admission_detail',
    flagKey: 'canonical_admission_bed_provider_v1',
  },
];

const EXPECTED_COMMITS = {
  implementation: '561a34a1b',
  metadata: '3427268c8',
  mainSync: 'f4004195a',
  design: '89cbc4ad3',
} as const;

const ROOT_KEYS = new Set([
  'schemaVersion',
  'authorizationId',
  'operation',
  'database',
  'tenantId',
  'providers',
  'timing',
  'thresholds',
  'commits',
  'owner',
  'permissions',
]);
const DATABASE_KEYS = new Set(['name', 'uuid', 'environment', 'remote']);
const PROVIDER_KEYS = new Set(['provider', 'consumerId', 'flagKey']);
const TIMING_KEYS = new Set(['issuedAtUtc', 'observationStartUtc', 'observationEndUtc', 'expiresAtUtc']);
const THRESHOLD_KEYS = new Set(['measuredIterations', 'p95DurationMs', 'maxDurationMs', 'acceptedExceptionIds']);
const COMMIT_KEYS = new Set(['implementation', 'metadata', 'mainSync', 'design']);
const OWNER_KEYS = new Set(['ownerId', 'displayName', 'approved', 'approvalSource']);
const PERMISSION_KEYS = new Set([
  'providerFlagChange',
  'routeChange',
  'trafficChange',
  'deployment',
  'migration',
  'backfill',
  'dataMutation',
  'localSyncActivation',
  'legacyReaderRetirement',
  'legacyWriterRetirement',
  'push',
  'cdbToMainIntegration',
  'canonicalPromotion',
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
]);

const DOCUMENT_OPTIONS = { maxBytes: 64 * 1024, maxDepth: 12 } as const;

function issue(
  code: IdentityEpisodeObservationAuthorizationIssueCode,
  gate: IdentityEpisodeObservationAuthorizationIssue['gate'],
): IdentityEpisodeObservationAuthorizationIssue {
  return { code, gate };
}

function mapProtectedIssue(code: ProtectedJsonDocumentIssueCode): IdentityEpisodeObservationAuthorizationIssue {
  const codes: Record<ProtectedJsonDocumentIssueCode, IdentityEpisodeObservationAuthorizationIssueCode> = {
    INVALID_JSON: 'CDB113G_AUTHORIZATION_INVALID_JSON',
    DUPLICATE_KEY: 'CDB113G_AUTHORIZATION_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB113G_AUTHORIZATION_UNSAFE_KEY',
    TOO_LARGE: 'CDB113G_AUTHORIZATION_TOO_LARGE',
    TOO_DEEP: 'CDB113G_AUTHORIZATION_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB113G_AUTHORIZATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB113G_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB113G_AUTHORIZATION_FILE_PROTECTION_INVALID',
  };
  return issue(codes[code], code.startsWith('FILE_') ? 'file' : 'document');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, expected: ReadonlySet<string>): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function hasUnknownKeys(value: unknown, expected: ReadonlySet<string>): boolean {
  return isPlainRecord(value) && Object.keys(value).some((key) => !expected.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return null;
  return time;
}

function sameProviderScope(value: unknown): value is IdentityEpisodeObservationProviderScope[] {
  if (!Array.isArray(value) || value.length !== IDENTITY_EPISODE_OBSERVATION_PROVIDERS.length) return false;
  return value.every((entry, index) => {
    if (!hasExactKeys(entry, PROVIDER_KEYS)) return false;
    const expected = IDENTITY_EPISODE_OBSERVATION_PROVIDERS[index];
    return entry.provider === expected.provider
      && entry.consumerId === expected.consumerId
      && entry.flagKey === expected.flagKey;
  });
}

function findUnknownField(value: unknown): boolean {
  if (!hasExactKeys(value, ROOT_KEYS)) return hasUnknownKeys(value, ROOT_KEYS);
  const root = value;
  if (hasUnknownKeys(root.database, DATABASE_KEYS)) return true;
  if (Array.isArray(root.providers) && root.providers.some((entry) => hasUnknownKeys(entry, PROVIDER_KEYS))) return true;
  if (hasUnknownKeys(root.timing, TIMING_KEYS)) return true;
  if (hasUnknownKeys(root.thresholds, THRESHOLD_KEYS)) return true;
  if (hasUnknownKeys(root.commits, COMMIT_KEYS)) return true;
  if (hasUnknownKeys(root.owner, OWNER_KEYS)) return true;
  if (hasUnknownKeys(root.permissions, PERMISSION_KEYS)) return true;
  return false;
}

function validateSchema(value: unknown): value is IdentityEpisodeObservationAuthorization {
  if (!hasExactKeys(value, ROOT_KEYS)) return false;
  if (!hasExactKeys(value.database, DATABASE_KEYS)) return false;
  if (!Array.isArray(value.providers) || value.providers.some((entry) => !hasExactKeys(entry, PROVIDER_KEYS))) return false;
  if (!hasExactKeys(value.timing, TIMING_KEYS)) return false;
  if (!hasExactKeys(value.thresholds, THRESHOLD_KEYS)) return false;
  if (!hasExactKeys(value.commits, COMMIT_KEYS)) return false;
  if (!hasExactKeys(value.owner, OWNER_KEYS)) return false;
  if (!hasExactKeys(value.permissions, PERMISSION_KEYS)) return false;

  return value.schemaVersion === 1
    && nonEmptyString(value.authorizationId)
    && value.operation === 'read_only_controlled_probe'
    && nonEmptyString(value.database.name)
    && nonEmptyString(value.database.uuid)
    && value.database.environment === 'production'
    && value.database.remote === true
    && nonEmptyString(value.tenantId)
    && value.providers.every((entry) => (
      nonEmptyString(entry.provider)
      && nonEmptyString(entry.consumerId)
      && nonEmptyString(entry.flagKey)
    ))
    && Object.values(value.timing).every(nonEmptyString)
    && Number.isSafeInteger(value.thresholds.measuredIterations)
    && Number.isSafeInteger(value.thresholds.p95DurationMs)
    && Number.isSafeInteger(value.thresholds.maxDurationMs)
    && Array.isArray(value.thresholds.acceptedExceptionIds)
    && value.thresholds.acceptedExceptionIds.every(nonEmptyString)
    && Object.values(value.commits).every(nonEmptyString)
    && nonEmptyString(value.owner.ownerId)
    && nonEmptyString(value.owner.displayName)
    && typeof value.owner.approved === 'boolean'
    && nonEmptyString(value.owner.approvalSource)
    && Object.values(value.permissions).every((permission) => typeof permission === 'boolean');
}

function validateAuthorization(
  authorization: IdentityEpisodeObservationAuthorization,
  nowUtc: string,
): IdentityEpisodeObservationAuthorizationIssue[] {
  const issues: IdentityEpisodeObservationAuthorizationIssue[] = [];

  if (
    authorization.database.name !== CDB101_PRODUCTION_DATABASE_NAME
    || authorization.database.uuid !== CDB101_PRODUCTION_DATABASE_ID
    || authorization.database.environment !== 'production'
    || authorization.database.remote !== true
    || authorization.tenantId !== CDB101_CANARY_TENANT_ID
    || !sameProviderScope(authorization.providers)
  ) {
    issues.push(issue('CDB113G_AUTHORIZATION_SCOPE_INVALID', 'scope'));
  }

  if (Object.values(authorization.permissions).some(Boolean)) {
    issues.push(issue('CDB113G_AUTHORIZATION_PERMISSION_INVALID', 'authorization'));
  }

  if (
    authorization.thresholds.measuredIterations !== 5
    || authorization.thresholds.p95DurationMs !== 250
    || authorization.thresholds.maxDurationMs !== 500
    || authorization.thresholds.acceptedExceptionIds.length !== 0
  ) {
    issues.push(issue('CDB113G_AUTHORIZATION_THRESHOLD_INVALID', 'authorization'));
  }

  if (Object.entries(EXPECTED_COMMITS).some(([key, value]) => (
    authorization.commits[key as keyof typeof EXPECTED_COMMITS] !== value
  ))) {
    issues.push(issue('CDB113G_AUTHORIZATION_COMMIT_INVALID', 'authorization'));
  }

  if (
    authorization.owner.ownerId !== 'rahmatullah-zisan'
    || authorization.owner.displayName !== 'Rahmatullah Zisan'
    || authorization.owner.approved !== true
    || authorization.owner.approvalSource !== 'user_explicit_production_readonly_observation_authorization'
  ) {
    issues.push(issue('CDB113G_AUTHORIZATION_OWNER_INVALID', 'authorization'));
  }

  const issued = parseUtc(authorization.timing.issuedAtUtc);
  const start = parseUtc(authorization.timing.observationStartUtc);
  const end = parseUtc(authorization.timing.observationEndUtc);
  const expires = parseUtc(authorization.timing.expiresAtUtc);
  const now = parseUtc(nowUtc);
  const exactExpiryOffset = end == null || expires == null ? false : expires - end === 30 * 60 * 1000;
  const boundedWindow = start == null || end == null ? false : end - start > 0 && end - start <= 2 * 60 * 60 * 1000;
  if (
    issued == null || start == null || end == null || expires == null || now == null
    || issued > start || start > end || end > expires
    || !exactExpiryOffset || !boundedWindow
  ) {
    issues.push(issue('CDB113G_AUTHORIZATION_TIMING_INVALID', 'timing'));
  } else if (now > expires) {
    issues.push(issue('CDB113G_AUTHORIZATION_EXPIRED', 'timing'));
  } else if (now < start || now > end) {
    issues.push(issue('CDB113G_AUTHORIZATION_TIMING_INVALID', 'timing'));
  }

  return issues;
}

function isInsideRepository(repositoryRoot: string, candidatePath: string): boolean {
  const repository = resolve(repositoryRoot);
  const candidate = resolve(candidatePath);
  const relation = relative(repository, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

export function parseIdentityEpisodeObservationAuthorizationJson(
  text: string,
  nowUtc: string,
): IdentityEpisodeObservationAuthorizationResult {
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
      issues: [issue('CDB113G_AUTHORIZATION_SENSITIVE_FIELD', 'document')],
      authorization: null,
    };
  }

  if (findUnknownField(strict.value)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDB113G_AUTHORIZATION_UNKNOWN_FIELD', 'document')],
      authorization: null,
    };
  }

  if (!validateSchema(strict.value)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDB113G_AUTHORIZATION_SCHEMA_INVALID', 'document')],
      authorization: null,
    };
  }

  const issues = validateAuthorization(strict.value, nowUtc);
  return {
    documentReady: true,
    executionReady: issues.length === 0,
    issues,
    authorization: strict.value,
  };
}

export function loadIdentityEpisodeObservationAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  nowUtc: string,
): IdentityEpisodeObservationAuthorizationResult {
  if (isInsideRepository(repositoryRoot, authorizationPath)) {
    return {
      documentReady: false,
      executionReady: false,
      issues: [issue('CDB113G_AUTHORIZATION_FILE_INSIDE_REPOSITORY', 'file')],
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
  return parseIdentityEpisodeObservationAuthorizationJson(JSON.stringify(loaded.value), nowUtc);
}

export function evaluateIdentityEpisodeObservationAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  nowUtc: string,
): IdentityEpisodeObservationAuthorizationReceipt {
  const result = loadIdentityEpisodeObservationAuthorization(authorizationPath, repositoryRoot, nowUtc);
  return {
    schemaVersion: 1,
    documentReady: result.documentReady,
    executionReady: result.executionReady,
    providerCount: result.authorization?.providers.length ?? 0,
    issueCount: result.issues.length,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
  };
}

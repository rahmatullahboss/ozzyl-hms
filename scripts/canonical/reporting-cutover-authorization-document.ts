import { z } from 'zod';
import {
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from './production-cutover-contract';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssue,
} from './protected-json-document';

export const MAX_REPORTING_AUTHORIZATION_BYTES = 256 * 1024;
export const MAX_REPORTING_AUTHORIZATION_DEPTH = 64;

export type ReportingAuthorizationDocumentIssueCode =
  | 'CDB101_AUTHORIZATION_DOCUMENT_INVALID_JSON'
  | 'CDB101_AUTHORIZATION_DOCUMENT_DUPLICATE_KEY'
  | 'CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD'
  | 'CDB101_AUTHORIZATION_DOCUMENT_SENSITIVE_FIELD'
  | 'CDB101_AUTHORIZATION_DOCUMENT_UNSAFE_KEY'
  | 'CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID'
  | 'CDB101_AUTHORIZATION_DOCUMENT_TOO_LARGE'
  | 'CDB101_AUTHORIZATION_DOCUMENT_TOO_DEEP'
  | 'CDB101_AUTHORIZATION_FILE_UNAVAILABLE'
  | 'CDB101_AUTHORIZATION_FILE_INSIDE_REPOSITORY'
  | 'CDB101_AUTHORIZATION_FILE_PROTECTION_INVALID';

export interface ReportingAuthorizationDocumentIssue {
  code: ReportingAuthorizationDocumentIssueCode;
  gate: 'document' | 'file';
  severity: 'blocker';
}

export interface ReportingAuthorizationDocumentResult {
  documentReady: boolean;
  authorization: ReportingCutoverAuthorization | null;
  issues: ReportingAuthorizationDocumentIssue[];
}

export interface ReportingAuthorizationAggregateIssue {
  code: string;
  gate: 'document' | 'file' | 'authorization';
  severity: 'blocker';
}

export interface ReportingAuthorizationEvaluationReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: ReportingAuthorizationAggregateIssue[];
  expectedCommandIds: {
    migration: string;
    productionImport: string;
    featureFlag: string;
  } | null;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export interface ReportingAuthorizationValidatorCliOptions {
  authorizationPath: string;
  atUtc?: string;
}

const nullableString = z.string().nullable();
const nullableSafeInteger = z.number().int().refine(Number.isSafeInteger).nullable();
const safeInteger = z.number().int().refine(Number.isSafeInteger);

const ownerSchema = z.object({
  assigned: z.boolean(),
  ownerId: nullableString,
  backupOwnerId: nullableString,
  acknowledgedAtUtc: nullableString,
  communicationChannelId: nullableString,
  decisionAuthority: z.string(),
}).strict();

const fkGroupSchema = z.object({
  childTable: z.string(),
  parentTable: z.string(),
  violationCount: safeInteger,
  remainingViolationCount: safeInteger,
  repairedViolationCount: safeInteger,
  waivedViolationCount: safeInteger,
  disposition: z.string(),
  ownerId: nullableString,
  evidenceId: nullableString,
  removalPhase: nullableString,
}).strict();

const twoPersonRiskAcceptanceSchema = z.object({
  accepted: z.boolean(),
  acceptedByOwnerId: nullableString,
  acceptedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
  noTechnicalBackupAccepted: z.boolean(),
  noMonitoringBackupAccepted: z.boolean(),
  automaticAbortOnTechnicalOperatorUnavailable: z.boolean(),
  automaticAbortOnMonitoringOwnerUnavailable: z.boolean(),
  shadowOnlyAccepted: z.boolean(),
  canonicalPromotionProhibited: z.boolean(),
  workerTrafficChangeProhibited: z.boolean(),
}).strict();

const singleOperatorRiskAcceptanceSchema = z.object({
  accepted: z.boolean(),
  acceptedByOwnerId: nullableString,
  acceptedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
  dualRoleAccepted: z.boolean(),
  independentObservationWaived: z.boolean(),
  noTechnicalBackupAccepted: z.boolean(),
  noMonitoringBackupAccepted: z.boolean(),
  automaticAbortOnOperatorUnavailable: z.boolean(),
  shadowOnlyAccepted: z.boolean(),
  canonicalPromotionProhibited: z.boolean(),
  workerTrafficChangeProhibited: z.boolean(),
  postActivationReconciliationRequired: z.boolean(),
}).strict();

const authorizationSchema = z.object({
  schemaVersion: safeInteger,
  ownerModel: z.enum(['two_person_constrained', 'single_operator_risk_accepted']).optional(),
  twoPersonRiskAcceptance: twoPersonRiskAcceptanceSchema.optional(),
  singleOperatorRiskAcceptance: singleOperatorRiskAcceptanceSchema.optional(),
  authorizationId: nullableString,
  productionExecutionAuthorized: z.boolean(),
  authorizedDomain: nullableString,
  authorizedTenantIds: z.array(z.string()),
  issuedAtUtc: nullableString,
  expiresAtUtc: nullableString,
  maintenanceWindowStartUtc: nullableString,
  maintenanceWindowEndUtc: nullableString,
  productionDatabase: z.object({
    name: nullableString,
    id: nullableString,
  }).strict(),
  authorizationApproval: z.object({
    ownerId: nullableString,
    approvedAtUtc: nullableString,
    evidenceId: nullableString,
    evidenceSha256: nullableString,
  }).strict(),
  deployment: z.object({
    authorized: z.boolean(),
    candidateCommit: nullableString,
    candidateWorkerVersionId: nullableString,
    previousWorkerVersionId: nullableString,
    buildManifestSha256: nullableString,
    routeFingerprintSha256: nullableString,
    activeRoutesUnchangedEvidenceId: nullableString,
  }).strict(),
  migrations: z.object({
    authorized: z.boolean(),
    approvedMigrations: z.array(z.string()),
    repositoryManifestSha256: nullableString,
    commandId: nullableString,
  }).strict(),
  productionImport: z.object({
    authorized: z.boolean(),
    commandApproved: z.boolean(),
    commandId: nullableString,
    runnerVersion: nullableString,
    bundleSha256: nullableString,
    manifestSha256: nullableString,
    sourceExportSha256: nullableString,
    tenantIds: z.array(z.string()),
    allowedTables: z.array(z.string()),
    deterministicRunId: nullableString,
    secondPassRequired: z.boolean(),
  }).strict(),
  featureFlagPlan: z.object({
    authorized: z.boolean(),
    commandId: nullableString,
    tenantId: nullableString,
    flagKey: nullableString,
    domain: nullableString,
    initialMode: nullableString,
    expectedPreviousState: nullableString,
    effectiveAtUtc: nullableString,
    updatedByPublicId: nullableString,
    canonicalModeAuthorized: z.boolean(),
  }).strict(),
  rollbackOwner: ownerSchema,
  observationOwner: ownerSchema,
  rollbackPolicy: z.object({
    maxRollbackDurationMs: nullableSafeInteger,
    maxReopenDurationMs: nullableSafeInteger,
    observationGracePeriodMs: nullableSafeInteger,
  }).strict(),
  exportEvidence: z.object({
    captured: z.boolean(),
    exportSha256: nullableString,
    exportSizeBytes: nullableSafeInteger,
    timeTravelBookmarkId: nullableString,
    metadataEvidenceId: nullableString,
    directoryMode: nullableString,
    fileMode: nullableString,
  }).strict(),
  maintenanceRecoveryEvidence: z.object({
    evidenceId: nullableString,
    evidenceSha256: nullableString,
  }).strict(),
  workerBuildVersionEvidence: z.object({
    evidenceId: nullableString,
    evidenceSha256: nullableString,
  }).strict(),
  foreignKeyDisposition: z.object({
    evidenceId: nullableString,
    evidenceSha256: nullableString,
    groups: z.array(fkGroupSchema),
  }).strict(),
  smoke: z.object({
    planId: nullableString,
    requiredScenarios: z.array(z.string()),
    maxP95LatencyMs: nullableSafeInteger,
    maxErrorRate: z.number().finite().nullable(),
  }).strict(),
}).strict();

const SENSITIVE_KEYS = new Set([
  'authorizationheader',
  'headers',
  'cookie',
  'cookies',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'clientsecret',
  'privatekey',
  'rawbody',
  'responsebody',
  'signedurl',
]);

function issue(
  code: ReportingAuthorizationDocumentIssueCode,
  gate: 'document' | 'file' = 'document',
): ReportingAuthorizationDocumentIssue {
  return { code, gate, severity: 'blocker' };
}

function failure(...issues: ReportingAuthorizationDocumentIssue[]): ReportingAuthorizationDocumentResult {
  return { documentReady: false, authorization: null, issues };
}

export function parseReportingCutoverAuthorizationValue(
  raw: unknown,
): ReportingAuthorizationDocumentResult {
  if (containsNormalizedKey(raw, SENSITIVE_KEYS)) {
    return failure(issue('CDB101_AUTHORIZATION_DOCUMENT_SENSITIVE_FIELD'));
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (
      record.schemaVersion === 2
      && (
        Object.prototype.hasOwnProperty.call(record, 'ownerModel')
        || Object.prototype.hasOwnProperty.call(record, 'twoPersonRiskAcceptance')
        || Object.prototype.hasOwnProperty.call(record, 'singleOperatorRiskAcceptance')
      )
    ) {
      return failure(issue('CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD'));
    }
    if (
      record.schemaVersion === 3
      && (
        record.ownerModel !== 'two_person_constrained'
        || !Object.prototype.hasOwnProperty.call(record, 'twoPersonRiskAcceptance')
        || Object.prototype.hasOwnProperty.call(record, 'singleOperatorRiskAcceptance')
      )
    ) {
      return failure(issue('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID'));
    }
    if (
      record.schemaVersion === 4
      && (
        record.ownerModel !== 'single_operator_risk_accepted'
        || !Object.prototype.hasOwnProperty.call(record, 'singleOperatorRiskAcceptance')
        || Object.prototype.hasOwnProperty.call(record, 'twoPersonRiskAcceptance')
      )
    ) {
      return failure(issue('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID'));
    }
  }

  const parsed = authorizationSchema.safeParse(raw);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((item) => item.code === 'unrecognized_keys');
    return failure(issue(
      unknown
        ? 'CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD'
        : 'CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID',
    ));
  }

  return {
    documentReady: true,
    authorization: parsed.data as ReportingCutoverAuthorization,
    issues: [],
  };
}

function mapProtectedJsonIssue(
  input: ProtectedJsonDocumentIssue,
): ReportingAuthorizationDocumentIssue {
  const codeByBase = {
    INVALID_JSON: 'CDB101_AUTHORIZATION_DOCUMENT_INVALID_JSON',
    DUPLICATE_KEY: 'CDB101_AUTHORIZATION_DOCUMENT_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB101_AUTHORIZATION_DOCUMENT_UNSAFE_KEY',
    TOO_LARGE: 'CDB101_AUTHORIZATION_DOCUMENT_TOO_LARGE',
    TOO_DEEP: 'CDB101_AUTHORIZATION_DOCUMENT_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB101_AUTHORIZATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB101_AUTHORIZATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB101_AUTHORIZATION_FILE_PROTECTION_INVALID',
  } as const;
  return issue(codeByBase[input.code], input.gate);
}

export function parseReportingCutoverAuthorizationJson(text: string): ReportingAuthorizationDocumentResult {
  const strict = parseStrictJsonDocument(text, {
    maxBytes: MAX_REPORTING_AUTHORIZATION_BYTES,
    maxDepth: MAX_REPORTING_AUTHORIZATION_DEPTH,
  });
  if (!strict.ready) return failure(...strict.issues.map(mapProtectedJsonIssue));
  return parseReportingCutoverAuthorizationValue(strict.value);
}

export function loadProtectedReportingCutoverAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
): ReportingAuthorizationDocumentResult {
  const strict = loadProtectedJsonDocument(authorizationPath, repositoryRoot, {
    maxBytes: MAX_REPORTING_AUTHORIZATION_BYTES,
    maxDepth: MAX_REPORTING_AUTHORIZATION_DEPTH,
  });
  if (!strict.ready) return failure(...strict.issues.map(mapProtectedJsonIssue));
  return parseReportingCutoverAuthorizationValue(strict.value);
}

export interface PreparedProtectedReportingCutoverAuthorization {
  authorization: ReportingCutoverAuthorization | null;
  receipt: ReportingAuthorizationEvaluationReceipt;
}

export function prepareProtectedReportingCutoverAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedProtectedReportingCutoverAuthorization {
  const document = loadProtectedReportingCutoverAuthorization(authorizationPath, repositoryRoot);
  if (!document.documentReady || !document.authorization) {
    return {
      authorization: null,
      receipt: {
        schemaVersion: 1,
        documentReady: false,
        executionReady: false,
        issueCount: document.issues.length,
        issues: document.issues,
        expectedCommandIds: null,
        aggregateOnly: true,
        networkRequestPerformed: false,
        productionMutationPerformed: false,
      },
    };
  }

  const semantic = validateReportingCutoverAuthorization(document.authorization, atUtc);
  const issues: ReportingAuthorizationAggregateIssue[] = semantic.issues.map((item) => ({
    code: item.code,
    gate: 'authorization',
    severity: 'blocker',
  }));
  return {
    authorization: document.authorization,
    receipt: {
      schemaVersion: 1,
      documentReady: true,
      executionReady: semantic.executionReady,
      issueCount: issues.length,
      issues,
      expectedCommandIds: semantic.expectedCommandIds,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    },
  };
}

export function evaluateProtectedReportingCutoverAuthorization(
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): ReportingAuthorizationEvaluationReceipt {
  return prepareProtectedReportingCutoverAuthorization(
    authorizationPath,
    repositoryRoot,
    atUtc,
  ).receipt;
}

export function parseReportingAuthorizationValidatorArgs(
  args: string[],
): ReportingAuthorizationValidatorCliOptions {
  let authorizationPath = '';
  let atUtc: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg !== '--authorization' && arg !== '--at-utc') throw new Error('Unknown argument.');
    if (seen.has(arg)) throw new Error('Duplicate argument.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
    if (arg === '--authorization') authorizationPath = value;
    else atUtc = value;
    seen.add(arg);
    index += 1;
  }
  if (!authorizationPath) throw new Error('--authorization is required.');
  return { authorizationPath, atUtc };
}

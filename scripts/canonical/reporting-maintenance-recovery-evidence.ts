import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  type ReportingCutoverAuthorization,
  type ReportingOwnerContract,
} from './production-cutover-contract';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssue,
} from './protected-json-document';

export const MAX_REPORTING_MAINTENANCE_EVIDENCE_BYTES = 256 * 1024;
export const MAX_REPORTING_MAINTENANCE_EVIDENCE_DEPTH = 64;

export interface ReportingMaintenanceAuthorizationApprovalEvidence {
  approved: boolean;
  ownerId: string | null;
  approvedAtUtc: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
}

export interface ReportingMaintenanceWindowEvidence {
  approved: boolean;
  windowId: string | null;
  startUtc: string | null;
  endUtc: string | null;
  observationGracePeriodMs: number | null;
  expiresAtUtc: string | null;
  approvalOwnerId: string | null;
  approvedAtUtc: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
}

export interface ReportingOperationalOwnerEvidence {
  assigned: boolean;
  primaryOwnerId: string | null;
  backupOwnerId: string | null;
  primaryAcknowledgedAtUtc: string | null;
  backupAcknowledgedAtUtc: string | null;
  communicationChannelId: string | null;
  decisionAuthority: string;
  evidenceId: string | null;
  evidenceSha256: string | null;
}

export interface ReportingRollbackPolicyEvidence {
  reviewed: boolean;
  planId: string | null;
  reviewerOwnerId: string | null;
  reviewedAtUtc: string | null;
  maxRollbackDurationMs: number | null;
  maxReopenDurationMs: number | null;
  observationGracePeriodMs: number | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
}

export interface ReportingProtectedExportEvidence {
  captured: boolean;
  capturedAtUtc: string | null;
  sourceDatabaseName: string | null;
  sourceDatabaseId: string | null;
  scope: string;
  exportSha256: string | null;
  exportSizeBytes: number | null;
  metadataEvidenceId: string | null;
  metadataEvidenceSha256: string | null;
  directoryMode: string | null;
  fileMode: string | null;
}

export interface ReportingTimeTravelEvidence {
  captured: boolean;
  capturedAtUtc: string | null;
  sourceDatabaseId: string | null;
  bookmarkId: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
}

export interface ReportingMaintenanceRecoveryEvidence {
  schemaVersion: 1;
  authorizationSchemaVersion: 2 | 3 | 4;
  ownerModel: 'four_person_strict' | 'two_person_constrained' | 'single_operator_risk_accepted';
  twoPersonRiskAcceptanceEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  } | null;
  singleOperatorRiskAcceptanceEvidence?: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  } | null;
  evidenceId: string | null;
  generatedAtUtc: string | null;
  productionDatabase: {
    name: string | null;
    id: string | null;
  };
  domain: string | null;
  cutoverTenantId: string | null;
  authorizationIssuedAtUtc: string | null;
  authorizationApproval: ReportingMaintenanceAuthorizationApprovalEvidence;
  maintenanceWindow: ReportingMaintenanceWindowEvidence;
  owners: {
    rollback: ReportingOperationalOwnerEvidence;
    observation: ReportingOperationalOwnerEvidence;
  };
  rollbackPolicy: ReportingRollbackPolicyEvidence;
  recovery: {
    export: ReportingProtectedExportEvidence;
    timeTravel: ReportingTimeTravelEvidence;
  };
}

export interface ReportingMaintenanceRecoveryAuthorizationSnapshot {
  authorizationSchemaVersion: 2 | 3 | 4;
  ownerModel: 'four_person_strict' | 'two_person_constrained' | 'single_operator_risk_accepted';
  twoPersonRiskAcceptanceEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  } | null;
  singleOperatorRiskAcceptanceEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  } | null;
  maintenanceRecoveryEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  issuedAtUtc: string | null;
  expiresAtUtc: string | null;
  maintenanceWindowStartUtc: string | null;
  maintenanceWindowEndUtc: string | null;
  authorizationApproval: {
    ownerId: string | null;
    approvedAtUtc: string | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  rollbackOwner: ReportingOwnerContract;
  observationOwner: ReportingOwnerContract;
  rollbackPolicy: {
    maxRollbackDurationMs: number | null;
    maxReopenDurationMs: number | null;
    observationGracePeriodMs: number | null;
  };
  exportEvidence: {
    captured: boolean;
    exportSha256: string | null;
    exportSizeBytes: number | null;
    timeTravelBookmarkId: string | null;
    metadataEvidenceId: string | null;
    directoryMode: string | null;
    fileMode: string | null;
  };
  productionImportSourceExportSha256: string | null;
}

export type ReportingMaintenanceRecoveryIssueCode =
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_INVALID_JSON'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_DUPLICATE_KEY'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_UNKNOWN_FIELD'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_SENSITIVE_FIELD'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_UNSAFE_KEY'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_SCHEMA_INVALID'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_TOO_LARGE'
  | 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_TOO_DEEP'
  | 'CDB101_MAINTENANCE_EVIDENCE_FILE_UNAVAILABLE'
  | 'CDB101_MAINTENANCE_EVIDENCE_FILE_INSIDE_REPOSITORY'
  | 'CDB101_MAINTENANCE_EVIDENCE_FILE_PROTECTION_INVALID'
  | 'CDB101_MAINTENANCE_EVIDENCE_SCHEMA_UNSUPPORTED'
  | 'CDB101_MAINTENANCE_EVIDENCE_ID_INVALID'
  | 'CDB101_MAINTENANCE_IDENTITY_MISMATCH'
  | 'CDB101_MAINTENANCE_SCOPE_MISMATCH'
  | 'CDB101_MAINTENANCE_AUTHORIZATION_APPROVAL_INVALID'
  | 'CDB101_MAINTENANCE_WINDOW_EVIDENCE_INVALID'
  | 'CDB101_MAINTENANCE_OWNER_CONTRACT_INVALID'
  | 'CDB101_MAINTENANCE_OWNER_IDENTITY_COLLISION'
  | 'CDB101_MAINTENANCE_ROLLBACK_POLICY_INVALID'
  | 'CDB101_MAINTENANCE_EXPORT_EVIDENCE_INVALID'
  | 'CDB101_MAINTENANCE_TIME_TRAVEL_EVIDENCE_INVALID'
  | 'CDB101_MAINTENANCE_RECOVERY_CHRONOLOGY_INVALID'
  | 'CDB101_MAINTENANCE_EVIDENCE_BINDING_INVALID'
  | 'CDB101_MAINTENANCE_AUTHORIZATION_BINDING_MISMATCH';

export interface ReportingMaintenanceRecoveryIssue {
  code: ReportingMaintenanceRecoveryIssueCode;
  gate: 'document' | 'file' | 'evidence';
  severity: 'blocker';
}

export interface ReportingMaintenanceRecoveryDocumentResult {
  documentReady: boolean;
  evidence: ReportingMaintenanceRecoveryEvidence | null;
  issues: ReportingMaintenanceRecoveryIssue[];
}

export interface ReportingMaintenanceRecoveryReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  evidenceReady: boolean;
  issueCount: number;
  issueCodes: ReportingMaintenanceRecoveryIssueCode[];
  evidenceSha256: string | null;
  authorizationSnapshotSha256: string | null;
  ownerIdentityCount: number;
  exportSizeBytes: number;
  maintenanceWindowDurationMs: number;
  observationGracePeriodMs: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export interface PreparedReportingMaintenanceRecoveryEvidence {
  evidence: ReportingMaintenanceRecoveryEvidence | null;
  authorizationSnapshot: ReportingMaintenanceRecoveryAuthorizationSnapshot | null;
  receipt: ReportingMaintenanceRecoveryReceipt;
}

export interface ReportingMaintenanceRecoveryCliOptions {
  evidencePath: string;
  atUtc?: string;
}

const nullableString = z.string().nullable();
const nullableSafeInteger = z.number().int().refine(Number.isSafeInteger).nullable();
const safeInteger = z.number().int().refine(Number.isSafeInteger);

const authorizationApprovalSchema = z.object({
  approved: z.boolean(),
  ownerId: nullableString,
  approvedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const maintenanceWindowSchema = z.object({
  approved: z.boolean(),
  windowId: nullableString,
  startUtc: nullableString,
  endUtc: nullableString,
  observationGracePeriodMs: nullableSafeInteger,
  expiresAtUtc: nullableString,
  approvalOwnerId: nullableString,
  approvedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const ownerSchema = z.object({
  assigned: z.boolean(),
  primaryOwnerId: nullableString,
  backupOwnerId: nullableString,
  primaryAcknowledgedAtUtc: nullableString,
  backupAcknowledgedAtUtc: nullableString,
  communicationChannelId: nullableString,
  decisionAuthority: z.string(),
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const rollbackPolicySchema = z.object({
  reviewed: z.boolean(),
  planId: nullableString,
  reviewerOwnerId: nullableString,
  reviewedAtUtc: nullableString,
  maxRollbackDurationMs: nullableSafeInteger,
  maxReopenDurationMs: nullableSafeInteger,
  observationGracePeriodMs: nullableSafeInteger,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const exportSchema = z.object({
  captured: z.boolean(),
  capturedAtUtc: nullableString,
  sourceDatabaseName: nullableString,
  sourceDatabaseId: nullableString,
  scope: z.string(),
  exportSha256: nullableString,
  exportSizeBytes: nullableSafeInteger,
  metadataEvidenceId: nullableString,
  metadataEvidenceSha256: nullableString,
  directoryMode: nullableString,
  fileMode: nullableString,
}).strict();

const timeTravelSchema = z.object({
  captured: z.boolean(),
  capturedAtUtc: nullableString,
  sourceDatabaseId: nullableString,
  bookmarkId: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const evidenceSchema = z.object({
  schemaVersion: safeInteger,
  authorizationSchemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  ownerModel: z.enum(['four_person_strict', 'two_person_constrained', 'single_operator_risk_accepted']),
  twoPersonRiskAcceptanceEvidence: z.object({
    evidenceId: nullableString,
    evidenceSha256: nullableString,
  }).strict().nullable(),
  singleOperatorRiskAcceptanceEvidence: z.object({
    evidenceId: nullableString,
    evidenceSha256: nullableString,
  }).strict().nullable().optional(),
  evidenceId: nullableString,
  generatedAtUtc: nullableString,
  productionDatabase: z.object({
    name: nullableString,
    id: nullableString,
  }).strict(),
  domain: nullableString,
  cutoverTenantId: nullableString,
  authorizationIssuedAtUtc: nullableString,
  authorizationApproval: authorizationApprovalSchema,
  maintenanceWindow: maintenanceWindowSchema,
  owners: z.object({
    rollback: ownerSchema,
    observation: ownerSchema,
  }).strict(),
  rollbackPolicy: rollbackPolicySchema,
  recovery: z.object({
    export: exportSchema,
    timeTravel: timeTravelSchema,
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
  'rawsql',
  'sql',
  'statement',
  'rowid',
  'rowids',
  'patientid',
  'patientname',
  'practitionerid',
  'practitionername',
  'signedurl',
  'exportpath',
  'filepath',
  'directorypath',
  'restorepath',
  'rawoutput',
  'commandoutput',
]);

function issue(
  code: ReportingMaintenanceRecoveryIssueCode,
  gate: 'document' | 'file' | 'evidence' = 'evidence',
): ReportingMaintenanceRecoveryIssue {
  return { code, gate, severity: 'blocker' };
}

function documentFailure(
  ...issues: ReportingMaintenanceRecoveryIssue[]
): ReportingMaintenanceRecoveryDocumentResult {
  return { documentReady: false, evidence: null, issues };
}

function mapProtectedIssue(input: ProtectedJsonDocumentIssue): ReportingMaintenanceRecoveryIssue {
  const map = {
    INVALID_JSON: 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_INVALID_JSON',
    DUPLICATE_KEY: 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_UNSAFE_KEY',
    TOO_LARGE: 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_TOO_LARGE',
    TOO_DEEP: 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB101_MAINTENANCE_EVIDENCE_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB101_MAINTENANCE_EVIDENCE_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB101_MAINTENANCE_EVIDENCE_FILE_PROTECTION_INVALID',
  } as const;
  return issue(map[input.code], input.gate);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_:\-]{2,127}$/.test(value);
}

function safeOpaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_:\-]{2,127}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function laterUtc(left: string | null, right: string | null): string | null {
  const leftMs = parseUtc(left);
  const rightMs = parseUtc(right);
  if (leftMs === null && rightMs === null) return null;
  if (leftMs !== null && rightMs === null) return left;
  if (leftMs === null && rightMs !== null) return right;
  return (leftMs ?? 0) >= (rightMs ?? 0) ? left : right;
}

function ownerSnapshot(input: ReportingOperationalOwnerEvidence): ReportingOwnerContract {
  return {
    assigned: input.assigned,
    ownerId: input.primaryOwnerId,
    backupOwnerId: input.backupOwnerId,
    acknowledgedAtUtc: laterUtc(input.primaryAcknowledgedAtUtc, input.backupAcknowledgedAtUtc),
    communicationChannelId: input.communicationChannelId,
    decisionAuthority: input.decisionAuthority as ReportingOwnerContract['decisionAuthority'],
  };
}

function buildAuthorizationSnapshot(
  input: ReportingMaintenanceRecoveryEvidence,
  evidenceSha256: string,
): ReportingMaintenanceRecoveryAuthorizationSnapshot {
  return {
    authorizationSchemaVersion: input.authorizationSchemaVersion,
    ownerModel: input.ownerModel,
    twoPersonRiskAcceptanceEvidence: structuredClone(input.twoPersonRiskAcceptanceEvidence),
    singleOperatorRiskAcceptanceEvidence: structuredClone(input.singleOperatorRiskAcceptanceEvidence ?? null),
    maintenanceRecoveryEvidence: {
      evidenceId: input.evidenceId,
      evidenceSha256,
    },
    issuedAtUtc: input.authorizationIssuedAtUtc,
    expiresAtUtc: input.maintenanceWindow.expiresAtUtc,
    maintenanceWindowStartUtc: input.maintenanceWindow.startUtc,
    maintenanceWindowEndUtc: input.maintenanceWindow.endUtc,
    authorizationApproval: {
      ownerId: input.authorizationApproval.ownerId,
      approvedAtUtc: input.authorizationApproval.approvedAtUtc,
      evidenceId: input.authorizationApproval.evidenceId,
      evidenceSha256: input.authorizationApproval.evidenceSha256,
    },
    rollbackOwner: ownerSnapshot(input.owners.rollback),
    observationOwner: ownerSnapshot(input.owners.observation),
    rollbackPolicy: {
      maxRollbackDurationMs: input.rollbackPolicy.maxRollbackDurationMs,
      maxReopenDurationMs: input.rollbackPolicy.maxReopenDurationMs,
      observationGracePeriodMs: input.rollbackPolicy.observationGracePeriodMs,
    },
    exportEvidence: {
      captured: input.recovery.export.captured,
      exportSha256: input.recovery.export.exportSha256,
      exportSizeBytes: input.recovery.export.exportSizeBytes,
      timeTravelBookmarkId: input.recovery.timeTravel.bookmarkId,
      metadataEvidenceId: input.recovery.export.metadataEvidenceId,
      directoryMode: input.recovery.export.directoryMode,
      fileMode: input.recovery.export.fileMode,
    },
    productionImportSourceExportSha256: input.recovery.export.exportSha256,
  };
}

function snapshotFromAuthorization(
  input: ReportingCutoverAuthorization,
): ReportingMaintenanceRecoveryAuthorizationSnapshot {
  return {
    authorizationSchemaVersion: input.schemaVersion,
    ownerModel: input.schemaVersion === 2 ? 'four_person_strict' : input.ownerModel!,
    twoPersonRiskAcceptanceEvidence: input.schemaVersion === 3
      ? {
        evidenceId: input.twoPersonRiskAcceptance?.evidenceId ?? null,
        evidenceSha256: input.twoPersonRiskAcceptance?.evidenceSha256 ?? null,
      }
      : null,
    singleOperatorRiskAcceptanceEvidence: input.schemaVersion === 4
      ? {
        evidenceId: input.singleOperatorRiskAcceptance?.evidenceId ?? null,
        evidenceSha256: input.singleOperatorRiskAcceptance?.evidenceSha256 ?? null,
      }
      : null,
    maintenanceRecoveryEvidence: structuredClone(input.maintenanceRecoveryEvidence),
    issuedAtUtc: input.issuedAtUtc,
    expiresAtUtc: input.expiresAtUtc,
    maintenanceWindowStartUtc: input.maintenanceWindowStartUtc,
    maintenanceWindowEndUtc: input.maintenanceWindowEndUtc,
    authorizationApproval: structuredClone(input.authorizationApproval),
    rollbackOwner: structuredClone(input.rollbackOwner),
    observationOwner: structuredClone(input.observationOwner),
    rollbackPolicy: structuredClone(input.rollbackPolicy),
    exportEvidence: structuredClone(input.exportEvidence),
    productionImportSourceExportSha256: input.productionImport.sourceExportSha256,
  };
}

export function parseReportingMaintenanceRecoveryEvidenceValue(
  value: unknown,
): ReportingMaintenanceRecoveryDocumentResult {
  if (containsNormalizedKey(value, SENSITIVE_KEYS)) {
    return documentFailure(issue('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_SENSITIVE_FIELD', 'document'));
  }
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((item) => item.code === 'unrecognized_keys');
    return documentFailure(issue(
      unknown
        ? 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_UNKNOWN_FIELD'
        : 'CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_SCHEMA_INVALID',
      'document',
    ));
  }
  return {
    documentReady: true,
    evidence: parsed.data as ReportingMaintenanceRecoveryEvidence,
    issues: [],
  };
}

export function parseReportingMaintenanceRecoveryEvidenceJson(
  text: string,
): ReportingMaintenanceRecoveryDocumentResult {
  const strict = parseStrictJsonDocument(text, {
    maxBytes: MAX_REPORTING_MAINTENANCE_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_MAINTENANCE_EVIDENCE_DEPTH,
  });
  if (!strict.ready) return documentFailure(...strict.issues.map(mapProtectedIssue));
  return parseReportingMaintenanceRecoveryEvidenceValue(strict.value);
}

function validateEvidence(
  input: ReportingMaintenanceRecoveryEvidence,
  atUtc: string,
): ReportingMaintenanceRecoveryIssue[] {
  const codes = new Set<ReportingMaintenanceRecoveryIssueCode>();
  const add = (code: ReportingMaintenanceRecoveryIssueCode): void => { codes.add(code); };

  if (input.schemaVersion !== 1) add('CDB101_MAINTENANCE_EVIDENCE_SCHEMA_UNSUPPORTED');
  if (
    (input.authorizationSchemaVersion === 2 && input.ownerModel !== 'four_person_strict')
    || (input.authorizationSchemaVersion === 3 && input.ownerModel !== 'two_person_constrained')
    || (input.authorizationSchemaVersion === 4 && input.ownerModel !== 'single_operator_risk_accepted')
  ) {
    add('CDB101_MAINTENANCE_SCOPE_MISMATCH');
  }
  const twoPersonRiskValid = input.ownerModel === 'two_person_constrained'
    ? (
      safeIdentifier(input.twoPersonRiskAcceptanceEvidence?.evidenceId)
      && isSha256(input.twoPersonRiskAcceptanceEvidence?.evidenceSha256)
      && (input.singleOperatorRiskAcceptanceEvidence ?? null) === null
    )
    : input.twoPersonRiskAcceptanceEvidence === null;
  const singleOperatorRiskValid = input.ownerModel === 'single_operator_risk_accepted'
    ? (
      safeIdentifier(input.singleOperatorRiskAcceptanceEvidence?.evidenceId)
      && isSha256(input.singleOperatorRiskAcceptanceEvidence?.evidenceSha256)
      && input.twoPersonRiskAcceptanceEvidence === null
    )
    : (input.singleOperatorRiskAcceptanceEvidence ?? null) === null;
  if (!twoPersonRiskValid || !singleOperatorRiskValid) {
    add('CDB101_MAINTENANCE_EVIDENCE_BINDING_INVALID');
  }
  if (!safeIdentifier(input.evidenceId)) add('CDB101_MAINTENANCE_EVIDENCE_ID_INVALID');
  if (
    input.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID
  ) add('CDB101_MAINTENANCE_IDENTITY_MISMATCH');
  if (input.domain !== 'reporting' || input.cutoverTenantId !== CDB101_CANARY_TENANT_ID) {
    add('CDB101_MAINTENANCE_SCOPE_MISMATCH');
  }

  const issuedMs = parseUtc(input.authorizationIssuedAtUtc);
  const authorizationApprovedMs = parseUtc(input.authorizationApproval.approvedAtUtc);
  const startMs = parseUtc(input.maintenanceWindow.startUtc);
  const endMs = parseUtc(input.maintenanceWindow.endUtc);
  const expiresMs = parseUtc(input.maintenanceWindow.expiresAtUtc);
  const maintenanceApprovedMs = parseUtc(input.maintenanceWindow.approvedAtUtc);
  const generatedMs = parseUtc(input.generatedAtUtc);
  const nowMs = parseUtc(atUtc);

  if (
    !input.authorizationApproval.approved
    || !safeIdentifier(input.authorizationApproval.ownerId)
    || authorizationApprovedMs === null
    || !safeIdentifier(input.authorizationApproval.evidenceId)
    || !isSha256(input.authorizationApproval.evidenceSha256)
  ) add('CDB101_MAINTENANCE_AUTHORIZATION_APPROVAL_INVALID');

  const grace = input.maintenanceWindow.observationGracePeriodMs;
  if (
    !input.maintenanceWindow.approved
    || !safeIdentifier(input.maintenanceWindow.windowId)
    || startMs === null
    || endMs === null
    || endMs <= startMs
    || !positiveInteger(grace)
    || expiresMs === null
    || expiresMs !== endMs + (grace ?? 0)
    || !safeIdentifier(input.maintenanceWindow.approvalOwnerId)
    || maintenanceApprovedMs === null
    || !safeIdentifier(input.maintenanceWindow.evidenceId)
    || !isSha256(input.maintenanceWindow.evidenceSha256)
  ) add('CDB101_MAINTENANCE_WINDOW_EVIDENCE_INVALID');

  const ownerInputs: Array<{
    owner: ReportingOperationalOwnerEvidence;
    authority: string;
  }> = [
    { owner: input.owners.rollback, authority: 'may_initiate_rollback' },
    { owner: input.owners.observation, authority: 'may_accept_or_reject_go' },
  ];
  for (const { owner, authority } of ownerInputs) {
    const constrained = input.ownerModel !== 'four_person_strict';
    if (
      !owner.assigned
      || !safeIdentifier(owner.primaryOwnerId)
      || (constrained ? owner.backupOwnerId !== null : !safeIdentifier(owner.backupOwnerId))
      || parseUtc(owner.primaryAcknowledgedAtUtc) === null
      || (constrained ? owner.backupAcknowledgedAtUtc !== null : parseUtc(owner.backupAcknowledgedAtUtc) === null)
      || !safeIdentifier(owner.communicationChannelId)
      || owner.decisionAuthority !== authority
      || !safeIdentifier(owner.evidenceId)
      || !isSha256(owner.evidenceSha256)
    ) add('CDB101_MAINTENANCE_OWNER_CONTRACT_INVALID');
  }

  const constrainedOwners = input.ownerModel !== 'four_person_strict';
  const singleOperator = input.ownerModel === 'single_operator_risk_accepted';
  const ownerIds = constrainedOwners
    ? [
      input.owners.rollback.primaryOwnerId,
      input.owners.observation.primaryOwnerId,
    ].filter(nonEmpty)
    : [
      input.owners.rollback.primaryOwnerId,
      input.owners.rollback.backupOwnerId,
      input.owners.observation.primaryOwnerId,
      input.owners.observation.backupOwnerId,
    ].filter(nonEmpty);
  const expectedOwnerCount = singleOperator ? 1 : constrainedOwners ? 2 : 4;
  if (
    ownerIds.length !== (constrainedOwners ? 2 : 4)
    || new Set(ownerIds).size !== expectedOwnerCount
    || input.owners.rollback.communicationChannelId !== input.owners.observation.communicationChannelId
  ) {
    add('CDB101_MAINTENANCE_OWNER_IDENTITY_COLLISION');
  }

  const windowDuration = startMs !== null && endMs !== null ? endMs - startMs : 0;
  if (
    !input.rollbackPolicy.reviewed
    || !safeIdentifier(input.rollbackPolicy.planId)
    || !safeIdentifier(input.rollbackPolicy.reviewerOwnerId)
    || parseUtc(input.rollbackPolicy.reviewedAtUtc) === null
    || !positiveInteger(input.rollbackPolicy.maxRollbackDurationMs)
    || !positiveInteger(input.rollbackPolicy.maxReopenDurationMs)
    || !positiveInteger(input.rollbackPolicy.observationGracePeriodMs)
    || input.rollbackPolicy.observationGracePeriodMs !== grace
    || (positiveInteger(input.rollbackPolicy.maxRollbackDurationMs)
      && input.rollbackPolicy.maxRollbackDurationMs > windowDuration)
    || (positiveInteger(input.rollbackPolicy.maxReopenDurationMs)
      && input.rollbackPolicy.maxReopenDurationMs > windowDuration)
    || !safeIdentifier(input.rollbackPolicy.evidenceId)
    || !isSha256(input.rollbackPolicy.evidenceSha256)
  ) add('CDB101_MAINTENANCE_ROLLBACK_POLICY_INVALID');

  const exportEvidence = input.recovery.export;
  if (
    !exportEvidence.captured
    || parseUtc(exportEvidence.capturedAtUtc) === null
    || exportEvidence.sourceDatabaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || exportEvidence.sourceDatabaseId !== CDB101_PRODUCTION_DATABASE_ID
    || exportEvidence.scope !== 'production_database_full_snapshot'
    || !isSha256(exportEvidence.exportSha256)
    || !positiveInteger(exportEvidence.exportSizeBytes)
    || !safeIdentifier(exportEvidence.metadataEvidenceId)
    || !isSha256(exportEvidence.metadataEvidenceSha256)
    || exportEvidence.directoryMode !== '700'
    || exportEvidence.fileMode !== '600'
  ) add('CDB101_MAINTENANCE_EXPORT_EVIDENCE_INVALID');

  const timeTravel = input.recovery.timeTravel;
  if (
    !timeTravel.captured
    || parseUtc(timeTravel.capturedAtUtc) === null
    || timeTravel.sourceDatabaseId !== CDB101_PRODUCTION_DATABASE_ID
    || !safeOpaqueIdentifier(timeTravel.bookmarkId)
    || !safeIdentifier(timeTravel.evidenceId)
    || !isSha256(timeTravel.evidenceSha256)
  ) add('CDB101_MAINTENANCE_TIME_TRAVEL_EVIDENCE_INVALID');

  const eventTimes = [
    authorizationApprovedMs,
    maintenanceApprovedMs,
    parseUtc(input.owners.rollback.primaryAcknowledgedAtUtc),
    ...(constrainedOwners ? [] : [parseUtc(input.owners.rollback.backupAcknowledgedAtUtc)]),
    parseUtc(input.owners.observation.primaryAcknowledgedAtUtc),
    ...(constrainedOwners ? [] : [parseUtc(input.owners.observation.backupAcknowledgedAtUtc)]),
    parseUtc(input.rollbackPolicy.reviewedAtUtc),
    parseUtc(exportEvidence.capturedAtUtc),
    parseUtc(timeTravel.capturedAtUtc),
  ];
  if (
    issuedMs === null
    || startMs === null
    || generatedMs === null
    || nowMs === null
    || generatedMs > startMs
    || generatedMs > nowMs
    || eventTimes.some((time) => time === null || time < issuedMs || time > startMs || time > generatedMs)
  ) add('CDB101_MAINTENANCE_RECOVERY_CHRONOLOGY_INVALID');

  const evidenceIds = [
    input.evidenceId,
    input.authorizationApproval.evidenceId,
    input.maintenanceWindow.windowId,
    input.maintenanceWindow.evidenceId,
    input.owners.rollback.evidenceId,
    input.owners.observation.evidenceId,
    input.rollbackPolicy.planId,
    input.rollbackPolicy.evidenceId,
    exportEvidence.metadataEvidenceId,
    timeTravel.evidenceId,
    ...(input.ownerModel === 'two_person_constrained'
      ? [input.twoPersonRiskAcceptanceEvidence?.evidenceId]
      : input.ownerModel === 'single_operator_risk_accepted'
        ? [input.singleOperatorRiskAcceptanceEvidence?.evidenceId]
        : []),
  ].filter(nonEmpty);
  const hashes = [
    input.authorizationApproval.evidenceSha256,
    input.maintenanceWindow.evidenceSha256,
    input.owners.rollback.evidenceSha256,
    input.owners.observation.evidenceSha256,
    input.rollbackPolicy.evidenceSha256,
    exportEvidence.exportSha256,
    exportEvidence.metadataEvidenceSha256,
    timeTravel.evidenceSha256,
    ...(input.ownerModel === 'two_person_constrained'
      ? [input.twoPersonRiskAcceptanceEvidence?.evidenceSha256]
      : input.ownerModel === 'single_operator_risk_accepted'
        ? [input.singleOperatorRiskAcceptanceEvidence?.evidenceSha256]
        : []),
  ].filter(nonEmpty);
  const expectedEvidenceIdCount = constrainedOwners ? 11 : 10;
  const expectedHashCount = constrainedOwners ? 9 : 8;
  if (
    evidenceIds.length !== expectedEvidenceIdCount
    || new Set(evidenceIds).size !== evidenceIds.length
    || hashes.length !== expectedHashCount
    || new Set(hashes).size !== hashes.length
  ) add('CDB101_MAINTENANCE_EVIDENCE_BINDING_INVALID');

  return [...codes].map((code) => issue(code));
}

function emptyReceipt(
  documentReady: boolean,
  issues: ReportingMaintenanceRecoveryIssue[],
): ReportingMaintenanceRecoveryReceipt {
  return {
    schemaVersion: 1,
    documentReady,
    evidenceReady: false,
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    evidenceSha256: null,
    authorizationSnapshotSha256: null,
    ownerIdentityCount: 0,
    exportSizeBytes: 0,
    maintenanceWindowDurationMs: 0,
    observationGracePeriodMs: 0,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
  };
}

export function prepareReportingMaintenanceRecoveryEvidence(
  input: ReportingMaintenanceRecoveryEvidence,
  atUtc: string = new Date().toISOString(),
): PreparedReportingMaintenanceRecoveryEvidence {
  const parsed = parseReportingMaintenanceRecoveryEvidenceValue(input);
  if (!parsed.documentReady || !parsed.evidence) {
    return {
      evidence: null,
      authorizationSnapshot: null,
      receipt: emptyReceipt(false, parsed.issues),
    };
  }

  const issues = validateEvidence(parsed.evidence, atUtc);
  const evidenceSha256 = sha256(parsed.evidence);
  const authorizationSnapshot = issues.length === 0
    ? buildAuthorizationSnapshot(parsed.evidence, evidenceSha256)
    : null;
  const startMs = parseUtc(parsed.evidence.maintenanceWindow.startUtc);
  const endMs = parseUtc(parsed.evidence.maintenanceWindow.endUtc);
  return {
    evidence: parsed.evidence,
    authorizationSnapshot,
    receipt: {
      schemaVersion: 1,
      documentReady: true,
      evidenceReady: issues.length === 0,
      issueCount: issues.length,
      issueCodes: issues.map((item) => item.code),
      evidenceSha256,
      authorizationSnapshotSha256: authorizationSnapshot ? sha256(authorizationSnapshot) : null,
      ownerIdentityCount: issues.length === 0
        ? (parsed.evidence.ownerModel === 'single_operator_risk_accepted'
          ? 1
          : parsed.evidence.ownerModel === 'two_person_constrained' ? 2 : 4)
        : 0,
      exportSizeBytes: positiveInteger(parsed.evidence.recovery.export.exportSizeBytes)
        ? parsed.evidence.recovery.export.exportSizeBytes
        : 0,
      maintenanceWindowDurationMs: startMs !== null && endMs !== null && endMs > startMs
        ? endMs - startMs
        : 0,
      observationGracePeriodMs: positiveInteger(parsed.evidence.maintenanceWindow.observationGracePeriodMs)
        ? parsed.evidence.maintenanceWindow.observationGracePeriodMs
        : 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    },
  };
}

export function prepareProtectedReportingMaintenanceRecoveryEvidence(
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedReportingMaintenanceRecoveryEvidence {
  const strict = loadProtectedJsonDocument(evidencePath, repositoryRoot, {
    maxBytes: MAX_REPORTING_MAINTENANCE_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_MAINTENANCE_EVIDENCE_DEPTH,
  });
  if (!strict.ready) {
    const issues = strict.issues.map(mapProtectedIssue);
    return {
      evidence: null,
      authorizationSnapshot: null,
      receipt: emptyReceipt(false, issues),
    };
  }
  const parsed = parseReportingMaintenanceRecoveryEvidenceValue(strict.value);
  if (!parsed.documentReady || !parsed.evidence) {
    return {
      evidence: null,
      authorizationSnapshot: null,
      receipt: emptyReceipt(false, parsed.issues),
    };
  }
  return prepareReportingMaintenanceRecoveryEvidence(parsed.evidence, atUtc);
}

export function bindReportingMaintenanceRecoveryEvidenceToAuthorization(
  prepared: PreparedReportingMaintenanceRecoveryEvidence,
  authorization: ReportingCutoverAuthorization,
): PreparedReportingMaintenanceRecoveryEvidence {
  if (!prepared.receipt.evidenceReady || !prepared.authorizationSnapshot || !prepared.evidence) return prepared;
  if (sha256(snapshotFromAuthorization(authorization)) === prepared.receipt.authorizationSnapshotSha256) {
    return prepared;
  }
  const issueCodes = [
    ...prepared.receipt.issueCodes,
    'CDB101_MAINTENANCE_AUTHORIZATION_BINDING_MISMATCH' as const,
  ];
  return {
    evidence: prepared.evidence,
    authorizationSnapshot: null,
    receipt: {
      ...prepared.receipt,
      evidenceReady: false,
      issueCount: issueCodes.length,
      issueCodes,
      authorizationSnapshotSha256: null,
      ownerIdentityCount: 0,
    },
  };
}

export function evaluateProtectedReportingMaintenanceRecoveryEvidence(
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): ReportingMaintenanceRecoveryReceipt {
  return prepareProtectedReportingMaintenanceRecoveryEvidence(evidencePath, repositoryRoot, atUtc).receipt;
}

export function parseReportingMaintenanceRecoveryEvidenceArgs(
  args: string[],
): ReportingMaintenanceRecoveryCliOptions {
  let evidencePath = '';
  let atUtc: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg !== '--evidence' && arg !== '--at-utc') throw new Error('Unknown argument.');
    if (seen.has(arg)) throw new Error('Duplicate argument.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
    if (arg === '--evidence') evidencePath = value;
    else atUtc = value;
    seen.add(arg);
    index += 1;
  }
  if (!evidencePath) throw new Error('--evidence is required.');
  return { evidencePath, atUtc };
}

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ReportingCutoverAuthorization } from './production-cutover-contract';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssue,
} from './protected-json-document';

export const MAX_REPORTING_WORKER_EVIDENCE_BYTES = 256 * 1024;
export const MAX_REPORTING_WORKER_EVIDENCE_DEPTH = 64;
export const CDB101_PRODUCTION_WORKER_SERVICE = 'hms-saas-production';
export const CDB101_PRODUCTION_WORKER_ENVIRONMENT = 'production';
export const CDB101_PRODUCTION_WORKER_ENTRYPOINT = 'src/index.ts';
export const CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE = '2026-02-17';
export const CDB101_PRODUCTION_WORKER_ROUTES = [
  '*.ozzyl.com/*',
  'admin.ozzyl.com/*',
  'app.ozzyl.com/*',
  'hms.ozzyl.com/*',
] as const;

export interface ReportingWorkerBuildVersionEvidence {
  schemaVersion: 1;
  evidenceId: string | null;
  generatedAtUtc: string | null;
  worker: {
    serviceName: string | null;
    environment: string | null;
    entrypoint: string | null;
    compatibilityDate: string | null;
    routes: string[];
  };
  repository: {
    candidateCommit: string | null;
    capturedAtUtc: string | null;
    cleanWorkingTreeConfirmed: boolean;
    evidenceId: string | null;
    evidenceSha256: string | null;
    packageJsonSha256: string | null;
    lockfileSha256: string | null;
    wranglerConfigSha256: string | null;
    migrationManifestSha256: string | null;
  };
  build: {
    completed: boolean;
    completedAtUtc: string | null;
    buildCommandId: string | null;
    builderId: string | null;
    artifactSha256: string | null;
    artifactSizeBytes: number | null;
    manifestEvidenceId: string | null;
    manifestSha256: string | null;
    testsPassedConfirmed: boolean;
    typecheckPassedConfirmed: boolean;
    governancePassedConfirmed: boolean;
    uploadPerformedByEvidenceCapture: boolean;
  };
  deploymentAuthorization: {
    authorized: boolean;
    scope: string;
    ownerId: string | null;
    approvedAtUtc: string | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  candidateVersion: {
    captured: boolean;
    versionId: string | null;
    versionNumber: number | null;
    createdAtUtc: string | null;
    capturedAtUtc: string | null;
    sourceCommit: string | null;
    buildManifestSha256: string | null;
    scriptEtag: string | null;
    metadataEvidenceId: string | null;
    metadataEvidenceSha256: string | null;
    trafficPercentage: number | null;
    trafficAssigned: boolean;
    deploymentPerformed: boolean;
  };
  previousVersion: {
    captured: boolean;
    versionId: string | null;
    versionNumber: number | null;
    createdAtUtc: string | null;
    capturedAtUtc: string | null;
    scriptEtag: string | null;
    metadataEvidenceId: string | null;
    metadataEvidenceSha256: string | null;
    active: boolean;
    trafficPercentage: number | null;
  };
  routing: {
    capturedAtUtc: string | null;
    routeFingerprintSha256: string | null;
    activeRoutesUnchangedEvidenceId: string | null;
    evidenceSha256: string | null;
    exactRouteSetConfirmed: boolean;
  };
}

export interface ReportingWorkerBuildVersionAuthorizationSnapshot {
  workerBuildVersionEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  deployment: {
    authorized: boolean;
    candidateCommit: string | null;
    candidateWorkerVersionId: string | null;
    previousWorkerVersionId: string | null;
    buildManifestSha256: string | null;
    routeFingerprintSha256: string | null;
    activeRoutesUnchangedEvidenceId: string | null;
  };
  migrationRepositoryManifestSha256: string | null;
}

export type ReportingWorkerBuildVersionIssueCode =
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_INVALID_JSON'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_DUPLICATE_KEY'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_UNKNOWN_FIELD'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_SENSITIVE_FIELD'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_UNSAFE_KEY'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_SCHEMA_INVALID'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_TOO_LARGE'
  | 'CDB101_WORKER_EVIDENCE_DOCUMENT_TOO_DEEP'
  | 'CDB101_WORKER_EVIDENCE_FILE_UNAVAILABLE'
  | 'CDB101_WORKER_EVIDENCE_FILE_INSIDE_REPOSITORY'
  | 'CDB101_WORKER_EVIDENCE_FILE_PROTECTION_INVALID'
  | 'CDB101_WORKER_EVIDENCE_SCHEMA_UNSUPPORTED'
  | 'CDB101_WORKER_EVIDENCE_ID_INVALID'
  | 'CDB101_WORKER_BUILD_IDENTITY_MISMATCH'
  | 'CDB101_WORKER_ROUTE_SCOPE_INVALID'
  | 'CDB101_WORKER_REPOSITORY_EVIDENCE_INVALID'
  | 'CDB101_WORKER_BUILD_EVIDENCE_INVALID'
  | 'CDB101_WORKER_DEPLOYMENT_AUTHORIZATION_INVALID'
  | 'CDB101_WORKER_CANDIDATE_VERSION_INVALID'
  | 'CDB101_WORKER_CANDIDATE_TRAFFIC_UNSAFE'
  | 'CDB101_WORKER_PREVIOUS_VERSION_INVALID'
  | 'CDB101_WORKER_VERSION_ORDER_INVALID'
  | 'CDB101_WORKER_ROUTING_EVIDENCE_INVALID'
  | 'CDB101_WORKER_BUILD_CHAIN_MISMATCH'
  | 'CDB101_WORKER_BUILD_VERSION_CHRONOLOGY_INVALID'
  | 'CDB101_WORKER_EVIDENCE_BINDING_INVALID'
  | 'CDB101_WORKER_AUTHORIZATION_BINDING_MISMATCH';

export interface ReportingWorkerBuildVersionIssue {
  code: ReportingWorkerBuildVersionIssueCode;
  gate: 'document' | 'file' | 'evidence';
  severity: 'blocker';
}

export interface ReportingWorkerBuildVersionDocumentResult {
  documentReady: boolean;
  evidence: ReportingWorkerBuildVersionEvidence | null;
  issues: ReportingWorkerBuildVersionIssue[];
}

export interface ReportingWorkerBuildVersionReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  evidenceReady: boolean;
  issueCount: number;
  issueCodes: ReportingWorkerBuildVersionIssueCode[];
  evidenceSha256: string | null;
  authorizationSnapshotSha256: string | null;
  candidateVersionNumber: number;
  previousVersionNumber: number;
  candidateTrafficPercentage: number;
  previousTrafficPercentage: number;
  artifactSizeBytes: number;
  routeCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  workerVersionUploadPerformed: false;
  trafficAssignmentPerformed: false;
}

export interface PreparedReportingWorkerBuildVersionEvidence {
  evidence: ReportingWorkerBuildVersionEvidence | null;
  authorizationSnapshot: ReportingWorkerBuildVersionAuthorizationSnapshot | null;
  receipt: ReportingWorkerBuildVersionReceipt;
}

export interface ReportingWorkerBuildVersionCliOptions {
  evidencePath: string;
  atUtc?: string;
}

const nullableString = z.string().nullable();
const nullableSafeInteger = z.number().int().refine(Number.isSafeInteger).nullable();
const safeInteger = z.number().int().refine(Number.isSafeInteger);

const workerSchema = z.object({
  serviceName: nullableString,
  environment: nullableString,
  entrypoint: nullableString,
  compatibilityDate: nullableString,
  routes: z.array(z.string()),
}).strict();

const repositorySchema = z.object({
  candidateCommit: nullableString,
  capturedAtUtc: nullableString,
  cleanWorkingTreeConfirmed: z.boolean(),
  evidenceId: nullableString,
  evidenceSha256: nullableString,
  packageJsonSha256: nullableString,
  lockfileSha256: nullableString,
  wranglerConfigSha256: nullableString,
  migrationManifestSha256: nullableString,
}).strict();

const buildSchema = z.object({
  completed: z.boolean(),
  completedAtUtc: nullableString,
  buildCommandId: nullableString,
  builderId: nullableString,
  artifactSha256: nullableString,
  artifactSizeBytes: nullableSafeInteger,
  manifestEvidenceId: nullableString,
  manifestSha256: nullableString,
  testsPassedConfirmed: z.boolean(),
  typecheckPassedConfirmed: z.boolean(),
  governancePassedConfirmed: z.boolean(),
  uploadPerformedByEvidenceCapture: z.boolean(),
}).strict();

const deploymentAuthorizationSchema = z.object({
  authorized: z.boolean(),
  scope: z.string(),
  ownerId: nullableString,
  approvedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const candidateVersionSchema = z.object({
  captured: z.boolean(),
  versionId: nullableString,
  versionNumber: nullableSafeInteger,
  createdAtUtc: nullableString,
  capturedAtUtc: nullableString,
  sourceCommit: nullableString,
  buildManifestSha256: nullableString,
  scriptEtag: nullableString,
  metadataEvidenceId: nullableString,
  metadataEvidenceSha256: nullableString,
  trafficPercentage: nullableSafeInteger,
  trafficAssigned: z.boolean(),
  deploymentPerformed: z.boolean(),
}).strict();

const previousVersionSchema = z.object({
  captured: z.boolean(),
  versionId: nullableString,
  versionNumber: nullableSafeInteger,
  createdAtUtc: nullableString,
  capturedAtUtc: nullableString,
  scriptEtag: nullableString,
  metadataEvidenceId: nullableString,
  metadataEvidenceSha256: nullableString,
  active: z.boolean(),
  trafficPercentage: nullableSafeInteger,
}).strict();

const routingSchema = z.object({
  capturedAtUtc: nullableString,
  routeFingerprintSha256: nullableString,
  activeRoutesUnchangedEvidenceId: nullableString,
  evidenceSha256: nullableString,
  exactRouteSetConfirmed: z.boolean(),
}).strict();

const evidenceSchema = z.object({
  schemaVersion: safeInteger,
  evidenceId: nullableString,
  generatedAtUtc: nullableString,
  worker: workerSchema,
  repository: repositorySchema,
  build: buildSchema,
  deploymentAuthorization: deploymentAuthorizationSchema,
  candidateVersion: candidateVersionSchema,
  previousVersion: previousVersionSchema,
  routing: routingSchema,
}).strict();

const SENSITIVE_KEYS = new Set([
  'authorizationheader', 'headers', 'cookie', 'cookies', 'token', 'apitoken', 'accesstoken',
  'refreshtoken', 'password', 'secret', 'clientsecret', 'privatekey', 'rawbody', 'responsebody',
  'rawoutput', 'commandoutput', 'signedurl', 'accountid', 'zoneid', 'email', 'filepath',
  'directorypath', 'artifactpath', 'bundlepath', 'logpath',
]);

function issue(
  code: ReportingWorkerBuildVersionIssueCode,
  gate: 'document' | 'file' | 'evidence' = 'evidence',
): ReportingWorkerBuildVersionIssue {
  return { code, gate, severity: 'blocker' };
}

function documentFailure(
  ...issues: ReportingWorkerBuildVersionIssue[]
): ReportingWorkerBuildVersionDocumentResult {
  return { documentReady: false, evidence: null, issues };
}

function mapProtectedIssue(input: ProtectedJsonDocumentIssue): ReportingWorkerBuildVersionIssue {
  const map = {
    INVALID_JSON: 'CDB101_WORKER_EVIDENCE_DOCUMENT_INVALID_JSON',
    DUPLICATE_KEY: 'CDB101_WORKER_EVIDENCE_DOCUMENT_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB101_WORKER_EVIDENCE_DOCUMENT_UNSAFE_KEY',
    TOO_LARGE: 'CDB101_WORKER_EVIDENCE_DOCUMENT_TOO_LARGE',
    TOO_DEEP: 'CDB101_WORKER_EVIDENCE_DOCUMENT_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB101_WORKER_EVIDENCE_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB101_WORKER_EVIDENCE_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB101_WORKER_EVIDENCE_FILE_PROTECTION_INVALID',
  } as const;
  return issue(map[input.code], input.gate);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_:\-]{2,127}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function percentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactStringSet(values: readonly string[], expected: readonly string[]): boolean {
  const left = [...new Set(values)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function buildAuthorizationSnapshot(
  input: ReportingWorkerBuildVersionEvidence,
  evidenceSha256: string,
): ReportingWorkerBuildVersionAuthorizationSnapshot {
  return {
    workerBuildVersionEvidence: {
      evidenceId: input.evidenceId,
      evidenceSha256,
    },
    deployment: {
      authorized: input.deploymentAuthorization.authorized,
      candidateCommit: input.repository.candidateCommit,
      candidateWorkerVersionId: input.candidateVersion.versionId,
      previousWorkerVersionId: input.previousVersion.versionId,
      buildManifestSha256: input.build.manifestSha256,
      routeFingerprintSha256: input.routing.routeFingerprintSha256,
      activeRoutesUnchangedEvidenceId: input.routing.activeRoutesUnchangedEvidenceId,
    },
    migrationRepositoryManifestSha256: input.repository.migrationManifestSha256,
  };
}

function snapshotFromAuthorization(
  input: ReportingCutoverAuthorization,
): ReportingWorkerBuildVersionAuthorizationSnapshot {
  return {
    workerBuildVersionEvidence: structuredClone(input.workerBuildVersionEvidence),
    deployment: {
      authorized: input.deployment.authorized,
      candidateCommit: input.deployment.candidateCommit,
      candidateWorkerVersionId: input.deployment.candidateWorkerVersionId,
      previousWorkerVersionId: input.deployment.previousWorkerVersionId,
      buildManifestSha256: input.deployment.buildManifestSha256,
      routeFingerprintSha256: input.deployment.routeFingerprintSha256,
      activeRoutesUnchangedEvidenceId: input.deployment.activeRoutesUnchangedEvidenceId,
    },
    migrationRepositoryManifestSha256: input.migrations.repositoryManifestSha256,
  };
}

export function parseReportingWorkerBuildVersionEvidenceValue(
  value: unknown,
): ReportingWorkerBuildVersionDocumentResult {
  if (containsNormalizedKey(value, SENSITIVE_KEYS)) {
    return documentFailure(issue('CDB101_WORKER_EVIDENCE_DOCUMENT_SENSITIVE_FIELD', 'document'));
  }
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((item) => item.code === 'unrecognized_keys');
    return documentFailure(issue(
      unknown ? 'CDB101_WORKER_EVIDENCE_DOCUMENT_UNKNOWN_FIELD' : 'CDB101_WORKER_EVIDENCE_DOCUMENT_SCHEMA_INVALID',
      'document',
    ));
  }
  return { documentReady: true, evidence: parsed.data as ReportingWorkerBuildVersionEvidence, issues: [] };
}

export function parseReportingWorkerBuildVersionEvidenceJson(
  text: string,
): ReportingWorkerBuildVersionDocumentResult {
  const strict = parseStrictJsonDocument(text, {
    maxBytes: MAX_REPORTING_WORKER_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_WORKER_EVIDENCE_DEPTH,
  });
  if (!strict.ready) return documentFailure(...strict.issues.map(mapProtectedIssue));
  return parseReportingWorkerBuildVersionEvidenceValue(strict.value);
}

function validateEvidence(
  input: ReportingWorkerBuildVersionEvidence,
  atUtc: string,
): ReportingWorkerBuildVersionIssue[] {
  const codes = new Set<ReportingWorkerBuildVersionIssueCode>();
  const add = (code: ReportingWorkerBuildVersionIssueCode): void => { codes.add(code); };

  if (input.schemaVersion !== 1) add('CDB101_WORKER_EVIDENCE_SCHEMA_UNSUPPORTED');
  if (!safeIdentifier(input.evidenceId)) add('CDB101_WORKER_EVIDENCE_ID_INVALID');
  if (
    input.worker.serviceName !== CDB101_PRODUCTION_WORKER_SERVICE
    || input.worker.environment !== CDB101_PRODUCTION_WORKER_ENVIRONMENT
    || input.worker.entrypoint !== CDB101_PRODUCTION_WORKER_ENTRYPOINT
    || input.worker.compatibilityDate !== CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE
  ) add('CDB101_WORKER_BUILD_IDENTITY_MISMATCH');
  if (
    !input.routing.exactRouteSetConfirmed
    || !exactStringSet(input.worker.routes, CDB101_PRODUCTION_WORKER_ROUTES)
    || input.worker.routes.length !== CDB101_PRODUCTION_WORKER_ROUTES.length
  ) add('CDB101_WORKER_ROUTE_SCOPE_INVALID');

  const repositoryTime = parseUtc(input.repository.capturedAtUtc);
  if (
    !isCommit(input.repository.candidateCommit)
    || repositoryTime === null
    || !input.repository.cleanWorkingTreeConfirmed
    || !safeIdentifier(input.repository.evidenceId)
    || !isSha256(input.repository.evidenceSha256)
    || !isSha256(input.repository.packageJsonSha256)
    || !isSha256(input.repository.lockfileSha256)
    || !isSha256(input.repository.wranglerConfigSha256)
    || !isSha256(input.repository.migrationManifestSha256)
  ) add('CDB101_WORKER_REPOSITORY_EVIDENCE_INVALID');

  const buildTime = parseUtc(input.build.completedAtUtc);
  if (
    !input.build.completed
    || buildTime === null
    || !safeIdentifier(input.build.buildCommandId)
    || !safeIdentifier(input.build.builderId)
    || !isSha256(input.build.artifactSha256)
    || !positiveInteger(input.build.artifactSizeBytes)
    || !safeIdentifier(input.build.manifestEvidenceId)
    || !isSha256(input.build.manifestSha256)
    || !input.build.testsPassedConfirmed
    || !input.build.typecheckPassedConfirmed
    || !input.build.governancePassedConfirmed
    || input.build.uploadPerformedByEvidenceCapture
  ) add('CDB101_WORKER_BUILD_EVIDENCE_INVALID');

  const deploymentApproved = parseUtc(input.deploymentAuthorization.approvedAtUtc);
  if (
    !input.deploymentAuthorization.authorized
    || input.deploymentAuthorization.scope !== 'candidate_version_and_cutover'
    || !safeIdentifier(input.deploymentAuthorization.ownerId)
    || deploymentApproved === null
    || !safeIdentifier(input.deploymentAuthorization.evidenceId)
    || !isSha256(input.deploymentAuthorization.evidenceSha256)
  ) add('CDB101_WORKER_DEPLOYMENT_AUTHORIZATION_INVALID');

  const candidateCreated = parseUtc(input.candidateVersion.createdAtUtc);
  const candidateCaptured = parseUtc(input.candidateVersion.capturedAtUtc);
  if (
    !input.candidateVersion.captured
    || !isUuid(input.candidateVersion.versionId)
    || !positiveInteger(input.candidateVersion.versionNumber)
    || candidateCreated === null
    || candidateCaptured === null
    || !isCommit(input.candidateVersion.sourceCommit)
    || !isSha256(input.candidateVersion.buildManifestSha256)
    || !isSha256(input.candidateVersion.scriptEtag)
    || !safeIdentifier(input.candidateVersion.metadataEvidenceId)
    || !isSha256(input.candidateVersion.metadataEvidenceSha256)
    || !percentage(input.candidateVersion.trafficPercentage)
  ) add('CDB101_WORKER_CANDIDATE_VERSION_INVALID');
  if (
    input.candidateVersion.trafficPercentage !== 0
    || input.candidateVersion.trafficAssigned
    || input.candidateVersion.deploymentPerformed
  ) add('CDB101_WORKER_CANDIDATE_TRAFFIC_UNSAFE');

  const previousCreated = parseUtc(input.previousVersion.createdAtUtc);
  const previousCaptured = parseUtc(input.previousVersion.capturedAtUtc);
  if (
    !input.previousVersion.captured
    || !isUuid(input.previousVersion.versionId)
    || !positiveInteger(input.previousVersion.versionNumber)
    || previousCreated === null
    || previousCaptured === null
    || !isSha256(input.previousVersion.scriptEtag)
    || !safeIdentifier(input.previousVersion.metadataEvidenceId)
    || !isSha256(input.previousVersion.metadataEvidenceSha256)
    || !input.previousVersion.active
    || !percentage(input.previousVersion.trafficPercentage)
    || input.previousVersion.trafficPercentage !== 100
  ) add('CDB101_WORKER_PREVIOUS_VERSION_INVALID');
  if (
    input.candidateVersion.versionId === input.previousVersion.versionId
    || !positiveInteger(input.candidateVersion.versionNumber)
    || !positiveInteger(input.previousVersion.versionNumber)
    || input.candidateVersion.versionNumber <= input.previousVersion.versionNumber
  ) add('CDB101_WORKER_VERSION_ORDER_INVALID');

  const routingCaptured = parseUtc(input.routing.capturedAtUtc);
  if (
    routingCaptured === null
    || !isSha256(input.routing.routeFingerprintSha256)
    || !safeIdentifier(input.routing.activeRoutesUnchangedEvidenceId)
    || !isSha256(input.routing.evidenceSha256)
    || !input.routing.exactRouteSetConfirmed
  ) add('CDB101_WORKER_ROUTING_EVIDENCE_INVALID');

  if (
    input.candidateVersion.sourceCommit !== input.repository.candidateCommit
    || input.candidateVersion.buildManifestSha256 !== input.build.manifestSha256
  ) add('CDB101_WORKER_BUILD_CHAIN_MISMATCH');

  const generated = parseUtc(input.generatedAtUtc);
  const now = parseUtc(atUtc);
  if (
    repositoryTime === null
    || buildTime === null
    || candidateCreated === null
    || candidateCaptured === null
    || previousCreated === null
    || previousCaptured === null
    || routingCaptured === null
    || deploymentApproved === null
    || generated === null
    || now === null
    || repositoryTime > buildTime
    || buildTime > candidateCreated
    || candidateCreated > candidateCaptured
    || previousCreated > previousCaptured
    || candidateCaptured > routingCaptured
    || previousCaptured > routingCaptured
    || routingCaptured > deploymentApproved
    || deploymentApproved > generated
    || generated > now
  ) add('CDB101_WORKER_BUILD_VERSION_CHRONOLOGY_INVALID');

  const ids = [
    input.evidenceId,
    input.repository.evidenceId,
    input.build.manifestEvidenceId,
    input.deploymentAuthorization.evidenceId,
    input.candidateVersion.metadataEvidenceId,
    input.previousVersion.metadataEvidenceId,
    input.routing.activeRoutesUnchangedEvidenceId,
  ].filter(nonEmpty);
  const hashes = [
    input.repository.evidenceSha256,
    input.repository.packageJsonSha256,
    input.repository.lockfileSha256,
    input.repository.wranglerConfigSha256,
    input.repository.migrationManifestSha256,
    input.build.artifactSha256,
    input.build.manifestSha256,
    input.deploymentAuthorization.evidenceSha256,
    input.candidateVersion.scriptEtag,
    input.candidateVersion.metadataEvidenceSha256,
    input.previousVersion.scriptEtag,
    input.previousVersion.metadataEvidenceSha256,
    input.routing.routeFingerprintSha256,
    input.routing.evidenceSha256,
  ].filter(nonEmpty);
  if (
    ids.length !== 7
    || new Set(ids).size !== ids.length
    || hashes.length !== 14
    || new Set(hashes).size !== hashes.length
  ) add('CDB101_WORKER_EVIDENCE_BINDING_INVALID');

  return [...codes].map((code) => issue(code));
}

function emptyReceipt(
  documentReady: boolean,
  issues: ReportingWorkerBuildVersionIssue[],
): ReportingWorkerBuildVersionReceipt {
  return {
    schemaVersion: 1,
    documentReady,
    evidenceReady: false,
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    evidenceSha256: null,
    authorizationSnapshotSha256: null,
    candidateVersionNumber: 0,
    previousVersionNumber: 0,
    candidateTrafficPercentage: 0,
    previousTrafficPercentage: 0,
    artifactSizeBytes: 0,
    routeCount: 0,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    workerVersionUploadPerformed: false,
    trafficAssignmentPerformed: false,
  };
}

export function prepareReportingWorkerBuildVersionEvidence(
  input: ReportingWorkerBuildVersionEvidence,
  atUtc: string = new Date().toISOString(),
): PreparedReportingWorkerBuildVersionEvidence {
  const parsed = parseReportingWorkerBuildVersionEvidenceValue(input);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, authorizationSnapshot: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  const issues = validateEvidence(parsed.evidence, atUtc);
  const evidenceSha256 = sha256(parsed.evidence);
  const authorizationSnapshot = issues.length === 0
    ? buildAuthorizationSnapshot(parsed.evidence, evidenceSha256)
    : null;
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
      candidateVersionNumber: positiveInteger(parsed.evidence.candidateVersion.versionNumber)
        ? parsed.evidence.candidateVersion.versionNumber : 0,
      previousVersionNumber: positiveInteger(parsed.evidence.previousVersion.versionNumber)
        ? parsed.evidence.previousVersion.versionNumber : 0,
      candidateTrafficPercentage: percentage(parsed.evidence.candidateVersion.trafficPercentage)
        ? parsed.evidence.candidateVersion.trafficPercentage : 0,
      previousTrafficPercentage: percentage(parsed.evidence.previousVersion.trafficPercentage)
        ? parsed.evidence.previousVersion.trafficPercentage : 0,
      artifactSizeBytes: positiveInteger(parsed.evidence.build.artifactSizeBytes)
        ? parsed.evidence.build.artifactSizeBytes : 0,
      routeCount: parsed.evidence.worker.routes.length,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficAssignmentPerformed: false,
    },
  };
}

export function prepareProtectedReportingWorkerBuildVersionEvidence(
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedReportingWorkerBuildVersionEvidence {
  const strict = loadProtectedJsonDocument(evidencePath, repositoryRoot, {
    maxBytes: MAX_REPORTING_WORKER_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_WORKER_EVIDENCE_DEPTH,
  });
  if (!strict.ready) {
    const issues = strict.issues.map(mapProtectedIssue);
    return { evidence: null, authorizationSnapshot: null, receipt: emptyReceipt(false, issues) };
  }
  const parsed = parseReportingWorkerBuildVersionEvidenceValue(strict.value);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, authorizationSnapshot: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  return prepareReportingWorkerBuildVersionEvidence(parsed.evidence, atUtc);
}

export function bindReportingWorkerBuildVersionEvidenceToAuthorization(
  prepared: PreparedReportingWorkerBuildVersionEvidence,
  authorization: ReportingCutoverAuthorization,
): PreparedReportingWorkerBuildVersionEvidence {
  if (!prepared.receipt.evidenceReady || !prepared.authorizationSnapshot || !prepared.evidence) return prepared;
  if (sha256(snapshotFromAuthorization(authorization)) === prepared.receipt.authorizationSnapshotSha256) return prepared;
  const issueCodes = [
    ...prepared.receipt.issueCodes,
    'CDB101_WORKER_AUTHORIZATION_BINDING_MISMATCH' as const,
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
    },
  };
}

export function evaluateProtectedReportingWorkerBuildVersionEvidence(
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): ReportingWorkerBuildVersionReceipt {
  return prepareProtectedReportingWorkerBuildVersionEvidence(evidencePath, repositoryRoot, atUtc).receipt;
}

export function parseReportingWorkerBuildVersionEvidenceArgs(
  args: string[],
): ReportingWorkerBuildVersionCliOptions {
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

import { z } from 'zod';
import {
  CDB101_CANARY_TENANT_ID,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from './production-cutover-contract';
import { prepareProtectedReportingCutoverAuthorization } from './reporting-cutover-authorization-document';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssue,
} from './protected-json-document';

export const MAX_REPORTING_PROCESSING_EVIDENCE_BYTES = 256 * 1024;
export const MAX_REPORTING_PROCESSING_EVIDENCE_DEPTH = 64;

export const CDB101_PROCESSING_CHECK_IDS = [
  'unresolved_critical_exceptions',
  'blocked_outbox',
  'blocked_accounting',
  'duplicate_public_ids',
  'unsafe_integer_amounts',
  'tenant_isolation',
  'second_pass_new_rows',
] as const;

export type ReportingProcessingCheckId = typeof CDB101_PROCESSING_CHECK_IDS[number];

export interface ReportingProcessingEvidence {
  schemaVersion: 1;
  authorizationId: string | null;
  evidenceId: string | null;
  generatedAtUtc: string | null;
  scope: {
    productionDatabaseId: string | null;
    tenantId: string | null;
    domain: string | null;
    stage: string | null;
    migrationCommandId: string | null;
    importCommandId: string | null;
    featureFlagCommandId: string | null;
    featureFlagEffectiveAtUtc: string | null;
    authorizationExpiresAtUtc: string | null;
    deterministicRunId: string | null;
    bundleSha256: string | null;
    manifestSha256: string | null;
    sourceExportSha256: string | null;
    allowedTables: string[];
    migrationsCompletedAtUtc: string | null;
    importCompletedAtUtc: string | null;
    secondPassCompletedAtUtc: string | null;
    observationStartedAtUtc: string | null;
    observationEndedAtUtc: string | null;
  };
  observedTableNames: string[];
  checks: Array<{
    checkId: string;
    observedCount: number | null;
    completedAtUtc: string | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  }>;
  readOnlyProof: {
    queryCount: number | null;
    allQueriesReadOnly: boolean;
    changedDbTrueCount: number | null;
    rowsWritten: number | null;
    writeStatementCount: number | null;
    mutationCount: number | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
}

export type ReportingProcessingIssueCode =
  | 'CDB101_PROCESSING_DOCUMENT_INVALID_JSON'
  | 'CDB101_PROCESSING_DOCUMENT_DUPLICATE_KEY'
  | 'CDB101_PROCESSING_DOCUMENT_UNKNOWN_FIELD'
  | 'CDB101_PROCESSING_DOCUMENT_SENSITIVE_FIELD'
  | 'CDB101_PROCESSING_DOCUMENT_UNSAFE_KEY'
  | 'CDB101_PROCESSING_DOCUMENT_SCHEMA_INVALID'
  | 'CDB101_PROCESSING_DOCUMENT_TOO_LARGE'
  | 'CDB101_PROCESSING_DOCUMENT_TOO_DEEP'
  | 'CDB101_PROCESSING_FILE_UNAVAILABLE'
  | 'CDB101_PROCESSING_FILE_INSIDE_REPOSITORY'
  | 'CDB101_PROCESSING_FILE_PROTECTION_INVALID'
  | 'CDB101_PROCESSING_SCHEMA_UNSUPPORTED'
  | 'CDB101_PROCESSING_ID_INVALID'
  | 'CDB101_PROCESSING_SCOPE_INVALID'
  | 'CDB101_PROCESSING_CHECK_SCOPE_INVALID'
  | 'CDB101_PROCESSING_COUNT_INVALID'
  | 'CDB101_PROCESSING_TABLE_SCOPE_INVALID'
  | 'CDB101_PROCESSING_READ_ONLY_PROOF_INVALID'
  | 'CDB101_PROCESSING_CHRONOLOGY_INVALID'
  | 'CDB101_PROCESSING_BINDING_INVALID'
  | 'CDB101_PROCESSING_AUTHORIZATION_INVALID'
  | 'CDB101_PROCESSING_AUTHORIZATION_BINDING_MISMATCH'
  | 'CDB101_PROCESSING_AUTHORIZATION_TIMING_INVALID';

export interface ReportingProcessingIssue {
  code: ReportingProcessingIssueCode;
  gate: 'document' | 'file' | 'evidence' | 'authorization';
  severity: 'blocker';
}

export interface ReportingProcessingDocumentResult {
  documentReady: boolean;
  evidence: ReportingProcessingEvidence | null;
  issues: ReportingProcessingIssue[];
}

export interface ReportingProcessingReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  evidenceReady: boolean;
  authorizationBound: boolean;
  shadowFlagReady: boolean;
  issueCount: number;
  issueCodes: ReportingProcessingIssueCode[];
  checkCount: number;
  observedTableCount: number;
  queryCount: number;
  unresolvedCriticalExceptionCount: number;
  blockedOutboxCount: number;
  blockedAccountingCount: number;
  duplicatePublicIdCount: number;
  unsafeIntegerCount: number;
  tenantIsolationViolationCount: number;
  secondPassInsertedRowCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface PreparedReportingProcessingEvidence {
  evidence: ReportingProcessingEvidence | null;
  receipt: ReportingProcessingReceipt;
}

export interface ReportingProcessingCliOptions {
  evidencePath: string;
  authorizationPath: string;
  atUtc?: string;
}

const nullableString = z.string().nullable();
const nullableSafeInteger = z.number().int().refine(Number.isSafeInteger).nullable();
const safeInteger = z.number().int().refine(Number.isSafeInteger);

const scopeSchema = z.object({
  productionDatabaseId: nullableString,
  tenantId: nullableString,
  domain: nullableString,
  stage: nullableString,
  migrationCommandId: nullableString,
  importCommandId: nullableString,
  featureFlagCommandId: nullableString,
  featureFlagEffectiveAtUtc: nullableString,
  authorizationExpiresAtUtc: nullableString,
  deterministicRunId: nullableString,
  bundleSha256: nullableString,
  manifestSha256: nullableString,
  sourceExportSha256: nullableString,
  allowedTables: z.array(z.string()),
  migrationsCompletedAtUtc: nullableString,
  importCompletedAtUtc: nullableString,
  secondPassCompletedAtUtc: nullableString,
  observationStartedAtUtc: nullableString,
  observationEndedAtUtc: nullableString,
}).strict();

const checkSchema = z.object({
  checkId: z.string(),
  observedCount: nullableSafeInteger,
  completedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const readOnlyProofSchema = z.object({
  queryCount: nullableSafeInteger,
  allQueriesReadOnly: z.boolean(),
  changedDbTrueCount: nullableSafeInteger,
  rowsWritten: nullableSafeInteger,
  writeStatementCount: nullableSafeInteger,
  mutationCount: nullableSafeInteger,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const evidenceSchema = z.object({
  schemaVersion: safeInteger,
  authorizationId: nullableString,
  evidenceId: nullableString,
  generatedAtUtc: nullableString,
  scope: scopeSchema,
  observedTableNames: z.array(z.string()),
  checks: z.array(checkSchema),
  readOnlyProof: readOnlyProofSchema,
}).strict();

const SENSITIVE_KEYS = new Set([
  'authorizationheader', 'headers', 'cookie', 'cookies', 'token', 'apitoken', 'accesstoken',
  'refreshtoken', 'password', 'secret', 'clientsecret', 'privatekey', 'rawbody', 'responsebody',
  'rawresponse', 'rawoutput', 'commandoutput', 'signedurl', 'accountid', 'zoneid', 'email',
  'filepath', 'directorypath', 'artifactpath', 'bundlepath', 'logpath', 'patientid', 'patientname',
  'practitionerid', 'doctorid', 'phone', 'address', 'dateofbirth', 'nationalid',
  'medicalrecordnumber', 'rowdata', 'rows', 'queryoutput',
]);

function issue(
  code: ReportingProcessingIssueCode,
  gate: ReportingProcessingIssue['gate'] = 'evidence',
): ReportingProcessingIssue {
  return { code, gate, severity: 'blocker' };
}

function documentFailure(...issues: ReportingProcessingIssue[]): ReportingProcessingDocumentResult {
  return { documentReady: false, evidence: null, issues };
}

function mapProtectedIssue(input: ProtectedJsonDocumentIssue): ReportingProcessingIssue {
  const map = {
    INVALID_JSON: 'CDB101_PROCESSING_DOCUMENT_INVALID_JSON',
    DUPLICATE_KEY: 'CDB101_PROCESSING_DOCUMENT_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB101_PROCESSING_DOCUMENT_UNSAFE_KEY',
    TOO_LARGE: 'CDB101_PROCESSING_DOCUMENT_TOO_LARGE',
    TOO_DEEP: 'CDB101_PROCESSING_DOCUMENT_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB101_PROCESSING_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB101_PROCESSING_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB101_PROCESSING_FILE_PROTECTION_INVALID',
  } as const;
  return issue(map[input.code], input.gate);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_:\-]{2,191}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactStringArray(values: readonly string[], expected: readonly string[]): boolean {
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

function countFor(evidence: ReportingProcessingEvidence, checkId: ReportingProcessingCheckId): number {
  const observed = evidence.checks.find((item) => item.checkId === checkId)?.observedCount;
  return nonNegativeInteger(observed) ? observed : 0;
}

export function parseReportingProcessingEvidenceValue(
  value: unknown,
): ReportingProcessingDocumentResult {
  if (containsNormalizedKey(value, SENSITIVE_KEYS)) {
    return documentFailure(issue('CDB101_PROCESSING_DOCUMENT_SENSITIVE_FIELD', 'document'));
  }
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((item) => item.code === 'unrecognized_keys');
    return documentFailure(issue(
      unknown ? 'CDB101_PROCESSING_DOCUMENT_UNKNOWN_FIELD' : 'CDB101_PROCESSING_DOCUMENT_SCHEMA_INVALID',
      'document',
    ));
  }
  return {
    documentReady: true,
    evidence: parsed.data as ReportingProcessingEvidence,
    issues: [],
  };
}

export function parseReportingProcessingEvidenceJson(text: string): ReportingProcessingDocumentResult {
  const strict = parseStrictJsonDocument(text, {
    maxBytes: MAX_REPORTING_PROCESSING_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_PROCESSING_EVIDENCE_DEPTH,
  });
  if (!strict.ready) return documentFailure(...strict.issues.map(mapProtectedIssue));
  return parseReportingProcessingEvidenceValue(strict.value);
}

function validateEvidence(
  input: ReportingProcessingEvidence,
  atUtc: string,
): ReportingProcessingIssue[] {
  const codes = new Set<ReportingProcessingIssueCode>();
  const add = (code: ReportingProcessingIssueCode): void => { codes.add(code); };

  if (input.schemaVersion !== 1) add('CDB101_PROCESSING_SCHEMA_UNSUPPORTED');
  if (!safeIdentifier(input.authorizationId) || !safeIdentifier(input.evidenceId)) {
    add('CDB101_PROCESSING_ID_INVALID');
  }

  const scopeTimes = {
    migrations: parseUtc(input.scope.migrationsCompletedAtUtc),
    imported: parseUtc(input.scope.importCompletedAtUtc),
    secondPass: parseUtc(input.scope.secondPassCompletedAtUtc),
    observationStart: parseUtc(input.scope.observationStartedAtUtc),
    observationEnd: parseUtc(input.scope.observationEndedAtUtc),
    featureFlagEffective: parseUtc(input.scope.featureFlagEffectiveAtUtc),
    authorizationExpires: parseUtc(input.scope.authorizationExpiresAtUtc),
    generated: parseUtc(input.generatedAtUtc),
    at: parseUtc(atUtc),
  };

  if (
    !nonEmpty(input.scope.productionDatabaseId)
    || input.scope.tenantId !== CDB101_CANARY_TENANT_ID
    || input.scope.domain !== 'reporting'
    || input.scope.stage !== 'post_import_pre_shadow'
    || !nonEmpty(input.scope.migrationCommandId)
    || !nonEmpty(input.scope.importCommandId)
    || !nonEmpty(input.scope.featureFlagCommandId)
    || scopeTimes.featureFlagEffective === null
    || scopeTimes.authorizationExpires === null
    || !safeIdentifier(input.scope.deterministicRunId)
    || !isSha256(input.scope.bundleSha256)
    || !isSha256(input.scope.manifestSha256)
    || !isSha256(input.scope.sourceExportSha256)
    || input.scope.allowedTables.length === 0
    || input.scope.allowedTables.some((table) => !safeIdentifier(table))
  ) add('CDB101_PROCESSING_SCOPE_INVALID');

  const checkIds = input.checks.map((item) => item.checkId);
  if (!exactStringArray(checkIds, CDB101_PROCESSING_CHECK_IDS)) {
    add('CDB101_PROCESSING_CHECK_SCOPE_INVALID');
  }

  const checkTimes: number[] = [];
  for (const item of input.checks) {
    const completedAt = parseUtc(item.completedAtUtc);
    if (completedAt !== null) checkTimes.push(completedAt);
    if (!nonNegativeInteger(item.observedCount)) add('CDB101_PROCESSING_COUNT_INVALID');
    if (
      completedAt === null
      || !safeIdentifier(item.evidenceId)
      || !isSha256(item.evidenceSha256)
    ) add('CDB101_PROCESSING_CHECK_SCOPE_INVALID');
  }

  if (
    input.observedTableNames.length === 0
    || !exactStringArray(input.observedTableNames, input.scope.allowedTables)
    || input.observedTableNames.some((table) => !safeIdentifier(table))
  ) add('CDB101_PROCESSING_TABLE_SCOPE_INVALID');

  if (
    !positiveInteger(input.readOnlyProof.queryCount)
    || !input.readOnlyProof.allQueriesReadOnly
    || input.readOnlyProof.changedDbTrueCount !== 0
    || input.readOnlyProof.rowsWritten !== 0
    || input.readOnlyProof.writeStatementCount !== 0
    || input.readOnlyProof.mutationCount !== 0
    || !safeIdentifier(input.readOnlyProof.evidenceId)
    || !isSha256(input.readOnlyProof.evidenceSha256)
  ) add('CDB101_PROCESSING_READ_ONLY_PROOF_INVALID');

  const ids = [
    input.evidenceId,
    ...input.checks.map((item) => item.evidenceId),
    input.readOnlyProof.evidenceId,
  ].filter(nonEmpty);
  const hashes = [
    ...input.checks.map((item) => item.evidenceSha256),
    input.readOnlyProof.evidenceSha256,
  ].filter(nonEmpty);
  if (
    ids.length !== CDB101_PROCESSING_CHECK_IDS.length + 2
    || new Set(ids).size !== ids.length
    || hashes.length !== CDB101_PROCESSING_CHECK_IDS.length + 1
    || new Set(hashes).size !== hashes.length
  ) add('CDB101_PROCESSING_BINDING_INVALID');

  if (
    Object.values(scopeTimes).some((value) => value === null)
    || scopeTimes.migrations! > scopeTimes.imported!
    || scopeTimes.imported! > scopeTimes.secondPass!
    || scopeTimes.secondPass! > scopeTimes.observationStart!
    || checkTimes.length !== CDB101_PROCESSING_CHECK_IDS.length
    || checkTimes.some((time) => time < scopeTimes.observationStart! || time > scopeTimes.observationEnd!)
    || scopeTimes.observationStart! > scopeTimes.observationEnd!
    || scopeTimes.observationEnd! > scopeTimes.generated!
    || scopeTimes.generated! > scopeTimes.at!
    || scopeTimes.observationEnd! > scopeTimes.featureFlagEffective!
    || scopeTimes.generated! > scopeTimes.authorizationExpires!
    || scopeTimes.at! > scopeTimes.authorizationExpires!
  ) add('CDB101_PROCESSING_CHRONOLOGY_INVALID');

  return [...codes].map((code) => issue(code));
}

function validateAuthorizationBinding(
  input: ReportingProcessingEvidence,
  authorization: ReportingCutoverAuthorization,
  atUtc: string,
): ReportingProcessingIssue[] {
  const codes = new Set<ReportingProcessingIssueCode>();
  const add = (code: ReportingProcessingIssueCode): void => { codes.add(code); };
  const semantic = validateReportingCutoverAuthorization(authorization, atUtc);
  if (!semantic.executionReady) add('CDB101_PROCESSING_AUTHORIZATION_INVALID');

  if (
    input.authorizationId !== authorization.authorizationId
    || input.scope.productionDatabaseId !== authorization.productionDatabase.id
    || input.scope.tenantId !== authorization.featureFlagPlan.tenantId
    || authorization.authorizedTenantIds.length !== 1
    || input.scope.tenantId !== authorization.authorizedTenantIds[0]
    || input.scope.domain !== authorization.authorizedDomain
    || input.scope.domain !== authorization.featureFlagPlan.domain
    || input.scope.migrationCommandId !== authorization.migrations.commandId
    || input.scope.importCommandId !== authorization.productionImport.commandId
    || input.scope.featureFlagCommandId !== authorization.featureFlagPlan.commandId
    || input.scope.featureFlagEffectiveAtUtc !== authorization.featureFlagPlan.effectiveAtUtc
    || input.scope.authorizationExpiresAtUtc !== authorization.expiresAtUtc
    || input.scope.deterministicRunId !== authorization.productionImport.deterministicRunId
    || input.scope.bundleSha256 !== authorization.productionImport.bundleSha256
    || input.scope.manifestSha256 !== authorization.productionImport.manifestSha256
    || input.scope.sourceExportSha256 !== authorization.productionImport.sourceExportSha256
    || !exactStringArray(input.scope.allowedTables, authorization.productionImport.allowedTables)
    || !exactStringArray(input.observedTableNames, authorization.productionImport.allowedTables)
  ) add('CDB101_PROCESSING_AUTHORIZATION_BINDING_MISMATCH');

  const maintenanceStart = parseUtc(authorization.maintenanceWindowStartUtc);
  const migrationsCompleted = parseUtc(input.scope.migrationsCompletedAtUtc);
  const observationEnded = parseUtc(input.scope.observationEndedAtUtc);
  const featureFlagEffective = parseUtc(authorization.featureFlagPlan.effectiveAtUtc);
  const generatedAt = parseUtc(input.generatedAtUtc);
  const validationAt = parseUtc(atUtc);
  const expiresAt = parseUtc(authorization.expiresAtUtc);
  if (
    maintenanceStart === null
    || migrationsCompleted === null
    || observationEnded === null
    || featureFlagEffective === null
    || generatedAt === null
    || validationAt === null
    || expiresAt === null
    || migrationsCompleted < maintenanceStart
    || observationEnded > featureFlagEffective
    || generatedAt > expiresAt
    || validationAt > expiresAt
  ) add('CDB101_PROCESSING_AUTHORIZATION_TIMING_INVALID');

  return [...codes].map((code) => issue(code, 'authorization'));
}

function emptyReceipt(
  documentReady: boolean,
  issues: ReportingProcessingIssue[],
): ReportingProcessingReceipt {
  return {
    schemaVersion: 1,
    documentReady,
    evidenceReady: false,
    authorizationBound: false,
    shadowFlagReady: false,
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    checkCount: 0,
    observedTableCount: 0,
    queryCount: 0,
    unresolvedCriticalExceptionCount: 0,
    blockedOutboxCount: 0,
    blockedAccountingCount: 0,
    duplicatePublicIdCount: 0,
    unsafeIntegerCount: 0,
    tenantIsolationViolationCount: 0,
    secondPassInsertedRowCount: 0,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

function buildReceipt(
  evidence: ReportingProcessingEvidence,
  evidenceIssues: ReportingProcessingIssue[],
  authorizationIssues: ReportingProcessingIssue[],
): ReportingProcessingReceipt {
  const issues = [...evidenceIssues, ...authorizationIssues];
  const evidenceReady = evidenceIssues.length === 0;
  const authorizationBound = authorizationIssues.length === 0;
  const allCountsZero = evidence.checks.length === CDB101_PROCESSING_CHECK_IDS.length
    && evidence.checks.every((item) => item.observedCount === 0);
  return {
    schemaVersion: 1,
    documentReady: true,
    evidenceReady,
    authorizationBound,
    shadowFlagReady: evidenceReady && authorizationBound && allCountsZero,
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    checkCount: evidence.checks.length,
    observedTableCount: evidence.observedTableNames.length,
    queryCount: positiveInteger(evidence.readOnlyProof.queryCount) ? evidence.readOnlyProof.queryCount : 0,
    unresolvedCriticalExceptionCount: countFor(evidence, 'unresolved_critical_exceptions'),
    blockedOutboxCount: countFor(evidence, 'blocked_outbox'),
    blockedAccountingCount: countFor(evidence, 'blocked_accounting'),
    duplicatePublicIdCount: countFor(evidence, 'duplicate_public_ids'),
    unsafeIntegerCount: countFor(evidence, 'unsafe_integer_amounts'),
    tenantIsolationViolationCount: countFor(evidence, 'tenant_isolation'),
    secondPassInsertedRowCount: countFor(evidence, 'second_pass_new_rows'),
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

function prepareWithoutAuthorization(
  evidence: ReportingProcessingEvidence,
  atUtc: string,
): PreparedReportingProcessingEvidence {
  const evidenceIssues = validateEvidence(evidence, atUtc);
  return {
    evidence,
    receipt: buildReceipt(
      evidence,
      evidenceIssues,
      [issue('CDB101_PROCESSING_AUTHORIZATION_INVALID', 'authorization')],
    ),
  };
}

export function prepareReportingProcessingEvidence(
  input: ReportingProcessingEvidence,
  authorization: ReportingCutoverAuthorization,
  atUtc: string = new Date().toISOString(),
): PreparedReportingProcessingEvidence {
  const parsed = parseReportingProcessingEvidenceValue(input);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  const evidenceIssues = validateEvidence(parsed.evidence, atUtc);
  const authorizationIssues = validateAuthorizationBinding(parsed.evidence, authorization, atUtc);
  return {
    evidence: parsed.evidence,
    receipt: buildReceipt(parsed.evidence, evidenceIssues, authorizationIssues),
  };
}

function loadProtectedReportingProcessingEvidence(
  evidencePath: string,
  repositoryRoot: string,
): ReportingProcessingDocumentResult {
  const strict = loadProtectedJsonDocument(evidencePath, repositoryRoot, {
    maxBytes: MAX_REPORTING_PROCESSING_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_PROCESSING_EVIDENCE_DEPTH,
  });
  if (!strict.ready) return documentFailure(...strict.issues.map(mapProtectedIssue));
  return parseReportingProcessingEvidenceValue(strict.value);
}

export function prepareProtectedReportingProcessingEvidenceForAuthorization(
  evidencePath: string,
  repositoryRoot: string,
  authorization: ReportingCutoverAuthorization,
  atUtc: string = new Date().toISOString(),
): PreparedReportingProcessingEvidence {
  const parsed = loadProtectedReportingProcessingEvidence(evidencePath, repositoryRoot);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  return prepareReportingProcessingEvidence(parsed.evidence, authorization, atUtc);
}

export function prepareProtectedReportingProcessingEvidence(
  evidencePath: string,
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedReportingProcessingEvidence {
  const parsed = loadProtectedReportingProcessingEvidence(evidencePath, repositoryRoot);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  const preparedAuthorization = prepareProtectedReportingCutoverAuthorization(
    authorizationPath,
    repositoryRoot,
    atUtc,
  );
  if (!preparedAuthorization.authorization) {
    return prepareWithoutAuthorization(parsed.evidence, atUtc);
  }
  return prepareReportingProcessingEvidence(parsed.evidence, preparedAuthorization.authorization, atUtc);
}

export function evaluateProtectedReportingProcessingEvidence(
  evidencePath: string,
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): ReportingProcessingReceipt {
  return prepareProtectedReportingProcessingEvidence(
    evidencePath,
    authorizationPath,
    repositoryRoot,
    atUtc,
  ).receipt;
}

export function parseReportingProcessingEvidenceArgs(args: string[]): ReportingProcessingCliOptions {
  let evidencePath = '';
  let authorizationPath = '';
  let atUtc: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg !== '--evidence' && arg !== '--authorization' && arg !== '--at-utc') {
      throw new Error('Unknown argument.');
    }
    if (seen.has(arg)) throw new Error('Duplicate argument.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
    if (arg === '--evidence') evidencePath = value;
    else if (arg === '--authorization') authorizationPath = value;
    else atUtc = value;
    seen.add(arg);
    index += 1;
  }
  if (!evidencePath) throw new Error('--evidence is required.');
  if (!authorizationPath) throw new Error('--authorization is required.');
  return { evidencePath, authorizationPath, atUtc };
}

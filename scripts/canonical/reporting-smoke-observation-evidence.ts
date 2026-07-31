import { z } from 'zod';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_REQUIRED_SMOKE_SCENARIOS,
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

export const MAX_REPORTING_SMOKE_OBSERVATION_EVIDENCE_BYTES = 256 * 1024;
export const MAX_REPORTING_SMOKE_OBSERVATION_EVIDENCE_DEPTH = 64;

export interface ReportingSmokeObservationEvidence {
  schemaVersion: 1;
  authorizationSchemaVersion: 2 | 3 | 4;
  ownerModel: 'four_person_strict' | 'two_person_constrained' | 'single_operator_risk_accepted';
  authorizationId: string | null;
  evidenceId: string | null;
  generatedAtUtc: string | null;
  scope: {
    tenantId: string | null;
    domain: string | null;
    mode: string | null;
    smokePlanId: string | null;
    observationStartedAtUtc: string | null;
    observationEndedAtUtc: string | null;
  };
  scenarios: Array<{
    scenarioId: string;
    status: 'passed' | 'failed';
    completedAtUtc: string | null;
    assertionCount: number | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  }>;
  parity: {
    maxAbsoluteDeltaMinor: number | null;
    maxRelativeDelta: number | null;
    observedMaxAbsoluteDeltaMinor: number | null;
    observedMaxRelativeDelta: number | null;
    comparisonCount: number | null;
    allWithinThreshold: boolean;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  performance: {
    maxP95LatencyMs: number | null;
    maxErrorRate: number | null;
    observedP95LatencyMs: number | null;
    observedErrorRate: number | null;
    sampleCount: number | null;
    thresholdsMet: boolean;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  tenantIsolation: {
    passed: boolean;
    crossTenantRowsObserved: number | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  roleDenial: {
    passed: boolean;
    deniedAttemptCount: number | null;
    unexpectedAllowedCount: number | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  readOnlyProof: {
    passed: boolean;
    projectionOnlyConfirmed: boolean;
    writeStatementCount: number | null;
    mutationCount: number | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  observationDecision: {
    primaryObserverId: string | null;
    backupObserverId: string | null;
    primaryConfirmed: boolean;
    backupConfirmed: boolean;
    decision: 'go' | 'no_go';
    decidedAtUtc: string | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  recoveryTiming: {
    policyReviewedAtUtc: string | null;
    measurementKind: 'rehearsal' | 'controlled_drill';
    measuredAtUtc: string | null;
    maxRollbackDurationMs: number | null;
    maxReopenDurationMs: number | null;
    rollbackMeasuredMs: number | null;
    reopenMeasuredMs: number | null;
    rollbackWithinThreshold: boolean;
    reopenWithinThreshold: boolean;
    policyEvidenceId: string | null;
    policyEvidenceSha256: string | null;
    timingEvidenceId: string | null;
    timingEvidenceSha256: string | null;
  };
}

export type ReportingSmokeObservationIssueCode =
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_INVALID_JSON'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_DUPLICATE_KEY'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_UNKNOWN_FIELD'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_SENSITIVE_FIELD'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_UNSAFE_KEY'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_SCHEMA_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_TOO_LARGE'
  | 'CDB101_SMOKE_OBSERVATION_DOCUMENT_TOO_DEEP'
  | 'CDB101_SMOKE_OBSERVATION_FILE_UNAVAILABLE'
  | 'CDB101_SMOKE_OBSERVATION_FILE_INSIDE_REPOSITORY'
  | 'CDB101_SMOKE_OBSERVATION_FILE_PROTECTION_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_SCHEMA_UNSUPPORTED'
  | 'CDB101_SMOKE_OBSERVATION_ID_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_SCOPE_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_SCENARIO_SCOPE_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_SCENARIO_RESULT_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_PARITY_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_PERFORMANCE_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_TENANT_ISOLATION_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_ROLE_DENIAL_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_READ_ONLY_PROOF_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_DECISION_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_RECOVERY_TIMING_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_CHRONOLOGY_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_BINDING_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_INVALID'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_ID_MISMATCH'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_SCOPE_MISMATCH'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_PLAN_MISMATCH'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_THRESHOLD_MISMATCH'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_OBSERVER_MISMATCH'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_RECOVERY_POLICY_MISMATCH'
  | 'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_TIMING_INVALID';

export interface ReportingSmokeObservationIssue {
  code: ReportingSmokeObservationIssueCode;
  gate: 'document' | 'file' | 'evidence' | 'authorization';
  severity: 'blocker';
}

export interface ReportingSmokeObservationDocumentResult {
  documentReady: boolean;
  evidence: ReportingSmokeObservationEvidence | null;
  issues: ReportingSmokeObservationIssue[];
}

export interface ReportingSmokeObservationReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  evidenceReady: boolean;
  authorizationBound: boolean;
  promotionReady: boolean;
  issueCount: number;
  issueCodes: ReportingSmokeObservationIssueCode[];
  scenarioCount: number;
  passedScenarioCount: number;
  parityComparisonCount: number;
  observedMaxAbsoluteDeltaMinor: number;
  observedP95LatencyMs: number;
  observedErrorRate: number;
  rollbackMeasuredMs: number;
  reopenMeasuredMs: number;
  decision: 'go' | 'no_go' | 'unavailable';
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface PreparedReportingSmokeObservationEvidence {
  evidence: ReportingSmokeObservationEvidence | null;
  receipt: ReportingSmokeObservationReceipt;
}

export interface ReportingSmokeObservationCliOptions {
  evidencePath: string;
  authorizationPath: string;
  atUtc?: string;
}

const nullableString = z.string().nullable();
const nullableSafeInteger = z.number().int().refine(Number.isSafeInteger).nullable();
const nullableNumber = z.number().finite().nullable();
const safeInteger = z.number().int().refine(Number.isSafeInteger);

const scopeSchema = z.object({
  tenantId: nullableString,
  domain: nullableString,
  mode: nullableString,
  smokePlanId: nullableString,
  observationStartedAtUtc: nullableString,
  observationEndedAtUtc: nullableString,
}).strict();

const scenarioSchema = z.object({
  scenarioId: z.string(),
  status: z.enum(['passed', 'failed']),
  completedAtUtc: nullableString,
  assertionCount: nullableSafeInteger,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const paritySchema = z.object({
  maxAbsoluteDeltaMinor: nullableSafeInteger,
  maxRelativeDelta: nullableNumber,
  observedMaxAbsoluteDeltaMinor: nullableSafeInteger,
  observedMaxRelativeDelta: nullableNumber,
  comparisonCount: nullableSafeInteger,
  allWithinThreshold: z.boolean(),
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const performanceSchema = z.object({
  maxP95LatencyMs: nullableSafeInteger,
  maxErrorRate: nullableNumber,
  observedP95LatencyMs: nullableSafeInteger,
  observedErrorRate: nullableNumber,
  sampleCount: nullableSafeInteger,
  thresholdsMet: z.boolean(),
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const tenantIsolationSchema = z.object({
  passed: z.boolean(),
  crossTenantRowsObserved: nullableSafeInteger,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const roleDenialSchema = z.object({
  passed: z.boolean(),
  deniedAttemptCount: nullableSafeInteger,
  unexpectedAllowedCount: nullableSafeInteger,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const readOnlyProofSchema = z.object({
  passed: z.boolean(),
  projectionOnlyConfirmed: z.boolean(),
  writeStatementCount: nullableSafeInteger,
  mutationCount: nullableSafeInteger,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const observationDecisionSchema = z.object({
  primaryObserverId: nullableString,
  backupObserverId: nullableString,
  primaryConfirmed: z.boolean(),
  backupConfirmed: z.boolean(),
  decision: z.enum(['go', 'no_go']),
  decidedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
}).strict();

const recoveryTimingSchema = z.object({
  policyReviewedAtUtc: nullableString,
  measurementKind: z.enum(['rehearsal', 'controlled_drill']),
  measuredAtUtc: nullableString,
  maxRollbackDurationMs: nullableSafeInteger,
  maxReopenDurationMs: nullableSafeInteger,
  rollbackMeasuredMs: nullableSafeInteger,
  reopenMeasuredMs: nullableSafeInteger,
  rollbackWithinThreshold: z.boolean(),
  reopenWithinThreshold: z.boolean(),
  policyEvidenceId: nullableString,
  policyEvidenceSha256: nullableString,
  timingEvidenceId: nullableString,
  timingEvidenceSha256: nullableString,
}).strict();

const evidenceSchema = z.object({
  schemaVersion: safeInteger,
  authorizationSchemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  ownerModel: z.enum(['four_person_strict', 'two_person_constrained', 'single_operator_risk_accepted']),
  authorizationId: nullableString,
  evidenceId: nullableString,
  generatedAtUtc: nullableString,
  scope: scopeSchema,
  scenarios: z.array(scenarioSchema),
  parity: paritySchema,
  performance: performanceSchema,
  tenantIsolation: tenantIsolationSchema,
  roleDenial: roleDenialSchema,
  readOnlyProof: readOnlyProofSchema,
  observationDecision: observationDecisionSchema,
  recoveryTiming: recoveryTimingSchema,
}).strict();

const SENSITIVE_KEYS = new Set([
  'authorizationheader', 'headers', 'cookie', 'cookies', 'token', 'apitoken', 'accesstoken',
  'refreshtoken', 'password', 'secret', 'clientsecret', 'privatekey', 'rawbody', 'responsebody',
  'rawresponse', 'rawoutput', 'commandoutput', 'signedurl', 'accountid', 'zoneid', 'email',
  'filepath', 'directorypath', 'artifactpath', 'bundlepath', 'logpath', 'patientid', 'patientname',
  'phone', 'address', 'dateofbirth', 'nationalid', 'medicalrecordnumber',
]);

function issue(
  code: ReportingSmokeObservationIssueCode,
  gate: 'document' | 'file' | 'evidence' | 'authorization' = 'evidence',
): ReportingSmokeObservationIssue {
  return { code, gate, severity: 'blocker' };
}

function documentFailure(
  ...issues: ReportingSmokeObservationIssue[]
): ReportingSmokeObservationDocumentResult {
  return { documentReady: false, evidence: null, issues };
}

function mapProtectedIssue(input: ProtectedJsonDocumentIssue): ReportingSmokeObservationIssue {
  const map = {
    INVALID_JSON: 'CDB101_SMOKE_OBSERVATION_DOCUMENT_INVALID_JSON',
    DUPLICATE_KEY: 'CDB101_SMOKE_OBSERVATION_DOCUMENT_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB101_SMOKE_OBSERVATION_DOCUMENT_UNSAFE_KEY',
    TOO_LARGE: 'CDB101_SMOKE_OBSERVATION_DOCUMENT_TOO_LARGE',
    TOO_DEEP: 'CDB101_SMOKE_OBSERVATION_DOCUMENT_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB101_SMOKE_OBSERVATION_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB101_SMOKE_OBSERVATION_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB101_SMOKE_OBSERVATION_FILE_PROTECTION_INVALID',
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

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function boundedRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactStringArray(values: readonly string[], expected: readonly string[]): boolean {
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

export function parseReportingSmokeObservationEvidenceValue(
  value: unknown,
): ReportingSmokeObservationDocumentResult {
  if (containsNormalizedKey(value, SENSITIVE_KEYS)) {
    return documentFailure(issue('CDB101_SMOKE_OBSERVATION_DOCUMENT_SENSITIVE_FIELD', 'document'));
  }
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((item) => item.code === 'unrecognized_keys');
    return documentFailure(issue(
      unknown
        ? 'CDB101_SMOKE_OBSERVATION_DOCUMENT_UNKNOWN_FIELD'
        : 'CDB101_SMOKE_OBSERVATION_DOCUMENT_SCHEMA_INVALID',
      'document',
    ));
  }
  return {
    documentReady: true,
    evidence: parsed.data as ReportingSmokeObservationEvidence,
    issues: [],
  };
}

export function parseReportingSmokeObservationEvidenceJson(
  text: string,
): ReportingSmokeObservationDocumentResult {
  const strict = parseStrictJsonDocument(text, {
    maxBytes: MAX_REPORTING_SMOKE_OBSERVATION_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_SMOKE_OBSERVATION_EVIDENCE_DEPTH,
  });
  if (!strict.ready) return documentFailure(...strict.issues.map(mapProtectedIssue));
  return parseReportingSmokeObservationEvidenceValue(strict.value);
}

function validateEvidence(
  input: ReportingSmokeObservationEvidence,
  atUtc: string,
): ReportingSmokeObservationIssue[] {
  const codes = new Set<ReportingSmokeObservationIssueCode>();
  const add = (code: ReportingSmokeObservationIssueCode): void => { codes.add(code); };

  if (input.schemaVersion !== 1) add('CDB101_SMOKE_OBSERVATION_SCHEMA_UNSUPPORTED');
  if (
    (input.authorizationSchemaVersion === 2 && input.ownerModel !== 'four_person_strict')
    || (input.authorizationSchemaVersion === 3 && input.ownerModel !== 'two_person_constrained')
    || (input.authorizationSchemaVersion === 4 && input.ownerModel !== 'single_operator_risk_accepted')
  ) {
    add('CDB101_SMOKE_OBSERVATION_SCOPE_INVALID');
  }
  if (!safeIdentifier(input.authorizationId) || !safeIdentifier(input.evidenceId)) {
    add('CDB101_SMOKE_OBSERVATION_ID_INVALID');
  }

  const observationStarted = parseUtc(input.scope.observationStartedAtUtc);
  const observationEnded = parseUtc(input.scope.observationEndedAtUtc);
  if (
    input.scope.tenantId !== CDB101_CANARY_TENANT_ID
    || input.scope.domain !== 'reporting'
    || input.scope.mode !== 'shadow'
    || !safeIdentifier(input.scope.smokePlanId)
    || observationStarted === null
    || observationEnded === null
  ) add('CDB101_SMOKE_OBSERVATION_SCOPE_INVALID');

  const scenarioIds = input.scenarios.map((scenario) => scenario.scenarioId);
  if (!exactStringArray(scenarioIds, CDB101_REQUIRED_SMOKE_SCENARIOS)) {
    add('CDB101_SMOKE_OBSERVATION_SCENARIO_SCOPE_INVALID');
  }

  const scenarioTimes: number[] = [];
  for (const scenario of input.scenarios) {
    const completed = parseUtc(scenario.completedAtUtc);
    if (completed !== null) scenarioTimes.push(completed);
    if (
      scenario.status !== 'passed'
      || completed === null
      || !positiveInteger(scenario.assertionCount)
      || !safeIdentifier(scenario.evidenceId)
      || !isSha256(scenario.evidenceSha256)
    ) add('CDB101_SMOKE_OBSERVATION_SCENARIO_RESULT_INVALID');
  }

  if (
    !nonNegativeInteger(input.parity.maxAbsoluteDeltaMinor)
    || !boundedRate(input.parity.maxRelativeDelta)
    || !nonNegativeInteger(input.parity.observedMaxAbsoluteDeltaMinor)
    || !boundedRate(input.parity.observedMaxRelativeDelta)
    || !positiveInteger(input.parity.comparisonCount)
    || input.parity.observedMaxAbsoluteDeltaMinor > input.parity.maxAbsoluteDeltaMinor
    || input.parity.observedMaxRelativeDelta > input.parity.maxRelativeDelta
    || !input.parity.allWithinThreshold
    || !safeIdentifier(input.parity.evidenceId)
    || !isSha256(input.parity.evidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_PARITY_INVALID');

  if (
    !positiveInteger(input.performance.maxP95LatencyMs)
    || !boundedRate(input.performance.maxErrorRate)
    || !nonNegativeInteger(input.performance.observedP95LatencyMs)
    || !boundedRate(input.performance.observedErrorRate)
    || !positiveInteger(input.performance.sampleCount)
    || input.performance.observedP95LatencyMs > input.performance.maxP95LatencyMs
    || input.performance.observedErrorRate > input.performance.maxErrorRate
    || !input.performance.thresholdsMet
    || !safeIdentifier(input.performance.evidenceId)
    || !isSha256(input.performance.evidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_PERFORMANCE_INVALID');

  if (
    !input.tenantIsolation.passed
    || input.tenantIsolation.crossTenantRowsObserved !== 0
    || !safeIdentifier(input.tenantIsolation.evidenceId)
    || !isSha256(input.tenantIsolation.evidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_TENANT_ISOLATION_INVALID');

  if (
    !input.roleDenial.passed
    || !positiveInteger(input.roleDenial.deniedAttemptCount)
    || input.roleDenial.unexpectedAllowedCount !== 0
    || !safeIdentifier(input.roleDenial.evidenceId)
    || !isSha256(input.roleDenial.evidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_ROLE_DENIAL_INVALID');

  if (
    !input.readOnlyProof.passed
    || !input.readOnlyProof.projectionOnlyConfirmed
    || input.readOnlyProof.writeStatementCount !== 0
    || input.readOnlyProof.mutationCount !== 0
    || !safeIdentifier(input.readOnlyProof.evidenceId)
    || !isSha256(input.readOnlyProof.evidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_READ_ONLY_PROOF_INVALID');

  const decidedAt = parseUtc(input.observationDecision.decidedAtUtc);
  const constrainedObservation = input.ownerModel !== 'four_person_strict';
  if (
    !safeIdentifier(input.observationDecision.primaryObserverId)
    || (
      constrainedObservation
        ? input.observationDecision.backupObserverId !== null
          || input.observationDecision.backupConfirmed !== false
        : !safeIdentifier(input.observationDecision.backupObserverId)
          || input.observationDecision.primaryObserverId === input.observationDecision.backupObserverId
          || !input.observationDecision.backupConfirmed
    )
    || !input.observationDecision.primaryConfirmed
    || decidedAt === null
    || !safeIdentifier(input.observationDecision.evidenceId)
    || !isSha256(input.observationDecision.evidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_DECISION_INVALID');

  const policyReviewedAt = parseUtc(input.recoveryTiming.policyReviewedAtUtc);
  const measuredAt = parseUtc(input.recoveryTiming.measuredAtUtc);
  if (
    policyReviewedAt === null
    || measuredAt === null
    || !positiveInteger(input.recoveryTiming.maxRollbackDurationMs)
    || !positiveInteger(input.recoveryTiming.maxReopenDurationMs)
    || !nonNegativeInteger(input.recoveryTiming.rollbackMeasuredMs)
    || !nonNegativeInteger(input.recoveryTiming.reopenMeasuredMs)
    || input.recoveryTiming.rollbackMeasuredMs > input.recoveryTiming.maxRollbackDurationMs
    || input.recoveryTiming.reopenMeasuredMs > input.recoveryTiming.maxReopenDurationMs
    || !input.recoveryTiming.rollbackWithinThreshold
    || !input.recoveryTiming.reopenWithinThreshold
    || !safeIdentifier(input.recoveryTiming.policyEvidenceId)
    || !isSha256(input.recoveryTiming.policyEvidenceSha256)
    || !safeIdentifier(input.recoveryTiming.timingEvidenceId)
    || !isSha256(input.recoveryTiming.timingEvidenceSha256)
  ) add('CDB101_SMOKE_OBSERVATION_RECOVERY_TIMING_INVALID');

  const generatedAt = parseUtc(input.generatedAtUtc);
  const now = parseUtc(atUtc);
  if (
    observationStarted === null
    || observationEnded === null
    || decidedAt === null
    || policyReviewedAt === null
    || measuredAt === null
    || generatedAt === null
    || now === null
    || policyReviewedAt > measuredAt
    || measuredAt > observationStarted
    || observationStarted > observationEnded
    || scenarioTimes.length !== CDB101_REQUIRED_SMOKE_SCENARIOS.length
    || scenarioTimes.some((time) => time < observationStarted || time > observationEnded)
    || observationEnded > decidedAt
    || decidedAt > generatedAt
    || generatedAt > now
  ) add('CDB101_SMOKE_OBSERVATION_CHRONOLOGY_INVALID');

  const ids = [
    input.evidenceId,
    ...input.scenarios.map((scenario) => scenario.evidenceId),
    input.parity.evidenceId,
    input.performance.evidenceId,
    input.tenantIsolation.evidenceId,
    input.roleDenial.evidenceId,
    input.readOnlyProof.evidenceId,
    input.observationDecision.evidenceId,
    input.recoveryTiming.policyEvidenceId,
    input.recoveryTiming.timingEvidenceId,
  ].filter(nonEmpty);
  const hashes = [
    ...input.scenarios.map((scenario) => scenario.evidenceSha256),
    input.parity.evidenceSha256,
    input.performance.evidenceSha256,
    input.tenantIsolation.evidenceSha256,
    input.roleDenial.evidenceSha256,
    input.readOnlyProof.evidenceSha256,
    input.observationDecision.evidenceSha256,
    input.recoveryTiming.policyEvidenceSha256,
    input.recoveryTiming.timingEvidenceSha256,
  ].filter(nonEmpty);
  if (
    ids.length !== CDB101_REQUIRED_SMOKE_SCENARIOS.length + 9
    || new Set(ids).size !== ids.length
    || hashes.length !== CDB101_REQUIRED_SMOKE_SCENARIOS.length + 8
    || new Set(hashes).size !== hashes.length
  ) add('CDB101_SMOKE_OBSERVATION_BINDING_INVALID');

  return [...codes].map((code) => issue(code));
}

function validateAuthorizationBinding(
  input: ReportingSmokeObservationEvidence,
  authorization: ReportingCutoverAuthorization,
  atUtc: string,
): ReportingSmokeObservationIssue[] {
  const codes = new Set<ReportingSmokeObservationIssueCode>();
  const add = (code: ReportingSmokeObservationIssueCode): void => { codes.add(code); };

  const semantic = validateReportingCutoverAuthorization(authorization, atUtc);
  if (!semantic.executionReady) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_INVALID');

  if (input.authorizationId !== authorization.authorizationId) {
    add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_ID_MISMATCH');
  }

  if (
    authorization.authorizedDomain !== input.scope.domain
    || authorization.authorizedTenantIds.length !== 1
    || authorization.authorizedTenantIds[0] !== input.scope.tenantId
    || authorization.featureFlagPlan.tenantId !== input.scope.tenantId
    || authorization.featureFlagPlan.domain !== input.scope.domain
    || authorization.featureFlagPlan.initialMode !== input.scope.mode
    || input.authorizationSchemaVersion !== authorization.schemaVersion
    || input.ownerModel !== (authorization.schemaVersion === 2 ? 'four_person_strict' : authorization.ownerModel)
  ) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_SCOPE_MISMATCH');

  if (
    input.scope.smokePlanId !== authorization.smoke.planId
    || !exactStringArray(input.scenarios.map((scenario) => scenario.scenarioId), authorization.smoke.requiredScenarios)
  ) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_PLAN_MISMATCH');

  if (
    input.performance.maxP95LatencyMs !== authorization.smoke.maxP95LatencyMs
    || input.performance.maxErrorRate !== authorization.smoke.maxErrorRate
  ) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_THRESHOLD_MISMATCH');

  if (
    input.observationDecision.primaryObserverId !== authorization.observationOwner.ownerId
    || input.observationDecision.backupObserverId !== authorization.observationOwner.backupOwnerId
  ) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_OBSERVER_MISMATCH');

  if (
    input.recoveryTiming.maxRollbackDurationMs !== authorization.rollbackPolicy.maxRollbackDurationMs
    || input.recoveryTiming.maxReopenDurationMs !== authorization.rollbackPolicy.maxReopenDurationMs
  ) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_RECOVERY_POLICY_MISMATCH');

  const policyReviewedAt = parseUtc(input.recoveryTiming.policyReviewedAtUtc);
  const measuredAt = parseUtc(input.recoveryTiming.measuredAtUtc);
  const shadowEffectiveAt = parseUtc(authorization.featureFlagPlan.effectiveAtUtc);
  const observationStartedAt = parseUtc(input.scope.observationStartedAtUtc);
  const decidedAt = parseUtc(input.observationDecision.decidedAtUtc);
  const generatedAt = parseUtc(input.generatedAtUtc);
  const expiresAt = parseUtc(authorization.expiresAtUtc);
  const validationAt = parseUtc(atUtc);
  if (
    policyReviewedAt === null
    || measuredAt === null
    || shadowEffectiveAt === null
    || observationStartedAt === null
    || decidedAt === null
    || generatedAt === null
    || expiresAt === null
    || validationAt === null
    || policyReviewedAt > measuredAt
    || measuredAt > shadowEffectiveAt
    || shadowEffectiveAt > observationStartedAt
    || decidedAt > expiresAt
    || generatedAt > expiresAt
    || validationAt > expiresAt
  ) add('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_TIMING_INVALID');

  return [...codes].map((code) => issue(code, 'authorization'));
}

function emptyReceipt(
  documentReady: boolean,
  issues: ReportingSmokeObservationIssue[],
): ReportingSmokeObservationReceipt {
  return {
    schemaVersion: 1,
    documentReady,
    evidenceReady: false,
    authorizationBound: false,
    promotionReady: false,
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    scenarioCount: 0,
    passedScenarioCount: 0,
    parityComparisonCount: 0,
    observedMaxAbsoluteDeltaMinor: 0,
    observedP95LatencyMs: 0,
    observedErrorRate: 0,
    rollbackMeasuredMs: 0,
    reopenMeasuredMs: 0,
    decision: 'unavailable',
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

function buildReceipt(
  evidence: ReportingSmokeObservationEvidence,
  evidenceIssues: ReportingSmokeObservationIssue[],
  authorizationIssues: ReportingSmokeObservationIssue[],
): ReportingSmokeObservationReceipt {
  const issues = [...evidenceIssues, ...authorizationIssues];
  const evidenceReady = evidenceIssues.length === 0;
  const authorizationBound = authorizationIssues.length === 0;
  return {
    schemaVersion: 1,
    documentReady: true,
    evidenceReady,
    authorizationBound,
    promotionReady: evidenceReady
      && authorizationBound
      && evidence.authorizationSchemaVersion === 2
      && evidence.observationDecision.decision === 'go',
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    scenarioCount: evidence.scenarios.length,
    passedScenarioCount: evidence.scenarios.filter((scenario) => scenario.status === 'passed').length,
    parityComparisonCount: positiveInteger(evidence.parity.comparisonCount)
      ? evidence.parity.comparisonCount : 0,
    observedMaxAbsoluteDeltaMinor: nonNegativeInteger(evidence.parity.observedMaxAbsoluteDeltaMinor)
      ? evidence.parity.observedMaxAbsoluteDeltaMinor : 0,
    observedP95LatencyMs: nonNegativeInteger(evidence.performance.observedP95LatencyMs)
      ? evidence.performance.observedP95LatencyMs : 0,
    observedErrorRate: boundedRate(evidence.performance.observedErrorRate)
      ? evidence.performance.observedErrorRate : 0,
    rollbackMeasuredMs: nonNegativeInteger(evidence.recoveryTiming.rollbackMeasuredMs)
      ? evidence.recoveryTiming.rollbackMeasuredMs : 0,
    reopenMeasuredMs: nonNegativeInteger(evidence.recoveryTiming.reopenMeasuredMs)
      ? evidence.recoveryTiming.reopenMeasuredMs : 0,
    decision: evidence.observationDecision.decision,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

function prepareEvidenceWithoutAuthorization(
  evidence: ReportingSmokeObservationEvidence,
  atUtc: string,
): PreparedReportingSmokeObservationEvidence {
  const evidenceIssues = validateEvidence(evidence, atUtc);
  const authorizationIssues = [issue('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_INVALID', 'authorization')];
  return {
    evidence,
    receipt: buildReceipt(evidence, evidenceIssues, authorizationIssues),
  };
}

export function prepareReportingSmokeObservationEvidence(
  input: ReportingSmokeObservationEvidence,
  authorization: ReportingCutoverAuthorization,
  atUtc: string = new Date().toISOString(),
): PreparedReportingSmokeObservationEvidence {
  const parsed = parseReportingSmokeObservationEvidenceValue(input);
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

export function prepareProtectedReportingSmokeObservationEvidence(
  evidencePath: string,
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedReportingSmokeObservationEvidence {
  const strict = loadProtectedJsonDocument(evidencePath, repositoryRoot, {
    maxBytes: MAX_REPORTING_SMOKE_OBSERVATION_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_SMOKE_OBSERVATION_EVIDENCE_DEPTH,
  });
  if (!strict.ready) {
    const issues = strict.issues.map(mapProtectedIssue);
    return { evidence: null, receipt: emptyReceipt(false, issues) };
  }
  const parsed = parseReportingSmokeObservationEvidenceValue(strict.value);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, receipt: emptyReceipt(false, parsed.issues) };
  }

  const preparedAuthorization = prepareProtectedReportingCutoverAuthorization(
    authorizationPath,
    repositoryRoot,
    atUtc,
  );
  if (!preparedAuthorization.authorization) {
    return prepareEvidenceWithoutAuthorization(parsed.evidence, atUtc);
  }
  return prepareReportingSmokeObservationEvidence(
    parsed.evidence,
    preparedAuthorization.authorization,
    atUtc,
  );
}

export function evaluateProtectedReportingSmokeObservationEvidence(
  evidencePath: string,
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): ReportingSmokeObservationReceipt {
  return prepareProtectedReportingSmokeObservationEvidence(
    evidencePath,
    authorizationPath,
    repositoryRoot,
    atUtc,
  ).receipt;
}

export function parseReportingSmokeObservationEvidenceArgs(
  args: string[],
): ReportingSmokeObservationCliOptions {
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

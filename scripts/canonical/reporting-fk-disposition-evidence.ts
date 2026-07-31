import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  type ReportingCutoverAuthorization,
  type ReportingForeignKeyAggregateGroup,
  type ReportingForeignKeyDispositionGroup,
} from './production-cutover-contract';
import {
  containsNormalizedKey,
  loadProtectedJsonDocument,
  parseStrictJsonDocument,
  type ProtectedJsonDocumentIssue,
} from './protected-json-document';

export const MAX_REPORTING_FK_EVIDENCE_BYTES = 256 * 1024;
export const MAX_REPORTING_FK_EVIDENCE_DEPTH = 64;

export interface ReportingForeignKeyObservation {
  captured: boolean;
  observationId: string | null;
  capturedAtUtc: string | null;
  queryId: 'pragma_foreign_key_check_grouped_v1';
  evidenceSha256: string | null;
  changedDb: boolean;
  rowsWritten: number;
  totalViolationCount: number;
  groups: ReportingForeignKeyAggregateGroup[];
}

export interface ReportingActiveForeignKeyRepair {
  childTable: string;
  parentTable: string;
  initialViolationCount: number;
  disposition: 'repair_required';
  completed: boolean;
  ownerId: string | null;
  completedAtUtc: string | null;
  repairStrategyId: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
  auditTrailEvidenceId: string | null;
  auditTrailSha256: string | null;
  affectedRowCount: number;
  hardDeletePerformed: boolean | null;
  remainingViolationCount: number;
  repairedViolationCount: number;
  waivedViolationCount: number;
}

export interface ReportingArchivalForeignKeyWaiver {
  childTable: string;
  parentTable: string;
  initialViolationCount: number;
  disposition: 'formal_waiver';
  approved: boolean;
  ownerId: string | null;
  approvedAtUtc: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
  waiverScope: 'archival_fk_only';
  archivalTableConfirmed: boolean;
  activeWriterDisabledConfirmed: boolean;
  excludedFromCanonicalImportConfirmed: boolean;
  excludedFromReportingConfirmed: boolean;
  removalPhase: string | null;
  remainingViolationCount: number;
  repairedViolationCount: number;
  waivedViolationCount: number;
}

export interface ReportingForeignKeyDispositionEvidence {
  schemaVersion: 1;
  evidenceId: string | null;
  generatedAtUtc: string | null;
  productionDatabase: {
    name: string | null;
    id: string | null;
  };
  domain: string | null;
  cutoverTenantId: string | null;
  beforeObservation: ReportingForeignKeyObservation;
  activeRepairs: ReportingActiveForeignKeyRepair[];
  archivalWaivers: ReportingArchivalForeignKeyWaiver[];
  afterObservation: ReportingForeignKeyObservation;
  totals: {
    repairedViolationCount: number;
    waivedViolationCount: number;
    remainingViolationCount: number;
    unknownViolationCount: number;
    activeFinancialWaivedViolationCount: number;
  };
}

export type ReportingForeignKeyEvidenceIssueCode =
  | 'CDB101_FK_EVIDENCE_DOCUMENT_INVALID_JSON'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_DUPLICATE_KEY'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_UNKNOWN_FIELD'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_SENSITIVE_FIELD'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_UNSAFE_KEY'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_SCHEMA_INVALID'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_TOO_LARGE'
  | 'CDB101_FK_EVIDENCE_DOCUMENT_TOO_DEEP'
  | 'CDB101_FK_EVIDENCE_FILE_UNAVAILABLE'
  | 'CDB101_FK_EVIDENCE_FILE_INSIDE_REPOSITORY'
  | 'CDB101_FK_EVIDENCE_FILE_PROTECTION_INVALID'
  | 'CDB101_FK_EVIDENCE_SCHEMA_UNSUPPORTED'
  | 'CDB101_FK_EVIDENCE_ID_INVALID'
  | 'CDB101_FK_IDENTITY_MISMATCH'
  | 'CDB101_FK_SCOPE_MISMATCH'
  | 'CDB101_FK_GROUP_SCOPE_INVALID'
  | 'CDB101_FK_BEFORE_OBSERVATION_INVALID'
  | 'CDB101_FK_ACTIVE_REPAIR_INVALID'
  | 'CDB101_FK_ARCHIVAL_WAIVER_INVALID'
  | 'CDB101_FK_AFTER_OBSERVATION_INVALID'
  | 'CDB101_FK_CHRONOLOGY_INVALID'
  | 'CDB101_FK_EVIDENCE_BINDING_INVALID'
  | 'CDB101_FK_AUTHORIZATION_BINDING_MISMATCH'
  | 'CDB101_FK_TOTALS_INVALID';

export interface ReportingForeignKeyEvidenceIssue {
  code: ReportingForeignKeyEvidenceIssueCode;
  gate: 'document' | 'file' | 'evidence';
  severity: 'blocker';
}

export interface ReportingForeignKeyEvidenceDocumentResult {
  documentReady: boolean;
  evidence: ReportingForeignKeyDispositionEvidence | null;
  issues: ReportingForeignKeyEvidenceIssue[];
}

export interface ReportingForeignKeyEvidenceReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  evidenceReady: boolean;
  issueCount: number;
  issueCodes: ReportingForeignKeyEvidenceIssueCode[];
  evidenceSha256: string | null;
  authorizationDispositionSha256: string | null;
  repairedViolationCount: number;
  waivedViolationCount: number;
  remainingViolationCount: number;
  activeFinancialWaivedViolationCount: number;
  unknownViolationCount: number;
  authorizationGroupCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export interface PreparedReportingForeignKeyEvidence {
  evidence: ReportingForeignKeyDispositionEvidence | null;
  authorizationGroups: ReportingForeignKeyDispositionGroup[] | null;
  receipt: ReportingForeignKeyEvidenceReceipt;
}

export interface ReportingForeignKeyEvidenceCliOptions {
  evidencePath: string;
  atUtc?: string;
}

const nullableString = z.string().nullable();
const safeInteger = z.number().int().refine(Number.isSafeInteger);
const nullableBoolean = z.boolean().nullable();

const aggregateGroupSchema = z.object({
  childTable: z.string(),
  parentTable: z.string(),
  violationCount: safeInteger,
}).strict();

const observationSchema = z.object({
  captured: z.boolean(),
  observationId: nullableString,
  capturedAtUtc: nullableString,
  queryId: z.literal('pragma_foreign_key_check_grouped_v1'),
  evidenceSha256: nullableString,
  changedDb: z.boolean(),
  rowsWritten: safeInteger,
  totalViolationCount: safeInteger,
  groups: z.array(aggregateGroupSchema),
}).strict();

const activeRepairSchema = z.object({
  childTable: z.string(),
  parentTable: z.string(),
  initialViolationCount: safeInteger,
  disposition: z.string(),
  completed: z.boolean(),
  ownerId: nullableString,
  completedAtUtc: nullableString,
  repairStrategyId: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
  auditTrailEvidenceId: nullableString,
  auditTrailSha256: nullableString,
  affectedRowCount: safeInteger,
  hardDeletePerformed: nullableBoolean,
  remainingViolationCount: safeInteger,
  repairedViolationCount: safeInteger,
  waivedViolationCount: safeInteger,
}).strict();

const archivalWaiverSchema = z.object({
  childTable: z.string(),
  parentTable: z.string(),
  initialViolationCount: safeInteger,
  disposition: z.literal('formal_waiver'),
  approved: z.boolean(),
  ownerId: nullableString,
  approvedAtUtc: nullableString,
  evidenceId: nullableString,
  evidenceSha256: nullableString,
  waiverScope: z.literal('archival_fk_only'),
  archivalTableConfirmed: z.boolean(),
  activeWriterDisabledConfirmed: z.boolean(),
  excludedFromCanonicalImportConfirmed: z.boolean(),
  excludedFromReportingConfirmed: z.boolean(),
  removalPhase: nullableString,
  remainingViolationCount: safeInteger,
  repairedViolationCount: safeInteger,
  waivedViolationCount: safeInteger,
}).strict();

const evidenceSchema = z.object({
  schemaVersion: safeInteger,
  evidenceId: nullableString,
  generatedAtUtc: nullableString,
  productionDatabase: z.object({
    name: nullableString,
    id: nullableString,
  }).strict(),
  domain: nullableString,
  cutoverTenantId: nullableString,
  beforeObservation: observationSchema,
  activeRepairs: z.array(activeRepairSchema),
  archivalWaivers: z.array(archivalWaiverSchema),
  afterObservation: observationSchema,
  totals: z.object({
    repairedViolationCount: safeInteger,
    waivedViolationCount: safeInteger,
    remainingViolationCount: safeInteger,
    unknownViolationCount: safeInteger,
    activeFinancialWaivedViolationCount: safeInteger,
  }).strict(),
}).strict();

const SENSITIVE_KEYS = new Set([
  'authorization',
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
]);

const EXPECTED_BEFORE_GROUPS: ReadonlyArray<ReportingForeignKeyAggregateGroup> = [
  { childTable: 'billing_deposits', parentTable: 'bills', violationCount: 4 },
  { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26 },
  { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15 },
  { childTable: 'income', parentTable: 'bills', violationCount: 4 },
];

const EXPECTED_AFTER_GROUPS: ReadonlyArray<ReportingForeignKeyAggregateGroup> = [
  { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26 },
  { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15 },
];

function issue(
  code: ReportingForeignKeyEvidenceIssueCode,
  gate: 'document' | 'file' | 'evidence' = 'evidence',
): ReportingForeignKeyEvidenceIssue {
  return { code, gate, severity: 'blocker' };
}

function documentFailure(...issues: ReportingForeignKeyEvidenceIssue[]): ReportingForeignKeyEvidenceDocumentResult {
  return { documentReady: false, evidence: null, issues };
}

function mapProtectedIssue(input: ProtectedJsonDocumentIssue): ReportingForeignKeyEvidenceIssue {
  const map = {
    INVALID_JSON: 'CDB101_FK_EVIDENCE_DOCUMENT_INVALID_JSON',
    DUPLICATE_KEY: 'CDB101_FK_EVIDENCE_DOCUMENT_DUPLICATE_KEY',
    UNSAFE_KEY: 'CDB101_FK_EVIDENCE_DOCUMENT_UNSAFE_KEY',
    TOO_LARGE: 'CDB101_FK_EVIDENCE_DOCUMENT_TOO_LARGE',
    TOO_DEEP: 'CDB101_FK_EVIDENCE_DOCUMENT_TOO_DEEP',
    FILE_UNAVAILABLE: 'CDB101_FK_EVIDENCE_FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'CDB101_FK_EVIDENCE_FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'CDB101_FK_EVIDENCE_FILE_PROTECTION_INVALID',
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

function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupKey(group: { childTable: string; parentTable: string }): string {
  return `${group.childTable}->${group.parentTable}`;
}

function exactGroups(
  actual: ReportingForeignKeyAggregateGroup[],
  expected: ReadonlyArray<ReportingForeignKeyAggregateGroup>,
): boolean {
  if (actual.length !== expected.length) return false;
  const actualByKey = new Map<string, ReportingForeignKeyAggregateGroup>();
  for (const group of actual) {
    const key = groupKey(group);
    if (actualByKey.has(key)) return false;
    actualByKey.set(key, group);
  }
  return expected.every((group) => actualByKey.get(groupKey(group))?.violationCount === group.violationCount);
}

function containsUnknownGroup(groups: ReportingForeignKeyAggregateGroup[]): boolean {
  const allowed = new Set(EXPECTED_BEFORE_GROUPS.map(groupKey));
  return groups.some((group) => !allowed.has(groupKey(group)));
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

function dispositionSha256(groups: ReportingForeignKeyDispositionGroup[]): string {
  return sha256([...groups].sort((left, right) => groupKey(left).localeCompare(groupKey(right))));
}

export function parseReportingForeignKeyDispositionEvidenceValue(
  value: unknown,
): ReportingForeignKeyEvidenceDocumentResult {
  if (containsNormalizedKey(value, SENSITIVE_KEYS)) {
    return documentFailure(issue('CDB101_FK_EVIDENCE_DOCUMENT_SENSITIVE_FIELD', 'document'));
  }
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((item) => item.code === 'unrecognized_keys');
    return documentFailure(issue(
      unknown ? 'CDB101_FK_EVIDENCE_DOCUMENT_UNKNOWN_FIELD' : 'CDB101_FK_EVIDENCE_DOCUMENT_SCHEMA_INVALID',
      'document',
    ));
  }
  return {
    documentReady: true,
    evidence: parsed.data as ReportingForeignKeyDispositionEvidence,
    issues: [],
  };
}

export function parseReportingForeignKeyDispositionEvidenceJson(
  text: string,
): ReportingForeignKeyEvidenceDocumentResult {
  const strict = parseStrictJsonDocument(text, {
    maxBytes: MAX_REPORTING_FK_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_FK_EVIDENCE_DEPTH,
  });
  if (!strict.ready) return documentFailure(...strict.issues.map(mapProtectedIssue));
  return parseReportingForeignKeyDispositionEvidenceValue(strict.value);
}

function validateEvidence(
  input: ReportingForeignKeyDispositionEvidence,
  atUtc: string,
): ReportingForeignKeyEvidenceIssue[] {
  const codes = new Set<ReportingForeignKeyEvidenceIssueCode>();
  const add = (code: ReportingForeignKeyEvidenceIssueCode): void => { codes.add(code); };

  if (input.schemaVersion !== 1) add('CDB101_FK_EVIDENCE_SCHEMA_UNSUPPORTED');
  if (!safeIdentifier(input.evidenceId)) add('CDB101_FK_EVIDENCE_ID_INVALID');
  if (
    input.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID
  ) add('CDB101_FK_IDENTITY_MISMATCH');
  if (input.domain !== 'reporting' || input.cutoverTenantId !== CDB101_CANARY_TENANT_ID) {
    add('CDB101_FK_SCOPE_MISMATCH');
  }

  const dispositionScopeGroups: ReportingForeignKeyAggregateGroup[] = [
    ...input.activeRepairs.map((item) => ({
      childTable: item.childTable,
      parentTable: item.parentTable,
      violationCount: item.initialViolationCount,
    })),
    ...input.archivalWaivers.map((item) => ({
      childTable: item.childTable,
      parentTable: item.parentTable,
      violationCount: item.initialViolationCount,
    })),
  ];
  if (
    containsUnknownGroup(input.beforeObservation.groups)
    || containsUnknownGroup(input.afterObservation.groups)
    || containsUnknownGroup(dispositionScopeGroups)
  ) {
    add('CDB101_FK_GROUP_SCOPE_INVALID');
  }

  const before = input.beforeObservation;
  if (
    !before.captured
    || !safeIdentifier(before.observationId)
    || parseUtc(before.capturedAtUtc) === null
    || !isSha256(before.evidenceSha256)
    || before.changedDb !== false
    || before.rowsWritten !== 0
    || before.totalViolationCount !== 49
    || !exactGroups(before.groups, EXPECTED_BEFORE_GROUPS)
  ) add('CDB101_FK_BEFORE_OBSERVATION_INVALID');

  const repairsByKey = new Map(input.activeRepairs.map((item) => [groupKey(item), item]));
  const activeExpected = EXPECTED_BEFORE_GROUPS.filter((item) => item.childTable !== 'doctor_commission_accruals_old_0391');
  if (input.activeRepairs.length !== activeExpected.length || repairsByKey.size !== activeExpected.length) {
    add('CDB101_FK_ACTIVE_REPAIR_INVALID');
  }
  for (const expected of activeExpected) {
    const repair = repairsByKey.get(groupKey(expected));
    if (
      !repair
      || repair.initialViolationCount !== expected.violationCount
      || repair.disposition !== 'repair_required'
      || !repair.completed
      || !safeIdentifier(repair.ownerId)
      || parseUtc(repair.completedAtUtc) === null
      || !safeIdentifier(repair.repairStrategyId)
      || !safeIdentifier(repair.evidenceId)
      || !isSha256(repair.evidenceSha256)
      || !safeIdentifier(repair.auditTrailEvidenceId)
      || !isSha256(repair.auditTrailSha256)
      || repair.affectedRowCount !== expected.violationCount
      || repair.hardDeletePerformed !== false
      || repair.remainingViolationCount !== 0
      || repair.repairedViolationCount !== expected.violationCount
      || repair.waivedViolationCount !== 0
    ) add('CDB101_FK_ACTIVE_REPAIR_INVALID');
  }

  const waiversByKey = new Map(input.archivalWaivers.map((item) => [groupKey(item), item]));
  const archivalExpected = EXPECTED_AFTER_GROUPS;
  if (input.archivalWaivers.length !== archivalExpected.length || waiversByKey.size !== archivalExpected.length) {
    add('CDB101_FK_ARCHIVAL_WAIVER_INVALID');
  }
  for (const expected of archivalExpected) {
    const waiver = waiversByKey.get(groupKey(expected));
    if (
      !waiver
      || waiver.initialViolationCount !== expected.violationCount
      || waiver.disposition !== 'formal_waiver'
      || !waiver.approved
      || !safeIdentifier(waiver.ownerId)
      || parseUtc(waiver.approvedAtUtc) === null
      || !safeIdentifier(waiver.evidenceId)
      || !isSha256(waiver.evidenceSha256)
      || waiver.waiverScope !== 'archival_fk_only'
      || !waiver.archivalTableConfirmed
      || !waiver.activeWriterDisabledConfirmed
      || !waiver.excludedFromCanonicalImportConfirmed
      || !waiver.excludedFromReportingConfirmed
      || waiver.removalPhase !== 'legacy_retirement_p11'
      || waiver.remainingViolationCount !== expected.violationCount
      || waiver.repairedViolationCount !== 0
      || waiver.waivedViolationCount !== expected.violationCount
    ) add('CDB101_FK_ARCHIVAL_WAIVER_INVALID');
  }

  const after = input.afterObservation;
  if (
    !after.captured
    || !safeIdentifier(after.observationId)
    || parseUtc(after.capturedAtUtc) === null
    || !isSha256(after.evidenceSha256)
    || after.changedDb !== false
    || after.rowsWritten !== 0
    || after.totalViolationCount !== 41
    || !exactGroups(after.groups, EXPECTED_AFTER_GROUPS)
  ) add('CDB101_FK_AFTER_OBSERVATION_INVALID');

  const beforeMs = parseUtc(before.capturedAtUtc);
  const afterMs = parseUtc(after.capturedAtUtc);
  const generatedMs = parseUtc(input.generatedAtUtc);
  const nowMs = parseUtc(atUtc);
  const actionTimes = [
    ...input.activeRepairs.map((item) => parseUtc(item.completedAtUtc)),
    ...input.archivalWaivers.map((item) => parseUtc(item.approvedAtUtc)),
  ];
  if (
    beforeMs === null
    || afterMs === null
    || generatedMs === null
    || nowMs === null
    || afterMs < beforeMs
    || generatedMs < afterMs
    || generatedMs > nowMs
    || actionTimes.some((time) => time === null || time < beforeMs || time > afterMs)
  ) add('CDB101_FK_CHRONOLOGY_INVALID');

  const evidenceIds = [
    input.evidenceId,
    before.observationId,
    after.observationId,
    ...input.activeRepairs.flatMap((item) => [item.evidenceId, item.auditTrailEvidenceId]),
    ...input.archivalWaivers.map((item) => item.evidenceId),
  ].filter(nonEmpty);
  const hashes = [
    before.evidenceSha256,
    after.evidenceSha256,
    ...input.activeRepairs.flatMap((item) => [item.evidenceSha256, item.auditTrailSha256]),
    ...input.archivalWaivers.map((item) => item.evidenceSha256),
  ].filter(nonEmpty);
  if (
    evidenceIds.length !== 9
    || new Set(evidenceIds).size !== evidenceIds.length
    || hashes.length !== 8
    || new Set(hashes).size !== hashes.length
  ) add('CDB101_FK_EVIDENCE_BINDING_INVALID');

  if (
    input.totals.repairedViolationCount !== 8
    || input.totals.waivedViolationCount !== 41
    || input.totals.remainingViolationCount !== 41
    || input.totals.unknownViolationCount !== 0
    || input.totals.activeFinancialWaivedViolationCount !== 0
  ) add('CDB101_FK_TOTALS_INVALID');

  return [...codes].map((code) => issue(code));
}

function authorizationGroupsFromEvidence(
  input: ReportingForeignKeyDispositionEvidence,
): ReportingForeignKeyDispositionGroup[] {
  const repairs = new Map(input.activeRepairs.map((item) => [groupKey(item), item]));
  const waivers = new Map(input.archivalWaivers.map((item) => [groupKey(item), item]));
  return EXPECTED_BEFORE_GROUPS.map((expected) => {
    const repair = repairs.get(groupKey(expected));
    if (repair) {
      return {
        childTable: repair.childTable,
        parentTable: repair.parentTable,
        violationCount: repair.initialViolationCount,
        remainingViolationCount: repair.remainingViolationCount,
        repairedViolationCount: repair.repairedViolationCount,
        waivedViolationCount: repair.waivedViolationCount,
        disposition: 'repair_required',
        ownerId: repair.ownerId,
        evidenceId: repair.evidenceId,
        removalPhase: 'before_reporting_go',
      };
    }
    const waiver = waivers.get(groupKey(expected));
    if (!waiver) throw new Error('Validated FK evidence group was missing.');
    return {
      childTable: waiver.childTable,
      parentTable: waiver.parentTable,
      violationCount: waiver.initialViolationCount,
      remainingViolationCount: waiver.remainingViolationCount,
      repairedViolationCount: waiver.repairedViolationCount,
      waivedViolationCount: waiver.waivedViolationCount,
      disposition: 'formal_waiver',
      ownerId: waiver.ownerId,
      evidenceId: waiver.evidenceId,
      removalPhase: waiver.removalPhase,
    };
  });
}

function emptyReceipt(
  documentReady: boolean,
  issues: ReportingForeignKeyEvidenceIssue[],
): ReportingForeignKeyEvidenceReceipt {
  return {
    schemaVersion: 1,
    documentReady,
    evidenceReady: false,
    issueCount: issues.length,
    issueCodes: issues.map((item) => item.code),
    evidenceSha256: null,
    authorizationDispositionSha256: null,
    repairedViolationCount: 0,
    waivedViolationCount: 0,
    remainingViolationCount: 0,
    activeFinancialWaivedViolationCount: 0,
    unknownViolationCount: 0,
    authorizationGroupCount: 0,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
  };
}

export function prepareReportingForeignKeyDispositionEvidence(
  input: ReportingForeignKeyDispositionEvidence,
  atUtc: string = new Date().toISOString(),
): PreparedReportingForeignKeyEvidence {
  const parsed = parseReportingForeignKeyDispositionEvidenceValue(input);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, authorizationGroups: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  const issues = validateEvidence(parsed.evidence, atUtc);
  const evidenceSha256 = sha256(parsed.evidence);
  const groups = issues.length === 0 ? authorizationGroupsFromEvidence(parsed.evidence) : null;
  return {
    evidence: parsed.evidence,
    authorizationGroups: groups,
    receipt: {
      schemaVersion: 1,
      documentReady: true,
      evidenceReady: issues.length === 0,
      issueCount: issues.length,
      issueCodes: issues.map((item) => item.code),
      evidenceSha256,
      authorizationDispositionSha256: groups ? dispositionSha256(groups) : null,
      repairedViolationCount: parsed.evidence.totals.repairedViolationCount,
      waivedViolationCount: parsed.evidence.totals.waivedViolationCount,
      remainingViolationCount: parsed.evidence.totals.remainingViolationCount,
      activeFinancialWaivedViolationCount: parsed.evidence.totals.activeFinancialWaivedViolationCount,
      unknownViolationCount: parsed.evidence.totals.unknownViolationCount,
      authorizationGroupCount: groups?.length ?? 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    },
  };
}

export function prepareProtectedReportingForeignKeyDispositionEvidence(
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedReportingForeignKeyEvidence {
  const strict = loadProtectedJsonDocument(evidencePath, repositoryRoot, {
    maxBytes: MAX_REPORTING_FK_EVIDENCE_BYTES,
    maxDepth: MAX_REPORTING_FK_EVIDENCE_DEPTH,
  });
  if (!strict.ready) {
    const issues = strict.issues.map(mapProtectedIssue);
    return { evidence: null, authorizationGroups: null, receipt: emptyReceipt(false, issues) };
  }
  const parsed = parseReportingForeignKeyDispositionEvidenceValue(strict.value);
  if (!parsed.documentReady || !parsed.evidence) {
    return { evidence: null, authorizationGroups: null, receipt: emptyReceipt(false, parsed.issues) };
  }
  return prepareReportingForeignKeyDispositionEvidence(parsed.evidence, atUtc);
}

export function bindReportingForeignKeyEvidenceToAuthorization(
  prepared: PreparedReportingForeignKeyEvidence,
  authorization: ReportingCutoverAuthorization,
): PreparedReportingForeignKeyEvidence {
  if (!prepared.receipt.evidenceReady || !prepared.evidence || !prepared.authorizationGroups) return prepared;
  const mismatch = (
    authorization.foreignKeyDisposition.evidenceId !== prepared.evidence.evidenceId
    || authorization.foreignKeyDisposition.evidenceSha256 !== prepared.receipt.evidenceSha256
    || dispositionSha256(authorization.foreignKeyDisposition.groups)
      !== prepared.receipt.authorizationDispositionSha256
  );
  if (!mismatch) return prepared;
  const issueCodes = [
    ...prepared.receipt.issueCodes,
    'CDB101_FK_AUTHORIZATION_BINDING_MISMATCH' as const,
  ];
  return {
    evidence: prepared.evidence,
    authorizationGroups: null,
    receipt: {
      ...prepared.receipt,
      evidenceReady: false,
      issueCount: issueCodes.length,
      issueCodes,
      authorizationGroupCount: 0,
    },
  };
}

export function evaluateProtectedReportingForeignKeyDispositionEvidence(
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): ReportingForeignKeyEvidenceReceipt {
  return prepareProtectedReportingForeignKeyDispositionEvidence(evidencePath, repositoryRoot, atUtc).receipt;
}

export function parseReportingForeignKeyDispositionEvidenceArgs(
  args: string[],
): ReportingForeignKeyEvidenceCliOptions {
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

import { createHash } from 'node:crypto';

export const CDB_V1_071B_DATABASE_NAME = 'hms-super-admin-production-apac' as const;
export const CDB_V1_071B_DATABASE_UUID = 'c68a5360-a2c1-44cc-9e71-f21057bea102' as const;
export const CDB_V1_071B_TARGET_TENANT_ID = '100' as const;
export const CDB_V1_071B_MIGRATION_FILENAME =
  '0571_canonical_admission_encounter_type_alignment.sql' as const;
export const CDB_V1_071B_APPROVAL_SOURCE =
  'user_explicit_cdb_v1_071b_emergency_admission_convergence_authorization' as const;
export const CDB_V1_071B_ACTOR = 'cdb-v1-071b-admission-replay-reconciliation' as const;

export interface CdbV1071bPreconditionEvidence {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-071B-PRECONDITION-EVIDENCE';
  capturedAtUtc: string;
  database: { name: string; uuid: string };
  tenantId: string;
  candidateCommit: string;
  activeWorkerVersionId: string;
  migrationFilename: string;
  openAdmissionEncounterMappingMissingCount: number;
  openAdmissionEncounterTypeMismatchCount: number;
  openBedStayAdmissionMappingMissingCount: number;
  openBedStatusCacheVarianceCount: number;
  ambiguousAdmissionMappingCount: number;
  exactEmergencyAdmissionCandidateCount: number;
  exactMissingPlannedEncounterCandidateCount: number;
  exactDependentBedStayCount: number;
  otherAuthorizedTenantAnomalyCount: number;
  sourceAdmissionIdentitySha256: string;
  sourceBedStayIdentitySha256: string;
  encounterClinicalIdentitySha256: string;
  trafficFingerprintSha256: string;
  aggregateOnlyNonPhi: true;
  productionMutationPerformed: false;
  trafficChanged: false;
}

export interface CdbV1071bReplayEvidence {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-071B-REPLAY-EVIDENCE';
  capturedAtUtc: string;
  database: { name: string; uuid: string };
  tenantId: string;
  candidateCommit: string;
  activeWorkerVersionId: string;
  migrationFilename: string;
  supersededAdmissionMappingCount: number;
  mappedAdmissionCount: number;
  canonicalAdmissionCount: number;
  mappedBedStayCount: number;
  canonicalBedStayCount: number;
  openAdmissionEncounterMappingMissingCount: number;
  openAdmissionEncounterTypeMismatchCount: number;
  openBedStayAdmissionMappingMissingCount: number;
  openBedStatusCacheVarianceCount: number;
  newReplayIssueCount: number;
  sourceLegacyRowsWritten: number;
  unexpectedTenantWriteCount: number;
  secondPassZeroNew: boolean;
  sourceAdmissionIdentitySha256: string;
  sourceBedStayIdentitySha256: string;
  encounterClinicalIdentitySha256: string;
  trafficFingerprintSha256: string;
  trafficChanged: boolean;
}

export interface CdbV1071bCompletionEvidence {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-071B-COMPLETION-EVIDENCE';
  capturedAtUtc: string;
  database: { name: string; uuid: string };
  tenantId: string;
  candidateCommit: string;
  activeWorkerVersionId: string;
  migrationFilename: string;
  mappedAdmissionCount: number;
  canonicalAdmissionCount: number;
  mappedBedStayCount: number;
  canonicalBedStayCount: number;
  resolvedDependencyIssueCount: number;
  waivedCacheVarianceIssueCount: number;
  remainingOpenTargetIssueCount: number;
  sourceLegacyRowsWritten: number;
  unexpectedTenantWriteCount: number;
  secondPassZeroNew: boolean;
  sourceAdmissionIdentitySha256: string;
  sourceBedStayIdentitySha256: string;
  encounterClinicalIdentitySha256: string;
  trafficFingerprintSha256: string;
  trafficChanged: boolean;
}

export interface CdbV1071bAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'cdb_v1_071b_admission_replay_reconciliation';
  target: {
    databaseName: string;
    databaseUuid: string;
    tenantId: string;
    candidateCommit: string;
    activeWorkerVersionId: string;
    migrationFilename: string;
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
    approvalSource: typeof CDB_V1_071B_APPROVAL_SOURCE;
    ownerModel: 'single_operator_risk_accepted';
    automaticAbortOnOperatorUnavailable: boolean;
  };
  scope: {
    expected: {
      admissionEncounterMappingMissing: number;
      admissionEncounterTypeMismatch: number;
      bedStayAdmissionMappingMissing: number;
      bedStatusCacheVariance: number;
      ambiguousAdmissionMappings: number;
      emergencyAdmissionCandidates: number;
      missingPlannedEncounterCandidates: number;
      dependentBedStays: number;
      otherAuthorizedTenantAnomalies: number;
    };
    preparationWrites: {
      admissionMappingSupersessions: number;
    };
    finalizationWrites: {
      dependencyIssueResolutions: number;
      cacheVarianceWaivers: number;
    };
    post: {
      mappedAdmissions: number;
      canonicalAdmissions: number;
      mappedBedStays: number;
      canonicalBedStays: number;
      remainingOpenTargetIssues: number;
      resolvedDependencyIssues: number;
      waivedCacheVarianceIssues: number;
      sourceLegacyRowsWritten: number;
      unexpectedTenantWrites: number;
      trafficChanged: boolean;
      secondPassZeroNew: boolean;
    };
  };
  permissions: {
    aggregateProductionRead: boolean;
    boundedInternalReferenceRead: boolean;
    provenanceSupersessionWrite: boolean;
    canonicalReplayWrite: boolean;
    issueDispositionWrite: boolean;
    sourceLegacyWrite: boolean;
    encounterClinicalRewrite: boolean;
    workerUploadDuringReconciliation: boolean;
    trafficChangeDuringReconciliation: boolean;
    providerFlagChange: boolean;
    canonicalAuthorityPromotion: boolean;
    localSyncActivation: boolean;
    legacyRetirement: boolean;
    routeChange: boolean;
    destructiveLegacyAction: boolean;
    databaseDeletion: boolean;
  };
  evidence: {
    preconditionEvidenceSha256: string;
  };
  confirmation: {
    preparationProof: string;
    finalizationProof: string;
  };
}

export interface CdbV1071bStatementSpec {
  sql: string;
  params: unknown[];
}

export interface CdbV1071bPreparationPlan {
  statements: [CdbV1071bStatementSpec, CdbV1071bStatementSpec];
  expectedChanges: readonly [0, 38];
}

export interface CdbV1071bFinalizationPlan {
  statements: [CdbV1071bStatementSpec, CdbV1071bStatementSpec, CdbV1071bStatementSpec];
  expectedChanges: readonly [0, 54, 4];
}

export interface CdbV1071bAuthorizationReceipt {
  checkpoint: 'CDB-V1-071B-AUTHORIZATION';
  authorizationReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
  candidateCommit: string;
  tenantId: typeof CDB_V1_071B_TARGET_TENANT_ID;
  productionMutationPerformed: false;
  trafficChanged: false;
}

export interface CdbV1071bPreparedStatement {
  bind(...values: unknown[]): CdbV1071bPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface CdbV1071bDatabase {
  prepare(sql: string): CdbV1071bPreparedStatement;
}

export interface CdbV1071bCollectorOptions {
  capturedAtUtc: string;
  candidateCommit: string;
  activeWorkerVersionId: string;
  trafficFingerprintSha256: string;
}

const PRECONDITION_COUNTS = {
  openAdmissionEncounterMappingMissingCount: 4,
  openAdmissionEncounterTypeMismatchCount: 34,
  openBedStayAdmissionMappingMissingCount: 16,
  openBedStatusCacheVarianceCount: 4,
  ambiguousAdmissionMappingCount: 38,
  exactEmergencyAdmissionCandidateCount: 34,
  exactMissingPlannedEncounterCandidateCount: 4,
  exactDependentBedStayCount: 16,
  otherAuthorizedTenantAnomalyCount: 0,
} as const;

const EXPECTED_SCOPE = {
  admissionEncounterMappingMissing: 4,
  admissionEncounterTypeMismatch: 34,
  bedStayAdmissionMappingMissing: 16,
  bedStatusCacheVariance: 4,
  ambiguousAdmissionMappings: 38,
  emergencyAdmissionCandidates: 34,
  missingPlannedEncounterCandidates: 4,
  dependentBedStays: 16,
  otherAuthorizedTenantAnomalies: 0,
} as const;

const EXPECTED_POST = {
  mappedAdmissions: 38,
  canonicalAdmissions: 38,
  mappedBedStays: 16,
  canonicalBedStays: 16,
  remainingOpenTargetIssues: 0,
  resolvedDependencyIssues: 54,
  waivedCacheVarianceIssues: 4,
  sourceLegacyRowsWritten: 0,
  unexpectedTenantWrites: 0,
  trafficChanged: false,
  secondPassZeroNew: true,
} as const;

const TRUE_PERMISSIONS = [
  'aggregateProductionRead',
  'boundedInternalReferenceRead',
  'provenanceSupersessionWrite',
  'canonicalReplayWrite',
  'issueDispositionWrite',
] as const;

const FALSE_PERMISSIONS = [
  'sourceLegacyWrite',
  'encounterClinicalRewrite',
  'workerUploadDuringReconciliation',
  'trafficChangeDuringReconciliation',
  'providerFlagChange',
  'canonicalAuthorityPromotion',
  'localSyncActivation',
  'legacyRetirement',
  'routeChange',
  'destructiveLegacyAction',
  'databaseDeletion',
] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function cdbV1071bEvidenceSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function buildCdbV1071bAuthorizationProof(
  authorizationId: string,
  phase: 'preparation' | 'finalization',
  evidenceSha256: string,
  candidateCommit: string,
  databaseUuid: string,
  activeWorkerVersionId: string,
): string {
  return `cdbv1071b:${phase}:${createHash('sha256').update([
    authorizationId,
    phase,
    evidenceSha256,
    candidateCommit,
    databaseUuid,
    activeWorkerVersionId,
    CDB_V1_071B_MIGRATION_FILENAME,
  ].join('|')).digest('hex')}`;
}

async function allRows<T>(statement: CdbV1071bPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function countRow(
  db: CdbV1071bDatabase,
  sql: string,
  params: readonly unknown[],
): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<{ row_count: number }>();
  const value = Number(row?.row_count ?? -1);
  if (!Number.isInteger(value) || value < 0) throw new Error('invalid CDB-V1-071B count evidence');
  return value;
}

export async function collectCdbV1071bPreconditionEvidence(
  db: CdbV1071bDatabase,
  options: CdbV1071bCollectorOptions,
): Promise<CdbV1071bPreconditionEvidence> {
  if (utcMillis(options.capturedAtUtc) === null) throw new TypeError('capturedAtUtc must be normalized UTC');
  if (!exactCommit(options.candidateCommit)) throw new TypeError('candidateCommit must be a lowercase 40-character SHA');
  if (!exactWorkerVersion(options.activeWorkerVersionId)) throw new TypeError('activeWorkerVersionId must be a Worker UUID');
  if (!exactSha(options.trafficFingerprintSha256)) throw new TypeError('trafficFingerprintSha256 must be SHA-256');

  const issueRows = await allRows<{ issue_code: string; row_count: number }>(db.prepare(`
    /* cdb-v1-071b:issue-counts */
    SELECT issue_code,COUNT(*) AS row_count
    FROM canonical_processing_issues
    WHERE tenant_id=?
      AND issue_type='encounter_admission_bed_backfill'
      AND status='open'
      AND issue_code IN (
        'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING',
        'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT',
        'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING',
        'CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
      )
    GROUP BY issue_code
  `).bind(CDB_V1_071B_TARGET_TENANT_ID));
  const issueCounts = new Map(issueRows.map((row) => [String(row.issue_code), Number(row.row_count)]));

  const ambiguousAdmissionMappingCount = await countRow(db, `
    /* cdb-v1-071b:ambiguous-mappings */
    SELECT COUNT(*) AS row_count
    FROM canonical_source_mappings m
    JOIN canonical_processing_issues i
      ON i.tenant_id=m.tenant_id AND i.source_public_id=m.source_public_id
    WHERE m.tenant_id=? AND m.entity_type='admission'
      AND m.source_type='legacy_admission'
      AND m.mapping_status='ambiguous' AND m.canonical_public_id IS NULL
      AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code IN (
        'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING',
        'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT'
      ) AND i.status='open'
  `, [CDB_V1_071B_TARGET_TENANT_ID]);

  const exactEmergencyAdmissionCandidateCount = await countRow(db, `
    /* cdb-v1-071b:emergency-candidates */
    SELECT COUNT(*) AS row_count
    FROM canonical_processing_issues i
    JOIN admissions a
      ON CAST(a.tenant_id AS TEXT)=i.tenant_id
      AND CAST(a.id AS TEXT)=i.source_public_id
    JOIN canonical_source_mappings m
      ON m.tenant_id=i.tenant_id AND m.entity_type='encounter'
      AND m.source_type='legacy_admission' AND m.source_public_id=i.source_public_id
      AND m.mapping_status='mapped'
    JOIN canonical_encounters e
      ON e.tenant_id=m.tenant_id AND e.encounter_public_id=m.canonical_public_id
    WHERE i.tenant_id=? AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code='CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT'
      AND i.status='open' AND lower(trim(CAST(a.admission_type AS TEXT)))='emergency'
      AND e.encounter_type='emergency'
  `, [CDB_V1_071B_TARGET_TENANT_ID]);

  const exactMissingPlannedEncounterCandidateCount = await countRow(db, `
    /* cdb-v1-071b:planned-candidates */
    SELECT COUNT(*) AS row_count
    FROM canonical_processing_issues i
    JOIN admissions a
      ON CAST(a.tenant_id AS TEXT)=i.tenant_id
      AND CAST(a.id AS TEXT)=i.source_public_id
    WHERE i.tenant_id=? AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code='CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING'
      AND i.status='open'
      AND lower(trim(CAST(a.admission_type AS TEXT))) IN ('planned','ipd','inpatient')
      AND (SELECT COUNT(*) FROM canonical_tenant_patient_links p
        WHERE p.tenant_id=i.tenant_id AND p.legacy_patient_id=a.patient_id
          AND p.link_status NOT IN ('rejected','retired') AND p.effective_to_utc IS NULL)=1
      AND NOT EXISTS (SELECT 1 FROM canonical_source_mappings m
        WHERE m.tenant_id=i.tenant_id AND m.entity_type='encounter'
          AND m.source_type='legacy_admission' AND m.source_public_id=i.source_public_id
          AND m.mapping_status='mapped')
      AND NOT EXISTS (SELECT 1 FROM canonical_encounter_admission_links l
        WHERE l.tenant_id=i.tenant_id AND l.legacy_admission_id=a.id AND l.link_status='active')
  `, [CDB_V1_071B_TARGET_TENANT_ID]);

  const exactDependentBedStayCount = await countRow(db, `
    /* cdb-v1-071b:dependent-bed-stays */
    SELECT COUNT(*) AS row_count
    FROM canonical_processing_issues i
    JOIN patient_bed_infos p
      ON CAST(p.tenant_id AS TEXT)=i.tenant_id
      AND CAST(p.id AS TEXT)=i.source_public_id
    WHERE i.tenant_id=? AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code='CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
      AND i.status='open'
  `, [CDB_V1_071B_TARGET_TENANT_ID]);

  const otherAuthorizedTenantAnomalyCount = await countRow(db, `
    /* cdb-v1-071b:cross-tenant */
    SELECT COUNT(*) AS row_count
    FROM canonical_processing_issues
    WHERE tenant_id IN ('1','101','102')
      AND issue_type='encounter_admission_bed_backfill'
      AND status='open'
      AND issue_code IN (
        'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING',
        'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT',
        'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING',
        'CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
      )
  `, []);

  const admissionIdentities = await allRows<Record<string, unknown>>(db.prepare(`
    /* cdb-v1-071b:admission-identities */
    SELECT a.id,a.patient_id,a.admission_type,a.status
    FROM admissions a
    JOIN canonical_processing_issues i
      ON i.tenant_id=CAST(a.tenant_id AS TEXT) AND i.source_public_id=CAST(a.id AS TEXT)
    WHERE i.tenant_id=? AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code IN (
        'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING',
        'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT'
      ) AND i.status='open'
    ORDER BY a.id
  `).bind(CDB_V1_071B_TARGET_TENANT_ID));
  const bedStayIdentities = await allRows<Record<string, unknown>>(db.prepare(`
    /* cdb-v1-071b:bed-stay-identities */
    SELECT p.id,p.patient_id,p.admission_id,p.bed_id
    FROM patient_bed_infos p
    JOIN canonical_processing_issues i
      ON i.tenant_id=CAST(p.tenant_id AS TEXT) AND i.source_public_id=CAST(p.id AS TEXT)
    WHERE i.tenant_id=? AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code='CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
      AND i.status='open'
    ORDER BY p.id
  `).bind(CDB_V1_071B_TARGET_TENANT_ID));
  const encounterIdentities = await allRows<Record<string, unknown>>(db.prepare(`
    /* cdb-v1-071b:encounter-identities */
    SELECT e.encounter_public_id,e.legacy_patient_id,e.patient_link_public_id,
           e.encounter_type,e.status,e.started_at_utc,e.ended_at_utc,e.source_evidence_sha256
    FROM canonical_encounters e
    JOIN canonical_source_mappings m
      ON m.tenant_id=e.tenant_id AND m.canonical_public_id=e.encounter_public_id
      AND m.entity_type='encounter' AND m.source_type='legacy_admission'
      AND m.mapping_status='mapped'
    JOIN canonical_processing_issues i
      ON i.tenant_id=m.tenant_id AND i.source_public_id=m.source_public_id
    WHERE i.tenant_id=? AND i.issue_type='encounter_admission_bed_backfill'
      AND i.issue_code='CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT'
      AND i.status='open'
    ORDER BY e.encounter_public_id
  `).bind(CDB_V1_071B_TARGET_TENANT_ID));

  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-071B-PRECONDITION-EVIDENCE',
    capturedAtUtc: options.capturedAtUtc,
    database: { name: CDB_V1_071B_DATABASE_NAME, uuid: CDB_V1_071B_DATABASE_UUID },
    tenantId: CDB_V1_071B_TARGET_TENANT_ID,
    candidateCommit: options.candidateCommit,
    activeWorkerVersionId: options.activeWorkerVersionId,
    migrationFilename: CDB_V1_071B_MIGRATION_FILENAME,
    openAdmissionEncounterMappingMissingCount:
      issueCounts.get('CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING') ?? 0,
    openAdmissionEncounterTypeMismatchCount:
      issueCounts.get('CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT') ?? 0,
    openBedStayAdmissionMappingMissingCount:
      issueCounts.get('CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING') ?? 0,
    openBedStatusCacheVarianceCount:
      issueCounts.get('CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE') ?? 0,
    ambiguousAdmissionMappingCount,
    exactEmergencyAdmissionCandidateCount,
    exactMissingPlannedEncounterCandidateCount,
    exactDependentBedStayCount,
    otherAuthorizedTenantAnomalyCount,
    sourceAdmissionIdentitySha256: cdbV1071bEvidenceSha256(admissionIdentities),
    sourceBedStayIdentitySha256: cdbV1071bEvidenceSha256(bedStayIdentities),
    encounterClinicalIdentitySha256: cdbV1071bEvidenceSha256(encounterIdentities),
    trafficFingerprintSha256: options.trafficFingerprintSha256,
    aggregateOnlyNonPhi: true,
    productionMutationPerformed: false,
    trafficChanged: false,
  };
}

function add(issues: string[], condition: boolean, issue: string): void {
  if (!condition) issues.push(issue);
}

function exactSha(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function exactCommit(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function exactWorkerVersion(value: unknown): boolean {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function utcMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameTarget(
  before: CdbV1071bPreconditionEvidence,
  after: CdbV1071bReplayEvidence | CdbV1071bCompletionEvidence,
): boolean {
  return after.database.name === before.database.name
    && after.database.uuid === before.database.uuid
    && after.tenantId === before.tenantId
    && after.candidateCommit === before.candidateCommit
    && after.activeWorkerVersionId === before.activeWorkerVersionId
    && after.migrationFilename === before.migrationFilename;
}

function sourceAndTrafficIssues(
  before: CdbV1071bPreconditionEvidence,
  after: CdbV1071bReplayEvidence | CdbV1071bCompletionEvidence,
): string[] {
  const issues: string[] = [];
  add(issues,
    after.sourceAdmissionIdentitySha256 === before.sourceAdmissionIdentitySha256,
    'CDBV1071B_SOURCE_ADMISSION_IDENTITY_DRIFT');
  add(issues,
    after.sourceBedStayIdentitySha256 === before.sourceBedStayIdentitySha256,
    'CDBV1071B_SOURCE_BED_STAY_IDENTITY_DRIFT');
  add(issues,
    after.encounterClinicalIdentitySha256 === before.encounterClinicalIdentitySha256,
    'CDBV1071B_ENCOUNTER_CLINICAL_IDENTITY_DRIFT');
  add(issues,
    after.trafficFingerprintSha256 === before.trafficFingerprintSha256
      && after.trafficChanged === false,
    'CDBV1071B_TRAFFIC_DRIFT');
  return issues;
}

export function validateCdbV1071bPreconditionEvidence(
  evidence: CdbV1071bPreconditionEvidence,
): string[] {
  const issues: string[] = [];
  add(issues, evidence.schemaVersion === 1, 'CDBV1071B_EVIDENCE_SCHEMA_INVALID');
  add(issues, evidence.checkpoint === 'CDB-V1-071B-PRECONDITION-EVIDENCE',
    'CDBV1071B_EVIDENCE_CHECKPOINT_INVALID');
  add(issues, utcMillis(evidence.capturedAtUtc) !== null, 'CDBV1071B_EVIDENCE_TIME_INVALID');
  add(issues,
    evidence.database.name === CDB_V1_071B_DATABASE_NAME
      && evidence.database.uuid === CDB_V1_071B_DATABASE_UUID,
    'CDBV1071B_DATABASE_TARGET_INVALID');
  add(issues, evidence.tenantId === CDB_V1_071B_TARGET_TENANT_ID,
    'CDBV1071B_TENANT_INVALID');
  add(issues, exactCommit(evidence.candidateCommit), 'CDBV1071B_CANDIDATE_INVALID');
  add(issues, exactWorkerVersion(evidence.activeWorkerVersionId),
    'CDBV1071B_WORKER_VERSION_INVALID');
  add(issues, evidence.migrationFilename === CDB_V1_071B_MIGRATION_FILENAME,
    'CDBV1071B_MIGRATION_INVALID');
  add(issues, evidence.openAdmissionEncounterMappingMissingCount
    === PRECONDITION_COUNTS.openAdmissionEncounterMappingMissingCount,
  'CDBV1071B_ADMISSION_MAPPING_MISSING_COUNT_INVALID');
  add(issues, evidence.openAdmissionEncounterTypeMismatchCount
    === PRECONDITION_COUNTS.openAdmissionEncounterTypeMismatchCount,
  'CDBV1071B_ADMISSION_TYPE_MISMATCH_COUNT_INVALID');
  add(issues, evidence.openBedStayAdmissionMappingMissingCount
    === PRECONDITION_COUNTS.openBedStayAdmissionMappingMissingCount,
  'CDBV1071B_BED_STAY_MAPPING_MISSING_COUNT_INVALID');
  add(issues, evidence.openBedStatusCacheVarianceCount
    === PRECONDITION_COUNTS.openBedStatusCacheVarianceCount,
  'CDBV1071B_BED_CACHE_VARIANCE_COUNT_INVALID');
  add(issues, evidence.ambiguousAdmissionMappingCount
    === PRECONDITION_COUNTS.ambiguousAdmissionMappingCount,
  'CDBV1071B_AMBIGUOUS_ADMISSION_MAPPING_COUNT_INVALID');
  add(issues, evidence.exactEmergencyAdmissionCandidateCount
    === PRECONDITION_COUNTS.exactEmergencyAdmissionCandidateCount,
  'CDBV1071B_EMERGENCY_CANDIDATE_COUNT_INVALID');
  add(issues, evidence.exactMissingPlannedEncounterCandidateCount
    === PRECONDITION_COUNTS.exactMissingPlannedEncounterCandidateCount,
  'CDBV1071B_MISSING_PLANNED_CANDIDATE_COUNT_INVALID');
  add(issues, evidence.exactDependentBedStayCount
    === PRECONDITION_COUNTS.exactDependentBedStayCount,
  'CDBV1071B_DEPENDENT_BED_STAY_COUNT_INVALID');
  add(issues, evidence.otherAuthorizedTenantAnomalyCount === 0,
    'CDBV1071B_CROSS_TENANT_ANOMALY');
  add(issues, exactSha(evidence.sourceAdmissionIdentitySha256),
    'CDBV1071B_SOURCE_ADMISSION_HASH_INVALID');
  add(issues, exactSha(evidence.sourceBedStayIdentitySha256),
    'CDBV1071B_SOURCE_BED_STAY_HASH_INVALID');
  add(issues, exactSha(evidence.encounterClinicalIdentitySha256),
    'CDBV1071B_ENCOUNTER_HASH_INVALID');
  add(issues, exactSha(evidence.trafficFingerprintSha256),
    'CDBV1071B_TRAFFIC_HASH_INVALID');
  add(issues, evidence.aggregateOnlyNonPhi === true,
    'CDBV1071B_NON_PHI_EVIDENCE_REQUIRED');
  add(issues, evidence.productionMutationPerformed === false,
    'CDBV1071B_PRECONDITION_MUTATION_DETECTED');
  add(issues, evidence.trafficChanged === false, 'CDBV1071B_TRAFFIC_DRIFT');
  return [...new Set(issues)];
}

export function validateCdbV1071bAuthorization(
  authorization: CdbV1071bAuthorization,
  evidence: CdbV1071bPreconditionEvidence,
  atUtc: string = new Date().toISOString(),
): CdbV1071bAuthorizationReceipt {
  const issues = validateCdbV1071bPreconditionEvidence(evidence);
  add(issues, authorization.schemaVersion === 1, 'CDBV1071B_AUTHORIZATION_SCHEMA_INVALID');
  add(issues, authorization.operation === 'cdb_v1_071b_admission_replay_reconciliation',
    'CDBV1071B_OPERATION_INVALID');
  add(issues, typeof authorization.authorizationId === 'string'
    && authorization.authorizationId.trim() === authorization.authorizationId
    && authorization.authorizationId.length > 0,
  'CDBV1071B_AUTHORIZATION_ID_INVALID');
  add(issues,
    authorization.target.databaseName === evidence.database.name
      && authorization.target.databaseUuid === evidence.database.uuid
      && authorization.target.tenantId === evidence.tenantId
      && authorization.target.candidateCommit === evidence.candidateCommit
      && authorization.target.activeWorkerVersionId === evidence.activeWorkerVersionId
      && authorization.target.migrationFilename === evidence.migrationFilename,
    'CDBV1071B_AUTHORIZATION_TARGET_MISMATCH');
  const now = utcMillis(atUtc);
  const start = utcMillis(authorization.timing.windowStartUtc);
  const end = utcMillis(authorization.timing.windowEndUtc);
  const expiry = utcMillis(authorization.timing.expiresAtUtc);
  const issued = utcMillis(authorization.timing.issuedAtUtc);
  add(issues, now !== null && start !== null && end !== null && expiry !== null && issued !== null
    && issued <= start && start <= now && now <= end && now <= expiry,
  'CDBV1071B_AUTHORIZATION_EXPIRED');
  add(issues,
    authorization.owner.ownerId === 'rahmatullah-zisan'
      && authorization.owner.displayName === 'Rahmatullah Zisan'
      && authorization.owner.approved === true
      && authorization.owner.approvalSource === CDB_V1_071B_APPROVAL_SOURCE
      && authorization.owner.ownerModel === 'single_operator_risk_accepted'
      && authorization.owner.automaticAbortOnOperatorUnavailable === true,
    'CDBV1071B_OWNER_APPROVAL_INVALID');
  for (const [key, value] of Object.entries(EXPECTED_SCOPE)) {
    add(issues,
      authorization.scope.expected[key as keyof typeof EXPECTED_SCOPE] === value,
      `CDBV1071B_SCOPE_${key.toUpperCase()}_INVALID`);
  }
  add(issues, authorization.scope.preparationWrites.admissionMappingSupersessions === 38,
    'CDBV1071B_PREPARATION_WRITE_SCOPE_INVALID');
  add(issues,
    authorization.scope.finalizationWrites.dependencyIssueResolutions === 54
      && authorization.scope.finalizationWrites.cacheVarianceWaivers === 4,
    'CDBV1071B_FINALIZATION_WRITE_SCOPE_INVALID');
  for (const [key, value] of Object.entries(EXPECTED_POST)) {
    add(issues,
      authorization.scope.post[key as keyof typeof EXPECTED_POST] === value,
      `CDBV1071B_POST_${key.toUpperCase()}_INVALID`);
  }
  for (const key of TRUE_PERMISSIONS) {
    add(issues, authorization.permissions[key] === true,
      `CDBV1071B_PERMISSION_${key.toUpperCase()}_REQUIRED`);
  }
  for (const key of FALSE_PERMISSIONS) {
    add(issues, authorization.permissions[key] === false,
      `CDBV1071B_PERMISSION_${key.toUpperCase()}_FORBIDDEN`);
  }
  const evidenceSha256 = cdbV1071bEvidenceSha256(evidence);
  add(issues, authorization.evidence.preconditionEvidenceSha256 === evidenceSha256,
    'CDBV1071B_EVIDENCE_BINDING_INVALID');
  add(issues, authorization.confirmation.preparationProof
    === buildCdbV1071bAuthorizationProof(
      authorization.authorizationId,
      'preparation',
      evidenceSha256,
      evidence.candidateCommit,
      evidence.database.uuid,
      evidence.activeWorkerVersionId,
    ),
  'CDBV1071B_PREPARATION_PROOF_INVALID');
  add(issues, authorization.confirmation.finalizationProof
    === buildCdbV1071bAuthorizationProof(
      authorization.authorizationId,
      'finalization',
      evidenceSha256,
      evidence.candidateCommit,
      evidence.database.uuid,
      evidence.activeWorkerVersionId,
    ),
  'CDBV1071B_FINALIZATION_PROOF_INVALID');
  const unique = [...new Set(issues)];
  return {
    checkpoint: 'CDB-V1-071B-AUTHORIZATION',
    authorizationReady: unique.length === 0,
    executionReady: unique.length === 0,
    issueCount: unique.length,
    issues: unique,
    candidateCommit: evidence.candidateCommit,
    tenantId: CDB_V1_071B_TARGET_TENANT_ID,
    productionMutationPerformed: false,
    trafficChanged: false,
  };
}

function exactPreconditionOrThrow(evidence: CdbV1071bPreconditionEvidence): void {
  const issues = validateCdbV1071bPreconditionEvidence(evidence);
  if (issues.length > 0) throw new Error(`CDB-V1-071B precondition drift: ${issues.join(',')}`);
}

export function buildCdbV1071bPreparationPlan(
  evidence: CdbV1071bPreconditionEvidence,
  atUtc: string,
): CdbV1071bPreparationPlan {
  exactPreconditionOrThrow(evidence);
  if (utcMillis(atUtc) === null) throw new TypeError('atUtc must be normalized UTC');
  const issueCodes = [
    'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING',
    'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT',
  ];
  const guard: CdbV1071bStatementSpec = {
    sql: `
      SELECT CASE WHEN (
        SELECT COUNT(*)
        FROM canonical_source_mappings m
        WHERE m.tenant_id=?
          AND m.entity_type='admission'
          AND m.source_type='legacy_admission'
          AND m.mapping_status='ambiguous'
          AND m.canonical_public_id IS NULL
          AND EXISTS (
            SELECT 1 FROM canonical_processing_issues i
            WHERE i.tenant_id=m.tenant_id
              AND i.issue_type='encounter_admission_bed_backfill'
              AND i.issue_code IN (?,?)
              AND i.entity_type='admission'
              AND i.source_type='legacy_admission'
              AND i.source_public_id=m.source_public_id
              AND i.status='open'
          )
      )=38 THEN 1 ELSE abs(-9223372036854775808) END AS exact_guard
    `,
    params: [evidence.tenantId, ...issueCodes],
  };
  const supersede: CdbV1071bStatementSpec = {
    sql: `
      UPDATE canonical_source_mappings
      SET source_type='legacy_admission_replay_superseded',
          mapping_status='rejected',
          mapping_version=mapping_version+1,
          updated_at_utc=?
      WHERE tenant_id=?
        AND entity_type='admission'
        AND source_type='legacy_admission'
        AND mapping_status='ambiguous'
        AND canonical_public_id IS NULL
        AND EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=canonical_source_mappings.tenant_id
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.issue_code IN (?,?)
            AND i.entity_type='admission'
            AND i.source_type='legacy_admission'
            AND i.source_public_id=canonical_source_mappings.source_public_id
            AND i.status='open'
        )
    `,
    params: [atUtc, evidence.tenantId, ...issueCodes],
  };
  return { statements: [guard, supersede], expectedChanges: [0, 38] };
}

export function validateCdbV1071bReplayEvidence(
  before: CdbV1071bPreconditionEvidence,
  after: CdbV1071bReplayEvidence,
): string[] {
  const issues: string[] = [];
  add(issues, sameTarget(before, after), 'CDBV1071B_REPLAY_TARGET_DRIFT');
  add(issues, after.supersededAdmissionMappingCount === 38,
    'CDBV1071B_SUPERSEDED_MAPPING_COUNT_INVALID');
  add(issues, after.mappedAdmissionCount === 38 && after.canonicalAdmissionCount === 38,
    'CDBV1071B_REPLAY_ADMISSION_COUNT_INVALID');
  add(issues, after.mappedBedStayCount === 16 && after.canonicalBedStayCount === 16,
    'CDBV1071B_REPLAY_BED_STAY_COUNT_INVALID');
  add(issues,
    after.openAdmissionEncounterMappingMissingCount === 4
      && after.openAdmissionEncounterTypeMismatchCount === 34
      && after.openBedStayAdmissionMappingMissingCount === 16
      && after.openBedStatusCacheVarianceCount === 4,
    'CDBV1071B_REPLAY_ISSUE_SCOPE_DRIFT');
  add(issues, after.newReplayIssueCount === 0, 'CDBV1071B_NEW_REPLAY_ISSUES');
  add(issues, after.sourceLegacyRowsWritten === 0,
    'CDBV1071B_SOURCE_LEGACY_WRITE_DETECTED');
  add(issues, after.unexpectedTenantWriteCount === 0,
    'CDBV1071B_UNEXPECTED_TENANT_WRITE');
  add(issues, after.secondPassZeroNew === true, 'CDBV1071B_SECOND_PASS_NOT_ZERO');
  issues.push(...sourceAndTrafficIssues(before, after));
  return [...new Set(issues)];
}

export function buildCdbV1071bFinalizationPlan(
  before: CdbV1071bPreconditionEvidence,
  after: CdbV1071bReplayEvidence,
  atUtc: string,
): CdbV1071bFinalizationPlan {
  const replayIssues = validateCdbV1071bReplayEvidence(before, after);
  if (replayIssues.length > 0) {
    throw new Error(`CDB-V1-071B replay evidence drift: ${replayIssues.join(',')}`);
  }
  if (utcMillis(atUtc) === null) throw new TypeError('atUtc must be normalized UTC');
  const dependencyCodes = [
    'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING',
    'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT',
    'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING',
  ];
  const guard: CdbV1071bStatementSpec = {
    sql: `
      SELECT CASE WHEN
        (SELECT COUNT(*)
          FROM canonical_source_mappings m
          JOIN canonical_processing_issues i
            ON i.tenant_id=m.tenant_id AND i.source_public_id=m.source_public_id
          WHERE m.tenant_id=? AND m.entity_type='admission'
            AND m.source_type='legacy_admission_replay_superseded'
            AND m.mapping_status='rejected'
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.issue_code IN (?,?) AND i.status='open')=38
        AND (SELECT COUNT(*)
          FROM canonical_source_mappings m
          JOIN canonical_processing_issues i
            ON i.tenant_id=m.tenant_id AND i.source_public_id=m.source_public_id
          JOIN canonical_admissions a
            ON a.tenant_id=m.tenant_id AND a.admission_public_id=m.canonical_public_id
          WHERE m.tenant_id=? AND m.entity_type='admission'
            AND m.source_type='legacy_admission' AND m.mapping_status='mapped'
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.issue_code IN (?,?) AND i.status='open')=38
        AND (SELECT COUNT(*)
          FROM canonical_source_mappings m
          JOIN canonical_processing_issues i
            ON i.tenant_id=m.tenant_id AND i.source_public_id=m.source_public_id
          JOIN canonical_bed_stays s
            ON s.tenant_id=m.tenant_id AND s.bed_stay_public_id=m.canonical_public_id
          WHERE m.tenant_id=? AND m.entity_type='bed_stay'
            AND m.source_type='legacy_patient_bed_info' AND m.mapping_status='mapped'
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.issue_code='CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
            AND i.status='open')=16
        AND (SELECT COUNT(*) FROM canonical_processing_issues
          WHERE tenant_id=? AND issue_type='encounter_admission_bed_backfill'
            AND issue_code IN (?,?,?) AND status='open')=54
        AND (SELECT COUNT(*) FROM canonical_processing_issues
          WHERE tenant_id=? AND issue_type='encounter_admission_bed_backfill'
            AND issue_code='CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
            AND status='open')=4
      THEN 1 ELSE abs(-9223372036854775808) END AS exact_guard
    `,
    params: [
      before.tenantId,
      dependencyCodes[0],
      dependencyCodes[1],
      before.tenantId,
      dependencyCodes[0],
      dependencyCodes[1],
      before.tenantId,
      before.tenantId,
      ...dependencyCodes,
      before.tenantId,
    ],
  };
  const resolveDependencies: CdbV1071bStatementSpec = {
    sql: `
      UPDATE canonical_processing_issues
      SET status='resolved',
          resolved_at_utc=?,
          resolved_by_public_id=?,
          resolution_code='cdb_v1_071b_admission_replay_converged',
          updated_at_utc=?
      WHERE tenant_id=?
        AND issue_type='encounter_admission_bed_backfill'
        AND issue_code IN (?,?,?)
        AND status='open'
    `,
    params: [atUtc, CDB_V1_071B_ACTOR, atUtc, before.tenantId, ...dependencyCodes],
  };
  const waiveCacheVariance: CdbV1071bStatementSpec = {
    sql: `
      UPDATE canonical_processing_issues
      SET status='waived',
          resolved_at_utc=?,
          resolved_by_public_id=?,
          resolution_code='interval_evidence_authoritative',
          updated_at_utc=?
      WHERE tenant_id=?
        AND issue_type='encounter_admission_bed_backfill'
        AND issue_code='CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
        AND status='open'
    `,
    params: [atUtc, CDB_V1_071B_ACTOR, atUtc, before.tenantId],
  };
  return {
    statements: [guard, resolveDependencies, waiveCacheVariance],
    expectedChanges: [0, 54, 4],
  };
}

export function validateCdbV1071bCompletionEvidence(
  before: CdbV1071bPreconditionEvidence,
  after: CdbV1071bCompletionEvidence,
): string[] {
  const issues: string[] = [];
  add(issues, sameTarget(before, after), 'CDBV1071B_COMPLETION_TARGET_DRIFT');
  add(issues, after.mappedAdmissionCount === 38 && after.canonicalAdmissionCount === 38,
    'CDBV1071B_COMPLETION_ADMISSION_COUNT_INVALID');
  add(issues, after.mappedBedStayCount === 16 && after.canonicalBedStayCount === 16,
    'CDBV1071B_COMPLETION_BED_STAY_COUNT_INVALID');
  add(issues, after.resolvedDependencyIssueCount === 54,
    'CDBV1071B_RESOLVED_DEPENDENCY_COUNT_INVALID');
  add(issues, after.waivedCacheVarianceIssueCount === 4,
    'CDBV1071B_WAIVED_CACHE_VARIANCE_COUNT_INVALID');
  add(issues, after.remainingOpenTargetIssueCount === 0,
    'CDBV1071B_REMAINING_OPEN_TARGET_ISSUES');
  add(issues, after.sourceLegacyRowsWritten === 0,
    'CDBV1071B_SOURCE_LEGACY_WRITE_DETECTED');
  add(issues, after.unexpectedTenantWriteCount === 0,
    'CDBV1071B_UNEXPECTED_TENANT_WRITE');
  add(issues, after.secondPassZeroNew === true, 'CDBV1071B_SECOND_PASS_NOT_ZERO');
  issues.push(...sourceAndTrafficIssues(before, after));
  return [...new Set(issues)];
}

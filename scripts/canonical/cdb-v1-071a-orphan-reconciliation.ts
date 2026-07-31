import { createHash } from 'node:crypto';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import type { CdbV1071WranglerD1Database } from './cdb-v1-071-wrangler-d1-adapter';
import { loadProtectedJsonDocument } from './protected-json-document';
import {
  CDB_V1_071_CANDIDATE_SHA,
  CDB_V1_071_DATABASE_NAME,
  CDB_V1_071_DATABASE_UUID,
  CDB_V1_071_PREVIOUS_WORKER_VERSION_ID,
} from './cdb-v1-071-production-release-authorization';

export const CDB_V1_071A_CANDIDATE_SHA = CDB_V1_071_CANDIDATE_SHA;
export const CDB_V1_071A_DATABASE_NAME = CDB_V1_071_DATABASE_NAME;
export const CDB_V1_071A_DATABASE_UUID = CDB_V1_071_DATABASE_UUID;
export const CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID = CDB_V1_071_PREVIOUS_WORKER_VERSION_ID;
export const CDB_V1_071A_TARGET_TENANT_ID = '100' as const;
export const CDB_V1_071A_APPROVAL_SOURCE =
  'user_explicit_cdb_v1_071a_orphan_admission_patient_reference_reconciliation_authorization' as const;
export const CDB_V1_071A_ACTOR = 'cdb-v1-071a-orphan-reconciliation' as const;
export const CDB_V1_071A_RESOLUTION_CODE =
  'orphan_admission_reference_placeholder_linked' as const;

export interface CdbV1071aPreconditionEvidence {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-071A-ORPHAN-PRECONDITION-EVIDENCE';
  capturedAtUtc: string;
  database: { name: string; uuid: string };
  tenantId: string;
  candidateCommit: string;
  activeWorkerVersionId: string;
  orphanLegacyPatientId: number;
  orphanAdmissionCount: number;
  distinctOrphanLegacyPatientCount: number;
  missingSourcePatientReferenceCount: number;
  existingActivePatientLinkCount: number;
  mappedEncounterCount: number;
  emergencyEncounterCount: number;
  inpatientEncounterCount: number;
  migrationSourceEncounterCount: number;
  inProgressEncounterCount: number;
  openTargetIssueCount: number;
  otherAuthorizedTenantAnomalyCount: number;
  existingTargetEventCount: number;
  existingTargetMappingCount: number;
  sourceAdmissionIdentitySha256: string;
  encounterClinicalIdentitySha256: string;
  trafficFingerprintSha256: string;
  aggregateOnlyNonPhi: true;
  productionMutationPerformed: false;
  trafficChanged: false;
}

export interface CdbV1071aAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'cdb_v1_071a_orphan_admission_patient_reference_reconciliation';
  target: {
    databaseName: string;
    databaseUuid: string;
    tenantId: string;
    candidateCommit: string;
    activeWorkerVersionId: string;
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
    approvalSource: typeof CDB_V1_071A_APPROVAL_SOURCE;
    ownerModel: 'single_operator_risk_accepted';
    automaticAbortOnOperatorUnavailable: boolean;
  };
  scope: {
    expected: {
      orphanAdmissionCount: number;
      distinctOrphanLegacyPatientCount: number;
      missingSourcePatientReferenceCount: number;
      existingActivePatientLinkCount: number;
      mappedEncounterCount: number;
      emergencyEncounterCount: number;
      inpatientEncounterCount: number;
      migrationSourceEncounterCount: number;
      inProgressEncounterCount: number;
      openTargetIssueCount: number;
      otherAuthorizedTenantAnomalyCount: number;
    };
    writes: {
      patientLinks: number;
      patientLinkEvents: number;
      sourceMappings: number;
      encounters: number;
      processingIssues: number;
    };
    post: {
      activePatientLinks: number;
      linkEvents: number;
      sourceMappings: number;
      hardenedEncounters: number;
      remainingOpenTargetIssues: number;
      resolvedTargetIssues: number;
      sourcePatientRowsWritten: number;
      sourceAdmissionRowsWritten: number;
      unexpectedTenantWrites: number;
      trafficChanged: boolean;
    };
  };
  permissions: {
    aggregateProductionRead: boolean;
    boundedInternalReferenceRead: boolean;
    atomicReconciliationWrite: boolean;
    resumeAuthorizedBackfill: boolean;
    continueAuthorizedStagedRolloutAfterGates: boolean;
    sourcePatientWrite: boolean;
    sourceAdmissionWrite: boolean;
    unrelatedLegacyWrite: boolean;
    phiReconstruction: boolean;
    workerUploadDuringReconciliation: boolean;
    trafficChangeDuringReconciliation: boolean;
    providerFlagChange: boolean;
    canonicalAuthorityPromotion: boolean;
    localSyncActivation: boolean;
    legacyRetirement: boolean;
    routeChange: boolean;
    destructiveAction: boolean;
    databaseDeletion: boolean;
  };
  evidence: {
    approvalEvidenceSha256: string;
    preconditionEvidenceSha256: string;
  };
  confirmation: {
    reconciliationProof: string;
  };
}

export interface CdbV1071aAuthorizationReceipt {
  checkpoint: 'CDB-V1-071A-AUTHORIZATION';
  authorizationReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
  candidateCommit: typeof CDB_V1_071A_CANDIDATE_SHA;
  tenantId: typeof CDB_V1_071A_TARGET_TENANT_ID;
  productionMutationPerformed: false;
  trafficChanged: false;
}

export interface CdbV1071aStatementSpec {
  sql: string;
  params: unknown[];
}

export interface CdbV1071aAtomicPlan {
  patientLinkPublicId: string;
  eventPublicId: string;
  evidenceSha256: string;
  idempotencyKey: string;
  statements: CdbV1071aStatementSpec[];
  expectedChanges: readonly [0, 1, 1, 1, 2, 2, 0];
}

const AUTHORIZATION_ROOT_KEYS = [
  'schemaVersion', 'authorizationId', 'operation', 'target', 'timing', 'owner',
  'scope', 'permissions', 'evidence', 'confirmation',
] as const;

const EXPECTED_SCOPE = {
  orphanAdmissionCount: 2,
  distinctOrphanLegacyPatientCount: 1,
  missingSourcePatientReferenceCount: 1,
  existingActivePatientLinkCount: 0,
  mappedEncounterCount: 2,
  emergencyEncounterCount: 1,
  inpatientEncounterCount: 1,
  migrationSourceEncounterCount: 2,
  inProgressEncounterCount: 2,
  openTargetIssueCount: 2,
  otherAuthorizedTenantAnomalyCount: 0,
} as const;

const EXPECTED_WRITES = {
  patientLinks: 1,
  patientLinkEvents: 1,
  sourceMappings: 1,
  encounters: 2,
  processingIssues: 2,
} as const;

const EXPECTED_POST = {
  activePatientLinks: 1,
  linkEvents: 1,
  sourceMappings: 1,
  hardenedEncounters: 2,
  remainingOpenTargetIssues: 0,
  resolvedTargetIssues: 2,
  sourcePatientRowsWritten: 0,
  sourceAdmissionRowsWritten: 0,
  unexpectedTenantWrites: 0,
  trafficChanged: false,
} as const;

const TRUE_PERMISSIONS = [
  'aggregateProductionRead',
  'boundedInternalReferenceRead',
  'atomicReconciliationWrite',
  'resumeAuthorizedBackfill',
  'continueAuthorizedStagedRolloutAfterGates',
] as const;

const FALSE_PERMISSIONS = [
  'sourcePatientWrite',
  'sourceAdmissionWrite',
  'unrelatedLegacyWrite',
  'phiReconstruction',
  'workerUploadDuringReconciliation',
  'trafficChangeDuringReconciliation',
  'providerFlagChange',
  'canonicalAuthorityPromotion',
  'localSyncActivation',
  'legacyRetirement',
  'routeChange',
  'destructiveAction',
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

export function cdbV1071aEvidenceSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function buildCdbV1071aAuthorizationProof(
  authorizationId: string,
  preconditionEvidenceSha256: string,
): string {
  return `cdbv1071a:reconciliation:${createHash('sha256').update([
    authorizationId,
    preconditionEvidenceSha256,
    CDB_V1_071A_CANDIDATE_SHA,
    CDB_V1_071A_DATABASE_UUID,
    CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
  ].join('|')).digest('hex')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function normalizedUtc(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function exactSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function sameRecord(actual: unknown, expected: Record<string, unknown>): boolean {
  return isRecord(actual)
    && exactKeys(actual, Object.keys(expected))
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function add(issues: string[], condition: boolean, code: string): void {
  if (!condition) issues.push(code);
}

export function validateCdbV1071aAuthorization(
  value: unknown,
  atUtc: string = new Date().toISOString(),
): CdbV1071aAuthorizationReceipt {
  const issues: string[] = [];
  const root = isRecord(value) ? value : null;
  add(issues, Boolean(root), 'CDBV1071A_AUTHORIZATION_SCHEMA_INVALID');
  add(issues, exactKeys(root, AUTHORIZATION_ROOT_KEYS), 'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
  const document = root as unknown as CdbV1071aAuthorization;

  if (root) {
    add(issues, document.schemaVersion === 1, 'CDBV1071A_AUTHORIZATION_SCHEMA_INVALID');
    add(issues, nonEmpty(document.authorizationId), 'CDBV1071A_AUTHORIZATION_SCHEMA_INVALID');
    add(issues,
      document.operation === 'cdb_v1_071a_orphan_admission_patient_reference_reconciliation',
      'CDBV1071A_AUTHORIZATION_SCOPE_INVALID');

    add(issues, exactKeys(document.target, [
      'databaseName', 'databaseUuid', 'tenantId', 'candidateCommit', 'activeWorkerVersionId',
    ]), 'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    add(issues,
      document.target?.databaseName === CDB_V1_071A_DATABASE_NAME
      && document.target?.databaseUuid === CDB_V1_071A_DATABASE_UUID
      && document.target?.tenantId === CDB_V1_071A_TARGET_TENANT_ID
      && document.target?.candidateCommit === CDB_V1_071A_CANDIDATE_SHA
      && document.target?.activeWorkerVersionId === CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
      'CDBV1071A_AUTHORIZATION_TARGET_INVALID');

    add(issues, exactKeys(document.owner, [
      'ownerId', 'displayName', 'approved', 'approvalSource', 'ownerModel',
      'automaticAbortOnOperatorUnavailable',
    ]), 'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    add(issues,
      nonEmpty(document.owner?.ownerId)
      && document.owner?.displayName === 'Rahmatullah Zisan'
      && document.owner?.approved === true
      && document.owner?.approvalSource === CDB_V1_071A_APPROVAL_SOURCE
      && document.owner?.ownerModel === 'single_operator_risk_accepted'
      && document.owner?.automaticAbortOnOperatorUnavailable === true,
      'CDBV1071A_AUTHORIZATION_OWNER_INVALID');

    add(issues, exactKeys(document.scope, ['expected', 'writes', 'post']),
      'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    add(issues, sameRecord(document.scope?.expected, EXPECTED_SCOPE),
      'CDBV1071A_AUTHORIZATION_EXPECTED_SCOPE_INVALID');
    add(issues, sameRecord(document.scope?.writes, EXPECTED_WRITES),
      'CDBV1071A_AUTHORIZATION_WRITE_SCOPE_INVALID');
    add(issues, sameRecord(document.scope?.post, EXPECTED_POST),
      'CDBV1071A_AUTHORIZATION_POST_SCOPE_INVALID');

    const permissionKeys = [...TRUE_PERMISSIONS, ...FALSE_PERMISSIONS];
    add(issues, exactKeys(document.permissions, permissionKeys),
      'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    add(issues,
      TRUE_PERMISSIONS.every((key) => document.permissions?.[key] === true)
      && FALSE_PERMISSIONS.every((key) => document.permissions?.[key] === false),
      'CDBV1071A_AUTHORIZATION_PERMISSION_INVALID');

    add(issues, exactKeys(document.evidence, [
      'approvalEvidenceSha256', 'preconditionEvidenceSha256',
    ]), 'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    add(issues,
      exactSha(document.evidence?.approvalEvidenceSha256)
      && exactSha(document.evidence?.preconditionEvidenceSha256),
      'CDBV1071A_AUTHORIZATION_EVIDENCE_INVALID');

    add(issues, exactKeys(document.confirmation, ['reconciliationProof']),
      'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    add(issues,
      document.confirmation?.reconciliationProof
        === buildCdbV1071aAuthorizationProof(
          document.authorizationId,
          document.evidence?.preconditionEvidenceSha256,
        ),
      'CDBV1071A_AUTHORIZATION_CONFIRMATION_INVALID');

    add(issues, exactKeys(document.timing, [
      'issuedAtUtc', 'windowStartUtc', 'windowEndUtc', 'expiresAtUtc',
    ]), 'CDBV1071A_AUTHORIZATION_UNKNOWN_FIELD');
    const issued = normalizedUtc(document.timing?.issuedAtUtc);
    const start = normalizedUtc(document.timing?.windowStartUtc);
    const end = normalizedUtc(document.timing?.windowEndUtc);
    const expires = normalizedUtc(document.timing?.expiresAtUtc);
    const at = normalizedUtc(atUtc);
    add(issues,
      issued !== null && start !== null && end !== null && expires !== null && at !== null
      && issued <= start && start <= at && at <= end && end === expires
      && end - start <= 2 * 60 * 60 * 1000,
      at !== null && expires !== null && at > expires
        ? 'CDBV1071A_AUTHORIZATION_EXPIRED'
        : 'CDBV1071A_AUTHORIZATION_TIMING_INVALID');
  }

  const unique = [...new Set(issues)];
  const ready = unique.length === 0;
  return {
    checkpoint: 'CDB-V1-071A-AUTHORIZATION',
    authorizationReady: ready,
    executionReady: ready,
    issueCount: unique.length,
    issues: unique,
    candidateCommit: CDB_V1_071A_CANDIDATE_SHA,
    tenantId: CDB_V1_071A_TARGET_TENANT_ID,
    productionMutationPerformed: false,
    trafficChanged: false,
  };
}

export function validateCdbV1071aPreconditionEvidence(
  evidence: CdbV1071aPreconditionEvidence,
): string[] {
  const issues: string[] = [];
  add(issues, evidence.schemaVersion === 1
    && evidence.checkpoint === 'CDB-V1-071A-ORPHAN-PRECONDITION-EVIDENCE',
  'CDBV1071A_EVIDENCE_SCHEMA_INVALID');
  add(issues, normalizedUtc(evidence.capturedAtUtc) !== null,
    'CDBV1071A_EVIDENCE_TIME_INVALID');
  add(issues,
    evidence.database?.name === CDB_V1_071A_DATABASE_NAME
    && evidence.database?.uuid === CDB_V1_071A_DATABASE_UUID
    && evidence.tenantId === CDB_V1_071A_TARGET_TENANT_ID
    && evidence.candidateCommit === CDB_V1_071A_CANDIDATE_SHA
    && evidence.activeWorkerVersionId === CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
    'CDBV1071A_EVIDENCE_TARGET_INVALID');
  add(issues, Number.isSafeInteger(evidence.orphanLegacyPatientId)
    && evidence.orphanLegacyPatientId > 0,
  'CDBV1071A_ORPHAN_REFERENCE_INVALID');
  add(issues, evidence.orphanAdmissionCount === 2,
    'CDBV1071A_ORPHAN_ADMISSION_COUNT_INVALID');
  add(issues, evidence.distinctOrphanLegacyPatientCount === 1,
    'CDBV1071A_ORPHAN_REFERENCE_COUNT_INVALID');
  add(issues, evidence.missingSourcePatientReferenceCount === 1,
    'CDBV1071A_MISSING_SOURCE_REFERENCE_COUNT_INVALID');
  add(issues, evidence.existingActivePatientLinkCount === 0,
    'CDBV1071A_EXISTING_PATIENT_LINK');
  add(issues, evidence.mappedEncounterCount === 2
    && evidence.emergencyEncounterCount === 1
    && evidence.inpatientEncounterCount === 1
    && evidence.migrationSourceEncounterCount === 2
    && evidence.inProgressEncounterCount === 2,
  'CDBV1071A_ENCOUNTER_SCOPE_INVALID');
  add(issues, evidence.openTargetIssueCount === 2,
    'CDBV1071A_TARGET_ISSUE_COUNT_INVALID');
  add(issues, evidence.otherAuthorizedTenantAnomalyCount === 0,
    'CDBV1071A_CROSS_TENANT_ANOMALY');
  add(issues, evidence.existingTargetEventCount === 0,
    'CDBV1071A_EXISTING_TARGET_EVENT');
  add(issues, evidence.existingTargetMappingCount === 0,
    'CDBV1071A_EXISTING_TARGET_MAPPING');
  add(issues,
    exactSha(evidence.sourceAdmissionIdentitySha256)
    && exactSha(evidence.encounterClinicalIdentitySha256)
    && exactSha(evidence.trafficFingerprintSha256),
    'CDBV1071A_EVIDENCE_HASH_INVALID');
  add(issues,
    evidence.aggregateOnlyNonPhi === true
    && evidence.productionMutationPerformed === false,
    'CDBV1071A_EVIDENCE_SCOPE_INVALID');
  add(issues, evidence.trafficChanged === false, 'CDBV1071A_TRAFFIC_DRIFT');
  return [...new Set(issues)];
}

const targetEncounterCte = `
  orphan_admissions AS (
    SELECT a.id,a.patient_id
    FROM admissions a
    LEFT JOIN patients p
      ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
    WHERE CAST(a.tenant_id AS TEXT)='100' AND a.patient_id=? AND p.id IS NULL
  ),
  target_encounters AS (
    SELECT DISTINCT e.id,e.encounter_public_id,e.legacy_patient_id,e.patient_link_public_id,
      e.encounter_type,e.status,e.source_kind,e.encounter_version
    FROM orphan_admissions oa
    JOIN canonical_source_mappings m
      ON CAST(m.tenant_id AS TEXT)='100'
     AND m.entity_type='encounter'
     AND m.source_type='legacy_admission'
     AND m.source_public_id=CAST(oa.id AS TEXT)
     AND m.mapping_status='mapped'
    JOIN canonical_encounters e
      ON CAST(e.tenant_id AS TEXT)='100'
     AND e.encounter_public_id=m.canonical_public_id
     AND e.legacy_patient_id=oa.patient_id
  ),
  target_issues AS (
    SELECT i.id,i.source_public_id,i.status,i.resolution_code,i.resolved_by_public_id
    FROM canonical_processing_issues i
    JOIN target_encounters e ON e.encounter_public_id=i.source_public_id
    WHERE CAST(i.tenant_id AS TEXT)='100'
      AND i.issue_code='CDB113E_PATIENT_LINK_MISSING'
      AND i.entity_type='encounter'
      AND i.source_type='canonical_encounter'
  )`;

function preGuardSql(): string {
  return `WITH ${targetEncounterCte}
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM orphan_admissions)=2
    AND (SELECT COUNT(DISTINCT patient_id) FROM orphan_admissions)=1
    AND (SELECT COUNT(*) FROM patients p WHERE CAST(p.tenant_id AS TEXT)='100' AND p.id=?)=0
    AND (SELECT COUNT(*) FROM canonical_tenant_patient_links l
      WHERE CAST(l.tenant_id AS TEXT)='100' AND l.legacy_patient_id=?
        AND l.link_status NOT IN ('rejected','retired') AND l.effective_to_utc IS NULL)=0
    AND (SELECT COUNT(*) FROM target_encounters)=2
    AND (SELECT COUNT(*) FROM target_encounters WHERE encounter_type='emergency')=1
    AND (SELECT COUNT(*) FROM target_encounters WHERE encounter_type='inpatient')=1
    AND (SELECT COUNT(*) FROM target_encounters WHERE source_kind='migration')=2
    AND (SELECT COUNT(*) FROM target_encounters WHERE status='in_progress')=2
    AND (SELECT COUNT(*) FROM target_encounters WHERE patient_link_public_id IS NULL)=2
    AND (SELECT COUNT(*) FROM target_issues WHERE status='open')=2
    AND (SELECT COUNT(*) FROM canonical_tenant_patient_link_events
      WHERE CAST(tenant_id AS TEXT)='100' AND event_public_id=?)=0
    AND (SELECT COUNT(*) FROM canonical_source_mappings
      WHERE CAST(tenant_id AS TEXT)='100' AND entity_type='patient_link'
        AND source_type='legacy_admission_patient_reference' AND source_public_id=?)=0
    AND (SELECT COUNT(*) FROM admissions a
      LEFT JOIN patients p ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
      WHERE CAST(a.tenant_id AS TEXT) IN ('1','101','102') AND p.id IS NULL)=0
    THEN 1 ELSE abs(-9223372036854775808) END AS guard_ok;`;
}

function targetEncounterPredicate(): string {
  return `encounter_public_id IN (
    SELECT m.canonical_public_id
    FROM admissions a
    JOIN canonical_source_mappings m
      ON CAST(m.tenant_id AS TEXT)='100'
     AND m.entity_type='encounter'
     AND m.source_type='legacy_admission'
     AND m.source_public_id=CAST(a.id AS TEXT)
     AND m.mapping_status='mapped'
    LEFT JOIN patients p
      ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
    WHERE CAST(a.tenant_id AS TEXT)='100' AND a.patient_id=? AND p.id IS NULL
  )`;
}

function postGuardSql(): string {
  return `WITH ${targetEncounterCte}
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM canonical_tenant_patient_links
      WHERE CAST(tenant_id AS TEXT)='100' AND patient_link_public_id=?
        AND legacy_patient_id=? AND global_patient_uhid IS NULL
        AND link_status='unlinked' AND verification_level='unverified'
        AND evidence_type='no_link_placeholder' AND effective_to_utc IS NULL AND version=1)=1
    AND (SELECT COUNT(*) FROM canonical_tenant_patient_link_events
      WHERE CAST(tenant_id AS TEXT)='100' AND event_public_id=?
        AND patient_link_public_id=? AND legacy_patient_id=?
        AND event_type='registered' AND from_status IS NULL AND to_status='unlinked'
        AND actor_system_key='cdb-v1-071a-orphan-reconciliation'
        AND reason_code='orphan_admission_patient_reference'
        AND evidence_type='no_link_placeholder' AND sequence=1)=1
    AND (SELECT COUNT(*) FROM canonical_source_mappings
      WHERE CAST(tenant_id AS TEXT)='100' AND entity_type='patient_link'
        AND canonical_public_id=? AND source_type='legacy_admission_patient_reference'
        AND source_public_id=? AND source_table='admissions'
        AND mapping_status='mapped' AND mapping_version=1)=1
    AND (SELECT COUNT(*) FROM target_encounters
      WHERE patient_link_public_id=? AND source_kind='backfill'
        AND status='in_progress' AND encounter_version>=1)=2
    AND (SELECT COUNT(*) FROM target_issues WHERE status='open')=0
    AND (SELECT COUNT(*) FROM target_issues
      WHERE status='resolved'
        AND resolution_code='orphan_admission_reference_placeholder_linked'
        AND resolved_by_public_id='cdb-v1-071a-orphan-reconciliation')=2
    AND (SELECT COUNT(*) FROM patients p WHERE CAST(p.tenant_id AS TEXT)='100' AND p.id=?)=0
    AND (SELECT COUNT(*) FROM orphan_admissions)=2
    AND (SELECT COUNT(*) FROM canonical_tenant_patient_links
      WHERE CAST(tenant_id AS TEXT)<>'100' AND patient_link_public_id=?)=0
    AND (SELECT COUNT(*) FROM canonical_tenant_patient_link_events
      WHERE CAST(tenant_id AS TEXT)<>'100' AND event_public_id=?)=0
    THEN 1 ELSE abs(-9223372036854775808) END AS guard_ok;`;
}

export async function buildCdbV1071aAtomicPlan(
  evidence: CdbV1071aPreconditionEvidence,
  nowUtc: string,
): Promise<CdbV1071aAtomicPlan> {
  const issues = validateCdbV1071aPreconditionEvidence(evidence);
  if (issues.length > 0) throw new Error(`CDB-V1-071A precondition mismatch: ${issues.join(',')}`);
  if (normalizedUtc(nowUtc) === null) throw new Error('nowUtc must be normalized UTC');
  const sourceId = String(evidence.orphanLegacyPatientId);
  const patientLinkPublicId = await createDeterministicSourceId(
    'ptlink', CDB_V1_071A_TARGET_TENANT_ID,
    'legacy_admission_patient_reference', sourceId,
  );
  const eventPublicId = await createDeterministicSourceId(
    'ptlevt', CDB_V1_071A_TARGET_TENANT_ID,
    'legacy_admission_patient_reference_event', sourceId,
  );
  const evidenceSha256 = await createSourceEvidenceSha256({
    checkpoint: 'CDB-V1-071A',
    tenantId: CDB_V1_071A_TARGET_TENANT_ID,
    sourceType: 'legacy_admission_patient_reference',
    sourceTable: 'admissions',
    legacyPatientId: evidence.orphanLegacyPatientId,
    orphanAdmissionCount: evidence.orphanAdmissionCount,
    sourceAdmissionIdentitySha256: evidence.sourceAdmissionIdentitySha256,
    encounterClinicalIdentitySha256: evidence.encounterClinicalIdentitySha256,
  });
  const idempotencyKey = `cdb-v1-071a:${patientLinkPublicId}:registered`;

  const statements: CdbV1071aStatementSpec[] = [
    {
      sql: preGuardSql(),
      params: [
        evidence.orphanLegacyPatientId,
        evidence.orphanLegacyPatientId,
        evidence.orphanLegacyPatientId,
        eventPublicId,
        sourceId,
      ],
    },
    {
      sql: `INSERT INTO canonical_tenant_patient_links (
        tenant_id,patient_link_public_id,legacy_patient_id,global_patient_uhid,
        link_status,verification_level,evidence_type,evidence_sha256,
        effective_from_utc,effective_to_utc,version,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,NULL,1,?,?)`,
      params: [
        CDB_V1_071A_TARGET_TENANT_ID,
        patientLinkPublicId,
        evidence.orphanLegacyPatientId,
        null,
        'unlinked',
        'unverified',
        'no_link_placeholder',
        evidenceSha256,
        nowUtc,
        nowUtc,
        nowUtc,
      ],
    },
    {
      sql: `INSERT INTO canonical_tenant_patient_link_events (
        tenant_id,event_public_id,patient_link_public_id,legacy_patient_id,
        global_patient_uhid,event_type,from_status,to_status,
        source_legacy_patient_id,target_legacy_patient_id,actor_user_id,actor_system_key,
        reason_code,evidence_type,evidence_sha256,idempotency_key,sequence,
        occurred_at_utc,created_at_utc
      ) VALUES (?,?,?,?,NULL,'registered',NULL,'unlinked',NULL,NULL,NULL,
        'cdb-v1-071a-orphan-reconciliation','orphan_admission_patient_reference',
        'no_link_placeholder',?,?,1,?,?)`,
      params: [
        CDB_V1_071A_TARGET_TENANT_ID,
        eventPublicId,
        patientLinkPublicId,
        evidence.orphanLegacyPatientId,
        evidenceSha256,
        idempotencyKey,
        nowUtc,
        nowUtc,
      ],
    },
    {
      sql: `INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,'patient_link',?,'legacy_admission_patient_reference',?,
        'admissions','mapped',1,NULL,?,?,?)`,
      params: [
        CDB_V1_071A_TARGET_TENANT_ID,
        patientLinkPublicId,
        sourceId,
        evidenceSha256,
        nowUtc,
        nowUtc,
      ],
    },
    {
      sql: `UPDATE canonical_encounters
      SET patient_link_public_id=?,
          encounter_version=CASE WHEN encounter_version<1 THEN 1 ELSE encounter_version END,
          source_kind='backfill',updated_at_utc=?
      WHERE CAST(tenant_id AS TEXT)='100'
        AND legacy_patient_id=?
        AND patient_link_public_id IS NULL
        AND source_kind='migration'
        AND status='in_progress'
        AND encounter_type IN ('emergency','inpatient')
        AND ${targetEncounterPredicate()}`,
      params: [
        patientLinkPublicId,
        nowUtc,
        evidence.orphanLegacyPatientId,
        evidence.orphanLegacyPatientId,
      ],
    },
    {
      sql: `UPDATE canonical_processing_issues
      SET status='resolved',resolved_at_utc=?,
          resolved_by_public_id='cdb-v1-071a-orphan-reconciliation',
          resolution_code='orphan_admission_reference_placeholder_linked',updated_at_utc=?
      WHERE CAST(tenant_id AS TEXT)='100'
        AND issue_code='CDB113E_PATIENT_LINK_MISSING'
        AND entity_type='encounter'
        AND source_type='canonical_encounter'
        AND status='open'
        AND source_public_id IN (
          SELECT e.encounter_public_id
          FROM canonical_encounters e
          WHERE CAST(e.tenant_id AS TEXT)='100'
            AND e.legacy_patient_id=?
            AND e.patient_link_public_id=?
            AND e.source_kind='backfill'
            AND e.status='in_progress'
            AND e.encounter_type IN ('emergency','inpatient')
        )`,
      params: [
        nowUtc,
        nowUtc,
        evidence.orphanLegacyPatientId,
        patientLinkPublicId,
      ],
    },
    {
      sql: postGuardSql(),
      params: [
        evidence.orphanLegacyPatientId,
        patientLinkPublicId,
        evidence.orphanLegacyPatientId,
        eventPublicId,
        patientLinkPublicId,
        evidence.orphanLegacyPatientId,
        patientLinkPublicId,
        sourceId,
        patientLinkPublicId,
        evidence.orphanLegacyPatientId,
        patientLinkPublicId,
        eventPublicId,
      ],
    },
  ];

  return {
    patientLinkPublicId,
    eventPublicId,
    evidenceSha256,
    idempotencyKey,
    statements,
    expectedChanges: [0, 1, 1, 1, 2, 2, 0],
  };
}

interface OrphanAdmissionReferenceRow {
  admission_id: number;
  legacy_patient_id: number;
}

interface OrphanEncounterReferenceRow {
  encounter_id: number;
  encounter_public_id: string;
  legacy_patient_id: number;
  patient_link_public_id: string | null;
  encounter_type: string;
  status: string;
  source_kind: string;
  encounter_version: number;
  started_at_utc: string;
  ended_at_utc: string | null;
  signed_snapshot_sha256: string | null;
  signed_at_utc: string | null;
  source_evidence_sha256: string;
  created_at_utc: string;
}

interface OrphanEvidenceSummaryRow {
  existing_active_patient_link_count: number;
  open_target_issue_count: number;
  other_authorized_tenant_anomaly_count: number;
  existing_target_event_count: number;
  existing_target_mapping_count: number;
}

export interface CdbV1071aCollectionOptions {
  capturedAtUtc: string;
  activeWorkerVersionId: string;
  trafficFingerprintSha256: string;
}

function safeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} was invalid`);
  return parsed;
}

export async function collectCdbV1071aPreconditionEvidence(
  db: CdbV1071WranglerD1Database,
  options: CdbV1071aCollectionOptions,
): Promise<CdbV1071aPreconditionEvidence> {
  if (normalizedUtc(options.capturedAtUtc) === null) {
    throw new Error('capturedAtUtc must be normalized UTC');
  }
  if (options.activeWorkerVersionId !== CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID) {
    throw new Error('active Worker version drift');
  }
  if (!exactSha(options.trafficFingerprintSha256)) {
    throw new Error('traffic fingerprint must be SHA-256');
  }

  const orphanAdmissions = (await db.prepare(`
    SELECT a.id AS admission_id,a.patient_id AS legacy_patient_id
    FROM admissions a
    LEFT JOIN patients p
      ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
    WHERE CAST(a.tenant_id AS TEXT)='100' AND p.id IS NULL
    ORDER BY a.id
    LIMIT 3
  `).all<OrphanAdmissionReferenceRow>()).results;
  const orphanIds = [...new Set(orphanAdmissions.map((row) => safeInteger(
    row.legacy_patient_id,
    'orphan legacy patient reference',
  )))];
  if (orphanIds.length !== 1) {
    throw new Error('orphan legacy patient reference was not exact');
  }
  const orphanLegacyPatientId = orphanIds[0];

  const encounters = (await db.prepare(`
    SELECT DISTINCT
      e.id AS encounter_id,e.encounter_public_id,e.legacy_patient_id,
      e.patient_link_public_id,e.encounter_type,e.status,e.source_kind,
      e.encounter_version,e.started_at_utc,e.ended_at_utc,
      e.signed_snapshot_sha256,e.signed_at_utc,e.source_evidence_sha256,e.created_at_utc
    FROM canonical_encounters e
    JOIN canonical_source_mappings m
      ON CAST(m.tenant_id AS TEXT)=CAST(e.tenant_id AS TEXT)
     AND m.entity_type='encounter'
     AND m.source_type='legacy_admission'
     AND m.canonical_public_id=e.encounter_public_id
     AND m.mapping_status='mapped'
    JOIN admissions a
      ON CAST(a.tenant_id AS TEXT)=CAST(e.tenant_id AS TEXT)
     AND CAST(a.id AS TEXT)=m.source_public_id
    LEFT JOIN patients p
      ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
    WHERE CAST(e.tenant_id AS TEXT)='100'
      AND a.patient_id=? AND p.id IS NULL
    ORDER BY e.id
    LIMIT 3
  `).bind(orphanLegacyPatientId).all<OrphanEncounterReferenceRow>()).results;

  const eventPublicId = await createDeterministicSourceId(
    'ptlevt', CDB_V1_071A_TARGET_TENANT_ID,
    'legacy_admission_patient_reference_event', String(orphanLegacyPatientId),
  );
  const summary = await db.prepare(`
    WITH target_encounters AS (
      SELECT DISTINCT e.encounter_public_id
      FROM canonical_encounters e
      JOIN canonical_source_mappings m
        ON CAST(m.tenant_id AS TEXT)=CAST(e.tenant_id AS TEXT)
       AND m.entity_type='encounter'
       AND m.source_type='legacy_admission'
       AND m.canonical_public_id=e.encounter_public_id
       AND m.mapping_status='mapped'
      JOIN admissions a
        ON CAST(a.tenant_id AS TEXT)=CAST(e.tenant_id AS TEXT)
       AND CAST(a.id AS TEXT)=m.source_public_id
      LEFT JOIN patients p
        ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
      WHERE CAST(e.tenant_id AS TEXT)='100' AND a.patient_id=? AND p.id IS NULL
    )
    SELECT
      (SELECT COUNT(*) FROM canonical_tenant_patient_links l
        WHERE CAST(l.tenant_id AS TEXT)='100' AND l.legacy_patient_id=?
          AND l.link_status NOT IN ('rejected','retired')
          AND l.effective_to_utc IS NULL) AS existing_active_patient_link_count,
      (SELECT COUNT(*) FROM canonical_processing_issues i
        JOIN target_encounters t ON t.encounter_public_id=i.source_public_id
        WHERE CAST(i.tenant_id AS TEXT)='100'
          AND i.issue_code='CDB113E_PATIENT_LINK_MISSING'
          AND i.entity_type='encounter'
          AND i.source_type='canonical_encounter'
          AND i.status='open') AS open_target_issue_count,
      (SELECT COUNT(*) FROM admissions a
        LEFT JOIN patients p
          ON CAST(p.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND p.id=a.patient_id
        WHERE CAST(a.tenant_id AS TEXT) IN ('1','101','102') AND p.id IS NULL)
        AS other_authorized_tenant_anomaly_count,
      (SELECT COUNT(*) FROM canonical_tenant_patient_link_events
        WHERE CAST(tenant_id AS TEXT)='100' AND event_public_id=?)
        AS existing_target_event_count,
      (SELECT COUNT(*) FROM canonical_source_mappings
        WHERE CAST(tenant_id AS TEXT)='100'
          AND entity_type='patient_link'
          AND source_type='legacy_admission_patient_reference'
          AND source_public_id=?) AS existing_target_mapping_count
  `).bind(
    orphanLegacyPatientId,
    orphanLegacyPatientId,
    eventPublicId,
    String(orphanLegacyPatientId),
  ).first<OrphanEvidenceSummaryRow>();
  if (!summary) throw new Error('orphan evidence summary was unavailable');

  const sourceAdmissionIdentitySha256 = cdbV1071aEvidenceSha256(
    orphanAdmissions.map((row) => ({
      admissionId: safeInteger(row.admission_id, 'admission id'),
      legacyPatientId: safeInteger(row.legacy_patient_id, 'admission patient reference'),
    })),
  );
  const encounterClinicalIdentitySha256 = cdbV1071aEvidenceSha256(
    encounters.map((row) => ({
      encounterId: safeInteger(row.encounter_id, 'encounter id'),
      encounterPublicId: row.encounter_public_id,
      legacyPatientId: safeInteger(row.legacy_patient_id, 'encounter patient reference'),
      encounterType: row.encounter_type,
      status: row.status,
      startedAtUtc: row.started_at_utc,
      endedAtUtc: row.ended_at_utc,
      signedSnapshotSha256: row.signed_snapshot_sha256,
      signedAtUtc: row.signed_at_utc,
      sourceEvidenceSha256: row.source_evidence_sha256,
      createdAtUtc: row.created_at_utc,
    })),
  );

  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-071A-ORPHAN-PRECONDITION-EVIDENCE',
    capturedAtUtc: options.capturedAtUtc,
    database: { name: CDB_V1_071A_DATABASE_NAME, uuid: CDB_V1_071A_DATABASE_UUID },
    tenantId: CDB_V1_071A_TARGET_TENANT_ID,
    candidateCommit: CDB_V1_071A_CANDIDATE_SHA,
    activeWorkerVersionId: options.activeWorkerVersionId,
    orphanLegacyPatientId,
    orphanAdmissionCount: orphanAdmissions.length,
    distinctOrphanLegacyPatientCount: orphanIds.length,
    missingSourcePatientReferenceCount: orphanIds.length,
    existingActivePatientLinkCount: safeInteger(
      summary.existing_active_patient_link_count,
      'existing active patient link count',
    ),
    mappedEncounterCount: encounters.length,
    emergencyEncounterCount: encounters.filter((row) => row.encounter_type === 'emergency').length,
    inpatientEncounterCount: encounters.filter((row) => row.encounter_type === 'inpatient').length,
    migrationSourceEncounterCount: encounters.filter((row) => row.source_kind === 'migration').length,
    inProgressEncounterCount: encounters.filter((row) => row.status === 'in_progress').length,
    openTargetIssueCount: safeInteger(summary.open_target_issue_count, 'open target issue count'),
    otherAuthorizedTenantAnomalyCount: safeInteger(
      summary.other_authorized_tenant_anomaly_count,
      'other tenant anomaly count',
    ),
    existingTargetEventCount: safeInteger(
      summary.existing_target_event_count,
      'existing target event count',
    ),
    existingTargetMappingCount: safeInteger(
      summary.existing_target_mapping_count,
      'existing target mapping count',
    ),
    sourceAdmissionIdentitySha256,
    encounterClinicalIdentitySha256,
    trafficFingerprintSha256: options.trafficFingerprintSha256,
    aggregateOnlyNonPhi: true,
    productionMutationPerformed: false,
    trafficChanged: false,
  };
}

export function validateCdbV1071aPostEvidence(
  before: CdbV1071aPreconditionEvidence,
  after: CdbV1071aPreconditionEvidence,
): string[] {
  const issues: string[] = [];
  add(issues,
    after.database.name === before.database.name
    && after.database.uuid === before.database.uuid
    && after.tenantId === before.tenantId
    && after.candidateCommit === before.candidateCommit
    && after.activeWorkerVersionId === before.activeWorkerVersionId,
    'CDBV1071A_POST_TARGET_DRIFT');
  add(issues,
    after.orphanLegacyPatientId === before.orphanLegacyPatientId
    && after.orphanAdmissionCount === 2
    && after.distinctOrphanLegacyPatientCount === 1
    && after.missingSourcePatientReferenceCount === 1,
    'CDBV1071A_POST_ORPHAN_SCOPE_INVALID');
  add(issues, after.existingActivePatientLinkCount === 1,
    'CDBV1071A_POST_PATIENT_LINK_COUNT_INVALID');
  add(issues,
    after.mappedEncounterCount === 2
    && after.emergencyEncounterCount === 1
    && after.inpatientEncounterCount === 1
    && after.migrationSourceEncounterCount === 0
    && after.inProgressEncounterCount === 2,
    'CDBV1071A_POST_ENCOUNTER_SCOPE_INVALID');
  add(issues, after.openTargetIssueCount === 0,
    'CDBV1071A_POST_TARGET_ISSUE_COUNT_INVALID');
  add(issues, after.existingTargetEventCount === 1,
    'CDBV1071A_POST_EVENT_COUNT_INVALID');
  add(issues, after.existingTargetMappingCount === 1,
    'CDBV1071A_POST_MAPPING_COUNT_INVALID');
  add(issues, after.otherAuthorizedTenantAnomalyCount === 0,
    'CDBV1071A_CROSS_TENANT_ANOMALY');
  add(issues, after.sourceAdmissionIdentitySha256 === before.sourceAdmissionIdentitySha256,
    'CDBV1071A_SOURCE_ADMISSION_IDENTITY_DRIFT');
  add(issues, after.encounterClinicalIdentitySha256 === before.encounterClinicalIdentitySha256,
    'CDBV1071A_ENCOUNTER_CLINICAL_IDENTITY_DRIFT');
  add(issues, after.trafficFingerprintSha256 === before.trafficFingerprintSha256
    && after.trafficChanged === false,
  'CDBV1071A_TRAFFIC_DRIFT');
  return [...new Set(issues)];
}

export interface CdbV1071aAtomicExecutionMetadata {
  totalChanges: number;
  exactMetadataMatch: true;
  retryAllowed: false;
  changes: number[];
}

export async function executeCdbV1071aAtomicPlan(
  db: CdbV1071WranglerD1Database,
  plan: CdbV1071aAtomicPlan,
): Promise<CdbV1071aAtomicExecutionMetadata> {
  const prepared = plan.statements.map((statement) => (
    db.prepare(statement.sql).bind(...statement.params)
  ));
  const results = await db.batch(prepared);
  if (results.length !== plan.expectedChanges.length) {
    throw new Error('CDB-V1-071A atomic write metadata mismatch');
  }
  const changes = results.map((result) => {
    if (result.success !== true) throw new Error('CDB-V1-071A atomic batch envelope failed');
    const value = Number(result.meta?.changes);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('CDB-V1-071A atomic write metadata invalid');
    }
    return value;
  });
  const exact = changes.every((value, index) => value === plan.expectedChanges[index]);
  if (!exact) throw new Error('CDB-V1-071A atomic write metadata mismatch');
  return {
    totalChanges: changes.reduce((sum, value) => sum + value, 0),
    exactMetadataMatch: true,
    retryAllowed: false,
    changes,
  };
}

export interface PreparedCdbV1071aExecution {
  authorization: CdbV1071aAuthorization | null;
  evidence: CdbV1071aPreconditionEvidence | null;
  authorizationReady: boolean;
  evidenceReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
}

function protectedIssuePrefix(kind: 'AUTHORIZATION' | 'EVIDENCE', code: string): string {
  return `CDBV1071A_${kind}_${code}`;
}

export function prepareProtectedCdbV1071aExecution(
  authorizationPath: string,
  evidencePath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedCdbV1071aExecution {
  const issues: string[] = [];
  const authorizationLoaded = loadProtectedJsonDocument(
    authorizationPath,
    repositoryRoot,
    { maxBytes: 128 * 1024, maxDepth: 20 },
  );
  const evidenceLoaded = loadProtectedJsonDocument(
    evidencePath,
    repositoryRoot,
    { maxBytes: 128 * 1024, maxDepth: 20 },
  );
  if (!authorizationLoaded.ready) {
    issues.push(...authorizationLoaded.issues.map((issue) => (
      protectedIssuePrefix('AUTHORIZATION', issue.code)
    )));
  }
  if (!evidenceLoaded.ready) {
    issues.push(...evidenceLoaded.issues.map((issue) => (
      protectedIssuePrefix('EVIDENCE', issue.code)
    )));
  }

  const authorizationReceipt = authorizationLoaded.ready
    ? validateCdbV1071aAuthorization(authorizationLoaded.value, atUtc)
    : null;
  if (authorizationReceipt && !authorizationReceipt.authorizationReady) {
    issues.push(...authorizationReceipt.issues);
  }

  const evidence = evidenceLoaded.ready
    ? evidenceLoaded.value as CdbV1071aPreconditionEvidence
    : null;
  if (evidence) issues.push(...validateCdbV1071aPreconditionEvidence(evidence));

  const authorization = authorizationReceipt?.authorizationReady
    ? authorizationLoaded.value as CdbV1071aAuthorization
    : null;
  if (authorization && evidence) {
    if (authorization.evidence.preconditionEvidenceSha256
      !== cdbV1071aEvidenceSha256(evidence)) {
      issues.push('CDBV1071A_EVIDENCE_BINDING_INVALID');
    }
    const at = normalizedUtc(atUtc);
    const captured = normalizedUtc(evidence.capturedAtUtc);
    if (at === null || captured === null || at < captured || at - captured > 5 * 60 * 1000) {
      issues.push('CDBV1071A_EVIDENCE_STALE');
    }
  }

  const unique = [...new Set(issues)];
  const authorizationReady = Boolean(authorization) && !unique.some((issue) => (
    issue.includes('AUTHORIZATION') || issue === 'CDBV1071A_AUTHORIZATION_EXPIRED'
  ));
  const evidenceReady = Boolean(evidence)
    && !unique.some((issue) => issue.includes('EVIDENCE')
      || issue.includes('ORPHAN')
      || issue.includes('ENCOUNTER')
      || issue.includes('ISSUE_COUNT')
      || issue.includes('CROSS_TENANT')
      || issue.includes('EXISTING_')
      || issue === 'CDBV1071A_TRAFFIC_DRIFT');
  const executionReady = authorizationReady && evidenceReady && unique.length === 0;
  return {
    authorization: executionReady ? authorization : null,
    evidence: executionReady ? evidence : null,
    authorizationReady,
    evidenceReady,
    executionReady,
    issueCount: unique.length,
    issues: unique,
  };
}

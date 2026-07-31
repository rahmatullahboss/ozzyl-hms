import { describe, expect, test } from 'vitest';
import {
  CDB_V1_071B_ACTOR,
  CDB_V1_071B_APPROVAL_SOURCE,
  CDB_V1_071B_MIGRATION_FILENAME,
  buildCdbV1071bAuthorizationProof,
  buildCdbV1071bFinalizationPlan,
  buildCdbV1071bPreparationPlan,
  collectCdbV1071bPreconditionEvidence,
  cdbV1071bEvidenceSha256,
  validateCdbV1071bAuthorization,
  validateCdbV1071bCompletionEvidence,
  validateCdbV1071bPreconditionEvidence,
  validateCdbV1071bReplayEvidence,
  type CdbV1071bAuthorization,
  type CdbV1071bCompletionEvidence,
  type CdbV1071bPreconditionEvidence,
  type CdbV1071bReplayEvidence,
} from '../../scripts/canonical/cdb-v1-071b-admission-replay-reconciliation';

const NOW = '2026-07-31T11:00:00.000Z';
const CANDIDATE = 'a'.repeat(40);
const WORKER = '4f5d8f93-92d4-4fda-8fba-c0a2863f1b71';
const DATABASE_UUID = 'c68a5360-a2c1-44cc-9e71-f21057bea102';
const SOURCE_ADMISSION_SHA = '1'.repeat(64);
const SOURCE_BED_STAY_SHA = '2'.repeat(64);
const ENCOUNTER_SHA = '3'.repeat(64);
const TRAFFIC_SHA = '4'.repeat(64);

function precondition(
  overrides: Partial<CdbV1071bPreconditionEvidence> = {},
): CdbV1071bPreconditionEvidence {
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-071B-PRECONDITION-EVIDENCE',
    capturedAtUtc: NOW,
    database: {
      name: 'hms-super-admin-production-apac',
      uuid: DATABASE_UUID,
    },
    tenantId: '100',
    candidateCommit: CANDIDATE,
    activeWorkerVersionId: WORKER,
    migrationFilename: CDB_V1_071B_MIGRATION_FILENAME,
    openAdmissionEncounterMappingMissingCount: 4,
    openAdmissionEncounterTypeMismatchCount: 34,
    openBedStayAdmissionMappingMissingCount: 16,
    openBedStatusCacheVarianceCount: 4,
    ambiguousAdmissionMappingCount: 38,
    exactEmergencyAdmissionCandidateCount: 34,
    exactMissingPlannedEncounterCandidateCount: 4,
    exactDependentBedStayCount: 16,
    otherAuthorizedTenantAnomalyCount: 0,
    sourceAdmissionIdentitySha256: SOURCE_ADMISSION_SHA,
    sourceBedStayIdentitySha256: SOURCE_BED_STAY_SHA,
    encounterClinicalIdentitySha256: ENCOUNTER_SHA,
    trafficFingerprintSha256: TRAFFIC_SHA,
    aggregateOnlyNonPhi: true,
    productionMutationPerformed: false,
    trafficChanged: false,
    ...overrides,
  };
}

function authorization(evidence: CdbV1071bPreconditionEvidence): CdbV1071bAuthorization {
  const authorizationId = 'cdb-v1-071b-test-authorization';
  const evidenceSha256 = cdbV1071bEvidenceSha256(evidence);
  return {
    schemaVersion: 1,
    authorizationId,
    operation: 'cdb_v1_071b_admission_replay_reconciliation',
    target: {
      databaseName: evidence.database.name,
      databaseUuid: evidence.database.uuid,
      tenantId: evidence.tenantId,
      candidateCommit: evidence.candidateCommit,
      activeWorkerVersionId: evidence.activeWorkerVersionId,
      migrationFilename: CDB_V1_071B_MIGRATION_FILENAME,
    },
    timing: {
      issuedAtUtc: '2026-07-31T10:55:00.000Z',
      windowStartUtc: '2026-07-31T10:55:00.000Z',
      windowEndUtc: '2026-07-31T13:00:00.000Z',
      expiresAtUtc: '2026-07-31T13:00:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: CDB_V1_071B_APPROVAL_SOURCE,
      ownerModel: 'single_operator_risk_accepted',
      automaticAbortOnOperatorUnavailable: true,
    },
    scope: {
      expected: {
        admissionEncounterMappingMissing: 4,
        admissionEncounterTypeMismatch: 34,
        bedStayAdmissionMappingMissing: 16,
        bedStatusCacheVariance: 4,
        ambiguousAdmissionMappings: 38,
        emergencyAdmissionCandidates: 34,
        missingPlannedEncounterCandidates: 4,
        dependentBedStays: 16,
        otherAuthorizedTenantAnomalies: 0,
      },
      preparationWrites: {
        admissionMappingSupersessions: 38,
      },
      finalizationWrites: {
        dependencyIssueResolutions: 54,
        cacheVarianceWaivers: 4,
      },
      post: {
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
      },
    },
    permissions: {
      aggregateProductionRead: true,
      boundedInternalReferenceRead: true,
      provenanceSupersessionWrite: true,
      canonicalReplayWrite: true,
      issueDispositionWrite: true,
      sourceLegacyWrite: false,
      encounterClinicalRewrite: false,
      workerUploadDuringReconciliation: false,
      trafficChangeDuringReconciliation: false,
      providerFlagChange: false,
      canonicalAuthorityPromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      routeChange: false,
      destructiveLegacyAction: false,
      databaseDeletion: false,
    },
    evidence: {
      preconditionEvidenceSha256: evidenceSha256,
    },
    confirmation: {
      preparationProof: buildCdbV1071bAuthorizationProof(
        authorizationId,
        'preparation',
        evidenceSha256,
        evidence.candidateCommit,
        evidence.database.uuid,
        evidence.activeWorkerVersionId,
      ),
      finalizationProof: buildCdbV1071bAuthorizationProof(
        authorizationId,
        'finalization',
        evidenceSha256,
        evidence.candidateCommit,
        evidence.database.uuid,
        evidence.activeWorkerVersionId,
      ),
    },
  };
}

function replay(
  overrides: Partial<CdbV1071bReplayEvidence> = {},
): CdbV1071bReplayEvidence {
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-071B-REPLAY-EVIDENCE',
    capturedAtUtc: '2026-07-31T11:20:00.000Z',
    database: { name: 'hms-super-admin-production-apac', uuid: DATABASE_UUID },
    tenantId: '100',
    candidateCommit: CANDIDATE,
    activeWorkerVersionId: WORKER,
    migrationFilename: CDB_V1_071B_MIGRATION_FILENAME,
    supersededAdmissionMappingCount: 38,
    mappedAdmissionCount: 38,
    canonicalAdmissionCount: 38,
    mappedBedStayCount: 16,
    canonicalBedStayCount: 16,
    openAdmissionEncounterMappingMissingCount: 4,
    openAdmissionEncounterTypeMismatchCount: 34,
    openBedStayAdmissionMappingMissingCount: 16,
    openBedStatusCacheVarianceCount: 4,
    newReplayIssueCount: 0,
    sourceLegacyRowsWritten: 0,
    unexpectedTenantWriteCount: 0,
    secondPassZeroNew: true,
    sourceAdmissionIdentitySha256: SOURCE_ADMISSION_SHA,
    sourceBedStayIdentitySha256: SOURCE_BED_STAY_SHA,
    encounterClinicalIdentitySha256: ENCOUNTER_SHA,
    trafficFingerprintSha256: TRAFFIC_SHA,
    trafficChanged: false,
    ...overrides,
  };
}

function completion(
  overrides: Partial<CdbV1071bCompletionEvidence> = {},
): CdbV1071bCompletionEvidence {
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-071B-COMPLETION-EVIDENCE',
    capturedAtUtc: '2026-07-31T11:25:00.000Z',
    database: { name: 'hms-super-admin-production-apac', uuid: DATABASE_UUID },
    tenantId: '100',
    candidateCommit: CANDIDATE,
    activeWorkerVersionId: WORKER,
    migrationFilename: CDB_V1_071B_MIGRATION_FILENAME,
    mappedAdmissionCount: 38,
    canonicalAdmissionCount: 38,
    mappedBedStayCount: 16,
    canonicalBedStayCount: 16,
    resolvedDependencyIssueCount: 54,
    waivedCacheVarianceIssueCount: 4,
    remainingOpenTargetIssueCount: 0,
    sourceLegacyRowsWritten: 0,
    unexpectedTenantWriteCount: 0,
    secondPassZeroNew: true,
    sourceAdmissionIdentitySha256: SOURCE_ADMISSION_SHA,
    sourceBedStayIdentitySha256: SOURCE_BED_STAY_SHA,
    encounterClinicalIdentitySha256: ENCOUNTER_SHA,
    trafficFingerprintSha256: TRAFFIC_SHA,
    trafficChanged: false,
    ...overrides,
  };
}

function collectorDatabase() {
  const seenSql: string[] = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    'issue-counts': [
      { issue_code: 'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING', row_count: 4 },
      { issue_code: 'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT', row_count: 34 },
      { issue_code: 'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING', row_count: 16 },
      { issue_code: 'CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE', row_count: 4 },
    ],
    'ambiguous-mappings': [{ row_count: 38 }],
    'emergency-candidates': [{ row_count: 34 }],
    'planned-candidates': [{ row_count: 4 }],
    'dependent-bed-stays': [{ row_count: 16 }],
    'cross-tenant': [{ row_count: 0 }],
    'admission-identities': [
      { id: 1, patient_id: 101, admission_type: 'planned', status: 'admitted' },
      { id: 2, patient_id: 102, admission_type: 'emergency', status: 'discharged' },
    ],
    'bed-stay-identities': [
      { id: 11, patient_id: 101, admission_id: 1, bed_id: 10 },
    ],
    'encounter-identities': [
      {
        encounter_public_id: 'encounter-1',
        legacy_patient_id: 102,
        patient_link_public_id: 'ptl-102',
        encounter_type: 'emergency',
        status: 'completed',
      },
    ],
  };
  return {
    seenSql,
    db: {
      prepare(sql: string) {
        seenSql.push(sql);
        const marker = Object.keys(rows).find((key) => sql.includes(`cdb-v1-071b:${key}`));
        if (!marker) throw new Error(`unexpected collector SQL: ${sql}`);
        return {
          bind() { return this; },
          async first<T>() {
            return (rows[marker][0] ?? null) as T | null;
          },
          async all<T>() {
            return { results: rows[marker] as T[] };
          },
        };
      },
    },
  };
}

describe('CDB-V1-071B admission replay reconciliation', () => {
  test('collects deterministic bounded non-PHI precondition evidence', async () => {
    const harness = collectorDatabase();
    const evidence = await collectCdbV1071bPreconditionEvidence(harness.db, {
      capturedAtUtc: NOW,
      candidateCommit: CANDIDATE,
      activeWorkerVersionId: WORKER,
      trafficFingerprintSha256: TRAFFIC_SHA,
    });
    expect(evidence).toEqual(expect.objectContaining({
      openAdmissionEncounterMappingMissingCount: 4,
      openAdmissionEncounterTypeMismatchCount: 34,
      openBedStayAdmissionMappingMissingCount: 16,
      openBedStatusCacheVarianceCount: 4,
      ambiguousAdmissionMappingCount: 38,
      exactEmergencyAdmissionCandidateCount: 34,
      exactMissingPlannedEncounterCandidateCount: 4,
      exactDependentBedStayCount: 16,
      otherAuthorizedTenantAnomalyCount: 0,
      aggregateOnlyNonPhi: true,
      productionMutationPerformed: false,
      trafficChanged: false,
    }));
    expect(validateCdbV1071bPreconditionEvidence(evidence)).toEqual([]);
    expect(evidence.sourceAdmissionIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.sourceBedStayIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.encounterClinicalIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    const sql = harness.seenSql.join('\n').toLowerCase();
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/);
    for (const phi of ['patient_name', 'phone', 'email', 'address', 'clinical_notes', 'diagnosis']) {
      expect(sql).not.toContain(phi);
    }
    for (const optionalLegacyColumn of [
      'admission_source', 'admission_date', 'discharge_date', 'started_on', 'ended_on',
    ]) {
      expect(sql).not.toContain(optionalLegacyColumn);
    }
  });

  test('accepts only exact preconditions and authorization binding', () => {
    const evidence = precondition();
    expect(validateCdbV1071bPreconditionEvidence(evidence)).toEqual([]);
    expect(validateCdbV1071bPreconditionEvidence(precondition({
      openAdmissionEncounterTypeMismatchCount: 33,
    }))).toContain('CDBV1071B_ADMISSION_TYPE_MISMATCH_COUNT_INVALID');

    expect(validateCdbV1071bAuthorization(authorization(evidence), evidence, NOW))
      .toEqual(expect.objectContaining({
        authorizationReady: true,
        executionReady: true,
        issueCount: 0,
      }));
    const drifted = authorization(evidence);
    drifted.target.candidateCommit = 'b'.repeat(40);
    expect(validateCdbV1071bAuthorization(drifted, evidence, NOW).executionReady).toBe(false);
  });

  test('builds a guarded non-destructive preparation plan for exact 38 mappings', () => {
    const plan = buildCdbV1071bPreparationPlan(precondition(), NOW);
    expect(plan.expectedChanges).toEqual([0, 38]);
    expect(plan.statements).toHaveLength(2);
    expect(plan.statements[0].sql).toContain('abs(-9223372036854775808)');
    expect(plan.statements[1].sql).toContain("source_type='legacy_admission_replay_superseded'");
    expect(plan.statements[1].sql).toContain("mapping_status='rejected'");
    const sql = plan.statements.map((statement) => statement.sql).join('\n').toLowerCase();
    expect(sql).not.toContain('delete from');
    for (const table of ['admissions', 'patients', 'patient_bed_infos', 'visits', 'bills']) {
      expect(sql).not.toMatch(new RegExp(`(?:update|delete\\s+from|insert\\s+into)\\s+${table}\\b`));
    }
  });

  test('accepts only exact replay convergence with immutable sources and traffic', () => {
    const before = precondition();
    expect(validateCdbV1071bReplayEvidence(before, replay())).toEqual([]);
    expect(validateCdbV1071bReplayEvidence(before, replay({
      sourceBedStayIdentitySha256: '9'.repeat(64),
    }))).toContain('CDBV1071B_SOURCE_BED_STAY_IDENTITY_DRIFT');
    expect(validateCdbV1071bReplayEvidence(before, replay({
      secondPassZeroNew: false,
    }))).toContain('CDBV1071B_SECOND_PASS_NOT_ZERO');
  });

  test('builds guarded finalization for 54 resolutions and 4 formal waivers', () => {
    const before = precondition();
    const afterReplay = replay();
    const plan = buildCdbV1071bFinalizationPlan(before, afterReplay, NOW);
    expect(plan.expectedChanges).toEqual([0, 54, 4]);
    expect(plan.statements).toHaveLength(3);
    expect(plan.statements[1].sql).toContain("status='resolved'");
    expect(plan.statements[1].sql).toContain('cdb_v1_071b_admission_replay_converged');
    expect(plan.statements[2].sql).toContain("status='waived'");
    expect(plan.statements[2].sql).toContain('interval_evidence_authoritative');
    expect(plan.statements[0].sql).toContain('i.source_public_id=m.source_public_id');
    expect(plan.statements[0].sql).not.toContain('>=16');
    expect(plan.statements.slice(1).every((statement) => (
      statement.params.includes(CDB_V1_071B_ACTOR)
    ))).toBe(true);
  });

  test('requires exact completion evidence after issue disposition', () => {
    const before = precondition();
    expect(validateCdbV1071bCompletionEvidence(before, completion())).toEqual([]);
    expect(validateCdbV1071bCompletionEvidence(before, completion({
      remainingOpenTargetIssueCount: 1,
    }))).toContain('CDBV1071B_REMAINING_OPEN_TARGET_ISSUES');
    expect(validateCdbV1071bCompletionEvidence(before, completion({
      trafficFingerprintSha256: '8'.repeat(64),
    }))).toContain('CDBV1071B_TRAFFIC_DRIFT');
  });
});

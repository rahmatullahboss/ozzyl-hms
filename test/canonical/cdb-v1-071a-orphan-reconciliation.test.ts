import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CDB_V1_071A_APPROVAL_SOURCE,
  CDB_V1_071A_CANDIDATE_SHA,
  CDB_V1_071A_DATABASE_NAME,
  CDB_V1_071A_DATABASE_UUID,
  CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
  buildCdbV1071aAuthorizationProof,
  buildCdbV1071aAtomicPlan,
  collectCdbV1071aPreconditionEvidence,
  executeCdbV1071aAtomicPlan,
  prepareProtectedCdbV1071aExecution,
  cdbV1071aEvidenceSha256,
  validateCdbV1071aAuthorization,
  validateCdbV1071aPostEvidence,
  validateCdbV1071aPreconditionEvidence,
  type CdbV1071aAuthorization,
  type CdbV1071aPreconditionEvidence,
} from '../../scripts/canonical/cdb-v1-071a-orphan-reconciliation';

const NOW = '2026-07-31T08:45:00.000Z';
const AUTHORIZATION_ID = 'cdb-v1-071a-20260731-001';

function evidence(
  overrides: Partial<CdbV1071aPreconditionEvidence> = {},
): CdbV1071aPreconditionEvidence {
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-071A-ORPHAN-PRECONDITION-EVIDENCE',
    capturedAtUtc: NOW,
    database: {
      name: CDB_V1_071A_DATABASE_NAME,
      uuid: CDB_V1_071A_DATABASE_UUID,
    },
    tenantId: '100',
    candidateCommit: CDB_V1_071A_CANDIDATE_SHA,
    activeWorkerVersionId: CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
    orphanLegacyPatientId: 987654,
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
    existingTargetEventCount: 0,
    existingTargetMappingCount: 0,
    sourceAdmissionIdentitySha256: 'a'.repeat(64),
    encounterClinicalIdentitySha256: 'b'.repeat(64),
    trafficFingerprintSha256: 'c'.repeat(64),
    aggregateOnlyNonPhi: true,
    productionMutationPerformed: false,
    trafficChanged: false,
    ...overrides,
  };
}

function authorization(
  precondition: CdbV1071aPreconditionEvidence,
  overrides: Partial<CdbV1071aAuthorization> = {},
): CdbV1071aAuthorization {
  const preconditionSha256 = cdbV1071aEvidenceSha256(precondition);
  return {
    schemaVersion: 1,
    authorizationId: AUTHORIZATION_ID,
    operation: 'cdb_v1_071a_orphan_admission_patient_reference_reconciliation',
    target: {
      databaseName: CDB_V1_071A_DATABASE_NAME,
      databaseUuid: CDB_V1_071A_DATABASE_UUID,
      tenantId: '100',
      candidateCommit: CDB_V1_071A_CANDIDATE_SHA,
      activeWorkerVersionId: CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
    },
    timing: {
      issuedAtUtc: '2026-07-31T08:40:00.000Z',
      windowStartUtc: '2026-07-31T08:40:00.000Z',
      windowEndUtc: '2026-07-31T10:40:00.000Z',
      expiresAtUtc: '2026-07-31T10:40:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: CDB_V1_071A_APPROVAL_SOURCE,
      ownerModel: 'single_operator_risk_accepted',
      automaticAbortOnOperatorUnavailable: true,
    },
    scope: {
      expected: {
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
      },
      writes: {
        patientLinks: 1,
        patientLinkEvents: 1,
        sourceMappings: 1,
        encounters: 2,
        processingIssues: 2,
      },
      post: {
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
      },
    },
    permissions: {
      aggregateProductionRead: true,
      boundedInternalReferenceRead: true,
      atomicReconciliationWrite: true,
      resumeAuthorizedBackfill: true,
      continueAuthorizedStagedRolloutAfterGates: true,
      sourcePatientWrite: false,
      sourceAdmissionWrite: false,
      unrelatedLegacyWrite: false,
      phiReconstruction: false,
      workerUploadDuringReconciliation: false,
      trafficChangeDuringReconciliation: false,
      providerFlagChange: false,
      canonicalAuthorityPromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      routeChange: false,
      destructiveAction: false,
      databaseDeletion: false,
    },
    evidence: {
      approvalEvidenceSha256: 'd'.repeat(64),
      preconditionEvidenceSha256: preconditionSha256,
    },
    confirmation: {
      reconciliationProof: buildCdbV1071aAuthorizationProof(
        AUTHORIZATION_ID,
        preconditionSha256,
      ),
    },
    ...overrides,
  };
}

function fakeCollectorDatabase() {
  return {
    prepare(sql: string) {
      if (sql.includes('a.encounter_id')) {
        throw new Error('collector must not depend on optional admissions.encounter_id');
      }
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async all() {
          if (sql.includes('FROM admissions a') && sql.includes('LEFT JOIN patients p')
            && sql.includes('ORDER BY a.id')) {
            return { results: [
              { admission_id: 11, legacy_patient_id: 987654, encounter_id: null },
              { admission_id: 12, legacy_patient_id: 987654, encounter_id: null },
            ] };
          }
          if (sql.includes('FROM canonical_encounters e') && sql.includes('legacy_admission')) {
            return { results: [
              {
                encounter_id: 21,
                encounter_public_id: 'enc_emergency',
                legacy_patient_id: 987654,
                patient_link_public_id: null,
                encounter_type: 'emergency',
                status: 'in_progress',
                source_kind: 'migration',
                encounter_version: 1,
                started_at_utc: '2026-07-01T00:00:00.000Z',
                ended_at_utc: null,
                signed_snapshot_sha256: null,
                signed_at_utc: null,
                source_evidence_sha256: 'e'.repeat(64),
                created_at_utc: '2026-07-01T00:00:00.000Z',
              },
              {
                encounter_id: 22,
                encounter_public_id: 'enc_inpatient',
                legacy_patient_id: 987654,
                patient_link_public_id: null,
                encounter_type: 'inpatient',
                status: 'in_progress',
                source_kind: 'migration',
                encounter_version: 1,
                started_at_utc: '2026-07-02T00:00:00.000Z',
                ended_at_utc: null,
                signed_snapshot_sha256: null,
                signed_at_utc: null,
                source_evidence_sha256: 'f'.repeat(64),
                created_at_utc: '2026-07-02T00:00:00.000Z',
              },
            ] };
          }
          throw new Error(`unexpected all query: ${sql}`);
        },
        async first() {
          if (sql.includes('existing_active_patient_link_count')) {
            return {
              existing_active_patient_link_count: 0,
              open_target_issue_count: 2,
              other_authorized_tenant_anomaly_count: 0,
              existing_target_event_count: 0,
              existing_target_mapping_count: 0,
            };
          }
          throw new Error(`unexpected first query: ${sql}`);
        },
        async run() {
          return { success: true, meta: { changes: 0, rows_written: 0 } };
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  } as never;
}

describe('CDB-V1-071A orphan admission patient-reference reconciliation', () => {
  test('accepts only the exact protected authorization and evidence binding', () => {
    const precondition = evidence();
    expect(validateCdbV1071aAuthorization(authorization(precondition), NOW)).toEqual(
      expect.objectContaining({
        checkpoint: 'CDB-V1-071A-AUTHORIZATION',
        authorizationReady: true,
        executionReady: true,
        issueCount: 0,
      }),
    );

    const drifted = authorization(precondition, {
      target: {
        databaseName: CDB_V1_071A_DATABASE_NAME,
        databaseUuid: CDB_V1_071A_DATABASE_UUID,
        tenantId: '101',
        candidateCommit: CDB_V1_071A_CANDIDATE_SHA,
        activeWorkerVersionId: CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
      },
    });
    expect(validateCdbV1071aAuthorization(drifted, NOW)).toEqual(
      expect.objectContaining({
        authorizationReady: false,
        executionReady: false,
        issues: expect.arrayContaining(['CDBV1071A_AUTHORIZATION_TARGET_INVALID']),
      }),
    );
  });

  test('fails closed on any production precondition drift', () => {
    expect(validateCdbV1071aPreconditionEvidence(evidence())).toEqual([]);
    expect(validateCdbV1071aPreconditionEvidence(evidence({ orphanAdmissionCount: 3 })))
      .toContain('CDBV1071A_ORPHAN_ADMISSION_COUNT_INVALID');
    expect(validateCdbV1071aPreconditionEvidence(evidence({ openTargetIssueCount: 1 })))
      .toContain('CDBV1071A_TARGET_ISSUE_COUNT_INVALID');
    expect(validateCdbV1071aPreconditionEvidence(evidence({ otherAuthorizedTenantAnomalyCount: 1 })))
      .toContain('CDBV1071A_CROSS_TENANT_ANOMALY');
    expect(validateCdbV1071aPreconditionEvidence(evidence({ trafficChanged: true })))
      .toContain('CDBV1071A_TRAFFIC_DRIFT');
  });

  test('builds one deterministic guarded atomic plan with only the authorized writes', async () => {
    const precondition = evidence();
    const plan = await buildCdbV1071aAtomicPlan(precondition, NOW);

    expect(plan.patientLinkPublicId).toMatch(/^ptlink_[0-9A-Z]{26}$/);
    expect(plan.eventPublicId).toMatch(/^ptlevt_[0-9A-Z]{26}$/);
    expect(plan.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.statements).toHaveLength(7);
    expect(plan.expectedChanges).toEqual([0, 1, 1, 1, 2, 2, 0]);

    const rendered = plan.statements.map((statement) => statement.sql).join('\n');
    expect(rendered).toContain('INSERT INTO canonical_tenant_patient_links');
    expect(rendered).toContain('INSERT INTO canonical_tenant_patient_link_events');
    expect(rendered).toContain('INSERT INTO canonical_source_mappings');
    expect(rendered).toContain('UPDATE canonical_encounters');
    expect(rendered).toContain('UPDATE canonical_processing_issues');
    expect(rendered).toContain('legacy_admission_patient_reference');
    expect(rendered).toContain('orphan_admission_reference_placeholder_linked');
    expect(rendered).toContain('abs(-9223372036854775808)');
    expect(rendered).not.toMatch(/UPDATE\s+(patients|admissions|visits|bills)\b/i);
    expect(rendered).not.toMatch(/DELETE\s+FROM\b/i);
    expect(rendered).not.toMatch(/DROP\s+(TABLE|INDEX)\b/i);

    expect(plan.statements[1].params).toEqual(expect.arrayContaining([
      '100',
      987654,
      'unlinked',
      'unverified',
      'no_link_placeholder',
      NOW,
    ]));
  });

  test('collects bounded non-PHI precondition evidence and hashes internal identities', async () => {
    const collected = await collectCdbV1071aPreconditionEvidence(fakeCollectorDatabase(), {
      capturedAtUtc: NOW,
      activeWorkerVersionId: CDB_V1_071A_PREVIOUS_WORKER_VERSION_ID,
      trafficFingerprintSha256: 'c'.repeat(64),
    });
    expect(collected).toEqual(expect.objectContaining({
      orphanLegacyPatientId: 987654,
      orphanAdmissionCount: 2,
      distinctOrphanLegacyPatientCount: 1,
      missingSourcePatientReferenceCount: 1,
      mappedEncounterCount: 2,
      emergencyEncounterCount: 1,
      inpatientEncounterCount: 1,
      openTargetIssueCount: 2,
      aggregateOnlyNonPhi: true,
      productionMutationPerformed: false,
      trafficChanged: false,
    }));
    expect(collected.sourceAdmissionIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(collected.encounterClinicalIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('executes one atomic batch and rejects any write-count mismatch', async () => {
    const plan = await buildCdbV1071aAtomicPlan(evidence(), NOW);
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) {
            statement.params = params;
            return statement;
          },
          async run() { throw new Error('run must not be used'); },
          async first() { return null; },
          async all() { return { results: [] }; },
        };
        prepared.push(statement);
        return statement;
      },
      async batch(statements: unknown[]) {
        expect(statements).toHaveLength(7);
        return plan.expectedChanges.map((changes) => ({
          success: true,
          meta: { changes, rows_written: changes },
        }));
      },
    } as never;
    await expect(executeCdbV1071aAtomicPlan(db, plan)).resolves.toEqual(
      expect.objectContaining({
        totalChanges: 7,
        exactMetadataMatch: true,
        retryAllowed: false,
      }),
    );
    expect(prepared).toHaveLength(7);

    const badDb = {
      ...db,
      async batch() {
        return [0, 1, 1, 1, 1, 2, 0].map((changes) => ({
          success: true,
          meta: { changes, rows_written: changes },
        }));
      },
    } as never;
    await expect(executeCdbV1071aAtomicPlan(badDb, plan))
      .rejects.toThrow('atomic write metadata mismatch');
  });

  test('accepts exact post-state and rejects source or traffic drift without retry', () => {
    const before = evidence();
    const after = evidence({
      existingActivePatientLinkCount: 1,
      migrationSourceEncounterCount: 0,
      openTargetIssueCount: 0,
      existingTargetEventCount: 1,
      existingTargetMappingCount: 1,
    });
    expect(validateCdbV1071aPostEvidence(before, after)).toEqual([]);
    expect(validateCdbV1071aPostEvidence(before, {
      ...after,
      sourceAdmissionIdentitySha256: '9'.repeat(64),
    })).toContain('CDBV1071A_SOURCE_ADMISSION_IDENTITY_DRIFT');
    expect(validateCdbV1071aPostEvidence(before, {
      ...after,
      trafficFingerprintSha256: '8'.repeat(64),
    })).toContain('CDBV1071A_TRAFFIC_DRIFT');
  });

  test('requires protected exact fresh authorization and evidence files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cdb-v1-071a-'));
    chmodSync(directory, 0o700);
    const precondition = evidence();
    const document = authorization(precondition);
    const evidencePath = join(directory, 'evidence.json');
    const authorizationPath = join(directory, 'authorization.json');
    writeFileSync(evidencePath, `${JSON.stringify(precondition)}\n`, { mode: 0o600 });
    writeFileSync(authorizationPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    chmodSync(evidencePath, 0o600);
    chmodSync(authorizationPath, 0o600);

    expect(prepareProtectedCdbV1071aExecution(
      authorizationPath,
      evidencePath,
      process.cwd(),
      NOW,
    )).toEqual(expect.objectContaining({
      executionReady: true,
      issueCount: 0,
      authorization: document,
      evidence: precondition,
    }));

    expect(prepareProtectedCdbV1071aExecution(
      authorizationPath,
      evidencePath,
      process.cwd(),
      '2026-07-31T08:51:00.000Z',
    )).toEqual(expect.objectContaining({
      executionReady: false,
      issues: expect.arrayContaining(['CDBV1071A_EVIDENCE_STALE']),
    }));
  });

  test('binds authorization to the exact fresh evidence SHA', () => {
    const precondition = evidence();
    const document = authorization(precondition);
    const changedEvidence = evidence({ capturedAtUtc: '2026-07-31T08:46:00.000Z' });
    expect(document.evidence.preconditionEvidenceSha256)
      .not.toBe(cdbV1071aEvidenceSha256(changedEvidence));
  });
});

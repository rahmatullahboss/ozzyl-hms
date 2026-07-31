import { describe, expect, it } from 'vitest';
import { backfillEncounterAdmissionBedConvergence } from '../../scripts/canonical/backfill-encounter-admission-bed-convergence';
import { reconcileEncounterAdmissionBedConvergence } from '../../scripts/canonical/reconcile-encounter-admission-bed-convergence';
import {
  createConvergenceHarness,
  seedCleanConvergenceSource,
} from './fixtures/encounter-admission-bed-convergence-fixture';

const expectedChecks = [
  'encounter_source_mapping_cardinality',
  'encounter_patient_link_validity',
  'encounter_status_version_validity',
  'planned_actual_care_classification',
  'encounter_participant_practitioner_tenant_validity',
  'admission_source_mapping_cardinality',
  'active_admission_per_inpatient_encounter',
  'admission_header_latest_event_parity',
  'admission_event_sequence_transition_validity',
  'encounter_admission_patient_agreement',
  'admission_interval_terminal_time_validity',
  'care_location_mapping_hierarchy_validity',
  'bed_resource_mapping_tenant_location_validity',
  'open_stay_cardinality_per_bed',
  'open_stay_cardinality_per_active_admission',
  'interval_overlap_per_bed',
  'interval_overlap_per_admission',
  'stay_admission_encounter_patient_consistency',
  'inactive_bed_active_occupancy',
  'legacy_bed_status_derived_occupancy',
  'unresolved_convergence_issues',
  'cross_tenant_references',
  'second_pass_zero_new_row_evidence',
] as const;

async function seedConverged() {
  const harness = createConvergenceHarness();
  seedCleanConvergenceSource(harness.sqlite);
  const first = await backfillEncounterAdmissionBedConvergence(harness.db, {
    tenantId: 'tenant-a',
    runPublicId: 'cdb-113e-reconcile-first',
    timezone: 'Asia/Dhaka',
    nowUtc: '2026-07-27T10:00:00.000Z',
  });
  expect(first.completed).toBe(true);
  const second = await backfillEncounterAdmissionBedConvergence(harness.db, {
    tenantId: 'tenant-a',
    runPublicId: 'cdb-113e-reconcile-second-pass',
    timezone: 'Asia/Dhaka',
    nowUtc: '2026-07-27T10:05:00.000Z',
  });
  expect(second.completed).toBe(true);
  expect(second.secondPassZeroNew).toBe(true);
  return harness;
}

describe('encounter, admission, and bed convergence reconciliation', () => {
  it('persists one passing receipt with the exact 23 fail-closed checks', async () => {
    const { sqlite, db } = await seedConverged();
    try {
      const result = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-pass',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:10:00.000Z',
      });
      expect(result.status).toBe('passed');
      expect(result.scannedChecks).toBe(23);
      expect(result.mismatchChecks).toBe(0);
      expect(result.checks.map((check) => check.name)).toEqual(expectedChecks);
      expect(result.checks.every((check) => check.mismatchCount === 0)).toBe(true);

      const receipt = sqlite.prepare(`
        SELECT status,scanned_count,matched_count,mismatch_count,evidence_sha256,result_summary_json
        FROM canonical_reconciliation_runs
        WHERE tenant_id='tenant-a' AND run_public_id='cdb-113e-reconcile-pass'
      `).get() as {
        status: string;
        scanned_count: number;
        matched_count: number;
        mismatch_count: number;
        evidence_sha256: string;
        result_summary_json: string;
      };
      expect(receipt).toMatchObject({
        status: 'passed',
        scanned_count: 23,
        matched_count: 23,
        mismatch_count: 0,
      });
      expect(receipt.evidence_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(receipt.result_summary_json).checks).toHaveLength(23);
      for (const forbidden of ['Patient', 'Sensitive', 'ADM-21', 'A-01']) {
        expect(receipt.result_summary_json).not.toContain(forbidden);
        expect(result.evidenceSha256).not.toContain(forbidden);
      }
    } finally {
      sqlite.close();
    }
  });

  it('accepts an exact unlinked-encounter disposition and fails when its required issue is removed', async () => {
    const { sqlite, db } = await seedConverged();
    try {
      const encounter = { encounter_public_id: 'enc-unlinked-disposition' };
      sqlite.prepare(`
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
          encounter_type,status,encounter_version,source_kind,started_at_utc,
          source_evidence_sha256
        ) VALUES (
          'tenant-a',?,999,NULL,'outpatient','in_progress',1,'migration',
          '2026-07-27T10:10:00.000Z',?
        )
      `).run(encounter.encounter_public_id, '9'.repeat(64));
      sqlite.prepare(`
        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,
          source_type,source_public_id,fingerprint,severity,status,occurrence_count,
          summary,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
        ) VALUES (
          'tenant-a','issue-cdb113e-unlinked-encounter',
          'encounter_admission_bed_backfill','CDB113E_PATIENT_LINK_MISSING',
          'encounter','canonical_encounter',?,
          'fp-cdb113e-unlinked-encounter','error','open',1,
          'Exact unlinked encounter disposition',
          '2026-07-27T10:11:00.000Z','2026-07-27T10:11:00.000Z',
          '2026-07-27T10:11:00.000Z','2026-07-27T10:11:00.000Z'
        )
      `).run(encounter.encounter_public_id);

      const accepted = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-unlinked-encounter',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:12:00.000Z',
      });
      expect(accepted.status).toBe('passed');
      expect(Object.fromEntries(accepted.checks.map((check) => [check.name, check.mismatchCount]))).toMatchObject({
        encounter_patient_link_validity: 0,
        unresolved_convergence_issues: 0,
      });

      sqlite.prepare(`DELETE FROM canonical_processing_issues WHERE issue_public_id=?`)
        .run('issue-cdb113e-unlinked-encounter');
      const missingIssue = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-unlinked-encounter-missing-issue',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:13:00.000Z',
      });
      expect(missingIssue.status).toBe('failed');
      expect(Object.fromEntries(missingIssue.checks.map((check) => [check.name, check.mismatchCount])))
        .toMatchObject({ encounter_patient_link_validity: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('accepts an exact invalid historical-stay disposition and fails when its issue is removed', async () => {
    const { sqlite, db } = await seedConverged();
    try {
      const source = sqlite.prepare(`
        SELECT s.legacy_patient_bed_info_id,s.legacy_admission_id,s.bed_stay_public_id
        FROM canonical_bed_stays s
        WHERE s.tenant_id='tenant-a'
        ORDER BY s.legacy_patient_bed_info_id LIMIT 1
      `).get() as {
        legacy_patient_bed_info_id: number;
        legacy_admission_id: number;
        bed_stay_public_id: string;
      };
      sqlite.prepare(`
        UPDATE canonical_bed_stays
        SET admission_public_id=NULL,bed_public_id=NULL,patient_link_public_id=NULL,
            ended_at_utc=started_at_utc,status='invalid',
            close_reason='CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
        WHERE tenant_id='tenant-a' AND legacy_patient_bed_info_id=?
      `).run(source.legacy_patient_bed_info_id);
      sqlite.prepare(`
        UPDATE canonical_source_mappings
        SET canonical_public_id=NULL,mapping_status='ambiguous'
        WHERE tenant_id='tenant-a' AND entity_type='bed_stay'
          AND source_type='legacy_patient_bed_info' AND source_public_id=?
      `).run(String(source.legacy_patient_bed_info_id));
      sqlite.prepare(`
        DELETE FROM canonical_admission_status_events
        WHERE tenant_id='tenant-a' AND admission_public_id=(
          SELECT canonical_public_id FROM canonical_source_mappings
          WHERE tenant_id='tenant-a' AND entity_type='admission'
            AND source_type='legacy_admission' AND source_public_id=?
        )
      `).run(String(source.legacy_admission_id));
      sqlite.prepare(`
        DELETE FROM canonical_admissions
        WHERE tenant_id='tenant-a' AND admission_public_id=(
          SELECT canonical_public_id FROM canonical_source_mappings
          WHERE tenant_id='tenant-a' AND entity_type='admission'
            AND source_type='legacy_admission' AND source_public_id=?
        )
      `).run(String(source.legacy_admission_id));
      sqlite.prepare(`
        UPDATE canonical_source_mappings
        SET canonical_public_id=NULL,mapping_status='ambiguous'
        WHERE tenant_id='tenant-a' AND entity_type='admission'
          AND source_type='legacy_admission' AND source_public_id=?
      `).run(String(source.legacy_admission_id));
      sqlite.prepare(`
        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,
          source_type,source_public_id,fingerprint,severity,status,occurrence_count,
          summary,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
        ) VALUES (
          'tenant-a','issue-cdb113e-invalid-historical-stay',
          'encounter_admission_bed_backfill','CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING',
          'bed_stay','legacy_patient_bed_info',?,
          'fp-cdb113e-invalid-historical-stay','error','open',1,
          'Exact invalid historical stay disposition',
          '2026-07-27T10:14:00.000Z','2026-07-27T10:14:00.000Z',
          '2026-07-27T10:14:00.000Z','2026-07-27T10:14:00.000Z'
        )
      `).run(String(source.legacy_patient_bed_info_id));

      const accepted = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-invalid-historical-stay',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:15:00.000Z',
      });
      expect(accepted.status).toBe('passed');
      expect(Object.fromEntries(accepted.checks.map((check) => [check.name, check.mismatchCount]))).toMatchObject({
        stay_admission_encounter_patient_consistency: 0,
        unresolved_convergence_issues: 0,
      });

      sqlite.prepare(`DELETE FROM canonical_processing_issues WHERE issue_public_id=?`)
        .run('issue-cdb113e-invalid-historical-stay');
      const missingIssue = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-invalid-historical-stay-missing-issue',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:16:00.000Z',
      });
      expect(missingIssue.status).toBe('failed');
      expect(Object.fromEntries(missingIssue.checks.map((check) => [check.name, check.mismatchCount])))
        .toMatchObject({ stay_admission_encounter_patient_consistency: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('accepts exact stale bed-cache evidence and fails when the variance issue is removed', async () => {
    const { sqlite, db } = await seedConverged();
    try {
      const bed = sqlite.prepare(`
        SELECT b.id FROM beds b
        WHERE b.tenant_id='tenant-a'
          AND EXISTS (
            SELECT 1 FROM patient_bed_infos p
            WHERE p.tenant_id=b.tenant_id AND p.bed_id=b.id AND p.ended_at_utc IS NULL
          )
        ORDER BY b.id LIMIT 1
      `).get() as { id: number };
      sqlite.prepare(`UPDATE beds SET status='available' WHERE tenant_id='tenant-a' AND id=?`)
        .run(bed.id);
      sqlite.prepare(`
        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,
          source_type,source_public_id,fingerprint,severity,status,occurrence_count,
          summary,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
        ) VALUES (
          'tenant-a','issue-cdb113e-bed-cache-variance',
          'encounter_admission_bed_backfill','CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE',
          'bed','legacy_bed',?,
          'fp-cdb113e-bed-cache-variance','error','open',1,
          'Exact stale bed cache disposition',
          '2026-07-27T10:17:00.000Z','2026-07-27T10:17:00.000Z',
          '2026-07-27T10:17:00.000Z','2026-07-27T10:17:00.000Z'
        )
      `).run(String(bed.id));

      const accepted = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-bed-cache-variance',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:18:00.000Z',
      });
      expect(accepted.status).toBe('passed');
      expect(Object.fromEntries(accepted.checks.map((check) => [check.name, check.mismatchCount]))).toMatchObject({
        legacy_bed_status_derived_occupancy: 0,
        unresolved_convergence_issues: 0,
      });

      sqlite.prepare(`DELETE FROM canonical_processing_issues WHERE issue_public_id=?`)
        .run('issue-cdb113e-bed-cache-variance');
      const missingIssue = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-bed-cache-variance-missing-issue',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:19:00.000Z',
      });
      expect(missingIssue.status).toBe('failed');
      expect(Object.fromEntries(missingIssue.checks.map((check) => [check.name, check.mismatchCount])))
        .toMatchObject({ legacy_bed_status_derived_occupancy: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('fails persistently when independent lifecycle, occupancy, issue, and second-pass gates are violated', async () => {
    const { sqlite, db } = await seedConverged();
    try {
      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.exec(`
        UPDATE canonical_admissions SET current_status='discharge_pending'
        WHERE tenant_id='tenant-a';
        UPDATE canonical_beds SET operational_status='maintenance'
        WHERE tenant_id='tenant-a';
        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,
          source_type,source_public_id,fingerprint,severity,status,occurrence_count,
          summary,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
        ) VALUES (
          'tenant-a','issue-cdb113e-reconcile','encounter_admission_bed_backfill',
          'CDB113E_SYNTHETIC_UNRESOLVED','admission','legacy_admission','21',
          'fp-cdb113e-reconcile','error','open',1,'Synthetic aggregate issue',
          '2026-07-27T10:11:00.000Z','2026-07-27T10:11:00.000Z',
          '2026-07-27T10:11:00.000Z','2026-07-27T10:11:00.000Z'
        );
        UPDATE canonical_migration_runs
        SET result_summary_json=json_set(result_summary_json,'$.secondPassZeroNew',json('false'))
        WHERE tenant_id='tenant-a' AND run_public_id='cdb-113e-reconcile-second-pass';
      `);
      sqlite.exec('PRAGMA foreign_keys = ON');

      const result = await reconcileEncounterAdmissionBedConvergence(db, {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-fail',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:12:00.000Z',
      });
      expect(result.status).toBe('failed');
      expect(result.mismatchChecks).toBeGreaterThanOrEqual(4);
      const counts = Object.fromEntries(result.checks.map((check) => [check.name, check.mismatchCount]));
      expect(counts.admission_header_latest_event_parity).toBeGreaterThan(0);
      expect(counts.inactive_bed_active_occupancy).toBeGreaterThan(0);
      expect(counts.unresolved_convergence_issues).toBeGreaterThan(0);
      expect(counts.second_pass_zero_new_row_evidence).toBeGreaterThan(0);
      expect(sqlite.prepare(`
        SELECT status,mismatch_count FROM canonical_reconciliation_runs
        WHERE tenant_id='tenant-a' AND run_public_id='cdb-113e-reconcile-fail'
      `).get()).toMatchObject({ status: 'failed', mismatch_count: result.mismatchChecks });
    } finally {
      sqlite.close();
    }
  });

  it('produces deterministic evidence for the same aggregate state and updates the same receipt idempotently', async () => {
    const { sqlite, db } = await seedConverged();
    try {
      const options = {
        tenantId: 'tenant-a',
        runPublicId: 'cdb-113e-reconcile-repeat',
        migrationRunPublicId: 'cdb-113e-reconcile-second-pass',
        nowUtc: '2026-07-27T10:15:00.000Z',
      };
      const first = await reconcileEncounterAdmissionBedConvergence(db, options);
      const second = await reconcileEncounterAdmissionBedConvergence(db, {
        ...options,
        nowUtc: '2026-07-27T10:16:00.000Z',
      });
      expect(second.evidenceSha256).toBe(first.evidenceSha256);
      expect(second.checks).toEqual(first.checks);
      expect((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_reconciliation_runs
        WHERE tenant_id='tenant-a' AND run_public_id='cdb-113e-reconcile-repeat'
      `).get() as { count: number }).count).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});

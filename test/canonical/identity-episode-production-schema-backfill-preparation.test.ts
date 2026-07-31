import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateIdentityEpisodeProductionSchemaBackfillPreparation,
  type IdentityEpisodeProductionSchemaBackfillPreparation,
} from '../../scripts/canonical/check-identity-episode-production-schema-backfill-preparation';

const root = process.cwd();
const preparationPath = 'docs/database/identity-episode-production-schema-backfill-preparation.json';
const auditPath = 'docs/database/audits/2026-07-27-identity-episode-production-schema-backfill-preparation-audit.md';
const designPath = 'docs/superpowers/specs/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation-design.md';
const planPath = 'docs/superpowers/plans/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation.md';

function preparation(): IdentityEpisodeProductionSchemaBackfillPreparation {
  return JSON.parse(readFileSync(preparationPath, 'utf8')) as IdentityEpisodeProductionSchemaBackfillPreparation;
}

describe('CDB-113H identity/episode production schema-backfill preparation', () => {
  it('passes the exact read-only preparation evidence', () => {
    expect(evaluateIdentityEpisodeProductionSchemaBackfillPreparation(root)).toEqual({
      preparationReady: true,
      mutationReady: false,
      issueCount: 0,
      pendingMigrationCount: 10,
      truePendingMigrationCount: 9,
      identityEpisodePendingMigrationCount: 8,
      identityEpisodeTruePendingMigrationCount: 7,
      unrelatedPendingMigrationCount: 2,
      ledgerDriftMigrationCount: 1,
      missingAuthorityCount: 4,
      futureStageCount: 6,
    });
  });

  it('locks exact pending migration order, hashes, and semantic classification', () => {
    const value = preparation();
    expect(value.production.migrationLedgerCount).toBe(487);
    expect(value.production.wranglerPendingMigrations.map((entry) => entry.name)).toEqual([
      '0541_canonical_local_sync_protocol.sql',
      '0542_canonical_sync_inbox_lifecycle.sql',
      '0543_canonical_sync_outbox_lifecycle.sql',
      '0544_canonical_tenant_patient_links.sql',
      '0545_canonical_practitioner_operational_adoption.sql',
      '0546_canonical_appointment_authority.sql',
      '0547_patient_merge_map_hardening.sql',
      '0548_canonical_encounter_admission_bed_convergence.sql',
      '0549_approval_revision_policy.sql',
      '0550_canonical_credit_note_cash_refund_reversals.sql',
    ]);
    expect(value.production.wranglerPendingMigrations.map((entry) => entry.sha256)).toEqual([
      '3681118880d0bc654a431f3cb8136b062de7b749a7cfe893a749b171d43af44c',
      '73da280fef46a30ca454c61ae085ff4a9362b9c6c53ba53bcb4778cf2998abb1',
      'bd67c47bb37b2fa6a248ad951af2588d931c87bfdd2469c8fd22c93caf56149f',
      'ea393e5b963062b6401e21d028ee3e9ad0aa6dd59a4bef8ba3f2b5b1949660cb',
      'f99634ef02f425aa6d27984a2bf23ee0bb075d0f4aca115cbd0674d70f6d4de7',
      '49a7ca0ed788cb5c8896fc1dab37871cfdfc34c7cca337fbfb0079e43f4d5646',
      '28e487aad4674a339a9909cc80c4eb3e7d8179cadc5fb3fa0555d576665d3aaf',
      '99141f240c6c2681b8474f9c5e8dc972994ad12097d430f13cf8d942daf3642d',
      '37ef241634d4c5ee5ab4dd4c1cc4ce880773580fafd31a8a041ea91429b66066',
      '9ae641666650f795fb9641539741b602e863d736637b16323fb42399ed653d4e',
    ]);
    expect(value.production.wranglerPendingMigrations[6]).toMatchObject({
      semanticStatus: 'schema_equivalent_ledger_name_drift',
      productionLedgerName: '0541_patient_merge_map_hardening.sql',
      productionSchemaEquivalent: true,
      tenant100ExistingRows: 0,
    });
    expect(value.production.wranglerPendingMigrations[7]).toMatchObject({
      semanticStatus: 'true_pending_high_risk_rebuild',
      rebuildsTables: ['canonical_encounters', 'canonical_bed_stays'],
      tenant100ExistingRowsAtRisk: 262,
    });
    expect(value.production.wranglerPendingMigrations[8]).toMatchObject({
      semanticStatus: 'true_pending_non_identity_episode',
      mutationProfile: 'rebuild_approval_decision_and_event_tables_for_revision_scoped_history',
    });
    expect(value.production.wranglerPendingMigrations[9]).toMatchObject({
      semanticStatus: 'true_pending_non_identity_episode',
      mutationProfile: 'create_immutable_credit_note_cash_refund_reversal_authority',
    });
  });

  it('records the exact production schema and tenant-100 aggregate baseline', () => {
    const value = preparation();
    expect(value.production.missingIdentityEpisodeAuthorities).toEqual([
      'canonical_tenant_patient_links',
      'canonical_appointments',
      'canonical_admissions',
      'canonical_beds',
    ]);
    expect(value.production.tenant100Baseline).toEqual({
      patients: 325,
      practitionerSources: 30,
      canonicalPractitioners: 30,
      appointmentIntents: 141,
      legacyEncounters: 0,
      visits: 164,
      canonicalEncounters: 234,
      admissions: 65,
      beds: 31,
      patientBedInfos: 32,
      canonicalBedStays: 28,
      canonicalOutboxEvents: 66,
      patientMergeRecordMap: 0,
    });
    expect(value.production.readOnlyEvidence).toEqual({
      databaseIdentityVerified: true,
      changedDbEnvelopeCount: 0,
      rowsWritten: 0,
      productionMutationPerformed: false,
    });
  });

  it('requires six serial future stages and keeps every mutation gate blocked', () => {
    const value = preparation();
    expect(value.futureStages.map((stage) => stage.id)).toEqual([
      'H0_PROTECTED_EXPORT_AND_CLONE',
      'H1_CLONE_SERIAL_MIGRATION_REHEARSAL',
      'H2_CLONE_BACKFILL_RECONCILIATION',
      'H3_PRODUCTION_SCHEMA_AUTHORIZATION',
      'H4_PRODUCTION_BACKFILL_AUTHORIZATION',
      'H5_REPEAT_READONLY_OBSERVATION',
    ]);
    expect(value.futureStages.every((stage) => stage.authorizedNow === false)).toBe(true);
    expect(Object.values(value.safety).every((entry) => entry === false)).toBe(true);
    expect(value.nextCheckpoint).toBe('CDB-113H1-PROTECTED-CLONE-MIGRATION-REHEARSAL-AUTHORIZATION-REQUIRED');
  });

  it('keeps the audit, design, and plan aligned with the fail-closed preparation', () => {
    const combined = [auditPath, designPath, planPath]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    for (const text of [
      'CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION',
      '0541_canonical_local_sync_protocol.sql',
      '0541_patient_merge_map_hardening.sql',
      '0547_patient_merge_map_hardening.sql',
      '0548_canonical_encounter_admission_bed_convergence.sql',
      '0549_approval_revision_policy.sql',
      '0550_canonical_credit_note_cash_refund_reversals.sql',
      'canonical_tenant_patient_links',
      'canonical_appointments',
      'canonical_admissions',
      'canonical_beds',
      '234',
      '28',
      'No production migration or backfill is authorized',
      'CDB-113H1-PROTECTED-CLONE-MIGRATION-REHEARSAL-AUTHORIZATION-REQUIRED',
    ]) expect(combined).toContain(text);
  });

  it('fails closed on drifted counts, hashes, stage authorization, or mutation claims', () => {
    const count = structuredClone(preparation());
    count.production.migrationLedgerCount = 488;
    expect(evaluateIdentityEpisodeProductionSchemaBackfillPreparation(root, count).preparationReady).toBe(false);

    const hash = structuredClone(preparation());
    hash.production.wranglerPendingMigrations[0].sha256 = '0'.repeat(64);
    expect(evaluateIdentityEpisodeProductionSchemaBackfillPreparation(root, hash).preparationReady).toBe(false);

    const stage = structuredClone(preparation());
    stage.futureStages[0].authorizedNow = true;
    expect(evaluateIdentityEpisodeProductionSchemaBackfillPreparation(root, stage).preparationReady).toBe(false);

    const mutation = structuredClone(preparation());
    mutation.safety.productionMigrationApplied = true;
    expect(evaluateIdentityEpisodeProductionSchemaBackfillPreparation(root, mutation).preparationReady).toBe(false);
  });
});

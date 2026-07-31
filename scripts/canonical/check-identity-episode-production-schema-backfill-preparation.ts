import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PreparationMigrationEntry {
  name: string;
  sha256: string;
  semanticStatus: string;
  productionLedgerName?: string;
  productionSchemaEquivalent?: boolean;
  dependsOn: string[];
  mutationProfile: string;
  tenant100ExistingRows?: number;
  tenant100SourceRows?: number;
  productionPreconditions: string[];
  rebuildsTables?: string[];
  tenant100ExistingRowsAtRisk?: number;
  tenant100ExistingEncounterRows?: number;
  tenant100ExistingBedStayRows?: number;
}

export interface IdentityEpisodeProductionSchemaBackfillPreparation {
  version: number;
  checkpoint: string;
  executionMode: string;
  preparedOn: string;
  branch: string;
  sourceCommits: Record<string, string>;
  production: {
    migrationLedgerCount: number;
    wranglerPendingMigrations: PreparationMigrationEntry[];
    truePendingMigrationCount: number;
    identityEpisodePendingMigrationCount: number;
    identityEpisodeTruePendingMigrationCount: number;
    unrelatedPendingMigrationCount: number;
    ledgerDriftMigrationCount: number;
    missingIdentityEpisodeAuthorities: string[];
    tenant100Baseline: Record<string, number>;
    readOnlyEvidence: {
      databaseIdentityVerified: boolean;
      changedDbEnvelopeCount: number;
      rowsWritten: number;
      productionMutationPerformed: boolean;
    };
  };
  backfillOrder: Array<{
    id: string;
    script: string;
    dependsOn: string[];
    tenant100SourceRows: number;
    sourceBreakdown?: Record<string, number>;
    secondPassRequirement: string;
  }>;
  reconciliationRequirements: string[];
  futureStages: Array<{
    id: string;
    authorizedNow: boolean;
    requires: string[];
  }>;
  safety: Record<string, boolean>;
  mutationReady: boolean;
  nextCheckpoint: string;
}

export interface IdentityEpisodeProductionSchemaBackfillPreparationResult {
  preparationReady: boolean;
  mutationReady: false;
  issueCount: number;
  pendingMigrationCount: number;
  truePendingMigrationCount: number;
  identityEpisodePendingMigrationCount: number;
  identityEpisodeTruePendingMigrationCount: number;
  unrelatedPendingMigrationCount: number;
  ledgerDriftMigrationCount: number;
  missingAuthorityCount: number;
  futureStageCount: number;
}

const PREPARATION_PATH = 'docs/database/identity-episode-production-schema-backfill-preparation.json';
const EXPECTED_MIGRATIONS = [
  ['0541_canonical_local_sync_protocol.sql', '3681118880d0bc654a431f3cb8136b062de7b749a7cfe893a749b171d43af44c'],
  ['0542_canonical_sync_inbox_lifecycle.sql', '73da280fef46a30ca454c61ae085ff4a9362b9c6c53ba53bcb4778cf2998abb1'],
  ['0543_canonical_sync_outbox_lifecycle.sql', 'bd67c47bb37b2fa6a248ad951af2588d931c87bfdd2469c8fd22c93caf56149f'],
  ['0544_canonical_tenant_patient_links.sql', 'ea393e5b963062b6401e21d028ee3e9ad0aa6dd59a4bef8ba3f2b5b1949660cb'],
  ['0545_canonical_practitioner_operational_adoption.sql', 'f99634ef02f425aa6d27984a2bf23ee0bb075d0f4aca115cbd0674d70f6d4de7'],
  ['0546_canonical_appointment_authority.sql', '49a7ca0ed788cb5c8896fc1dab37871cfdfc34c7cca337fbfb0079e43f4d5646'],
  ['0547_patient_merge_map_hardening.sql', '28e487aad4674a339a9909cc80c4eb3e7d8179cadc5fb3fa0555d576665d3aaf'],
  ['0548_canonical_encounter_admission_bed_convergence.sql', '99141f240c6c2681b8474f9c5e8dc972994ad12097d430f13cf8d942daf3642d'],
  ['0549_approval_revision_policy.sql', '37ef241634d4c5ee5ab4dd4c1cc4ce880773580fafd31a8a041ea91429b66066'],
  ['0550_canonical_credit_note_cash_refund_reversals.sql', '9ae641666650f795fb9641539741b602e863d736637b16323fb42399ed653d4e'],
] as const;
const EXPECTED_AUTHORITIES = [
  'canonical_tenant_patient_links',
  'canonical_appointments',
  'canonical_admissions',
  'canonical_beds',
];
const EXPECTED_STAGES = [
  'H0_PROTECTED_EXPORT_AND_CLONE',
  'H1_CLONE_SERIAL_MIGRATION_REHEARSAL',
  'H2_CLONE_BACKFILL_RECONCILIATION',
  'H3_PRODUCTION_SCHEMA_AUTHORIZATION',
  'H4_PRODUCTION_BACKFILL_AUTHORIZATION',
  'H5_REPEAT_READONLY_OBSERVATION',
];
const EXPECTED_BASELINE: Record<string, number> = {
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
};
const REQUIRED_DOCS = [
  'docs/database/audits/2026-07-27-identity-episode-production-schema-backfill-preparation-audit.md',
  'docs/superpowers/specs/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation-design.md',
  'docs/superpowers/plans/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation.md',
];

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sameArray(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nonEmptyStrings(values: unknown): values is string[] {
  return Array.isArray(values) && values.length > 0
    && values.every((value) => typeof value === 'string' && value.trim().length > 0);
}

export function evaluateIdentityEpisodeProductionSchemaBackfillPreparation(
  rootInput: string,
  override?: IdentityEpisodeProductionSchemaBackfillPreparation,
): IdentityEpisodeProductionSchemaBackfillPreparationResult {
  const root = resolve(rootInput);
  const issues: string[] = [];
  let value: IdentityEpisodeProductionSchemaBackfillPreparation;
  try {
    value = override ?? JSON.parse(readFileSync(join(root, PREPARATION_PATH), 'utf8')) as IdentityEpisodeProductionSchemaBackfillPreparation;
  } catch {
    return {
      preparationReady: false,
      mutationReady: false,
      issueCount: 1,
      pendingMigrationCount: 0,
      truePendingMigrationCount: 0,
      identityEpisodePendingMigrationCount: 0,
      identityEpisodeTruePendingMigrationCount: 0,
      unrelatedPendingMigrationCount: 0,
      ledgerDriftMigrationCount: 0,
      missingAuthorityCount: 0,
      futureStageCount: 0,
    };
  }

  if (value.version !== 2
    || value.checkpoint !== 'CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION'
    || value.executionMode !== 'read_only_preparation'
    || value.preparedOn !== '2026-07-27'
    || value.branch !== 'program/cdb-main-continuous-20260725') issues.push('metadata');

  if (value.production.migrationLedgerCount !== 487
    || value.production.wranglerPendingMigrations.length !== EXPECTED_MIGRATIONS.length) issues.push('migration-count');

  for (const [index, [name, hash]] of EXPECTED_MIGRATIONS.entries()) {
    const entry = value.production.wranglerPendingMigrations[index];
    if (!entry || entry.name !== name || entry.sha256 !== hash) issues.push(`migration-${index}`);
    const path = join(root, 'migrations', name);
    if (!existsSync(path) || sha256File(path) !== hash) issues.push(`migration-file-${index}`);
    if (!nonEmptyStrings(entry?.productionPreconditions) || !Array.isArray(entry?.dependsOn)) issues.push(`migration-contract-${index}`);
  }

  const truePending = value.production.wranglerPendingMigrations
    .filter((entry) => entry.semanticStatus.startsWith('true_pending')).length;
  const ledgerDrift = value.production.wranglerPendingMigrations
    .filter((entry) => entry.semanticStatus === 'schema_equivalent_ledger_name_drift').length;
  const identityEpisodePending = value.production.wranglerPendingMigrations
    .filter((entry) => Number(entry.name.slice(0, 4)) >= 541 && Number(entry.name.slice(0, 4)) <= 548).length;
  const identityEpisodeTruePending = value.production.wranglerPendingMigrations
    .filter((entry) => Number(entry.name.slice(0, 4)) >= 541 && Number(entry.name.slice(0, 4)) <= 548
      && entry.semanticStatus.startsWith('true_pending')).length;
  const unrelatedPending = value.production.wranglerPendingMigrations
    .filter((entry) => entry.semanticStatus === 'true_pending_non_identity_episode').length;
  if (truePending !== 9 || value.production.truePendingMigrationCount !== 9) issues.push('true-pending');
  if (identityEpisodePending !== 8 || value.production.identityEpisodePendingMigrationCount !== 8) issues.push('identity-episode-pending');
  if (identityEpisodeTruePending !== 7 || value.production.identityEpisodeTruePendingMigrationCount !== 7) issues.push('identity-episode-true-pending');
  if (unrelatedPending !== 2 || value.production.unrelatedPendingMigrationCount !== 2) issues.push('unrelated-pending');
  if (ledgerDrift !== 1 || value.production.ledgerDriftMigrationCount !== 1) issues.push('ledger-drift');

  const drift = value.production.wranglerPendingMigrations[6];
  if (drift?.productionLedgerName !== '0541_patient_merge_map_hardening.sql'
    || drift?.productionSchemaEquivalent !== true
    || drift?.tenant100ExistingRows !== 0) issues.push('ledger-drift-detail');
  const rebuild = value.production.wranglerPendingMigrations[7];
  if (!sameArray(rebuild?.rebuildsTables ?? [], ['canonical_encounters', 'canonical_bed_stays'])
    || rebuild?.tenant100ExistingRowsAtRisk !== 262
    || rebuild?.tenant100ExistingEncounterRows !== 234
    || rebuild?.tenant100ExistingBedStayRows !== 28) issues.push('rebuild-risk');

  if (!sameArray(value.production.missingIdentityEpisodeAuthorities, EXPECTED_AUTHORITIES)) issues.push('authorities');
  if (Object.keys(EXPECTED_BASELINE).some((key) => value.production.tenant100Baseline[key] !== EXPECTED_BASELINE[key])) issues.push('baseline');
  if (!value.production.readOnlyEvidence.databaseIdentityVerified
    || value.production.readOnlyEvidence.changedDbEnvelopeCount !== 0
    || value.production.readOnlyEvidence.rowsWritten !== 0
    || value.production.readOnlyEvidence.productionMutationPerformed) issues.push('readonly');

  if (value.backfillOrder.length !== 4
    || !sameArray(value.backfillOrder.map((entry) => entry.id), ['PATIENT_LINKS', 'PRACTITIONERS', 'APPOINTMENTS', 'ENCOUNTER_ADMISSION_BED'])
    || value.backfillOrder.some((entry) => !existsSync(join(root, entry.script)) || !entry.secondPassRequirement)) issues.push('backfill-order');
  if (value.reconciliationRequirements.length < 14 || !nonEmptyStrings(value.reconciliationRequirements)) issues.push('reconciliation');
  if (!sameArray(value.futureStages.map((stage) => stage.id), EXPECTED_STAGES)
    || value.futureStages.some((stage) => stage.authorizedNow || !nonEmptyStrings(stage.requires))) issues.push('future-stages');
  if (Object.values(value.safety).some(Boolean) || value.mutationReady) issues.push('safety');
  if (value.nextCheckpoint !== 'CDB-113H1-PROTECTED-CLONE-MIGRATION-REHEARSAL-AUTHORIZATION-REQUIRED') issues.push('next');
  if (REQUIRED_DOCS.some((path) => !existsSync(join(root, path)))) issues.push('docs');

  return {
    preparationReady: issues.length === 0,
    mutationReady: false,
    issueCount: issues.length,
    pendingMigrationCount: value.production.wranglerPendingMigrations.length,
    truePendingMigrationCount: truePending,
    identityEpisodePendingMigrationCount: identityEpisodePending,
    identityEpisodeTruePendingMigrationCount: identityEpisodeTruePending,
    unrelatedPendingMigrationCount: unrelatedPending,
    ledgerDriftMigrationCount: ledgerDrift,
    missingAuthorityCount: value.production.missingIdentityEpisodeAuthorities.length,
    futureStageCount: value.futureStages.length,
  };
}

function main(): void {
  const result = evaluateIdentityEpisodeProductionSchemaBackfillPreparation(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.preparationReady) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

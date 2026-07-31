import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  controlCenter: 'docs/architecture/canonical-program-control-center.md',
  backfillReceipt:
    'docs/database/migration-runs/production/CDB-113H2-protected-clone-backfill-reconciliation.md',
  mainSyncReceipt:
    'docs/database/migration-runs/production/CDB-113H2A-main-sync-h2-evidence-revalidation.md',
  schemaAuthorizationReceipt:
    'docs/database/migration-runs/production/CDB-113H3-production-schema-authorization-contract.md',
  schemaAuthorizationReadiness:
    'docs/database/identity-episode-production-schema-authorization-readiness.json',
  rehearsalReceipt:
    'docs/database/migration-runs/production/CDB-113H1-protected-local-clone-migration-rehearsal.md',
  preparationReceipt:
    'docs/database/migration-runs/production/CDB-113H-identity-episode-production-schema-backfill-preparation.md',
  observationReceipt:
    'docs/database/migration-runs/production/CDB-113G-identity-episode-production-readonly-observation.md',
  localReceipt: 'docs/database/migration-runs/P11-canonical-identity-episode-read-promotion.md',
  tracker: 'task-progress.yaml',
  handoff: '.ai-bridge/current-plan.md',
  matrix: 'docs/database/canonical-authority-matrix.yaml',
  audit: 'docs/database/audits/2026-07-27-identity-episode-production-schema-backfill-preparation-audit.md',
  design: 'docs/superpowers/specs/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation-design.md',
  plan: 'docs/superpowers/plans/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation.md',
  evidence: 'docs/database/identity-episode-production-schema-backfill-preparation.json',
  productionAuthorizationPackage: 'docs/database/cdb-v1-060-production-authorization-package.json',
  productionAuthorizationAudit: 'docs/database/audits/2026-07-30-production-authorization-package-preparation.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('canonical program continuity contract', () => {
  it('keeps one durable control centre for the H3 contract-ready checkpoint and exact authorization gate', () => {
    const control = read(files.controlCenter);
    expect(control.length).toBeGreaterThan(8_000);
    for (const text of [
      'program/cdb-main-continuous-20260725',
      'CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-VERIFIED',
      'CDB-113H2A-MAIN-SYNC-AND-H2-EVIDENCE-REVALIDATION-VERIFIED',
      'CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-CONTRACT-READY',
      'CDB-113H3-PRODUCTION-SCHEMA-EXACT-AUTHORIZATION-REQUIRED',
      files.backfillReceipt,
      files.mainSyncReceipt,
      files.schemaAuthorizationReceipt,
      files.schemaAuthorizationReadiness,
      files.rehearsalReceipt,
      files.preparationReceipt,
      files.observationReceipt,
      files.matrix,
      files.audit,
      files.design,
      files.plan,
      files.evidence,
      files.tracker,
      files.handoff,
      'Canonical Finance is a domain inside the single HMS canonical program',
      'Do not access or mutate production',
    ]) expect(control).toContain(text);
  });

  it('records production authorization package readiness while retaining CDB-122 through CDB-127E and blocked production execution', () => {
    const tracker = read(files.tracker);
    const handoff = read(files.handoff);
    expect(tracker).toContain('current_checkpoint: CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY');
    expect(tracker).toContain('last_completed_checkpoint: CDB-V1-060_production_authorization_package_preparation');
    expect(tracker).toContain('next_checkpoint: CDB-V1-070-STAGED-PRODUCTION-CUTOVER-EXACT-AUTHORIZATION-REQUIRED');
    expect(tracker).toContain('parallel_execution_board: docs/architecture/hms-canonical-parallel-execution-board.yaml');
    expect(tracker).toContain('protected_core_cutover_runbook: docs/database/canonical-core-v1-production-cutover-runbook.md');
    expect(tracker).toContain('protected_core_surface_inventory: docs/database/protected-core-v1-surface-inventory.json');
    expect(tracker).toContain('protected_core_authority_contract: docs/database/protected-core-v1-authority-contracts.json');
    expect(tracker).toContain('protected_core_writer_command_coverage: docs/database/protected-core-v1-writer-command-coverage.json');
    expect(tracker).toContain('command_required: 0');
    expect(tracker).toContain('atomic_compatibility: 110');
    expect(tracker).toContain('implementation_groups: 0');
    expect(tracker).toContain('existing_provider_boundaries: 10');
    expect(tracker).toContain('contract_only_provider_boundaries: 8');
    expect(tracker).toContain('unclassified: 0');
    expect(tracker).toContain('full_command_coverage_complete: true');
    for (const text of [
      'checkpoint: CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN-VERIFIED',
      'checkpoint: CDB-122E-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-VERIFIED',
      'checkpoint: CDB-123E-CANONICAL-PATIENT-VITAL-MEASUREMENT-AUTHORITY-VERIFIED',
      'checkpoint: CDB-124E-CANONICAL-MEDICATION-ADMINISTRATION-PROVIDER-READINESS-VERIFIED',
      'checkpoint: CDB-125E-CANONICAL-LAB-RESULT-SPECIMEN-PROVIDER-READINESS-VERIFIED',
      'checkpoint: CDB-126A-RADIOLOGY-ACQUISITION-REPORT-AUTHORITY-DESIGN-VERIFIED',
      'checkpoint: CDB-126B-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-SCHEMA-VERIFIED',
      'checkpoint: CDB-126C-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-COMMANDS-VERIFIED',
      'checkpoint: CDB-126D-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-BACKFILL-RECONCILIATION-VERIFIED',
      'checkpoint: CDB-126E-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-PROVIDER-READINESS-VERIFIED',
      'checkpoint: CDB-127A-EMERGENCY-CASE-TRIAGE-AUTHORITY-DESIGN-VERIFIED',
      'checkpoint: CDB-127B-CANONICAL-EMERGENCY-CASE-TRIAGE-SCHEMA-VERIFIED',
      'checkpoint: CDB-127C-CANONICAL-EMERGENCY-CASE-TRIAGE-COMMANDS-VERIFIED',
      'checkpoint: CDB-127D-CANONICAL-EMERGENCY-CASE-TRIAGE-BACKFILL-RECONCILIATION-VERIFIED',
      'checkpoint: CDB-127E-CANONICAL-EMERGENCY-CASE-TRIAGE-PROVIDER-READINESS-VERIFIED',
      'target_table_count: 6',
      'planned_command_count: 9',
      'persistent_backfill_partition_count: 8',
      'persistent_reconciliation_check_count: 24',
      'at_cdb_127a_migration_0560_created: false',
      'migration_0560_created: true',
      'schema_module_created: true',
      'command_module_created: true',
      'focused_schema_tests_passed: 7',
      'focused_command_tests_passed: 7',
      'focused_backfill_reconciliation_tests_passed: 2',
      'provider_tests_passed: 5',
      'readiness_tests_passed: 3',
      'combined_cdb_127_a_c_tests_passed: 20',
      'combined_cdb_127_a_d_tests_passed: 22',
      'combined_cdb_127_a_e_tests_passed: 30',
      'selected_adapter_count: 3',
      'known_writer_count: 4',
      'known_reader_count: 6',
      'unknown_writer_assignments: 0',
      'unknown_reader_assignments: 0',
      'route_activation_count: 0',
      'readiness_issue_count: 0',
      'migration_manifest_count: 495',
      'atomic_command_count: 16',
      'persistent_partition_count: 10',
      'fixed_reconciliation_check_count: 30',
      'selected_adapter_count: 4',
      'known_writer_count: 8',
      'known_reader_count: 11',
      'unknown_writer_assignments: 0',
      'unknown_reader_assignments: 0',
      'route_activation_count: 0',
      'combined_cdb_126_a_e_tests_passed: 30',
      'local_ready: true',
      'production_ready: false',
      'runtime_routes_changed: false',
      'provider_enabled: false',
      'production_query_performed: false',
      'production_mutation_performed: false',
      'h3_contract_ready: true',
      'h3_authorization_present: false',
      'h3_execution_ready: false',
      'h3_schema_migration_authorized: false',
      'h3_production_backfill_authorized: false',
      'source_head_review_status: reviewed_current_after_CDB_V1_040C',
      'source_head_commits_ahead_of_cdb: 0',
      'h1_h2_bound_artifacts_unchanged: true',
      'h2_reconciliation_runs_passed: 7',
      'h2_second_pass_zero_new_business_rows: true',
      'h2_foreign_key_violations: 0',
      'h2_source_tables_unchanged: true',
      'future_production_gate: CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-REQUIRED',
      'control_center: docs/architecture/canonical-program-control-center.md',
    ]) expect(tracker).toContain(text);

    for (const text of [
      'CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY',
      'CDB-V1-070-STAGED-PRODUCTION-CUTOVER-EXACT-AUTHORIZATION-REQUIRED',
      'docs/database/audits/2026-07-30-production-authorization-package-preparation.md',
      'docs/database/cdb-v1-060-production-authorization-package.json',
      'Candidate implementation binding: `35e299d9ff2dc1781084dacd6d0f431816b0007c`',
      'packageReady=true',
      'executionReady=false',
      '18 external bindings remain unresolved',
      'Do not query or mutate production',
    ]) expect(handoff).toContain(text);

    const productionPackage = read(files.productionAuthorizationPackage);
    const productionAudit = read(files.productionAuthorizationAudit);
    for (const text of [
      '"checkpoint": "CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY"',
      '"candidateCommit": "35e299d9ff2dc1781084dacd6d0f431816b0007c"',
      '"productionMigrationAuthorized": false',
      '"canonicalWriteAuthorized": false',
      '"legacyRetirementAuthorized": false',
      '"productionMutationPerformed": false',
    ]) expect(productionPackage).toContain(text);
    expect(productionAudit).toContain('packageReady=true');
    expect(productionAudit).toContain('executionReady=false');
    expect(productionAudit).toContain('18 unresolved external bindings');
  });

  it('keeps sanitized H2 and H1 receipts with unchanged-production evidence', () => {
    const h2 = read(files.backfillReceipt);
    expect(h2.length).toBeGreaterThan(6_000);
    for (const text of [
      'CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-VERIFIED',
      'canonical tenant patient links: **325**',
      'exact canonical admissions created: **26**',
      'canonical bed stays preserved: **28**',
      'All **61** open convergence issues were validated',
      'production migration ledger remained **487**',
      'production mutation performed: **no**',
      'CDB-113H2A-MAIN-SYNC-AND-H2-EVIDENCE-REVALIDATION',
    ]) expect(h2).toContain(text);
    expect(h2).not.toContain('.hms-canonical-rehearsals');
    expect(h2).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);

    const h1 = read(files.rehearsalReceipt);
    for (const text of [
      'CDB-113H1-PROTECTED-LOCAL-CLONE-MIGRATION-REHEARSAL-VERIFIED',
      '10/10 migrations',
      '487 → 497',
      'foreign-key violations: **0**',
      'production rows written: **0**',
    ]) expect(h1).toContain(text);
  });

  it('retains CDB-113H, CDB-113G, and CDB-113F as historical evidence', () => {
    expect(read(files.preparationReceipt)).toContain(
      'CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION-VERIFIED',
    );
    expect(read(files.observationReceipt)).toContain(
      'CDB-113G-IDENTITY-EPISODE-PRODUCTION-READONLY-OBSERVATION-BLOCKED-SCHEMA',
    );
    expect(read(files.localReceipt)).toContain(
      'CDB-113F-IDENTITY-EPISODE-READ-PROMOTION-VERIFIED',
    );
  });
});

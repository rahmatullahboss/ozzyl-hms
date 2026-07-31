import { describe, expect, it } from 'vitest';
import {
  CDB101_EXPECTED_MIGRATIONS,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_REPORTING_IMPORT_TABLES,
  CDB101_REQUIRED_SMOKE_SCENARIOS,
  buildCanonicalImportCommandId,
  buildFeatureFlagCommandId,
  buildMigrationCommandId,
  buildReportingShadowFlagSql,
  buildReportingCutoverResolutionPlan,
  classifyProductionForeignKeyViolations,
  measureRollbackAndReopenTiming,
  validateCanonicalImportBundleSql,
  validateObservedForeignKeyDisposition,
  validatePendingCanonicalMigrations,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from '../../scripts/canonical/production-cutover-contract';
import { createReadySingleOperatorReportingAuthorization } from './fixtures/reporting-authorization-fixture';
import { buildReportingCutoverOperationsPlan } from '../../scripts/canonical/reporting-cutover-operations';
import {
  parsePendingMigrationNames,
  parseProductionCanonicalMigrationArgs,
  prepareProductionCanonicalMigrationExecution,
} from '../../scripts/canonical/apply-production-canonical-migrations';
import {
  buildCanonicalImportVerificationSql,
  parseProductionCanonicalImportArgs,
  prepareProductionCanonicalImportExecution,
  verifyCanonicalImportRowCounts,
} from '../../scripts/canonical/import-production-canonical-bundle';
import {
  buildReportingShadowActivationReceipt,
  parseProductionReportingFlagArgs,
  prepareProductionReportingFlagExecution,
  verifySingleReportingFlagWriteOutput,
} from '../../scripts/canonical/set-production-canonical-flag';

const NOW = '2026-07-14T16:00:00.000Z';

function readyAuthorization(): ReportingCutoverAuthorization {
  const input: ReportingCutoverAuthorization = {
    schemaVersion: 2,
    authorizationId: 'cdb101-reporting-20260714-window-01',
    productionExecutionAuthorized: true,
    authorizedDomain: 'reporting',
    authorizedTenantIds: ['100'],
    issuedAtUtc: '2026-07-14T15:30:00.000Z',
    expiresAtUtc: '2026-07-14T18:30:00.000Z',
    maintenanceWindowStartUtc: '2026-07-14T16:00:00.000Z',
    maintenanceWindowEndUtc: '2026-07-14T18:00:00.000Z',
    productionDatabase: {
      name: 'hms-super-admin-production-apac',
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    authorizationApproval: {
      ownerId: 'canonical-program-owner',
      approvedAtUtc: '2026-07-14T15:35:00.000Z',
      evidenceId: 'owner-approval-cdb101-20260714-01',
      evidenceSha256: '3'.repeat(64),
    },
    deployment: {
      authorized: true,
      candidateCommit: 'a'.repeat(40),
      candidateWorkerVersionId: '11111111-1111-4111-8111-111111111111',
      previousWorkerVersionId: '22222222-2222-4222-8222-222222222222',
      buildManifestSha256: 'b'.repeat(64),
      routeFingerprintSha256: 'c'.repeat(64),
      activeRoutesUnchangedEvidenceId: 'route-evidence-20260714-01',
    },
    migrations: {
      authorized: true,
      approvedMigrations: [...CDB101_EXPECTED_MIGRATIONS],
      repositoryManifestSha256: 'd'.repeat(64),
      commandId: '',
    },
    productionImport: {
      authorized: true,
      commandApproved: true,
      commandId: '',
      runnerVersion: 'production-canonical-bundle-import-v1',
      bundleSha256: 'e'.repeat(64),
      manifestSha256: 'f'.repeat(64),
      sourceExportSha256: '2'.repeat(64),
      tenantIds: ['100'],
      allowedTables: [...CDB101_REPORTING_IMPORT_TABLES],
      deterministicRunId: 'cdb101-reporting-tenant-100-run-01',
      secondPassRequired: true,
    },
    featureFlagPlan: {
      authorized: true,
      commandId: '',
      tenantId: '100',
      flagKey: 'canonical_reporting_v1',
      domain: 'reporting',
      initialMode: 'shadow',
      expectedPreviousState: 'absent_or_disabled',
      effectiveAtUtc: '2026-07-14T16:30:00.000Z',
      updatedByPublicId: 'cdb101-authorized-operator',
      canonicalModeAuthorized: false,
    },
    rollbackOwner: {
      assigned: true,
      ownerId: 'ops-rollback-primary',
      backupOwnerId: 'ops-rollback-backup',
      acknowledgedAtUtc: '2026-07-14T15:40:00.000Z',
      communicationChannelId: 'incident-channel-cdb101',
      decisionAuthority: 'may_initiate_rollback',
    },
    observationOwner: {
      assigned: true,
      ownerId: 'ops-observer-primary',
      backupOwnerId: 'ops-observer-backup',
      acknowledgedAtUtc: '2026-07-14T15:42:00.000Z',
      communicationChannelId: 'incident-channel-cdb101',
      decisionAuthority: 'may_accept_or_reject_go',
    },
    rollbackPolicy: {
      maxRollbackDurationMs: 60_000,
      maxReopenDurationMs: 120_000,
      observationGracePeriodMs: 30 * 60_000,
    },
    exportEvidence: {
      captured: true,
      exportSha256: '2'.repeat(64),
      exportSizeBytes: 123456,
      timeTravelBookmarkId: 'bookmark-20260714-1600',
      metadataEvidenceId: 'export-metadata-20260714-01',
      directoryMode: '700',
      fileMode: '600',
    },
    maintenanceRecoveryEvidence: {
      evidenceId: 'cdb101-maintenance-recovery-20260714-01',
      evidenceSha256: '9'.repeat(64),
    },
    workerBuildVersionEvidence: {
      evidenceId: 'cdb101-worker-build-version-20260714-01',
      evidenceSha256: '0'.repeat(64),
    },
    foreignKeyDisposition: {
      evidenceId: 'cdb101-fk-disposition-20260715-01',
      evidenceSha256: '8'.repeat(64),
      groups: [
        {
          childTable: 'billing_deposits',
          parentTable: 'bills',
          violationCount: 4,
          remainingViolationCount: 0,
          repairedViolationCount: 4,
          waivedViolationCount: 0,
          disposition: 'repair_required',
          ownerId: 'data-integrity-owner',
          evidenceId: 'fk-repair-billing-deposits-01',
          removalPhase: 'before_reporting_go',
        },
        {
          childTable: 'doctor_commission_accruals_old_0391',
          parentTable: 'bills',
          violationCount: 26,
          remainingViolationCount: 26,
          repairedViolationCount: 0,
          waivedViolationCount: 26,
          disposition: 'formal_waiver',
          ownerId: 'canonical-program-owner',
          evidenceId: 'fk-waiver-old-0391-bills-01',
          removalPhase: 'legacy_retirement_p11',
        },
        {
          childTable: 'doctor_commission_accruals_old_0391',
          parentTable: 'visits',
          violationCount: 15,
          remainingViolationCount: 15,
          repairedViolationCount: 0,
          waivedViolationCount: 15,
          disposition: 'formal_waiver',
          ownerId: 'canonical-program-owner',
          evidenceId: 'fk-waiver-old-0391-visits-01',
          removalPhase: 'legacy_retirement_p11',
        },
        {
          childTable: 'income',
          parentTable: 'bills',
          violationCount: 4,
          remainingViolationCount: 0,
          repairedViolationCount: 4,
          waivedViolationCount: 0,
          disposition: 'repair_required',
          ownerId: 'data-integrity-owner',
          evidenceId: 'fk-repair-income-01',
          removalPhase: 'before_reporting_go',
        },
      ],
    },
    smoke: {
      planId: 'reporting-canary-smoke-v2',
      requiredScenarios: [...CDB101_REQUIRED_SMOKE_SCENARIOS],
      maxP95LatencyMs: 1500,
      maxErrorRate: 0,
    },
  };

  input.migrations.commandId = buildMigrationCommandId(input);
  input.productionImport.commandId = buildCanonicalImportCommandId(input);
  input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);
  return input;
}

function readyTwoPersonAuthorization(): ReportingCutoverAuthorization {
  const strict = readyAuthorization();
  const input = {
    ...strict,
    schemaVersion: 3,
    ownerModel: 'two_person_constrained',
    rollbackOwner: {
      assigned: true,
      ownerId: 'rahmatullah-zisan',
      backupOwnerId: null,
      acknowledgedAtUtc: '2026-07-14T15:40:00.000Z',
      communicationChannelId: 'hms-cdb101-cutover-20260717',
      decisionAuthority: 'may_initiate_rollback',
    },
    observationOwner: {
      assigned: true,
      ownerId: 'staff-monitoring-owner',
      backupOwnerId: null,
      acknowledgedAtUtc: '2026-07-14T15:42:00.000Z',
      communicationChannelId: 'hms-cdb101-cutover-20260717',
      decisionAuthority: 'may_accept_or_reject_go',
    },
    twoPersonRiskAcceptance: {
      accepted: true,
      acceptedByOwnerId: 'rahmatullah-zisan',
      acceptedAtUtc: '2026-07-14T15:45:00.000Z',
      evidenceId: 'cdb101-two-person-risk-20260714-01',
      evidenceSha256: '7'.repeat(64),
      noTechnicalBackupAccepted: true,
      noMonitoringBackupAccepted: true,
      automaticAbortOnTechnicalOperatorUnavailable: true,
      automaticAbortOnMonitoringOwnerUnavailable: true,
      shadowOnlyAccepted: true,
      canonicalPromotionProhibited: true,
      workerTrafficChangeProhibited: true,
    },
  } as ReportingCutoverAuthorization;

  input.migrations.commandId = buildMigrationCommandId(input);
  input.productionImport.commandId = buildCanonicalImportCommandId(input);
  input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);
  return input;
}

describe('CDB-101 production cutover contract', () => {
  it('accepts only a complete exact reporting authorization', () => {
    const input = readyAuthorization();
    const result = validateReportingCutoverAuthorization(input, NOW);

    expect(result.executionReady).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.expectedCommandIds).toEqual({
      migration: input.migrations.commandId,
      productionImport: input.productionImport.commandId,
      featureFlag: input.featureFlagPlan.commandId,
    });
  });

  it('accepts the explicit two-person constrained owner model', () => {
    const input = readyTwoPersonAuthorization();
    const result = validateReportingCutoverAuthorization(input, NOW);

    expect(result.executionReady).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts an explicit single-operator risk-accepted shadow-only model', () => {
    const input = createReadySingleOperatorReportingAuthorization();
    const result = validateReportingCutoverAuthorization(input, NOW);

    expect(result.executionReady).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('fails closed when single-operator risk safeguards are weakened', () => {
    const input = createReadySingleOperatorReportingAuthorization() as ReportingCutoverAuthorization & {
      singleOperatorRiskAcceptance: {
        acceptedByOwnerId: string | null;
        evidenceSha256: string | null;
        workerTrafficChangeProhibited: boolean;
        postActivationReconciliationRequired: boolean;
      };
    };
    input.observationOwner.ownerId = 'another-owner';
    input.rollbackOwner.backupOwnerId = 'unexpected-backup';
    input.singleOperatorRiskAcceptance.acceptedByOwnerId = 'another-owner';
    input.singleOperatorRiskAcceptance.evidenceSha256 = null;
    input.singleOperatorRiskAcceptance.workerTrafficChangeProhibited = false;
    input.singleOperatorRiskAcceptance.postActivationReconciliationRequired = false;

    input.migrations.commandId = buildMigrationCommandId(input);
    input.productionImport.commandId = buildCanonicalImportCommandId(input);
    input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);

    const codes = validateReportingCutoverAuthorization(input, NOW).issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'CDB101_SINGLE_OPERATOR_OWNER_CONTRACT_INVALID',
      'CDB101_SINGLE_OPERATOR_BACKUP_PROHIBITED',
      'CDB101_SINGLE_OPERATOR_RISK_ACCEPTANCE_INVALID',
      'CDB101_SINGLE_OPERATOR_SCOPE_PROHIBITED',
    ]));
  });

  it('binds single-operator risk acceptance into every deterministic command ID', () => {
    const input = createReadySingleOperatorReportingAuthorization() as ReportingCutoverAuthorization & {
      singleOperatorRiskAcceptance: { evidenceSha256: string | null };
    };
    const migrationId = input.migrations.commandId;
    const importId = input.productionImport.commandId;
    const flagId = input.featureFlagPlan.commandId;

    input.singleOperatorRiskAcceptance.evidenceSha256 = '5'.repeat(64);

    expect(buildMigrationCommandId(input)).not.toBe(migrationId);
    expect(buildCanonicalImportCommandId(input)).not.toBe(importId);
    expect(buildFeatureFlagCommandId(input)).not.toBe(flagId);
  });

  it('fails closed when the two-person constrained safeguards are weakened', () => {
    const input = readyTwoPersonAuthorization();
    if (input.schemaVersion !== 3) throw new Error('expected schema v3');
    input.observationOwner.ownerId = input.rollbackOwner.ownerId;
    input.rollbackOwner.backupOwnerId = 'unexpected-technical-backup';
    input.twoPersonRiskAcceptance.evidenceSha256 = null;
    input.twoPersonRiskAcceptance.acceptedByOwnerId = 'another-owner';
    input.twoPersonRiskAcceptance.workerTrafficChangeProhibited = false;
    input.featureFlagPlan.canonicalModeAuthorized = true;
    input.featureFlagPlan.initialMode = 'canonical';

    input.migrations.commandId = buildMigrationCommandId(input);
    input.productionImport.commandId = buildCanonicalImportCommandId(input);
    input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);

    const codes = validateReportingCutoverAuthorization(input, NOW).issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'CDB101_TWO_PERSON_OWNER_CONTRACT_INVALID',
      'CDB101_TWO_PERSON_BACKUP_PROHIBITED',
      'CDB101_TWO_PERSON_RISK_ACCEPTANCE_INVALID',
      'CDB101_TWO_PERSON_SCOPE_PROHIBITED',
      'CDB101_SHADOW_FLAG_SCOPE_INVALID',
    ]));
  });

  it('binds constrained risk acceptance into every deterministic command ID', () => {
    const input = readyTwoPersonAuthorization();
    if (input.schemaVersion !== 3) throw new Error('expected schema v3');
    const migrationId = input.migrations.commandId;
    const importId = input.productionImport.commandId;
    const flagId = input.featureFlagPlan.commandId;

    input.twoPersonRiskAcceptance.evidenceSha256 = '6'.repeat(64);

    expect(buildMigrationCommandId(input)).not.toBe(migrationId);
    expect(buildCanonicalImportCommandId(input)).not.toBe(importId);
    expect(buildFeatureFlagCommandId(input)).not.toBe(flagId);
  });

  it('fails closed on missing authorization, invalid time, owner collision, and absent evidence', () => {
    const input = readyAuthorization();
    input.productionExecutionAuthorized = false;
    input.expiresAtUtc = '2026-07-14T15:59:59.000Z';
    input.maintenanceWindowEndUtc = input.maintenanceWindowStartUtc;
    input.observationOwner.ownerId = input.rollbackOwner.ownerId;
    input.observationOwner.decisionAuthority = 'may_initiate_rollback';
    input.authorizationApproval.evidenceSha256 = null;
    input.deployment.activeRoutesUnchangedEvidenceId = null;
    input.exportEvidence.captured = false;
    input.exportEvidence.timeTravelBookmarkId = null;
    input.foreignKeyDisposition.groups[0].remainingViolationCount = 4;
    input.foreignKeyDisposition.groups[0].repairedViolationCount = 0;

    const codes = validateReportingCutoverAuthorization(input, NOW).issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'CDB101_OWNER_APPROVAL_EVIDENCE_MISSING',
      'CDB101_EXECUTION_AUTHORIZATION_MISSING',
      'CDB101_EXECUTION_AUTHORIZATION_EXPIRED',
      'CDB101_MAINTENANCE_WINDOW_INVALID',
      'CDB101_AUTHORIZATION_EXPIRY_INVALID',
      'CDB101_OWNER_IDENTITY_COLLISION',
      'CDB101_OWNER_AUTHORITY_INVALID',
      'CDB101_ACTIVE_ROUTE_EVIDENCE_MISSING',
      'CDB101_EXPORT_EVIDENCE_MISSING',
      'CDB101_TIME_TRAVEL_BOOKMARK_MISSING',
      'CDB101_FOREIGN_KEY_DISPOSITION_INVALID',
    ]));
  });

  it('builds deterministic command IDs that change when protected scope changes', () => {
    const input = readyAuthorization();
    const migrationId = buildMigrationCommandId(input);
    const importId = buildCanonicalImportCommandId(input);
    const flagId = buildFeatureFlagCommandId(input);

    expect(migrationId).toMatch(/^cdb101-migrations-[0-9a-f]{20}$/);
    expect(importId).toMatch(/^cdb101-import-[0-9a-f]{20}$/);
    expect(flagId).toMatch(/^cdb101-flag-[0-9a-f]{20}$/);
    expect(buildMigrationCommandId(input)).toBe(migrationId);

    const reordered = structuredClone(input);
    reordered.foreignKeyDisposition.groups.reverse();
    expect(buildMigrationCommandId(reordered)).toBe(migrationId);
    expect(buildCanonicalImportCommandId(reordered)).toBe(importId);
    expect(buildFeatureFlagCommandId(reordered)).toBe(flagId);

    const changed = structuredClone(input);
    changed.migrations.repositoryManifestSha256 = '9'.repeat(64);
    expect(buildMigrationCommandId(changed)).not.toBe(migrationId);
  });

  it('keeps required canonical import parents before their referencing children', () => {
    expect(CDB101_REPORTING_IMPORT_TABLES).toContain('canonical_migration_runs');
    expect(CDB101_REPORTING_IMPORT_TABLES.indexOf('canonical_migration_runs')).toBeLessThan(
      CDB101_REPORTING_IMPORT_TABLES.indexOf('canonical_processing_issues'),
    );
  });

  it('rejects widened import scope and unnecessarily long authorization lifetime', () => {
    const input = readyAuthorization();
    input.productionImport.allowedTables.push('canonical_feature_flags');
    input.expiresAtUtc = '2026-07-14T19:00:00.000Z';
    input.productionImport.commandId = buildCanonicalImportCommandId(input);
    input.migrations.commandId = buildMigrationCommandId(input);
    input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);

    const codes = validateReportingCutoverAuthorization(input, NOW).issues.map((issue) => issue.code);
    expect(codes).toContain('CDB101_PRODUCTION_IMPORT_SCOPE_INVALID');
    expect(codes).toContain('CDB101_AUTHORIZATION_EXPIRY_INVALID');
  });

  it('captures every four-digit pending migration before exact scope validation', () => {
    expect(parsePendingMigrationNames(`
      0123_legacy_pending.sql
      0505_canonical_program_foundation.sql
      0515_canonical_accounting_outbox.sql
      0123_legacy_pending.sql
    `)).toEqual([
      '0123_legacy_pending.sql',
      '0505_canonical_program_foundation.sql',
      '0515_canonical_accounting_outbox.sql',
    ]);
  });

  it('allows migration apply only when the remote pending set is exactly 0505 through 0515', () => {
    expect(validatePendingCanonicalMigrations([...CDB101_EXPECTED_MIGRATIONS])).toEqual([]);
    expect(validatePendingCanonicalMigrations(CDB101_EXPECTED_MIGRATIONS.slice(0, -1))).toContain(
      'CDB101_PENDING_MIGRATION_SCOPE_MISMATCH',
    );
    expect(validatePendingCanonicalMigrations([
      ...CDB101_EXPECTED_MIGRATIONS,
      '0434_unreviewed.sql',
    ])).toContain('CDB101_PENDING_MIGRATION_SCOPE_MISMATCH');
    expect(validatePendingCanonicalMigrations([...CDB101_EXPECTED_MIGRATIONS].reverse())).toContain(
      'CDB101_PENDING_MIGRATION_ORDER_MISMATCH',
    );
  });

  it('classifies all 49 FK violations and requires repair for active financial tables', () => {
    const result = classifyProductionForeignKeyViolations([
      { childTable: 'billing_deposits', parentTable: 'bills', violationCount: 4 },
      { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26 },
      { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15 },
      { childTable: 'income', parentTable: 'bills', violationCount: 4 },
    ]);

    expect(result.totalViolationCount).toBe(49);
    expect(result.groups.filter((group) => group.classification === 'active_financial_repair_required'))
      .toHaveLength(2);
    expect(result.groups.filter((group) => group.classification === 'archival_formal_waiver_candidate'))
      .toHaveLength(2);
    expect(result.unknownGroups).toEqual([]);

    const authorization = readyAuthorization();
    expect(validateObservedForeignKeyDisposition([
      { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26 },
      { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15 },
    ], authorization.foreignKeyDisposition.groups)).toEqual([]);
    expect(validateObservedForeignKeyDisposition([
      { childTable: 'billing_deposits', parentTable: 'bills', violationCount: 4 },
      { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26 },
      { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15 },
      { childTable: 'income', parentTable: 'bills', violationCount: 4 },
    ], authorization.foreignKeyDisposition.groups)).toContain('CDB101_OBSERVED_FOREIGN_KEY_COUNT_MISMATCH');
  });

  it('rejects production import bundles that contain DDL, PRAGMA, or legacy writes', () => {
    const allowed = validateCanonicalImportBundleSql(`
      INSERT INTO canonical_practitioners (tenant_id, public_id) VALUES ('100', 'cp_1');
      UPDATE canonical_encounters SET status = 'completed' WHERE tenant_id = '100' AND public_id = 'ce_1';
    `, ['canonical_practitioners', 'canonical_encounters']);
    expect(allowed.valid).toBe(true);

    const quotedLiterals = validateCanonicalImportBundleSql(
      "INSERT OR IGNORE INTO canonical_practitioners (tenant_id, public_id, display_name) VALUES ('100', 'cp_2', 'Dr. O''Brien (Lab, North)');",
      ['canonical_practitioners'],
    );
    expect(quotedLiterals).toMatchObject({ valid: true, statementCount: 1 });

    expect(validateCanonicalImportBundleSql(
      'DELETE FROM patients WHERE tenant_id = 100;',
      ['canonical_practitioners'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      'CREATE TABLE canonical_unreviewed(id INTEGER);',
      ['canonical_unreviewed'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      'PRAGMA foreign_keys=OFF;',
      ['canonical_practitioners'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      "INSERT INTO canonical_practitioners (tenant_id, public_id) SELECT tenant_id, id FROM patients WHERE tenant_id = '100';",
      ['canonical_practitioners'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      "INSERT INTO canonical_practitioners (tenant_id, public_id) VALUES ('101', 'cp_1');",
      ['canonical_practitioners'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      "UPDATE canonical_encounters SET status = 'completed' WHERE public_id = 'ce_1';",
      ['canonical_encounters'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      "UPDATE canonical_encounters SET tenant_id = '101' WHERE tenant_id = '100' AND public_id = 'ce_1';",
      ['canonical_encounters'],
    ).valid).toBe(false);
    expect(validateCanonicalImportBundleSql(
      "INSERT INTO canonical_practitioners (tenant_id, public_id) VALUES ('100', 'cp_1') ON CONFLICT(tenant_id, public_id) DO UPDATE SET tenant_id = '101';",
      ['canonical_practitioners'],
    ).valid).toBe(false);
  });

  it('builds a tenant-100 read-only importer second pass and verifies exact row counts', () => {
    const sql = buildCanonicalImportVerificationSql([
      'canonical_practitioners',
      'canonical_encounters',
    ]);
    expect(sql).toContain("FROM canonical_practitioners WHERE tenant_id = '100'");
    expect(sql).toContain("FROM canonical_encounters WHERE tenant_id = '100'");
    expect(sql).not.toContain('UNION ALL');
    expect(sql.match(/SELECT '/g)).toHaveLength(2);
    expect(sql.split(';').filter((statement) => statement.trim().length > 0)).toHaveLength(2);

    const output = JSON.stringify([
      {
        results: [{ table_name: 'canonical_practitioners', row_count: 1 }],
        meta: { changed_db: false, rows_written: 0 },
      },
      {
        results: [{ table_name: 'canonical_encounters', row_count: 2 }],
        meta: { changed_db: false, rows_written: 0 },
      },
    ]);
    expect(() => verifyCanonicalImportRowCounts(output, {
      canonical_practitioners: 1,
      canonical_encounters: 2,
    })).not.toThrow();
    expect(() => verifyCanonicalImportRowCounts(output, {
      canonical_practitioners: 1,
      canonical_encounters: 3,
    })).toThrow(/row count mismatch/i);
  });

  it('accepts feature-flag write evidence only when exactly one row changed', () => {
    expect(() => verifySingleReportingFlagWriteOutput(JSON.stringify([{
      results: [],
      meta: { changed_db: true, changes: 1, rows_written: 3 },
    }]))).not.toThrow();
    expect(() => verifySingleReportingFlagWriteOutput(JSON.stringify([{
      results: [],
      meta: { changed_db: true, changes: 2, rows_written: 3 },
    }]))).toThrow(/exactly one row/i);
    expect(() => verifySingleReportingFlagWriteOutput(JSON.stringify([{
      results: [],
      meta: { changed_db: true, changes: 1, rows_written: 0 },
    }]))).toThrow(/exactly one row/i);
  });

  it('emits an exact dual-run monitoring start receipt after shadow activation', () => {
    expect(buildReportingShadowActivationReceipt({
      commandId: 'cdb101-flag-123',
      activatedAtUtc: '2026-07-17T11:30:00.000Z',
    })).toEqual({
      allowed: true,
      commandId: 'cdb101-flag-123',
      tenantId: '100',
      mode: 'shadow',
      dualRunStartedAtUtc: '2026-07-17T11:30:00.000Z',
      legacyRoutesActive: true,
      canonicalShadowActive: true,
      canonicalReadsServingUsers: false,
      monitoringShouldStart: true,
      productionMutationPerformed: true,
    });

    expect(() => buildReportingShadowActivationReceipt({
      commandId: 'cdb101-flag-123',
      activatedAtUtc: 'not-a-timestamp',
    })).toThrow(/utc/i);
  });

  it('builds one tenant-scoped shadow upsert and never authorizes a global switch', () => {
    const sql = buildReportingShadowFlagSql({
      tenantId: '100',
      expectedPreviousState: 'absent_or_disabled',
      effectiveAtUtc: '2026-07-14T16:30:00.000Z',
      updatedBy: 'cdb101-authorized-operator',
    });

    expect(sql).toContain("tenant_id = '100'");
    expect(sql).toContain("'canonical_reporting_v1'");
    expect(sql).toContain("'reporting'");
    expect(sql).toContain("'shadow'");
    expect(sql).not.toContain('tenant_id IS NULL');
    expect(sql).not.toContain('UPDATE canonical_feature_flags SET');
    expect(sql).not.toContain("mode IN ('legacy'");
    expect(() => buildReportingShadowFlagSql({
      tenantId: '101',
      expectedPreviousState: 'absent_or_disabled',
      effectiveAtUtc: '2026-07-14T16:30:00.000Z',
      updatedBy: 'cdb101-authorized-operator',
    })).toThrow(/tenant 100/i);
  });

  it('measures rollback and reopen separately and fails on non-monotonic timestamps', () => {
    expect(measureRollbackAndReopenTiming({
      rollbackTriggeredAtUtc: '2026-07-14T16:10:00.000Z',
      rollbackCompletedAtUtc: '2026-07-14T16:10:45.000Z',
      reopenStartedAtUtc: '2026-07-14T16:10:45.000Z',
      writesReopenedAtUtc: '2026-07-14T16:11:30.000Z',
    })).toEqual({ rollbackDurationMs: 45_000, reopenDurationMs: 45_000 });

    expect(() => measureRollbackAndReopenTiming({
      rollbackTriggeredAtUtc: '2026-07-14T16:10:45.000Z',
      rollbackCompletedAtUtc: '2026-07-14T16:10:00.000Z',
      reopenStartedAtUtc: '2026-07-14T16:10:45.000Z',
      writesReopenedAtUtc: '2026-07-14T16:11:30.000Z',
    })).toThrow(/monotonic/i);
  });

  it('provides exactly one actionable resolution for each current blocker', () => {
    const plan = buildReportingCutoverResolutionPlan();
    expect(plan).toHaveLength(17);
    expect(new Set(plan.map((item) => item.blockerNumber)).size).toBe(17);
    expect(new Set(plan.map((item) => item.blockerCode)).size).toBe(17);
    expect(plan.every((item) => item.action.length > 20)).toBe(true);
    expect(plan.every((item) => item.requiredEvidence.length > 0)).toBe(true);
    expect(plan.filter((item) => item.requiresProductionMutation).map((item) => item.blockerNumber))
      .toEqual(expect.arrayContaining([2, 8, 10, 12, 17]));
  });

  it('requires the complete tenant-100 shadow smoke suite', () => {
    const input = readyAuthorization();
    input.smoke.requiredScenarios = input.smoke.requiredScenarios.slice(0, -1);
    expect(validateReportingCutoverAuthorization(input, NOW).issues.map((issue) => issue.code))
      .toContain('CDB101_SMOKE_PLAN_INCOMPLETE');
  });

  it('builds an aggregate-only operational plan without performing production mutation', () => {
    const input = readyAuthorization();
    const plan = buildReportingCutoverOperationsPlan(input, NOW);

    expect(plan.executionReady).toBe(true);
    expect(plan.productionMutationPerformed).toBe(false);
    expect(plan.aggregateOnly).toBe(true);
    expect(plan.commands.readOnly.migrationList).toEqual([
      'd1', 'migrations', 'list', 'DB', '--env', 'production', '--remote',
    ]);
    expect(plan.commands.guarded.migrationApply).toEqual([
      'tsx', 'scripts/canonical/apply-production-canonical-migrations.ts',
      '--authorization', '<authorization-v2.json>',
      '--fk-evidence', '<protected-fk-evidence.json>',
      '--maintenance-recovery-evidence', '<protected-maintenance-recovery-evidence.json>',
      '--worker-build-version-evidence', '<protected-worker-build-version-evidence.json>',
      '--execute',
    ]);
    expect(plan.resolutionPlan).toHaveLength(17);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain('ops-rollback-primary');
    expect(serialized).not.toContain('ops-observer-primary');
  });

  it('accepts pnpm argument separators for every guarded operational wrapper', () => {
    expect(parseProductionCanonicalMigrationArgs([
      '--',
      '--authorization', 'authorization.json',
      '--fk-evidence', 'fk-evidence.json',
      '--maintenance-recovery-evidence', 'maintenance-recovery.json',
      '--worker-build-version-evidence', 'worker-build-version.json',
      '--execute',
    ])).toEqual({
      authorizationPath: 'authorization.json',
      fkEvidencePath: 'fk-evidence.json',
      maintenanceRecoveryEvidencePath: 'maintenance-recovery.json',
      workerBuildVersionEvidencePath: 'worker-build-version.json',
      execute: true,
    });

    expect(parseProductionCanonicalImportArgs([
      '--',
      '--authorization', 'authorization.json',
      '--fk-evidence', 'fk-evidence.json',
      '--maintenance-recovery-evidence', 'maintenance-recovery.json',
      '--worker-build-version-evidence', 'worker-build-version.json',
      '--bundle', 'bundle.sql',
      '--manifest', 'manifest.json',
      '--source-export', 'export.sql',
      '--execute',
    ])).toEqual({
      authorizationPath: 'authorization.json',
      fkEvidencePath: 'fk-evidence.json',
      maintenanceRecoveryEvidencePath: 'maintenance-recovery.json',
      workerBuildVersionEvidencePath: 'worker-build-version.json',
      bundlePath: 'bundle.sql',
      manifestPath: 'manifest.json',
      sourceExportPath: 'export.sql',
      execute: true,
    });

    expect(parseProductionReportingFlagArgs([
      '--',
      '--authorization', 'authorization.json',
      '--fk-evidence', 'fk-evidence.json',
      '--maintenance-recovery-evidence', 'maintenance-recovery.json',
      '--worker-build-version-evidence', 'worker-build-version.json',
      '--processing-evidence', 'processing-evidence.json',
      '--effective-at-utc', '2026-07-14T16:30:00.000Z',
      '--updated-by', 'cdb101-authorized-operator',
      '--execute',
    ])).toEqual({
      authorizationPath: 'authorization.json',
      fkEvidencePath: 'fk-evidence.json',
      maintenanceRecoveryEvidencePath: 'maintenance-recovery.json',
      workerBuildVersionEvidencePath: 'worker-build-version.json',
      processingEvidencePath: 'processing-evidence.json',
      effectiveAtUtc: '2026-07-14T16:30:00.000Z',
      updatedBy: 'cdb101-authorized-operator',
      execute: true,
    });
  });

  it('keeps schema-v3 wrappers separately command-gated and shadow-only', () => {
    const authorization = readyTwoPersonAuthorization();

    const migration = prepareProductionCanonicalMigrationExecution({
      authorization,
      atUtc: NOW,
      pendingMigrations: [...CDB101_EXPECTED_MIGRATIONS],
      execute: false,
      confirmationToken: null,
    });
    expect(migration.issues).not.toContain('CDB101_AUTHORIZATION_INVALID');
    expect(migration.issues).toEqual(expect.arrayContaining([
      'CDB101_EXECUTE_SWITCH_MISSING',
      'CDB101_CONFIRMATION_TOKEN_MISMATCH',
    ]));

    const shadow = prepareProductionReportingFlagExecution({
      authorization,
      atUtc: NOW,
      currentState: 'absent',
      effectiveAtUtc: authorization.featureFlagPlan.effectiveAtUtc!,
      updatedBy: authorization.featureFlagPlan.updatedByPublicId!,
      execute: false,
      confirmationToken: null,
    });
    expect(shadow.issues).not.toContain('CDB101_AUTHORIZATION_INVALID');
    expect(shadow.issues).toContain('CDB101_FEATURE_FLAG_EFFECTIVE_TIME_NOT_REACHED');
    expect(shadow.command).toContain('--json');

    const atEffectiveTime = prepareProductionReportingFlagExecution({
      authorization,
      atUtc: authorization.featureFlagPlan.effectiveAtUtc!,
      currentState: 'absent',
      effectiveAtUtc: authorization.featureFlagPlan.effectiveAtUtc!,
      updatedBy: authorization.featureFlagPlan.updatedByPublicId!,
      execute: false,
      confirmationToken: null,
    });
    expect(atEffectiveTime.issues).not.toContain('CDB101_FEATURE_FLAG_EFFECTIVE_TIME_NOT_REACHED');

    if (authorization.schemaVersion !== 3) throw new Error('expected schema v3');
    authorization.twoPersonRiskAcceptance.evidenceSha256 = '6'.repeat(64);
    const staleApproval = prepareProductionCanonicalMigrationExecution({
      authorization,
      atUtc: NOW,
      pendingMigrations: [...CDB101_EXPECTED_MIGRATIONS],
      execute: false,
      confirmationToken: null,
    });
    expect(staleApproval.issues).toContain('CDB101_MIGRATION_COMMAND_ID_MISMATCH');
  });

  it('keeps all guarded mutation wrappers disabled by default', () => {
    const authorization = readyAuthorization();

    expect(prepareProductionCanonicalMigrationExecution({
      authorization,
      atUtc: NOW,
      pendingMigrations: [...CDB101_EXPECTED_MIGRATIONS],
      execute: false,
      confirmationToken: null,
    })).toMatchObject({
      allowed: false,
      issues: expect.arrayContaining([
        'CDB101_EXECUTE_SWITCH_MISSING',
        'CDB101_CONFIRMATION_TOKEN_MISMATCH',
      ]),
    });

    expect(prepareProductionCanonicalImportExecution({
      authorization,
      atUtc: NOW,
      bundlePath: '/protected/cdb101-import.sql',
      bundleSql: "INSERT INTO canonical_practitioners (tenant_id, public_id) VALUES ('100', 'cp_1');",
      actualBundleSha256: authorization.productionImport.bundleSha256 ?? '',
      actualManifestSha256: authorization.productionImport.manifestSha256 ?? '',
      actualSourceExportSha256: authorization.productionImport.sourceExportSha256 ?? '',
      execute: false,
      confirmationToken: null,
    })).toMatchObject({
      allowed: false,
      issues: expect.arrayContaining([
        'CDB101_EXECUTE_SWITCH_MISSING',
        'CDB101_CONFIRMATION_TOKEN_MISMATCH',
      ]),
    });

    expect(prepareProductionReportingFlagExecution({
      authorization,
      atUtc: NOW,
      currentState: 'absent',
      effectiveAtUtc: '2026-07-14T16:30:00.000Z',
      updatedBy: 'cdb101-authorized-operator',
      execute: false,
      confirmationToken: null,
    })).toMatchObject({
      allowed: false,
      issues: expect.arrayContaining([
        'CDB101_EXECUTE_SWITCH_MISSING',
        'CDB101_CONFIRMATION_TOKEN_MISMATCH',
      ]),
    });
  });
});

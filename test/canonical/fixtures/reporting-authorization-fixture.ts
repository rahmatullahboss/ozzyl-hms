import {
  CDB101_EXPECTED_MIGRATIONS,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_REPORTING_IMPORT_TABLES,
  CDB101_REQUIRED_SMOKE_SCENARIOS,
  buildCanonicalImportCommandId,
  buildFeatureFlagCommandId,
  buildMigrationCommandId,
  type ReportingCutoverAuthorization,
} from '../../../scripts/canonical/production-cutover-contract';

export const READY_AUTHORIZATION_AT_UTC = '2026-07-14T16:00:00.000Z';

export function createReadyReportingAuthorization(): ReportingCutoverAuthorization {
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
          childTable: 'billing_deposits', parentTable: 'bills', violationCount: 4,
          remainingViolationCount: 0, repairedViolationCount: 4, waivedViolationCount: 0,
          disposition: 'repair_required', ownerId: 'data-integrity-owner',
          evidenceId: 'fk-repair-billing-deposits-01', removalPhase: 'before_reporting_go',
        },
        {
          childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26,
          remainingViolationCount: 26, repairedViolationCount: 0, waivedViolationCount: 26,
          disposition: 'formal_waiver', ownerId: 'canonical-program-owner',
          evidenceId: 'fk-waiver-old-0391-bills-01', removalPhase: 'legacy_retirement_p11',
        },
        {
          childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15,
          remainingViolationCount: 15, repairedViolationCount: 0, waivedViolationCount: 15,
          disposition: 'formal_waiver', ownerId: 'canonical-program-owner',
          evidenceId: 'fk-waiver-old-0391-visits-01', removalPhase: 'legacy_retirement_p11',
        },
        {
          childTable: 'income', parentTable: 'bills', violationCount: 4,
          remainingViolationCount: 0, repairedViolationCount: 4, waivedViolationCount: 0,
          disposition: 'repair_required', ownerId: 'data-integrity-owner',
          evidenceId: 'fk-repair-income-01', removalPhase: 'before_reporting_go',
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

export function createReadyTwoPersonReportingAuthorization(): ReportingCutoverAuthorization {
  const strict = createReadyReportingAuthorization();
  const input: ReportingCutoverAuthorization = {
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
  };

  input.migrations.commandId = buildMigrationCommandId(input);
  input.productionImport.commandId = buildCanonicalImportCommandId(input);
  input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);
  return input;
}

export function createReadySingleOperatorReportingAuthorization(): ReportingCutoverAuthorization {
  const strict = createReadyReportingAuthorization();
  const input = {
    ...strict,
    schemaVersion: 4,
    ownerModel: 'single_operator_risk_accepted',
    rollbackOwner: {
      assigned: true,
      ownerId: 'rahmatullah-zisan',
      backupOwnerId: null,
      acknowledgedAtUtc: '2026-07-14T15:45:00.000Z',
      communicationChannelId: 'single-operator-cdb101-rahmatullah-zisan',
      decisionAuthority: 'may_initiate_rollback',
    },
    observationOwner: {
      assigned: true,
      ownerId: 'rahmatullah-zisan',
      backupOwnerId: null,
      acknowledgedAtUtc: '2026-07-14T15:45:00.000Z',
      communicationChannelId: 'single-operator-cdb101-rahmatullah-zisan',
      decisionAuthority: 'may_accept_or_reject_go',
    },
    singleOperatorRiskAcceptance: {
      accepted: true,
      acceptedByOwnerId: 'rahmatullah-zisan',
      acceptedAtUtc: '2026-07-14T15:45:00.000Z',
      evidenceId: 'cdb101-single-operator-risk-20260718-01',
      evidenceSha256: '6'.repeat(64),
      dualRoleAccepted: true,
      independentObservationWaived: true,
      noTechnicalBackupAccepted: true,
      noMonitoringBackupAccepted: true,
      automaticAbortOnOperatorUnavailable: true,
      shadowOnlyAccepted: true,
      canonicalPromotionProhibited: true,
      workerTrafficChangeProhibited: true,
      postActivationReconciliationRequired: true,
    },
  } as unknown as ReportingCutoverAuthorization;

  input.migrations.commandId = buildMigrationCommandId(input);
  input.productionImport.commandId = buildCanonicalImportCommandId(input);
  input.featureFlagPlan.commandId = buildFeatureFlagCommandId(input);
  return input;
}

import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../../scripts/canonical/production-cutover-contract';
import type { ReportingMaintenanceRecoveryEvidence } from '../../../scripts/canonical/reporting-maintenance-recovery-evidence';

export const MAINTENANCE_RECOVERY_EVIDENCE_NOW = '2026-07-14T16:00:00.000Z';

export function createReadyReportingMaintenanceRecoveryEvidence(): ReportingMaintenanceRecoveryEvidence {
  return {
    schemaVersion: 1,
    authorizationSchemaVersion: 2,
    ownerModel: 'four_person_strict',
    twoPersonRiskAcceptanceEvidence: null,
    evidenceId: 'cdb101-maintenance-recovery-20260714-01',
    generatedAtUtc: '2026-07-14T15:55:00.000Z',
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    domain: 'reporting',
    cutoverTenantId: '100',
    authorizationIssuedAtUtc: '2026-07-14T15:30:00.000Z',
    authorizationApproval: {
      approved: true,
      ownerId: 'canonical-program-owner',
      approvedAtUtc: '2026-07-14T15:35:00.000Z',
      evidenceId: 'owner-approval-cdb101-20260714-01',
      evidenceSha256: '1'.repeat(64),
    },
    maintenanceWindow: {
      approved: true,
      windowId: 'cdb101-reporting-window-20260714-01',
      startUtc: '2026-07-14T16:00:00.000Z',
      endUtc: '2026-07-14T18:00:00.000Z',
      observationGracePeriodMs: 30 * 60_000,
      expiresAtUtc: '2026-07-14T18:30:00.000Z',
      approvalOwnerId: 'canonical-program-owner',
      approvedAtUtc: '2026-07-14T15:36:00.000Z',
      evidenceId: 'maintenance-window-approval-20260714-01',
      evidenceSha256: '2'.repeat(64),
    },
    owners: {
      rollback: {
        assigned: true,
        primaryOwnerId: 'ops-rollback-primary',
        backupOwnerId: 'ops-rollback-backup',
        primaryAcknowledgedAtUtc: '2026-07-14T15:40:00.000Z',
        backupAcknowledgedAtUtc: '2026-07-14T15:41:00.000Z',
        communicationChannelId: 'incident-channel-cdb101',
        decisionAuthority: 'may_initiate_rollback',
        evidenceId: 'rollback-owner-ack-20260714-01',
        evidenceSha256: '3'.repeat(64),
      },
      observation: {
        assigned: true,
        primaryOwnerId: 'ops-observer-primary',
        backupOwnerId: 'ops-observer-backup',
        primaryAcknowledgedAtUtc: '2026-07-14T15:42:00.000Z',
        backupAcknowledgedAtUtc: '2026-07-14T15:43:00.000Z',
        communicationChannelId: 'incident-channel-cdb101',
        decisionAuthority: 'may_accept_or_reject_go',
        evidenceId: 'observation-owner-ack-20260714-01',
        evidenceSha256: '4'.repeat(64),
      },
    },
    rollbackPolicy: {
      reviewed: true,
      planId: 'reporting-rollback-plan-v2',
      reviewerOwnerId: 'canonical-program-owner',
      reviewedAtUtc: '2026-07-14T15:44:00.000Z',
      maxRollbackDurationMs: 60_000,
      maxReopenDurationMs: 120_000,
      observationGracePeriodMs: 30 * 60_000,
      evidenceId: 'rollback-policy-evidence-20260714-01',
      evidenceSha256: '5'.repeat(64),
    },
    recovery: {
      export: {
        captured: true,
        capturedAtUtc: '2026-07-14T15:45:00.000Z',
        sourceDatabaseName: CDB101_PRODUCTION_DATABASE_NAME,
        sourceDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
        scope: 'production_database_full_snapshot',
        exportSha256: '6'.repeat(64),
        exportSizeBytes: 123456,
        metadataEvidenceId: 'export-metadata-20260714-01',
        metadataEvidenceSha256: '7'.repeat(64),
        directoryMode: '700',
        fileMode: '600',
      },
      timeTravel: {
        captured: true,
        capturedAtUtc: '2026-07-14T15:46:00.000Z',
        sourceDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
        bookmarkId: '0000001e-00000000-000050a8-202607141600',
        evidenceId: 'time-travel-bookmark-evidence-20260714-01',
        evidenceSha256: '8'.repeat(64),
      },
    },
  };
}

export function createReadyTwoPersonReportingMaintenanceRecoveryEvidence(): ReportingMaintenanceRecoveryEvidence {
  const input = createReadyReportingMaintenanceRecoveryEvidence();
  input.authorizationSchemaVersion = 3;
  input.ownerModel = 'two_person_constrained';
  input.twoPersonRiskAcceptanceEvidence = {
    evidenceId: 'cdb101-two-person-risk-20260714-01',
    evidenceSha256: '9'.repeat(64),
  };
  input.owners.rollback = {
    assigned: true,
    primaryOwnerId: 'rahmatullah-zisan',
    backupOwnerId: null,
    primaryAcknowledgedAtUtc: '2026-07-14T15:40:00.000Z',
    backupAcknowledgedAtUtc: null,
    communicationChannelId: 'hms-cdb101-cutover-20260717',
    decisionAuthority: 'may_initiate_rollback',
    evidenceId: 'rollback-owner-ack-20260714-01',
    evidenceSha256: '3'.repeat(64),
  };
  input.owners.observation = {
    assigned: true,
    primaryOwnerId: 'staff-monitoring-owner',
    backupOwnerId: null,
    primaryAcknowledgedAtUtc: '2026-07-14T15:42:00.000Z',
    backupAcknowledgedAtUtc: null,
    communicationChannelId: 'hms-cdb101-cutover-20260717',
    decisionAuthority: 'may_accept_or_reject_go',
    evidenceId: 'observation-owner-ack-20260714-01',
    evidenceSha256: '4'.repeat(64),
  };
  return input;
}

export function createReadySingleOperatorReportingMaintenanceRecoveryEvidence(): ReportingMaintenanceRecoveryEvidence {
  const input = createReadyReportingMaintenanceRecoveryEvidence();
  input.authorizationSchemaVersion = 4;
  input.ownerModel = 'single_operator_risk_accepted';
  input.twoPersonRiskAcceptanceEvidence = null;
  input.singleOperatorRiskAcceptanceEvidence = {
    evidenceId: 'cdb101-single-operator-risk-20260718-01',
    evidenceSha256: 'a'.repeat(64),
  };
  input.owners.rollback = {
    assigned: true,
    primaryOwnerId: 'rahmatullah-zisan',
    backupOwnerId: null,
    primaryAcknowledgedAtUtc: '2026-07-14T15:40:00.000Z',
    backupAcknowledgedAtUtc: null,
    communicationChannelId: 'hms-cdb101-cutover-20260718',
    decisionAuthority: 'may_initiate_rollback',
    evidenceId: 'rollback-owner-ack-20260718-01',
    evidenceSha256: '3'.repeat(64),
  };
  input.owners.observation = {
    assigned: true,
    primaryOwnerId: 'rahmatullah-zisan',
    backupOwnerId: null,
    primaryAcknowledgedAtUtc: '2026-07-14T15:42:00.000Z',
    backupAcknowledgedAtUtc: null,
    communicationChannelId: 'hms-cdb101-cutover-20260718',
    decisionAuthority: 'may_accept_or_reject_go',
    evidenceId: 'observation-owner-ack-20260718-01',
    evidenceSha256: '4'.repeat(64),
  };
  return input;
}

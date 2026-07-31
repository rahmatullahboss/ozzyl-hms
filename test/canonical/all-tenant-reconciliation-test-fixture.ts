import { execFileSync } from 'node:child_process';
import {
  buildAllTenantReconciliationConfirmationTokens,
  buildAllTenantReconciliationRepositoryBinding,
  type AllTenantReconciliationAuthorization,
} from '../../scripts/canonical/all-tenant-reconciliation-authorization';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_BRANCH,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
  buildAllTenantReconciliationPackage,
} from '../../scripts/canonical/all-tenant-reconciliation-package';

export function reconciliationHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

export function reconciliationPackage() {
  const commit = reconciliationHead();
  return buildAllTenantReconciliationPackage(process.cwd(), {
    branch: CDB_V1_070C_BRANCH,
    preparationCommit: commit,
    buildSha: commit,
  });
}

export function reconciliationAuthorization(): AllTenantReconciliationAuthorization {
  const packageValue = reconciliationPackage();
  const commit = reconciliationHead();
  const authorization: AllTenantReconciliationAuthorization = {
    schemaVersion: 1,
    authorizationId: 'cdb-v1-070c-reconciliation-fixture',
    operation: 'all_tenant_schema_ledger_archival_fk_reconciliation',
    target: {
      platform: 'cloudflare_d1',
      databaseName: 'hms-super-admin-production-apac',
      databaseUuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      environment: 'production',
      remote: true,
    },
    timing: {
      issuedAtUtc: '2026-07-31T00:00:00.000Z',
      windowStartUtc: '2026-07-31T00:15:00.000Z',
      windowEndUtc: '2026-07-31T01:45:00.000Z',
      expiresAtUtc: '2026-07-31T02:00:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization',
      ownerModel: 'single_operator_risk_accepted',
      executionOwnerId: 'rahmatullah-zisan',
      rollbackOwnerId: 'rahmatullah-zisan',
      evidenceCustodianId: 'rahmatullah-zisan',
      riskAcceptanceEvidenceId: 'risk-cdb-v1-070c-fixture',
      riskAcceptanceEvidenceSha256: '3'.repeat(64),
      automaticAbortOnOperatorUnavailable: true,
    },
    repository: buildAllTenantReconciliationRepositoryBinding(
      process.cwd(),
      packageValue,
      commit,
      commit,
      'gate-a-preparation-receipt-fixture',
      '1'.repeat(64),
      'gate-b-preparation-receipt-fixture',
      '2'.repeat(64),
    ),
    scope: {
      tenantIds: ['1', '100', '101', '102'],
      phiReadAllowed: false,
      rowLevelPatientReadAllowed: false,
    },
    reconciliation: {
      expectedPendingMigrationCountBefore: 29,
      expectedPendingMigrationCountAfter: 25,
      expectedLedgerRowsWritten: 4,
      atomic: true,
      entries: CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((migration, index) => ({
        ...migration,
        schemaEvidenceId: `schema-evidence-${index + 1}`,
        schemaEvidenceSha256: '4567'[index].repeat(64),
        ledgerEvidenceId: `ledger-evidence-${index + 1}`,
        ledgerEvidenceSha256: '89ab'[index].repeat(64),
        ledgerEntryInitiallyAbsent: true,
        postSchemaExact: true,
        maximumLedgerRowsWritten: 1,
      })),
    },
    foreignKeyDisposition: {
      evidenceId: 'archival-fk-disposition-fixture',
      evidenceSha256: 'c'.repeat(64),
      rawArchivalViolationCount: 41,
      formallyWaivedViolationCount: 41,
      effectiveUnwaivedViolationCount: 0,
      activeViolationCount: 0,
      unknownViolationCount: 0,
      groups: CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((group) => ({ ...group })),
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: 'legacy_retirement_p11',
      archivalTableMutationAllowed: false,
      archivalTableDeletionAllowed: false,
    },
    evidenceOutput: {
      receiptId: 'reconciliation-receipt-fixture',
      protectedDirectoryEvidenceId: 'reconciliation-protected-directory-fixture',
      retentionDays: 30,
    },
    procedure: {
      verifyCandidateAndPackage: true,
      captureFreshAggregateSchemaEvidence: true,
      captureFreshMigrationLedgerEvidence: true,
      stopIfAnyLedgerEntryExists: true,
      verifyExactPostSchemaBeforeWrite: true,
      reconcileExactlyFourLedgerRowsAtomically: true,
      executeNoMigrationSqlOrDdl: true,
      writeNoBusinessRows: true,
      refreshProtectedArchivalFkDispositionEvidence: true,
      verifyZeroActiveAndUnknownFkViolations: true,
      preserveRawArchivalRows: true,
      preserveLegacyAuthority: true,
      verifyTrafficUnchanged: true,
      stopOnFirstFailure: true,
    },
    permissions: {
      productionRead: true,
      migrationLedgerReconciliation: true,
      archivalFkDispositionEvidenceRefresh: true,
      migrationSqlExecution: false,
      productionDdl: false,
      businessTableWrite: false,
      productionBackfill: false,
      providerFlagChange: false,
      workerVersionUpload: false,
      deployment: false,
      trafficChange: false,
      routeChange: false,
      canonicalReadPromotion: false,
      canonicalWritePromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      archivalTableMutation: false,
      archivalTableDeletion: false,
      destructiveAction: false,
      remoteDatabaseDeletion: false,
      push: false,
      cdbToMainIntegration: false,
    },
    confirmation: {
      readToken: '',
      ledgerReconciliationToken: '',
      archivalDispositionToken: '',
      abortToken: '',
    },
  };
  authorization.confirmation = buildAllTenantReconciliationConfirmationTokens(authorization);
  return authorization;
}

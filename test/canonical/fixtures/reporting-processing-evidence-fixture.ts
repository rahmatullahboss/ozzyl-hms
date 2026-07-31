import {
  CDB101_PROCESSING_CHECK_IDS,
  type ReportingProcessingEvidence,
} from '../../../scripts/canonical/reporting-processing-evidence';
import type { ReportingCutoverAuthorization } from '../../../scripts/canonical/production-cutover-contract';
import { createReadyReportingAuthorization } from './reporting-authorization-fixture';

export const PROCESSING_EVIDENCE_NOW = '2026-07-14T16:25:00.000Z';

const CHECK_COMPLETED_AT_UTC = [
  '2026-07-14T16:17:00.000Z',
  '2026-07-14T16:18:00.000Z',
  '2026-07-14T16:19:00.000Z',
  '2026-07-14T16:20:00.000Z',
  '2026-07-14T16:21:00.000Z',
  '2026-07-14T16:22:00.000Z',
  '2026-07-14T16:23:00.000Z',
] as const;

export function createReadyReportingProcessingEvidence(
  authorization: ReportingCutoverAuthorization = createReadyReportingAuthorization(),
): ReportingProcessingEvidence {
  return {
    schemaVersion: 1,
    authorizationId: authorization.authorizationId,
    evidenceId: 'cdb101-processing-evidence-20260715-01',
    generatedAtUtc: '2026-07-14T16:24:00.000Z',
    scope: {
      productionDatabaseId: authorization.productionDatabase.id,
      tenantId: '100',
      domain: 'reporting',
      stage: 'post_import_pre_shadow',
      migrationCommandId: authorization.migrations.commandId,
      importCommandId: authorization.productionImport.commandId,
      featureFlagCommandId: authorization.featureFlagPlan.commandId,
      featureFlagEffectiveAtUtc: authorization.featureFlagPlan.effectiveAtUtc,
      authorizationExpiresAtUtc: authorization.expiresAtUtc,
      deterministicRunId: authorization.productionImport.deterministicRunId,
      bundleSha256: authorization.productionImport.bundleSha256,
      manifestSha256: authorization.productionImport.manifestSha256,
      sourceExportSha256: authorization.productionImport.sourceExportSha256,
      allowedTables: [...authorization.productionImport.allowedTables],
      migrationsCompletedAtUtc: '2026-07-14T16:02:00.000Z',
      importCompletedAtUtc: '2026-07-14T16:10:00.000Z',
      secondPassCompletedAtUtc: '2026-07-14T16:15:00.000Z',
      observationStartedAtUtc: '2026-07-14T16:16:00.000Z',
      observationEndedAtUtc: '2026-07-14T16:24:00.000Z',
    },
    observedTableNames: [...authorization.productionImport.allowedTables],
    checks: CDB101_PROCESSING_CHECK_IDS.map((checkId, index) => ({
      checkId,
      observedCount: 0,
      completedAtUtc: CHECK_COMPLETED_AT_UTC[index],
      evidenceId: `cdb101-processing-${checkId}-01`,
      evidenceSha256: String(index + 1).repeat(64),
    })),
    readOnlyProof: {
      queryCount: 14,
      allQueriesReadOnly: true,
      changedDbTrueCount: 0,
      rowsWritten: 0,
      writeStatementCount: 0,
      mutationCount: 0,
      evidenceId: 'cdb101-processing-read-only-01',
      evidenceSha256: '8'.repeat(64),
    },
  };
}

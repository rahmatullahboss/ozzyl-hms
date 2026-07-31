import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateProtectedCloneRehearsalResult } from '../../scripts/canonical/check-protected-clone-rehearsal-result';

const result = JSON.parse(readFileSync(
  'docs/database/cdb-v1-050-protected-clone-rehearsal-result.json',
  'utf8',
));
const audit = readFileSync(
  'docs/database/audits/2026-07-30-protected-clone-rehearsal-execution.md',
  'utf8',
);

describe('CDB-V1-050 protected-clone rehearsal result', () => {
  it('passes the executable aggregate result governance checker', () => {
    expect(evaluateProtectedCloneRehearsalResult(result)).toEqual([]);
  });

  it('records the exact aggregate acceptance result', () => {
    expect(result.checkpoint).toBe(
      'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-VERIFIED',
    );
    expect(result.status).toBe('passed_local_sqlite_d1_equivalent_protected_clone');
    expect(result.executionBinding.repositoryCommit).toBe(
      '6ae413f077dc66a9007a9b2f4f3974b67b5d4a10',
    );
    expect(result.scope).toEqual({
      tenantCount: 1,
      recordCount: 24,
      providerCount: 9,
      consumerCount: 12,
      sourceTableCount: 9,
    });
    expect(result.migration).toEqual({
      startingLedgerCount: 497,
      authorizedMigrationCount: 19,
      appliedMigrationCount: 19,
      endingLedgerCount: 516,
    });
    expect(result.backfill.secondPassNewBusinessRows).toBe(0);
    expect(result.shadowComparison.passedCount).toBe(24);
    expect(result.shadowComparison.varianceCount).toBe(0);
    expect(result.shadowComparison.providerErrorCount).toBe(0);
    expect(result.smokeAndRollback.smokeWorkflowCount).toBe(4);
    expect(result.smokeAndRollback.finalProvider).toBe('legacy');
    expect(result.smokeAndRollback.legacyDisabledProviderFlagCount).toBe(9);
    expect(result.integrity).toMatchObject({
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
      sourceSnapshotUnchanged: true,
      rollbackBackupUnchanged: true,
      targetDistinctFromSource: true,
    });
    expect(result.recoveryEvidence).toMatchObject({
      failClosedAttemptCount: 3,
      successfulExactRestoreCount: 3,
      restoredLedgerCount: 497,
      restoredIntegrityCheck: 'ok',
      restoredForeignKeyViolations: 0,
    });
    expect(result.verification).toEqual({
      focusedTestFileCount: 13,
      focusedTestCount: 67,
      rootTypeScriptPassed: true,
      migrationManifestCount: 504,
      canonicalGovernancePassed: true,
      governedTableCount: 260,
      repositoryAccessWriterCount: 1034,
      repositoryAccessReaderCount: 2725,
      identityEpisodeReaderPairCount: 859,
      identityEpisodePathCount: 297,
      identityEpisodeTableCount: 63,
      identityEpisodeUnknownAssignments: 0,
    });
  });

  it('keeps all production and release actions false and routes to CDB-V1-060 preparation', () => {
    expect(result.safety).toEqual({
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      productionProviderActivationPerformed: false,
      deploymentPerformed: false,
      trafficChanged: false,
      localSyncActivated: false,
      legacyRetirementPerformed: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    });
    expect(result.nextCheckpoint).toBe(
      'CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-PREPARATION',
    );
  });

  it('keeps protected paths and row identifiers out of Git evidence', () => {
    const resultText = JSON.stringify(result);
    for (const forbidden of [
      '.hms-canonical-rehearsals',
      'source-snapshot.sqlite3',
      'target-clone.sqlite3',
      'rollback-backup.sqlite3',
      '/Users/rahmatullahzisan/.hms-canonical-rehearsals',
    ]) {
      expect(resultText).not.toContain(forbidden);
      expect(audit).not.toContain(forbidden);
    }
    expect(audit).toContain('Protected authorization documents, database files, row identifiers and detailed logs remain outside Git');
  });
});

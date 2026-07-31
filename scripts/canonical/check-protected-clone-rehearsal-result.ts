import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RESULT_PATH = 'docs/database/cdb-v1-050-protected-clone-rehearsal-result.json';
const CHECKPOINT = 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-VERIFIED';
const NEXT_CHECKPOINT = 'CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-PREPARATION';
const EXECUTION_BINDING = '6ae413f077dc66a9007a9b2f4f3974b67b5d4a10';

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactNumber(
  issues: string[],
  value: unknown,
  expected: number,
  label: string,
): void {
  if (value !== expected) issues.push(`${label} must equal ${expected}`);
}

function exactBoolean(
  issues: string[],
  value: unknown,
  expected: boolean,
  label: string,
): void {
  if (value !== expected) issues.push(`${label} must equal ${expected}`);
}

function sha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function evaluateProtectedCloneRehearsalResult(value: unknown): string[] {
  const issues: string[] = [];
  const root = record(value);
  if (!root) return ['result must be one JSON object'];

  if (root.schemaVersion !== 1) issues.push('schemaVersion must equal 1');
  if (root.checkpoint !== CHECKPOINT) issues.push('checkpoint is invalid');
  if (root.status !== 'passed_local_sqlite_d1_equivalent_protected_clone') issues.push('status is invalid');
  if (root.nextCheckpoint !== NEXT_CHECKPOINT) issues.push('next checkpoint is invalid');

  const binding = record(root.executionBinding);
  if (!binding) issues.push('execution binding is missing');
  else {
    if (binding.branch !== 'program/cdb-main-continuous-20260725') issues.push('execution branch is invalid');
    if (binding.repositoryCommit !== EXECUTION_BINDING) issues.push('execution commit is invalid');
    for (const key of [
      'authorizationSha256',
      'sourceSnapshotSha256',
      'rollbackBackupSha256',
      'targetCloneSha256',
      'executionEvidenceSha256',
    ]) {
      if (!sha256(binding[key])) issues.push(`${key} must be one lowercase SHA-256`);
    }
    if (binding.sourceSnapshotSha256 !== binding.rollbackBackupSha256) {
      issues.push('source and rollback backup hashes must match at rehearsal start');
    }
    if (binding.targetCloneSha256 === binding.sourceSnapshotSha256) {
      issues.push('mutated target hash must differ from immutable source hash');
    }
  }

  const scope = record(root.scope);
  if (!scope) issues.push('scope is missing');
  else {
    exactNumber(issues, scope.tenantCount, 1, 'tenant count');
    exactNumber(issues, scope.recordCount, 24, 'record count');
    exactNumber(issues, scope.providerCount, 9, 'provider count');
    exactNumber(issues, scope.consumerCount, 12, 'consumer count');
    exactNumber(issues, scope.sourceTableCount, 9, 'source table count');
  }

  const migration = record(root.migration);
  if (!migration) issues.push('migration result is missing');
  else {
    exactNumber(issues, migration.startingLedgerCount, 497, 'starting migration ledger count');
    exactNumber(issues, migration.authorizedMigrationCount, 19, 'authorized migration count');
    exactNumber(issues, migration.appliedMigrationCount, 19, 'applied migration count');
    exactNumber(issues, migration.endingLedgerCount, 516, 'ending migration ledger count');
  }

  const backfill = record(root.backfill);
  if (!backfill) issues.push('backfill result is missing');
  else {
    exactNumber(issues, backfill.authorizedBackfillCount, 4, 'authorized backfill count');
    exactNumber(issues, backfill.executedBackfillCount, 4, 'executed backfill count');
    exactNumber(issues, backfill.passedReconciliationCount, 4, 'passed backfill reconciliation count');
    exactNumber(issues, backfill.secondPassNewBusinessRows, 0, 'second-pass new business rows');
  }

  const shadow = record(root.shadowComparison);
  if (!shadow) issues.push('shadow result is missing');
  else {
    exactNumber(issues, shadow.recordCount, 24, 'shadow record count');
    exactNumber(issues, shadow.passedCount, 24, 'shadow passed count');
    for (const [key, label] of [
      ['varianceCount', 'shadow variance count'],
      ['providerErrorCount', 'provider error count'],
      ['mappingAmbiguityCount', 'mapping ambiguity count'],
      ['crossTenantReferenceCount', 'cross-tenant reference count'],
      ['latencyBudgetBreachCount', 'latency budget breach count'],
    ] as const) exactNumber(issues, shadow[key], 0, label);
  }

  const smoke = record(root.smokeAndRollback);
  if (!smoke) issues.push('smoke and rollback result is missing');
  else {
    exactNumber(issues, smoke.smokeWorkflowCount, 4, 'smoke workflow count');
    for (const key of ['receptionPassed', 'billingPassed', 'paymentPassed', 'commissionPassed']) {
      exactBoolean(issues, smoke[key], true, key);
    }
    exactNumber(issues, smoke.promotedProviderCount, 9, 'promoted provider count');
    if (smoke.finalProvider !== 'legacy') issues.push('final provider must be legacy');
    exactNumber(issues, smoke.legacyDisabledProviderFlagCount, 9, 'legacy disabled provider flag count');
  }

  const integrity = record(root.integrity);
  if (!integrity) issues.push('integrity result is missing');
  else {
    if (integrity.integrityCheck !== 'ok') issues.push('integrity check must be ok');
    exactNumber(issues, integrity.foreignKeyViolations, 0, 'foreign-key violation count');
    exactBoolean(issues, integrity.sourceSnapshotUnchanged, true, 'source snapshot unchanged');
    exactBoolean(issues, integrity.rollbackBackupUnchanged, true, 'rollback backup unchanged');
    exactBoolean(issues, integrity.targetDistinctFromSource, true, 'target distinct from source');
  }

  const recovery = record(root.recoveryEvidence);
  if (!recovery) issues.push('recovery evidence is missing');
  else {
    exactNumber(issues, recovery.failClosedAttemptCount, 3, 'fail-closed attempt count');
    exactNumber(issues, recovery.successfulExactRestoreCount, 3, 'successful exact restore count');
    exactNumber(issues, recovery.restoredLedgerCount, 497, 'restored ledger count');
    if (recovery.restoredIntegrityCheck !== 'ok') issues.push('restored integrity check must be ok');
    exactNumber(issues, recovery.restoredForeignKeyViolations, 0, 'restored foreign-key violation count');
  }

  const safety = record(root.safety);
  if (!safety) issues.push('safety result is missing');
  else {
    exactBoolean(issues, safety.aggregateOnly, true, 'aggregate-only evidence');
    for (const key of [
      'networkRequestPerformed',
      'productionReadPerformed',
      'productionMutationPerformed',
      'productionProviderActivationPerformed',
      'deploymentPerformed',
      'trafficChanged',
      'localSyncActivated',
      'legacyRetirementPerformed',
      'pushPerformed',
      'cdbToMainIntegrationPerformed',
    ]) exactBoolean(issues, safety[key], false, key);
  }

  const verification = record(root.verification);
  if (!verification) issues.push('verification evidence is missing');
  else {
    exactNumber(issues, verification.focusedTestFileCount, 13, 'focused test file count');
    exactNumber(issues, verification.focusedTestCount, 67, 'focused test count');
    exactBoolean(issues, verification.rootTypeScriptPassed, true, 'root TypeScript passed');
    exactNumber(issues, verification.migrationManifestCount, 504, 'migration manifest count');
    exactBoolean(issues, verification.canonicalGovernancePassed, true, 'Canonical governance passed');
    exactNumber(issues, verification.governedTableCount, 260, 'governed table count');
    exactNumber(issues, verification.repositoryAccessWriterCount, 1034, 'repository access writer count');
    exactNumber(issues, verification.repositoryAccessReaderCount, 2725, 'repository access reader count');
    exactNumber(issues, verification.identityEpisodeReaderPairCount, 859, 'identity/episode reader pair count');
    exactNumber(issues, verification.identityEpisodePathCount, 297, 'identity/episode path count');
    exactNumber(issues, verification.identityEpisodeTableCount, 63, 'identity/episode table count');
    exactNumber(issues, verification.identityEpisodeUnknownAssignments, 0, 'identity/episode unknown assignment count');
  }

  const serialized = JSON.stringify(root);
  for (const forbidden of [
    '.hms-canonical-rehearsals',
    'source-snapshot.sqlite3',
    'rollback-backup.sqlite3',
    'target-clone.sqlite3',
  ]) {
    if (serialized.includes(forbidden)) issues.push(`protected evidence contains forbidden value: ${forbidden}`);
  }
  return issues;
}

function main(): void {
  const root = resolve(process.argv[2] ?? process.cwd());
  const result = JSON.parse(readFileSync(resolve(root, RESULT_PATH), 'utf8')) as unknown;
  const issues = evaluateProtectedCloneRehearsalResult(result);
  const source = record(result) ?? {};
  const migration = record(source.migration) ?? {};
  const shadow = record(source.shadowComparison) ?? {};
  const smoke = record(source.smokeAndRollback) ?? {};
  const integrity = record(source.integrity) ?? {};
  process.stdout.write(`${JSON.stringify({
    checkpoint: source.checkpoint ?? null,
    resultReady: issues.length === 0,
    issueCount: issues.length,
    issues,
    endingMigrationLedgerCount: migration.endingLedgerCount ?? null,
    appliedMigrationCount: migration.appliedMigrationCount ?? null,
    shadowPassedCount: shadow.passedCount ?? null,
    finalProvider: smoke.finalProvider ?? null,
    integrityCheck: integrity.integrityCheck ?? null,
    foreignKeyViolations: integrity.foreignKeyViolations ?? null,
    productionMutationPerformed: false,
  }, null, 2)}\n`);
  if (issues.length > 0) process.exitCode = 1;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

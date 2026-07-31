import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  loadProtectedCloneRehearsalAuthorization,
  type ProtectedCloneRehearsalAuthorization,
  type ProtectedCloneRehearsalAuthorizationResult,
} from './protected-clone-rehearsal-authorization';

export interface ProtectedCloneRehearsalExecutionInput {
  authorizationPath: string;
  repositoryRoot: string;
  sourceSnapshotPath: string;
  rollbackBackupPath: string;
  targetClonePath: string;
  detailedEvidencePath: string;
  nowUtc: string;
}

export interface ProtectedCloneRehearsalExecutionContext extends ProtectedCloneRehearsalExecutionInput {
  authorization: ProtectedCloneRehearsalAuthorization;
}

export interface ProtectedCloneMigrationExecutionEvidence {
  appliedMigrationCount: number;
}

export interface ProtectedCloneBackfillExecutionEvidence {
  backfillCount: number;
  secondPassNewBusinessRows: number;
}

export interface ProtectedCloneShadowExecutionEvidence {
  recordCount: number;
  varianceCount: number;
  providerErrorCount: number;
}

export interface ProtectedCloneSmokeExecutionEvidence {
  reception: boolean;
  billing: boolean;
  payment: boolean;
  commission: boolean;
}

export interface ProtectedCloneProviderRollbackEvidence {
  promotedProviderCount: number;
  finalProvider: 'legacy' | 'canonical';
}

export interface ProtectedCloneHealthEvidence {
  integrity: string;
  foreignKeyViolations: number;
}

export interface ProtectedCloneRehearsalExecutionDependencies {
  loadAuthorization(
    authorizationPath: string,
    repositoryRoot: string,
    nowUtc: string,
  ): ProtectedCloneRehearsalAuthorizationResult;
  applyMigrations(
    context: ProtectedCloneRehearsalExecutionContext,
  ): Promise<ProtectedCloneMigrationExecutionEvidence>;
  runBackfills(
    context: ProtectedCloneRehearsalExecutionContext,
  ): Promise<ProtectedCloneBackfillExecutionEvidence>;
  runShadowComparison(
    context: ProtectedCloneRehearsalExecutionContext,
  ): Promise<ProtectedCloneShadowExecutionEvidence>;
  runSmokeWorkflows(
    context: ProtectedCloneRehearsalExecutionContext,
  ): Promise<ProtectedCloneSmokeExecutionEvidence>;
  rehearseProviderPromotionRollback(
    context: ProtectedCloneRehearsalExecutionContext,
  ): Promise<ProtectedCloneProviderRollbackEvidence>;
  verifyCloneHealth(
    context: ProtectedCloneRehearsalExecutionContext,
  ): Promise<ProtectedCloneHealthEvidence>;
}

export interface ProtectedCloneRehearsalExecutionReceipt {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL';
  status: 'passed';
  authorizationId: string;
  targetPlatform: 'local_sqlite_d1_equivalent';
  tenantCount: number;
  recordCount: number;
  appliedMigrationCount: number;
  backfillCount: number;
  secondPassNewBusinessRows: 0;
  shadowRecordCount: number;
  varianceCount: 0;
  providerErrorCount: 0;
  smokeWorkflowCount: 4;
  promotedProviderCount: number;
  finalProvider: 'legacy';
  integrity: 'ok';
  foreignKeyViolations: 0;
  sourceSnapshotUnchanged: true;
  aggregateOnly: true;
  networkRequestPerformed: false;
  protectedCloneMutationPerformed: true;
  productionReadPerformed: false;
  productionMutationPerformed: false;
  deploymentPerformed: false;
  trafficChanged: false;
  pushPerformed: false;
  cdbToMainIntegrationPerformed: false;
}

const DEFAULT_DEPENDENCIES: Pick<ProtectedCloneRehearsalExecutionDependencies, 'loadAuthorization'> = {
  loadAuthorization: loadProtectedCloneRehearsalAuthorization,
};

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertProtectedRegularFile(path: string, label: string): void {
  const link = lstatSync(path);
  if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) {
    throw new Error(`${label} must be one protected regular file`);
  }
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) throw new Error(`${label} must use mode 0600`);
}

function assertDistinctPaths(input: ProtectedCloneRehearsalExecutionInput): void {
  const paths = [
    input.sourceSnapshotPath,
    input.rollbackBackupPath,
    input.targetClonePath,
    input.detailedEvidencePath,
  ].map((path) => resolve(path));
  if (new Set(paths).size !== paths.length) {
    throw new Error('source, backup, target and evidence paths must be distinct');
  }
}

function restoreTarget(input: ProtectedCloneRehearsalExecutionInput): void {
  copyFileSync(input.rollbackBackupPath, input.targetClonePath);
  chmodSync(input.targetClonePath, 0o600);
}

function writeAggregateEvidence(
  path: string,
  receipt: ProtectedCloneRehearsalExecutionReceipt,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function requireZero(value: number, label: string): asserts value is 0 {
  if (value !== 0) throw new Error(`${label} must be zero`);
}

async function requireHealthyClone(
  context: ProtectedCloneRehearsalExecutionContext,
  dependencies: ProtectedCloneRehearsalExecutionDependencies,
): Promise<ProtectedCloneHealthEvidence> {
  const health = await dependencies.verifyCloneHealth(context);
  if (health.integrity !== 'ok') throw new Error('protected clone integrity check failed');
  requireZero(health.foreignKeyViolations, 'protected clone foreign-key violations');
  return health;
}

export async function executeProtectedCloneRehearsal(
  rawInput: ProtectedCloneRehearsalExecutionInput,
  dependencies: ProtectedCloneRehearsalExecutionDependencies,
): Promise<ProtectedCloneRehearsalExecutionReceipt> {
  const input: ProtectedCloneRehearsalExecutionInput = {
    authorizationPath: resolve(rawInput.authorizationPath),
    repositoryRoot: resolve(rawInput.repositoryRoot),
    sourceSnapshotPath: resolve(rawInput.sourceSnapshotPath),
    rollbackBackupPath: resolve(rawInput.rollbackBackupPath),
    targetClonePath: resolve(rawInput.targetClonePath),
    detailedEvidencePath: resolve(rawInput.detailedEvidencePath),
    nowUtc: rawInput.nowUtc,
  };
  assertDistinctPaths(input);

  const authorizationResult = (dependencies.loadAuthorization ?? DEFAULT_DEPENDENCIES.loadAuthorization)(
    input.authorizationPath,
    input.repositoryRoot,
    input.nowUtc,
  );
  if (!authorizationResult.executionReady || !authorizationResult.authorization) {
    throw new Error('CDB-V1-050 authorization is not execution-ready');
  }
  const authorization = authorizationResult.authorization;
  if (authorization.target.platform !== 'local_sqlite_d1_equivalent'
    || authorization.target.remote !== false) {
    throw new Error('CDB-V1-050 local executor accepts only a local SQLite/D1-equivalent protected clone');
  }

  assertProtectedRegularFile(input.sourceSnapshotPath, 'source snapshot');
  assertProtectedRegularFile(input.rollbackBackupPath, 'rollback backup');
  const sourceHashBefore = sha256File(input.sourceSnapshotPath);
  if (sourceHashBefore !== authorization.sourceSnapshot.sha256) {
    throw new Error('protected source snapshot hash does not match authorization');
  }
  if (sha256File(input.rollbackBackupPath) !== authorization.rollback.backupSha256) {
    throw new Error('protected rollback backup hash does not match authorization');
  }

  copyFileSync(input.sourceSnapshotPath, input.targetClonePath);
  chmodSync(input.targetClonePath, 0o600);
  const context: ProtectedCloneRehearsalExecutionContext = { ...input, authorization };

  try {
    await requireHealthyClone(context, dependencies);
    const migrations = await dependencies.applyMigrations(context);
    if (migrations.appliedMigrationCount !== authorization.migrations.length) {
      throw new Error('applied migration count does not match authorization');
    }
    await requireHealthyClone(context, dependencies);

    const backfills = await dependencies.runBackfills(context);
    if (backfills.backfillCount !== authorization.backfills.length) {
      throw new Error('backfill count does not match authorization');
    }
    requireZero(backfills.secondPassNewBusinessRows, 'second-pass new business rows');
    await requireHealthyClone(context, dependencies);

    const shadow = await dependencies.runShadowComparison(context);
    if (shadow.recordCount !== authorization.scope.records.length) {
      throw new Error('shadow comparison record count does not match authorization');
    }
    requireZero(shadow.varianceCount, 'shadow comparison variance count');
    requireZero(shadow.providerErrorCount, 'shadow comparison provider error count');
    await requireHealthyClone(context, dependencies);

    const smoke = await dependencies.runSmokeWorkflows(context);
    if (!smoke.reception || !smoke.billing || !smoke.payment || !smoke.commission) {
      throw new Error('all four protected-core smoke workflows must pass');
    }

    const provider = await dependencies.rehearseProviderPromotionRollback(context);
    if (provider.finalProvider !== 'legacy') {
      throw new Error('protected clone provider rehearsal did not finish on legacy');
    }
    const health = await requireHealthyClone(context, dependencies);

    if (sha256File(input.sourceSnapshotPath) !== sourceHashBefore) {
      throw new Error('protected source snapshot changed during rehearsal');
    }

    const receipt: ProtectedCloneRehearsalExecutionReceipt = {
      schemaVersion: 1,
      checkpoint: 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL',
      status: 'passed',
      authorizationId: authorization.authorizationId,
      targetPlatform: 'local_sqlite_d1_equivalent',
      tenantCount: authorization.scope.tenantIds.length,
      recordCount: authorization.scope.records.length,
      appliedMigrationCount: migrations.appliedMigrationCount,
      backfillCount: backfills.backfillCount,
      secondPassNewBusinessRows: 0,
      shadowRecordCount: shadow.recordCount,
      varianceCount: 0,
      providerErrorCount: 0,
      smokeWorkflowCount: 4,
      promotedProviderCount: provider.promotedProviderCount,
      finalProvider: 'legacy',
      integrity: health.integrity as 'ok',
      foreignKeyViolations: 0,
      sourceSnapshotUnchanged: true,
      aggregateOnly: true,
      networkRequestPerformed: false,
      protectedCloneMutationPerformed: true,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      deploymentPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    };
    writeAggregateEvidence(input.detailedEvidencePath, receipt);
    return receipt;
  } catch (error) {
    restoreTarget(input);
    throw error;
  }
}

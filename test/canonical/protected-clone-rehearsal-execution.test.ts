import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  executeProtectedCloneRehearsal,
  type ProtectedCloneRehearsalExecutionDependencies,
  type ProtectedCloneRehearsalExecutionInput,
} from '../../scripts/canonical/protected-clone-rehearsal-execution';
import type {
  ProtectedCloneRehearsalAuthorization,
  ProtectedCloneRehearsalAuthorizationResult,
} from '../../scripts/canonical/protected-clone-rehearsal-authorization';

const roots: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function workspace(): {
  root: string;
  input: ProtectedCloneRehearsalExecutionInput;
  source: string;
  backup: string;
  target: string;
  evidence: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-050-execution-'));
  roots.push(root);
  chmodSync(root, 0o700);
  const source = join(root, 'source.sqlite3');
  const backup = join(root, 'backup.sqlite3');
  const target = join(root, 'target.sqlite3');
  const evidence = join(root, 'evidence.json');
  writeFileSync(source, 'source-snapshot');
  writeFileSync(backup, 'rollback-backup');
  chmodSync(source, 0o600);
  chmodSync(backup, 0o600);
  return {
    root,
    source,
    backup,
    target,
    evidence,
    input: {
      authorizationPath: join(root, 'authorization.json'),
      repositoryRoot: process.cwd(),
      sourceSnapshotPath: source,
      rollbackBackupPath: backup,
      targetClonePath: target,
      detailedEvidencePath: evidence,
      nowUtc: '2026-07-29T21:45:00.000Z',
    },
  };
}

function authorization(source: string, backup: string): ProtectedCloneRehearsalAuthorization {
  return {
    schemaVersion: 1,
    authorizationId: 'auth_cdb_v1_050_local_test',
    operation: 'protected_clone_migration_backfill_and_rollback_rehearsal',
    target: {
      platform: 'local_sqlite_d1_equivalent',
      accountIdSha256: sha256('local-account'),
      databaseName: 'cdb-v1-050-local-protected-clone',
      databaseUuid: 'local-cdb-v1-050-test-clone',
      environment: 'protected_clone',
      remote: false,
      productionDatabaseUuid: 'production-database-id',
    },
    timing: {
      issuedAtUtc: '2026-07-29T21:44:00.000Z',
      windowStartUtc: '2026-07-29T21:44:00.000Z',
      windowEndUtc: '2026-07-29T22:44:00.000Z',
      expiresAtUtc: '2026-07-29T23:00:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_protected_clone_rehearsal_authorization',
      executionOwnerId: 'canonical-core-v1-agent',
      rollbackOwnerId: 'canonical-core-v1-agent',
      observationOwnerId: 'canonical-core-v1-agent',
    },
    sourceSnapshot: {
      identity: 'protected-source-snapshot',
      sha256: sha256(readFileSync(source)),
      exportedAtUtc: '2026-07-29T21:40:00.000Z',
      readOnly: true,
      productionSourceMutationAllowed: false,
    },
    rollback: {
      backupIdentity: 'protected-rollback-backup',
      backupSha256: sha256(readFileSync(backup)),
      restoreAuthorityConfirmed: true,
      restoreOnAnyFailure: true,
      stopOnFirstFailure: true,
      rollbackProvider: 'legacy',
    },
    repository: {
      branch: 'program/cdb-main-continuous-20260725',
      repositoryCommit: 'a'.repeat(40),
      buildSha: 'a'.repeat(40),
      packagePath: 'docs/database/cdb-v1-040c-protected-clone-comparison-package.json',
      packageSha256: 'b'.repeat(64),
      migrationManifestPath: 'src/data/schema-migrations.generated.ts',
      migrationManifestSha256: 'c'.repeat(64),
      migrationCount: 504,
    },
    scope: {
      tenantIds: ['100'],
      maxRecords: 1,
      records: [{
        tenantId: '100',
        providerKey: 'canonical_patient_identity_provider_v1',
        consumerId: 'cdb040c.reception-patient-context.patient',
        sourceTable: 'patients',
        sourceRowKey: 'patients:1',
      }],
    },
    migrations: [{ name: '0551_workforce_roster_integrity.sql', sha256: 'd'.repeat(64) }],
    backfills: [{
      path: 'scripts/canonical/backfill-tenant-patient-links.ts',
      sha256: 'e'.repeat(64),
      partitionLimit: 100,
    }],
    acceptance: {
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
      criticalUnexplainedVarianceCount: 0,
      providerErrorCount: 0,
      mappingAmbiguityCount: 0,
      crossTenantReferenceCount: 0,
      latencyBudgetBreachCount: 0,
      secondPassNewBusinessRows: 0,
      sourceSnapshotMutationCount: 0,
    },
    procedure: {
      serialMigrations: true,
      boundedBackfills: true,
      secondPassRequired: true,
      sourceReadOnlyVerification: true,
      receptionSmoke: true,
      billingSmoke: true,
      paymentSmoke: true,
      commissionSmoke: true,
      providerPromotionRehearsal: true,
      immediateLegacyRollback: true,
      noConcurrentDeployment: true,
    },
    permissions: {
      protectedCloneRead: true,
      protectedCloneSchemaMigration: true,
      protectedCloneBackfill: true,
      providerPromotionRehearsal: true,
      rollbackRehearsal: true,
      productionRead: false,
      productionMutation: false,
      productionProviderActivation: false,
      deployment: false,
      trafficChange: false,
      localSyncActivation: false,
      legacyRetirement: false,
      remoteDatabaseDeletion: false,
      push: false,
      cdbToMainIntegration: false,
    },
  };
}

function result(value: ProtectedCloneRehearsalAuthorization, ready = true): ProtectedCloneRehearsalAuthorizationResult {
  return {
    documentReady: ready,
    executionReady: ready,
    issues: ready ? [] : [{ code: 'CDBV1050_AUTHORIZATION_BINDING_INVALID', gate: 'binding' }],
    authorization: ready ? value : null,
  };
}

function dependencies(
  auth: ProtectedCloneRehearsalAuthorization,
  overrides: Partial<ProtectedCloneRehearsalExecutionDependencies> = {},
): ProtectedCloneRehearsalExecutionDependencies {
  return {
    loadAuthorization: () => result(auth),
    applyMigrations: async () => ({ appliedMigrationCount: auth.migrations.length }),
    runBackfills: async () => ({ backfillCount: auth.backfills.length, secondPassNewBusinessRows: 0 }),
    runShadowComparison: async () => ({ recordCount: auth.scope.records.length, varianceCount: 0, providerErrorCount: 0 }),
    runSmokeWorkflows: async () => ({ reception: true, billing: true, payment: true, commission: true }),
    rehearseProviderPromotionRollback: async () => ({ promotedProviderCount: 9, finalProvider: 'legacy' }),
    verifyCloneHealth: async () => ({ integrity: 'ok', foreignKeyViolations: 0 }),
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-050 protected-clone rehearsal execution', () => {
  it('performs zero target mutation when exact authorization is not execution-ready', async () => {
    const setup = workspace();
    const auth = authorization(setup.source, setup.backup);
    let phaseCalls = 0;
    const deps = dependencies(auth, {
      loadAuthorization: () => result(auth, false),
      applyMigrations: async () => { phaseCalls += 1; return { appliedMigrationCount: 0 }; },
    });

    await expect(executeProtectedCloneRehearsal(setup.input, deps)).rejects.toThrow(
      'CDB-V1-050 authorization is not execution-ready',
    );
    expect(phaseCalls).toBe(0);
    expect(() => readFileSync(setup.target)).toThrow();
  });

  it('executes phases serially and finishes on the legacy provider', async () => {
    const setup = workspace();
    const auth = authorization(setup.source, setup.backup);
    const order: string[] = [];
    const deps = dependencies(auth, {
      applyMigrations: async () => { order.push('migrations'); return { appliedMigrationCount: 1 }; },
      runBackfills: async () => { order.push('backfills'); return { backfillCount: 1, secondPassNewBusinessRows: 0 }; },
      runShadowComparison: async () => { order.push('shadow'); return { recordCount: 1, varianceCount: 0, providerErrorCount: 0 }; },
      runSmokeWorkflows: async () => { order.push('smoke'); return { reception: true, billing: true, payment: true, commission: true }; },
      rehearseProviderPromotionRollback: async () => { order.push('rollback'); return { promotedProviderCount: 9, finalProvider: 'legacy' }; },
    });

    const receipt = await executeProtectedCloneRehearsal(setup.input, deps);

    expect(order).toEqual(['migrations', 'backfills', 'shadow', 'smoke', 'rollback']);
    expect(receipt.status).toBe('passed');
    expect(receipt.finalProvider).toBe('legacy');
    expect(receipt.productionMutationPerformed).toBe(false);
    expect(readFileSync(setup.target, 'utf8')).toBe('source-snapshot');
    expect(JSON.parse(readFileSync(setup.evidence, 'utf8')).status).toBe('passed');
  });

  it('restores the exact rollback backup when any phase fails', async () => {
    const setup = workspace();
    const auth = authorization(setup.source, setup.backup);
    const deps = dependencies(auth, {
      applyMigrations: async ({ targetClonePath }) => {
        writeFileSync(targetClonePath, 'partially-mutated-clone');
        throw new Error('migration failed');
      },
    });

    await expect(executeProtectedCloneRehearsal(setup.input, deps)).rejects.toThrow('migration failed');
    expect(readFileSync(setup.target, 'utf8')).toBe('rollback-backup');
  });

  it('aborts and restores when the protected source snapshot changes during execution', async () => {
    const setup = workspace();
    const auth = authorization(setup.source, setup.backup);
    const deps = dependencies(auth, {
      runSmokeWorkflows: async () => {
        writeFileSync(setup.source, 'changed-source-snapshot');
        return { reception: true, billing: true, payment: true, commission: true };
      },
    });

    await expect(executeProtectedCloneRehearsal(setup.input, deps)).rejects.toThrow(
      'protected source snapshot changed during rehearsal',
    );
    expect(readFileSync(setup.target, 'utf8')).toBe('rollback-backup');
  });

  it('writes aggregate-only evidence without protected paths or source contents', async () => {
    const setup = workspace();
    const auth = authorization(setup.source, setup.backup);

    await executeProtectedCloneRehearsal(setup.input, dependencies(auth));

    const evidence = readFileSync(setup.evidence, 'utf8');
    expect(evidence).not.toContain(setup.root);
    expect(evidence).not.toContain('source-snapshot');
    expect(evidence).not.toContain('rollback-backup');
    expect(evidence).not.toContain('authorization.json');
    expect(evidence).toContain('"aggregateOnly": true');
  });
});

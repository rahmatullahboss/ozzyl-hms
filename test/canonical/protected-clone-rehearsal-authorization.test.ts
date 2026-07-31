import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProtectedCloneRepositoryBinding,
  buildProtectedCloneRehearsalPlan,
  CDB_V1_050_BRANCH,
  evaluateProtectedCloneRehearsalAuthorization,
  loadProtectedCloneRehearsalAuthorization,
  parseProtectedCloneRehearsalAuthorizationJson,
  type ProtectedCloneRehearsalAuthorization,
} from '../../scripts/canonical/protected-clone-rehearsal-authorization';
import { CDB101_PRODUCTION_DATABASE_ID } from '../../scripts/canonical/production-cutover-contract';

const temporaryRoots: string[] = [];
const NOW_UTC = '2026-07-29T20:50:00.000Z';
const CURRENT_BRANCH = execFileSync('git', ['branch', '--show-current'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();
const ON_AUTHORIZATION_BRANCH = CURRENT_BRANCH === CDB_V1_050_BRANCH;
const EXPECTED_BINDING_ISSUES = ON_AUTHORIZATION_BRANCH
  ? []
  : [{ code: 'CDBV1050_AUTHORIZATION_BINDING_INVALID' as const, gate: 'binding' as const }];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(resolve(process.cwd(), path))).digest('hex');
}

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-050-auth-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

function readyAuthorization(): ProtectedCloneRehearsalAuthorization {
  return {
    schemaVersion: 1,
    authorizationId: 'cdb-v1-050-protected-clone-20260730-01',
    operation: 'protected_clone_migration_backfill_and_rollback_rehearsal',
    target: {
      platform: 'local_sqlite_d1_equivalent',
      accountIdSha256: 'a'.repeat(64),
      databaseName: 'cdb-v1-050-protected-clone',
      databaseUuid: 'protected-clone-20260730-01',
      environment: 'protected_clone',
      remote: false,
      productionDatabaseUuid: CDB101_PRODUCTION_DATABASE_ID,
    },
    timing: {
      issuedAtUtc: '2026-07-29T20:30:00.000Z',
      windowStartUtc: '2026-07-29T20:45:00.000Z',
      windowEndUtc: '2026-07-29T22:45:00.000Z',
      expiresAtUtc: '2026-07-29T23:15:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_protected_clone_rehearsal_authorization',
      executionOwnerId: 'rahmatullah-zisan',
      rollbackOwnerId: 'rahmatullah-zisan',
      observationOwnerId: 'rahmatullah-zisan',
    },
    sourceSnapshot: {
      identity: 'protected-source-snapshot-20260730-01',
      sha256: 'b'.repeat(64),
      exportedAtUtc: '2026-07-29T20:15:00.000Z',
      readOnly: true,
      productionSourceMutationAllowed: false,
    },
    rollback: {
      backupIdentity: 'protected-clone-backup-20260730-01',
      backupSha256: 'c'.repeat(64),
      restoreAuthorityConfirmed: true,
      restoreOnAnyFailure: true,
      stopOnFirstFailure: true,
      rollbackProvider: 'legacy',
    },
    repository: buildProtectedCloneRepositoryBinding(process.cwd()),
    scope: {
      tenantIds: ['100'],
      maxRecords: 12,
      records: [
        {
          tenantId: '100',
          providerKey: 'canonical_invoice_provider_v1',
          consumerId: 'cdb040b.billing-detail',
          sourceTable: 'bills',
          sourceRowKey: 'bill:1',
        },
        {
          tenantId: '100',
          providerKey: 'canonical_patient_identity_provider_v1',
          consumerId: 'cdb040c.reception-patient-context.patient',
          sourceTable: 'patients',
          sourceRowKey: 'patient:1',
        },
        {
          tenantId: '100',
          providerKey: 'canonical_compensation_accrual_provider_v1',
          consumerId: 'cdb040c.commission-accrual-admin',
          sourceTable: 'doctor_commission_accruals',
          sourceRowKey: 'accrual:1',
        },
      ],
    },
    migrations: [
      {
        name: '0544_canonical_tenant_patient_links.sql',
        sha256: sha256('migrations/0544_canonical_tenant_patient_links.sql'),
      },
    ],
    backfills: [
      {
        path: 'scripts/canonical/backfill-tenant-patient-links.ts',
        sha256: sha256('scripts/canonical/backfill-tenant-patient-links.ts'),
        partitionLimit: 100,
      },
    ],
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

function writeProtected(
  value: unknown,
  options: { rootMode?: number; fileMode?: number } = {},
): { root: string; path: string } {
  const root = protectedRoot();
  chmodSync(root, options.rootMode ?? 0o700);
  const path = join(root, 'authorization.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), {
    mode: options.fileMode ?? 0o600,
  });
  chmodSync(path, options.fileMode ?? 0o600);
  return { root, path };
}

function codes(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((entry) => entry.code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('CDB-V1-050 protected-clone rehearsal authorization', () => {
  it('binds the current branch, commit, package and 504-entry migration manifest', () => {
    const binding = buildProtectedCloneRepositoryBinding(process.cwd());
    expect(binding).toMatchObject({
      branch: CURRENT_BRANCH,
      buildSha: binding.repositoryCommit,
      packagePath: 'docs/database/cdb-v1-040c-protected-clone-comparison-package.json',
      migrationManifestPath: 'src/data/schema-migrations.generated.ts',
      migrationCount: 504,
    });
    expect(binding.repositoryCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(binding.packageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(binding.migrationManifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts one exact protected-clone envelope and builds a non-executing aggregate plan', () => {
    const authorization = readyAuthorization();
    const result = parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(authorization),
      process.cwd(),
      NOW_UTC,
    );
    expect(result).toEqual({
      documentReady: true,
      executionReady: ON_AUTHORIZATION_BRANCH,
      issues: EXPECTED_BINDING_ISSUES,
      authorization,
    });
    if (ON_AUTHORIZATION_BRANCH) {
      expect(buildProtectedCloneRehearsalPlan(result)).toMatchObject({
        checkpoint: 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL',
        tenantCount: 1,
        recordCount: 3,
        migrationCount: 1,
        backfillCount: 1,
        finalProvider: 'legacy',
        networkRequestPerformed: false,
        protectedCloneMutationPerformed: false,
        productionReadPerformed: false,
        productionMutationPerformed: false,
      });
    } else {
      expect(() => buildProtectedCloneRehearsalPlan(result)).toThrow(
        'CDB-V1-050 authorization is not execution-ready',
      );
    }
  });

  it('rejects generic approval and every permission broader than protected-clone rehearsal', () => {
    const generic = readyAuthorization() as ProtectedCloneRehearsalAuthorization & {
      owner: ProtectedCloneRehearsalAuthorization['owner'] & { approvalSource: string };
    };
    generic.owner.approvalSource = 'generic_continue';
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(generic), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_OWNER_INVALID');

    const broad = readyAuthorization();
    broad.permissions.productionRead = true;
    broad.permissions.deployment = true;
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(broad), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_PERMISSION_INVALID');
  });

  it('rejects production target reuse, writable source snapshot and missing rollback evidence', () => {
    const target = readyAuthorization();
    target.target.databaseUuid = CDB101_PRODUCTION_DATABASE_ID;
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(target), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_TARGET_INVALID');

    const invalidPlatform = readyAuthorization() as ProtectedCloneRehearsalAuthorization & {
      target: ProtectedCloneRehearsalAuthorization['target'] & { platform: string };
    };
    invalidPlatform.target.platform = 'other_database';
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(invalidPlatform), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_SCHEMA_INVALID');

    const source = readyAuthorization() as ProtectedCloneRehearsalAuthorization & {
      sourceSnapshot: ProtectedCloneRehearsalAuthorization['sourceSnapshot'] & { readOnly: boolean };
    };
    source.sourceSnapshot.readOnly = false;
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(source), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_BINDING_INVALID');

    const futureSnapshot = readyAuthorization();
    futureSnapshot.sourceSnapshot.exportedAtUtc = '2026-07-29T20:31:00.000Z';
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(futureSnapshot), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_BINDING_INVALID');

    const rollback = readyAuthorization();
    rollback.rollback.backupSha256 = 'invalid';
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(rollback), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_ROLLBACK_INVALID');
  });

  it('rejects stale repository, migration and backfill bindings and invalid scope', () => {
    const repository = readyAuthorization();
    repository.repository.packageSha256 = '0'.repeat(64);
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(repository), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_BINDING_INVALID');

    const migration = readyAuthorization();
    migration.migrations[0].sha256 = '1'.repeat(64);
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(migration), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_MIGRATION_INVALID');

    const backfill = readyAuthorization();
    backfill.backfills[0].sha256 = '2'.repeat(64);
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(backfill), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_BACKFILL_INVALID');

    const scope = readyAuthorization();
    scope.scope.records.push({ ...scope.scope.records[0] });
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(scope), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_SCOPE_INVALID');

    const crossTenant = readyAuthorization();
    crossTenant.scope.records[0].tenantId = '999';
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(crossTenant), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_SCOPE_INVALID');

    const mismatchedTuple = readyAuthorization();
    mismatchedTuple.scope.records[0].sourceTable = 'payments';
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(mismatchedTuple), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_SCOPE_INVALID');
  });

  it('rejects invalid or expired timing, unknown fields, sensitive fields and duplicate keys', () => {
    const expired = readyAuthorization();
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(expired), process.cwd(), '2026-07-29T23:16:00.000Z',
    ))).toContain('CDBV1050_AUTHORIZATION_EXPIRED');

    const unknown = { ...readyAuthorization(), unexpected: true };
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(unknown), process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_UNKNOWN_FIELD');

    const sensitive = { ...readyAuthorization(), token: '[REDACTED_SECRET]' };
    const sensitiveResult = parseProtectedCloneRehearsalAuthorizationJson(
      JSON.stringify(sensitive), process.cwd(), NOW_UTC,
    );
    expect(codes(sensitiveResult)).toContain('CDBV1050_AUTHORIZATION_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('[REDACTED_SECRET]');

    const duplicate = JSON.stringify(readyAuthorization()).replace(
      '"authorizationId":"cdb-v1-050-protected-clone-20260730-01"',
      '"authorizationId":"first","authorizationId":"second"',
    );
    expect(codes(parseProtectedCloneRehearsalAuthorizationJson(
      duplicate, process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_DUPLICATE_KEY');
  });

  it('loads only a protected regular file outside the repository', () => {
    const valid = writeProtected(readyAuthorization());
    const validResult = loadProtectedCloneRehearsalAuthorization(
      valid.path, process.cwd(), NOW_UTC,
    );
    expect(validResult.executionReady).toBe(ON_AUTHORIZATION_BRANCH);
    expect(validResult.issues).toEqual(EXPECTED_BINDING_ISSUES);

    const unsafeFile = writeProtected(readyAuthorization(), { fileMode: 0o644 });
    expect(codes(loadProtectedCloneRehearsalAuthorization(
      unsafeFile.path, process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const unsafeDirectory = writeProtected(readyAuthorization(), { rootMode: 0o755 });
    expect(codes(loadProtectedCloneRehearsalAuthorization(
      unsafeDirectory.path, process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const repositoryPath = resolve(process.cwd(), 'docs/database/cdb-v1-040c-protected-clone-comparison-package.json');
    expect(codes(loadProtectedCloneRehearsalAuthorization(
      repositoryPath, process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_FILE_INSIDE_REPOSITORY');
  });

  it('rejects links and emits an aggregate-only offline receipt', () => {
    const fixture = writeProtected(readyAuthorization());
    const symlinkPath = join(fixture.root, 'linked.json');
    symlinkSync(fixture.path, symlinkPath);
    expect(codes(loadProtectedCloneRehearsalAuthorization(
      symlinkPath, process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const hardLinkPath = join(fixture.root, 'hard-linked.json');
    linkSync(fixture.path, hardLinkPath);
    expect(codes(loadProtectedCloneRehearsalAuthorization(
      hardLinkPath, process.cwd(), NOW_UTC,
    ))).toContain('CDBV1050_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const receiptFixture = writeProtected(readyAuthorization());
    expect(evaluateProtectedCloneRehearsalAuthorization(
      receiptFixture.path, process.cwd(), NOW_UTC,
    )).toEqual({
      schemaVersion: 1,
      documentReady: true,
      executionReady: ON_AUTHORIZATION_BRANCH,
      issueCount: EXPECTED_BINDING_ISSUES.length,
      tenantCount: 1,
      recordCount: 3,
      migrationCount: 1,
      backfillCount: 1,
      aggregateOnly: true,
      networkRequestPerformed: false,
      protectedCloneMutationPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
  });
});

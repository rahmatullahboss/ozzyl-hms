import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAllTenantShadowAuthorizationPlan,
  buildAllTenantShadowAuthorizationRepositoryBinding,
  buildAllTenantShadowConfirmationTokens,
  loadAllTenantShadowExecutionAuthorization,
  parseAllTenantShadowExecutionAuthorizationJson,
  type AllTenantShadowExecutionAuthorization,
} from '../../scripts/canonical/all-tenant-shadow-execution-authorization';
import {
  CDB_V1_070A_ACTIVE_TENANT_IDS,
  buildAllTenantShadowExecutionPackage,
} from '../../scripts/canonical/all-tenant-shadow-execution-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const roots: string[] = [];
const NOW_UTC = '2026-07-30T05:50:00.000Z';

function repositoryHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function repositoryPackage() {
  const head = repositoryHead();
  return buildAllTenantShadowExecutionPackage(process.cwd(), {
    branch: 'program/cdb-main-continuous-20260725',
    preparationCommit: head,
    buildSha: head,
  });
}

function readyAuthorization(): AllTenantShadowExecutionAuthorization {
  const packageDocument = repositoryPackage();
  const candidateCommit = repositoryHead();
  const repository = buildAllTenantShadowAuthorizationRepositoryBinding(
    process.cwd(),
    packageDocument,
    candidateCommit,
    candidateCommit,
  );
  const authorization: AllTenantShadowExecutionAuthorization = {
    schemaVersion: 1,
    authorizationId: 'cdb-v1-070-all-tenant-shadow-20260730-01',
    operation: 'all_tenant_legacy_primary_shadow_execution',
    target: {
      platform: 'cloudflare_d1',
      databaseName: CDB101_PRODUCTION_DATABASE_NAME,
      databaseUuid: CDB101_PRODUCTION_DATABASE_ID,
      environment: 'production',
      remote: true,
    },
    timing: {
      issuedAtUtc: '2026-07-30T05:30:00.000Z',
      windowStartUtc: '2026-07-30T05:45:00.000Z',
      windowEndUtc: '2026-07-30T07:45:00.000Z',
      expiresAtUtc: '2026-07-30T08:00:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_all_tenant_legacy_primary_shadow_authorization',
      ownerModel: 'single_operator_risk_accepted',
      executionOwnerId: 'rahmatullah-zisan',
      rollbackOwnerId: 'rahmatullah-zisan',
      observationOwnerId: 'rahmatullah-zisan',
      riskAcceptanceEvidenceId: 'risk-cdb-v1-070-20260730-01',
      riskAcceptanceEvidenceSha256: 'a'.repeat(64),
      noTechnicalBackupAccepted: true,
      noMonitoringBackupAccepted: true,
      automaticAbortOnOperatorUnavailable: true,
    },
    activeTenantEvidence: {
      evidenceId: 'active-tenants-20260730-01',
      evidenceSha256: 'b'.repeat(64),
      capturedAtUtc: '2026-07-30T05:25:00.000Z',
      allActiveTenants: true,
      tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
    },
    repository,
    deployment: {
      authorized: true,
      workerVersionId: 'worker-candidate-20260730-01',
      previousWorkerVersionId: '4f5d8f93-92d4-4fda-8fba-c0a2863f1b71',
      buildManifestSha256: 'c'.repeat(64),
      routeFingerprintSha256: 'd'.repeat(64),
      legacyDefaultVerified: true,
      previousWorkerRetained: true,
    },
    productionSnapshot: {
      bookmarkId: 'bookmark-20260730-01',
      sha256: 'e'.repeat(64),
      capturedAtUtc: '2026-07-30T05:35:00.000Z',
    },
    backupExport: {
      evidenceId: 'backup-export-20260730-01',
      sha256: 'f'.repeat(64),
      capturedAtUtc: '2026-07-30T05:36:00.000Z',
      restoreAuthorityConfirmed: true,
    },
    migrations: {
      authorized: true,
      serial: true,
      destructiveAllowed: false,
      dataPreservingTableRebuildsAuthorized: true,
      zeroRowLossRequired: true,
      tableRebuildEntries: packageDocument.migrations
        .filter((entry) => entry.migrationClass === 'data_preserving_table_rebuild')
        .map(({ name, sha256 }) => ({
          name,
          sha256,
          rowParityEvidenceId: `row-parity-${name}`,
          rowParityEvidenceSha256: '9'.repeat(64),
          maxExclusiveLockMs: 5_000,
        })),
      entries: packageDocument.migrations.map(({ name, sha256 }) => ({ name, sha256 })),
    },
    backfills: {
      authorized: true,
      tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
      secondPassRequired: true,
      entries: packageDocument.backfills.map(({ path, sha256 }) => ({
        path,
        sha256,
        partitionLimit: 100,
      })),
    },
    providers: {
      authorized: true,
      tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
      keys: [...packageDocument.scope.providerKeys],
      mode: 'shadow',
      responseAuthority: 'legacy',
      expectedFlagRowCount: 36,
    },
    observation: {
      durationMinutes: 4320,
      maxP95LatencyMs: 1000,
      maxErrorRate: 0.01,
      dailySummaryRequired: true,
    },
    acceptance: {
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
      criticalUnexplainedVarianceCount: 0,
      providerErrorCount: 0,
      mappingAmbiguityCount: 0,
      crossTenantReferenceCount: 0,
      secondPassNewBusinessRows: 0,
      missingProviderFlagRows: 0,
      nonShadowProviderFlagRows: 0,
    },
    procedure: {
      deployLegacyDefaultFirst: true,
      captureTimeTravelBeforeMigration: true,
      verifyBackupExportBeforeMigration: true,
      serialMigrations: true,
      boundedBackfills: true,
      secondPassRequired: true,
      preActivationReconciliation: true,
      activateAllTenantShadow: true,
      postActivationScopeVerification: true,
      dailyObservation: true,
      immediateProviderDisableRollback: true,
      immediateWorkerRollback: true,
      noUserFacingDowntime: true,
    },
    rollback: {
      previousWorkerVersionId: '4f5d8f93-92d4-4fda-8fba-c0a2863f1b71',
      disableAllNineProviders: true,
      restoreLegacyResponseAuthority: true,
      retainCanonicalEvidence: true,
      stopOnFirstFailure: true,
    },
    permissions: {
      productionRead: true,
      deployment: true,
      trafficChange: true,
      productionSchemaMigration: true,
      productionBackfill: true,
      providerShadowActivation: true,
      canonicalReadPromotion: false,
      canonicalWritePromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      destructiveAction: false,
      remoteDatabaseDeletion: false,
      push: false,
      cdbToMainIntegration: false,
    },
    confirmation: {
      deployToken: '',
      migrationToken: '',
      backfillToken: '',
      shadowActivationToken: '',
      rollbackToken: '',
    },
  };
  authorization.confirmation = buildAllTenantShadowConfirmationTokens(authorization);
  return authorization;
}

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070-auth-'));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-070 all-tenant shadow execution authorization', () => {
  it('accepts the exact protected authorization and builds a non-executing plan', () => {
    const packageDocument = repositoryPackage();
    const authorization = readyAuthorization();
    const result = parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(authorization),
      process.cwd(),
      packageDocument,
      NOW_UTC,
    );

    expect(result).toEqual({
      documentReady: true,
      executionReady: true,
      issues: [],
      authorization,
    });
    expect(buildAllTenantShadowAuthorizationPlan(result)).toMatchObject({
      checkpoint: 'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION',
      tenantCount: 4,
      migrationCount: 29,
      backfillCount: 4,
      providerCount: 9,
      expectedProviderFlagRowCount: 36,
      finalResponseAuthority: 'legacy',
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
  });

  it('rejects generic approval and any Canonical promotion or destructive permission', () => {
    const packageDocument = repositoryPackage();
    const generic = readyAuthorization() as AllTenantShadowExecutionAuthorization & {
      owner: AllTenantShadowExecutionAuthorization['owner'] & { approvalSource: string };
    };
    generic.owner.approvalSource = 'generic_continue';
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(generic), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_OWNER_INVALID');

    const broad = readyAuthorization();
    broad.permissions.canonicalReadPromotion = true;
    broad.permissions.destructiveAction = true;
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(broad), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_PERMISSION_INVALID');
  });

  it('rejects partial tenant scope and stale package, migration, or backfill bindings', () => {
    const packageDocument = repositoryPackage();
    const tenant = readyAuthorization();
    tenant.activeTenantEvidence.tenantIds = ['100'];
    tenant.backfills.tenantIds = ['100'];
    tenant.providers.tenantIds = ['100'];
    tenant.confirmation = buildAllTenantShadowConfirmationTokens(tenant);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(tenant), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_SCOPE_INVALID');

    const packageHash = readyAuthorization();
    packageHash.repository.packageSha256 = '0'.repeat(64);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(packageHash), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_BINDING_INVALID');

    const migration = readyAuthorization();
    migration.migrations.entries[0].sha256 = '1'.repeat(64);
    migration.confirmation = buildAllTenantShadowConfirmationTokens(migration);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(migration), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_MIGRATION_INVALID');

    const rebuild = readyAuthorization();
    rebuild.migrations.dataPreservingTableRebuildsAuthorized = false;
    rebuild.migrations.tableRebuildEntries[0].rowParityEvidenceSha256 = 'invalid';
    rebuild.confirmation = buildAllTenantShadowConfirmationTokens(rebuild);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(rebuild), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_MIGRATION_INVALID');

    const backfill = readyAuthorization();
    backfill.backfills.entries[0].sha256 = '2'.repeat(64);
    backfill.confirmation = buildAllTenantShadowConfirmationTokens(backfill);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(backfill), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_BACKFILL_INVALID');
  });

  it('rejects expired windows, insufficient observation, rollback drift, and stale confirmation tokens', () => {
    const packageDocument = repositoryPackage();
    const expired = readyAuthorization();
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(expired), process.cwd(), packageDocument, '2026-07-30T08:01:00.000Z',
    ))).toContain('CDBV1070_AUTHORIZATION_EXPIRED');

    const observation = readyAuthorization();
    observation.observation.durationMinutes = 1440;
    observation.confirmation = buildAllTenantShadowConfirmationTokens(observation);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(observation), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_OBSERVATION_INVALID');

    const rollback = readyAuthorization();
    rollback.rollback.previousWorkerVersionId = 'different-worker';
    rollback.confirmation = buildAllTenantShadowConfirmationTokens(rollback);
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(rollback), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_ROLLBACK_INVALID');

    const token = readyAuthorization();
    token.confirmation.shadowActivationToken = 'stale';
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(token), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_CONFIRMATION_INVALID');
  });

  it('rejects unknown, sensitive, duplicate, in-repository, linked, or weakly protected files', () => {
    const packageDocument = repositoryPackage();
    const unknown = { ...readyAuthorization(), unexpected: true };
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(unknown), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_UNKNOWN_FIELD');

    const sensitive = { ...readyAuthorization(), token: '[REDACTED_SECRET]' };
    const sensitiveResult = parseAllTenantShadowExecutionAuthorizationJson(
      JSON.stringify(sensitive), process.cwd(), packageDocument, NOW_UTC,
    );
    expect(codes(sensitiveResult)).toContain('CDBV1070_AUTHORIZATION_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('[REDACTED_SECRET]');

    const duplicate = JSON.stringify(readyAuthorization()).replace(
      '"authorizationId":"cdb-v1-070-all-tenant-shadow-20260730-01"',
      '"authorizationId":"first","authorizationId":"second"',
    );
    expect(codes(parseAllTenantShadowExecutionAuthorizationJson(
      duplicate, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_DUPLICATE_KEY');

    const valid = writeProtected(readyAuthorization());
    expect(loadAllTenantShadowExecutionAuthorization(
      valid.path, process.cwd(), packageDocument, NOW_UTC,
    ).executionReady).toBe(true);

    const weak = writeProtected(readyAuthorization(), { fileMode: 0o644 });
    expect(codes(loadAllTenantShadowExecutionAuthorization(
      weak.path, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const linkedRoot = protectedRoot();
    const original = join(linkedRoot, 'original.json');
    const linked = join(linkedRoot, 'linked.json');
    writeFileSync(original, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    chmodSync(original, 0o600);
    linkSync(original, linked);
    expect(codes(loadAllTenantShadowExecutionAuthorization(
      linked, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const symlinkRoot = protectedRoot();
    const target = join(symlinkRoot, 'target.json');
    const symlink = join(symlinkRoot, 'authorization.json');
    writeFileSync(target, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    chmodSync(target, 0o600);
    symlinkSync(target, symlink);
    expect(codes(loadAllTenantShadowExecutionAuthorization(
      symlink, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070_AUTHORIZATION_FILE_PROTECTION_INVALID');
  });
});

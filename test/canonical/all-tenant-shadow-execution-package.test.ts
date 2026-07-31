import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CDB_V1_070A_ACTIVE_TENANT_IDS,
  CDB_V1_070A_BACKFILL_PATHS,
  CDB_V1_070A_CHECKPOINT,
  CDB_V1_070A_EXTERNAL_BINDING_PATHS,
  CDB_V1_070A_MIGRATION_NAMES,
  CDB_V1_070A_NEXT_CHECKPOINT,
  CDB_V1_070A_PROVIDER_KEYS,
  CDB_V1_070A_TABLE_REBUILD_MIGRATION_NAMES,
  buildAllTenantShadowExecutionPackage,
  evaluateAllTenantShadowExecutionPackage,
} from '../../scripts/canonical/all-tenant-shadow-execution-package';

function repositoryHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function buildReadyPackage() {
  const head = repositoryHead();
  return buildAllTenantShadowExecutionPackage(process.cwd(), {
    branch: 'program/cdb-main-continuous-20260725',
    preparationCommit: head,
    buildSha: head,
  });
}

describe('CDB-V1-070A all-tenant shadow execution package', () => {
  it('binds the exact all-active-tenant Legacy-primary shadow scope', () => {
    const document = buildReadyPackage();

    expect(document).toMatchObject({
      schemaVersion: 1,
      checkpoint: CDB_V1_070A_CHECKPOINT,
      status: 'prepared_not_authorized',
      nextCheckpoint: CDB_V1_070A_NEXT_CHECKPOINT,
      scope: {
        tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
        tenantSelection: 'all_active_tenants_exact_preflight',
        mode: 'legacy_primary_shadow',
        expectedProviderFlagRowCount:
          CDB_V1_070A_ACTIVE_TENANT_IDS.length * CDB_V1_070A_PROVIDER_KEYS.length,
        providerKeys: [...CDB_V1_070A_PROVIDER_KEYS],
      },
      permissions: {
        productionReadAuthorized: false,
        deploymentAuthorized: false,
        trafficChangeAuthorized: false,
        productionMigrationAuthorized: false,
        productionBackfillAuthorized: false,
        providerShadowActivationAuthorized: false,
        canonicalReadPromotionAuthorized: false,
        canonicalWritePromotionAuthorized: false,
        localSyncActivationAuthorized: false,
        legacyRetirementAuthorized: false,
        destructiveActionAuthorized: false,
      },
      safety: {
        networkRequestPerformed: false,
        productionReadPerformed: false,
        productionMutationPerformed: false,
        deploymentPerformed: false,
        trafficChanged: false,
        pushPerformed: false,
        cdbToMainIntegrationPerformed: false,
      },
    });

    expect(document.migrations).toHaveLength(29);
    expect(document.migrations.map((entry) => entry.name)).toEqual([
      ...CDB_V1_070A_MIGRATION_NAMES,
    ]);
    expect(document.migrations.filter((entry) => entry.migrationClass === 'additive')).toHaveLength(27);
    expect(
      document.migrations
        .filter((entry) => entry.migrationClass === 'data_preserving_table_rebuild')
        .map((entry) => entry.name),
    ).toEqual([...CDB_V1_070A_TABLE_REBUILD_MIGRATION_NAMES]);
    expect(
      document.migrations
        .filter((entry) => entry.requiresExclusiveSchemaReview)
        .map((entry) => entry.name),
    ).toEqual([...CDB_V1_070A_TABLE_REBUILD_MIGRATION_NAMES]);
    expect(document.migrations.every((entry) => entry.dataPreserving === true)).toBe(true);
    expect(document.backfills.map((entry) => entry.path)).toEqual([
      ...CDB_V1_070A_BACKFILL_PATHS,
    ]);
    expect(document.scope.providerKeys).toHaveLength(9);
    expect(document.commands.map((entry) => entry.phase)).toEqual([
      'candidate_preflight',
      'backup_verification',
      'legacy_default_deployment',
      'migration',
      'backfill',
      'reconciliation',
      'shadow_activation',
      'scope_verification',
      'observation',
      'rollback',
    ]);
    expect(document.commands.every((entry) => entry.executable === false)).toBe(true);
  });

  it('evaluates the prepared package as repository-ready but never execution-ready', () => {
    const document = buildReadyPackage();
    const result = evaluateAllTenantShadowExecutionPackage(process.cwd(), document);

    expect(result).toEqual({
      packageReady: true,
      executionReady: false,
      issues: [],
      unresolvedExternalBindings: [...CDB_V1_070A_EXTERNAL_BINDING_PATHS],
      tenantCount: 4,
      migrationCount: 29,
      backfillCount: 4,
      providerCount: 9,
      expectedProviderFlagRowCount: 36,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
  });

  it('fails closed when scope, migration, command, permission, or external binding drifts', () => {
    const document = buildReadyPackage();
    document.scope.tenantIds = ['100'];
    document.migrations.pop();
    document.commands[0].executable = true as false;
    document.permissions.deploymentAuthorized = true as false;
    document.externalBindings.productionDatabase.name = 'embedded-production-name' as null;

    const result = evaluateAllTenantShadowExecutionPackage(process.cwd(), document);
    expect(result.packageReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'tenant scope mismatch',
      'migration count mismatch',
      'command contract mismatch: candidate_preflight',
      'prepared package cannot authorize deploymentAuthorized',
      'committed package must not embed external binding productionDatabase.name',
    ]));
  });

  it('hash-binds every migration, backfill, plan, audit and shadow-control file', () => {
    const document = buildReadyPackage();
    expect(document.migrations.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    expect(document.backfills.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    expect(document.bindings.planSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.auditSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.shadowContractSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.scopeValidatorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.authorizationContractSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.authorizationValidatorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.readinessCheckerSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.preparation.minimumImplementationCommit).toBe(
      '8be5525013a8231b9cccb55957b137fbb385ea34',
    );
  });
});

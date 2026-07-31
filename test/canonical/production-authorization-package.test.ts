import { describe, expect, it } from 'vitest';
import {
  CDB_V1_060_BACKFILL_PATHS,
  CDB_V1_060_CONSUMER_IDS,
  CDB_V1_060_MIGRATION_NAMES,
  CDB_V1_060_PROVIDER_KEYS,
  CDB_V1_060_SOURCE_TABLES,
  buildProductionAuthorizationPackage,
  evaluateProductionAuthorizationPackage,
  type ProductionAuthorizationPackage,
} from '../../scripts/canonical/production-authorization-package';

const root = process.cwd();
const binding = {
  branch: 'program/cdb-main-continuous-20260725',
  candidateCommit: 'a'.repeat(40),
  buildSha: 'a'.repeat(40),
};

function built(): ProductionAuthorizationPackage {
  return buildProductionAuthorizationPackage(root, binding);
}

describe('CDB-V1-060 production authorization package contract', () => {
  it('builds deterministic exact repository-side bindings', () => {
    const first = built();
    const second = built();

    expect(second).toEqual(first);
    expect(first.checkpoint).toBe('CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY');
    expect(first.status).toBe('prepared_not_authorized');
    expect(first.candidate).toEqual(binding);
    expect(first.scope.tenantIds).toEqual(['100']);
    expect(first.scope.providerKeys).toEqual(CDB_V1_060_PROVIDER_KEYS);
    expect(first.scope.consumerIds).toEqual(CDB_V1_060_CONSUMER_IDS);
    expect(first.scope.sourceTables).toEqual(CDB_V1_060_SOURCE_TABLES);
    expect(first.migrations.map((entry) => entry.name)).toEqual(CDB_V1_060_MIGRATION_NAMES);
    expect(first.backfills.map((entry) => entry.path)).toEqual(CDB_V1_060_BACKFILL_PATHS);
    expect(first.migrations).toHaveLength(19);
    expect(first.backfills).toHaveLength(4);
    expect(first.commands.map((entry) => entry.phase)).toEqual([
      'preflight',
      'backup_verification',
      'migration',
      'backfill',
      'reconciliation',
      'shadow_canary',
      'observation',
      'rollback',
    ]);
    expect(first.permissions).toEqual({
      productionReadAuthorized: false,
      productionMigrationAuthorized: false,
      productionBackfillAuthorized: false,
      providerPromotionAuthorized: false,
      canonicalWriteAuthorized: false,
      deploymentAuthorized: false,
      trafficChangeAuthorized: false,
      localSyncActivationAuthorized: false,
      legacyRetirementAuthorized: false,
      destructiveActionAuthorized: false,
    });
    expect(first.safety).toEqual({
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      deploymentPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    });
    for (const hash of [
      first.bindings.cdbV1050ResultSha256,
      first.bindings.cdbV1050CheckerSha256,
      first.bindings.runbookSha256,
      first.bindings.migrationManifestSha256,
      ...first.migrations.map((entry) => entry.sha256),
      ...first.backfills.map((entry) => entry.sha256),
    ]) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is repository-package ready but execution blocked on exact external bindings', () => {
    const result = evaluateProductionAuthorizationPackage(root, built());

    expect(result.packageReady).toBe(true);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.unresolvedExternalBindings).toEqual([
      'productionDatabase.name',
      'productionDatabase.id',
      'productionSnapshot.bookmarkId',
      'productionSnapshot.sha256',
      'backupExport.evidenceId',
      'backupExport.sha256',
      'maintenanceWindow.startUtc',
      'maintenanceWindow.endUtc',
      'owners.executionOwnerId',
      'owners.rollbackOwnerId',
      'owners.observationOwnerId',
      'ownerApproval.evidenceId',
      'ownerApproval.evidenceSha256',
      'observation.durationMinutes',
      'observation.maxP95LatencyMs',
      'observation.maxErrorRate',
      'deployedBuild.workerVersionId',
      'deployedBuild.buildManifestSha256',
    ]);
    expect(result.networkRequestPerformed).toBe(false);
    expect(result.productionReadPerformed).toBe(false);
    expect(result.productionMutationPerformed).toBe(false);
  });

  it('rejects stale hashes, broad scope, unsafe commands and prohibited permissions', () => {
    const stale = structuredClone(built());
    stale.migrations[0].sha256 = '0'.repeat(64);
    stale.scope.tenantIds.push('101');
    stale.commands[0].argvTemplate.push('&&');
    stale.permissions.productionMigrationAuthorized = true;

    const result = evaluateProductionAuthorizationPackage(root, stale);

    expect(result.packageReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'migration hash mismatch: 0551_workforce_roster_integrity.sql',
      'tenant scope must equal the single reviewed canary tenant template',
      'unsafe command token in preflight',
      'prepared package cannot authorize productionMigrationAuthorized',
    ]));
  });

  it('rejects external authorization data inside the committed sanitized package', () => {
    const packageValue = structuredClone(built());
    packageValue.externalBindings.productionDatabase.name = 'production';
    packageValue.externalBindings.owners.executionOwnerId = 'owner-1';
    packageValue.externalBindings.observation.durationMinutes = 30;

    const result = evaluateProductionAuthorizationPackage(root, packageValue);

    expect(result.packageReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'committed package must not embed external binding productionDatabase.name',
      'committed package must not embed external binding owners.executionOwnerId',
      'committed package must not embed external binding observation.durationMinutes',
    ]));
  });

  it('rejects invalid candidate branch or commit bindings', () => {
    expect(() => buildProductionAuthorizationPackage(root, {
      ...binding,
      branch: 'main',
    })).toThrow(/branch/i);
    expect(() => buildProductionAuthorizationPackage(root, {
      ...binding,
      candidateCommit: 'short',
    })).toThrow(/candidateCommit/i);
  });
});

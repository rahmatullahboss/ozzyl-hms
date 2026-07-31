import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CDB_V1_070B_CHECKPOINT,
  CDB_V1_070B_EXTERNAL_BINDING_PATHS,
  CDB_V1_070B_NEXT_CHECKPOINT,
  buildAllTenantShadowPreparationPackage,
  evaluateAllTenantShadowPreparationPackage,
} from '../../scripts/canonical/all-tenant-shadow-preparation-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';
import {
  CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE,
  CDB101_PRODUCTION_WORKER_ENTRYPOINT,
  CDB101_PRODUCTION_WORKER_ENVIRONMENT,
  CDB101_PRODUCTION_WORKER_ROUTES,
  CDB101_PRODUCTION_WORKER_SERVICE,
} from '../../scripts/canonical/reporting-worker-build-version-evidence';

function repositoryHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function buildReadyPackage() {
  const head = repositoryHead();
  return buildAllTenantShadowPreparationPackage(process.cwd(), {
    branch: 'program/cdb-main-continuous-20260725',
    preparationCommit: head,
    buildSha: head,
  });
}

describe('CDB-V1-070B all-tenant shadow preparation package', () => {
  it('binds the exact production target, Worker identity, expected scope and non-executing phases', () => {
    const document = buildReadyPackage();

    expect(document).toMatchObject({
      schemaVersion: 1,
      checkpoint: CDB_V1_070B_CHECKPOINT,
      status: 'prepared_not_authorized',
      nextCheckpoint: CDB_V1_070B_NEXT_CHECKPOINT,
      target: {
        platform: 'cloudflare_d1',
        databaseName: CDB101_PRODUCTION_DATABASE_NAME,
        databaseUuid: CDB101_PRODUCTION_DATABASE_ID,
        environment: 'production',
        remote: true,
      },
      worker: {
        serviceName: CDB101_PRODUCTION_WORKER_SERVICE,
        environment: CDB101_PRODUCTION_WORKER_ENVIRONMENT,
        entrypoint: CDB101_PRODUCTION_WORKER_ENTRYPOINT,
        compatibilityDate: CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE,
        routes: [...CDB101_PRODUCTION_WORKER_ROUTES],
        candidateTrafficPercentage: 0,
        previousTrafficPercentage: 100,
      },
      expectedScope: {
        tenantIds: ['1', '100', '101', '102'],
        allActiveTenantAggregateRead: true,
        migrationLedgerAggregateRead: true,
        phiReadAllowed: false,
        rowLevelPatientReadAllowed: false,
        migrationManifestCount: 504,
        expectedPendingMigrationCount: 29,
      },
      permissions: {
        productionReadAuthorized: false,
        workerVersionUploadAuthorized: false,
        trafficChangeAuthorized: false,
        timeTravelBookmarkCaptureAuthorized: false,
        backupExportCaptureAuthorized: false,
        productionMigrationAuthorized: false,
        productionBackfillAuthorized: false,
        providerFlagChangeAuthorized: false,
        canonicalPromotionAuthorized: false,
        localSyncActivationAuthorized: false,
        legacyRetirementAuthorized: false,
        destructiveActionAuthorized: false,
      },
      safety: {
        networkRequestPerformed: false,
        productionReadPerformed: false,
        productionMutationPerformed: false,
        workerVersionUploadPerformed: false,
        bookmarkCapturePerformed: false,
        backupExportPerformed: false,
        trafficChanged: false,
        pushPerformed: false,
        cdbToMainIntegrationPerformed: false,
      },
    });

    expect(document.commands.map((entry) => entry.phase)).toEqual([
      'candidate_build_verification',
      'zero_traffic_version_upload',
      'aggregate_production_read',
      'time_travel_bookmark_capture',
      'protected_export_capture',
      'preparation_evidence_verification',
    ]);
    expect(document.commands.every((entry) => entry.executable === false)).toBe(true);
  });

  it('evaluates repository readiness while remaining authorization and execution blocked', () => {
    const document = buildReadyPackage();
    const result = evaluateAllTenantShadowPreparationPackage(process.cwd(), document);

    expect(result).toEqual({
      packageReady: true,
      authorizationReady: false,
      executionReady: false,
      issues: [],
      unresolvedExternalBindings: [...CDB_V1_070B_EXTERNAL_BINDING_PATHS],
      tenantCount: 4,
      commandCount: 6,
      migrationManifestCount: 504,
      expectedPendingMigrationCount: 29,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficChanged: false,
    });
  });

  it('fails closed on target, route, scope, command, permission or embedded binding drift', () => {
    const document = buildReadyPackage();
    document.target.databaseUuid = '00000000-0000-4000-8000-000000000000';
    document.worker.routes = ['unexpected.example/*'];
    document.expectedScope.tenantIds = ['100'];
    document.commands[0].executable = true as false;
    document.permissions.workerVersionUploadAuthorized = true as false;
    document.externalBindings.candidate.commit = 'embedded' as null;

    const result = evaluateAllTenantShadowPreparationPackage(process.cwd(), document);
    expect(result.packageReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'production target mismatch',
      'Worker route scope mismatch',
      'tenant scope mismatch',
      'command contract mismatch: candidate_build_verification',
      'prepared package cannot authorize workerVersionUploadAuthorized',
      'committed package must not embed external binding candidate.commit',
    ]));
  });

  it('hash-binds the staged design, implementation plan, historical execution package and preparation tooling', () => {
    const document = buildReadyPackage();

    expect(document.bindings.designSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.planSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.historicalExecutionPackageSha256).toBe(
      '40d5a069e9080f3465d6f367950522e6515c5ff712525073ccde5732536a57c3',
    );
    expect(document.bindings.migrationManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.authorizationContractSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.authorizationValidatorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.bindings.readinessCheckerSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

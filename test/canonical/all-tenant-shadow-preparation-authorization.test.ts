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
  buildAllTenantShadowPreparationAuthorizationPlan,
  buildAllTenantShadowPreparationConfirmationTokens,
  buildAllTenantShadowPreparationRepositoryBinding,
  loadAllTenantShadowPreparationAuthorization,
  parseAllTenantShadowPreparationAuthorizationJson,
  type AllTenantShadowPreparationAuthorization,
} from '../../scripts/canonical/all-tenant-shadow-preparation-authorization';
import {
  buildAllTenantShadowPreparationPackage,
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

const roots: string[] = [];
const NOW_UTC = '2026-07-30T06:30:00.000Z';

function repositoryHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function repositoryPackage() {
  const head = repositoryHead();
  return buildAllTenantShadowPreparationPackage(process.cwd(), {
    branch: 'program/cdb-main-continuous-20260725',
    preparationCommit: head,
    buildSha: head,
  });
}

function readyAuthorization(): AllTenantShadowPreparationAuthorization {
  const packageDocument = repositoryPackage();
  const candidateCommit = repositoryHead();
  const repository = buildAllTenantShadowPreparationRepositoryBinding(
    process.cwd(),
    packageDocument,
    candidateCommit,
    candidateCommit,
    'main-integration-evidence-20260730-01',
    '1'.repeat(64),
  );
  const authorization: AllTenantShadowPreparationAuthorization = {
    schemaVersion: 1,
    authorizationId: 'cdb-v1-070b-preparation-20260730-01',
    operation: 'all_tenant_shadow_preparation_evidence_capture',
    target: {
      platform: 'cloudflare_d1',
      databaseName: CDB101_PRODUCTION_DATABASE_NAME,
      databaseUuid: CDB101_PRODUCTION_DATABASE_ID,
      environment: 'production',
      remote: true,
    },
    timing: {
      issuedAtUtc: '2026-07-30T06:00:00.000Z',
      windowStartUtc: '2026-07-30T06:15:00.000Z',
      windowEndUtc: '2026-07-30T07:45:00.000Z',
      expiresAtUtc: '2026-07-30T08:00:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_all_tenant_shadow_preparation_evidence_authorization',
      ownerModel: 'single_operator_risk_accepted',
      executionOwnerId: 'rahmatullah-zisan',
      rollbackOwnerId: 'rahmatullah-zisan',
      evidenceCustodianId: 'rahmatullah-zisan',
      riskAcceptanceEvidenceId: 'risk-cdb-v1-070b-20260730-01',
      riskAcceptanceEvidenceSha256: '2'.repeat(64),
      automaticAbortOnOperatorUnavailable: true,
    },
    repository,
    worker: {
      serviceName: CDB101_PRODUCTION_WORKER_SERVICE,
      environment: CDB101_PRODUCTION_WORKER_ENVIRONMENT,
      entrypoint: CDB101_PRODUCTION_WORKER_ENTRYPOINT,
      compatibilityDate: CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE,
      routes: [...CDB101_PRODUCTION_WORKER_ROUTES],
      uploadAtZeroTraffic: true,
      expectedCandidateTrafficPercentage: 0,
      retainPreviousActiveVersion: true,
      expectedPreviousTrafficPercentage: 100,
    },
    scope: {
      tenantIds: ['1', '100', '101', '102'],
      allActiveTenantAggregateRead: true,
      migrationLedgerAggregateRead: true,
      workerMetadataRead: true,
      routeMetadataRead: true,
      phiReadAllowed: false,
      rowLevelPatientReadAllowed: false,
    },
    evidenceOutput: {
      receiptId: 'cdb-v1-070b-preparation-receipt-20260730-01',
      protectedDirectoryEvidenceId: 'protected-evidence-dir-20260730-01',
      retentionDays: 30,
    },
    procedure: {
      verifyCandidateBuildLocally: true,
      uploadCandidateAtZeroTraffic: true,
      capturePreviousActiveVersion: true,
      captureExactRoutes: true,
      captureActiveTenantAggregate: true,
      captureMigrationLedgerAggregate: true,
      captureTimeTravelBookmark: true,
      captureProtectedExport: true,
      verifyZeroProductionRowsWritten: true,
      verifyZeroMigrationsApplied: true,
      verifyZeroBackfillsExecuted: true,
      verifyZeroProviderFlagsChanged: true,
      verifyTrafficUnchanged: true,
      preserveLegacyAuthority: true,
      stopOnFirstFailure: true,
    },
    permissions: {
      productionRead: true,
      workerVersionUpload: true,
      workerTrafficAssignment: false,
      timeTravelBookmarkCapture: true,
      backupExportCapture: true,
      productionSchemaMigration: false,
      productionBackfill: false,
      providerFlagChange: false,
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
      readToken: '',
      versionUploadToken: '',
      backupCaptureToken: '',
      abortToken: '',
    },
  };
  authorization.confirmation = buildAllTenantShadowPreparationConfirmationTokens(authorization);
  return authorization;
}

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070b-auth-'));
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

describe('CDB-V1-070B all-tenant shadow preparation authorization', () => {
  it('accepts the exact protected Gate A authorization and builds a non-executing plan', () => {
    const packageDocument = repositoryPackage();
    const authorization = readyAuthorization();
    const result = parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(authorization),
      process.cwd(),
      packageDocument,
      NOW_UTC,
    );

    expect(result).toEqual({
      documentReady: true,
      authorizationReady: true,
      issues: [],
      authorization,
    });
    expect(buildAllTenantShadowPreparationAuthorizationPlan(result)).toMatchObject({
      checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE',
      tenantCount: 4,
      routeCount: 4,
      candidateTrafficPercentage: 0,
      previousTrafficPercentage: 100,
      finalResponseAuthority: 'legacy',
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficChanged: false,
    });
  });

  it('rejects generic or final-execution approval and any traffic, migration, backfill or flag permission', () => {
    const packageDocument = repositoryPackage();
    const generic = readyAuthorization() as AllTenantShadowPreparationAuthorization & {
      owner: AllTenantShadowPreparationAuthorization['owner'] & { approvalSource: string };
    };
    generic.owner.approvalSource = 'generic_continue';
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(generic), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_OWNER_INVALID');

    const finalExecution = readyAuthorization() as AllTenantShadowPreparationAuthorization & {
      owner: AllTenantShadowPreparationAuthorization['owner'] & { approvalSource: string };
    };
    finalExecution.owner.approvalSource = 'user_explicit_all_tenant_legacy_primary_shadow_authorization';
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(finalExecution), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_OWNER_INVALID');

    const broad = readyAuthorization();
    broad.permissions.workerTrafficAssignment = true;
    broad.permissions.productionSchemaMigration = true;
    broad.permissions.productionBackfill = true;
    broad.permissions.providerFlagChange = true;
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(broad), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_PERMISSION_INVALID');
  });

  it('rejects target, package, candidate, route, tenant and zero-traffic drift', () => {
    const packageDocument = repositoryPackage();

    const target = readyAuthorization();
    target.target.databaseUuid = '00000000-0000-4000-8000-000000000000';
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(target), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_TARGET_INVALID');

    const packageHash = readyAuthorization();
    packageHash.repository.preparationPackageSha256 = '0'.repeat(64);
    packageHash.confirmation = buildAllTenantShadowPreparationConfirmationTokens(packageHash);
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(packageHash), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_BINDING_INVALID');

    const route = readyAuthorization();
    route.worker.routes = ['unexpected.example/*'];
    route.confirmation = buildAllTenantShadowPreparationConfirmationTokens(route);
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(route), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_WORKER_INVALID');

    const tenant = readyAuthorization();
    tenant.scope.tenantIds = ['100'];
    tenant.confirmation = buildAllTenantShadowPreparationConfirmationTokens(tenant);
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(tenant), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_SCOPE_INVALID');

    const traffic = readyAuthorization();
    traffic.worker.expectedCandidateTrafficPercentage = 1;
    traffic.confirmation = buildAllTenantShadowPreparationConfirmationTokens(traffic);
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(traffic), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_WORKER_INVALID');
  });

  it('rejects expired windows, stale tokens and unsafe or incomplete procedure', () => {
    const packageDocument = repositoryPackage();
    const expired = readyAuthorization();
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(expired), process.cwd(), packageDocument, '2026-07-30T08:01:00.000Z',
    ))).toContain('CDBV1070B_AUTHORIZATION_EXPIRED');

    const stale = readyAuthorization();
    stale.confirmation.backupCaptureToken = 'stale';
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(stale), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_CONFIRMATION_INVALID');

    const procedure = readyAuthorization();
    procedure.procedure.verifyZeroProviderFlagsChanged = false;
    procedure.procedure.preserveLegacyAuthority = false;
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(procedure), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_PROCEDURE_INVALID');
  });

  it('rejects unknown, sensitive, duplicate, in-repository, linked or weakly protected files', () => {
    const packageDocument = repositoryPackage();
    const unknown = { ...readyAuthorization(), unexpected: true };
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(unknown), process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_UNKNOWN_FIELD');

    const sensitive = { ...readyAuthorization(), token: '[REDACTED_SECRET]' };
    const sensitiveResult = parseAllTenantShadowPreparationAuthorizationJson(
      JSON.stringify(sensitive), process.cwd(), packageDocument, NOW_UTC,
    );
    expect(codes(sensitiveResult)).toContain('CDBV1070B_AUTHORIZATION_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('[REDACTED_SECRET]');

    const duplicateText = JSON.stringify(readyAuthorization()).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    );
    expect(codes(parseAllTenantShadowPreparationAuthorizationJson(
      duplicateText, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_DUPLICATE_KEY');

    const inRepository = join(process.cwd(), '.cdb-v1-070b-authorization-test.json');
    writeFileSync(inRepository, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    try {
      expect(codes(loadAllTenantShadowPreparationAuthorization(
        inRepository, process.cwd(), packageDocument, NOW_UTC,
      ))).toContain('CDBV1070B_AUTHORIZATION_FILE_INSIDE_REPOSITORY');
    } finally {
      rmSync(inRepository, { force: true });
    }

    const weak = writeProtected(readyAuthorization(), { fileMode: 0o644 });
    expect(codes(loadAllTenantShadowPreparationAuthorization(
      weak.path, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const linkedRoot = protectedRoot();
    const original = join(linkedRoot, 'original.json');
    const linked = join(linkedRoot, 'linked.json');
    writeFileSync(original, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    chmodSync(original, 0o600);
    linkSync(original, linked);
    expect(codes(loadAllTenantShadowPreparationAuthorization(
      linked, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const symlinkRoot = protectedRoot();
    const targetPath = join(symlinkRoot, 'target.json');
    const symlinkPath = join(symlinkRoot, 'symlink.json');
    writeFileSync(targetPath, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, symlinkPath);
    expect(codes(loadAllTenantShadowPreparationAuthorization(
      symlinkPath, process.cwd(), packageDocument, NOW_UTC,
    ))).toContain('CDBV1070B_AUTHORIZATION_FILE_PROTECTION_INVALID');
  });
});

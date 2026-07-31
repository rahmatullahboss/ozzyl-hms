import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CDB_V1_071_BACKFILL_PATHS,
  CDB_V1_071_BUNDLE_SHA256,
  CDB_V1_071_CANDIDATE_SHA,
  CDB_V1_071_MIGRATION_NAMES,
  CDB_V1_071_PREVIOUS_WORKER_VERSION_ID,
  CDB_V1_071_ROUTES,
  CDB_V1_071_TENANT_IDS,
  buildCdbV1071ConfirmationProof,
  prepareProtectedCdbV1071Authorization,
  validateCdbV1071Authorization,
  type CdbV1071ProductionReleaseAuthorization,
} from '../../scripts/canonical/cdb-v1-071-production-release-authorization';

const roots: string[] = [];
const NOW = '2026-07-31T05:15:00.000Z';

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validAuthorization(): CdbV1071ProductionReleaseAuthorization {
  const authorizationId = 'cdb-v1-071-release-20260731-001';
  return {
    schemaVersion: 1,
    authorizationId,
    operation: 'cdb_v1_071_production_release_activation',
    target: {
      workerName: 'hms-saas-production',
      databaseName: 'hms-super-admin-production-apac',
      databaseUuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      environment: 'production',
      routes: [...CDB_V1_071_ROUTES],
    },
    timing: {
      issuedAtUtc: '2026-07-31T05:09:00.000Z',
      windowStartUtc: '2026-07-31T05:09:00.000Z',
      windowEndUtc: '2026-07-31T09:09:00.000Z',
      expiresAtUtc: '2026-07-31T09:09:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_cdb_v1_071_production_release_activation_authorization',
      ownerModel: 'single_operator_risk_accepted',
      automaticAbortOnOperatorUnavailable: true,
    },
    candidate: {
      branch: 'main',
      commit: CDB_V1_071_CANDIDATE_SHA,
      buildSha: CDB_V1_071_CANDIDATE_SHA,
      bundleSha256: CDB_V1_071_BUNDLE_SHA256,
      previousWorkerVersionId: CDB_V1_071_PREVIOUS_WORKER_VERSION_ID,
    },
    tenants: [...CDB_V1_071_TENANT_IDS],
    migrations: {
      authorized: true,
      serial: true,
      destructiveAllowed: false,
      entries: CDB_V1_071_MIGRATION_NAMES.map((name) => ({ name })),
    },
    backfills: {
      authorized: true,
      tenantIds: [...CDB_V1_071_TENANT_IDS],
      partitionLimit: 100,
      secondPassRequired: true,
      secondPassNewBusinessRowsExpected: 0,
      entries: CDB_V1_071_BACKFILL_PATHS.map((path) => ({ path })),
    },
    deployment: {
      authorized: true,
      uploadAtZeroTraffic: true,
      previousWorkerRetained: true,
      stages: [
        { candidatePercent: 5, previousPercent: 95 },
        { candidatePercent: 50, previousPercent: 50 },
        { candidatePercent: 100, previousPercent: 0 },
      ],
    },
    rollback: {
      automatic: true,
      stopOnFirstFailure: true,
      previousWorkerVersionId: CDB_V1_071_PREVIOUS_WORKER_VERSION_ID,
      restorePreviousPercent: 100,
    },
    permissions: {
      aggregateProductionRead: true,
      workerMetadataRead: true,
      timeTravelBookmarkCapture: true,
      protectedExportCapture: true,
      productionSchemaMigration: true,
      productionBackfill: true,
      workerVersionUpload: true,
      trafficChange: true,
      providerFlagChange: false,
      canonicalReadPromotion: false,
      canonicalWritePromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      routeChange: false,
      destructiveAction: false,
      databaseDeletion: false,
      archivalMutation: false,
      unrelatedProductionWrite: false,
    },
    evidence: {
      approvalEvidenceId: 'chat-approval-20260731-1109-bdt',
      approvalEvidenceSha256: sha('Rahmatullah Zisan CDB-V1-071 exact production release authorization'),
      riskAcceptanceEvidenceId: 'single-operator-risk-20260731-1109-bdt',
      riskAcceptanceEvidenceSha256: sha('single operator risk accepted with automatic abort and rollback'),
    },
    confirmation: {
      preflightProof: buildCdbV1071ConfirmationProof(authorizationId, 'preflight'),
      migrationProof: buildCdbV1071ConfirmationProof(authorizationId, 'migration'),
      backfillProof: buildCdbV1071ConfirmationProof(authorizationId, 'backfill'),
      uploadProof: buildCdbV1071ConfirmationProof(authorizationId, 'upload'),
      trafficProof: buildCdbV1071ConfirmationProof(authorizationId, 'traffic'),
      rollbackProof: buildCdbV1071ConfirmationProof(authorizationId, 'rollback'),
    },
  };
}

function protectedFile(document: unknown, mode = 0o600): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-071-auth-'));
  roots.push(root);
  chmodSync(root, 0o700);
  const path = join(root, 'authorization.json');
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, { mode });
  chmodSync(path, mode);
  return { root, path };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('CDB-V1-071 production release authorization', () => {
  test('accepts the exact protected authorization', () => {
    const result = validateCdbV1071Authorization(validAuthorization(), NOW);
    expect(result.authorizationReady).toBe(true);
    expect(result.executionReady).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test.each([
    ['generic approval source', (value: CdbV1071ProductionReleaseAuthorization) => { value.owner.approvalSource = 'ok' as never; }],
    ['candidate commit drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.candidate.commit = 'a'.repeat(40); }],
    ['candidate bundle drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.candidate.bundleSha256 = 'b'.repeat(64); }],
    ['route drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.target.routes[0] = 'example.com/*'; }],
    ['tenant drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.tenants = ['100']; }],
    ['migration drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.migrations.entries.pop(); }],
    ['backfill limit drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.backfills.partitionLimit = 101; }],
    ['traffic stage drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.deployment.stages[0].candidatePercent = 10; }],
    ['forbidden provider change', (value: CdbV1071ProductionReleaseAuthorization) => { value.permissions.providerFlagChange = true; }],
    ['rollback version drift', (value: CdbV1071ProductionReleaseAuthorization) => { value.rollback.previousWorkerVersionId = crypto.randomUUID(); }],
  ])('rejects %s', (_label, mutate) => {
    const value = validAuthorization();
    mutate(value);
    const result = validateCdbV1071Authorization(value, NOW);
    expect(result.authorizationReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('rejects an expired authorization', () => {
    const result = validateCdbV1071Authorization(validAuthorization(), '2026-07-31T10:00:00.000Z');
    expect(result.issues).toContain('CDBV1071_AUTHORIZATION_EXPIRED');
  });

  test('loads a mode-700 directory and mode-600 regular file outside the repository', () => {
    const { path } = protectedFile(validAuthorization());
    const result = prepareProtectedCdbV1071Authorization(path, process.cwd(), NOW);
    expect(result.receipt.executionReady).toBe(true);
    expect(result.authorization?.candidate.commit).toBe(CDB_V1_071_CANDIDATE_SHA);
  });

  test('rejects unsafe file permissions', () => {
    const { path } = protectedFile(validAuthorization(), 0o644);
    const result = prepareProtectedCdbV1071Authorization(path, process.cwd(), NOW);
    expect(result.receipt.executionReady).toBe(false);
    expect(result.receipt.issues).toContain('CDBV1071_AUTHORIZATION_FILE_PROTECTION_INVALID');
  });

  test('rejects duplicate JSON keys', () => {
    const { root } = protectedFile(validAuthorization());
    const path = join(root, 'duplicate.json');
    writeFileSync(path, '{"schemaVersion":1,"schemaVersion":1}\n', { mode: 0o600 });
    chmodSync(path, 0o600);
    const result = prepareProtectedCdbV1071Authorization(path, process.cwd(), NOW);
    expect(result.receipt.issues).toContain('CDBV1071_AUTHORIZATION_DUPLICATE_KEY');
  });
});

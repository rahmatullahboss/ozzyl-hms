import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
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
  bindReportingWorkerBuildVersionEvidenceToAuthorization,
  evaluateProtectedReportingWorkerBuildVersionEvidence,
  parseReportingWorkerBuildVersionEvidenceArgs,
  parseReportingWorkerBuildVersionEvidenceJson,
  prepareReportingWorkerBuildVersionEvidence,
  type ReportingWorkerBuildVersionAuthorizationSnapshot,
  type ReportingWorkerBuildVersionEvidence,
} from '../../scripts/canonical/reporting-worker-build-version-evidence';
import {
  buildCanonicalImportCommandId,
  buildFeatureFlagCommandId,
  buildMigrationCommandId,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from '../../scripts/canonical/production-cutover-contract';
import { createReadyReportingAuthorization } from './fixtures/reporting-authorization-fixture';
import { createReadyReportingForeignKeyDispositionEvidence } from './fixtures/reporting-fk-disposition-evidence-fixture';
import { createReadyReportingMaintenanceRecoveryEvidence } from './fixtures/reporting-maintenance-recovery-evidence-fixture';
import {
  WORKER_BUILD_VERSION_EVIDENCE_NOW,
  createReadyReportingWorkerBuildVersionEvidence,
} from './fixtures/reporting-worker-build-version-evidence-fixture';
import { prepareReportingForeignKeyDispositionEvidence } from '../../scripts/canonical/reporting-fk-disposition-evidence';
import { prepareReportingMaintenanceRecoveryEvidence } from '../../scripts/canonical/reporting-maintenance-recovery-evidence';

const temporaryRoots: string[] = [];

function protectedFile(value: unknown, filename = 'evidence.json'): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-worker-build-version-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const path = join(root, filename);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
  return { root, path };
}

function applyWorkerSnapshot(
  authorization: ReportingCutoverAuthorization,
  snapshot: ReportingWorkerBuildVersionAuthorizationSnapshot,
): void {
  authorization.workerBuildVersionEvidence = structuredClone(snapshot.workerBuildVersionEvidence);
  authorization.deployment = { authorized: true, ...structuredClone(snapshot.deployment) };
  authorization.migrations.repositoryManifestSha256 = snapshot.migrationRepositoryManifestSha256;
}

function applyMaintenanceSnapshot(
  authorization: ReportingCutoverAuthorization,
  snapshot: NonNullable<ReturnType<typeof prepareReportingMaintenanceRecoveryEvidence>['authorizationSnapshot']>,
): void {
  authorization.issuedAtUtc = snapshot.issuedAtUtc;
  authorization.expiresAtUtc = snapshot.expiresAtUtc;
  authorization.maintenanceWindowStartUtc = snapshot.maintenanceWindowStartUtc;
  authorization.maintenanceWindowEndUtc = snapshot.maintenanceWindowEndUtc;
  authorization.authorizationApproval = structuredClone(snapshot.authorizationApproval);
  authorization.rollbackOwner = structuredClone(snapshot.rollbackOwner);
  authorization.observationOwner = structuredClone(snapshot.observationOwner);
  authorization.rollbackPolicy = structuredClone(snapshot.rollbackPolicy);
  authorization.exportEvidence = structuredClone(snapshot.exportEvidence);
  authorization.productionImport.sourceExportSha256 = snapshot.productionImportSourceExportSha256;
  authorization.maintenanceRecoveryEvidence = structuredClone(snapshot.maintenanceRecoveryEvidence);
}

function shiftToCurrent(
  worker: ReportingWorkerBuildVersionEvidence,
  maintenance: ReturnType<typeof createReadyReportingMaintenanceRecoveryEvidence>,
): void {
  const now = Date.now();
  const iso = (offset: number): string => new Date(now + offset).toISOString();
  worker.repository.capturedAtUtc = iso(-18 * 60_000);
  worker.build.completedAtUtc = iso(-16 * 60_000);
  worker.candidateVersion.createdAtUtc = iso(-15 * 60_000);
  worker.candidateVersion.capturedAtUtc = iso(-14 * 60_000);
  worker.previousVersion.createdAtUtc = iso(-24 * 60 * 60_000);
  worker.previousVersion.capturedAtUtc = iso(-13 * 60_000);
  worker.routing.capturedAtUtc = iso(-12 * 60_000);
  worker.deploymentAuthorization.approvedAtUtc = iso(-(11 * 60_000 + 30_000));
  worker.generatedAtUtc = iso(-11 * 60_000);

  maintenance.authorizationIssuedAtUtc = iso(-10 * 60_000);
  maintenance.authorizationApproval.approvedAtUtc = iso(-9 * 60_000);
  maintenance.maintenanceWindow.approvedAtUtc = iso(-8 * 60_000);
  maintenance.owners.rollback.primaryAcknowledgedAtUtc = iso(-7 * 60_000);
  maintenance.owners.rollback.backupAcknowledgedAtUtc = iso(-6 * 60_000);
  maintenance.owners.observation.primaryAcknowledgedAtUtc = iso(-5 * 60_000);
  maintenance.owners.observation.backupAcknowledgedAtUtc = iso(-4 * 60_000);
  maintenance.rollbackPolicy.reviewedAtUtc = iso(-3 * 60_000);
  maintenance.recovery.export.capturedAtUtc = iso(-2 * 60_000);
  maintenance.recovery.timeTravel.capturedAtUtc = iso(-90_000);
  maintenance.generatedAtUtc = iso(-60_000);
  maintenance.maintenanceWindow.startUtc = iso(-30_000);
  maintenance.maintenanceWindow.endUtc = iso(30 * 60_000);
  maintenance.maintenanceWindow.expiresAtUtc = iso(60 * 60_000);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-101 Worker build/version evidence', () => {
  it('accepts an exact zero-traffic candidate and active rollback baseline', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    const prepared = prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW);
    expect(prepared.receipt).toMatchObject({
      documentReady: true,
      evidenceReady: true,
      issueCount: 0,
      candidateVersionNumber: 1126,
      previousVersionNumber: 1125,
      candidateTrafficPercentage: 0,
      previousTrafficPercentage: 100,
      artifactSizeBytes: 987654,
      routeCount: 4,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficAssignmentPerformed: false,
    });
    expect(prepared.receipt.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.receipt.authorizationSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.authorizationSnapshot?.deployment).toMatchObject({
      authorized: true,
      candidateCommit: input.repository.candidateCommit,
      candidateWorkerVersionId: input.candidateVersion.versionId,
      previousWorkerVersionId: input.previousVersion.versionId,
      buildManifestSha256: input.build.manifestSha256,
      routeFingerprintSha256: input.routing.routeFingerprintSha256,
      activeRoutesUnchangedEvidenceId: input.routing.activeRoutesUnchangedEvidenceId,
    });
    const serializedReceipt = JSON.stringify(prepared.receipt);
    expect(serializedReceipt).not.toContain(input.candidateVersion.versionId!);
    expect(serializedReceipt).not.toContain(input.deploymentAuthorization.ownerId!);
    expect(serializedReceipt).not.toContain(input.deploymentAuthorization.evidenceId!);
  });

  it('rejects identity, config, or route drift', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    input.worker.serviceName = 'different-worker';
    input.worker.compatibilityDate = '2025-01-01';
    input.worker.routes = ['admin.ozzyl.com/*'];
    expect(prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_WORKER_BUILD_IDENTITY_MISMATCH',
        'CDB101_WORKER_ROUTE_SCOPE_INVALID',
      ]));
  });

  it('rejects dirty/incomplete builds and a broken commit-manifest chain', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    input.repository.cleanWorkingTreeConfirmed = false;
    input.build.completed = false;
    input.build.testsPassedConfirmed = false;
    input.build.uploadPerformedByEvidenceCapture = true;
    input.candidateVersion.sourceCommit = 'f'.repeat(40);
    input.candidateVersion.buildManifestSha256 = '0'.repeat(64);
    expect(prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_WORKER_REPOSITORY_EVIDENCE_INVALID',
        'CDB101_WORKER_BUILD_EVIDENCE_INVALID',
        'CDB101_WORKER_BUILD_CHAIN_MISMATCH',
      ]));
  });

  it('rejects missing or malformed deployment authorization evidence', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    input.deploymentAuthorization.authorized = false;
    input.deploymentAuthorization.scope = 'version_upload_only';
    input.deploymentAuthorization.ownerId = null;
    input.deploymentAuthorization.approvedAtUtc = null;
    input.deploymentAuthorization.evidenceId = null;
    input.deploymentAuthorization.evidenceSha256 = null;
    expect(prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_WORKER_DEPLOYMENT_AUTHORIZATION_INVALID');
  });

  it('rejects candidate traffic, partial previous traffic, and non-monotonic versions', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    input.candidateVersion.trafficPercentage = 1;
    input.candidateVersion.trafficAssigned = true;
    input.candidateVersion.deploymentPerformed = true;
    input.previousVersion.trafficPercentage = 99;
    input.previousVersion.active = false;
    input.candidateVersion.versionNumber = 1125;
    expect(prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_WORKER_CANDIDATE_TRAFFIC_UNSAFE',
        'CDB101_WORKER_PREVIOUS_VERSION_INVALID',
        'CDB101_WORKER_VERSION_ORDER_INVALID',
      ]));
  });

  it('rejects identical or stale candidate/previous versions', () => {
    const identical = createReadyReportingWorkerBuildVersionEvidence();
    identical.candidateVersion.versionId = identical.previousVersion.versionId;
    expect(prepareReportingWorkerBuildVersionEvidence(identical, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_WORKER_VERSION_ORDER_INVALID');

    const stale = createReadyReportingWorkerBuildVersionEvidence();
    stale.candidateVersion.versionNumber = 1124;
    expect(prepareReportingWorkerBuildVersionEvidence(stale, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_WORKER_VERSION_ORDER_INVALID');
  });

  it('rejects malformed immutable identifiers and hashes', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    input.repository.candidateCommit = 'short';
    input.repository.packageJsonSha256 = 'not-a-sha';
    input.candidateVersion.versionId = 'not-a-uuid';
    input.candidateVersion.scriptEtag = 'bad-etag';
    input.previousVersion.versionId = 'still-not-a-uuid';
    input.previousVersion.scriptEtag = 'bad-etag';
    input.routing.routeFingerprintSha256 = 'bad-route-hash';
    expect(prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_WORKER_REPOSITORY_EVIDENCE_INVALID',
        'CDB101_WORKER_CANDIDATE_VERSION_INVALID',
        'CDB101_WORKER_PREVIOUS_VERSION_INVALID',
        'CDB101_WORKER_ROUTING_EVIDENCE_INVALID',
      ]));
  });

  it('rejects invalid chronology', () => {
    const input = createReadyReportingWorkerBuildVersionEvidence();
    input.build.completedAtUtc = '2026-07-14T15:20:00.000Z';
    input.candidateVersion.createdAtUtc = '2026-07-14T15:10:00.000Z';
    input.generatedAtUtc = '2026-07-14T16:01:00.000Z';
    expect(prepareReportingWorkerBuildVersionEvidence(input, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_WORKER_BUILD_VERSION_CHRONOLOGY_INVALID');
  });

  it('rejects duplicate, sensitive, unknown, unsafe, oversized, and deep documents', () => {
    const ready = JSON.stringify(createReadyReportingWorkerBuildVersionEvidence());
    const duplicate = ready.replace(
      '"evidenceId":"cdb101-worker-build-version-20260714-01"',
      '"evidenceId":"one","evidenceId":"two"',
    );
    expect(parseReportingWorkerBuildVersionEvidenceJson(duplicate).issues.map((item) => item.code))
      .toContain('CDB101_WORKER_EVIDENCE_DOCUMENT_DUPLICATE_KEY');

    const repeated = createReadyReportingWorkerBuildVersionEvidence();
    repeated.previousVersion.metadataEvidenceId = repeated.candidateVersion.metadataEvidenceId;
    repeated.previousVersion.metadataEvidenceSha256 = repeated.candidateVersion.metadataEvidenceSha256;
    expect(prepareReportingWorkerBuildVersionEvidence(repeated, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_WORKER_EVIDENCE_BINDING_INVALID');

    const sensitive = JSON.stringify({ ...createReadyReportingWorkerBuildVersionEvidence(), headers: {} });
    expect(parseReportingWorkerBuildVersionEvidenceJson(sensitive).issues.map((item) => item.code))
      .toContain('CDB101_WORKER_EVIDENCE_DOCUMENT_SENSITIVE_FIELD');
    const unknown = JSON.stringify({ ...createReadyReportingWorkerBuildVersionEvidence(), note: 'value' });
    expect(parseReportingWorkerBuildVersionEvidenceJson(unknown).issues.map((item) => item.code))
      .toContain('CDB101_WORKER_EVIDENCE_DOCUMENT_UNKNOWN_FIELD');
    const unsafe = ready.replace('"worker":{', '"worker":{"__proto__":{"x":true},');
    expect(parseReportingWorkerBuildVersionEvidenceJson(unsafe).issues.map((item) => item.code))
      .toContain('CDB101_WORKER_EVIDENCE_DOCUMENT_UNSAFE_KEY');
    const oversized = `${ready.slice(0, -1)},"padding":"${'x'.repeat(400_000)}"}`;
    expect(parseReportingWorkerBuildVersionEvidenceJson(oversized).issues.map((item) => item.code))
      .toContain('CDB101_WORKER_EVIDENCE_DOCUMENT_TOO_LARGE');
    let deep: unknown = true;
    for (let index = 0; index < 70; index += 1) deep = { nested: deep };
    expect(parseReportingWorkerBuildVersionEvidenceJson(JSON.stringify(deep)).issues.map((item) => item.code))
      .toContain('CDB101_WORKER_EVIDENCE_DOCUMENT_TOO_DEEP');
  });

  it('accepts only protected evidence files outside the repository', () => {
    const fixture = protectedFile(createReadyReportingWorkerBuildVersionEvidence());
    expect(evaluateProtectedReportingWorkerBuildVersionEvidence(
      fixture.path, process.cwd(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ).evidenceReady).toBe(true);
    chmodSync(fixture.path, 0o644);
    expect(evaluateProtectedReportingWorkerBuildVersionEvidence(
      fixture.path, process.cwd(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_WORKER_EVIDENCE_FILE_PROTECTION_INVALID');
    chmodSync(fixture.path, 0o600);
    chmodSync(fixture.root, 0o755);
    expect(evaluateProtectedReportingWorkerBuildVersionEvidence(
      fixture.path, process.cwd(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_WORKER_EVIDENCE_FILE_PROTECTION_INVALID');

    const template = resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-worker-build-version-evidence-template.json');
    expect(evaluateProtectedReportingWorkerBuildVersionEvidence(
      template, process.cwd(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_WORKER_EVIDENCE_FILE_INSIDE_REPOSITORY');

    const linked = protectedFile(createReadyReportingWorkerBuildVersionEvidence(), 'source.json');
    const symlinkPath = join(linked.root, 'linked.json');
    symlinkSync(linked.path, symlinkPath);
    expect(evaluateProtectedReportingWorkerBuildVersionEvidence(
      symlinkPath, process.cwd(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_WORKER_EVIDENCE_FILE_PROTECTION_INVALID');
    const hardLinkPath = join(linked.root, 'hard-linked.json');
    linkSync(linked.path, hardLinkPath);
    expect(evaluateProtectedReportingWorkerBuildVersionEvidence(
      hardLinkPath, process.cwd(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_WORKER_EVIDENCE_FILE_PROTECTION_INVALID');
  });

  it('runs offline and refuses execution arguments', () => {
    const fixture = protectedFile(createReadyReportingWorkerBuildVersionEvidence());
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const result = spawnSync(executable, [
      'scripts/canonical/validate-reporting-worker-build-version-evidence.ts',
      '--evidence', fixture.path,
      '--at-utc', WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      evidenceReady: true,
      candidateTrafficPercentage: 0,
      previousTrafficPercentage: 100,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficAssignmentPerformed: false,
    });
    expect(result.stdout).not.toContain(fixture.root);
    const refused = spawnSync(executable, [
      'scripts/canonical/validate-reporting-worker-build-version-evidence.ts', '--execute',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('validation failed');
  });

  it('parses only the exact CLI contract', () => {
    expect(parseReportingWorkerBuildVersionEvidenceArgs([
      '--', '--evidence', '/protected/worker.json', '--at-utc', WORKER_BUILD_VERSION_EVIDENCE_NOW,
    ])).toEqual({ evidencePath: '/protected/worker.json', atUtc: WORKER_BUILD_VERSION_EVIDENCE_NOW });
    expect(() => parseReportingWorkerBuildVersionEvidenceArgs([])).toThrow(/required/i);
    expect(() => parseReportingWorkerBuildVersionEvidenceArgs(['position'])).toThrow(/unknown/i);
  });

  it('binds evidence to authorization and deterministic command IDs', () => {
    const prepared = prepareReportingWorkerBuildVersionEvidence(
      createReadyReportingWorkerBuildVersionEvidence(), WORKER_BUILD_VERSION_EVIDENCE_NOW,
    );
    const authorization = createReadyReportingAuthorization();
    applyWorkerSnapshot(authorization, prepared.authorizationSnapshot!);
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);
    expect(bindReportingWorkerBuildVersionEvidenceToAuthorization(prepared, authorization).receipt.evidenceReady).toBe(true);
    expect(validateReportingCutoverAuthorization(authorization, WORKER_BUILD_VERSION_EVIDENCE_NOW).issues.map((item) => item.code))
      .not.toContain('CDB101_WORKER_BUILD_VERSION_EVIDENCE_INVALID');
    const migrationId = authorization.migrations.commandId;
    const importId = authorization.productionImport.commandId;
    const flagId = authorization.featureFlagPlan.commandId;
    const deploymentDisabled = structuredClone(authorization);
    deploymentDisabled.deployment.authorized = false;
    expect(buildMigrationCommandId(deploymentDisabled)).not.toBe(migrationId);
    expect(buildCanonicalImportCommandId(deploymentDisabled)).not.toBe(importId);
    expect(buildFeatureFlagCommandId(deploymentDisabled)).not.toBe(flagId);
    expect(bindReportingWorkerBuildVersionEvidenceToAuthorization(prepared, deploymentDisabled).receipt.issueCodes)
      .toContain('CDB101_WORKER_AUTHORIZATION_BINDING_MISMATCH');
    authorization.workerBuildVersionEvidence.evidenceSha256 = 'f'.repeat(64);
    expect(buildMigrationCommandId(authorization)).not.toBe(migrationId);
    expect(buildCanonicalImportCommandId(authorization)).not.toBe(importId);
    expect(buildFeatureFlagCommandId(authorization)).not.toBe(flagId);
    expect(bindReportingWorkerBuildVersionEvidenceToAuthorization(prepared, authorization).receipt.issueCodes)
      .toContain('CDB101_WORKER_AUTHORIZATION_BINDING_MISMATCH');
  });

  it('blocks every wrapper before external processes on Worker evidence mismatch', () => {
    const worker = createReadyReportingWorkerBuildVersionEvidence();
    const maintenance = createReadyReportingMaintenanceRecoveryEvidence();
    shiftToCurrent(worker, maintenance);
    const workerPrepared = prepareReportingWorkerBuildVersionEvidence(worker, new Date().toISOString());
    const maintenancePrepared = prepareReportingMaintenanceRecoveryEvidence(maintenance, new Date().toISOString());
    const fk = createReadyReportingForeignKeyDispositionEvidence();
    const fkPrepared = prepareReportingForeignKeyDispositionEvidence(fk, new Date().toISOString());
    expect(workerPrepared.receipt.evidenceReady).toBe(true);
    expect(maintenancePrepared.receipt.evidenceReady).toBe(true);
    expect(fkPrepared.receipt.evidenceReady).toBe(true);

    const fixture = protectedFile(worker, 'worker.json');
    const maintenancePath = join(fixture.root, 'maintenance.json');
    const fkPath = join(fixture.root, 'fk.json');
    writeFileSync(maintenancePath, JSON.stringify(maintenance), { mode: 0o600 });
    writeFileSync(fkPath, JSON.stringify(fk), { mode: 0o600 });
    chmodSync(maintenancePath, 0o600);
    chmodSync(fkPath, 0o600);

    const authorization = createReadyReportingAuthorization();
    applyWorkerSnapshot(authorization, workerPrepared.authorizationSnapshot!);
    applyMaintenanceSnapshot(authorization, maintenancePrepared.authorizationSnapshot!);
    authorization.foreignKeyDisposition.evidenceId = fk.evidenceId;
    authorization.foreignKeyDisposition.evidenceSha256 = fkPrepared.receipt.evidenceSha256;
    authorization.foreignKeyDisposition.groups = fkPrepared.authorizationGroups!;
    authorization.workerBuildVersionEvidence.evidenceSha256 = '0'.repeat(64);
    authorization.featureFlagPlan.effectiveAtUtc = new Date(Date.now() + 5 * 60_000).toISOString();
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);
    const authorizationPath = join(fixture.root, 'authorization.json');
    writeFileSync(authorizationPath, JSON.stringify(authorization), { mode: 0o600 });
    chmodSync(authorizationPath, 0o600);

    const binDir = join(fixture.root, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    chmodSync(binDir, 0o700);
    const marker = join(fixture.root, 'child-invoked.txt');
    const fakePnpm = join(binDir, 'pnpm');
    writeFileSync(fakePnpm, `#!/bin/sh\nprintf invoked > "${marker}"\nexit 99\n`, { mode: 0o700 });
    chmodSync(fakePnpm, 0o700);
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` };
    const commands = [
      ['scripts/canonical/apply-production-canonical-migrations.ts', '--authorization', authorizationPath, '--fk-evidence', fkPath, '--maintenance-recovery-evidence', maintenancePath, '--worker-build-version-evidence', fixture.path, '--execute'],
      ['scripts/canonical/import-production-canonical-bundle.ts', '--authorization', authorizationPath, '--fk-evidence', fkPath, '--maintenance-recovery-evidence', maintenancePath, '--worker-build-version-evidence', fixture.path, '--bundle', join(fixture.root, 'bundle.sql'), '--manifest', join(fixture.root, 'manifest.json'), '--source-export', join(fixture.root, 'source.sql'), '--execute'],
      ['scripts/canonical/set-production-canonical-flag.ts', '--authorization', authorizationPath, '--fk-evidence', fkPath, '--maintenance-recovery-evidence', maintenancePath, '--worker-build-version-evidence', fixture.path, '--processing-evidence', fixture.path, '--effective-at-utc', authorization.featureFlagPlan.effectiveAtUtc!, '--updated-by', authorization.featureFlagPlan.updatedByPublicId!, '--execute'],
    ];
    for (const args of commands) {
      const result = spawnSync(executable, args, { cwd: process.cwd(), encoding: 'utf8', env });
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('CDB101_WORKER_AUTHORIZATION_BINDING_MISMATCH');
      expect(result.stdout).toContain('"networkRequestPerformed": false');
      expect(result.stdout).toContain('"productionMutationPerformed": false');
      expect(result.stderr).toBe('');
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('keeps the repository template structurally exact and fail-closed', () => {
    const text = readFileSync(
      resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-worker-build-version-evidence-template.json'),
      'utf8',
    );
    const parsed = parseReportingWorkerBuildVersionEvidenceJson(text);
    expect(parsed.documentReady).toBe(true);
    expect(parsed.evidence).not.toBeNull();
    expect(prepareReportingWorkerBuildVersionEvidence(parsed.evidence!, WORKER_BUILD_VERSION_EVIDENCE_NOW).receipt.evidenceReady)
      .toBe(false);
  });
});

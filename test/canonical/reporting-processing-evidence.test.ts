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
  CDB101_PROCESSING_CHECK_IDS,
  evaluateProtectedReportingProcessingEvidence,
  parseReportingProcessingEvidenceArgs,
  parseReportingProcessingEvidenceJson,
  prepareProtectedReportingProcessingEvidenceForAuthorization,
  prepareReportingProcessingEvidence,
  type ReportingProcessingEvidence,
} from '../../scripts/canonical/reporting-processing-evidence';
import { parseProductionReportingFlagArgs } from '../../scripts/canonical/set-production-canonical-flag';
import { buildReportingCutoverOperationsPlan } from '../../scripts/canonical/reporting-cutover-operations';
import {
  buildCanonicalImportCommandId,
  buildFeatureFlagCommandId,
  buildMigrationCommandId,
  type ReportingCutoverAuthorization,
} from '../../scripts/canonical/production-cutover-contract';
import { prepareReportingForeignKeyDispositionEvidence } from '../../scripts/canonical/reporting-fk-disposition-evidence';
import { prepareReportingMaintenanceRecoveryEvidence } from '../../scripts/canonical/reporting-maintenance-recovery-evidence';
import { prepareReportingWorkerBuildVersionEvidence } from '../../scripts/canonical/reporting-worker-build-version-evidence';
import { createReadyReportingAuthorization } from './fixtures/reporting-authorization-fixture';
import { createReadyReportingForeignKeyDispositionEvidence } from './fixtures/reporting-fk-disposition-evidence-fixture';
import { createReadyReportingMaintenanceRecoveryEvidence } from './fixtures/reporting-maintenance-recovery-evidence-fixture';
import {
  PROCESSING_EVIDENCE_NOW,
  createReadyReportingProcessingEvidence,
} from './fixtures/reporting-processing-evidence-fixture';
import { createReadyReportingWorkerBuildVersionEvidence } from './fixtures/reporting-worker-build-version-evidence-fixture';

const temporaryRoots: string[] = [];

function protectedFiles(values: Record<string, unknown>): { root: string; paths: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-processing-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const paths: Record<string, string> = {};
  for (const [filename, value] of Object.entries(values)) {
    const path = join(root, filename);
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
    chmodSync(path, 0o600);
    paths[filename] = path;
  }
  return { root, paths };
}

function check(evidence: ReportingProcessingEvidence, checkId: string) {
  const item = evidence.checks.find((candidate) => candidate.checkId === checkId);
  if (!item) throw new Error(`Missing processing check ${checkId}`);
  return item;
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

function applyWorkerSnapshot(
  authorization: ReportingCutoverAuthorization,
  snapshot: NonNullable<ReturnType<typeof prepareReportingWorkerBuildVersionEvidence>['authorizationSnapshot']>,
): void {
  authorization.workerBuildVersionEvidence = structuredClone(snapshot.workerBuildVersionEvidence);
  authorization.deployment = { authorized: true, ...structuredClone(snapshot.deployment) };
  authorization.migrations.repositoryManifestSha256 = snapshot.migrationRepositoryManifestSha256;
}

function shiftPrerequisitesToCurrent(): {
  authorization: ReportingCutoverAuthorization;
  fk: ReturnType<typeof createReadyReportingForeignKeyDispositionEvidence>;
  maintenance: ReturnType<typeof createReadyReportingMaintenanceRecoveryEvidence>;
  worker: ReturnType<typeof createReadyReportingWorkerBuildVersionEvidence>;
  processing: ReportingProcessingEvidence;
} {
  const now = Date.now();
  const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
  const worker = createReadyReportingWorkerBuildVersionEvidence();
  worker.repository.capturedAtUtc = iso(-18 * 60_000);
  worker.build.completedAtUtc = iso(-16 * 60_000);
  worker.candidateVersion.createdAtUtc = iso(-15 * 60_000);
  worker.candidateVersion.capturedAtUtc = iso(-14 * 60_000);
  worker.previousVersion.createdAtUtc = iso(-24 * 60 * 60_000);
  worker.previousVersion.capturedAtUtc = iso(-13 * 60_000);
  worker.routing.capturedAtUtc = iso(-12 * 60_000);
  worker.deploymentAuthorization.approvedAtUtc = iso(-(11 * 60_000 + 30_000));
  worker.generatedAtUtc = iso(-11 * 60_000);

  const maintenance = createReadyReportingMaintenanceRecoveryEvidence();
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

  const preparedWorker = prepareReportingWorkerBuildVersionEvidence(worker, iso(0));
  const preparedMaintenance = prepareReportingMaintenanceRecoveryEvidence(maintenance, iso(0));
  const fk = createReadyReportingForeignKeyDispositionEvidence();
  const preparedFk = prepareReportingForeignKeyDispositionEvidence(fk, iso(0));
  if (!preparedWorker.authorizationSnapshot || !preparedMaintenance.authorizationSnapshot || !preparedFk.authorizationGroups) {
    throw new Error('Failed to prepare prerequisite evidence');
  }

  const authorization = createReadyReportingAuthorization();
  applyWorkerSnapshot(authorization, preparedWorker.authorizationSnapshot);
  applyMaintenanceSnapshot(authorization, preparedMaintenance.authorizationSnapshot);
  authorization.foreignKeyDisposition.evidenceId = fk.evidenceId;
  authorization.foreignKeyDisposition.evidenceSha256 = preparedFk.receipt.evidenceSha256;
  authorization.foreignKeyDisposition.groups = preparedFk.authorizationGroups;
  authorization.featureFlagPlan.effectiveAtUtc = iso(5 * 60_000);
  authorization.migrations.commandId = buildMigrationCommandId(authorization);
  authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
  authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);

  const processing = createReadyReportingProcessingEvidence(authorization);
  processing.scope.migrationsCompletedAtUtc = iso(-25_000);
  processing.scope.importCompletedAtUtc = iso(-20_000);
  processing.scope.secondPassCompletedAtUtc = iso(-15_000);
  processing.scope.observationStartedAtUtc = iso(-14_000);
  processing.checks.forEach((item, index) => {
    item.completedAtUtc = iso(-13_000 + index * 1_000);
  });
  processing.scope.observationEndedAtUtc = iso(-6_000);
  processing.generatedAtUtc = iso(-5_000);
  return { authorization, fk, maintenance, worker, processing };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-101 processing evidence boundary', () => {
  it('accepts clean authorization-bound post-import evidence', () => {
    const authorization = createReadyReportingAuthorization();
    const evidence = createReadyReportingProcessingEvidence(authorization);
    const receipt = prepareReportingProcessingEvidence(evidence, authorization, PROCESSING_EVIDENCE_NOW).receipt;
    expect(receipt).toMatchObject({
      documentReady: true,
      evidenceReady: true,
      authorizationBound: true,
      shadowFlagReady: true,
      issueCount: 0,
      checkCount: 7,
      observedTableCount: authorization.productionImport.allowedTables.length,
      queryCount: 14,
      unresolvedCriticalExceptionCount: 0,
      blockedOutboxCount: 0,
      blockedAccountingCount: 0,
      duplicatePublicIdCount: 0,
      unsafeIntegerCount: 0,
      tenantIsolationViolationCount: 0,
      secondPassInsertedRowCount: 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(authorization.authorizationId!);
    expect(serialized).not.toContain(authorization.productionImport.commandId!);
    expect(serialized).not.toContain(evidence.evidenceId!);
    expect(serialized).not.toContain(evidence.scope.deterministicRunId!);
    expect(serialized).not.toContain(authorization.productionImport.allowedTables[0]);
  });

  it('keeps valid non-zero findings audit-ready but blocks the shadow flag', () => {
    const authorization = createReadyReportingAuthorization();
    const evidence = createReadyReportingProcessingEvidence(authorization);
    check(evidence, 'blocked_outbox').observedCount = 2;
    const receipt = prepareReportingProcessingEvidence(evidence, authorization, PROCESSING_EVIDENCE_NOW).receipt;
    expect(receipt).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      shadowFlagReady: false,
      blockedOutboxCount: 2,
      issueCount: 0,
    });
  });

  it('rejects missing, reordered, duplicate, or malformed checks', () => {
    const authorization = createReadyReportingAuthorization();
    const missing = createReadyReportingProcessingEvidence(authorization);
    missing.checks.pop();
    expect(prepareReportingProcessingEvidence(missing, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_CHECK_SCOPE_INVALID');

    const reordered = createReadyReportingProcessingEvidence(authorization);
    [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1], reordered.checks[0]];
    expect(prepareReportingProcessingEvidence(reordered, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_CHECK_SCOPE_INVALID');

    const invalidCount = createReadyReportingProcessingEvidence(authorization);
    invalidCount.checks[0].observedCount = -1;
    expect(prepareReportingProcessingEvidence(invalidCount, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_COUNT_INVALID');
  });

  it('rejects table coverage drift, mutating proof, duplicate bindings, and bad chronology', () => {
    const authorization = createReadyReportingAuthorization();
    const tableDrift = createReadyReportingProcessingEvidence(authorization);
    tableDrift.observedTableNames.reverse();
    expect(prepareReportingProcessingEvidence(tableDrift, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_TABLE_SCOPE_INVALID');

    const mutating = createReadyReportingProcessingEvidence(authorization);
    mutating.readOnlyProof.rowsWritten = 1;
    mutating.readOnlyProof.allQueriesReadOnly = false;
    expect(prepareReportingProcessingEvidence(mutating, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_READ_ONLY_PROOF_INVALID');

    const duplicate = createReadyReportingProcessingEvidence(authorization);
    duplicate.checks[1].evidenceId = duplicate.checks[0].evidenceId;
    duplicate.checks[1].evidenceSha256 = duplicate.checks[0].evidenceSha256;
    expect(prepareReportingProcessingEvidence(duplicate, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_BINDING_INVALID');

    const chronology = createReadyReportingProcessingEvidence(authorization);
    chronology.scope.importCompletedAtUtc = '2026-07-14T16:01:00.000Z';
    expect(prepareReportingProcessingEvidence(chronology, authorization, PROCESSING_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_PROCESSING_CHRONOLOGY_INVALID');
  });

  it('exact-binds immutable authorization, import, and shadow-plan scope', () => {
    const mutations: Array<(evidence: ReportingProcessingEvidence) => void> = [
      (evidence) => { evidence.authorizationId = 'different-authorization'; },
      (evidence) => { evidence.scope.productionDatabaseId = '11111111-1111-4111-8111-111111111111'; },
      (evidence) => { evidence.scope.tenantId = '101'; },
      (evidence) => { evidence.scope.domain = 'billing'; },
      (evidence) => { evidence.scope.migrationCommandId = 'different-migration-command'; },
      (evidence) => { evidence.scope.importCommandId = 'different-import-command'; },
      (evidence) => { evidence.scope.featureFlagCommandId = 'different-flag-command'; },
      (evidence) => { evidence.scope.featureFlagEffectiveAtUtc = '2026-07-14T16:31:00.000Z'; },
      (evidence) => { evidence.scope.authorizationExpiresAtUtc = '2026-07-14T18:31:00.000Z'; },
      (evidence) => { evidence.scope.deterministicRunId = 'different-run'; },
      (evidence) => { evidence.scope.bundleSha256 = '9'.repeat(64); },
      (evidence) => { evidence.scope.manifestSha256 = '9'.repeat(64); },
      (evidence) => { evidence.scope.sourceExportSha256 = '9'.repeat(64); },
      (evidence) => { evidence.scope.allowedTables.reverse(); },
    ];
    for (const mutate of mutations) {
      const authorization = createReadyReportingAuthorization();
      const evidence = createReadyReportingProcessingEvidence(authorization);
      mutate(evidence);
      const receipt = prepareReportingProcessingEvidence(evidence, authorization, PROCESSING_EVIDENCE_NOW).receipt;
      expect(receipt.authorizationBound).toBe(false);
      expect(receipt.shadowFlagReady).toBe(false);
      expect(receipt.issueCodes).toContain('CDB101_PROCESSING_AUTHORIZATION_BINDING_MISMATCH');
    }
  });

  it('rejects authorization expiry and observations after the planned flag time', () => {
    const expiredAuthorization = createReadyReportingAuthorization();
    expiredAuthorization.expiresAtUtc = '2026-07-14T16:24:30.000Z';
    const expiredEvidence = createReadyReportingProcessingEvidence(expiredAuthorization);
    expect(prepareReportingProcessingEvidence(
      expiredEvidence,
      expiredAuthorization,
      PROCESSING_EVIDENCE_NOW,
    ).receipt.authorizationBound).toBe(false);

    const authorization = createReadyReportingAuthorization();
    const late = createReadyReportingProcessingEvidence(authorization);
    late.scope.observationEndedAtUtc = '2026-07-14T16:31:00.000Z';
    late.generatedAtUtc = '2026-07-14T16:31:30.000Z';
    expect(prepareReportingProcessingEvidence(late, authorization, '2026-07-14T16:32:00.000Z').receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_PROCESSING_CHRONOLOGY_INVALID',
        'CDB101_PROCESSING_AUTHORIZATION_TIMING_INVALID',
      ]));
  });

  it('rejects duplicate, sensitive, unknown, unsafe, oversized, and deep documents', () => {
    const ready = JSON.stringify(createReadyReportingProcessingEvidence());
    const duplicate = ready.replace(
      '"evidenceId":"cdb101-processing-evidence-20260715-01"',
      '"evidenceId":"one","evidenceId":"two"',
    );
    expect(parseReportingProcessingEvidenceJson(duplicate).issues.map((item) => item.code))
      .toContain('CDB101_PROCESSING_DOCUMENT_DUPLICATE_KEY');
    expect(parseReportingProcessingEvidenceJson(JSON.stringify({
      ...createReadyReportingProcessingEvidence(), headers: {},
    })).issues.map((item) => item.code)).toContain('CDB101_PROCESSING_DOCUMENT_SENSITIVE_FIELD');
    expect(parseReportingProcessingEvidenceJson(JSON.stringify({
      ...createReadyReportingProcessingEvidence(), note: 'value',
    })).issues.map((item) => item.code)).toContain('CDB101_PROCESSING_DOCUMENT_UNKNOWN_FIELD');
    expect(parseReportingProcessingEvidenceJson(
      ready.replace('"scope":{', '"scope":{"__proto__":{"x":true},'),
    ).issues.map((item) => item.code)).toContain('CDB101_PROCESSING_DOCUMENT_UNSAFE_KEY');
    expect(parseReportingProcessingEvidenceJson(
      `${ready.slice(0, -1)},"padding":"${'x'.repeat(400_000)}"}`,
    ).issues.map((item) => item.code)).toContain('CDB101_PROCESSING_DOCUMENT_TOO_LARGE');
    let deep: unknown = true;
    for (let index = 0; index < 70; index += 1) deep = { nested: deep };
    expect(parseReportingProcessingEvidenceJson(JSON.stringify(deep)).issues.map((item) => item.code))
      .toContain('CDB101_PROCESSING_DOCUMENT_TOO_DEEP');
  });

  it('accepts only protected evidence and authorization files outside the repository', () => {
    const authorization = createReadyReportingAuthorization();
    const fixture = protectedFiles({
      'processing.json': createReadyReportingProcessingEvidence(authorization),
      'authorization.json': authorization,
    });
    expect(evaluateProtectedReportingProcessingEvidence(
      fixture.paths['processing.json'],
      fixture.paths['authorization.json'],
      process.cwd(),
      PROCESSING_EVIDENCE_NOW,
    ).shadowFlagReady).toBe(true);

    chmodSync(fixture.paths['processing.json'], 0o644);
    expect(evaluateProtectedReportingProcessingEvidence(
      fixture.paths['processing.json'], fixture.paths['authorization.json'], process.cwd(), PROCESSING_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_PROCESSING_FILE_PROTECTION_INVALID');
    chmodSync(fixture.paths['processing.json'], 0o600);
    chmodSync(fixture.root, 0o755);
    expect(evaluateProtectedReportingProcessingEvidence(
      fixture.paths['processing.json'], fixture.paths['authorization.json'], process.cwd(), PROCESSING_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_PROCESSING_FILE_PROTECTION_INVALID');

    const linked = protectedFiles({
      'source.json': createReadyReportingProcessingEvidence(authorization),
      'authorization.json': authorization,
    });
    const symlinkPath = join(linked.root, 'symlink.json');
    symlinkSync(linked.paths['source.json'], symlinkPath);
    expect(evaluateProtectedReportingProcessingEvidence(
      symlinkPath, linked.paths['authorization.json'], process.cwd(), PROCESSING_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_PROCESSING_FILE_PROTECTION_INVALID');
    const hardLinkPath = join(linked.root, 'hard-link.json');
    linkSync(linked.paths['source.json'], hardLinkPath);
    expect(evaluateProtectedReportingProcessingEvidence(
      hardLinkPath, linked.paths['authorization.json'], process.cwd(), PROCESSING_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_PROCESSING_FILE_PROTECTION_INVALID');

    expect(evaluateProtectedReportingProcessingEvidence(
      resolve(process.cwd(), 'package.json'),
      fixture.paths['authorization.json'],
      process.cwd(),
      PROCESSING_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_PROCESSING_FILE_INSIDE_REPOSITORY');
  });

  it('binds protected evidence to the already-loaded authorization without re-reading an authorization path', () => {
    const authorization = createReadyReportingAuthorization();
    const fixture = protectedFiles({
      'processing.json': createReadyReportingProcessingEvidence(authorization),
    });
    expect(prepareProtectedReportingProcessingEvidenceForAuthorization(
      fixture.paths['processing.json'],
      process.cwd(),
      authorization,
      PROCESSING_EVIDENCE_NOW,
    ).receipt).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      shadowFlagReady: true,
    });

    const substituted = structuredClone(authorization);
    substituted.authorizationId = 'cdb101-reporting-substituted-window';
    substituted.migrations.commandId = buildMigrationCommandId(substituted);
    substituted.productionImport.commandId = buildCanonicalImportCommandId(substituted);
    substituted.featureFlagPlan.commandId = buildFeatureFlagCommandId(substituted);
    expect(prepareProtectedReportingProcessingEvidenceForAuthorization(
      fixture.paths['processing.json'],
      process.cwd(),
      substituted,
      PROCESSING_EVIDENCE_NOW,
    ).receipt).toMatchObject({
      authorizationBound: false,
      shadowFlagReady: false,
    });
  });

  it('runs the offline aggregate CLI and refuses execution arguments', () => {
    const authorization = createReadyReportingAuthorization();
    const fixture = protectedFiles({
      'processing.json': createReadyReportingProcessingEvidence(authorization),
      'authorization.json': authorization,
    });
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const result = spawnSync(executable, [
      'scripts/canonical/validate-reporting-processing-evidence.ts',
      '--evidence', fixture.paths['processing.json'],
      '--authorization', fixture.paths['authorization.json'],
      '--at-utc', PROCESSING_EVIDENCE_NOW,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      shadowFlagReady: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(result.stdout).not.toContain(fixture.root);

    const nonClean = createReadyReportingProcessingEvidence(authorization);
    check(nonClean, 'unsafe_integer_amounts').observedCount = 1;
    writeFileSync(fixture.paths['processing.json'], JSON.stringify(nonClean), { mode: 0o600 });
    chmodSync(fixture.paths['processing.json'], 0o600);
    const blocked = spawnSync(executable, [
      'scripts/canonical/validate-reporting-processing-evidence.ts',
      '--evidence', fixture.paths['processing.json'],
      '--authorization', fixture.paths['authorization.json'],
      '--at-utc', PROCESSING_EVIDENCE_NOW,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(blocked.status).toBe(2);
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      shadowFlagReady: false,
      unsafeIntegerCount: 1,
    });

    const refused = spawnSync(executable, [
      'scripts/canonical/validate-reporting-processing-evidence.ts', '--execute',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('validation failed');
  }, 10_000);

  it('parses only the exact processing and flag CLI contracts', () => {
    expect(parseReportingProcessingEvidenceArgs([
      '--', '--evidence', '/protected/processing.json',
      '--authorization', '/protected/authorization.json',
      '--at-utc', PROCESSING_EVIDENCE_NOW,
    ])).toEqual({
      evidencePath: '/protected/processing.json',
      authorizationPath: '/protected/authorization.json',
      atUtc: PROCESSING_EVIDENCE_NOW,
    });
    expect(() => parseReportingProcessingEvidenceArgs([])).toThrow(/required/i);
    expect(() => parseReportingProcessingEvidenceArgs(['position'])).toThrow(/unknown/i);
    expect(() => parseReportingProcessingEvidenceArgs([
      '--evidence', 'a', '--evidence', 'b', '--authorization', 'c',
    ])).toThrow(/duplicate/i);

    expect(parseProductionReportingFlagArgs([
      '--authorization', 'authorization.json',
      '--fk-evidence', 'fk.json',
      '--maintenance-recovery-evidence', 'maintenance.json',
      '--worker-build-version-evidence', 'worker.json',
      '--processing-evidence', 'processing.json',
      '--effective-at-utc', '2026-07-14T16:30:00.000Z',
      '--updated-by', 'operator',
      '--execute',
    ])).toMatchObject({ processingEvidencePath: 'processing.json', execute: true });
  });

  it('blocks the flag wrapper before any child process on mismatched or non-clean evidence', () => {
    const prepared = shiftPrerequisitesToCurrent();
    const mismatch = structuredClone(prepared.processing);
    mismatch.scope.importCommandId = 'different-import-command';
    const fixture = protectedFiles({
      'authorization.json': prepared.authorization,
      'fk.json': prepared.fk,
      'maintenance.json': prepared.maintenance,
      'worker.json': prepared.worker,
      'processing.json': mismatch,
    });
    const binDir = join(fixture.root, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    chmodSync(binDir, 0o700);
    const marker = join(fixture.root, 'child-invoked.txt');
    const fakePnpm = join(binDir, 'pnpm');
    writeFileSync(fakePnpm, `#!/bin/sh\nprintf invoked > "${marker}"\nexit 99\n`, { mode: 0o700 });
    chmodSync(fakePnpm, 0o700);
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const args = [
      'scripts/canonical/set-production-canonical-flag.ts',
      '--authorization', fixture.paths['authorization.json'],
      '--fk-evidence', fixture.paths['fk.json'],
      '--maintenance-recovery-evidence', fixture.paths['maintenance.json'],
      '--worker-build-version-evidence', fixture.paths['worker.json'],
      '--processing-evidence', fixture.paths['processing.json'],
      '--effective-at-utc', prepared.authorization.featureFlagPlan.effectiveAtUtc!,
      '--updated-by', prepared.authorization.featureFlagPlan.updatedByPublicId!,
      '--execute',
    ];
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      CDB101_PRODUCTION_CONFIRMATION: prepared.authorization.featureFlagPlan.commandId!,
    };
    const mismatchResult = spawnSync(executable, args, { cwd: process.cwd(), encoding: 'utf8', env });
    expect(mismatchResult.status).toBe(2);
    expect(mismatchResult.stdout).toContain('CDB101_PROCESSING_AUTHORIZATION_BINDING_MISMATCH');
    expect(existsSync(marker)).toBe(false);

    const nonClean = structuredClone(prepared.processing);
    check(nonClean, 'unresolved_critical_exceptions').observedCount = 1;
    writeFileSync(fixture.paths['processing.json'], JSON.stringify(nonClean), { mode: 0o600 });
    chmodSync(fixture.paths['processing.json'], 0o600);
    const nonCleanResult = spawnSync(executable, args, { cwd: process.cwd(), encoding: 'utf8', env });
    expect(nonCleanResult.status).toBe(2);
    expect(JSON.parse(nonCleanResult.stdout)).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      shadowFlagReady: false,
      unresolvedCriticalExceptionCount: 1,
    });
    expect(existsSync(marker)).toBe(false);

    chmodSync(fixture.paths['processing.json'], 0o644);
    const insecureResult = spawnSync(executable, args, { cwd: process.cwd(), encoding: 'utf8', env });
    expect(insecureResult.status).toBe(2);
    expect(insecureResult.stdout).toContain('CDB101_PROCESSING_FILE_PROTECTION_INVALID');
    expect(existsSync(marker)).toBe(false);
    chmodSync(fixture.paths['processing.json'], 0o600);

    const processingArgumentIndex = args.indexOf('--processing-evidence');
    const missingArgs = args.filter((_, index) => (
      index !== processingArgumentIndex && index !== processingArgumentIndex + 1
    ));
    const missingResult = spawnSync(executable, missingArgs, { cwd: process.cwd(), encoding: 'utf8', env });
    expect(missingResult.status).toBe(1);
    expect(missingResult.stderr).toContain('--processing-evidence');
    expect(existsSync(marker)).toBe(false);
  }, 15_000);

  it('publishes the processing evidence gate in the deterministic operations planner', () => {
    const plan = buildReportingCutoverOperationsPlan(createReadyReportingAuthorization(), PROCESSING_EVIDENCE_NOW);
    expect(plan.commands.guarded.featureFlagShadow).toEqual(expect.arrayContaining([
      '--processing-evidence',
      '<protected-processing-evidence.json>',
    ]));
    const resolution = plan.resolutionPlan.find(
      (item) => item.blockerCode === 'CDB101_PROCESSING_EVIDENCE_UNAVAILABLE',
    );
    expect(resolution).toMatchObject({
      blockerNumber: 11,
      requiresProductionMutation: false,
    });
    expect(resolution?.action).toContain('canonical:validate-reporting-processing-evidence');
    expect(resolution?.requiredEvidence).toContain('protected-processing-evidence.json');
  });

  it('keeps the repository template structurally exact and fail-closed', () => {
    const text = readFileSync(
      resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-processing-evidence-template.json'),
      'utf8',
    );
    const parsed = parseReportingProcessingEvidenceJson(text);
    expect(parsed.documentReady).toBe(true);
    expect(parsed.evidence).not.toBeNull();
    const receipt = prepareReportingProcessingEvidence(
      parsed.evidence!, createReadyReportingAuthorization(), PROCESSING_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(false);
    expect(receipt.shadowFlagReady).toBe(false);
  });

  it('exports the exact ordered processing check registry', () => {
    expect(CDB101_PROCESSING_CHECK_IDS).toEqual([
      'unresolved_critical_exceptions',
      'blocked_outbox',
      'blocked_accounting',
      'duplicate_public_ids',
      'unsafe_integer_amounts',
      'tenant_isolation',
      'second_pass_new_rows',
    ]);
  });
});

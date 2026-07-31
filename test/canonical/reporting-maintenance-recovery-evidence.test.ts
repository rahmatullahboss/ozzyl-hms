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
  bindReportingMaintenanceRecoveryEvidenceToAuthorization,
  evaluateProtectedReportingMaintenanceRecoveryEvidence,
  parseReportingMaintenanceRecoveryEvidenceArgs,
  parseReportingMaintenanceRecoveryEvidenceJson,
  prepareReportingMaintenanceRecoveryEvidence,
  type ReportingMaintenanceRecoveryAuthorizationSnapshot,
  type ReportingMaintenanceRecoveryEvidence,
} from '../../scripts/canonical/reporting-maintenance-recovery-evidence';
import {
  buildCanonicalImportCommandId,
  buildFeatureFlagCommandId,
  buildMigrationCommandId,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from '../../scripts/canonical/production-cutover-contract';
import {
  createReadyReportingAuthorization,
  createReadySingleOperatorReportingAuthorization,
  createReadyTwoPersonReportingAuthorization,
} from './fixtures/reporting-authorization-fixture';
import {
  createReadyReportingForeignKeyDispositionEvidence,
} from './fixtures/reporting-fk-disposition-evidence-fixture';
import {
  MAINTENANCE_RECOVERY_EVIDENCE_NOW,
  createReadyReportingMaintenanceRecoveryEvidence,
  createReadySingleOperatorReportingMaintenanceRecoveryEvidence,
  createReadyTwoPersonReportingMaintenanceRecoveryEvidence,
} from './fixtures/reporting-maintenance-recovery-evidence-fixture';
import { prepareReportingForeignKeyDispositionEvidence } from '../../scripts/canonical/reporting-fk-disposition-evidence';

const temporaryRoots: string[] = [];

function makeProtectedFile(value: unknown, filename = 'evidence.json'): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-maintenance-recovery-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const path = join(root, filename);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
  return { root, path };
}

function applySnapshot(
  authorization: ReportingCutoverAuthorization,
  snapshot: ReportingMaintenanceRecoveryAuthorizationSnapshot,
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

function shiftEvidenceToCurrentWindow(input: ReportingMaintenanceRecoveryEvidence): void {
  const now = Date.now();
  const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
  input.authorizationIssuedAtUtc = iso(-12 * 60_000);
  input.authorizationApproval.approvedAtUtc = iso(-11 * 60_000);
  input.maintenanceWindow.approvedAtUtc = iso(-10 * 60_000);
  input.owners.rollback.primaryAcknowledgedAtUtc = iso(-9 * 60_000);
  input.owners.rollback.backupAcknowledgedAtUtc = iso(-8 * 60_000);
  input.owners.observation.primaryAcknowledgedAtUtc = iso(-7 * 60_000);
  input.owners.observation.backupAcknowledgedAtUtc = iso(-6 * 60_000);
  input.rollbackPolicy.reviewedAtUtc = iso(-5 * 60_000);
  input.recovery.export.capturedAtUtc = iso(-4 * 60_000);
  input.recovery.timeTravel.capturedAtUtc = iso(-3 * 60_000);
  input.generatedAtUtc = iso(-2 * 60_000);
  input.maintenanceWindow.startUtc = iso(-60_000);
  input.maintenanceWindow.endUtc = iso(19 * 60_000);
  input.maintenanceWindow.expiresAtUtc = iso(49 * 60_000);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-101 reporting maintenance and recovery evidence', () => {
  it('accepts one exact complete pack and produces an authorization-compatible snapshot', () => {
    const input = createReadyReportingMaintenanceRecoveryEvidence();
    const result = prepareReportingMaintenanceRecoveryEvidence(input, MAINTENANCE_RECOVERY_EVIDENCE_NOW);

    expect(result.receipt).toMatchObject({
      schemaVersion: 1,
      documentReady: true,
      evidenceReady: true,
      issueCount: 0,
      ownerIdentityCount: 4,
      exportSizeBytes: 123456,
      maintenanceWindowDurationMs: 2 * 60 * 60_000,
      observationGracePeriodMs: 30 * 60_000,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
    expect(result.receipt.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.receipt.authorizationSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.authorizationSnapshot).toMatchObject({
      issuedAtUtc: input.authorizationIssuedAtUtc,
      maintenanceWindowStartUtc: input.maintenanceWindow.startUtc,
      maintenanceWindowEndUtc: input.maintenanceWindow.endUtc,
      expiresAtUtc: input.maintenanceWindow.expiresAtUtc,
      rollbackOwner: {
        ownerId: input.owners.rollback.primaryOwnerId,
        backupOwnerId: input.owners.rollback.backupOwnerId,
        acknowledgedAtUtc: input.owners.rollback.backupAcknowledgedAtUtc,
      },
      observationOwner: {
        acknowledgedAtUtc: input.owners.observation.backupAcknowledgedAtUtc,
      },
      productionImportSourceExportSha256: input.recovery.export.exportSha256,
    });
    expect(JSON.stringify(result.receipt)).not.toContain('ops-rollback-primary');
    expect(JSON.stringify(result.receipt)).not.toContain('0000001e-00000000-000050a8-202607141600');
  });

  it('accepts the two-person constrained evidence model and binds both primaries', () => {
    const evidence = createReadyTwoPersonReportingMaintenanceRecoveryEvidence();
    const prepared = prepareReportingMaintenanceRecoveryEvidence(evidence, MAINTENANCE_RECOVERY_EVIDENCE_NOW);

    expect(prepared.receipt).toMatchObject({
      documentReady: true,
      evidenceReady: true,
      issueCount: 0,
      ownerIdentityCount: 2,
    });
    expect(prepared.authorizationSnapshot).toMatchObject({
      authorizationSchemaVersion: 3,
      ownerModel: 'two_person_constrained',
      twoPersonRiskAcceptanceEvidence: evidence.twoPersonRiskAcceptanceEvidence,
      rollbackOwner: {
        ownerId: 'rahmatullah-zisan',
        backupOwnerId: null,
        acknowledgedAtUtc: evidence.owners.rollback.primaryAcknowledgedAtUtc,
      },
      observationOwner: {
        ownerId: 'staff-monitoring-owner',
        backupOwnerId: null,
        acknowledgedAtUtc: evidence.owners.observation.primaryAcknowledgedAtUtc,
      },
    });

    const authorization = createReadyTwoPersonReportingAuthorization();
    applySnapshot(authorization, prepared.authorizationSnapshot!);
    if (authorization.schemaVersion !== 3) throw new Error('expected schema v3');
    authorization.twoPersonRiskAcceptance.evidenceId = evidence.twoPersonRiskAcceptanceEvidence!.evidenceId;
    authorization.twoPersonRiskAcceptance.evidenceSha256 = evidence.twoPersonRiskAcceptanceEvidence!.evidenceSha256;
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);

    expect(bindReportingMaintenanceRecoveryEvidenceToAuthorization(prepared, authorization).receipt.evidenceReady)
      .toBe(true);
  });

  it('accepts and binds the single-operator risk-accepted evidence model', () => {
    const evidence = createReadySingleOperatorReportingMaintenanceRecoveryEvidence();
    const prepared = prepareReportingMaintenanceRecoveryEvidence(evidence, MAINTENANCE_RECOVERY_EVIDENCE_NOW);

    expect(prepared.receipt).toMatchObject({
      documentReady: true,
      evidenceReady: true,
      issueCount: 0,
      ownerIdentityCount: 1,
    });
    expect(prepared.authorizationSnapshot).toMatchObject({
      authorizationSchemaVersion: 4,
      ownerModel: 'single_operator_risk_accepted',
      twoPersonRiskAcceptanceEvidence: null,
      singleOperatorRiskAcceptanceEvidence: evidence.singleOperatorRiskAcceptanceEvidence,
      rollbackOwner: {
        ownerId: 'rahmatullah-zisan',
        backupOwnerId: null,
        acknowledgedAtUtc: evidence.owners.rollback.primaryAcknowledgedAtUtc,
      },
      observationOwner: {
        ownerId: 'rahmatullah-zisan',
        backupOwnerId: null,
        acknowledgedAtUtc: evidence.owners.observation.primaryAcknowledgedAtUtc,
      },
    });

    const authorization = createReadySingleOperatorReportingAuthorization();
    applySnapshot(authorization, prepared.authorizationSnapshot!);
    if (authorization.schemaVersion !== 4) throw new Error('expected schema v4');
    authorization.singleOperatorRiskAcceptance.evidenceId = evidence.singleOperatorRiskAcceptanceEvidence!.evidenceId;
    authorization.singleOperatorRiskAcceptance.evidenceSha256 = evidence.singleOperatorRiskAcceptanceEvidence!.evidenceSha256;
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);

    expect(bindReportingMaintenanceRecoveryEvidenceToAuthorization(prepared, authorization).receipt.evidenceReady)
      .toBe(true);
  });

  it('rejects constrained evidence with backups, duplicated primaries, or a different incident channel', () => {
    const evidence = createReadyTwoPersonReportingMaintenanceRecoveryEvidence();
    evidence.owners.rollback.backupOwnerId = 'unexpected-backup';
    evidence.owners.observation.primaryOwnerId = evidence.owners.rollback.primaryOwnerId;
    evidence.owners.observation.communicationChannelId = 'different-channel';

    expect(prepareReportingMaintenanceRecoveryEvidence(evidence, MAINTENANCE_RECOVERY_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_MAINTENANCE_OWNER_CONTRACT_INVALID',
        'CDB101_MAINTENANCE_OWNER_IDENTITY_COLLISION',
      ]));
  });

  it('rejects invalid maintenance chronology, expiry, and future generation', () => {
    const input = createReadyReportingMaintenanceRecoveryEvidence();
    input.maintenanceWindow.endUtc = input.maintenanceWindow.startUtc;
    input.maintenanceWindow.expiresAtUtc = '2026-07-14T18:31:00.000Z';
    input.generatedAtUtc = '2026-07-14T16:01:00.000Z';
    expect(prepareReportingMaintenanceRecoveryEvidence(input, MAINTENANCE_RECOVERY_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_MAINTENANCE_WINDOW_EVIDENCE_INVALID',
        'CDB101_MAINTENANCE_RECOVERY_CHRONOLOGY_INVALID',
      ]));
  });

  it('rejects incomplete approvals, owner collisions, invalid authority, and late acknowledgements', () => {
    const input = createReadyReportingMaintenanceRecoveryEvidence();
    input.authorizationApproval.approved = false;
    input.owners.observation.backupOwnerId = input.owners.rollback.primaryOwnerId;
    input.owners.rollback.decisionAuthority = 'may_accept_or_reject_go';
    input.owners.observation.backupAcknowledgedAtUtc = '2026-07-14T16:01:00.000Z';
    expect(prepareReportingMaintenanceRecoveryEvidence(input, MAINTENANCE_RECOVERY_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_MAINTENANCE_AUTHORIZATION_APPROVAL_INVALID',
        'CDB101_MAINTENANCE_OWNER_CONTRACT_INVALID',
        'CDB101_MAINTENANCE_OWNER_IDENTITY_COLLISION',
        'CDB101_MAINTENANCE_RECOVERY_CHRONOLOGY_INVALID',
      ]));
  });

  it('rejects invalid rollback policy and inconsistent observation grace', () => {
    const input = createReadyReportingMaintenanceRecoveryEvidence();
    input.rollbackPolicy.reviewed = false;
    input.rollbackPolicy.maxRollbackDurationMs = 0;
    input.rollbackPolicy.observationGracePeriodMs = 60_000;
    expect(prepareReportingMaintenanceRecoveryEvidence(input, MAINTENANCE_RECOVERY_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_MAINTENANCE_ROLLBACK_POLICY_INVALID');
  });

  it('rejects invalid export and Time Travel evidence', () => {
    const input = createReadyReportingMaintenanceRecoveryEvidence();
    input.recovery.export.captured = false;
    input.recovery.export.directoryMode = '755';
    input.recovery.export.exportSizeBytes = 0;
    input.recovery.timeTravel.sourceDatabaseId = 'wrong-database';
    input.recovery.timeTravel.bookmarkId = 'https://PRIVATE_SIGNED_URL';
    expect(prepareReportingMaintenanceRecoveryEvidence(input, MAINTENANCE_RECOVERY_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_MAINTENANCE_EXPORT_EVIDENCE_INVALID',
        'CDB101_MAINTENANCE_TIME_TRAVEL_EVIDENCE_INVALID',
      ]));
  });

  it('rejects duplicate bindings and malformed protected JSON without value disclosure', () => {
    const ready = JSON.stringify(createReadyReportingMaintenanceRecoveryEvidence());
    const duplicateKey = ready.replace(
      '"evidenceId":"cdb101-maintenance-recovery-20260714-01"',
      '"evidenceId":"one","evidenceId":"two"',
    );
    expect(parseReportingMaintenanceRecoveryEvidenceJson(duplicateKey).issues.map((item) => item.code))
      .toContain('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_DUPLICATE_KEY');

    const duplicateEvidence = createReadyReportingMaintenanceRecoveryEvidence();
    duplicateEvidence.owners.observation.evidenceId = duplicateEvidence.owners.rollback.evidenceId;
    duplicateEvidence.rollbackPolicy.evidenceSha256 = duplicateEvidence.owners.rollback.evidenceSha256;
    expect(prepareReportingMaintenanceRecoveryEvidence(duplicateEvidence, MAINTENANCE_RECOVERY_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_MAINTENANCE_EVIDENCE_BINDING_INVALID');

    const sensitive = JSON.stringify({
      ...createReadyReportingMaintenanceRecoveryEvidence(),
      exportPath: '/PRIVATE/export.sql',
    });
    const sensitiveResult = parseReportingMaintenanceRecoveryEvidenceJson(sensitive);
    expect(sensitiveResult.issues.map((item) => item.code))
      .toContain('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('/PRIVATE/export.sql');

    const unknown = JSON.stringify({
      ...createReadyReportingMaintenanceRecoveryEvidence(),
      note: 'PRIVATE_NOTE',
    });
    const unknownResult = parseReportingMaintenanceRecoveryEvidenceJson(unknown);
    expect(unknownResult.issues.map((item) => item.code))
      .toContain('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_UNKNOWN_FIELD');
    expect(JSON.stringify(unknownResult)).not.toContain('PRIVATE_NOTE');

    const unsafe = ready.replace('"productionDatabase":{', '"productionDatabase":{"__proto__":{"x":true},');
    expect(parseReportingMaintenanceRecoveryEvidenceJson(unsafe).issues.map((item) => item.code))
      .toContain('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_UNSAFE_KEY');

    const oversized = `${ready.slice(0, -1)},"padding":"${'x'.repeat(400_000)}"}`;
    expect(parseReportingMaintenanceRecoveryEvidenceJson(oversized).issues.map((item) => item.code))
      .toContain('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_TOO_LARGE');

    let deep: unknown = true;
    for (let index = 0; index < 70; index += 1) deep = { nested: deep };
    expect(parseReportingMaintenanceRecoveryEvidenceJson(JSON.stringify(deep)).issues.map((item) => item.code))
      .toContain('CDB101_MAINTENANCE_EVIDENCE_DOCUMENT_TOO_DEEP');
  });

  it('loads only protected files outside the repository and sanitizes filesystem failures', () => {
    const fixture = makeProtectedFile(createReadyReportingMaintenanceRecoveryEvidence());
    expect(evaluateProtectedReportingMaintenanceRecoveryEvidence(
      fixture.path,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).evidenceReady).toBe(true);

    chmodSync(fixture.path, 0o644);
    expect(evaluateProtectedReportingMaintenanceRecoveryEvidence(
      fixture.path,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_MAINTENANCE_EVIDENCE_FILE_PROTECTION_INVALID');

    chmodSync(fixture.path, 0o600);
    chmodSync(fixture.root, 0o755);
    expect(evaluateProtectedReportingMaintenanceRecoveryEvidence(
      fixture.path,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_MAINTENANCE_EVIDENCE_FILE_PROTECTION_INVALID');

    const template = resolve(
      process.cwd(),
      'docs/database/migration-runs/production/CDB-101-reporting-maintenance-recovery-evidence-template.json',
    );
    expect(evaluateProtectedReportingMaintenanceRecoveryEvidence(
      template,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_MAINTENANCE_EVIDENCE_FILE_INSIDE_REPOSITORY');

    const linkedFixture = makeProtectedFile(createReadyReportingMaintenanceRecoveryEvidence(), 'source.json');
    const symlinkPath = join(linkedFixture.root, 'linked.json');
    symlinkSync(linkedFixture.path, symlinkPath);
    expect(evaluateProtectedReportingMaintenanceRecoveryEvidence(
      symlinkPath,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_MAINTENANCE_EVIDENCE_FILE_PROTECTION_INVALID');

    const hardLinkPath = join(linkedFixture.root, 'hard-linked.json');
    linkSync(linkedFixture.path, hardLinkPath);
    expect(evaluateProtectedReportingMaintenanceRecoveryEvidence(
      hardLinkPath,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_MAINTENANCE_EVIDENCE_FILE_PROTECTION_INVALID');

    const missing = join(linkedFixture.root, 'PRIVATE_MISSING.json');
    const missingResult = evaluateProtectedReportingMaintenanceRecoveryEvidence(
      missing,
      process.cwd(),
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    );
    expect(missingResult.issueCodes).toContain('CDB101_MAINTENANCE_EVIDENCE_FILE_UNAVAILABLE');
    expect(JSON.stringify(missingResult)).not.toContain(linkedFixture.root);
    expect(JSON.stringify(missingResult)).not.toContain('PRIVATE_MISSING');
  });

  it('runs an offline aggregate-only CLI and rejects execution arguments', () => {
    const fixture = makeProtectedFile(createReadyReportingMaintenanceRecoveryEvidence());
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const result = spawnSync(executable, [
      'scripts/canonical/validate-reporting-maintenance-recovery-evidence.ts',
      '--evidence', fixture.path,
      '--at-utc', MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      documentReady: true,
      evidenceReady: true,
      ownerIdentityCount: 4,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
    expect(result.stdout).not.toContain(fixture.root);
    expect(result.stdout).not.toContain('ops-rollback-primary');

    const refused = spawnSync(executable, [
      'scripts/canonical/validate-reporting-maintenance-recovery-evidence.ts',
      '--execute',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('validation failed');
  });

  it('parses only the exact CLI contract', () => {
    expect(parseReportingMaintenanceRecoveryEvidenceArgs([
      '--', '--evidence', '/protected/recovery.json', '--at-utc', MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ])).toEqual({
      evidencePath: '/protected/recovery.json',
      atUtc: MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    });
    expect(() => parseReportingMaintenanceRecoveryEvidenceArgs([])).toThrow(/required/i);
    expect(() => parseReportingMaintenanceRecoveryEvidenceArgs(['PRIVATE_POSITIONAL'])).toThrow(/unknown/i);
  });

  it('binds the complete snapshot into authorization and deterministic command IDs', () => {
    const evidence = createReadyReportingMaintenanceRecoveryEvidence();
    const prepared = prepareReportingMaintenanceRecoveryEvidence(evidence, MAINTENANCE_RECOVERY_EVIDENCE_NOW);
    const authorization = createReadyReportingAuthorization();
    applySnapshot(authorization, prepared.authorizationSnapshot!);
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);

    expect(bindReportingMaintenanceRecoveryEvidenceToAuthorization(prepared, authorization).receipt.evidenceReady)
      .toBe(true);
    expect(validateReportingCutoverAuthorization(authorization, MAINTENANCE_RECOVERY_EVIDENCE_NOW).issues.map((item) => item.code))
      .not.toContain('CDB101_MAINTENANCE_RECOVERY_EVIDENCE_INVALID');
    expect(validateReportingCutoverAuthorization(authorization, MAINTENANCE_RECOVERY_EVIDENCE_NOW).issues.map((item) => item.code))
      .not.toContain('CDB101_RECOVERY_EXPORT_IMPORT_HASH_MISMATCH');

    const migrationId = authorization.migrations.commandId;
    authorization.rollbackOwner.backupOwnerId = 'changed-backup-owner';
    expect(buildMigrationCommandId(authorization)).not.toBe(migrationId);

    authorization.rollbackOwner.backupOwnerId = prepared.authorizationSnapshot!.rollbackOwner.backupOwnerId;
    authorization.productionImport.sourceExportSha256 = '9'.repeat(64);
    expect(bindReportingMaintenanceRecoveryEvidenceToAuthorization(prepared, authorization).receipt.issueCodes)
      .toContain('CDB101_MAINTENANCE_AUTHORIZATION_BINDING_MISMATCH');
    expect(validateReportingCutoverAuthorization(authorization, MAINTENANCE_RECOVERY_EVIDENCE_NOW).issues.map((item) => item.code))
      .toContain('CDB101_RECOVERY_EXPORT_IMPORT_HASH_MISMATCH');
  });

  it('blocks all mutation wrappers before any external child process when maintenance evidence mismatches', () => {
    const evidence = createReadyReportingMaintenanceRecoveryEvidence();
    shiftEvidenceToCurrentWindow(evidence);
    const prepared = prepareReportingMaintenanceRecoveryEvidence(evidence, new Date().toISOString());
    expect(prepared.receipt.evidenceReady).toBe(true);
    const maintenanceFixture = makeProtectedFile(evidence, 'maintenance-recovery.json');

    const fkEvidence = createReadyReportingForeignKeyDispositionEvidence();
    const fkPrepared = prepareReportingForeignKeyDispositionEvidence(fkEvidence, new Date().toISOString());
    expect(fkPrepared.receipt.evidenceReady).toBe(true);
    const fkPath = join(maintenanceFixture.root, 'fk-evidence.json');
    writeFileSync(fkPath, JSON.stringify(fkEvidence), { mode: 0o600 });
    chmodSync(fkPath, 0o600);

    const authorization = createReadyReportingAuthorization();
    applySnapshot(authorization, prepared.authorizationSnapshot!);
    authorization.foreignKeyDisposition.evidenceId = fkEvidence.evidenceId;
    authorization.foreignKeyDisposition.evidenceSha256 = fkPrepared.receipt.evidenceSha256;
    authorization.foreignKeyDisposition.groups = fkPrepared.authorizationGroups!;
    authorization.maintenanceRecoveryEvidence.evidenceSha256 = '9'.repeat(64);
    authorization.featureFlagPlan.effectiveAtUtc = new Date(Date.now() + 5 * 60_000).toISOString();
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);
    const authorizationPath = join(maintenanceFixture.root, 'authorization-v2.json');
    writeFileSync(authorizationPath, JSON.stringify(authorization), { mode: 0o600 });
    chmodSync(authorizationPath, 0o600);

    const binDir = join(maintenanceFixture.root, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    chmodSync(binDir, 0o700);
    const marker = join(maintenanceFixture.root, 'child-invoked.txt');
    const fakePnpm = join(binDir, 'pnpm');
    writeFileSync(fakePnpm, `#!/bin/sh\nprintf invoked > "${marker}"\nexit 99\n`, { mode: 0o700 });
    chmodSync(fakePnpm, 0o700);
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` };
    const commands = [
      [
        'scripts/canonical/apply-production-canonical-migrations.ts',
        '--authorization', authorizationPath,
        '--fk-evidence', fkPath,
        '--maintenance-recovery-evidence', maintenanceFixture.path,
        '--worker-build-version-evidence', maintenanceFixture.path,
        '--execute',
      ],
      [
        'scripts/canonical/import-production-canonical-bundle.ts',
        '--authorization', authorizationPath,
        '--fk-evidence', fkPath,
        '--maintenance-recovery-evidence', maintenanceFixture.path,
        '--worker-build-version-evidence', maintenanceFixture.path,
        '--bundle', join(maintenanceFixture.root, 'bundle.sql'),
        '--manifest', join(maintenanceFixture.root, 'manifest.json'),
        '--source-export', join(maintenanceFixture.root, 'source.sql'),
        '--execute',
      ],
      [
        'scripts/canonical/set-production-canonical-flag.ts',
        '--authorization', authorizationPath,
        '--fk-evidence', fkPath,
        '--maintenance-recovery-evidence', maintenanceFixture.path,
        '--worker-build-version-evidence', maintenanceFixture.path,
        '--processing-evidence', maintenanceFixture.path,
        '--effective-at-utc', authorization.featureFlagPlan.effectiveAtUtc!,
        '--updated-by', authorization.featureFlagPlan.updatedByPublicId!,
        '--execute',
      ],
    ];

    for (const args of commands) {
      const result = spawnSync(executable, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env,
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('CDB101_MAINTENANCE_AUTHORIZATION_BINDING_MISMATCH');
      expect(result.stdout).toContain('"networkRequestPerformed": false');
      expect(result.stdout).toContain('"productionMutationPerformed": false');
      expect(result.stderr).toBe('');
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('keeps the repository template structurally exact and semantically fail-closed', () => {
    const template = readFileSync(
      resolve(
        process.cwd(),
        'docs/database/migration-runs/production/CDB-101-reporting-maintenance-recovery-evidence-template.json',
      ),
      'utf8',
    );
    const parsed = parseReportingMaintenanceRecoveryEvidenceJson(template);
    expect(parsed.documentReady).toBe(true);
    expect(parsed.evidence).not.toBeNull();
    expect(parsed.evidence).toMatchObject({
      authorizationSchemaVersion: 4,
      ownerModel: 'single_operator_risk_accepted',
      twoPersonRiskAcceptanceEvidence: null,
      singleOperatorRiskAcceptanceEvidence: {
        evidenceId: null,
        evidenceSha256: null,
      },
    });
    expect(prepareReportingMaintenanceRecoveryEvidence(
      parsed.evidence!,
      MAINTENANCE_RECOVERY_EVIDENCE_NOW,
    ).receipt.evidenceReady).toBe(false);
  });
});

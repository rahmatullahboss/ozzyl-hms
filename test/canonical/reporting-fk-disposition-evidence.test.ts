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
  bindReportingForeignKeyEvidenceToAuthorization,
  evaluateProtectedReportingForeignKeyDispositionEvidence,
  parseReportingForeignKeyDispositionEvidenceArgs,
  parseReportingForeignKeyDispositionEvidenceJson,
  prepareReportingForeignKeyDispositionEvidence,
} from '../../scripts/canonical/reporting-fk-disposition-evidence';
import {
  buildCanonicalImportCommandId,
  buildFeatureFlagCommandId,
  buildMigrationCommandId,
  validateReportingCutoverAuthorization,
} from '../../scripts/canonical/production-cutover-contract';
import { createReadyReportingAuthorization } from './fixtures/reporting-authorization-fixture';
import {
  FK_EVIDENCE_NOW,
  createReadyReportingForeignKeyDispositionEvidence,
} from './fixtures/reporting-fk-disposition-evidence-fixture';

const temporaryRoots: string[] = [];

function makeProtectedFile(value: unknown): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-fk-evidence-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const path = join(root, 'fk-evidence.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
  return { root, path };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-101 reporting FK disposition evidence', () => {
  it('accepts one exact complete evidence pack and produces authorization-compatible groups', () => {
    const input = createReadyReportingForeignKeyDispositionEvidence();
    const result = prepareReportingForeignKeyDispositionEvidence(input, FK_EVIDENCE_NOW);

    expect(result.receipt).toMatchObject({
      schemaVersion: 1,
      documentReady: true,
      evidenceReady: true,
      issueCount: 0,
      repairedViolationCount: 8,
      waivedViolationCount: 41,
      remainingViolationCount: 41,
      activeFinancialWaivedViolationCount: 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
    expect(result.receipt.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.authorizationGroups).toEqual([
      expect.objectContaining({ childTable: 'billing_deposits', remainingViolationCount: 0, repairedViolationCount: 4, waivedViolationCount: 0 }),
      expect.objectContaining({ childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', remainingViolationCount: 26, waivedViolationCount: 26 }),
      expect.objectContaining({ childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', remainingViolationCount: 15, waivedViolationCount: 15 }),
      expect.objectContaining({ childTable: 'income', remainingViolationCount: 0, repairedViolationCount: 4, waivedViolationCount: 0 }),
    ]);
    expect(JSON.stringify(result.receipt)).not.toContain('data-integrity-owner-a');
    expect(JSON.stringify(result.receipt)).not.toContain('canonical-program-owner-a');
  });

  it('rejects active-financial waivers and incomplete or destructive repairs', () => {
    const waived = createReadyReportingForeignKeyDispositionEvidence();
    const active = waived.activeRepairs[0] as unknown as Record<string, unknown>;
    active.disposition = 'formal_waiver';
    active.waivedViolationCount = 4;
    active.repairedViolationCount = 0;
    active.remainingViolationCount = 4;
    expect(prepareReportingForeignKeyDispositionEvidence(waived, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_ACTIVE_REPAIR_INVALID');

    const incomplete = createReadyReportingForeignKeyDispositionEvidence();
    incomplete.activeRepairs[0].remainingViolationCount = 1;
    incomplete.activeRepairs[0].repairedViolationCount = 3;
    expect(prepareReportingForeignKeyDispositionEvidence(incomplete, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_ACTIVE_REPAIR_INVALID');

    const destructive = createReadyReportingForeignKeyDispositionEvidence();
    destructive.activeRepairs[0].hardDeletePerformed = true;
    expect(prepareReportingForeignKeyDispositionEvidence(destructive, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_ACTIVE_REPAIR_INVALID');
  });

  it('rejects incomplete archival waiver attestations and wrong P11 scope', () => {
    const input = createReadyReportingForeignKeyDispositionEvidence();
    input.archivalWaivers[0].activeWriterDisabledConfirmed = false;
    input.archivalWaivers[0].excludedFromReportingConfirmed = false;
    input.archivalWaivers[0].removalPhase = 'never';
    expect(prepareReportingForeignKeyDispositionEvidence(input, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_ARCHIVAL_WAIVER_INVALID');
  });

  it('rejects wrong before/after aggregates, unknown groups, and inconsistent totals', () => {
    const before = createReadyReportingForeignKeyDispositionEvidence();
    before.beforeObservation.totalViolationCount = 48;
    before.beforeObservation.groups.push({ childTable: 'unknown_table', parentTable: 'patients', violationCount: 1 });
    expect(prepareReportingForeignKeyDispositionEvidence(before, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toEqual(expect.arrayContaining([
        'CDB101_FK_BEFORE_OBSERVATION_INVALID',
        'CDB101_FK_GROUP_SCOPE_INVALID',
      ]));

    const after = createReadyReportingForeignKeyDispositionEvidence();
    after.afterObservation.groups.push({ childTable: 'billing_deposits', parentTable: 'bills', violationCount: 1 });
    after.afterObservation.totalViolationCount = 42;
    after.totals.remainingViolationCount = 42;
    expect(prepareReportingForeignKeyDispositionEvidence(after, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_AFTER_OBSERVATION_INVALID');

    const widenedDisposition = createReadyReportingForeignKeyDispositionEvidence();
    widenedDisposition.activeRepairs[0].childTable = 'unknown_financial_table';
    expect(prepareReportingForeignKeyDispositionEvidence(widenedDisposition, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_GROUP_SCOPE_INVALID');
  });

  it('rejects invalid chronology, duplicate evidence references, and future generation', () => {
    const chronology = createReadyReportingForeignKeyDispositionEvidence();
    chronology.afterObservation.capturedAtUtc = '2026-07-14T23:50:00.000Z';
    chronology.generatedAtUtc = '2026-07-15T01:00:00.000Z';
    expect(prepareReportingForeignKeyDispositionEvidence(chronology, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_CHRONOLOGY_INVALID');

    const duplicate = createReadyReportingForeignKeyDispositionEvidence();
    duplicate.activeRepairs[1].evidenceId = duplicate.activeRepairs[0].evidenceId;
    duplicate.archivalWaivers[0].evidenceSha256 = duplicate.activeRepairs[0].evidenceSha256;
    expect(prepareReportingForeignKeyDispositionEvidence(duplicate, FK_EVIDENCE_NOW).receipt.issueCodes)
      .toContain('CDB101_FK_EVIDENCE_BINDING_INVALID');
  });

  it('rejects duplicate JSON keys, sensitive fields, unknown fields, unsafe keys, and excessive size/depth', () => {
    const ready = JSON.stringify(createReadyReportingForeignKeyDispositionEvidence());
    const duplicate = ready.replace('"evidenceId":"cdb101-fk-disposition-20260715-01"', '"evidenceId":"one","evidenceId":"two"');
    expect(parseReportingForeignKeyDispositionEvidenceJson(duplicate).issues.map((item) => item.code))
      .toContain('CDB101_FK_EVIDENCE_DOCUMENT_DUPLICATE_KEY');

    const sensitive = JSON.stringify({ ...createReadyReportingForeignKeyDispositionEvidence(), rawSql: 'PRIVATE_SQL' });
    const sensitiveResult = parseReportingForeignKeyDispositionEvidenceJson(sensitive);
    expect(sensitiveResult.issues.map((item) => item.code)).toContain('CDB101_FK_EVIDENCE_DOCUMENT_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('PRIVATE_SQL');

    const unknown = JSON.stringify({ ...createReadyReportingForeignKeyDispositionEvidence(), note: 'PRIVATE_NOTE' });
    const unknownResult = parseReportingForeignKeyDispositionEvidenceJson(unknown);
    expect(unknownResult.issues.map((item) => item.code)).toContain('CDB101_FK_EVIDENCE_DOCUMENT_UNKNOWN_FIELD');
    expect(JSON.stringify(unknownResult)).not.toContain('PRIVATE_NOTE');

    const unsafe = ready.replace('"productionDatabase":{', '"productionDatabase":{"__proto__":{"x":true},');
    expect(parseReportingForeignKeyDispositionEvidenceJson(unsafe).issues.map((item) => item.code))
      .toContain('CDB101_FK_EVIDENCE_DOCUMENT_UNSAFE_KEY');

    const oversized = `${ready.slice(0, -1)},"padding":"${'x'.repeat(400_000)}"}`;
    expect(parseReportingForeignKeyDispositionEvidenceJson(oversized).issues.map((item) => item.code))
      .toContain('CDB101_FK_EVIDENCE_DOCUMENT_TOO_LARGE');

    let deep: unknown = true;
    for (let index = 0; index < 70; index += 1) deep = { nested: deep };
    expect(parseReportingForeignKeyDispositionEvidenceJson(JSON.stringify(deep)).issues.map((item) => item.code))
      .toContain('CDB101_FK_EVIDENCE_DOCUMENT_TOO_DEEP');
  });

  it('loads only protected files outside the repository and sanitizes filesystem failures', () => {
    const fixture = makeProtectedFile(createReadyReportingForeignKeyDispositionEvidence());
    expect(evaluateProtectedReportingForeignKeyDispositionEvidence(fixture.path, process.cwd(), FK_EVIDENCE_NOW).evidenceReady)
      .toBe(true);

    chmodSync(fixture.path, 0o644);
    expect(evaluateProtectedReportingForeignKeyDispositionEvidence(fixture.path, process.cwd(), FK_EVIDENCE_NOW).issueCodes)
      .toContain('CDB101_FK_EVIDENCE_FILE_PROTECTION_INVALID');
    chmodSync(fixture.path, 0o600);
    chmodSync(fixture.root, 0o755);
    expect(evaluateProtectedReportingForeignKeyDispositionEvidence(fixture.path, process.cwd(), FK_EVIDENCE_NOW).issueCodes)
      .toContain('CDB101_FK_EVIDENCE_FILE_PROTECTION_INVALID');

    const repositoryTemplate = resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-fk-disposition-evidence-template.json');
    expect(evaluateProtectedReportingForeignKeyDispositionEvidence(repositoryTemplate, process.cwd(), FK_EVIDENCE_NOW).issueCodes)
      .toContain('CDB101_FK_EVIDENCE_FILE_INSIDE_REPOSITORY');

    const symlinkRoot = makeProtectedFile(createReadyReportingForeignKeyDispositionEvidence());
    const linked = join(symlinkRoot.root, 'linked.json');
    symlinkSync(symlinkRoot.path, linked);
    expect(evaluateProtectedReportingForeignKeyDispositionEvidence(linked, process.cwd(), FK_EVIDENCE_NOW).issueCodes)
      .toContain('CDB101_FK_EVIDENCE_FILE_PROTECTION_INVALID');

    const hardLinked = join(symlinkRoot.root, 'hard-linked.json');
    linkSync(symlinkRoot.path, hardLinked);
    expect(evaluateProtectedReportingForeignKeyDispositionEvidence(hardLinked, process.cwd(), FK_EVIDENCE_NOW).issueCodes)
      .toContain('CDB101_FK_EVIDENCE_FILE_PROTECTION_INVALID');

    const missing = join(symlinkRoot.root, 'PRIVATE_MISSING.json');
    const missingResult = evaluateProtectedReportingForeignKeyDispositionEvidence(missing, process.cwd(), FK_EVIDENCE_NOW);
    expect(missingResult.issueCodes).toContain('CDB101_FK_EVIDENCE_FILE_UNAVAILABLE');
    expect(JSON.stringify(missingResult)).not.toContain(symlinkRoot.root);
    expect(JSON.stringify(missingResult)).not.toContain('PRIVATE_MISSING');
  });

  it('blocks all mutation wrappers before any child process when FK evidence binding mismatches authorization', () => {
    const evidence = createReadyReportingForeignKeyDispositionEvidence();
    const prepared = prepareReportingForeignKeyDispositionEvidence(evidence, new Date().toISOString());
    expect(prepared.receipt.evidenceReady).toBe(true);
    const fixture = makeProtectedFile(evidence);
    const authorization = createReadyReportingAuthorization();
    const nowMs = Date.now();
    const iso = (offsetMs: number): string => new Date(nowMs + offsetMs).toISOString();
    authorization.issuedAtUtc = iso(-10 * 60_000);
    authorization.authorizationApproval.approvedAtUtc = iso(-9 * 60_000);
    authorization.maintenanceWindowStartUtc = iso(-60_000);
    authorization.maintenanceWindowEndUtc = iso(20 * 60_000);
    authorization.expiresAtUtc = iso(50 * 60_000);
    authorization.rollbackOwner.acknowledgedAtUtc = iso(-8 * 60_000);
    authorization.observationOwner.acknowledgedAtUtc = iso(-7 * 60_000);
    authorization.featureFlagPlan.effectiveAtUtc = iso(5 * 60_000);
    authorization.foreignKeyDisposition.evidenceId = evidence.evidenceId;
    authorization.foreignKeyDisposition.evidenceSha256 = '9'.repeat(64);
    authorization.foreignKeyDisposition.groups = prepared.authorizationGroups!;
    authorization.migrations.commandId = buildMigrationCommandId(authorization);
    authorization.productionImport.commandId = buildCanonicalImportCommandId(authorization);
    authorization.featureFlagPlan.commandId = buildFeatureFlagCommandId(authorization);
    const authorizationPath = join(fixture.root, 'authorization-v2.json');
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
      [
        'scripts/canonical/apply-production-canonical-migrations.ts',
        '--authorization', authorizationPath,
        '--fk-evidence', fixture.path,
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--execute',
      ],
      [
        'scripts/canonical/import-production-canonical-bundle.ts',
        '--authorization', authorizationPath,
        '--fk-evidence', fixture.path,
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--bundle', join(fixture.root, 'bundle.sql'),
        '--manifest', join(fixture.root, 'manifest.json'),
        '--source-export', join(fixture.root, 'source.sql'),
        '--execute',
      ],
      [
        'scripts/canonical/set-production-canonical-flag.ts',
        '--authorization', authorizationPath,
        '--fk-evidence', fixture.path,
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--processing-evidence', join(fixture.root, 'processing-evidence.json'),
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
      expect(result.stdout).toContain('CDB101_FK_AUTHORIZATION_BINDING_MISMATCH');
      expect(result.stdout).toContain('"networkRequestPerformed": false');
      expect(result.stdout).toContain('"productionMutationPerformed": false');
      expect(result.stderr).toBe('');
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('runs an offline aggregate-only CLI and rejects execution arguments', () => {
    const fixture = makeProtectedFile(createReadyReportingForeignKeyDispositionEvidence());
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const result = spawnSync(executable, [
      'scripts/canonical/validate-reporting-fk-disposition-evidence.ts',
      '--evidence', fixture.path,
      '--at-utc', FK_EVIDENCE_NOW,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      documentReady: true,
      evidenceReady: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
    expect(result.stdout).not.toContain(fixture.root);
    expect(result.stdout).not.toContain('data-integrity-owner-a');

    const refused = spawnSync(executable, [
      'scripts/canonical/validate-reporting-fk-disposition-evidence.ts',
      '--execute',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('validation failed');
  });

  it('parses only the exact CLI contract', () => {
    expect(parseReportingForeignKeyDispositionEvidenceArgs([
      '--', '--evidence', '/protected/fk.json', '--at-utc', FK_EVIDENCE_NOW,
    ])).toEqual({ evidencePath: '/protected/fk.json', atUtc: FK_EVIDENCE_NOW });
    expect(() => parseReportingForeignKeyDispositionEvidenceArgs([])).toThrow(/required/i);
    expect(() => parseReportingForeignKeyDispositionEvidenceArgs(['PRIVATE_POSITIONAL'])).toThrow(/unknown/i);
  });

  it('binds validated FK evidence ID and SHA-256 into schema-v2 authorization and command IDs', () => {
    const evidence = createReadyReportingForeignKeyDispositionEvidence();
    const prepared = prepareReportingForeignKeyDispositionEvidence(evidence, FK_EVIDENCE_NOW);
    const authorization = createReadyReportingAuthorization();
    authorization.foreignKeyDisposition.evidenceId = evidence.evidenceId;
    authorization.foreignKeyDisposition.evidenceSha256 = prepared.receipt.evidenceSha256;
    authorization.foreignKeyDisposition.groups = prepared.authorizationGroups!;
    authorization.migrations.commandId = buildMigrationCommandId(authorization);

    expect(bindReportingForeignKeyEvidenceToAuthorization(prepared, authorization).receipt.evidenceReady)
      .toBe(true);
    expect(validateReportingCutoverAuthorization(authorization, '2026-07-14T16:00:00.000Z').issues.map((item) => item.code))
      .not.toContain('CDB101_FOREIGN_KEY_DISPOSITION_INVALID');

    const original = authorization.migrations.commandId;
    authorization.foreignKeyDisposition.evidenceSha256 = '9'.repeat(64);
    expect(buildMigrationCommandId(authorization)).not.toBe(original);
    expect(bindReportingForeignKeyEvidenceToAuthorization(prepared, authorization).receipt.issueCodes)
      .toContain('CDB101_FK_AUTHORIZATION_BINDING_MISMATCH');
  });

  it('keeps the repository template structurally exact and semantically fail-closed', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-fk-disposition-evidence-template.json'),
      'utf8',
    );
    const parsed = parseReportingForeignKeyDispositionEvidenceJson(template);
    expect(parsed.documentReady).toBe(true);
    expect(parsed.evidence).not.toBeNull();
    expect(prepareReportingForeignKeyDispositionEvidence(parsed.evidence!, FK_EVIDENCE_NOW).receipt.evidenceReady)
      .toBe(false);
  });
});

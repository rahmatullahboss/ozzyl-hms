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
  evaluateProtectedReportingCutoverAuthorization,
  loadProtectedReportingCutoverAuthorization,
  parseReportingAuthorizationValidatorArgs,
  parseReportingCutoverAuthorizationJson,
} from '../../scripts/canonical/reporting-cutover-authorization-document';
import { validateReportingCutoverAuthorization } from '../../scripts/canonical/production-cutover-contract';
import {
  READY_AUTHORIZATION_AT_UTC,
  createReadyReportingAuthorization,
  createReadySingleOperatorReportingAuthorization,
  createReadyTwoPersonReportingAuthorization,
} from './fixtures/reporting-authorization-fixture';

const temporaryRoots: string[] = [];

function makeProtectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-authorization-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeProtectedAuthorization(value: unknown): { root: string; path: string } {
  const root = makeProtectedRoot();
  const path = join(root, 'authorization-v2.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
  return { root, path };
}

describe('CDB-101 strict reporting authorization document boundary', () => {
  it('parses an exact schema-v2 document and preserves semantic validation', () => {
    const ready = createReadyReportingAuthorization();
    const parsed = parseReportingCutoverAuthorizationJson(JSON.stringify(ready));

    expect(parsed.documentReady).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.authorization).toEqual(ready);
    expect(validateReportingCutoverAuthorization(parsed.authorization!, READY_AUTHORIZATION_AT_UTC).executionReady)
      .toBe(true);
  });

  it('parses an exact schema-v3 two-person constrained document', () => {
    const ready = createReadyTwoPersonReportingAuthorization();
    const parsed = parseReportingCutoverAuthorizationJson(JSON.stringify(ready));

    expect(parsed.documentReady).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.authorization).toEqual(ready);
    expect(validateReportingCutoverAuthorization(parsed.authorization!, READY_AUTHORIZATION_AT_UTC).executionReady)
      .toBe(true);
  });

  it('parses an exact schema-v4 single-operator risk-accepted document', () => {
    const ready = createReadySingleOperatorReportingAuthorization();
    const parsed = parseReportingCutoverAuthorizationJson(JSON.stringify(ready));

    expect(parsed.documentReady).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.authorization).toEqual(ready);
    expect(validateReportingCutoverAuthorization(parsed.authorization!, READY_AUTHORIZATION_AT_UTC).executionReady)
      .toBe(true);
  });

  it('keeps schema-v2 and schema-v3 fields strictly separated', () => {
    const missingMode = createReadyTwoPersonReportingAuthorization() as unknown as Record<string, unknown>;
    delete missingMode.ownerModel;
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(missingMode)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID');

    const missingRisk = createReadyTwoPersonReportingAuthorization() as unknown as Record<string, unknown>;
    delete missingRisk.twoPersonRiskAcceptance;
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(missingRisk)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID');

    const widenedV2 = {
      ...createReadyReportingAuthorization(),
      ownerModel: 'two_person_constrained',
      twoPersonRiskAcceptance: createReadyTwoPersonReportingAuthorization().twoPersonRiskAcceptance,
    };
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(widenedV2)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD');

    const missingSingleRisk = createReadySingleOperatorReportingAuthorization() as unknown as Record<string, unknown>;
    delete missingSingleRisk.singleOperatorRiskAcceptance;
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(missingSingleRisk)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID');
  });

  it('rejects invalid JSON and duplicate keys without echoing document values', () => {
    const invalid = parseReportingCutoverAuthorizationJson('{"authorizationId":"PRIVATE_VALUE"');
    expect(invalid.documentReady).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toContain('CDB101_AUTHORIZATION_DOCUMENT_INVALID_JSON');
    expect(JSON.stringify(invalid)).not.toContain('PRIVATE_VALUE');

    const ready = createReadyReportingAuthorization();
    const serialized = JSON.stringify(ready);
    const duplicateRoot = serialized.replace(
      '"authorizationId":"cdb101-reporting-20260714-window-01"',
      '"authorizationId":"first","authorizationId":"second"',
    );
    const duplicateNested = serialized.replace(
      '"candidateCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      '"candidateCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","candidateCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
    );
    expect(parseReportingCutoverAuthorizationJson(duplicateRoot).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_DUPLICATE_KEY');
    expect(parseReportingCutoverAuthorizationJson(duplicateNested).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_DUPLICATE_KEY');
  });

  it('rejects unknown legacy fields, sensitive fields, and prototype-pollution keys', () => {
    const legacy = {
      ...createReadyReportingAuthorization(),
      deploymentAuthorized: true,
    };
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(legacy)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD');

    const sensitive = createReadyReportingAuthorization() as unknown as Record<string, unknown>;
    sensitive.deployment = {
      ...(sensitive.deployment as Record<string, unknown>),
      headers: { authorization: 'PRIVATE_VALUE' },
    };
    const sensitiveResult = parseReportingCutoverAuthorizationJson(JSON.stringify(sensitive));
    expect(sensitiveResult.issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('PRIVATE_VALUE');

    const pollution = JSON.stringify(createReadyReportingAuthorization()).replace(
      '"productionDatabase":{',
      '"productionDatabase":{"__proto__":{"polluted":true},',
    );
    expect(parseReportingCutoverAuthorizationJson(pollution).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_UNSAFE_KEY');
  });

  it('rejects missing nested objects, incorrect types, unsafe integers, excessive size, and excessive depth', () => {
    const missing = createReadyReportingAuthorization() as unknown as Record<string, unknown>;
    delete missing.rollbackOwner;
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(missing)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID');

    const wrongType = createReadyReportingAuthorization() as unknown as Record<string, unknown>;
    wrongType.authorizedTenantIds = '100';
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(wrongType)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID');

    const unsafe = createReadyReportingAuthorization();
    unsafe.exportEvidence.exportSizeBytes = Number.MAX_SAFE_INTEGER + 1;
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(unsafe)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_SCHEMA_INVALID');

    const oversized = `${JSON.stringify(createReadyReportingAuthorization()).slice(0, -1)},"padding":"${'x'.repeat(300_000)}"}`;
    expect(parseReportingCutoverAuthorizationJson(oversized).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_TOO_LARGE');

    let deep: unknown = true;
    for (let index = 0; index < 70; index += 1) deep = { nested: deep };
    expect(parseReportingCutoverAuthorizationJson(JSON.stringify(deep)).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_DOCUMENT_TOO_DEEP');
  });

  it('loads only a mode-600 regular file from a mode-700 directory outside the repository', () => {
    const fixture = writeProtectedAuthorization(createReadyReportingAuthorization());
    const loaded = loadProtectedReportingCutoverAuthorization(fixture.path, process.cwd());
    expect(loaded.documentReady).toBe(true);
    expect(loaded.authorization).not.toBeNull();

    chmodSync(fixture.path, 0o644);
    expect(loadProtectedReportingCutoverAuthorization(fixture.path, process.cwd()).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const repositoryTemplate = resolve(
      process.cwd(),
      'docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json',
    );
    expect(loadProtectedReportingCutoverAuthorization(repositoryTemplate, process.cwd()).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_FILE_INSIDE_REPOSITORY');
  });

  it('rejects symlinks, hard links, and sanitizes missing-file errors', () => {
    const fixture = writeProtectedAuthorization(createReadyReportingAuthorization());
    const linked = join(fixture.root, 'linked-authorization.json');
    symlinkSync(fixture.path, linked);
    expect(loadProtectedReportingCutoverAuthorization(linked, process.cwd()).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const hardLinked = join(fixture.root, 'hard-linked-authorization.json');
    linkSync(fixture.path, hardLinked);
    expect(loadProtectedReportingCutoverAuthorization(hardLinked, process.cwd()).issues.map((issue) => issue.code))
      .toContain('CDB101_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const missing = join(fixture.root, 'PRIVATE_FILE_NAME.json');
    const result = loadProtectedReportingCutoverAuthorization(missing, process.cwd());
    expect(result.issues.map((issue) => issue.code)).toContain('CDB101_AUTHORIZATION_FILE_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain(fixture.root);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FILE_NAME');
  });

  it('produces an aggregate-only offline authorization receipt', () => {
    const fixture = writeProtectedAuthorization(createReadyReportingAuthorization());
    const receipt = evaluateProtectedReportingCutoverAuthorization(
      fixture.path,
      process.cwd(),
      READY_AUTHORIZATION_AT_UTC,
    );
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      documentReady: true,
      executionReady: true,
      issueCount: 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
    expect(receipt.expectedCommandIds?.migration).toMatch(/^cdb101-migrations-[0-9a-f]{20}$/);
    expect(JSON.stringify(receipt)).not.toContain('ops-rollback-primary');
    expect(JSON.stringify(receipt)).not.toContain(fixture.root);
  });

  it('runs the offline CLI without exposing protected paths or values', () => {
    const fixture = writeProtectedAuthorization(createReadyReportingAuthorization());
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const result = spawnSync(executable, [
      'scripts/canonical/validate-reporting-cutover-authorization.ts',
      '--authorization', fixture.path,
      '--at-utc', READY_AUTHORIZATION_AT_UTC,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.status).toBe(0);
    const receipt = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(receipt).toMatchObject({ documentReady: true, executionReady: true, networkRequestPerformed: false });
    expect(result.stdout).not.toContain(fixture.root);
    expect(result.stdout).not.toContain('ops-rollback-primary');
  });

  it('parses only the exact offline validator CLI contract', () => {
    expect(parseReportingAuthorizationValidatorArgs([
      '--', '--authorization', '/protected/authorization.json', '--at-utc', READY_AUTHORIZATION_AT_UTC,
    ])).toEqual({
      authorizationPath: '/protected/authorization.json',
      atUtc: READY_AUTHORIZATION_AT_UTC,
    });
    expect(() => parseReportingAuthorizationValidatorArgs([])).toThrow(/required/i);
    expect(() => parseReportingAuthorizationValidatorArgs(['--execute'])).toThrow(/unknown/i);
    let message = '';
    try {
      parseReportingAuthorizationValidatorArgs(['PRIVATE_POSITIONAL_VALUE']);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/unknown/i);
    expect(message).not.toContain('PRIVATE_POSITIONAL_VALUE');
  });

  it('blocks all mutation wrappers before any child process when authorization is invalid', () => {
    const invalid = {
      ...createReadyReportingAuthorization(),
      deploymentAuthorized: true,
    };
    const fixture = writeProtectedAuthorization(invalid);
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
        '--authorization', fixture.path,
        '--fk-evidence', join(fixture.root, 'fk-evidence.json'),
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--execute',
      ],
      [
        'scripts/canonical/import-production-canonical-bundle.ts',
        '--authorization', fixture.path,
        '--fk-evidence', join(fixture.root, 'fk-evidence.json'),
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--bundle', join(fixture.root, 'bundle.sql'),
        '--manifest', join(fixture.root, 'manifest.json'),
        '--source-export', join(fixture.root, 'source.sql'),
        '--execute',
      ],
      [
        'scripts/canonical/set-production-canonical-flag.ts',
        '--authorization', fixture.path,
        '--fk-evidence', join(fixture.root, 'fk-evidence.json'),
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--processing-evidence', join(fixture.root, 'processing-evidence.json'),
        '--effective-at-utc', READY_AUTHORIZATION_AT_UTC,
        '--updated-by', 'authorized-operator',
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
      expect(result.stdout).toContain('CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD');
      expect(result.stdout).toContain('"networkRequestPerformed": false');
      expect(result.stdout).toContain('"productionMutationPerformed": false');
      expect(result.stderr).toBe('');
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('blocks all mutation wrappers before any child process when authorization is semantically incomplete', () => {
    const template = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json'),
      'utf8',
    )) as unknown;
    const fixture = writeProtectedAuthorization(template);
    const binDir = join(fixture.root, 'semantic-bin');
    mkdirSync(binDir, { mode: 0o700 });
    chmodSync(binDir, 0o700);
    const marker = join(fixture.root, 'semantic-child-invoked.txt');
    const fakePnpm = join(binDir, 'pnpm');
    writeFileSync(fakePnpm, `#!/bin/sh\nprintf invoked > "${marker}"\nexit 99\n`, { mode: 0o700 });
    chmodSync(fakePnpm, 0o700);
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` };

    const commands = [
      [
        'scripts/canonical/apply-production-canonical-migrations.ts',
        '--authorization', fixture.path,
        '--fk-evidence', join(fixture.root, 'fk-evidence.json'),
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
      ],
      [
        'scripts/canonical/import-production-canonical-bundle.ts',
        '--authorization', fixture.path,
        '--fk-evidence', join(fixture.root, 'fk-evidence.json'),
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--bundle', join(fixture.root, 'bundle.sql'),
        '--manifest', join(fixture.root, 'manifest.json'),
        '--source-export', join(fixture.root, 'source.sql'),
      ],
      [
        'scripts/canonical/set-production-canonical-flag.ts',
        '--authorization', fixture.path,
        '--fk-evidence', join(fixture.root, 'fk-evidence.json'),
        '--maintenance-recovery-evidence', join(fixture.root, 'maintenance-recovery.json'),
        '--worker-build-version-evidence', join(fixture.root, 'worker-build-version.json'),
        '--processing-evidence', join(fixture.root, 'processing-evidence.json'),
        '--effective-at-utc', READY_AUTHORIZATION_AT_UTC,
        '--updated-by', 'authorized-operator',
      ],
    ];

    for (const args of commands) {
      const result = spawnSync(executable, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env,
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('CDB101_EXECUTION_AUTHORIZATION_MISSING');
      expect(result.stdout).toContain('"documentReady": true');
      expect(result.stdout).toContain('"networkRequestPerformed": false');
      expect(result.stdout).toContain('"productionMutationPerformed": false');
      expect(result.stderr).toBe('');
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('keeps the local operations planner strict and fail-closed', () => {
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const defaultResult = spawnSync(executable, [
      'scripts/canonical/reporting-cutover-operations.ts',
      '--at-utc', READY_AUTHORIZATION_AT_UTC,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(defaultResult.status).toBe(0);
    const defaultPlan = JSON.parse(defaultResult.stdout) as Record<string, unknown>;
    expect(defaultPlan).toMatchObject({
      executionReady: false,
      productionMutationPerformed: false,
      aggregateOnly: true,
    });
    expect(defaultResult.stdout).toContain('CDB101_EXECUTION_AUTHORIZATION_MISSING');
    expect(defaultResult.stdout).not.toContain('CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD');

    const widened = writeProtectedAuthorization({
      ...createReadyReportingAuthorization(),
      deploymentAuthorized: true,
    });
    const widenedResult = spawnSync(executable, [
      'scripts/canonical/reporting-cutover-operations.ts',
      '--authorization', widened.path,
      '--at-utc', READY_AUTHORIZATION_AT_UTC,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(widenedResult.status).toBe(2);
    expect(widenedResult.stdout).toContain('CDB101_AUTHORIZATION_DOCUMENT_UNKNOWN_FIELD');
    expect(widenedResult.stdout).not.toContain('ops-rollback-primary');
    expect(widenedResult.stdout).not.toContain(widened.root);
  });

  it('keeps the committed template structurally exact but semantically fail-closed', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json'),
      'utf8',
    );
    const parsed = parseReportingCutoverAuthorizationJson(template);
    expect(parsed.documentReady).toBe(true);
    expect(parsed.authorization).not.toBeNull();
    expect(parsed.authorization).toMatchObject({
      schemaVersion: 4,
      ownerModel: 'single_operator_risk_accepted',
      singleOperatorRiskAcceptance: {
        dualRoleAccepted: true,
        independentObservationWaived: true,
        automaticAbortOnOperatorUnavailable: true,
        shadowOnlyAccepted: true,
        canonicalPromotionProhibited: true,
        workerTrafficChangeProhibited: true,
        postActivationReconciliationRequired: true,
      },
    });
    const semantic = validateReportingCutoverAuthorization(parsed.authorization!, READY_AUTHORIZATION_AT_UTC);
    expect(semantic.executionReady).toBe(false);
    expect(semantic.issues.length).toBeGreaterThan(0);
  });
});

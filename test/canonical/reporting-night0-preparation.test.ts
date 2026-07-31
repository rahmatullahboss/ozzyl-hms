import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  parseReportingNight0Args,
  prepareReportingNight0,
} from '../../scripts/canonical/prepare-reporting-night0';
import { parseReportingCutoverAuthorizationJson } from '../../scripts/canonical/reporting-cutover-authorization-document';

function createFixture(): {
  root: string;
  canonicalDatabase: string;
  legacyDatabase: string;
  sourceExport: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-night0-'));
  chmodSync(root, 0o700);
  const canonicalDatabase = join(root, 'canonical.sqlite');
  const canonical = new DatabaseSync(canonicalDatabase);
  canonical.exec(`
    CREATE TABLE canonical_alpha (
      tenant_id TEXT NOT NULL,
      public_id TEXT NOT NULL,
      note TEXT,
      PRIMARY KEY (tenant_id, public_id)
    );
    INSERT INTO canonical_alpha VALUES ('100', 'alpha-1', 'ready (north, lab)'), ('101', 'other', 'hidden');
  `);
  canonical.close();
  chmodSync(canonicalDatabase, 0o600);

  const legacyDatabase = join(root, 'legacy.sqlite');
  const legacy = new DatabaseSync(legacyDatabase);
  legacy.exec(`
    CREATE TABLE bills (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL);
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      reference_bill_id INTEGER
    );
    CREATE TABLE income (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      bill_id INTEGER
    );
    CREATE TABLE doctor_commission_accruals_old_0391 (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      bill_id INTEGER,
      visit_id INTEGER
    );
  `);
  for (let id = 1; id <= 4; id += 1) {
    legacy.prepare('INSERT INTO billing_deposits VALUES (?, 100, ?)').run(id, 1000 + id);
    legacy.prepare('INSERT INTO income VALUES (?, 100, ?)').run(id, 2000 + id);
  }
  for (let id = 1; id <= 26; id += 1) {
    legacy.prepare('INSERT INTO doctor_commission_accruals_old_0391(id, tenant_id, bill_id, visit_id) VALUES (?, 100, ?, NULL)').run(id, 3000 + id);
  }
  for (let id = 27; id <= 41; id += 1) {
    legacy.prepare('INSERT INTO doctor_commission_accruals_old_0391(id, tenant_id, bill_id, visit_id) VALUES (?, 100, NULL, ?)').run(id, 4000 + id);
  }
  legacy.close();
  chmodSync(legacyDatabase, 0o600);

  const sourceExport = join(root, 'source-export.sql');
  writeFileSync(sourceExport, 'protected export\n', { mode: 0o600 });
  return { root, canonicalDatabase, legacyDatabase, sourceExport };
}

function prepare(name = 'output') {
  const fixture = createFixture();
  const result = prepareReportingNight0({
    canonicalSourceDatabase: fixture.canonicalDatabase,
    legacySourceDatabase: fixture.legacyDatabase,
    sourceExportPath: fixture.sourceExport,
    outputDirectory: join(fixture.root, name),
    candidateCommit: 'a'.repeat(40),
    authorizationId: 'cdb101-night0-candidate-20260715',
    deterministicRunId: 'cdb101-tenant-100-run-20260715',
    repositoryManifestSha256: 'b'.repeat(64),
    workerDryRunSha256: 'c'.repeat(64),
    repositoryRouteFingerprintSha256: 'd'.repeat(64),
    allowedTables: ['canonical_alpha'],
    expectedForeignKeyCounts: {
      billingDepositsToBills: 4,
      incomeToBills: 4,
      archivalToBills: 26,
      archivalToVisits: 15,
    },
  });
  return { fixture, result };
}

describe('CDB-101 Night-0 preparation', () => {
  it('creates protected FK plans, deterministic import artifacts, a fail-closed authorization draft, and No-Go evidence', () => {
    const { result } = prepare();
    expect(result).toMatchObject({
      schemaVersion: 1,
      preparationReady: true,
      decision: 'no_go',
      activeFinancialViolationCount: 8,
      archivalViolationCount: 41,
      importTableCount: 1,
      importRowCount: 1,
      authorizationDocumentReady: true,
      authorizationExecutionReady: false,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(JSON.stringify(result)).not.toContain(tmpdir());

    const active = JSON.parse(readFileSync(result.activeFkPlanPath, 'utf8'));
    expect(active).toMatchObject({
      schemaVersion: 1,
      approved: false,
      strategy: 'clear_orphan_reference_preserve_row',
      hardDelete: false,
      observedViolationCount: 8,
      expectedRemainingViolationCountAfterExecution: 0,
    });
    expect(active.groups).toHaveLength(2);
    expect(active.groups[0].rows).toHaveLength(4);
    expect(active.groups[0].rows[0].statement).toContain('SET reference_bill_id = NULL');
    expect(active.groups[0].rows[0].bindings).toHaveLength(3);

    const archival = JSON.parse(readFileSync(result.archivalWaiverPath, 'utf8'));
    expect(archival).toMatchObject({
      schemaVersion: 1,
      approved: false,
      observedViolationCount: 41,
      importExcluded: true,
      removalPhase: 'legacy_retirement_p11',
    });
    expect(archival.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentTable: 'bills', violationCount: 26 }),
      expect.objectContaining({ parentTable: 'visits', violationCount: 15 }),
    ]));

    const authorizationText = readFileSync(result.authorizationDraftPath, 'utf8');
    const parsed = parseReportingCutoverAuthorizationJson(authorizationText);
    expect(parsed.documentReady).toBe(true);
    expect(parsed.authorization).toMatchObject({
      authorizationId: 'cdb101-night0-candidate-20260715',
      productionExecutionAuthorized: false,
      deployment: {
        authorized: false,
        candidateCommit: 'a'.repeat(40),
        candidateWorkerVersionId: null,
        routeFingerprintSha256: null,
      },
      migrations: { authorized: false, repositoryManifestSha256: 'b'.repeat(64), commandId: null },
      productionImport: {
        authorized: false,
        commandApproved: false,
        commandId: null,
        deterministicRunId: 'cdb101-tenant-100-run-20260715',
      },
      featureFlagPlan: { authorized: false, commandId: null, effectiveAtUtc: null },
      exportEvidence: { captured: false },
    });
    expect(statSync(result.activeFkPlanPath).mode & 0o777).toBe(0o600);
    expect(statSync(result.authorizationDraftPath).mode & 0o777).toBe(0o600);
  });

  it('fails closed on count drift and refuses execution arguments', () => {
    const fixture = createFixture();
    const badOutput = join(fixture.root, 'bad-output');
    expect(() => prepareReportingNight0({
      canonicalSourceDatabase: fixture.canonicalDatabase,
      legacySourceDatabase: fixture.legacyDatabase,
      sourceExportPath: fixture.sourceExport,
      outputDirectory: badOutput,
      candidateCommit: 'a'.repeat(40),
      authorizationId: 'cdb101-night0-candidate-20260715',
      deterministicRunId: 'cdb101-tenant-100-run-20260715',
      repositoryManifestSha256: 'b'.repeat(64),
      workerDryRunSha256: 'c'.repeat(64),
      repositoryRouteFingerprintSha256: 'd'.repeat(64),
      allowedTables: ['canonical_alpha'],
      expectedForeignKeyCounts: {
        billingDepositsToBills: 5,
        incomeToBills: 4,
        archivalToBills: 26,
        archivalToVisits: 15,
      },
    })).toThrow(/foreign key count drift/i);
    expect(existsSync(badOutput)).toBe(false);
    expect(() => parseReportingNight0Args(['--execute'])).toThrow(/unknown argument/i);
  });
});

import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';
import {
  collectReportingActiveFkDiagnosis,
  parseReportingActiveFkDiagnosisArgs,
  type ActiveFkDiagnosisRunner,
} from '../../scripts/canonical/collect-reporting-active-fk-diagnosis';

function createRunner(overrides: Record<string, unknown> = {}, changedDb = false): ActiveFkDiagnosisRunner {
  return (args) => {
    if (args[0] === 'd1' && args[1] === 'info') {
      return {
        stdout: `wrangler warning\n${JSON.stringify({
          name: CDB101_PRODUCTION_DATABASE_NAME,
          uuid: CDB101_PRODUCTION_DATABASE_ID,
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    }
    const row = {
      billing_deposit_orphans: 4,
      billing_deposit_nullable: 1,
      billing_deposit_deterministic_candidates: 0,
      billing_deposit_ambiguous_candidates: 0,
      billing_deposit_unmatched: 4,
      income_orphans: 4,
      income_nullable: 1,
      income_deterministic_candidates: 0,
      income_ambiguous_candidates: 0,
      income_unmatched: 4,
      archival_violations: 41,
      total_fk_violations: 49,
      ...overrides,
    };
    return {
      stdout: JSON.stringify([{
        results: [row],
        success: true,
        meta: {
          changed_db: changedDb,
          rows_written: changedDb ? 1 : 0,
        },
      }]),
      stderr: '',
      exitCode: 0,
    };
  };
}

describe('CDB-101 active FK diagnosis collector', () => {
  it('collects exact read-only aggregates and writes a protected diagnosis', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb101-active-fk-collector-'));
    const outputPath = join(root, 'protected', 'diagnosis.json');
    const { diagnosis, receipt } = collectReportingActiveFkDiagnosis({
      outputPath,
      capturedAtUtc: '2026-07-18T00:40:00.000Z',
      repositoryRoot: process.cwd(),
      runner: createRunner(),
    });

    expect(receipt).toEqual({
      schemaVersion: 1,
      diagnosisReady: true,
      activeGroupCount: 2,
      activeViolationCount: 8,
      archivalViolationCount: 41,
      totalForeignKeyViolationCount: 49,
      deterministicReplacementCandidateCount: 0,
      ambiguousReplacementCandidateCount: 0,
      unmatchedActiveViolationCount: 8,
      nullableReferenceCount: 2,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      externalCommandPerformed: true,
    });
    expect(diagnosis.groups).toEqual([
      expect.objectContaining({ childTable: 'billing_deposits', violationCount: 4 }),
      expect.objectContaining({ childTable: 'income', violationCount: 4 }),
    ]);
    expect(statSync(join(root, 'protected')).mode & 0o777).toBe(0o700);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(stored.capturedAtUtc).toBe('2026-07-18T00:40:00.000Z');
    expect(stored.productionMutationPerformed).toBe(false);
  });

  it('fails closed on count drift, candidate ambiguity, and write metadata', () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'cdb101-active-fk-drift-'));
    expect(() => collectReportingActiveFkDiagnosis({
      outputPath: join(firstRoot, 'protected', 'diagnosis.json'),
      repositoryRoot: process.cwd(),
      runner: createRunner({ billing_deposit_orphans: 5 }),
    })).toThrow(/must equal 4/i);

    const secondRoot = mkdtempSync(join(tmpdir(), 'cdb101-active-fk-ambiguous-'));
    expect(() => collectReportingActiveFkDiagnosis({
      outputPath: join(secondRoot, 'protected', 'diagnosis.json'),
      repositoryRoot: process.cwd(),
      runner: createRunner({ income_ambiguous_candidates: 1, income_unmatched: 3 }),
    })).toThrow(/ambiguous candidate count/i);

    const thirdRoot = mkdtempSync(join(tmpdir(), 'cdb101-active-fk-write-'));
    expect(() => collectReportingActiveFkDiagnosis({
      outputPath: join(thirdRoot, 'protected', 'diagnosis.json'),
      repositoryRoot: process.cwd(),
      runner: createRunner({}, true),
    })).toThrow(/read-only boundary/i);
  });

  it('refuses execution arguments and repository output paths', () => {
    expect(() => parseReportingActiveFkDiagnosisArgs(['--execute'])).toThrow(/unknown argument/i);
    expect(() => collectReportingActiveFkDiagnosis({
      outputPath: join(process.cwd(), 'diagnosis.json'),
      repositoryRoot: process.cwd(),
      runner: createRunner(),
    })).toThrow(/outside the repository/i);
  });
});

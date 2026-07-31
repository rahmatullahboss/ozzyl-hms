import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';
import {
  collectReportingArchivalFkWaiverPrerequisites,
  parseReportingArchivalFkWaiverPrerequisiteArgs,
  type ArchivalFkPrerequisiteRunner,
} from '../../scripts/canonical/collect-reporting-archival-fk-waiver-prerequisites';

function createRepositoryRoot(runtimeReference = false): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-archival-repo-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'runtime.ts'),
    runtimeReference
      ? "export const table = 'doctor_commission_accruals_old_0391';\n"
      : "export const table = 'doctor_commission_accruals';\n",
  );
  return root;
}

function createRunner(overrides: Record<string, unknown> = {}, changedDb = false): ArchivalFkPrerequisiteRunner {
  return (args) => {
    if (args[0] === 'd1' && args[1] === 'info') {
      return {
        stdout: JSON.stringify({
          name: CDB101_PRODUCTION_DATABASE_NAME,
          uuid: CDB101_PRODUCTION_DATABASE_ID,
        }),
        stderr: '',
        exitCode: 0,
      };
    }
    return {
      stdout: JSON.stringify([{
        results: [{
          archival_row_count: 1358,
          archival_latest_created_at: '2026-07-06 04:37:28',
          archival_latest_updated_at: '2026-07-06 04:37:28',
          active_row_count: 2175,
          active_latest_created_at: '2026-07-17 21:12:28',
          trigger_count: 0,
          dependent_object_count: 0,
          archival_to_bills: 26,
          archival_to_visits: 15,
          ...overrides,
        }],
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

describe('CDB-101 archival FK waiver prerequisite collector', () => {
  it('writes a protected aggregate candidate when all technical prerequisites are fresh', () => {
    const repositoryRoot = createRepositoryRoot();
    const protectedRoot = mkdtempSync(join(tmpdir(), 'cdb101-archival-protected-'));
    const outputPath = join(protectedRoot, 'candidate.json');

    const { candidate, receipt } = collectReportingArchivalFkWaiverPrerequisites({
      outputPath,
      repositoryRoot,
      capturedAtUtc: '2026-07-18T01:20:00.000Z',
      runner: createRunner(),
    });

    expect(receipt).toEqual({
      schemaVersion: 1,
      prerequisiteCandidateReady: true,
      archivalViolationCount: 41,
      runtimeSourceReferenceCount: 0,
      triggerCount: 0,
      dependentObjectCount: 0,
      formalApprovalRecorded: false,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      externalCommandPerformed: true,
    });
    expect(candidate.attestations).toEqual({
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: 'legacy_retirement_p11',
    });
    expect(candidate.formalApproval).toEqual({
      approved: false,
      ownerId: null,
      approvedAtUtc: null,
      evidenceId: null,
      evidenceSha256: null,
    });
    expect(statSync(dirname(outputPath)).mode & 0o777).toBe(0o700);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).capturedAtUtc)
      .toBe('2026-07-18T01:20:00.000Z');
  });

  it('fails closed on runtime references, new archival writes, dependencies, or write metadata', () => {
    const protectedRoot = mkdtempSync(join(tmpdir(), 'cdb101-archival-fail-'));
    expect(() => collectReportingArchivalFkWaiverPrerequisites({
      outputPath: join(protectedRoot, 'runtime-reference.json'),
      repositoryRoot: createRepositoryRoot(true),
      runner: createRunner(),
    })).toThrow(/runtime source reference/i);

    expect(() => collectReportingArchivalFkWaiverPrerequisites({
      outputPath: join(protectedRoot, 'new-write.json'),
      repositoryRoot: createRepositoryRoot(),
      runner: createRunner({ archival_latest_updated_at: '2026-07-18 01:00:00' }),
    })).toThrow(/archival table is not retired/i);

    expect(() => collectReportingArchivalFkWaiverPrerequisites({
      outputPath: join(protectedRoot, 'dependency.json'),
      repositoryRoot: createRepositoryRoot(),
      runner: createRunner({ dependent_object_count: 1 }),
    })).toThrow(/dependent object/i);

    expect(() => collectReportingArchivalFkWaiverPrerequisites({
      outputPath: join(protectedRoot, 'write.json'),
      repositoryRoot: createRepositoryRoot(),
      runner: createRunner({}, true),
    })).toThrow(/read-only boundary/i);
  });

  it('rejects execution arguments and repository output paths', () => {
    expect(() => parseReportingArchivalFkWaiverPrerequisiteArgs(['--execute']))
      .toThrow(/unknown argument/i);

    const repositoryRoot = createRepositoryRoot();
    expect(() => collectReportingArchivalFkWaiverPrerequisites({
      outputPath: join(repositoryRoot, 'candidate.json'),
      repositoryRoot,
      runner: createRunner(),
    })).toThrow(/outside the repository/i);
  });
});

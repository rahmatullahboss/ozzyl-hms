import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';
import {
  parseReportingArchivalFkWaiverArgs,
  prepareReportingArchivalFkWaivers,
} from '../../scripts/canonical/prepare-reporting-archival-fk-waivers';

function createProtectedInputs(): {
  repositoryRoot: string;
  protectedRoot: string;
  candidatePath: string;
  approvalPath: string;
  outputPath: string;
} {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'cdb101-waiver-repo-'));
  const protectedRoot = mkdtempSync(join(tmpdir(), 'cdb101-waiver-protected-'));
  chmodSync(protectedRoot, 0o700);
  const candidatePath = join(protectedRoot, 'candidate.json');
  const approvalPath = join(protectedRoot, 'approval.json');
  const outputPath = join(protectedRoot, 'waivers.json');
  const candidateRaw = `${JSON.stringify({
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    capturedAtUtc: '2026-07-18T01:20:00.000Z',
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    archivalTable: 'doctor_commission_accruals_old_0391',
    productionEvidence: {
      archivalRowCount: 1358,
      archivalLatestCreatedAtUtc: '2026-07-06T04:37:28.000Z',
      archivalLatestUpdatedAtUtc: '2026-07-06T04:37:28.000Z',
      activeTable: 'doctor_commission_accruals',
      activeRowCount: 2175,
      activeLatestCreatedAtUtc: '2026-07-17T21:12:28.000Z',
      triggerCount: 0,
      dependentObjectCount: 0,
      billsViolationCount: 26,
      visitsViolationCount: 15,
      totalArchivalViolationCount: 41,
      changedDb: false,
      rowsWritten: 0,
    },
    repositoryEvidence: {
      runtimeSourceReferenceCount: 0,
      excludedFromCanonicalImport: true,
      excludedFromReporting: true,
    },
    attestations: {
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: 'legacy_retirement_p11',
    },
    formalApproval: {
      approved: false,
      ownerId: null,
      approvedAtUtc: null,
      evidenceId: null,
      evidenceSha256: null,
    },
    aggregateOnly: true,
    productionMutationPerformed: false,
  }, null, 2)}\n`;
  writeFileSync(candidatePath, candidateRaw, { mode: 0o600 });
  writeFileSync(approvalPath, `${JSON.stringify({
    schemaVersion: 1,
    approvalId: 'cdb101-archival-waiver-approval-20260718-01',
    approved: true,
    ownerId: 'rahmatullah-zisan',
    approvedAtUtc: '2026-07-18T01:25:00.000Z',
    program: 'CDB-101',
    domain: 'reporting',
    scope: 'archival_fk_only',
    prerequisiteCandidateSha256: createHash('sha256').update(candidateRaw).digest('hex'),
    groups: [
      {
        childTable: 'doctor_commission_accruals_old_0391',
        parentTable: 'bills',
        violationCount: 26,
      },
      {
        childTable: 'doctor_commission_accruals_old_0391',
        parentTable: 'visits',
        violationCount: 15,
      },
    ],
    removalPhase: 'legacy_retirement_p11',
    source: 'user_explicit_production_authorization',
  }, null, 2)}\n`, { mode: 0o600 });
  return { repositoryRoot, protectedRoot, candidatePath, approvalPath, outputPath };
}

describe('CDB-101 archival FK waiver preparation', () => {
  it('creates two exact formal waiver records from protected technical and owner evidence', () => {
    const paths = createProtectedInputs();
    const { package: waiverPackage, receipt } = prepareReportingArchivalFkWaivers({
      candidatePath: paths.candidatePath,
      approvalPath: paths.approvalPath,
      outputPath: paths.outputPath,
      repositoryRoot: paths.repositoryRoot,
      preparedAtUtc: '2026-07-18T01:26:00.000Z',
    });

    expect(receipt).toEqual({
      schemaVersion: 1,
      waiverPackageReady: true,
      waiverCount: 2,
      waivedViolationCount: 41,
      ownerId: 'rahmatullah-zisan',
      formalApprovalRecorded: true,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(waiverPackage.waivers).toHaveLength(2);
    expect(waiverPackage.waivers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentTable: 'bills',
        initialViolationCount: 26,
        approved: true,
        waivedViolationCount: 26,
        remainingViolationCount: 26,
      }),
      expect.objectContaining({
        parentTable: 'visits',
        initialViolationCount: 15,
        approved: true,
        waivedViolationCount: 15,
        remainingViolationCount: 15,
      }),
    ]));
    expect(new Set(waiverPackage.waivers.map((item) => item.evidenceId)).size).toBe(2);
    expect(new Set(waiverPackage.waivers.map((item) => item.evidenceSha256)).size).toBe(2);
    expect(statSync(paths.outputPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(paths.outputPath, 'utf8')).preparedAtUtc)
      .toBe('2026-07-18T01:26:00.000Z');
  });

  it('fails closed on unapproved, wrong-scope, or pre-candidate approval evidence', () => {
    const unapproved = createProtectedInputs();
    const approval = JSON.parse(readFileSync(unapproved.approvalPath, 'utf8'));
    approval.approved = false;
    writeFileSync(unapproved.approvalPath, `${JSON.stringify(approval)}\n`, { mode: 0o600 });
    expect(() => prepareReportingArchivalFkWaivers({
      candidatePath: unapproved.candidatePath,
      approvalPath: unapproved.approvalPath,
      outputPath: unapproved.outputPath,
      repositoryRoot: unapproved.repositoryRoot,
    })).toThrow(/approval is required/i);

    const wrongScope = createProtectedInputs();
    const wrongScopeApproval = JSON.parse(readFileSync(wrongScope.approvalPath, 'utf8'));
    wrongScopeApproval.scope = 'all_foreign_keys';
    writeFileSync(wrongScope.approvalPath, `${JSON.stringify(wrongScopeApproval)}\n`, { mode: 0o600 });
    expect(() => prepareReportingArchivalFkWaivers({
      candidatePath: wrongScope.candidatePath,
      approvalPath: wrongScope.approvalPath,
      outputPath: wrongScope.outputPath,
      repositoryRoot: wrongScope.repositoryRoot,
    })).toThrow(/archival-only scope/i);

    const chronology = createProtectedInputs();
    const earlyApproval = JSON.parse(readFileSync(chronology.approvalPath, 'utf8'));
    earlyApproval.approvedAtUtc = '2026-07-18T01:19:00.000Z';
    writeFileSync(chronology.approvalPath, `${JSON.stringify(earlyApproval)}\n`, { mode: 0o600 });
    expect(() => prepareReportingArchivalFkWaivers({
      candidatePath: chronology.candidatePath,
      approvalPath: chronology.approvalPath,
      outputPath: chronology.outputPath,
      repositoryRoot: chronology.repositoryRoot,
    })).toThrow(/after prerequisite capture/i);
  });

  it('rejects approval evidence that is not bound to the exact prerequisite candidate', () => {
    const paths = createProtectedInputs();
    const approval = JSON.parse(readFileSync(paths.approvalPath, 'utf8'));
    approval.prerequisiteCandidateSha256 = '0'.repeat(64);
    writeFileSync(paths.approvalPath, `${JSON.stringify(approval)}\n`, { mode: 0o600 });

    expect(() => prepareReportingArchivalFkWaivers({
      candidatePath: paths.candidatePath,
      approvalPath: paths.approvalPath,
      outputPath: paths.outputPath,
      repositoryRoot: paths.repositoryRoot,
    })).toThrow(/candidate sha-256/i);
  });

  it('rejects execution arguments and repository outputs', () => {
    expect(() => parseReportingArchivalFkWaiverArgs(['--execute']))
      .toThrow(/unknown argument/i);
    const paths = createProtectedInputs();
    mkdirSync(join(paths.repositoryRoot, 'evidence'));
    expect(() => prepareReportingArchivalFkWaivers({
      candidatePath: paths.candidatePath,
      approvalPath: paths.approvalPath,
      outputPath: join(paths.repositoryRoot, 'evidence', 'waivers.json'),
      repositoryRoot: paths.repositoryRoot,
    })).toThrow(/outside the repository/i);
  });
});

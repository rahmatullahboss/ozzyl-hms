import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkProductionAuthorizationPackageReadiness,
  type ProductionAuthorizationPackageRepositoryState,
} from '../../scripts/canonical/check-production-authorization-package-readiness';

const root = process.cwd();
const packageValue = JSON.parse(readFileSync(
  'docs/database/cdb-v1-060-production-authorization-package.json',
  'utf8',
)) as unknown;
const repositoryState: ProductionAuthorizationPackageRepositoryState = {
  branch: 'program/cdb-main-continuous-20260725',
  head: 'c'.repeat(40),
  candidateCommitExists: true,
  candidateCommitIsAncestorOfHead: true,
};

describe('CDB-V1-060 production authorization package readiness', () => {
  it('accepts the committed repository package while keeping execution blocked', () => {
    const result = checkProductionAuthorizationPackageReadiness(root, packageValue, repositoryState);

    expect(result).toMatchObject({
      checkpoint: 'CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY',
      packageReady: true,
      executionReady: false,
      issueCount: 0,
      issues: [],
      candidateCommit: '35e299d9ff2dc1781084dacd6d0f431816b0007c',
      migrationCount: 19,
      backfillCount: 4,
      providerCount: 9,
      consumerCount: 12,
      sourceTableCount: 9,
      unresolvedExternalBindingCount: 18,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
  });

  it('fails closed when branch or candidate ancestry is not proven', () => {
    const result = checkProductionAuthorizationPackageReadiness(root, packageValue, {
      ...repositoryState,
      branch: 'feature/unintegrated-production-package',
      candidateCommitExists: false,
      candidateCommitIsAncestorOfHead: false,
    });

    expect(result.packageReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'current branch does not match the package branch',
      'candidate commit is not present in the repository',
      'candidate commit is not an ancestor of current HEAD',
    ]));
  });

  it('fails closed on an invalid current HEAD', () => {
    const result = checkProductionAuthorizationPackageReadiness(root, packageValue, {
      ...repositoryState,
      head: 'invalid',
    });

    expect(result.packageReady).toBe(false);
    expect(result.issues).toContain('current HEAD is invalid');
  });
});

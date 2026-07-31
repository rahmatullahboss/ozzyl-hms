import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildAllTenantShadowExecutionPackage,
} from '../../scripts/canonical/all-tenant-shadow-execution-package';
import {
  checkAllTenantShadowExecutionReadiness,
  resolveAllTenantShadowExecutionRepositoryState,
  type AllTenantShadowExecutionRepositoryState,
} from '../../scripts/canonical/check-all-tenant-shadow-execution-readiness';

const root = process.cwd();

function head(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function branch(): string {
  return execFileSync('git', ['branch', '--show-current'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function packageValue() {
  const currentHead = head();
  return buildAllTenantShadowExecutionPackage(root, {
    branch: 'program/cdb-main-continuous-20260725',
    preparationCommit: currentHead,
    buildSha: currentHead,
  });
}

function readyState(): AllTenantShadowExecutionRepositoryState {
  const currentHead = head();
  return {
    branch: 'program/cdb-main-continuous-20260725',
    head: currentHead,
    preparationCommitExists: true,
    preparationCommitIsAncestorOfHead: true,
    minimumImplementationIsAncestorOfPreparation: true,
  };
}

describe('CDB-V1-070A all-tenant shadow execution readiness', () => {
  it('accepts the repository package while keeping execution blocked without protected authorization', () => {
    const result = checkAllTenantShadowExecutionReadiness(
      root,
      packageValue(),
      readyState(),
      null,
    );

    expect(result).toMatchObject({
      checkpoint: 'CDB-V1-070A-ALL-TENANT-SHADOW-EXECUTION-AUTHORIZATION-CONTRACT-READY',
      packageReady: true,
      authorizationPresent: false,
      authorizationReady: false,
      executionReady: false,
      issueCount: 0,
      issues: [],
      tenantCount: 4,
      migrationCount: 29,
      backfillCount: 4,
      providerCount: 9,
      expectedProviderFlagRowCount: 36,
      unresolvedExternalBindingCount: 34,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
  });

  it('reports a supplied invalid protected authorization without weakening package readiness', () => {
    const result = checkAllTenantShadowExecutionReadiness(
      root,
      packageValue(),
      readyState(),
      {
        documentReady: true,
        executionReady: false,
        issues: [{ code: 'CDBV1070_AUTHORIZATION_SCOPE_INVALID', gate: 'scope' }],
        authorization: null,
      },
    );

    expect(result.packageReady).toBe(true);
    expect(result.authorizationPresent).toBe(true);
    expect(result.authorizationReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.authorizationIssues).toEqual([
      'CDBV1070_AUTHORIZATION_SCOPE_INVALID',
    ]);
  });

  it('fails repository readiness when branch or ancestry is not proven', () => {
    const result = checkAllTenantShadowExecutionReadiness(
      root,
      packageValue(),
      {
        ...readyState(),
        branch: 'feature/unintegrated-shadow',
        preparationCommitExists: false,
        preparationCommitIsAncestorOfHead: false,
        minimumImplementationIsAncestorOfPreparation: false,
      },
      null,
    );

    expect(result.packageReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'current branch does not match the package preparation branch',
      'preparation commit is not present in the repository',
      'preparation commit is not an ancestor of current HEAD',
      'minimum all-tenant shadow implementation is not in the preparation commit',
    ]));
  });

  it('resolves exact current Git state locally', () => {
    const document = packageValue();
    const state = resolveAllTenantShadowExecutionRepositoryState(
      root,
      document.preparation.repositoryCommit,
    );

    expect(state).toEqual({
      branch: branch(),
      head: head(),
      preparationCommitExists: true,
      preparationCommitIsAncestorOfHead: true,
      minimumImplementationIsAncestorOfPreparation: true,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  checkIntegratedMainPackageReadiness,
} from '../../scripts/canonical/check-integrated-main-package-readiness';

const root = process.cwd();

describe('integrated main historical package readiness', () => {
  it('validates immutable historical packages from integrated main without enabling execution', () => {
    const result = checkIntegratedMainPackageReadiness(root, 'main');

    expect(result).toMatchObject({
      integratedMainReady: true,
      executionReady: false,
      issueCount: 0,
      issues: [],
      branch: 'main',
      productionAuthorization: {
        packageReady: true,
        executionReady: false,
        issueCount: 0,
      },
      allTenantExecution: {
        packageReady: true,
        authorizationReady: false,
        executionReady: false,
        issueCount: 0,
      },
      allTenantPreparation: {
        packageReady: true,
        authorizationReady: false,
        executionReady: false,
        issueCount: 0,
      },
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
  });

  it('fails closed when invoked outside integrated main', () => {
    const result = checkIntegratedMainPackageReadiness(root, 'feature/unintegrated-main');

    expect(result.integratedMainReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toContain('current branch is not integrated main');
  });
});

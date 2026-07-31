import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB_V1_060_BRANCH,
} from './production-authorization-package';
import {
  checkProductionAuthorizationPackageReadiness,
  resolveProductionAuthorizationPackageRepositoryState,
} from './check-production-authorization-package-readiness';
import {
  CDB_V1_070A_BRANCH,
} from './all-tenant-shadow-execution-package';
import {
  checkAllTenantShadowExecutionReadiness,
  resolveAllTenantShadowExecutionRepositoryState,
} from './check-all-tenant-shadow-execution-readiness';
import {
  CDB_V1_070B_BRANCH,
} from './all-tenant-shadow-preparation-package';
import {
  checkAllTenantShadowPreparationReadiness,
  resolveAllTenantShadowPreparationRepositoryState,
} from './check-all-tenant-shadow-preparation-readiness';

const INTEGRATED_MAIN_BRANCH = 'main';
const PRODUCTION_PACKAGE_PATH = 'docs/database/cdb-v1-060-production-authorization-package.json';
const EXECUTION_PACKAGE_PATH = 'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';
const PREPARATION_PACKAGE_PATH = 'docs/database/cdb-v1-070b-all-tenant-shadow-preparation-package.json';

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function gitBranch(root: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readJson(root: string, relativePath: string): unknown {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as unknown;
}

export function checkIntegratedMainPackageReadiness(
  rootInput: string,
  branchOverride?: string,
) {
  const root = resolve(rootInput);
  const currentBranch = branchOverride ?? gitBranch(root);

  const productionPackage = readJson(root, PRODUCTION_PACKAGE_PATH);
  const productionCandidate = object(object(productionPackage)?.candidate);
  const candidateCommit = typeof productionCandidate?.candidateCommit === 'string'
    ? productionCandidate.candidateCommit
    : null;
  const productionState = resolveProductionAuthorizationPackageRepositoryState(root, candidateCommit);
  const productionAuthorization = checkProductionAuthorizationPackageReadiness(
    root,
    productionPackage,
    { ...productionState, branch: CDB_V1_060_BRANCH },
  );

  const executionPackage = readJson(root, EXECUTION_PACKAGE_PATH);
  const executionPreparation = object(object(executionPackage)?.preparation);
  const executionPreparationCommit = typeof executionPreparation?.repositoryCommit === 'string'
    ? executionPreparation.repositoryCommit
    : null;
  const executionState = resolveAllTenantShadowExecutionRepositoryState(
    root,
    executionPreparationCommit,
  );
  const allTenantExecution = checkAllTenantShadowExecutionReadiness(
    root,
    executionPackage,
    { ...executionState, branch: CDB_V1_070A_BRANCH },
    null,
  );

  const preparationPackage = readJson(root, PREPARATION_PACKAGE_PATH);
  const preparationMetadata = object(object(preparationPackage)?.preparation);
  const preparationCommit = typeof preparationMetadata?.repositoryCommit === 'string'
    ? preparationMetadata.repositoryCommit
    : null;
  const preparationState = resolveAllTenantShadowPreparationRepositoryState(root, preparationCommit);
  const allTenantPreparation = checkAllTenantShadowPreparationReadiness(
    root,
    preparationPackage,
    { ...preparationState, branch: CDB_V1_070B_BRANCH },
    null,
  );

  const issues: string[] = [];
  if (currentBranch !== INTEGRATED_MAIN_BRANCH) {
    issues.push('current branch is not integrated main');
  }
  const heads = new Set([productionState.head, executionState.head, preparationState.head]);
  if (heads.size !== 1) issues.push('package readiness checks resolved different repository heads');
  if (!productionAuthorization.packageReady) issues.push('CDB-V1-060 package is not ready');
  if (!allTenantExecution.packageReady) issues.push('CDB-V1-070A package is not ready');
  if (!allTenantPreparation.packageReady) issues.push('CDB-V1-070B package is not ready');

  const uniqueIssues = [...new Set(issues)];
  return {
    integratedMainReady: uniqueIssues.length === 0,
    executionReady: false,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    branch: currentBranch,
    head: productionState.head,
    productionAuthorization,
    allTenantExecution,
    allTenantPreparation,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}

function main(): void {
  try {
    const result = checkIntegratedMainPackageReadiness(process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.integratedMainReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

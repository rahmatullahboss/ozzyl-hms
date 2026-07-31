import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB_V1_060_BRANCH,
  CDB_V1_060_CHECKPOINT,
  evaluateProductionAuthorizationPackage,
} from './production-authorization-package';

const PACKAGE_PATH = 'docs/database/cdb-v1-060-production-authorization-package.json';

export interface ProductionAuthorizationPackageRepositoryState {
  branch: string;
  head: string;
  candidateCommitExists: boolean;
  candidateCommitIsAncestorOfHead: boolean;
}

export interface ProductionAuthorizationPackageReadiness {
  checkpoint: typeof CDB_V1_060_CHECKPOINT;
  packageReady: boolean;
  executionReady: false;
  issueCount: number;
  issues: string[];
  candidateCommit: string | null;
  migrationCount: number;
  backfillCount: number;
  providerCount: number;
  consumerCount: number;
  sourceTableCount: number;
  unresolvedExternalBindingCount: number;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function checkProductionAuthorizationPackageReadiness(
  rootInput: string,
  packageValue: unknown,
  repositoryState: ProductionAuthorizationPackageRepositoryState,
): ProductionAuthorizationPackageReadiness {
  const root = resolve(rootInput);
  const evaluation = evaluateProductionAuthorizationPackage(root, packageValue);
  const issues = [...evaluation.issues];
  const packageObject = object(packageValue);
  const candidate = object(packageObject?.candidate);
  const candidateCommit = typeof candidate?.candidateCommit === 'string'
    ? candidate.candidateCommit
    : null;

  if (repositoryState.branch !== CDB_V1_060_BRANCH || candidate?.branch !== CDB_V1_060_BRANCH) {
    issues.push('current branch does not match the package branch');
  }
  if (!/^[0-9a-f]{40}$/.test(repositoryState.head)) issues.push('current HEAD is invalid');
  if (!repositoryState.candidateCommitExists) issues.push('candidate commit is not present in the repository');
  if (!repositoryState.candidateCommitIsAncestorOfHead) {
    issues.push('candidate commit is not an ancestor of current HEAD');
  }

  const uniqueIssues = [...new Set(issues)];
  return {
    checkpoint: CDB_V1_060_CHECKPOINT,
    packageReady: evaluation.packageReady && uniqueIssues.length === 0,
    executionReady: false,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    candidateCommit,
    migrationCount: evaluation.migrationCount,
    backfillCount: evaluation.backfillCount,
    providerCount: evaluation.providerCount,
    consumerCount: evaluation.consumerCount,
    sourceTableCount: evaluation.sourceTableCount,
    unresolvedExternalBindingCount: evaluation.unresolvedExternalBindings.length,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}

function gitValue(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitSuccess(root: string, args: string[]): boolean {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  }).status === 0;
}

export function resolveProductionAuthorizationPackageRepositoryState(
  rootInput: string,
  candidateCommit: string | null,
): ProductionAuthorizationPackageRepositoryState {
  const root = resolve(rootInput);
  const branch = gitValue(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = gitValue(root, ['rev-parse', 'HEAD']);
  return {
    branch,
    head,
    candidateCommitExists: candidateCommit != null
      && gitSuccess(root, ['cat-file', '-e', `${candidateCommit}^{commit}`]),
    candidateCommitIsAncestorOfHead: candidateCommit != null
      && gitSuccess(root, ['merge-base', '--is-ancestor', candidateCommit, 'HEAD']),
  };
}

function main(): void {
  const root = process.cwd();
  try {
    const packageValue = JSON.parse(readFileSync(join(root, PACKAGE_PATH), 'utf8')) as unknown;
    const candidate = object(object(packageValue)?.candidate);
    const candidateCommit = typeof candidate?.candidateCommit === 'string'
      ? candidate.candidateCommit
      : null;
    const repositoryState = resolveProductionAuthorizationPackageRepositoryState(root, candidateCommit);
    const result = checkProductionAuthorizationPackageReadiness(root, packageValue, repositoryState);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.packageReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

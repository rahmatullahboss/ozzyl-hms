import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadAllTenantShadowExecutionAuthorization,
  type AllTenantShadowExecutionAuthorizationResult,
} from './all-tenant-shadow-execution-authorization';
import {
  CDB_V1_070A_BRANCH,
  CDB_V1_070A_CHECKPOINT,
  CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT,
  evaluateAllTenantShadowExecutionPackage,
  type AllTenantShadowExecutionPackage,
} from './all-tenant-shadow-execution-package';

const PACKAGE_PATH = 'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';

export interface AllTenantShadowExecutionRepositoryState {
  branch: string;
  head: string;
  preparationCommitExists: boolean;
  preparationCommitIsAncestorOfHead: boolean;
  minimumImplementationIsAncestorOfPreparation: boolean;
}

export interface AllTenantShadowExecutionReadiness {
  checkpoint: typeof CDB_V1_070A_CHECKPOINT;
  packageReady: boolean;
  authorizationPresent: boolean;
  authorizationReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
  authorizationIssues: string[];
  preparationCommit: string | null;
  tenantCount: number;
  migrationCount: number;
  backfillCount: number;
  providerCount: number;
  expectedProviderFlagRowCount: number;
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

export function checkAllTenantShadowExecutionReadiness(
  rootInput: string,
  packageValue: unknown,
  repositoryState: AllTenantShadowExecutionRepositoryState,
  authorizationResult: AllTenantShadowExecutionAuthorizationResult | null,
): AllTenantShadowExecutionReadiness {
  const root = resolve(rootInput);
  const evaluation = evaluateAllTenantShadowExecutionPackage(root, packageValue);
  const issues = [...evaluation.issues];
  const packageObject = object(packageValue);
  const preparation = object(packageObject?.preparation);
  const preparationCommit = typeof preparation?.repositoryCommit === 'string'
    ? preparation.repositoryCommit
    : null;

  if (repositoryState.branch !== CDB_V1_070A_BRANCH || preparation?.branch !== CDB_V1_070A_BRANCH) {
    issues.push('current branch does not match the package preparation branch');
  }
  if (!/^[0-9a-f]{40}$/.test(repositoryState.head)) issues.push('current HEAD is invalid');
  if (!repositoryState.preparationCommitExists) {
    issues.push('preparation commit is not present in the repository');
  }
  if (!repositoryState.preparationCommitIsAncestorOfHead) {
    issues.push('preparation commit is not an ancestor of current HEAD');
  }
  if (!repositoryState.minimumImplementationIsAncestorOfPreparation) {
    issues.push('minimum all-tenant shadow implementation is not in the preparation commit');
  }

  const uniqueIssues = [...new Set(issues)];
  const authorizationPresent = authorizationResult != null;
  const authorizationIssues = authorizationResult
    ? [...new Set(authorizationResult.issues.map((issue) => issue.code))]
    : [];
  const packageReady = evaluation.packageReady && uniqueIssues.length === 0;
  const authorizationReady = authorizationResult?.executionReady === true;

  return {
    checkpoint: CDB_V1_070A_CHECKPOINT,
    packageReady,
    authorizationPresent,
    authorizationReady,
    executionReady: packageReady && authorizationReady,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    authorizationIssues,
    preparationCommit,
    tenantCount: evaluation.tenantCount,
    migrationCount: evaluation.migrationCount,
    backfillCount: evaluation.backfillCount,
    providerCount: evaluation.providerCount,
    expectedProviderFlagRowCount: evaluation.expectedProviderFlagRowCount,
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

export function resolveAllTenantShadowExecutionRepositoryState(
  rootInput: string,
  preparationCommit: string | null,
): AllTenantShadowExecutionRepositoryState {
  const root = resolve(rootInput);
  const branch = gitValue(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = gitValue(root, ['rev-parse', 'HEAD']);
  const exists = preparationCommit != null
    && gitSuccess(root, ['cat-file', '-e', `${preparationCommit}^{commit}`]);
  return {
    branch,
    head,
    preparationCommitExists: exists,
    preparationCommitIsAncestorOfHead: exists
      && gitSuccess(root, ['merge-base', '--is-ancestor', preparationCommit as string, 'HEAD']),
    minimumImplementationIsAncestorOfPreparation: exists
      && gitSuccess(root, [
        'merge-base',
        '--is-ancestor',
        CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT,
        preparationCommit as string,
      ]),
  };
}

interface CliOptions {
  authorizationPath: string | null;
  atUtc: string;
}

function parseArgs(args: string[]): CliOptions {
  let authorizationPath: string | null = null;
  let atUtc = new Date().toISOString();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--') continue;
    if (arg === '--authorization') {
      if (!value || value.startsWith('--')) throw new Error('--authorization requires a path');
      authorizationPath = value;
      index += 1;
      continue;
    }
    if (arg === '--at-utc') {
      if (!value || value.startsWith('--')) throw new Error('--at-utc requires a value');
      atUtc = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { authorizationPath, atUtc };
}

function main(): void {
  const root = process.cwd();
  try {
    const options = parseArgs(process.argv.slice(2));
    const packageValue = JSON.parse(readFileSync(join(root, PACKAGE_PATH), 'utf8')) as unknown;
    const packageDocument = packageValue as AllTenantShadowExecutionPackage;
    const packageObject = object(packageValue);
    const preparation = object(packageObject?.preparation);
    const preparationCommit = typeof preparation?.repositoryCommit === 'string'
      ? preparation.repositoryCommit
      : null;
    const repositoryState = resolveAllTenantShadowExecutionRepositoryState(root, preparationCommit);
    const authorizationResult = options.authorizationPath
      ? loadAllTenantShadowExecutionAuthorization(
        resolve(options.authorizationPath),
        root,
        packageDocument,
        options.atUtc,
      )
      : null;
    const result = checkAllTenantShadowExecutionReadiness(
      root,
      packageValue,
      repositoryState,
      authorizationResult,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.packageReady || (options.authorizationPath && !result.executionReady)) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

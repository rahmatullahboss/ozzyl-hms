import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadAllTenantShadowPreparationAuthorization,
  type AllTenantShadowPreparationAuthorizationResult,
} from './all-tenant-shadow-preparation-authorization';
import {
  CDB_V1_070B_BRANCH,
  CDB_V1_070B_CHECKPOINT,
  CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT,
  CDB_V1_070B_PACKAGE_PATH,
  evaluateAllTenantShadowPreparationPackage,
  type AllTenantShadowPreparationPackage,
} from './all-tenant-shadow-preparation-package';

export interface AllTenantShadowPreparationRepositoryState {
  branch: string;
  head: string;
  preparationCommitExists: boolean;
  preparationCommitIsAncestorOfHead: boolean;
  minimumImplementationIsAncestorOfPreparation: boolean;
}

export interface AllTenantShadowPreparationReadiness {
  checkpoint: typeof CDB_V1_070B_CHECKPOINT;
  packageReady: boolean;
  authorizationPresent: boolean;
  authorizationReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
  authorizationIssues: string[];
  preparationCommit: string | null;
  tenantCount: number;
  commandCount: number;
  migrationManifestCount: number;
  expectedPendingMigrationCount: number;
  unresolvedExternalBindingCount: number;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
  workerVersionUploadPerformed: false;
  trafficChanged: false;
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function checkAllTenantShadowPreparationReadiness(
  rootInput: string,
  packageValue: unknown,
  repositoryState: AllTenantShadowPreparationRepositoryState,
  authorizationResult: AllTenantShadowPreparationAuthorizationResult | null,
): AllTenantShadowPreparationReadiness {
  const root = resolve(rootInput);
  const packageDocument = packageValue as AllTenantShadowPreparationPackage;
  let evaluation: ReturnType<typeof evaluateAllTenantShadowPreparationPackage>;
  try {
    evaluation = evaluateAllTenantShadowPreparationPackage(root, packageDocument);
  } catch (error) {
    evaluation = {
      packageReady: false,
      authorizationReady: false,
      executionReady: false,
      issues: [error instanceof Error ? error.message : String(error)],
      unresolvedExternalBindings: [],
      tenantCount: 0,
      commandCount: 0,
      migrationManifestCount: 0,
      expectedPendingMigrationCount: 0,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficChanged: false,
    };
  }
  const issues = [...evaluation.issues];
  const packageObject = object(packageValue);
  const preparation = object(packageObject?.preparation);
  const preparationCommit = typeof preparation?.repositoryCommit === 'string'
    ? preparation.repositoryCommit
    : null;

  if (repositoryState.branch !== CDB_V1_070B_BRANCH || preparation?.branch !== CDB_V1_070B_BRANCH) {
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
    issues.push('minimum staged preparation implementation is not in the preparation commit');
  }

  const uniqueIssues = [...new Set(issues)];
  const authorizationPresent = authorizationResult != null;
  const authorizationIssues = authorizationResult
    ? [...new Set(authorizationResult.issues.map((issue) => issue.code))]
    : [];
  const packageReady = evaluation.packageReady && uniqueIssues.length === 0;
  const authorizationReady = authorizationResult?.authorizationReady === true;

  return {
    checkpoint: CDB_V1_070B_CHECKPOINT,
    packageReady,
    authorizationPresent,
    authorizationReady,
    executionReady: packageReady && authorizationReady,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    authorizationIssues,
    preparationCommit,
    tenantCount: evaluation.tenantCount,
    commandCount: evaluation.commandCount,
    migrationManifestCount: evaluation.migrationManifestCount,
    expectedPendingMigrationCount: evaluation.expectedPendingMigrationCount,
    unresolvedExternalBindingCount: evaluation.unresolvedExternalBindings.length,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
    workerVersionUploadPerformed: false,
    trafficChanged: false,
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

export function resolveAllTenantShadowPreparationRepositoryState(
  rootInput: string,
  preparationCommit: string | null,
): AllTenantShadowPreparationRepositoryState {
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
        CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT,
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
    const packageValue = JSON.parse(readFileSync(join(root, CDB_V1_070B_PACKAGE_PATH), 'utf8')) as unknown;
    const packageDocument = packageValue as AllTenantShadowPreparationPackage;
    const packageObject = object(packageValue);
    const preparation = object(packageObject?.preparation);
    const preparationCommit = typeof preparation?.repositoryCommit === 'string'
      ? preparation.repositoryCommit
      : null;
    const repositoryState = resolveAllTenantShadowPreparationRepositoryState(root, preparationCommit);
    const authorizationResult = options.authorizationPath
      ? loadAllTenantShadowPreparationAuthorization(
        resolve(options.authorizationPath),
        root,
        packageDocument,
        options.atUtc,
      )
      : null;
    const result = checkAllTenantShadowPreparationReadiness(
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

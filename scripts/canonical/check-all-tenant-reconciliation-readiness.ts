import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildAllTenantReconciliationAuthorizationPlan,
  loadAllTenantReconciliationAuthorization,
  type AllTenantReconciliationAuthorizationResult,
  type AllTenantReconciliationAuthorizationPlan,
} from './all-tenant-reconciliation-authorization';
import {
  CDB_V1_070C_CHECKPOINT,
  CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT,
  CDB_V1_070C_PACKAGE_PATH,
  evaluateAllTenantReconciliationPackage,
  type AllTenantReconciliationPackage,
} from './all-tenant-reconciliation-package';

export interface AllTenantReconciliationRepositoryState {
  branch: string;
  head: string;
  preparationCommitExists: boolean;
  preparationCommitIsAncestorOfHead: boolean;
  minimumImplementationIsAncestorOfPreparation: boolean;
}

export interface AllTenantReconciliationReadiness {
  checkpoint: typeof CDB_V1_070C_CHECKPOINT;
  packageReady: boolean;
  authorizationPresent: boolean;
  authorizationReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
  authorizationIssues: string[];
  preparationCommit: string | null;
  migrationCount: number;
  archivalForeignKeyGroupCount: number;
  commandCount: number;
  unresolvedExternalBindingCount: number;
  plan: AllTenantReconciliationAuthorizationPlan | null;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
  migrationLedgerRowsWritten: 0;
  trafficChanged: false;
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function checkAllTenantReconciliationReadiness(
  rootInput: string,
  packageValue: unknown,
  repositoryState: AllTenantReconciliationRepositoryState,
  authorizationResult: AllTenantReconciliationAuthorizationResult | null,
): AllTenantReconciliationReadiness {
  const root = resolve(rootInput);
  const packageDocument = packageValue as AllTenantReconciliationPackage;
  let evaluation: ReturnType<typeof evaluateAllTenantReconciliationPackage>;
  try {
    evaluation = evaluateAllTenantReconciliationPackage(root, packageDocument);
  } catch (error) {
    evaluation = {
      packageReady: false,
      authorizationReady: false,
      executionReady: false,
      issues: [error instanceof Error ? error.message : String(error)],
      unresolvedExternalBindings: [],
      migrationCount: 0,
      archivalForeignKeyGroupCount: 0,
      commandCount: 0,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      trafficChanged: false,
    };
  }
  const issues = [...evaluation.issues];
  const packageObject = object(packageValue);
  const preparation = object(packageObject?.preparation);
  const preparationCommit = typeof preparation?.repositoryCommit === 'string'
    ? preparation.repositoryCommit
    : null;

  if (!/^[0-9a-f]{40}$/.test(repositoryState.head)) issues.push('current HEAD is invalid');
  if (!repositoryState.preparationCommitExists) {
    issues.push('preparation commit is not present in the repository');
  }
  if (!repositoryState.preparationCommitIsAncestorOfHead) {
    issues.push('preparation commit is not an ancestor of current HEAD');
  }
  if (!repositoryState.minimumImplementationIsAncestorOfPreparation) {
    issues.push('minimum reconciliation implementation is not in the preparation commit');
  }

  const uniqueIssues = [...new Set(issues)];
  const authorizationPresent = authorizationResult != null;
  const authorizationIssues = authorizationResult
    ? [...new Set(authorizationResult.issues.map((issue) => issue.code))]
    : [];
  const packageReady = evaluation.packageReady && uniqueIssues.length === 0;
  const authorizationReady = authorizationResult?.authorizationReady === true;
  const plan = authorizationResult
    ? buildAllTenantReconciliationAuthorizationPlan(authorizationResult)
    : null;

  return {
    checkpoint: CDB_V1_070C_CHECKPOINT,
    packageReady,
    authorizationPresent,
    authorizationReady,
    executionReady: packageReady && authorizationReady && plan != null,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    authorizationIssues,
    preparationCommit,
    migrationCount: evaluation.migrationCount,
    archivalForeignKeyGroupCount: evaluation.archivalForeignKeyGroupCount,
    commandCount: evaluation.commandCount,
    unresolvedExternalBindingCount: evaluation.unresolvedExternalBindings.length,
    plan,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
    migrationLedgerRowsWritten: 0,
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

export function resolveAllTenantReconciliationRepositoryState(
  rootInput: string,
  preparationCommit: string | null,
): AllTenantReconciliationRepositoryState {
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
        'merge-base', '--is-ancestor',
        CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT,
        preparationCommit as string,
      ]),
  };
}

export interface AllTenantReconciliationReadinessCliOptions {
  authorizationPath: string | null;
  atUtc: string;
}

export function parseAllTenantReconciliationReadinessArgs(
  args: string[],
): AllTenantReconciliationReadinessCliOptions {
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
    const options = parseAllTenantReconciliationReadinessArgs(process.argv.slice(2));
    const packageValue = JSON.parse(
      readFileSync(join(root, CDB_V1_070C_PACKAGE_PATH), 'utf8'),
    ) as AllTenantReconciliationPackage;
    const preparationCommit = packageValue.preparation?.repositoryCommit ?? null;
    const repositoryState = resolveAllTenantReconciliationRepositoryState(root, preparationCommit);
    const authorizationResult = options.authorizationPath
      ? loadAllTenantReconciliationAuthorization(
        resolve(options.authorizationPath), root, packageValue, options.atUtc,
      )
      : null;
    const result = checkAllTenantReconciliationReadiness(
      root, packageValue, repositoryState, authorizationResult,
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

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB_V1_070C_BRANCH,
  CDB_V1_070C_PACKAGE_PATH,
  buildAllTenantReconciliationPackage,
  evaluateAllTenantReconciliationPackage,
  type AllTenantReconciliationPackage,
  type AllTenantReconciliationPackageEvaluation,
} from './all-tenant-reconciliation-package';

export interface AllTenantReconciliationPackageCliOptions {
  outputPath: string;
  force: boolean;
}

export interface WriteAllTenantReconciliationPackageInput {
  repositoryRoot: string;
  outputPath: string;
  force: boolean;
  preparationCommit: string;
  buildSha: string;
}

export interface WriteAllTenantReconciliationPackageResult {
  packagePath: string;
  document: AllTenantReconciliationPackage;
  evaluation: AllTenantReconciliationPackageEvaluation;
}

export function parseAllTenantReconciliationPackageArgs(
  args: string[],
): AllTenantReconciliationPackageCliOptions {
  let outputPath = CDB_V1_070C_PACKAGE_PATH;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output requires a path');
      outputPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { outputPath, force };
}

function exactGitValue(repositoryRoot: string, args: string[]): string {
  const value = execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!value) throw new Error(`git ${args.join(' ')} returned an empty value`);
  return value;
}

export function buildAllTenantReconciliationPackageForCurrentHead(
  repositoryRootInput: string,
): AllTenantReconciliationPackage {
  const repositoryRoot = resolve(repositoryRootInput);
  const head = exactGitValue(repositoryRoot, ['rev-parse', 'HEAD']);
  return buildAllTenantReconciliationPackage(repositoryRoot, {
    branch: CDB_V1_070C_BRANCH,
    preparationCommit: head,
    buildSha: head,
  });
}

export function serializeAllTenantReconciliationPackage(
  document: AllTenantReconciliationPackage,
): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function writeAllTenantReconciliationPackage(
  input: WriteAllTenantReconciliationPackageInput,
): WriteAllTenantReconciliationPackageResult {
  const repositoryRoot = resolve(input.repositoryRoot);
  const packagePath = isAbsolute(input.outputPath)
    ? resolve(input.outputPath)
    : resolve(join(repositoryRoot, input.outputPath));
  if (existsSync(packagePath) && !input.force) {
    throw new Error(`all-tenant reconciliation package already exists: ${packagePath}`);
  }
  const document = buildAllTenantReconciliationPackage(repositoryRoot, {
    branch: CDB_V1_070C_BRANCH,
    preparationCommit: input.preparationCommit,
    buildSha: input.buildSha,
  });
  const evaluation = evaluateAllTenantReconciliationPackage(repositoryRoot, document);
  if (!evaluation.packageReady
    || evaluation.authorizationReady
    || evaluation.executionReady
    || evaluation.issues.length > 0) {
    throw new Error(`all-tenant reconciliation package validation failed: ${evaluation.issues.join(', ')}`);
  }

  mkdirSync(dirname(packagePath), { recursive: true });
  const temporaryPath = `${packagePath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, serializeAllTenantReconciliationPackage(document), {
      encoding: 'utf8',
      mode: 0o644,
    });
    renameSync(temporaryPath, packagePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { packagePath, document, evaluation };
}

function main(): void {
  try {
    const repositoryRoot = process.cwd();
    const options = parseAllTenantReconciliationPackageArgs(process.argv.slice(2));
    const head = exactGitValue(repositoryRoot, ['rev-parse', 'HEAD']);
    const result = writeAllTenantReconciliationPackage({
      repositoryRoot,
      outputPath: options.outputPath,
      force: options.force,
      preparationCommit: head,
      buildSha: head,
    });
    process.stdout.write(`${JSON.stringify({
      packagePath: result.packagePath,
      packageReady: result.evaluation.packageReady,
      authorizationReady: result.evaluation.authorizationReady,
      executionReady: result.evaluation.executionReady,
      issueCount: result.evaluation.issues.length,
      unresolvedExternalBindingCount: result.evaluation.unresolvedExternalBindings.length,
      migrationCount: result.evaluation.migrationCount,
      archivalForeignKeyGroupCount: result.evaluation.archivalForeignKeyGroupCount,
      commandCount: result.evaluation.commandCount,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      trafficChanged: false,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

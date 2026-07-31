import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB_V1_070B_PACKAGE_PATH,
  buildAllTenantShadowPreparationPackage,
  evaluateAllTenantShadowPreparationPackage,
  type AllTenantShadowPreparationPackageEvaluation,
} from './all-tenant-shadow-preparation-package';

export interface AllTenantShadowPreparationPackageCliOptions {
  outputPath: string;
  force: boolean;
}

export interface WriteAllTenantShadowPreparationPackageInput {
  repositoryRoot: string;
  outputPath: string;
  force: boolean;
  branch: string;
  preparationCommit: string;
  buildSha: string;
}

export interface WriteAllTenantShadowPreparationPackageResult {
  packagePath: string;
  evaluation: AllTenantShadowPreparationPackageEvaluation;
}

export function parseAllTenantShadowPreparationPackageArgs(
  args: string[],
): AllTenantShadowPreparationPackageCliOptions {
  let outputPath = CDB_V1_070B_PACKAGE_PATH;
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

export function resolveLocalAllTenantShadowPreparationPackageBinding(
  repositoryRootInput: string,
): { branch: string; preparationCommit: string; buildSha: string } {
  const repositoryRoot = resolve(repositoryRootInput);
  const branch = exactGitValue(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const preparationCommit = exactGitValue(repositoryRoot, ['rev-parse', 'HEAD']);
  return { branch, preparationCommit, buildSha: preparationCommit };
}

export function writeAllTenantShadowPreparationPackage(
  input: WriteAllTenantShadowPreparationPackageInput,
): WriteAllTenantShadowPreparationPackageResult {
  const repositoryRoot = resolve(input.repositoryRoot);
  const packagePath = isAbsolute(input.outputPath)
    ? resolve(input.outputPath)
    : resolve(join(repositoryRoot, input.outputPath));
  if (existsSync(packagePath) && !input.force) {
    throw new Error(`all-tenant shadow preparation package already exists: ${packagePath}`);
  }

  const document = buildAllTenantShadowPreparationPackage(repositoryRoot, {
    branch: input.branch,
    preparationCommit: input.preparationCommit,
    buildSha: input.buildSha,
  });
  const evaluation = evaluateAllTenantShadowPreparationPackage(repositoryRoot, document);
  if (!evaluation.packageReady
    || evaluation.authorizationReady
    || evaluation.executionReady
    || evaluation.issues.length > 0) {
    throw new Error(`all-tenant shadow preparation package validation failed: ${evaluation.issues.join(', ')}`);
  }

  mkdirSync(dirname(packagePath), { recursive: true });
  const temporaryPath = `${packagePath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o644,
    });
    renameSync(temporaryPath, packagePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { packagePath, evaluation };
}

function main(): void {
  try {
    const repositoryRoot = process.cwd();
    const options = parseAllTenantShadowPreparationPackageArgs(process.argv.slice(2));
    const binding = resolveLocalAllTenantShadowPreparationPackageBinding(repositoryRoot);
    const result = writeAllTenantShadowPreparationPackage({
      repositoryRoot,
      outputPath: options.outputPath,
      force: options.force,
      ...binding,
    });
    process.stdout.write(`${JSON.stringify({
      packagePath: result.packagePath,
      packageReady: result.evaluation.packageReady,
      authorizationReady: result.evaluation.authorizationReady,
      executionReady: result.evaluation.executionReady,
      issueCount: result.evaluation.issues.length,
      unresolvedExternalBindingCount: result.evaluation.unresolvedExternalBindings.length,
      tenantCount: result.evaluation.tenantCount,
      commandCount: result.evaluation.commandCount,
      migrationManifestCount: result.evaluation.migrationManifestCount,
      expectedPendingMigrationCount: result.evaluation.expectedPendingMigrationCount,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficChanged: false,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

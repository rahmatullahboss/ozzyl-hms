import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildAllTenantShadowAuthorizationPlan,
  loadAllTenantShadowExecutionAuthorization,
  type AllTenantShadowExecutionAuthorizationResult,
} from './all-tenant-shadow-execution-authorization';
import type { AllTenantShadowExecutionPackage } from './all-tenant-shadow-execution-package';

const PACKAGE_PATH = 'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';

export interface AllTenantShadowAuthorizationValidationCliOptions {
  authorizationPath: string;
  atUtc: string;
}

export function parseAllTenantShadowAuthorizationValidationArgs(
  args: string[],
): AllTenantShadowAuthorizationValidationCliOptions {
  let authorizationPath = '';
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
  if (!authorizationPath) throw new Error('--authorization is required');
  return { authorizationPath, atUtc };
}

export function buildAllTenantShadowAuthorizationValidationOutput(
  result: AllTenantShadowExecutionAuthorizationResult,
): {
  receipt: {
    checkpoint: 'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION';
    documentReady: boolean;
    executionReady: boolean;
    issueCount: number;
    tenantCount: number;
    migrationCount: number;
    backfillCount: number;
    providerCount: number;
    expectedProviderFlagRowCount: number;
    aggregateOnly: true;
    networkRequestPerformed: false;
    productionReadPerformed: false;
    productionMutationPerformed: false;
  };
  issues: AllTenantShadowExecutionAuthorizationResult['issues'];
  plan: ReturnType<typeof buildAllTenantShadowAuthorizationPlan> | null;
} {
  const authorization = result.authorization;
  return {
    receipt: {
      checkpoint: 'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION',
      documentReady: result.documentReady,
      executionReady: result.executionReady,
      issueCount: result.issues.length,
      tenantCount: authorization?.activeTenantEvidence.tenantIds.length ?? 0,
      migrationCount: authorization?.migrations.entries.length ?? 0,
      backfillCount: authorization?.backfills.entries.length ?? 0,
      providerCount: authorization?.providers.keys.length ?? 0,
      expectedProviderFlagRowCount: authorization?.providers.expectedFlagRowCount ?? 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    },
    issues: result.issues,
    plan: result.executionReady ? buildAllTenantShadowAuthorizationPlan(result) : null,
  };
}

function main(): void {
  try {
    const root = process.cwd();
    const options = parseAllTenantShadowAuthorizationValidationArgs(process.argv.slice(2));
    const packageDocument = JSON.parse(
      readFileSync(join(root, PACKAGE_PATH), 'utf8'),
    ) as AllTenantShadowExecutionPackage;
    const result = loadAllTenantShadowExecutionAuthorization(
      resolve(options.authorizationPath),
      root,
      packageDocument,
      options.atUtc,
    );
    process.stdout.write(`${JSON.stringify(
      buildAllTenantShadowAuthorizationValidationOutput(result),
      null,
      2,
    )}\n`);
    if (!result.executionReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildAllTenantShadowPreparationAuthorizationPlan,
  loadAllTenantShadowPreparationAuthorization,
  type AllTenantShadowPreparationAuthorizationResult,
} from './all-tenant-shadow-preparation-authorization';
import {
  CDB_V1_070B_PACKAGE_PATH,
  type AllTenantShadowPreparationPackage,
} from './all-tenant-shadow-preparation-package';

export interface AllTenantShadowPreparationAuthorizationValidationCliOptions {
  authorizationPath: string;
  atUtc: string;
}

export function parseAllTenantShadowPreparationAuthorizationValidationArgs(
  args: string[],
): AllTenantShadowPreparationAuthorizationValidationCliOptions {
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

export function buildAllTenantShadowPreparationAuthorizationValidationOutput(
  result: AllTenantShadowPreparationAuthorizationResult,
): {
  receipt: {
    checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE';
    documentReady: boolean;
    authorizationReady: boolean;
    issueCount: number;
    tenantCount: number;
    routeCount: number;
    candidateTrafficPercentage: number;
    previousTrafficPercentage: number;
    aggregateOnly: true;
    networkRequestPerformed: false;
    productionReadPerformed: false;
    productionMutationPerformed: false;
    workerVersionUploadPerformed: false;
    trafficChanged: false;
  };
  issues: AllTenantShadowPreparationAuthorizationResult['issues'];
  plan: ReturnType<typeof buildAllTenantShadowPreparationAuthorizationPlan> | null;
} {
  const authorization = result.authorization;
  return {
    receipt: {
      checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE',
      documentReady: result.documentReady,
      authorizationReady: result.authorizationReady,
      issueCount: result.issues.length,
      tenantCount: authorization?.scope.tenantIds.length ?? 0,
      routeCount: authorization?.worker.routes.length ?? 0,
      candidateTrafficPercentage: authorization?.worker.expectedCandidateTrafficPercentage ?? 0,
      previousTrafficPercentage: authorization?.worker.expectedPreviousTrafficPercentage ?? 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficChanged: false,
    },
    issues: result.issues,
    plan: result.authorizationReady
      ? buildAllTenantShadowPreparationAuthorizationPlan(result)
      : null,
  };
}

function main(): void {
  try {
    const root = process.cwd();
    const options = parseAllTenantShadowPreparationAuthorizationValidationArgs(process.argv.slice(2));
    const packageDocument = JSON.parse(
      readFileSync(join(root, CDB_V1_070B_PACKAGE_PATH), 'utf8'),
    ) as AllTenantShadowPreparationPackage;
    const result = loadAllTenantShadowPreparationAuthorization(
      resolve(options.authorizationPath),
      root,
      packageDocument,
      options.atUtc,
    );
    process.stdout.write(`${JSON.stringify(
      buildAllTenantShadowPreparationAuthorizationValidationOutput(result),
      null,
      2,
    )}\n`);
    if (!result.authorizationReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

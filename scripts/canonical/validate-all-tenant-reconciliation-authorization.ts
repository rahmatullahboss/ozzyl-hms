import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildAllTenantReconciliationAuthorizationPlan,
  loadAllTenantReconciliationAuthorization,
} from './all-tenant-reconciliation-authorization';
import {
  CDB_V1_070C_PACKAGE_PATH,
  type AllTenantReconciliationPackage,
} from './all-tenant-reconciliation-package';

export interface AllTenantReconciliationAuthorizationCliOptions {
  authorizationPath: string;
  atUtc: string;
}

export function parseAllTenantReconciliationAuthorizationArgs(
  args: string[],
): AllTenantReconciliationAuthorizationCliOptions {
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
  if (!authorizationPath) throw new Error('--authorization is required');
  return { authorizationPath, atUtc };
}

function main(): void {
  const root = process.cwd();
  try {
    const options = parseAllTenantReconciliationAuthorizationArgs(process.argv.slice(2));
    const packageDocument = JSON.parse(
      readFileSync(join(root, CDB_V1_070C_PACKAGE_PATH), 'utf8'),
    ) as AllTenantReconciliationPackage;
    const result = loadAllTenantReconciliationAuthorization(
      resolve(options.authorizationPath),
      root,
      packageDocument,
      options.atUtc,
    );
    const plan = buildAllTenantReconciliationAuthorizationPlan(result);
    const receipt = {
      checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION',
      documentReady: result.documentReady,
      authorizationReady: result.authorizationReady,
      issueCount: result.issues.length,
      tenantCount: result.authorization?.scope.tenantIds.length ?? 0,
      migrationLedgerEntryCount: result.authorization?.reconciliation.entries.length ?? 0,
      rawArchivalForeignKeyViolations:
        result.authorization?.foreignKeyDisposition.rawArchivalViolationCount ?? 0,
      effectiveUnwaivedForeignKeyViolations:
        result.authorization?.foreignKeyDisposition.effectiveUnwaivedViolationCount ?? 0,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      trafficChanged: false,
    };
    process.stdout.write(`${JSON.stringify({ receipt, issues: result.issues, plan }, null, 2)}\n`);
    if (!result.authorizationReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) main();

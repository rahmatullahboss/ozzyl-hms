import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  validateObservedForeignKeyDisposition,
  validatePendingCanonicalMigrations,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
  type ReportingForeignKeyAggregateGroup,
} from './production-cutover-contract';
import { prepareProtectedReportingCutoverAuthorization } from './reporting-cutover-authorization-document';
import {
  bindReportingForeignKeyEvidenceToAuthorization,
  prepareProtectedReportingForeignKeyDispositionEvidence,
} from './reporting-fk-disposition-evidence';
import {
  bindReportingMaintenanceRecoveryEvidenceToAuthorization,
  prepareProtectedReportingMaintenanceRecoveryEvidence,
} from './reporting-maintenance-recovery-evidence';
import {
  bindReportingWorkerBuildVersionEvidenceToAuthorization,
  prepareProtectedReportingWorkerBuildVersionEvidence,
} from './reporting-worker-build-version-evidence';

export interface ProductionCanonicalMigrationExecutionInput {
  authorization: ReportingCutoverAuthorization;
  atUtc: string;
  pendingMigrations: string[];
  observedDatabaseId?: string | null;
  observedForeignKeyGroups?: ReportingForeignKeyAggregateGroup[];
  execute: boolean;
  confirmationToken: string | null;
}

export interface ProductionCanonicalMigrationExecutionPlan {
  allowed: boolean;
  issues: string[];
  command: string[];
  productionMutationPerformed: false;
}

export function prepareProductionCanonicalMigrationExecution(
  input: ProductionCanonicalMigrationExecutionInput,
): ProductionCanonicalMigrationExecutionPlan {
  const authorizationResult = validateReportingCutoverAuthorization(
    input.authorization,
    input.atUtc,
  );
  const issues = authorizationResult.issues.map((issue) => issue.code);
  issues.push(...validatePendingCanonicalMigrations(input.pendingMigrations));
  if (input.observedDatabaseId !== undefined && input.observedDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_OBSERVED_DATABASE_IDENTITY_MISMATCH');
  }
  if (input.execute && input.observedDatabaseId === undefined) {
    issues.push('CDB101_OBSERVED_DATABASE_IDENTITY_MISSING');
  }
  if (input.execute && input.observedForeignKeyGroups === undefined) {
    issues.push('CDB101_OBSERVED_FOREIGN_KEY_EVIDENCE_MISSING');
  } else if (input.observedForeignKeyGroups) {
    issues.push(...validateObservedForeignKeyDisposition(
      input.observedForeignKeyGroups,
      input.authorization.foreignKeyDisposition.groups,
    ));
  }
  if (!input.execute) issues.push('CDB101_EXECUTE_SWITCH_MISSING');
  if (
    !input.authorization.migrations.commandId
    || input.confirmationToken !== input.authorization.migrations.commandId
  ) {
    issues.push('CDB101_CONFIRMATION_TOKEN_MISMATCH');
  }
  return {
    allowed: issues.length === 0,
    issues: [...new Set(issues)],
    command: ['d1', 'migrations', 'apply', 'DB', '--env', 'production', '--remote'],
    productionMutationPerformed: false,
  };
}

interface WranglerResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runWrangler(args: string[]): WranglerResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

function parseDatabaseId(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('D1 info output did not contain JSON');
  const parsed = JSON.parse(text.slice(start)) as { uuid?: unknown; name?: unknown };
  if (parsed.name !== CDB101_PRODUCTION_DATABASE_NAME || typeof parsed.uuid !== 'string') {
    throw new Error('D1 info did not match the exact production database name');
  }
  return parsed.uuid;
}

export function parsePendingMigrationNames(text: string): string[] {
  const matches = text.match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g) ?? [];
  return [...new Set(matches)];
}

const FOREIGN_KEY_AGGREGATE_SQL = `SELECT
  "table" AS child_table,
  parent AS parent_table,
  COUNT(*) AS violation_count
FROM pragma_foreign_key_check
GROUP BY "table", parent
ORDER BY "table", parent;`;

export function parseForeignKeyAggregateOutput(text: string): ReportingForeignKeyAggregateGroup[] {
  const start = text.indexOf('[');
  if (start < 0) throw new Error('Foreign-key aggregate output did not contain JSON');
  const parsed = JSON.parse(text.slice(start)) as Array<{
    results?: Array<{ child_table?: unknown; parent_table?: unknown; violation_count?: unknown }>;
    meta?: { changed_db?: unknown; rows_written?: unknown };
  }>;
  if (!Array.isArray(parsed)) throw new Error('Foreign-key aggregate output was not an array');
  const groups: ReportingForeignKeyAggregateGroup[] = [];
  for (const envelope of parsed) {
    if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
      throw new Error('Foreign-key aggregate query was not read-only');
    }
    for (const row of envelope.results ?? []) {
      const count = Number(row.violation_count);
      if (
        typeof row.child_table !== 'string'
        || typeof row.parent_table !== 'string'
        || !Number.isSafeInteger(count)
        || count <= 0
      ) {
        throw new Error('Foreign-key aggregate row was invalid');
      }
      groups.push({
        childTable: row.child_table,
        parentTable: row.parent_table,
        violationCount: count,
      });
    }
  }
  return groups;
}

export interface ProductionCanonicalMigrationCliOptions {
  authorizationPath: string;
  fkEvidencePath: string;
  maintenanceRecoveryEvidencePath: string;
  workerBuildVersionEvidencePath: string;
  execute: boolean;
}

export function parseProductionCanonicalMigrationArgs(
  args: string[],
): ProductionCanonicalMigrationCliOptions {
  let authorizationPath = '';
  let fkEvidencePath = '';
  let maintenanceRecoveryEvidencePath = '';
  let workerBuildVersionEvidencePath = '';
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (
      arg === '--authorization'
      || arg === '--fk-evidence'
      || arg === '--maintenance-recovery-evidence'
      || arg === '--worker-build-version-evidence'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      if (arg === '--authorization') authorizationPath = value;
      else if (arg === '--fk-evidence') fkEvidencePath = value;
      else if (arg === '--maintenance-recovery-evidence') maintenanceRecoveryEvidencePath = value;
      else workerBuildVersionEvidencePath = value;
      index += 1;
    } else if (arg === '--execute') {
      execute = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (
    !authorizationPath
    || !fkEvidencePath
    || !maintenanceRecoveryEvidencePath
    || !workerBuildVersionEvidencePath
  ) {
    throw new Error('--authorization, --fk-evidence, --maintenance-recovery-evidence, and --worker-build-version-evidence are required');
  }
  return {
    authorizationPath,
    fkEvidencePath,
    maintenanceRecoveryEvidencePath,
    workerBuildVersionEvidencePath,
    execute,
  };
}

function main(): void {
  try {
    const options = parseProductionCanonicalMigrationArgs(process.argv.slice(2));
    const authorizationCheckedAtUtc = new Date().toISOString();
    const authorizationPreflight = prepareProtectedReportingCutoverAuthorization(
      options.authorizationPath,
      process.cwd(),
      authorizationCheckedAtUtc,
    );
    if (!authorizationPreflight.receipt.executionReady || !authorizationPreflight.authorization) {
      process.stdout.write(`${JSON.stringify(authorizationPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const authorization = authorizationPreflight.authorization;
    const fkEvidencePreflight = bindReportingForeignKeyEvidenceToAuthorization(
      prepareProtectedReportingForeignKeyDispositionEvidence(
        options.fkEvidencePath,
        process.cwd(),
        authorizationCheckedAtUtc,
      ),
      authorization,
    );
    if (!fkEvidencePreflight.receipt.evidenceReady) {
      process.stdout.write(`${JSON.stringify(fkEvidencePreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const maintenanceRecoveryPreflight = bindReportingMaintenanceRecoveryEvidenceToAuthorization(
      prepareProtectedReportingMaintenanceRecoveryEvidence(
        options.maintenanceRecoveryEvidencePath,
        process.cwd(),
        authorizationCheckedAtUtc,
      ),
      authorization,
    );
    if (!maintenanceRecoveryPreflight.receipt.evidenceReady) {
      process.stdout.write(`${JSON.stringify(maintenanceRecoveryPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const workerBuildVersionPreflight = bindReportingWorkerBuildVersionEvidenceToAuthorization(
      prepareProtectedReportingWorkerBuildVersionEvidence(
        options.workerBuildVersionEvidencePath,
        process.cwd(),
        authorizationCheckedAtUtc,
      ),
      authorization,
    );
    if (!workerBuildVersionPreflight.receipt.evidenceReady) {
      process.stdout.write(`${JSON.stringify(workerBuildVersionPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }

    const info = runWrangler(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
    if (info.status !== 0) throw new Error(info.stderr || info.stdout || 'D1 info failed');
    const observedDatabaseId = parseDatabaseId(info.stdout);

    const list = runWrangler(['d1', 'migrations', 'list', 'DB', '--env', 'production', '--remote']);
    if (list.status !== 0) throw new Error(list.stderr || list.stdout || 'D1 migration list failed');
    const pendingMigrations = parsePendingMigrationNames(`${list.stdout}\n${list.stderr}`);

    const foreignKeys = runWrangler([
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--json', '--command', FOREIGN_KEY_AGGREGATE_SQL,
    ]);
    if (foreignKeys.status !== 0) {
      throw new Error(foreignKeys.stderr || foreignKeys.stdout || 'Foreign-key aggregate query failed');
    }
    const observedForeignKeyGroups = parseForeignKeyAggregateOutput(foreignKeys.stdout);

    const plan = prepareProductionCanonicalMigrationExecution({
      authorization,
      atUtc: new Date().toISOString(),
      pendingMigrations,
      observedDatabaseId,
      observedForeignKeyGroups,
      execute: options.execute,
      confirmationToken: process.env.CDB101_PRODUCTION_CONFIRMATION ?? null,
    });

    if (!plan.allowed) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const applied = runWrangler(plan.command);
    if (applied.status !== 0) throw new Error(applied.stderr || applied.stdout || 'Migration apply failed');

    const postList = runWrangler(['d1', 'migrations', 'list', 'DB', '--env', 'production', '--remote']);
    if (postList.status !== 0) {
      throw new Error(postList.stderr || postList.stdout || 'Post-apply migration list failed');
    }
    const pendingAfterApply = parsePendingMigrationNames(`${postList.stdout}\n${postList.stderr}`);
    if (pendingAfterApply.length > 0) {
      throw new Error(`Post-apply migration verification found pending migrations: ${pendingAfterApply.join(', ')}`);
    }

    process.stdout.write(`${JSON.stringify({
      allowed: true,
      commandId: authorization.migrations.commandId,
      pendingMigrationCountBefore: pendingMigrations.length,
      pendingMigrationCountAfter: pendingAfterApply.length,
      exitCode: applied.status,
      postApplyVerified: true,
      productionMutationPerformed: true,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 production migration wrapper failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

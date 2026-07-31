import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  validateCanonicalImportBundleSql,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
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

export interface ProductionCanonicalImportManifest {
  schemaVersion: 1;
  authorizationId: string;
  productionDatabaseId: string;
  tenantIds: string[];
  allowedTables: string[];
  bundleSha256: string;
  sourceExportSha256: string;
  deterministicRunId: string;
  secondPassRequired: true;
  rowCountSummary: Record<string, number>;
}

export interface ProductionCanonicalImportExecutionInput {
  authorization: ReportingCutoverAuthorization;
  atUtc: string;
  bundlePath: string;
  bundleSql: string;
  actualBundleSha256: string;
  actualManifestSha256: string;
  actualSourceExportSha256: string;
  manifest?: ProductionCanonicalImportManifest;
  observedDatabaseId?: string | null;
  execute: boolean;
  confirmationToken: string | null;
}

export interface ProductionCanonicalImportExecutionPlan {
  allowed: boolean;
  issues: string[];
  command: string[];
  productionMutationPerformed: false;
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function manifestValid(
  manifest: ProductionCanonicalImportManifest | undefined,
  authorization: ReportingCutoverAuthorization,
): boolean {
  if (!manifest || manifest.schemaVersion !== 1) return false;
  if (manifest.authorizationId !== authorization.authorizationId) return false;
  if (manifest.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) return false;
  if (!exactSet(manifest.tenantIds, authorization.productionImport.tenantIds)) return false;
  if (!exactSet(manifest.allowedTables, authorization.productionImport.allowedTables)) return false;
  if (manifest.bundleSha256 !== authorization.productionImport.bundleSha256) return false;
  if (manifest.sourceExportSha256 !== authorization.productionImport.sourceExportSha256) return false;
  if (manifest.deterministicRunId !== authorization.productionImport.deterministicRunId) return false;
  if (manifest.secondPassRequired !== true) return false;
  const rowCounts = Object.entries(manifest.rowCountSummary);
  return exactSet(
    rowCounts.map(([table]) => table),
    authorization.productionImport.allowedTables,
  ) && rowCounts.every(([, count]) => Number.isSafeInteger(count) && count >= 0);
}

export function prepareProductionCanonicalImportExecution(
  input: ProductionCanonicalImportExecutionInput,
): ProductionCanonicalImportExecutionPlan {
  const authorizationResult = validateReportingCutoverAuthorization(
    input.authorization,
    input.atUtc,
  );
  const issues = authorizationResult.issues.map((issue) => issue.code);
  const sqlValidation = validateCanonicalImportBundleSql(
    input.bundleSql,
    input.authorization.productionImport.allowedTables,
  );
  if (!sqlValidation.valid) issues.push('CDB101_IMPORT_BUNDLE_SQL_INVALID');
  if (!input.bundlePath.endsWith('.sql')) issues.push('CDB101_IMPORT_BUNDLE_PATH_INVALID');
  if (input.actualBundleSha256 !== input.authorization.productionImport.bundleSha256) {
    issues.push('CDB101_IMPORT_BUNDLE_HASH_MISMATCH');
  }
  if (input.actualManifestSha256 !== input.authorization.productionImport.manifestSha256) {
    issues.push('CDB101_IMPORT_MANIFEST_HASH_MISMATCH');
  }
  if (input.actualSourceExportSha256 !== input.authorization.productionImport.sourceExportSha256) {
    issues.push('CDB101_IMPORT_SOURCE_EXPORT_HASH_MISMATCH');
  }
  if (input.observedDatabaseId !== undefined && input.observedDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_OBSERVED_DATABASE_IDENTITY_MISMATCH');
  }
  if (input.execute && input.observedDatabaseId === undefined) {
    issues.push('CDB101_OBSERVED_DATABASE_IDENTITY_MISSING');
  }
  if (input.execute && !manifestValid(input.manifest, input.authorization)) {
    issues.push('CDB101_IMPORT_MANIFEST_SCOPE_INVALID');
  }
  if (!input.execute) issues.push('CDB101_EXECUTE_SWITCH_MISSING');
  if (
    !input.authorization.productionImport.commandId
    || input.confirmationToken !== input.authorization.productionImport.commandId
  ) {
    issues.push('CDB101_CONFIRMATION_TOKEN_MISMATCH');
  }
  return {
    allowed: issues.length === 0,
    issues: [...new Set(issues)],
    command: [
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--file', input.bundlePath, '--yes',
    ],
    productionMutationPerformed: false,
  };
}

export function buildCanonicalImportVerificationSql(tables: string[]): string {
  if (
    tables.length === 0
    || tables.some((table) => !/^canonical_[a-z0-9_]+$/.test(table))
  ) {
    throw new Error('Verification tables must be a non-empty canonical-only list.');
  }
  return tables.map((table) => (
    `SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM ${table} WHERE tenant_id = '100';`
  )).join('\n');
}

export interface CanonicalImportSecondPassProof {
  envelopeCount: number;
  changedDbTrueCount: number;
  changes: number;
  rowsWritten: 0;
}

export function verifyCanonicalImportSecondPassOutput(text: string): CanonicalImportSecondPassProof {
  const start = text.indexOf('[');
  if (start < 0) throw new Error('Canonical import second pass output did not contain JSON');
  const parsed = JSON.parse(text.slice(start)) as Array<{
    success?: unknown;
    results?: Array<Record<string, unknown>>;
    meta?: { changed_db?: unknown; changes?: unknown; rows_written?: unknown };
  }>;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Canonical import second pass output was not a non-empty array');
  }
  let changedDbTrueCount = 0;
  let changes = 0;
  for (const envelope of parsed) {
    const envelopeChanges = Number(envelope.meta?.changes);
    const rowsWritten = Number(envelope.meta?.rows_written);
    const fileImportRowsWritten = envelope.results?.find((row) => 'Rows written' in row)?.['Rows written'];
    const fileImportZeroWriteProof = (
      envelope.success === true
      && Number(fileImportRowsWritten) === 0
    );
    if (
      !envelope.meta
      || typeof envelope.meta.changed_db !== 'boolean'
      || !Number.isSafeInteger(envelopeChanges)
      || envelopeChanges < 0
      || rowsWritten !== 0
      || (envelopeChanges !== 0 && !fileImportZeroWriteProof)
    ) {
      throw new Error('Canonical import second pass did not prove zero writes');
    }
    if (envelope.meta.changed_db) changedDbTrueCount += 1;
    changes += envelopeChanges;
  }
  return {
    envelopeCount: parsed.length,
    changedDbTrueCount,
    changes,
    rowsWritten: 0,
  };
}

export function verifyCanonicalImportRowCounts(
  text: string,
  expected: Record<string, number>,
): void {
  const start = text.indexOf('[');
  if (start < 0) throw new Error('Import verification output did not contain JSON');
  const parsed = JSON.parse(text.slice(start)) as Array<{
    results?: Array<{ table_name?: unknown; row_count?: unknown }>;
    meta?: { changed_db?: unknown; rows_written?: unknown };
  }>;
  if (!Array.isArray(parsed)) throw new Error('Import verification output was not an array');
  const observed = new Map<string, number>();
  for (const envelope of parsed) {
    if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
      throw new Error('Import verification query was not read-only');
    }
    for (const row of envelope.results ?? []) {
      const count = Number(row.row_count);
      if (typeof row.table_name !== 'string' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Import verification row was invalid');
      }
      if (observed.has(row.table_name)) throw new Error('Import verification returned a duplicate table');
      observed.set(row.table_name, count);
    }
  }
  if (observed.size !== Object.keys(expected).length) {
    throw new Error('Import verification table set did not match the manifest');
  }
  for (const [table, expectedCount] of Object.entries(expected)) {
    if (observed.get(table) !== expectedCount) {
      throw new Error(`Import verification row count mismatch for ${table}`);
    }
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface WranglerResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runWrangler(args: string[]): WranglerResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
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

export interface ProductionCanonicalImportCliOptions {
  authorizationPath: string;
  fkEvidencePath: string;
  maintenanceRecoveryEvidencePath: string;
  workerBuildVersionEvidencePath: string;
  bundlePath: string;
  manifestPath: string;
  sourceExportPath: string;
  execute: boolean;
}

export function parseProductionCanonicalImportArgs(
  args: string[],
): ProductionCanonicalImportCliOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (![
      '--authorization',
      '--fk-evidence',
      '--maintenance-recovery-evidence',
      '--worker-build-version-evidence',
      '--bundle',
      '--manifest',
      '--source-export',
    ].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
    values.set(arg, value);
    index += 1;
  }
  const authorizationPath = values.get('--authorization');
  const fkEvidencePath = values.get('--fk-evidence');
  const maintenanceRecoveryEvidencePath = values.get('--maintenance-recovery-evidence');
  const workerBuildVersionEvidencePath = values.get('--worker-build-version-evidence');
  const bundlePath = values.get('--bundle');
  const manifestPath = values.get('--manifest');
  const sourceExportPath = values.get('--source-export');
  if (
    !authorizationPath
    || !fkEvidencePath
    || !maintenanceRecoveryEvidencePath
    || !workerBuildVersionEvidencePath
    || !bundlePath
    || !manifestPath
    || !sourceExportPath
  ) {
    throw new Error('--authorization, --fk-evidence, --maintenance-recovery-evidence, --worker-build-version-evidence, --bundle, --manifest, and --source-export are required');
  }
  return {
    authorizationPath,
    fkEvidencePath,
    maintenanceRecoveryEvidencePath,
    workerBuildVersionEvidencePath,
    bundlePath,
    manifestPath,
    sourceExportPath,
    execute,
  };
}

function main(): void {
  try {
    const options = parseProductionCanonicalImportArgs(process.argv.slice(2));
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
    const bundlePath = resolve(options.bundlePath);
    const manifestPath = resolve(options.manifestPath);
    const sourceExportPath = resolve(options.sourceExportPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProductionCanonicalImportManifest;
    const bundleSql = readFileSync(bundlePath, 'utf8');

    const info = runWrangler(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
    if (info.status !== 0) throw new Error(info.stderr || info.stdout || 'D1 info failed');
    const observedDatabaseId = parseDatabaseId(info.stdout);

    const plan = prepareProductionCanonicalImportExecution({
      authorization,
      atUtc: new Date().toISOString(),
      bundlePath,
      bundleSql,
      actualBundleSha256: sha256File(bundlePath),
      actualManifestSha256: sha256File(manifestPath),
      actualSourceExportSha256: sha256File(sourceExportPath),
      manifest,
      observedDatabaseId,
      execute: options.execute,
      confirmationToken: process.env.CDB101_PRODUCTION_CONFIRMATION ?? null,
    });

    if (!plan.allowed) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const imported = runWrangler(plan.command);
    if (imported.status !== 0) throw new Error(imported.stderr || imported.stdout || 'Canonical production import failed');

    const secondPass = runWrangler(plan.command);
    if (secondPass.status !== 0) {
      throw new Error(secondPass.stderr || secondPass.stdout || 'Canonical production import second pass failed');
    }
    const secondPassProof = verifyCanonicalImportSecondPassOutput(secondPass.stdout);

    const verificationSql = buildCanonicalImportVerificationSql(
      authorization.productionImport.allowedTables,
    );
    const verification = runWrangler([
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--json', '--command', verificationSql,
    ]);
    if (verification.status !== 0) {
      throw new Error(verification.stderr || verification.stdout || 'Canonical import second-pass verification failed');
    }
    verifyCanonicalImportRowCounts(verification.stdout, manifest.rowCountSummary);

    process.stdout.write(`${JSON.stringify({
      allowed: true,
      commandId: authorization.productionImport.commandId,
      tenantCount: authorization.productionImport.tenantIds.length,
      allowedTableCount: authorization.productionImport.allowedTables.length,
      exitCode: imported.status,
      secondPassCompleted: true,
      secondPassEnvelopeCount: secondPassProof.envelopeCount,
      secondPassChangedDbTrueCount: secondPassProof.changedDbTrueCount,
      secondPassChanges: secondPassProof.changes,
      secondPassRowsWritten: secondPassProof.rowsWritten,
      productionMutationPerformed: true,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 production canonical import wrapper failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

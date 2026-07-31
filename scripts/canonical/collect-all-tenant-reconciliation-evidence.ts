import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ALL_TENANT_RECONCILIATION_ARCHIVAL_DISPOSITION_SQL,
  ALL_TENANT_RECONCILIATION_FOREIGN_KEY_AGGREGATE_SQL,
  ALL_TENANT_RECONCILIATION_PENDING_SQL,
  ALL_TENANT_RECONCILIATION_SCHEMA_ASSERTION_SQL,
  ALL_TENANT_RECONCILIATION_TARGET_LEDGER_SQL,
  buildAllTenantReconciliationEvidenceBundle,
  type AllTenantReconciliationAggregateState,
  type AllTenantReconciliationEvidenceBundle,
} from './all-tenant-reconciliation-executor';
import { CDB_V1_070C_RECONCILIATION_MIGRATIONS } from './all-tenant-reconciliation-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  CDB101_REPORTING_IMPORT_TABLES,
} from './production-cutover-contract';

export interface AllTenantReconciliationReadGateway {
  readAggregateState(): Promise<AllTenantReconciliationAggregateState>;
}

export interface AllTenantReconciliationPreauthorizationManifest {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-070C-PREAUTHORIZATION-AGGREGATE-EVIDENCE-CAPTURE';
  candidateCommit: string;
  capturedAtUtc: string;
  database: { name: string; uuid: string };
  entries: Array<{
    name: string;
    schemaEvidenceId: string;
    schemaEvidenceSha256: string;
    schemaEvidenceFile: string;
    ledgerEvidenceId: string;
    ledgerEvidenceSha256: string;
    ledgerEvidenceFile: string;
  }>;
  foreignKeyDisposition: {
    evidenceId: string;
    evidenceSha256: string;
    evidenceFile: string;
    rawArchivalViolationCount: number;
    formallyWaivedViolationCount: number;
    effectiveUnwaivedViolationCount: number;
    activeViolationCount: number;
    unknownViolationCount: number;
    archivalRowCount: number;
    archivalLatestUpdatedAtUtc: string;
    activeRowCount: number;
    activeLatestCreatedAtUtc: string;
    triggerCount: number;
    dependentObjectCount: number;
    runtimeSourceReferenceCount: number;
    activeWriterDisabledConfirmed: boolean;
    excludedFromCanonicalImportConfirmed: boolean;
    excludedFromReportingConfirmed: boolean;
  };
  aggregateOnly: true;
  productionReadPerformed: true;
  productionMutationPerformed: false;
  migrationLedgerRowsWritten: 0;
  trafficChanged: false;
}

export interface CollectAllTenantReconciliationEvidenceResult {
  manifestPath: string;
  manifest: AllTenantReconciliationPreauthorizationManifest;
  bundle: AllTenantReconciliationEvidenceBundle;
  files: string[];
}

function outsideRepository(path: string, repositoryRoot: string): string {
  const absolute = resolve(path);
  const root = resolve(repositoryRoot);
  if (absolute === root || absolute.startsWith(`${root}${sep}`)) {
    throw new Error('Protected directory must remain outside repository');
  }
  return absolute;
}

export function requireProtectedDirectory(path: string, repositoryRoot: string): string {
  const absolute = outsideRepository(path, repositoryRoot);
  if (!existsSync(absolute)) throw new Error(`Protected directory missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Protected directory must be a mode-700 real directory');
  }
  return absolute;
}

export function requireProtectedRegularFile(path: string, repositoryRoot: string): string {
  const absolute = outsideRepository(path, repositoryRoot);
  if (!existsSync(absolute)) throw new Error(`Protected file missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) {
    throw new Error('Protected file must be a mode-600 regular file with one link');
  }
  const parent = resolve(absolute, '..');
  requireProtectedDirectory(parent, repositoryRoot);
  return absolute;
}

function writeProtectedJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

function safeCapturedAt(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new Error('capturedAtUtc must be an exact UTC timestamp');
  }
  return value;
}

export async function collectAllTenantReconciliationEvidence(
  input: {
    repositoryRoot: string;
    outputDirectory: string;
    candidateCommit: string;
    capturedAtUtc?: string;
  },
  gateway: AllTenantReconciliationReadGateway,
): Promise<CollectAllTenantReconciliationEvidenceResult> {
  if (!/^[0-9a-f]{40}$/.test(input.candidateCommit)) {
    throw new Error('Candidate commit must be a 40-character Git SHA');
  }
  const directory = requireProtectedDirectory(input.outputDirectory, input.repositoryRoot);
  const capturedAtUtc = safeCapturedAt(input.capturedAtUtc ?? new Date().toISOString());
  const state = await gateway.readAggregateState();
  const bundle = buildAllTenantReconciliationEvidenceBundle(state, input.candidateCommit);
  const files: string[] = [];
  const manifestEntries = bundle.entries.map((entry) => {
    const prefix = entry.name.slice(0, 4);
    const schemaPath = join(directory, `schema-evidence-${prefix}.json`);
    const ledgerPath = join(directory, `ledger-evidence-${prefix}.json`);
    writeProtectedJson(schemaPath, entry.schema.document);
    writeProtectedJson(ledgerPath, entry.ledger.document);
    files.push(schemaPath, ledgerPath);
    return {
      name: entry.name,
      schemaEvidenceId: entry.schema.evidenceId,
      schemaEvidenceSha256: entry.schema.sha256,
      schemaEvidenceFile: schemaPath,
      ledgerEvidenceId: entry.ledger.evidenceId,
      ledgerEvidenceSha256: entry.ledger.sha256,
      ledgerEvidenceFile: ledgerPath,
    };
  });
  const fkPath = join(directory, 'archival-fk-disposition-evidence.json');
  writeProtectedJson(fkPath, bundle.foreignKeyDisposition.document);
  files.push(fkPath);
  const fkDocument = bundle.foreignKeyDisposition.document;
  const manifest: AllTenantReconciliationPreauthorizationManifest = {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070C-PREAUTHORIZATION-AGGREGATE-EVIDENCE-CAPTURE',
    candidateCommit: input.candidateCommit,
    capturedAtUtc,
    database: { ...state.database },
    entries: manifestEntries,
    foreignKeyDisposition: {
      evidenceId: bundle.foreignKeyDisposition.evidenceId,
      evidenceSha256: bundle.foreignKeyDisposition.sha256,
      evidenceFile: fkPath,
      rawArchivalViolationCount: fkDocument.rawArchivalViolationCount,
      formallyWaivedViolationCount: fkDocument.formallyWaivedViolationCount,
      effectiveUnwaivedViolationCount: fkDocument.effectiveUnwaivedViolationCount,
      activeViolationCount: fkDocument.activeViolationCount,
      unknownViolationCount: fkDocument.unknownViolationCount,
      archivalRowCount: fkDocument.archivalRowCount,
      archivalLatestUpdatedAtUtc: fkDocument.archivalLatestUpdatedAtUtc,
      activeRowCount: fkDocument.activeRowCount,
      activeLatestCreatedAtUtc: fkDocument.activeLatestCreatedAtUtc,
      triggerCount: fkDocument.triggerCount,
      dependentObjectCount: fkDocument.dependentObjectCount,
      runtimeSourceReferenceCount: fkDocument.runtimeSourceReferenceCount,
      activeWriterDisabledConfirmed: fkDocument.activeWriterDisabledConfirmed,
      excludedFromCanonicalImportConfirmed: fkDocument.excludedFromCanonicalImportConfirmed,
      excludedFromReportingConfirmed: fkDocument.excludedFromReportingConfirmed,
    },
    aggregateOnly: true,
    productionReadPerformed: true,
    productionMutationPerformed: false,
    migrationLedgerRowsWritten: 0,
    trafficChanged: false,
  };
  const manifestPath = join(directory, 'preauthorization-evidence-manifest.json');
  writeProtectedJson(manifestPath, manifest);
  files.push(manifestPath);
  return { manifestPath, manifest, bundle, files };
}

interface CommandResult { stdout: string; stderr: string; status: number }
export type ReconciliationWranglerRunner = (args: string[]) => CommandResult;

function defaultRunner(args: string[]): CommandResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
}

function run(runner: ReconciliationWranglerRunner, args: string[], label: string): CommandResult {
  const result = runner(args);
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  return result;
}

function extractJson(text: string): unknown {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  throw new Error('Wrangler output did not contain JSON');
}

interface D1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

function resultRows(text: string): Array<Record<string, unknown>> {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('D1 output was not a non-empty array');
  const envelopes = parsed as D1Envelope[];
  if (envelopes.some((entry) => entry.success !== true)) throw new Error('D1 output contained an unsuccessful envelope');
  if (envelopes.some((entry) => entry.meta?.changed_db !== false
    || Number(entry.meta?.rows_written ?? 0) !== 0)) {
    throw new Error('D1 aggregate read violated the read-only boundary');
  }
  return envelopes.flatMap((entry) => entry.results ?? []);
}

function executeRead(runner: ReconciliationWranglerRunner, sql: string, label: string): Array<Record<string, unknown>> {
  const result = run(runner, [
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command', sql,
  ], label);
  return resultRows(result.stdout);
}

function parseSqliteUtc(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is missing`);
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const utc = normalized.endsWith('Z') ? normalized : `${normalized}Z`;
  if (!Number.isFinite(Date.parse(utc))) throw new Error(`${label} is invalid`);
  return new Date(utc).toISOString();
}

export function unexpectedArchivalRuntimeReferenceCount(repositoryRoot: string): number {
  const root = resolve(repositoryRoot);
  const sourceRoot = join(root, 'src');
  if (!existsSync(sourceRoot)) return 0;
  let count = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(entry.name))) continue;
      const repositoryPath = relative(root, absolute).replaceAll('\\', '/');
      for (const line of readFileSync(absolute, 'utf8').split(/\r?\n/)) {
        if (!line.includes('doctor_commission_accruals_old_0391')) continue;
        const allowedRetentionMetadata = repositoryPath === 'src/lib/patient-reference-registry.ts'
          && line.includes('policy: "retain_immutable"')
          && line.includes('Historical migration backup table.');
        if (!allowedRetentionMetadata) count += 1;
      }
    }
  };
  visit(sourceRoot);
  return count;
}

export function createProductionAllTenantReconciliationReadGateway(
  runner: ReconciliationWranglerRunner = defaultRunner,
  repositoryRoot: string = process.cwd(),
): AllTenantReconciliationReadGateway {
  return {
    async readAggregateState() {
      const infoResult = run(runner, [
        'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json',
      ], 'production database identity');
      const info = extractJson(infoResult.stdout) as Record<string, unknown>;
      const pendingRows = executeRead(runner, ALL_TENANT_RECONCILIATION_PENDING_SQL, 'pending migration aggregate');
      const targetRows = executeRead(runner, ALL_TENANT_RECONCILIATION_TARGET_LEDGER_SQL, 'target ledger aggregate');
      const schemaRows = executeRead(runner, ALL_TENANT_RECONCILIATION_SCHEMA_ASSERTION_SQL, 'schema aggregate');
      const fkRows = executeRead(runner, ALL_TENANT_RECONCILIATION_FOREIGN_KEY_AGGREGATE_SQL, 'foreign key aggregate');
      const archivalRows = executeRead(
        runner,
        ALL_TENANT_RECONCILIATION_ARCHIVAL_DISPOSITION_SQL,
        'archival disposition aggregate',
      );
      if (archivalRows.length !== 1) throw new Error('Archival disposition aggregate must return exactly one row');
      const archival = archivalRows[0];
      const sourceReferenceCount = unexpectedArchivalRuntimeReferenceCount(repositoryRoot);
      const excludedFromCanonicalImport = !(CDB101_REPORTING_IMPORT_TABLES as readonly string[])
        .includes('doctor_commission_accruals_old_0391');
      const allSchemaExact = Number(schemaRows[0]?.all_schema_exact ?? 0) === 1;
      return {
        database: {
          name: String(info.name ?? ''),
          uuid: String(info.uuid ?? info.id ?? ''),
        },
        pendingMigrationNames: pendingRows.map((row) => String(row.name ?? '')),
        targetLedgerEntriesPresent: targetRows.map((row) => String(row.name ?? '')),
        postSchemaExact: Object.fromEntries(
          CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => [entry.name, allSchemaExact]),
        ),
        foreignKeyGroups: fkRows.map((row) => ({
          childTable: String(row.child_table ?? ''),
          parentTable: String(row.parent_table ?? ''),
          violationCount: Number(row.violation_count ?? 0),
        })),
        archivalDisposition: {
          archivalRowCount: Number(archival.archival_row_count ?? 0),
          archivalLatestUpdatedAtUtc: parseSqliteUtc(
            archival.archival_latest_updated_at,
            'archival latest updated_at',
          ),
          activeRowCount: Number(archival.active_row_count ?? 0),
          activeLatestCreatedAtUtc: parseSqliteUtc(
            archival.active_latest_created_at,
            'active latest created_at',
          ),
          triggerCount: Number(archival.trigger_count ?? 0),
          dependentObjectCount: Number(archival.dependent_object_count ?? 0),
          runtimeSourceReferenceCount: sourceReferenceCount,
          excludedFromCanonicalImport,
          excludedFromReporting: sourceReferenceCount === 0,
        },
      };
    },
  };
}

function parseArgs(args: string[]): {
  outputDirectory: string;
  candidateCommit: string;
  capturedAtUtc?: string;
} {
  const clean = args.filter((arg) => arg !== '--');
  const value = (name: string): string | undefined => {
    const index = clean.indexOf(name);
    return index >= 0 ? clean[index + 1] : undefined;
  };
  const outputDirectory = value('--output-directory');
  const candidateCommit = value('--candidate');
  if (!outputDirectory || !candidateCommit) {
    throw new Error('--output-directory and --candidate are required');
  }
  return { outputDirectory, candidateCommit, capturedAtUtc: value('--captured-at-utc') };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const result = await collectAllTenantReconciliationEvidence({
    repositoryRoot: root,
    outputDirectory: options.outputDirectory,
    candidateCommit: options.candidateCommit,
    capturedAtUtc: options.capturedAtUtc,
  }, createProductionAllTenantReconciliationReadGateway());
  process.stdout.write(`${JSON.stringify({
    manifestPath: result.manifestPath,
    candidateCommit: result.manifest.candidateCommit,
    evidenceEntryCount: result.manifest.entries.length,
    rawArchivalViolationCount: result.manifest.foreignKeyDisposition.rawArchivalViolationCount,
    effectiveUnwaivedViolationCount: result.manifest.foreignKeyDisposition.effectiveUnwaivedViolationCount,
    aggregateOnly: true,
    productionReadPerformed: true,
    productionMutationPerformed: false,
    migrationLedgerRowsWritten: 0,
    trafficChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

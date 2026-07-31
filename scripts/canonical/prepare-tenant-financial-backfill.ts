import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  backfillInvoices,
  type InvoiceBackfillDatabase,
  type InvoiceBackfillPreparedStatement,
} from './backfill-invoices';
import { backfillPractitioners } from './backfill-practitioners';
import { backfillEncounters } from './backfill-encounters';
import { backfillServiceCatalog } from './backfill-service-catalog';
import { backfillServiceOperations } from './backfill-service-operations';
import { backfillInvoiceItemDeliveries } from './backfill-invoice-item-deliveries';
import { backfillPayments } from './backfill-payments';
import { backfillDepositReceipts } from './backfill-deposit-receipts';
import { backfillDepositLifecycle } from './backfill-deposit-lifecycle';
import { backfillBillPaidResiduals } from './backfill-bill-paid-residuals';
import { backfillAdjustments } from './backfill-adjustments';
import { backfillCompensation } from './backfill-compensation';
import { executeCompensationReportingContextBackfill } from './backfill-compensation-reporting-context';
import { buildProductionCanonicalBundle } from './build-production-canonical-bundle';
import {
  CDB101_FINANCIAL_CURRENCY_CODE,
  CDB101_FINANCIAL_IMPORT_TABLES,
  CDB101_FINANCIAL_TENANT_ID,
} from './tenant-financial-import-contract';

const FINANCIAL_BUSINESS_TABLES = CDB101_FINANCIAL_IMPORT_TABLES.filter((table) => ![
  'canonical_migration_runs',
  'canonical_backfill_checkpoints',
  'canonical_source_mappings',
  'canonical_processing_issues',
].includes(table));

const LEGACY_FINANCIAL_TABLES = [
  'bills',
  'payments',
  'billing_deposits',
  'billing_credit_notes',
  'billing_refund_cash_holds',
  'doctor_commission_accruals',
  'diagnostic_performer_reserves',
] as const;

export const REQUIRED_FINANCIAL_MIGRATIONS = [
  '0504_doctor_commission_currency_precision.sql',
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
  '0519_live_doctor_compensation_dual_write.sql',
  '0530_canonical_compensation_reporting_context.sql',
  '0531_canonical_compensation_refund_reservations.sql',
] as const;

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements InvoiceBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function sqliteAdapter(database: DatabaseSync): InvoiceBackfillDatabase {
  return {
    prepare(sql: string) {
      return new SqliteStatement(database, sql);
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results: unknown[] = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function requireProtectedRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${label} must be one protected regular file`);
  }
  if ((stat.mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 600`);
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error(`${label} parent directory must use mode 700`);
  }
}

function prepareOutputDirectory(path: string): string {
  const absolute = resolve(path);
  const repository = resolve(process.cwd());
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Financial backfill output must remain outside the repository');
  }
  try {
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Output must be a regular directory');
    if ((stat.mode & 0o777) !== 0o700) throw new Error('Output directory must use mode 700');
    if (readdirSync(absolute).length !== 0) throw new Error('Output directory must be empty');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(absolute, { recursive: true, mode: 0o700 });
    chmodSync(absolute, 0o700);
  }
  return absolute;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
  ).get(table));
}

function ensureFinancialSchema(database: DatabaseSync): void {
  if (!tableExists(database, 'd1_migrations')) {
    throw new Error('Source database is missing d1_migrations');
  }
  const applied = new Set(
    (database.prepare('SELECT name FROM d1_migrations').all() as Array<{ name?: unknown }>)
      .map((row) => String(row.name ?? '')),
  );
  for (const migration of REQUIRED_FINANCIAL_MIGRATIONS) {
    if (applied.has(migration)) continue;
    const sql = readFileSync(resolve(process.cwd(), 'migrations', migration), 'utf8');
    database.exec(sql);
    database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(migration);
  }
  for (const table of CDB101_FINANCIAL_IMPORT_TABLES) {
    if (!tableExists(database, table)) throw new Error(`Canonical migration did not create ${table}`);
  }
}

function tenantRowCount(database: DatabaseSync, table: string): number {
  if (!tableExists(database, table)) throw new Error(`Missing required table: ${table}`);
  const row = database.prepare(`SELECT COUNT(*) count FROM "${table}" WHERE CAST(tenant_id AS TEXT)=?`)
    .get(CDB101_FINANCIAL_TENANT_ID) as { count?: unknown } | undefined;
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid row count for ${table}`);
  return count;
}

function countTables(database: DatabaseSync, tables: readonly string[]): Record<string, number> {
  return Object.fromEntries(tables.map((table) => [table, tenantRowCount(database, table)]));
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export function calculateSecondPassNewRows(
  before: Record<string, number>,
  after: Record<string, number>,
): number {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.reduce((sum, key) => sum + Math.max(0, Number(after[key] ?? 0) - Number(before[key] ?? 0)), 0);
}

export function evaluateTenantFinancialBackfillReadiness(input: {
  tenantId: string;
  firstPassCompleted: boolean;
  secondPassCompleted: boolean;
  secondPassNewRows: number;
  legacyRowsBefore: number;
  legacyRowsAfter: number;
  bundleReady: boolean;
  allowedTables: readonly string[];
}): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  if (input.tenantId !== CDB101_FINANCIAL_TENANT_ID) issues.push('CDB101_FINANCIAL_BACKFILL_TENANT_INVALID');
  if (!input.firstPassCompleted) issues.push('CDB101_FINANCIAL_BACKFILL_FIRST_PASS_INCOMPLETE');
  if (!input.secondPassCompleted) issues.push('CDB101_FINANCIAL_BACKFILL_SECOND_PASS_INCOMPLETE');
  if (input.secondPassNewRows !== 0) issues.push('CDB101_FINANCIAL_BACKFILL_SECOND_PASS_NOT_ZERO');
  if (input.legacyRowsBefore !== input.legacyRowsAfter) issues.push('CDB101_FINANCIAL_BACKFILL_LEGACY_MUTATED');
  if (!input.bundleReady) issues.push('CDB101_FINANCIAL_BACKFILL_BUNDLE_NOT_READY');
  if (
    input.allowedTables.length !== CDB101_FINANCIAL_IMPORT_TABLES.length
    || input.allowedTables.some((table, index) => table !== CDB101_FINANCIAL_IMPORT_TABLES[index])
  ) {
    issues.push('CDB101_FINANCIAL_BACKFILL_TABLE_SCOPE_INVALID');
  }
  return { ready: issues.length === 0, issues };
}

export interface PrepareTenantFinancialBackfillOptions {
  sourceDatabasePath: string;
  sourceExportPath: string;
  outputDirectory: string;
  authorizationId: string;
  deterministicRunId: string;
  nowUtc: string;
}

export interface TenantFinancialBackfillReceipt {
  schemaVersion: 1;
  tenantId: '100';
  bundleReady: boolean;
  firstPassCompleted: boolean;
  secondPassCompleted: boolean;
  secondPassNewRows: number;
  legacyRowsMutated: number;
  canonicalBusinessRows: number;
  allowedTables: readonly string[];
  bundleSha256: string;
  manifestSha256: string;
  sourceExportSha256: string;
  issues: string[];
  aggregateOnly: true;
  productionMutationPerformed: false;
}

async function runBackfillPass(
  db: InvoiceBackfillDatabase,
  runId: string,
  nowUtc: string,
): Promise<boolean> {
  const common = {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    currencyCode: CDB101_FINANCIAL_CURRENCY_CODE,
    nowUtc,
  };
  const practitioners = await backfillPractitioners(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    runPublicId: `${runId}-practitioners`,
    nowUtc,
  });
  const encounters = await backfillEncounters(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    runPublicId: `${runId}-encounters`,
    nowUtc,
  });
  const catalog = await backfillServiceCatalog(db, {
    ...common,
    runPublicId: `${runId}-service-catalog`,
  });
  const operations = await backfillServiceOperations(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    runPublicId: `${runId}-service-operations`,
    nowUtc,
  });
  const historicalDeliveries = await backfillInvoiceItemDeliveries(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    currencyCode: CDB101_FINANCIAL_CURRENCY_CODE,
    nowUtc,
  });
  const invoices = await backfillInvoices(db, { ...common, runPublicId: `${runId}-invoices` });
  const payments = await backfillPayments(db, { ...common, runPublicId: `${runId}-payments` });
  const depositReceipts = await backfillDepositReceipts(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    currencyCode: CDB101_FINANCIAL_CURRENCY_CODE,
    nowUtc,
  });
  const depositLifecycle = await backfillDepositLifecycle(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    currencyCode: CDB101_FINANCIAL_CURRENCY_CODE,
    nowUtc,
  });
  const billPaidResiduals = await backfillBillPaidResiduals(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    currencyCode: CDB101_FINANCIAL_CURRENCY_CODE,
    nowUtc,
  });
  const adjustments = await backfillAdjustments(db, { ...common, runPublicId: `${runId}-adjustments` });
  const compensation = await backfillCompensation(db, { ...common, runPublicId: `${runId}-compensation` });
  const compensationReportingContext = await executeCompensationReportingContextBackfill(db, {
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    maxRows: 10_000,
    requireComplete: true,
  });
  return practitioners.completed
    && encounters.completed
    && catalog.completed
    && operations.completed
    && historicalDeliveries.completed
    && invoices.completed
    && payments.completed
    && depositReceipts.completed
    && depositLifecycle.completed
    && billPaidResiduals.completed
    && adjustments.completed
    && compensation.completed
    && compensationReportingContext.remainingActiveAccrualsWithoutContext === 0;
}

export async function prepareTenantFinancialBackfill(
  options: PrepareTenantFinancialBackfillOptions,
): Promise<TenantFinancialBackfillReceipt> {
  const sourceDatabasePath = resolve(options.sourceDatabasePath);
  const sourceExportPath = resolve(options.sourceExportPath);
  requireProtectedRegularFile(sourceDatabasePath, 'Source database');
  requireProtectedRegularFile(sourceExportPath, 'Source export');
  if (!options.nowUtc.endsWith('Z') || !Number.isFinite(Date.parse(options.nowUtc))) {
    throw new Error('nowUtc must be a valid UTC timestamp');
  }
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.authorizationId)) {
    throw new Error('authorizationId is invalid');
  }
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.deterministicRunId)) {
    throw new Error('deterministicRunId is invalid');
  }

  const outputDirectory = prepareOutputDirectory(options.outputDirectory);
  const workDatabasePath = resolve(outputDirectory, 'tenant-100-financial-backfill.sqlite');
  const bundleDirectory = resolve(outputDirectory, 'bundle');
  copyFileSync(sourceDatabasePath, workDatabasePath);
  chmodSync(workDatabasePath, 0o600);

  const database = new DatabaseSync(workDatabasePath);
  database.exec('PRAGMA foreign_keys=ON');
  ensureFinancialSchema(database);
  let firstPassCompleted = false;
  let secondPassCompleted = false;
  let secondPassNewRows = -1;
  let legacyRowsBefore = 0;
  let legacyRowsAfter = 0;
  let canonicalBusinessRows = 0;
  try {
    const adapter = sqliteAdapter(database);
    legacyRowsBefore = sumCounts(countTables(database, LEGACY_FINANCIAL_TABLES));
    firstPassCompleted = await runBackfillPass(adapter, `${options.deterministicRunId}-pass1`, options.nowUtc);
    const beforeSecondPass = countTables(database, FINANCIAL_BUSINESS_TABLES);
    secondPassCompleted = await runBackfillPass(adapter, `${options.deterministicRunId}-pass2`, options.nowUtc);
    const afterSecondPass = countTables(database, FINANCIAL_BUSINESS_TABLES);
    secondPassNewRows = calculateSecondPassNewRows(beforeSecondPass, afterSecondPass);
    canonicalBusinessRows = sumCounts(afterSecondPass);
    legacyRowsAfter = sumCounts(countTables(database, LEGACY_FINANCIAL_TABLES));
  } finally {
    database.close();
  }

  const bundle = buildProductionCanonicalBundle({
    sourceDatabase: workDatabasePath,
    baselineDatabase: sourceDatabasePath,
    sourceExportPath,
    outputDirectory: bundleDirectory,
    authorizationId: options.authorizationId,
    deterministicRunId: options.deterministicRunId,
    allowedTables: CDB101_FINANCIAL_IMPORT_TABLES,
  });
  const readiness = evaluateTenantFinancialBackfillReadiness({
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    firstPassCompleted,
    secondPassCompleted,
    secondPassNewRows,
    legacyRowsBefore,
    legacyRowsAfter,
    bundleReady: bundle.bundleReady,
    allowedTables: CDB101_FINANCIAL_IMPORT_TABLES,
  });

  return {
    schemaVersion: 1,
    tenantId: CDB101_FINANCIAL_TENANT_ID,
    bundleReady: readiness.ready,
    firstPassCompleted,
    secondPassCompleted,
    secondPassNewRows,
    legacyRowsMutated: Math.abs(legacyRowsAfter - legacyRowsBefore),
    canonicalBusinessRows,
    allowedTables: CDB101_FINANCIAL_IMPORT_TABLES,
    bundleSha256: bundle.bundleSha256,
    manifestSha256: bundle.manifestSha256,
    sourceExportSha256: bundle.sourceExportSha256,
    issues: readiness.issues,
    aggregateOnly: true,
    productionMutationPerformed: false,
  };
}

interface CliOptions extends PrepareTenantFinancialBackfillOptions {}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const allowed = new Set([
    '--source-database',
    '--source-export',
    '--output-directory',
    '--authorization-id',
    '--deterministic-run-id',
    '--now-utc',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  for (const key of allowed) if (!values.get(key)) throw new Error(`${key} is required`);
  return {
    sourceDatabasePath: values.get('--source-database')!,
    sourceExportPath: values.get('--source-export')!,
    outputDirectory: values.get('--output-directory')!,
    authorizationId: values.get('--authorization-id')!,
    deterministicRunId: values.get('--deterministic-run-id')!,
    nowUtc: values.get('--now-utc')!,
  };
}

async function main(): Promise<void> {
  try {
    const receipt = await prepareTenantFinancialBackfill(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.bundleReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

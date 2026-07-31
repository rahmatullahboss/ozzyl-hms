import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type {
  InvoiceBackfillDatabase,
  InvoiceBackfillPreparedStatement,
} from './backfill-invoices';
import { backfillPractitioners } from './backfill-practitioners';
import { backfillEncounters } from './backfill-encounters';
import { backfillServiceCatalog } from './backfill-service-catalog';
import { backfillServiceOperations } from './backfill-service-operations';
import { backfillInvoiceItemDeliveries } from './backfill-invoice-item-deliveries';
import { backfillInvoices } from './backfill-invoices';
import { backfillPayments } from './backfill-payments';
import { backfillDepositReceipts } from './backfill-deposit-receipts';
import { backfillBillPaidResiduals } from './backfill-bill-paid-residuals';
import { backfillAdjustments } from './backfill-adjustments';
import { backfillCompensation } from './backfill-compensation';
import { CDB101_FINANCIAL_IMPORT_TABLES } from './tenant-financial-import-contract';

const REQUIRED_SOURCE_MIGRATIONS = [
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
  '0505_performer_reserve_full_discount_backfill.sql',
  '0506_doctor_waiver_gross_commission_backfill.sql',
] as const;

const LEGACY_FINANCIAL_TABLES = [
  'bills',
  'payments',
  'billing_deposits',
  'billing_credit_notes',
  'billing_refund_cash_holds',
  'doctor_commission_accruals',
  'diagnostic_performer_reserves',
] as const;

const BUSINESS_TABLES = CDB101_FINANCIAL_IMPORT_TABLES.filter((table) => ![
  'canonical_migration_runs',
  'canonical_backfill_checkpoints',
  'canonical_source_mappings',
  'canonical_processing_issues',
].includes(table));

const EXPECTED_AGGREGATE_ISSUE = 'COMPENSATION_AGGREGATE_ACCRUAL_NOT_LINE_IMPORTABLE';
const EXPECTED_AGGREGATE_RESOLUTION = 'DETERMINISTIC_NONIMPORTABLE_LEGACY_AGGREGATE';
const SOURCE_ACCRUAL = 'legacy_doctor_commission_accrual';

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
    throw new Error('Compensation rehearsal output must remain outside the repository');
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

function assertSourceMigrations(database: DatabaseSync): void {
  if (!tableExists(database, 'd1_migrations')) throw new Error('Source database is missing d1_migrations');
  const applied = new Set(
    (database.prepare('SELECT name FROM d1_migrations').all() as Array<{ name?: unknown }>)
      .map((row) => String(row.name ?? '')),
  );
  const missing = REQUIRED_SOURCE_MIGRATIONS.filter((migration) => !applied.has(migration));
  if (missing.length > 0) {
    throw new Error(`Source database is missing required production migrations: ${missing.join(', ')}`);
  }
  for (const table of CDB101_FINANCIAL_IMPORT_TABLES) {
    if (!tableExists(database, table)) throw new Error(`Source database is missing ${table}`);
  }
}

function tenantRowCount(database: DatabaseSync, table: string, tenantId: string): number {
  if (!tableExists(database, table)) throw new Error(`Missing required table: ${table}`);
  const row = database.prepare(`SELECT COUNT(*) count FROM "${table}" WHERE CAST(tenant_id AS TEXT)=?`)
    .get(tenantId) as { count?: unknown } | undefined;
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid row count for ${table}`);
  return count;
}

function countTables(database: DatabaseSync, tables: readonly string[], tenantId: string): Record<string, number> {
  return Object.fromEntries(tables.map((table) => [table, tenantRowCount(database, table, tenantId)]));
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export function calculateTenantSecondPassNewRows(
  before: Record<string, number>,
  after: Record<string, number>,
): number {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.reduce((sum, key) => sum + Math.max(0, Number(after[key] ?? 0) - Number(before[key] ?? 0)), 0);
}

interface TargetResolutionEvidence {
  sourceId: string;
  mappingStatus: string | null;
  canonicalPublicIdPresent: boolean;
  issueCode: string | null;
  issueSeverity: string | null;
  issueStatus: string | null;
  resolutionCode: string | null;
}

export function evaluateTargetAggregateResolution(input: TargetResolutionEvidence): {
  ready: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (input.mappingStatus !== 'rejected') issues.push('COMPENSATION_TARGET_MAPPING_NOT_REJECTED');
  if (input.canonicalPublicIdPresent) issues.push('COMPENSATION_TARGET_UNSAFE_CANONICAL_LINK');
  if (input.issueCode !== EXPECTED_AGGREGATE_ISSUE) issues.push('COMPENSATION_TARGET_ISSUE_CODE_INVALID');
  if (input.issueSeverity !== 'warning') issues.push('COMPENSATION_TARGET_ISSUE_SEVERITY_INVALID');
  if (input.issueStatus !== 'waived') issues.push('COMPENSATION_TARGET_ISSUE_STATUS_INVALID');
  if (input.resolutionCode !== EXPECTED_AGGREGATE_RESOLUTION) {
    issues.push('COMPENSATION_TARGET_RESOLUTION_CODE_INVALID');
  }
  return { ready: issues.length === 0, issues };
}

async function runBackfillPass(
  db: InvoiceBackfillDatabase,
  tenantId: string,
  currencyCode: string,
  runId: string,
  nowUtc: string,
): Promise<boolean> {
  const common = { tenantId, currencyCode, nowUtc };
  const practitioners = await backfillPractitioners(db, {
    tenantId,
    runPublicId: `${runId}-practitioners`,
    nowUtc,
  });
  const encounters = await backfillEncounters(db, {
    tenantId,
    runPublicId: `${runId}-encounters`,
    nowUtc,
  });
  const catalog = await backfillServiceCatalog(db, { ...common, runPublicId: `${runId}-service-catalog` });
  const operations = await backfillServiceOperations(db, {
    tenantId,
    runPublicId: `${runId}-service-operations`,
    nowUtc,
  });
  const deliveries = await backfillInvoiceItemDeliveries(db, { tenantId, currencyCode, nowUtc });
  const invoices = await backfillInvoices(db, { ...common, runPublicId: `${runId}-invoices` });
  const payments = await backfillPayments(db, { ...common, runPublicId: `${runId}-payments` });
  const depositReceipts = await backfillDepositReceipts(db, { tenantId, currencyCode, nowUtc });
  const residuals = await backfillBillPaidResiduals(db, { tenantId, currencyCode, nowUtc });
  const adjustments = await backfillAdjustments(db, { ...common, runPublicId: `${runId}-adjustments` });
  const compensation = await backfillCompensation(db, { ...common, runPublicId: `${runId}-compensation` });
  return practitioners.completed
    && encounters.completed
    && catalog.completed
    && operations.completed
    && deliveries.completed
    && invoices.completed
    && payments.completed
    && depositReceipts.completed
    && residuals.completed
    && adjustments.completed
    && compensation.completed;
}

function readTargetEvidence(database: DatabaseSync, tenantId: string, sourceId: string): TargetResolutionEvidence {
  const row = database.prepare(`
    SELECT
      m.mapping_status,
      m.canonical_public_id,
      i.issue_code,
      i.severity,
      i.status,
      i.resolution_code
    FROM canonical_source_mappings m
    LEFT JOIN canonical_processing_issues i
      ON i.tenant_id=m.tenant_id
      AND i.issue_type='compensation_backfill'
      AND i.entity_type='compensation_accrual'
      AND i.source_type=m.source_type
      AND i.source_public_id=m.source_public_id
    WHERE m.tenant_id=?
      AND m.entity_type='compensation_accrual'
      AND m.source_type=?
      AND m.source_public_id=?
    LIMIT 1
  `).get(tenantId, SOURCE_ACCRUAL, sourceId) as {
    mapping_status?: unknown;
    canonical_public_id?: unknown;
    issue_code?: unknown;
    severity?: unknown;
    status?: unknown;
    resolution_code?: unknown;
  } | undefined;
  return {
    sourceId,
    mappingStatus: row?.mapping_status == null ? null : String(row.mapping_status),
    canonicalPublicIdPresent: row?.canonical_public_id != null && String(row.canonical_public_id).length > 0,
    issueCode: row?.issue_code == null ? null : String(row.issue_code),
    issueSeverity: row?.severity == null ? null : String(row.severity),
    issueStatus: row?.status == null ? null : String(row.status),
    resolutionCode: row?.resolution_code == null ? null : String(row.resolution_code),
  };
}

function compensationIssueCounts(database: DatabaseSync, tenantId: string): {
  openErrors: number;
  waivedWarnings: number;
} {
  const row = database.prepare(`
    SELECT
      SUM(CASE WHEN status='open' AND severity='error' THEN 1 ELSE 0 END) open_errors,
      SUM(CASE WHEN status='waived' AND severity='warning' THEN 1 ELSE 0 END) waived_warnings
    FROM canonical_processing_issues
    WHERE tenant_id=? AND issue_type='compensation_backfill'
  `).get(tenantId) as { open_errors?: unknown; waived_warnings?: unknown } | undefined;
  return {
    openErrors: Number(row?.open_errors ?? 0),
    waivedWarnings: Number(row?.waived_warnings ?? 0),
  };
}

export interface RehearseTenantCompensationBackfillOptions {
  sourceDatabasePath: string;
  sourceExportPath: string;
  outputDirectory: string;
  tenantId: string;
  currencyCode: string;
  targetAccrualSourceId: string;
  deterministicRunId: string;
  nowUtc: string;
}

export interface TenantCompensationRehearsalReceipt {
  schemaVersion: 1;
  tenantId: string;
  currencyCode: string;
  sourceExportSha256: string;
  firstPassCompleted: boolean;
  secondPassCompleted: boolean;
  secondPassNewRows: number;
  legacyRowsMutated: number;
  canonicalBusinessRows: number;
  compensationRows: Record<string, number>;
  targetResolution: TargetResolutionEvidence & { ready: boolean };
  openCompensationErrors: number;
  waivedCompensationWarnings: number;
  targetResolutionReady: boolean;
  tenantCompensationCutoverReady: boolean;
  issues: string[];
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export async function rehearseTenantCompensationBackfill(
  options: RehearseTenantCompensationBackfillOptions,
): Promise<TenantCompensationRehearsalReceipt> {
  const sourceDatabasePath = resolve(options.sourceDatabasePath);
  const sourceExportPath = resolve(options.sourceExportPath);
  requireProtectedRegularFile(sourceDatabasePath, 'Source database');
  requireProtectedRegularFile(sourceExportPath, 'Source export');
  if (!/^\d+$/.test(options.tenantId)) throw new Error('tenantId must be numeric text');
  if (!/^[A-Z]{3}$/.test(options.currencyCode)) throw new Error('currencyCode must be three uppercase letters');
  if (!/^\d+$/.test(options.targetAccrualSourceId)) throw new Error('targetAccrualSourceId must be numeric text');
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.deterministicRunId)) {
    throw new Error('deterministicRunId is invalid');
  }
  if (!options.nowUtc.endsWith('Z') || !Number.isFinite(Date.parse(options.nowUtc))) {
    throw new Error('nowUtc must be a valid UTC timestamp');
  }

  const outputDirectory = prepareOutputDirectory(options.outputDirectory);
  const workDatabasePath = resolve(outputDirectory, `tenant-${options.tenantId}-compensation-rehearsal.sqlite`);
  const receiptPath = resolve(outputDirectory, `tenant-${options.tenantId}-compensation-rehearsal.json`);
  copyFileSync(sourceDatabasePath, workDatabasePath);
  chmodSync(workDatabasePath, 0o600);

  let firstPassCompleted = false;
  let secondPassCompleted = false;
  let secondPassNewRows = -1;
  let legacyRowsBefore = 0;
  let legacyRowsAfter = 0;
  let canonicalBusinessRows = 0;
  let compensationRows: Record<string, number> = {};
  let targetResolution: TargetResolutionEvidence = {
    sourceId: options.targetAccrualSourceId,
    mappingStatus: null,
    canonicalPublicIdPresent: false,
    issueCode: null,
    issueSeverity: null,
    issueStatus: null,
    resolutionCode: null,
  };
  let issueCounts = { openErrors: 0, waivedWarnings: 0 };

  const database = new DatabaseSync(workDatabasePath);
  database.exec('PRAGMA foreign_keys=ON');
  try {
    assertSourceMigrations(database);
    const adapter = sqliteAdapter(database);
    legacyRowsBefore = sumCounts(countTables(database, LEGACY_FINANCIAL_TABLES, options.tenantId));
    firstPassCompleted = await runBackfillPass(
      adapter,
      options.tenantId,
      options.currencyCode,
      `${options.deterministicRunId}-pass1`,
      options.nowUtc,
    );
    const beforeSecondPass = countTables(database, BUSINESS_TABLES, options.tenantId);
    secondPassCompleted = await runBackfillPass(
      adapter,
      options.tenantId,
      options.currencyCode,
      `${options.deterministicRunId}-pass2`,
      options.nowUtc,
    );
    const afterSecondPass = countTables(database, BUSINESS_TABLES, options.tenantId);
    secondPassNewRows = calculateTenantSecondPassNewRows(beforeSecondPass, afterSecondPass);
    canonicalBusinessRows = sumCounts(afterSecondPass);
    legacyRowsAfter = sumCounts(countTables(database, LEGACY_FINANCIAL_TABLES, options.tenantId));
    compensationRows = countTables(database, [
      'canonical_compensation_rules',
      'canonical_compensation_accruals',
      'canonical_compensation_settlements',
      'canonical_compensation_settlement_allocations',
      'canonical_compensation_adjustments',
    ], options.tenantId);
    targetResolution = readTargetEvidence(database, options.tenantId, options.targetAccrualSourceId);
    issueCounts = compensationIssueCounts(database, options.tenantId);
  } finally {
    database.close();
  }

  const targetEvaluation = evaluateTargetAggregateResolution(targetResolution);
  const issues = [...targetEvaluation.issues];
  if (!firstPassCompleted) issues.push('COMPENSATION_REHEARSAL_FIRST_PASS_INCOMPLETE');
  if (!secondPassCompleted) issues.push('COMPENSATION_REHEARSAL_SECOND_PASS_INCOMPLETE');
  if (secondPassNewRows !== 0) issues.push('COMPENSATION_REHEARSAL_SECOND_PASS_NOT_ZERO');
  if (legacyRowsBefore !== legacyRowsAfter) issues.push('COMPENSATION_REHEARSAL_LEGACY_MUTATED');
  if (issueCounts.openErrors !== 0) issues.push('COMPENSATION_REHEARSAL_OPEN_ERRORS_REMAIN');

  const receipt: TenantCompensationRehearsalReceipt = {
    schemaVersion: 1,
    tenantId: options.tenantId,
    currencyCode: options.currencyCode,
    sourceExportSha256: createHash('sha256').update(readFileSync(sourceExportPath)).digest('hex'),
    firstPassCompleted,
    secondPassCompleted,
    secondPassNewRows,
    legacyRowsMutated: Math.abs(legacyRowsAfter - legacyRowsBefore),
    canonicalBusinessRows,
    compensationRows,
    targetResolution: { ...targetResolution, ready: targetEvaluation.ready },
    openCompensationErrors: issueCounts.openErrors,
    waivedCompensationWarnings: issueCounts.waivedWarnings,
    targetResolutionReady: targetEvaluation.ready
      && firstPassCompleted
      && secondPassCompleted
      && secondPassNewRows === 0
      && legacyRowsBefore === legacyRowsAfter,
    tenantCompensationCutoverReady: issues.length === 0,
    issues: [...new Set(issues)],
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  return receipt;
}

function parseArgs(args: string[]): RehearseTenantCompensationBackfillOptions {
  const values = new Map<string, string>();
  const allowed = new Set([
    '--source-database',
    '--source-export',
    '--output-directory',
    '--tenant-id',
    '--currency-code',
    '--target-accrual-source-id',
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
    tenantId: values.get('--tenant-id')!,
    currencyCode: values.get('--currency-code')!,
    targetAccrualSourceId: values.get('--target-accrual-source-id')!,
    deterministicRunId: values.get('--deterministic-run-id')!,
    nowUtc: values.get('--now-utc')!,
  };
}

async function main(): Promise<void> {
  try {
    const receipt = await rehearseTenantCompensationBackfill(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.targetResolutionReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

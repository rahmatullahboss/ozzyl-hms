import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_REPORTING_IMPORT_TABLES,
  validateCanonicalImportBundleSql,
} from './production-cutover-contract';
import type { ProductionCanonicalImportManifest } from './import-production-canonical-bundle';

export interface BuildProductionCanonicalBundleOptions {
  sourceDatabase: string;
  baselineDatabase?: string;
  sourceExportPath: string;
  outputDirectory: string;
  authorizationId: string;
  deterministicRunId: string;
  allowedTables?: readonly string[];
}

export interface ProductionCanonicalBundleReceipt {
  schemaVersion: 1;
  bundleReady: boolean;
  tenantId: '100';
  tableCount: number;
  rowCount: number;
  statementCount: number;
  rowCountSummary: Record<string, number>;
  bundleSha256: string;
  manifestSha256: string;
  sourceExportSha256: string;
  deterministicRunId: string;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
  bundlePath: string;
  manifestPath: string;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

type SqliteValue = null | number | bigint | string | Uint8Array;

function sha256Bytes(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQLite identifier: ${value}`);
  return `"${value}"`;
}

function sqlLiteral(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite SQLite number is not allowed');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex').toUpperCase()}'`;
  throw new Error(`Unsupported SQLite value type: ${typeof value}`);
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

function prepareOutputDirectory(outputDirectory: string): string {
  const absolute = resolve(outputDirectory);
  const repositoryRoot = resolve(process.cwd());
  if (absolute === repositoryRoot || absolute.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error('Protected bundle output must remain outside the repository');
  }
  try {
    const existing = lstatSync(absolute);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error('Output path must be a regular directory');
    }
    if ((existing.mode & 0o777) !== 0o700) throw new Error('Output directory must use mode 700');
    if (readdirSync(absolute).length !== 0) throw new Error('Output directory must be empty to prevent overwrite');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
    mkdirSync(absolute, { mode: 0o700 });
    chmodSync(absolute, 0o700);
  }
  return absolute;
}

function tableColumns(database: DatabaseSync, table: string): ColumnInfo[] {
  const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as unknown as ColumnInfo[];
  if (rows.length === 0) throw new Error(`Missing canonical source table: ${table}`);
  if (!rows.some((column) => column.name === 'tenant_id')) {
    throw new Error(`Canonical source table ${table} does not contain tenant_id`);
  }
  return [...rows].sort((left, right) => left.cid - right.cid);
}

function rowsForTable(
  database: DatabaseSync,
  table: string,
  columns: ColumnInfo[],
): Array<Record<string, SqliteValue>> {
  const primaryKeys = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => quoteIdentifier(column.name));
  const orderBy = primaryKeys.length > 0 ? primaryKeys.join(', ') : 'rowid';
  const columnSql = columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const statement = database.prepare(
    `SELECT ${columnSql} FROM ${quoteIdentifier(table)} WHERE tenant_id = ? ORDER BY ${orderBy}`,
  );
  if ('setReadBigInts' in statement && typeof statement.setReadBigInts === 'function') {
    statement.setReadBigInts(true);
  }
  return statement.all(CDB101_CANARY_TENANT_ID) as unknown as Array<Record<string, SqliteValue>>;
}

function renderInsert(table: string, columns: ColumnInfo[], row: Record<string, SqliteValue>): string {
  if (String(row.tenant_id) !== CDB101_CANARY_TENANT_ID) {
    throw new Error(`Cross-tenant row detected in ${table}`);
  }
  const columnSql = columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const valuesSql = columns.map((column) => sqlLiteral(row[column.name])).join(', ');
  return `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${valuesSql});`;
}

function primaryKeyColumns(columns: ColumnInfo[]): ColumnInfo[] {
  const keys = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk);
  if (keys.length === 0) throw new Error('Canonical delta bundle requires primary keys on every allowed table');
  return keys;
}

function comparableValue(value: SqliteValue): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? '0' : String(value)}`;
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  return `blob:${Buffer.from(value).toString('hex')}`;
}

function rowKey(row: Record<string, SqliteValue>, keys: ColumnInfo[]): string {
  return keys.map((column) => comparableValue(row[column.name])).join('|');
}

function equalValue(left: SqliteValue, right: SqliteValue): boolean {
  return comparableValue(left) === comparableValue(right);
}

function exactColumnContract(target: ColumnInfo[], baseline: ColumnInfo[], table: string): void {
  if (
    target.length !== baseline.length
    || target.some((column, index) => {
      const other = baseline[index];
      return !other
        || column.name !== other.name
        || column.type !== other.type
        || column.pk !== other.pk;
    })
  ) {
    throw new Error(`Canonical baseline schema mismatch for ${table}`);
  }
}

function oldValuePredicate(column: ColumnInfo, value: SqliteValue): string {
  const identifier = quoteIdentifier(column.name);
  return value === null ? `${identifier} IS NULL` : `${identifier}=${sqlLiteral(value)}`;
}

function renderGuardedUpdate(
  table: string,
  columns: ColumnInfo[],
  target: Record<string, SqliteValue>,
  baseline: Record<string, SqliteValue>,
): string | null {
  if (String(target.tenant_id) !== CDB101_CANARY_TENANT_ID || String(baseline.tenant_id) !== CDB101_CANARY_TENANT_ID) {
    throw new Error(`Cross-tenant row detected in ${table}`);
  }
  const keys = primaryKeyColumns(columns);
  const keyNames = new Set(keys.map((column) => column.name));
  const changed = columns.filter((column) => (
    column.name !== 'tenant_id'
    && !keyNames.has(column.name)
    && !equalValue(target[column.name], baseline[column.name])
  ));
  if (changed.length === 0) return null;

  const setClause = changed
    .map((column) => `${quoteIdentifier(column.name)}=${sqlLiteral(target[column.name])}`)
    .join(',');
  const predicates = [
    `tenant_id = '${CDB101_CANARY_TENANT_ID}'`,
    ...keys
      .filter((column) => column.name !== 'tenant_id')
      .map((column) => oldValuePredicate(column, baseline[column.name])),
    ...changed.map((column) => oldValuePredicate(column, baseline[column.name])),
  ];
  return `UPDATE ${quoteIdentifier(table)} SET ${setClause} WHERE ${predicates.join(' AND ')};`;
}

function writeProtectedFile(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
}

function withHiddenPaths(
  receipt: Omit<ProductionCanonicalBundleReceipt, 'bundlePath' | 'manifestPath'>,
  bundlePath: string,
  manifestPath: string,
): ProductionCanonicalBundleReceipt {
  const result = { ...receipt } as ProductionCanonicalBundleReceipt;
  Object.defineProperties(result, {
    bundlePath: { value: bundlePath, enumerable: false, writable: false },
    manifestPath: { value: manifestPath, enumerable: false, writable: false },
  });
  return result;
}

export function buildProductionCanonicalBundle(
  options: BuildProductionCanonicalBundleOptions,
): ProductionCanonicalBundleReceipt {
  const sourceDatabase = resolve(options.sourceDatabase);
  const baselineDatabase = options.baselineDatabase ? resolve(options.baselineDatabase) : null;
  const sourceExportPath = resolve(options.sourceExportPath);
  requireProtectedRegularFile(sourceDatabase, 'Source canonical database');
  if (baselineDatabase) requireProtectedRegularFile(baselineDatabase, 'Baseline canonical database');
  requireProtectedRegularFile(sourceExportPath, 'Source export');
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.authorizationId)) {
    throw new Error('authorizationId is invalid');
  }
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.deterministicRunId)) {
    throw new Error('deterministicRunId is invalid');
  }
  const allowedTables = [...(options.allowedTables ?? CDB101_REPORTING_IMPORT_TABLES)];
  if (
    allowedTables.length === 0
    || new Set(allowedTables).size !== allowedTables.length
    || allowedTables.some((table) => !/^canonical_[a-z0-9_]+$/.test(table))
  ) {
    throw new Error('Allowed tables must be a unique canonical-only ordered list');
  }
  const outputDirectory = prepareOutputDirectory(options.outputDirectory);
  const bundlePath = resolve(outputDirectory, 'tenant-100-canonical-import.sql');
  const manifestPath = resolve(outputDirectory, 'tenant-100-canonical-import-manifest.json');
  const bundleTemp = resolve(outputDirectory, '.tenant-100-canonical-import.sql.tmp');
  const manifestTemp = resolve(outputDirectory, '.tenant-100-canonical-import-manifest.json.tmp');

  const database = new DatabaseSync(sourceDatabase, { readOnly: true });
  const baseline = baselineDatabase ? new DatabaseSync(baselineDatabase, { readOnly: true }) : null;
  const rowCountSummary: Record<string, number> = {};
  const statements: string[] = [];
  let totalRows = 0;
  try {
    for (const table of allowedTables) {
      const columns = tableColumns(database, table);
      const rows = rowsForTable(database, table, columns);
      rowCountSummary[table] = rows.length;
      totalRows += rows.length;
      if (!baseline) {
        for (const row of rows) statements.push(renderInsert(table, columns, row));
        continue;
      }

      const baselineColumns = tableColumns(baseline, table);
      exactColumnContract(columns, baselineColumns, table);
      const keys = primaryKeyColumns(columns);
      const baselineRows = rowsForTable(baseline, table, baselineColumns);
      const baselineByKey = new Map<string, Record<string, SqliteValue>>();
      for (const row of baselineRows) {
        const key = rowKey(row, keys);
        if (baselineByKey.has(key)) throw new Error(`Duplicate canonical baseline primary key in ${table}`);
        baselineByKey.set(key, row);
      }

      const targetKeys = new Set<string>();
      for (const row of rows) {
        const key = rowKey(row, keys);
        if (targetKeys.has(key)) throw new Error(`Duplicate canonical target primary key in ${table}`);
        targetKeys.add(key);
        const prior = baselineByKey.get(key);
        if (!prior) {
          statements.push(renderInsert(table, columns, row));
          continue;
        }
        const update = renderGuardedUpdate(table, columns, row, prior);
        if (update) statements.push(update);
      }
      for (const key of baselineByKey.keys()) {
        if (!targetKeys.has(key)) throw new Error(`Canonical delta bundle would require a prohibited delete from ${table}`);
      }
    }
  } finally {
    baseline?.close();
    database.close();
  }
  if (statements.length === 0) throw new Error('Tenant-100 canonical bundle would contain no changes');
  const bundleSql = `${statements.join('\n')}\n`;
  const validation = validateCanonicalImportBundleSql(bundleSql, allowedTables);
  if (!validation.valid || validation.statementCount !== statements.length) {
    throw new Error(`Generated canonical bundle is invalid: ${validation.issues.join('; ')}`);
  }
  const bundleSha256 = sha256Bytes(bundleSql);
  const sourceExportSha256 = sha256File(sourceExportPath);
  const manifest: ProductionCanonicalImportManifest = {
    schemaVersion: 1,
    authorizationId: options.authorizationId,
    productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
    tenantIds: [CDB101_CANARY_TENANT_ID],
    allowedTables,
    bundleSha256,
    sourceExportSha256,
    deterministicRunId: options.deterministicRunId,
    secondPassRequired: true,
    rowCountSummary,
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  writeProtectedFile(bundleTemp, bundleSql);
  writeProtectedFile(manifestTemp, manifestJson);
  renameSync(bundleTemp, bundlePath);
  renameSync(manifestTemp, manifestPath);
  chmodSync(bundlePath, 0o600);
  chmodSync(manifestPath, 0o600);

  return withHiddenPaths({
    schemaVersion: 1,
    bundleReady: true,
    tenantId: CDB101_CANARY_TENANT_ID,
    tableCount: allowedTables.length,
    rowCount: totalRows,
    statementCount: statements.length,
    rowCountSummary,
    bundleSha256,
    manifestSha256: sha256Bytes(manifestJson),
    sourceExportSha256,
    deterministicRunId: options.deterministicRunId,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  }, bundlePath, manifestPath);
}

interface CliOptions extends BuildProductionCanonicalBundleOptions {}

export function parseProductionCanonicalBundleArgs(args: string[]): CliOptions {
  const values: Record<string, string> = {};
  const allowed = new Set([
    '--source-database',
    '--source-export',
    '--output-directory',
    '--authorization-id',
    '--deterministic-run-id',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg in values) throw new Error(`Duplicate argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values[arg] = value;
    index += 1;
  }
  for (const key of allowed) {
    if (!values[key]) throw new Error(`${key} is required`);
  }
  return {
    sourceDatabase: values['--source-database'],
    sourceExportPath: values['--source-export'],
    outputDirectory: values['--output-directory'],
    authorizationId: values['--authorization-id'],
    deterministicRunId: values['--deterministic-run-id'],
  };
}

function main(): void {
  try {
    const options = parseProductionCanonicalBundleArgs(process.argv.slice(2));
    const receipt = buildProductionCanonicalBundle(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 canonical bundle build failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

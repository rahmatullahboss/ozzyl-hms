import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SchemaColumnSnapshot {
  cid: number;
  name: string;
  declaredType: string;
  notNull: boolean;
  defaultValue: string | number | null;
  primaryKeyPosition: number;
}

export interface SchemaIndexSnapshot {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface SchemaForeignKeySnapshot {
  id: number;
  sequence: number;
  parentTable: string;
  fromColumn: string;
  toColumn: string | null;
  onUpdate: string;
  onDelete: string;
  match: string;
}

export interface SchemaTableSnapshot {
  name: string;
  definitionSha256: string;
  rowCount: number;
  columns: SchemaColumnSnapshot[];
  indexes: SchemaIndexSnapshot[];
  foreignKeys: SchemaForeignKeySnapshot[];
  checks: string[];
}

export interface SchemaViewSnapshot {
  name: string;
  definitionSha256: string;
}

export interface SchemaTriggerSnapshot {
  name: string;
  tableName: string;
  definitionSha256: string;
}

export interface SchemaForeignKeyViolation {
  table: string;
  rowId: number | string | null;
  parentTable: string;
  foreignKeyId: number;
}

export interface SchemaSnapshotReport {
  createdAtUtc: string;
  databaseFile: string;
  databaseSha256: string;
  databaseSizeBytes: number;
  tableCount: number;
  viewCount: number;
  triggerCount: number;
  totalRowCount: number;
  foreignKeyViolationCount: number;
  tables: SchemaTableSnapshot[];
  views: SchemaViewSnapshot[];
  triggers: SchemaTriggerSnapshot[];
  foreignKeyViolations: SchemaForeignKeyViolation[];
}

export interface SnapshotSqliteSchemaOptions {
  database: string;
  output?: string;
  markdown?: string;
  now?: () => Date;
}

interface SchemaObjectRow {
  name: string;
  sql: string;
}

interface TriggerObjectRow extends SchemaObjectRow {
  table_name: string;
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  name: string | null;
}

interface ForeignKeyListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
  match: string;
}

interface CountRow {
  row_count: number;
}

interface ForeignKeyViolationRow {
  table: string;
  rowid: number | string | null;
  parent: string;
  fkid: number;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parseJsonRows<T>(text: string, label: string): T[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`sqlite3 ${label} output was not an array`);
  }
  return parsed as T[];
}

function runSqliteJson<T>(database: string, sql: string, label: string): T[] {
  const result = spawnSync('sqlite3', ['-json', database, sql], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `sqlite3 ${label} failed (${result.status}): ${String(result.stderr).trim()}`,
    );
  }
  return parseJsonRows<T>(result.stdout, label);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function extractCheckConstraints(sql: string): string[] {
  const checks: string[] = [];
  const upper = sql.toUpperCase();
  let cursor = 0;

  while (cursor < sql.length) {
    const checkIndex = upper.indexOf('CHECK', cursor);
    if (checkIndex < 0) break;
    let openIndex = checkIndex + 5;
    while (/\s/.test(sql[openIndex] ?? '')) openIndex += 1;
    if (sql[openIndex] !== '(') {
      cursor = checkIndex + 5;
      continue;
    }

    let depth = 0;
    let quote: "'" | '"' | '`' | ']' | null = null;
    let closeIndex = -1;
    for (let index = openIndex; index < sql.length; index += 1) {
      const char = sql[index];
      const next = sql[index + 1];
      if (quote) {
        if (quote === ']' && char === ']') quote = null;
        else if (quote !== ']' && char === quote) {
          if (next === quote) index += 1;
          else quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '[') {
        quote = ']';
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }
    if (closeIndex < 0) break;
    checks.push(sql.slice(openIndex + 1, closeIndex).trim());
    cursor = closeIndex + 1;
  }

  return [...new Set(checks)].sort();
}

function readIndexes(database: string, table: string): SchemaIndexSnapshot[] {
  const list = runSqliteJson<IndexListRow>(
    database,
    `SELECT name, "unique", origin, partial FROM pragma_index_list(${quoteSqlString(table)}) ORDER BY name;`,
    `indexes for ${table}`,
  );
  return list.map((index) => {
    const columns = runSqliteJson<IndexInfoRow>(
      database,
      `SELECT seqno, name FROM pragma_index_info(${quoteSqlString(index.name)}) ORDER BY seqno;`,
      `index columns for ${index.name}`,
    )
      .map((row) => row.name)
      .filter((name): name is string => name !== null);
    return {
      name: index.name,
      unique: Number(index.unique) === 1,
      origin: index.origin,
      partial: Number(index.partial) === 1,
      columns,
    };
  });
}

function readTableSnapshot(
  database: string,
  row: SchemaObjectRow,
): SchemaTableSnapshot {
  const columns = runSqliteJson<TableInfoRow>(
    database,
    `SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info(${quoteSqlString(row.name)}) ORDER BY cid;`,
    `columns for ${row.name}`,
  ).map((column) => ({
    cid: Number(column.cid),
    name: column.name,
    declaredType: column.type ?? '',
    notNull: Number(column.notnull) === 1,
    defaultValue: column.dflt_value,
    primaryKeyPosition: Number(column.pk),
  }));

  const foreignKeys = runSqliteJson<ForeignKeyListRow>(
    database,
    `SELECT id, seq, "table", "from", "to", on_update, on_delete, "match" FROM pragma_foreign_key_list(${quoteSqlString(row.name)}) ORDER BY id, seq;`,
    `foreign keys for ${row.name}`,
  ).map((foreignKey) => ({
    id: Number(foreignKey.id),
    sequence: Number(foreignKey.seq),
    parentTable: foreignKey.table,
    fromColumn: foreignKey.from,
    toColumn: foreignKey.to,
    onUpdate: foreignKey.on_update,
    onDelete: foreignKey.on_delete,
    match: foreignKey.match,
  }));

  const countRows = runSqliteJson<CountRow>(
    database,
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(row.name)};`,
    `row count for ${row.name}`,
  );

  return {
    name: row.name,
    definitionSha256: sha256Text(row.sql),
    rowCount: Number(countRows[0]?.row_count ?? 0),
    columns,
    indexes: readIndexes(database, row.name),
    foreignKeys,
    checks: extractCheckConstraints(row.sql),
  };
}

function writeProtected(path: string, content: string): void {
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing evidence: ${path}`);
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function renderMarkdown(report: SchemaSnapshotReport): string {
  const lines = [
    '# SQLite Schema Snapshot',
    '',
    `Generated: ${report.createdAtUtc}`,
    '',
    `Database file: \`${report.databaseFile}\``,
    '',
    `Tables: ${report.tableCount}`,
    '',
    `Views: ${report.viewCount}`,
    '',
    `Triggers: ${report.triggerCount}`,
    '',
    `Aggregate rows: ${report.totalRowCount}`,
    '',
    `Foreign-key violations: ${report.foreignKeyViolationCount}`,
    '',
    '## Tables',
    '',
    '| Table | Rows | Columns | Indexes | FKs | Checks |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.tables.map(
      (table) =>
        `| \`${table.name}\` | ${table.rowCount} | ${table.columns.length} | ${table.indexes.length} | ${table.foreignKeys.length} | ${table.checks.length} |`,
    ),
    '',
    '## Views',
    '',
    ...(report.views.length > 0
      ? report.views.map((view) => `- \`${view.name}\``)
      : ['- None']),
    '',
    '## Triggers',
    '',
    ...(report.triggers.length > 0
      ? report.triggers.map(
          (trigger) => `- \`${trigger.name}\` on \`${trigger.tableName}\``,
        )
      : ['- None']),
    '',
    '## Foreign-key violations',
    '',
    ...(report.foreignKeyViolations.length > 0
      ? report.foreignKeyViolations.map(
          (violation) =>
            `- \`${violation.table}\` row ID \`${String(violation.rowId)}\` → \`${violation.parentTable}\` (FK ${violation.foreignKeyId})`,
        )
      : ['- None']),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function snapshotSqliteSchema(
  options: SnapshotSqliteSchemaOptions,
): SchemaSnapshotReport {
  const database = resolve(options.database);
  if (!existsSync(database)) throw new Error(`SQLite database not found: ${database}`);

  const tableRows = runSqliteJson<SchemaObjectRow>(
    database,
    "SELECT name, sql FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    'table schema',
  );
  const viewRows = runSqliteJson<SchemaObjectRow>(
    database,
    "SELECT name, sql FROM sqlite_schema WHERE type='view' AND sql IS NOT NULL ORDER BY name;",
    'view schema',
  );
  const triggerRows = runSqliteJson<TriggerObjectRow>(
    database,
    "SELECT name, tbl_name AS table_name, sql FROM sqlite_schema WHERE type='trigger' AND sql IS NOT NULL ORDER BY name;",
    'trigger schema',
  );
  const tables = tableRows.map((row) => readTableSnapshot(database, row));
  const foreignKeyViolations = runSqliteJson<ForeignKeyViolationRow>(
    database,
    'PRAGMA foreign_key_check;',
    'foreign key check',
  )
    .map((row) => ({
      table: row.table,
      rowId: row.rowid,
      parentTable: row.parent,
      foreignKeyId: Number(row.fkid),
    }))
    .sort((left, right) =>
      `${left.table}:${String(left.rowId)}:${left.parentTable}:${left.foreignKeyId}`.localeCompare(
        `${right.table}:${String(right.rowId)}:${right.parentTable}:${right.foreignKeyId}`,
      ),
    );

  const report: SchemaSnapshotReport = {
    createdAtUtc: (options.now ?? (() => new Date()))().toISOString(),
    databaseFile: basename(database),
    databaseSha256: sha256File(database),
    databaseSizeBytes: statSync(database).size,
    tableCount: tables.length,
    viewCount: viewRows.length,
    triggerCount: triggerRows.length,
    totalRowCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
    foreignKeyViolationCount: foreignKeyViolations.length,
    tables,
    views: viewRows.map((row) => ({
      name: row.name,
      definitionSha256: sha256Text(row.sql),
    })),
    triggers: triggerRows.map((row) => ({
      name: row.name,
      tableName: row.table_name,
      definitionSha256: sha256Text(row.sql),
    })),
    foreignKeyViolations,
  };

  if (options.output) {
    writeProtected(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.markdown) {
    writeProtected(resolve(options.markdown), renderMarkdown(report));
  }
  return report;
}

interface CliOptions {
  database: string;
  output?: string;
  markdown?: string;
}

function parseCliArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    values.set(key, value);
    index += 1;
  }
  const database = values.get('--database');
  if (!database) {
    throw new Error(
      'Required arguments: --database <sqlite> [--output <json>] [--markdown <md>]',
    );
  }
  return {
    database,
    output: values.get('--output'),
    markdown: values.get('--markdown'),
  };
}

function main(): void {
  try {
    const report = snapshotSqliteSchema(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify(
        {
          databaseFile: report.databaseFile,
          tableCount: report.tableCount,
          viewCount: report.viewCount,
          triggerCount: report.triggerCount,
          totalRowCount: report.totalRowCount,
          foreignKeyViolationCount: report.foreignKeyViolationCount,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Schema snapshot failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

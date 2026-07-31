import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ReconciliationSideSummary {
  file: string;
  sha256: string;
  sizeBytes: number;
  tableCount: number;
  totalRowCount: number;
  tableRows: Record<string, number>;
}

export interface RowCountMismatch {
  table: string;
  sourceRows: number;
  cloneRows: number;
}

export interface CloneReconciliationReport {
  createdAtUtc: string;
  exactMatch: boolean;
  source: ReconciliationSideSummary;
  clone: ReconciliationSideSummary;
  missingFromClone: string[];
  extraInClone: string[];
  rowCountMismatches: RowCountMismatch[];
}

export interface ReconcileSqlExportsOptions {
  source: string;
  clone: string;
  output: string;
  now?: () => Date;
}

interface TableNameRow {
  name: string;
}

interface CountRow {
  table_name: string;
  row_count: number;
}

function runSqlite(args: string[], input?: Buffer): string {
  const result = spawnSync('sqlite3', args, {
    input,
    encoding: input ? undefined : 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '');
    throw new Error(`sqlite3 failed (${result.status}): ${stderr.trim()}`);
  }

  return Buffer.isBuffer(result.stdout)
    ? result.stdout.toString('utf8')
    : String(result.stdout ?? '');
}

function loadExportIntoSqlite(sqlPath: string, sqlitePath: string): void {
  const sql = readFileSync(sqlPath);
  runSqlite([sqlitePath], sql);
}

function parseJsonRows<T>(text: string): T[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('sqlite3 JSON output was not an array');
  }
  return parsed as T[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function collectTableRows(sqlitePath: string): Record<string, number> {
  const tables = parseJsonRows<TableNameRow>(
    runSqlite([
      '-json',
      sqlitePath,
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    ]),
  ).map((row) => row.name);

  const counts: Record<string, number> = {};
  const chunkSize = 200;
  for (let offset = 0; offset < tables.length; offset += chunkSize) {
    const chunk = tables.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const query = chunk
      .map(
        (table) =>
          `SELECT ${quoteString(table)} AS table_name, COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`,
      )
      .join(' UNION ALL ');
    const rows = parseJsonRows<CountRow>(
      runSqlite(['-json', sqlitePath, `${query};`]),
    );
    for (const row of rows) {
      counts[row.table_name] = Number(row.row_count);
    }
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function summarizeExport(
  sqlPath: string,
  sqlitePath: string,
): ReconciliationSideSummary {
  loadExportIntoSqlite(sqlPath, sqlitePath);
  const tableRows = collectTableRows(sqlitePath);
  return {
    file: basename(sqlPath),
    sha256: sha256File(sqlPath),
    sizeBytes: statSync(sqlPath).size,
    tableCount: Object.keys(tableRows).length,
    totalRowCount: Object.values(tableRows).reduce(
      (sum, rowCount) => sum + rowCount,
      0,
    ),
    tableRows,
  };
}

export function reconcileSqlExports(
  options: ReconcileSqlExportsOptions,
): CloneReconciliationReport {
  const source = resolve(options.source);
  const clone = resolve(options.clone);
  const output = resolve(options.output);

  if (!existsSync(source)) throw new Error(`Source export not found: ${source}`);
  if (!existsSync(clone)) throw new Error(`Clone export not found: ${clone}`);
  if (existsSync(output)) {
    throw new Error(`Refusing to overwrite reconciliation report: ${output}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'cdb-011-reconcile-'));
  try {
    const sourceSummary = summarizeExport(source, join(tempRoot, 'source.sqlite'));
    const cloneSummary = summarizeExport(clone, join(tempRoot, 'clone.sqlite'));
    const sourceTables = Object.keys(sourceSummary.tableRows);
    const cloneTables = Object.keys(cloneSummary.tableRows);
    const cloneTableSet = new Set(cloneTables);
    const sourceTableSet = new Set(sourceTables);

    const missingFromClone = sourceTables.filter(
      (table) => !cloneTableSet.has(table),
    );
    const extraInClone = cloneTables.filter(
      (table) => !sourceTableSet.has(table),
    );
    const rowCountMismatches = sourceTables
      .filter((table) => cloneTableSet.has(table))
      .filter(
        (table) =>
          sourceSummary.tableRows[table] !== cloneSummary.tableRows[table],
      )
      .map((table) => ({
        table,
        sourceRows: sourceSummary.tableRows[table],
        cloneRows: cloneSummary.tableRows[table],
      }));

    const report: CloneReconciliationReport = {
      createdAtUtc: (options.now ?? (() => new Date()))().toISOString(),
      exactMatch:
        missingFromClone.length === 0 &&
        extraInClone.length === 0 &&
        rowCountMismatches.length === 0,
      source: sourceSummary,
      clone: cloneSummary,
      missingFromClone,
      extraInClone,
      rowCountMismatches,
    };

    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return report;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseCliArgs(args: string[]): ReconcileSqlExportsOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${token} requires a value`);
    }
    values.set(token, value);
    index += 1;
  }

  const source = values.get('--source');
  const clone = values.get('--clone');
  const output = values.get('--output');
  if (!source || !clone || !output) {
    throw new Error('Required arguments: --source <sql> --clone <sql> --output <json>');
  }
  return { source, clone, output };
}

function main(): void {
  try {
    const report = reconcileSqlExports(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify({
        exactMatch: report.exactMatch,
        sourceTableCount: report.source.tableCount,
        cloneTableCount: report.clone.tableCount,
        sourceTotalRowCount: report.source.totalRowCount,
        cloneTotalRowCount: report.clone.totalRowCount,
        missingTableCount: report.missingFromClone.length,
        extraTableCount: report.extraInClone.length,
        rowCountMismatchCount: report.rowCountMismatches.length,
      }, null, 2)}\n`,
    );
    if (!report.exactMatch) process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Clone reconciliation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

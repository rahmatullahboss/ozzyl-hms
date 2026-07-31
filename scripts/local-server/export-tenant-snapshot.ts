import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type JsonRow = Record<string, unknown>;

type TableColumn = {
  name: string;
};

type ForeignKeyRow = {
  table?: string;
};

type Args = {
  tenantId: string;
  output: string;
  includeTables?: string;
  targetSchema?: string;
  noDelete: boolean;
  database: string;
};

const DEFAULT_DATABASE = 'hms-super-admin-production-apac';

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Partial<Args> = { database: DEFAULT_DATABASE, noDelete: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--tenant-id' && next) {
      parsed.tenantId = next;
      i += 1;
    } else if (arg === '--output' && next) {
      parsed.output = next;
      i += 1;
    } else if (arg === '--include-tables' && next) {
      parsed.includeTables = next;
      i += 1;
    } else if (arg === '--target-schema' && next) {
      parsed.targetSchema = next;
      i += 1;
    } else if (arg === '--database' && next) {
      parsed.database = next;
      i += 1;
    } else if (arg === '--no-delete') {
      parsed.noDelete = true;
    }
  }

  if (!parsed.tenantId || !parsed.output || !parsed.database) {
    throw new Error(
      'Usage: tsx scripts/local-server/export-tenant-snapshot.ts --tenant-id <id> --output <snapshot.sql> [--include-tables tables.txt]',
    );
  }

  return parsed as Args;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') return quoteSqlString(value);
  return quoteSqlString(JSON.stringify(value));
}

function parseWranglerJson(stdout: string): Array<{ results?: JsonRow[]; success?: boolean }> {
  const candidateStarts = [...stdout.matchAll(/(?:^|\n)\s*\[/g)].map((match) => {
    const index = match.index ?? 0;
    return stdout[index] === '\n' ? index + 1 : index;
  });

  for (const start of candidateStarts) {
    for (let end = stdout.lastIndexOf(']'); end > start; end = stdout.lastIndexOf(']', end - 1)) {
      try {
        const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{ results?: JsonRow[]; success?: boolean }>;
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
          return parsed;
        }
      } catch {
        // Wrangler may print warnings or update notices around the JSON payload.
      }
    }
  }

  throw new Error(`Could not parse Wrangler JSON output. Output ended with: ${stdout.slice(-500)}`);
}

function runWrangler(database: string, sql: string): JsonRow[] {
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'wrangler');
  const command = existsSync(localBin) ? localBin : 'pnpm';
  const args = existsSync(localBin)
    ? ['d1', 'execute', database, '--remote', '--json', '--command', sql]
    : ['exec', 'wrangler', 'd1', 'execute', database, '--remote', '--json', '--command', sql];
  const result = spawnSync(command, args, { encoding: 'utf8' });

  if (result.status !== 0) {
    const context = sql.replace(/\s+/g, ' ').slice(0, 240);
    throw new Error(`Wrangler exited with ${result.status} while running: ${context}\n${result.stderr || 'No stderr output'}`);
  }

  const parsed = parseWranglerJson(result.stdout);
  const first = parsed[0];
  if (!first?.success) {
    throw new Error(`Wrangler command failed: ${sql}`);
  }
  return first.results ?? [];
}

function readIncludeTables(filePath: string | undefined): Set<string> | null {
  if (!filePath) return null;
  const content = readFileSync(filePath, 'utf8');
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function readTargetSchema(filePath: string | undefined): Map<string, Set<string>> | null {
  if (!filePath) return null;
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string[]>;
  return new Map(
    Object.entries(parsed).map(([tableName, columns]) => [tableName, new Set(columns)]),
  );
}

function buildWhereClause(tableName: string, columns: TableColumn[], tenantId: string): string | null {
  const names = new Set(columns.map((column) => column.name));
  const tenantLiteral = quoteSqlString(tenantId);

  if (tableName === 'tenants' && names.has('id')) {
    return `CAST(${quoteIdentifier('id')} AS TEXT) = ${tenantLiteral}`;
  }

  if (names.has('tenant_id')) {
    return `CAST(${quoteIdentifier('tenant_id')} AS TEXT) = ${tenantLiteral}`;
  }

  if (tableName === 'global_patient_identity' && names.has('uhid')) {
    const related = [
      `${quoteIdentifier('uhid')} IN (SELECT DISTINCT ${quoteIdentifier('uhid')} FROM ${quoteIdentifier('patient_health_links')} WHERE CAST(${quoteIdentifier('tenant_id')} AS TEXT) = ${tenantLiteral} AND ${quoteIdentifier('uhid')} IS NOT NULL)`,
    ];
    if (names.has('created_tenant_id')) {
      related.push(`CAST(${quoteIdentifier('created_tenant_id')} AS TEXT) = ${tenantLiteral}`);
    }
    return related.join(' OR ');
  }

  return null;
}

function normalizeSnapshotValue(tableName: string, columnName: string, value: unknown): unknown {
  if (tableName === 'appointments' && columnName === 'status' && value === 'checked_in') {
    return 'scheduled';
  }
  return value;
}

function insertStatement(tableName: string, columns: string[], row: JsonRow): string {
  const columnSql = columns.map(quoteIdentifier).join(', ');
  const valueSql = columns
    .map((column) => sqlValue(normalizeSnapshotValue(tableName, column, row[column])))
    .join(', ');
  return `INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES (${valueSql});`;
}

function deleteStatement(tableName: string, whereClause: string): string {
  return `DELETE FROM ${quoteIdentifier(tableName)} WHERE ${whereClause};`;
}

function sortTablesForImport(tableNames: string[]): string[] {
  const priority = new Map(
    [
      'tenants',
      'settings',
      'website_config',
      'users',
      'doctors',
      'patients',
      'billing_service_departments',
      'billing_service_items',
      'lab_test_categories',
      'lab_test_catalog',
      'radiology_imaging_types',
      'radiology_imaging_items',
      'beds',
      'admissions',
      'visits',
      'appointments',
      'serials',
      'sequence_counters',
      'billing_counters',
      'chart_of_accounts',
      'bills',
      'invoice_items',
      'payments',
      'billing_deposits',
      'billing_provisional_items',
      'ipd_doctor_rounds',
      'income',
      'expenses',
      'fiscal_years',
      'voucher_types',
      'accounting_vouchers',
      'accounting_posting_events',
      'accounting_account_mappings',
      'accounting_journal_lines',
      'invitations',
      'audit_logs',
      'subscription_history',
      'global_patient_identity',
    ].map((tableName, index) => [tableName, index]),
  );

  return [...tableNames].sort((a, b) => {
    const aPriority = priority.get(a) ?? 10_000;
    const bPriority = priority.get(b) ?? 10_000;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.localeCompare(b);
  });
}

function sortTablesByForeignKeys(database: string, tableNames: string[]): string[] {
  const baseOrder = sortTablesForImport(tableNames);
  const basePosition = new Map(baseOrder.map((tableName, index) => [tableName, index]));
  const tableSet = new Set(baseOrder);
  const dependencies = new Map<string, Set<string>>();

  for (const tableName of baseOrder) {
    const rows = runWrangler(database, `PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`) as ForeignKeyRow[];
    dependencies.set(
      tableName,
      new Set(rows.map((row) => row.table).filter((parent): parent is string => Boolean(parent) && tableSet.has(parent))),
    );
  }

  const remaining = new Set(baseOrder);
  const sorted: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((tableName) => [...(dependencies.get(tableName) ?? [])].every((parent) => !remaining.has(parent)))
      .sort((a, b) => (basePosition.get(a) ?? 0) - (basePosition.get(b) ?? 0));

    if (ready.length === 0) {
      sorted.push(...[...remaining].sort((a, b) => (basePosition.get(a) ?? 0) - (basePosition.get(b) ?? 0)));
      break;
    }

    for (const tableName of ready) {
      sorted.push(tableName);
      remaining.delete(tableName);
    }
  }

  return sorted;
}

async function main() {
  const args = parseArgs();
  const includeTables = readIncludeTables(args.includeTables);
  const targetSchema = readTargetSchema(args.targetSchema);
  const tenantId = args.tenantId;
  const outputPath = path.resolve(args.output);

  const tableRows = runWrangler(
    args.database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const tableNames = sortTablesByForeignKeys(args.database, tableRows
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('_cf_') && name !== 'd1_migrations')
    .filter((name) => !includeTables || includeTables.has(name)));

  const snapshot: string[] = [
    '-- HMS tenant-scoped local-server snapshot',
    `-- tenant_id: ${tenantId}`,
    `-- generated_at: ${new Date().toISOString()}`,
    '-- Contains sensitive tenant data. Keep this file encrypted or chmod 600.',
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
  ];

  const counts: Array<{ table: string; rows: number }> = [];
  for (const tableName of tableNames) {
    console.error(`Exporting table: ${tableName}`);
    const columns = runWrangler(args.database, `PRAGMA table_info(${quoteIdentifier(tableName)})`) as TableColumn[];
    if (columns.length === 0) continue;

    const whereClause = buildWhereClause(tableName, columns, tenantId);
    if (!whereClause) continue;

    const rows = runWrangler(args.database, `SELECT * FROM ${quoteIdentifier(tableName)} WHERE ${whereClause}`);
    if (rows.length === 0) continue;

    const sourceColumnNames = columns.map((column) => column.name);
    const targetColumns = targetSchema?.get(tableName);
    const columnNames = targetColumns
      ? sourceColumnNames.filter((column) => targetColumns.has(column))
      : sourceColumnNames;
    if (columnNames.length === 0) continue;

    snapshot.push('');
    snapshot.push(`-- ${tableName}: ${rows.length} row(s)`);
    if (!args.noDelete && tableName !== 'global_patient_identity') {
      snapshot.push(deleteStatement(tableName, whereClause));
    }
    for (const row of rows) {
      snapshot.push(insertStatement(tableName, columnNames, row));
    }
    counts.push({ table: tableName, rows: rows.length });
  }

  snapshot.push('');
  snapshot.push('COMMIT;');
  snapshot.push('PRAGMA foreign_keys=ON;');
  snapshot.push('');

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, snapshot.join('\n'), { mode: 0o600 });

  const totalRows = counts.reduce((sum, row) => sum + row.rows, 0);
  console.log(`Snapshot written: ${outputPath}`);
  console.log(`Tables exported: ${counts.length}`);
  console.log(`Rows exported: ${totalRows}`);
  for (const count of counts) {
    console.log(`${count.table}: ${count.rows}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

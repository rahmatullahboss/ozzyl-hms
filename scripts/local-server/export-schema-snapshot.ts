import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type SchemaRow = {
  type: 'table' | 'index' | 'trigger' | 'view';
  name: string;
  tbl_name: string;
  sql: string | null;
};

type Args = {
  output: string;
  database: string;
};

const DEFAULT_DATABASE = 'hms-super-admin-production-apac';

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Partial<Args> = { database: DEFAULT_DATABASE };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--output' && next) {
      parsed.output = next;
      i += 1;
    } else if (arg === '--database' && next) {
      parsed.database = next;
      i += 1;
    }
  }

  if (!parsed.output || !parsed.database) {
    throw new Error('Usage: tsx scripts/local-server/export-schema-snapshot.ts --output <schema.sql>');
  }

  return parsed as Args;
}

function parseWranglerJson(stdout: string): Array<{ results?: SchemaRow[]; success?: boolean }> {
  const candidateStarts = [...stdout.matchAll(/(?:^|\n)\s*\[/g)].map((match) => {
    const index = match.index ?? 0;
    return stdout[index] === '\n' ? index + 1 : index;
  });

  for (const start of candidateStarts) {
    for (let end = stdout.lastIndexOf(']'); end > start; end = stdout.lastIndexOf(']', end - 1)) {
      try {
        const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{ results?: SchemaRow[]; success?: boolean }>;
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

function runWrangler(database: string, sql: string): SchemaRow[] {
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'wrangler');
  const command = existsSync(localBin) ? localBin : 'pnpm';
  const args = existsSync(localBin)
    ? ['d1', 'execute', database, '--remote', '--json', '--command', sql]
    : ['exec', 'wrangler', 'd1', 'execute', database, '--remote', '--json', '--command', sql];
  const result = spawnSync(command, args, { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`Wrangler exited with ${result.status}\n${result.stderr || 'No stderr output'}`);
  }

  const parsed = parseWranglerJson(result.stdout);
  const first = parsed[0];
  if (!first?.success) {
    throw new Error('Wrangler schema query failed');
  }
  return first.results ?? [];
}

function shouldSkip(row: SchemaRow): boolean {
  const names = [row.name, row.tbl_name];
  return names.some((name) => name.startsWith('sqlite_') || name.startsWith('_cf_') || name === 'd1_migrations');
}

function withIfNotExists(sql: string): string {
  return sql
    .replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE INDEX\s+/i, 'CREATE INDEX IF NOT EXISTS ')
    .replace(/^CREATE UNIQUE INDEX\s+/i, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/^CREATE VIEW\s+/i, 'CREATE VIEW IF NOT EXISTS ')
    .replace(/^CREATE TRIGGER\s+/i, 'CREATE TRIGGER IF NOT EXISTS ');
}

async function main() {
  const args = parseArgs();
  const outputPath = path.resolve(args.output);
  const rows = runWrangler(
    args.database,
    [
      'SELECT type, name, tbl_name, sql FROM sqlite_master',
      "WHERE type IN ('table','index','trigger','view')",
      'AND sql IS NOT NULL',
      "AND name NOT LIKE 'sqlite_%'",
      'ORDER BY CASE type WHEN "table" THEN 0 WHEN "view" THEN 1 WHEN "index" THEN 2 ELSE 3 END, name',
    ].join(' '),
  ).filter((row) => !shouldSkip(row));

  const statements = rows
    .map((row) => row.sql?.trim())
    .filter((sql): sql is string => Boolean(sql))
    .map(withIfNotExists);

  const snapshot = [
    '-- HMS production schema snapshot for local-server bootstrap',
    `-- generated_at: ${new Date().toISOString()}`,
    '-- Contains no tenant rows, but should still be treated as deployment-sensitive.',
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
    ...statements.map((sql) => `${sql};`),
    'COMMIT;',
    'PRAGMA foreign_keys=ON;',
    '',
  ].join('\n\n');

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, snapshot, { mode: 0o600 });

  console.log(`Schema snapshot written: ${outputPath}`);
  console.log(`Statements exported: ${statements.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

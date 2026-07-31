import { spawnSync } from 'node:child_process';
import { CDB_V1_071_DATABASE_NAME } from './cdb-v1-071-production-release-authorization';

export interface CdbV1071WranglerResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CdbV1071WranglerRunner = (args: string[]) => CdbV1071WranglerResult;

interface D1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: {
    changed_db?: unknown;
    changes?: unknown;
    rows_written?: unknown;
    last_row_id?: unknown;
  };
}

export interface CdbV1071D1RunResult {
  success: boolean;
  meta: {
    changes: number;
    rows_written: number;
    last_row_id?: number;
  };
}

export interface CdbV1071D1PreparedStatement {
  bind(...values: unknown[]): CdbV1071D1PreparedStatement;
  run(): Promise<CdbV1071D1RunResult>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface CdbV1071WranglerD1Database {
  prepare(sql: string): CdbV1071D1PreparedStatement;
  batch(statements: CdbV1071D1PreparedStatement[]): Promise<CdbV1071D1RunResult[]>;
}

export function toCdbV1071SqlLiteral(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Unsupported SQL binding value');
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  throw new TypeError('Unsupported SQL binding value');
}

export function renderCdbV1071BoundSql(sql: string, values: readonly unknown[]): string {
  let result = '';
  let valueIndex = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "'" && !doubleQuoted) {
      result += char;
      if (singleQuoted && next === "'") {
        result += next;
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }
    if (char === '"' && !singleQuoted) {
      result += char;
      if (doubleQuoted && next === '"') {
        result += next;
        index += 1;
      } else {
        doubleQuoted = !doubleQuoted;
      }
      continue;
    }
    if (char === '?' && !singleQuoted && !doubleQuoted) {
      if (valueIndex >= values.length) throw new Error('SQL placeholder count does not match bound values');
      result += toCdbV1071SqlLiteral(values[valueIndex]);
      valueIndex += 1;
      continue;
    }
    result += char;
  }
  if (valueIndex !== values.length) throw new Error('SQL placeholder count does not match bound values');
  return result;
}

function defaultRunner(args: string[]): CdbV1071WranglerResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseEnvelopes(text: string): D1Envelope[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('Wrangler D1 output did not contain a JSON array');
  const value = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!Array.isArray(value) || value.length === 0) throw new Error('Wrangler D1 output was empty');
  const envelopes = value as D1Envelope[];
  if (envelopes.some((entry) => entry.success !== true)) {
    throw new Error('Wrangler D1 output contained an unsuccessful envelope');
  }
  return envelopes;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error('Wrangler D1 metadata was invalid');
  return parsed;
}

function runCommand(
  runner: CdbV1071WranglerRunner,
  sql: string,
  write: boolean,
): D1Envelope[] {
  const args = [
    'd1', 'execute', CDB_V1_071_DATABASE_NAME,
    '--env', 'production', '--remote', '--json',
  ];
  if (write) args.push('--yes');
  args.push('--command', sql);
  const result = runner(args);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Wrangler D1 command failed').trim());
  }
  const envelopes = parseEnvelopes(result.stdout);
  if (!write && envelopes.some((entry) => entry.meta?.changed_db !== false || numeric(entry.meta?.rows_written) !== 0)) {
    throw new Error('Read-only D1 command reported mutation');
  }
  return envelopes;
}

function resultFromEnvelopes(envelopes: D1Envelope[]): CdbV1071D1RunResult {
  const lastRowIds = envelopes
    .map((entry) => Number(entry.meta?.last_row_id))
    .filter((value) => Number.isSafeInteger(value));
  return {
    success: true,
    meta: {
      changes: envelopes.reduce((sum, entry) => sum + numeric(entry.meta?.changes), 0),
      rows_written: envelopes.reduce((sum, entry) => sum + numeric(entry.meta?.rows_written), 0),
      ...(lastRowIds.length > 0 ? { last_row_id: lastRowIds[lastRowIds.length - 1] } : {}),
    },
  };
}

class PreparedStatement implements CdbV1071D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly runner: CdbV1071WranglerRunner,
  ) {}

  bind(...values: unknown[]): CdbV1071D1PreparedStatement {
    this.values = [...values];
    return this;
  }

  renderedSql(): string {
    return renderCdbV1071BoundSql(this.sql, this.values);
  }

  async run(): Promise<CdbV1071D1RunResult> {
    return resultFromEnvelopes(runCommand(this.runner, this.renderedSql(), true));
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const envelopes = runCommand(this.runner, this.renderedSql(), false);
    return { results: envelopes.flatMap((entry) => entry.results ?? []) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = (await this.all<T>()).results;
    return rows[0] ?? null;
  }
}

function statementSql(statement: CdbV1071D1PreparedStatement): string {
  if (!(statement instanceof PreparedStatement)) {
    throw new TypeError('Batch statement was not created by the CDB-V1-071 adapter');
  }
  return statement.renderedSql().trim().replace(/;+$/u, '');
}

export function createCdbV1071WranglerD1Database(
  runner: CdbV1071WranglerRunner = defaultRunner,
): CdbV1071WranglerD1Database {
  return {
    prepare(sql: string) {
      if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQL must be non-empty');
      return new PreparedStatement(sql, runner);
    },
    async batch(statements: CdbV1071D1PreparedStatement[]) {
      if (!Array.isArray(statements) || statements.length === 0) return [];
      const sql = statements.map(statementSql).join(';\n').concat(';');
      const result = resultFromEnvelopes(runCommand(runner, sql, true));
      return statements.map(() => result);
    },
  };
}

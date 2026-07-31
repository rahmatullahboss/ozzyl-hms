import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types';
import { DatabaseSync } from 'node:sqlite';

interface ExecutableStatement {
  sql: string;
  binds: unknown[];
  execute(): D1Result<Record<string, unknown>>;
}

export interface SqliteD1Harness {
  db: D1Database;
  sqlite: DatabaseSync;
  batchCalls: Array<Array<{ sql: string; binds: unknown[] }>>;
  beforeBatch?: () => void;
}

function normalizeValue(value: unknown): string | number | bigint | Uint8Array | null {
  if (value === undefined) return null;
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'bigint'
    || value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

function isReadQuery(sql: string): boolean {
  const normalized = sql.trimStart().replace(/^\/\*[\s\S]*?\*\//, '').trimStart().toUpperCase();
  return normalized.startsWith('SELECT') || normalized.startsWith('WITH') || normalized.startsWith('PRAGMA');
}

export function createSqliteD1Harness(): SqliteD1Harness {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const batchCalls: Array<Array<{ sql: string; binds: unknown[] }>> = [];

  const harness = {} as SqliteD1Harness;

  function prepare(sql: string): D1PreparedStatement {
    let binds: unknown[] = [];

    const executable: ExecutableStatement = {
      sql,
      binds,
      execute() {
        const statement = sqlite.prepare(sql);
        const normalized = binds.map(normalizeValue);
        if (isReadQuery(sql)) {
          const results = statement.all(...normalized) as Array<Record<string, unknown>>;
          return {
            success: true,
            results,
            meta: { changes: 0 } as D1Result['meta'],
          };
        }

        const result = statement.run(...normalized);
        return {
          success: true,
          results: [],
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          } as D1Result['meta'],
        };
      },
    };

    const prepared = {
      bind(...values: unknown[]) {
        binds = values;
        executable.binds = values;
        return prepared;
      },
      async all<T = Record<string, unknown>>() {
        return executable.execute() as D1Result<T>;
      },
      async first<T = Record<string, unknown>>(column?: string) {
        const statement = sqlite.prepare(sql);
        const row = statement.get(...binds.map(normalizeValue)) as Record<string, unknown> | undefined;
        if (!row) return null;
        return (column ? row[column] : row) as T;
      },
      async run<T = Record<string, unknown>>() {
        return executable.execute() as D1Result<T>;
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        const statement = sqlite.prepare(sql);
        return statement.all(...binds.map(normalizeValue)) as T[];
      },
      sql,
      binds,
      execute: executable.execute,
    } as unknown as D1PreparedStatement & ExecutableStatement;

    return prepared;
  }

  const db = {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      harness.beforeBatch?.();
      const executableStatements = statements as Array<D1PreparedStatement & ExecutableStatement>;
      batchCalls.push(executableStatements.map((statement) => ({
        sql: statement.sql,
        binds: [...statement.binds],
      })));

      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const results = executableStatements.map((statement) => statement.execute());
        sqlite.exec('COMMIT;');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;

  harness.db = db;
  harness.sqlite = sqlite;
  harness.batchCalls = batchCalls;
  return harness;
}

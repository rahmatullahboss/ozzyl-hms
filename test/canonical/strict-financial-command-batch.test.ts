import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
    return this.sqlite.prepare(this.sql).run(...this.params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { db: CanonicalBatchDatabase; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );

    CREATE TABLE canonical_test_entities (
      tenant_id TEXT NOT NULL,
      entity_public_id TEXT NOT NULL,
      UNIQUE (tenant_id, entity_public_id)
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results: unknown[] = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  return { db, sqlite };
}

function canonicalCommand(db: CanonicalBatchDatabase, duplicateCanonical = false) {
  const statements: CanonicalPreparedStatement[] = [
    db.prepare('INSERT INTO canonical_test_entities (tenant_id, entity_public_id) VALUES (?, ?)')
      .bind('100', 'invoice-1'),
  ];
  if (duplicateCanonical) {
    statements.push(
      db.prepare('INSERT INTO canonical_test_entities (tenant_id, entity_public_id) VALUES (?, ?)')
        .bind('100', 'invoice-1'),
    );
  }

  return {
    tenantId: '100',
    commandName: 'canonical.test.strict-financial',
    idempotencyKey: 'strict-financial-1',
    request: { invoiceId: 'invoice-1' },
    statements,
    result: { invoiceId: 'invoice-1' },
    event: {
      eventPublicId: 'event-strict-financial-1',
      aggregateType: 'invoice',
      aggregatePublicId: 'invoice-1',
      eventType: 'canonical.invoice.issued',
      occurredAtUtc: '2026-07-18T06:00:00.000Z',
      businessDate: '2026-07-18',
      payload: { invoiceId: 'invoice-1' },
    },
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count);
}

describe('strict financial canonical batch', () => {
  it('commits authoritative legacy and canonical statements in one transaction', async () => {
    const { db, sqlite } = harness();
    try {
      await runCanonicalBatch(db, {
        ...canonicalCommand(db),
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
            .bind('100', 'bill-1'),
        ],
      });

      expect(count(sqlite, 'legacy_financial')).toBe(1);
      expect(count(sqlite, 'canonical_test_entities')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back authoritative legacy state when canonical state fails', async () => {
    const { db, sqlite } = harness();
    try {
      await expect(runCanonicalBatch(db, {
        ...canonicalCommand(db, true),
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
            .bind('100', 'bill-rollback'),
        ],
      })).rejects.toThrow(/UNIQUE constraint failed/);

      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_test_entities')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

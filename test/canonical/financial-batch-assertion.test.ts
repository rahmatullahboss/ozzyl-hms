import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  isFinancialBatchAssertionError,
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../src/lib/canonical/financial-batch-assertion';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0532_canonical_financial_batch_assertions.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE target_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('canonical financial batch assertions', () => {
  it('accepts the exact preceding row count and removes transient assertion evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await db.batch([
        db.prepare(`INSERT INTO target_rows (value) VALUES ('created')`),
        prepareFinancialBatchAssertion(db, {
          tenantId: 'tenant-a',
          operationKey: 'admission:ADM-1',
          stepKey: 'admission_insert',
          expectedChanges: 1,
        }),
        prepareClearFinancialBatchAssertions(db, 'tenant-a', 'admission:ADM-1'),
      ]);

      expect(count(sqlite, 'target_rows')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the whole transaction when the preceding row count is unexpected', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(db.batch([
        db.prepare(`INSERT INTO target_rows (value) VALUES ('must-rollback')`),
        prepareFinancialBatchAssertion(db, {
          tenantId: 'tenant-a',
          operationKey: 'admission:ADM-2',
          stepKey: 'admission_insert',
          expectedChanges: 2,
        }),
      ])).rejects.toThrow();

      expect(count(sqlite, 'target_rows')).toBe(0);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects invalid assertion identities and expected row counts before preparing SQL', () => {
    const { sqlite, db } = harness();
    try {
      expect(() => prepareFinancialBatchAssertion(db, {
        tenantId: '',
        operationKey: 'operation',
        stepKey: 'step',
        expectedChanges: 1,
      })).toThrow(/tenantId/i);
      expect(() => prepareFinancialBatchAssertion(db, {
        tenantId: 'tenant-a',
        operationKey: ' operation ',
        stepKey: 'step',
        expectedChanges: 1,
      })).toThrow(/operationKey/i);
      expect(() => prepareFinancialBatchAssertion(db, {
        tenantId: 'tenant-a',
        operationKey: 'operation',
        stepKey: 'step',
        expectedChanges: -1,
      })).toThrow(/expectedChanges/i);
      expect(() => prepareFinancialBatchAssertion(db, {
        tenantId: 'tenant-a',
        operationKey: 'operation',
        stepKey: 'step',
        expectedChanges: 1.5,
      })).toThrow(/expectedChanges/i);
    } finally {
      sqlite.close();
    }
  });

  it('recognizes assertion failures through a bounded nested cause chain', () => {
    const leaf = new Error('CHECK constraint failed: canonical_financial_batch_assertions');
    const wrapped = new Error('Canonical strict financial write failed', {
      cause: new Error('D1 batch failed', { cause: leaf }),
    });

    expect(isFinancialBatchAssertionError(wrapped)).toBe(true);
    expect(isFinancialBatchAssertionError(new Error('unrelated failure'))).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { prepareIpdDischargeLegacyStatements } from '../../src/lib/canonical/ipd-discharge-billing-finalization';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values as SqlValue[]);
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0532_canonical_financial_batch_assertions.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT NOT NULL,
      UNIQUE (tenant_id, invoice_no)
    );
    CREATE TABLE legacy_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL
    );
    INSERT INTO legacy_items VALUES (1,'100','provisional',50000);
  `);
  const db = { prepare(sql: string) { return new Statement(sqlite, sql); } };
  async function batch(statements: readonly CanonicalPreparedStatement[]) {
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
  }
  return { sqlite, db, batch };
}

function strictStatements(
  statements: readonly CanonicalPreparedStatement[],
): readonly CanonicalPreparedStatement[] {
  const bundled = statements as readonly CanonicalPreparedStatement[] & {
    strictAuthoritativeStatements?:
      | readonly CanonicalPreparedStatement[]
      | (() => readonly CanonicalPreparedStatement[]);
  };
  if (!bundled.strictAuthoritativeStatements) throw new Error('Strict IPD statements were not bundled');
  return typeof bundled.strictAuthoritativeStatements === 'function'
    ? bundled.strictAuthoritativeStatements()
    : bundled.strictAuthoritativeStatements;
}

describe('prepareIpdDischargeLegacyStatements', () => {
  it('guards critical statements, preserves original result indexes, and clears assertions', async () => {
    const { sqlite, db, batch } = harness();
    try {
      const source = [
        db.prepare("INSERT INTO legacy_bills (tenant_id,invoice_no) VALUES ('100','INV-1')"),
        db.prepare("UPDATE legacy_items SET status='finalized' WHERE id=1 AND tenant_id='100' AND status='provisional' AND amount=50000"),
        db.prepare("SELECT 1"),
      ];
      const prepared = prepareIpdDischargeLegacyStatements(db, {
        tenantId: '100',
        operationKey: 'ipd-discharge:INV-1',
        statements: source,
        critical: [
          { statementIndex: 0, stepKey: 'bill-insert', expectedChanges: 1 },
          { statementIndex: 1, stepKey: 'item-finalized', expectedChanges: 1 },
        ],
      });
      const results = await batch(strictStatements(prepared.statements));
      expect(results[0]).toMatchObject({ meta: { last_row_id: 1 } });
      expect(prepared.resultIndexByOriginalIndex).toEqual([0, 1, 2]);
      expect(sqlite.prepare('SELECT status FROM legacy_items WHERE id=1').get()).toEqual({ status: 'finalized' });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_financial_batch_assertions').get())
        .toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });

  it('rolls back the whole batch when a critical stale snapshot changes zero rows', async () => {
    const { sqlite, db, batch } = harness();
    try {
      sqlite.prepare("UPDATE legacy_items SET amount=51000 WHERE id=1").run();
      const prepared = prepareIpdDischargeLegacyStatements(db, {
        tenantId: '100',
        operationKey: 'ipd-discharge:INV-2',
        statements: [
          db.prepare("INSERT INTO legacy_bills (tenant_id,invoice_no) VALUES ('100','INV-2')"),
          db.prepare("UPDATE legacy_items SET status='finalized' WHERE id=1 AND tenant_id='100' AND status='provisional' AND amount=50000"),
        ],
        critical: [
          { statementIndex: 0, stepKey: 'bill-insert', expectedChanges: 1 },
          { statementIndex: 1, stepKey: 'item-finalized', expectedChanges: 1 },
        ],
      });
      await expect(batch(strictStatements(prepared.statements))).rejects.toThrow(/canonical_financial_batch_assertions|assertion_value/i);
      expect(sqlite.prepare('SELECT COUNT(*) count FROM legacy_bills').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT status FROM legacy_items WHERE id=1').get()).toEqual({ status: 'provisional' });
    } finally { sqlite.close(); }
  });

  it('defers strict validation and rejects duplicate or out-of-range critical indexes only when strict statements are requested', () => {
    const { sqlite, db } = harness();
    try {
      const statements = [db.prepare('SELECT 1')];
      const duplicate = prepareIpdDischargeLegacyStatements(db, {
        tenantId: '100', operationKey: 'op', statements,
        critical: [
          { statementIndex: 0, stepKey: 'one', expectedChanges: 0 },
          { statementIndex: 0, stepKey: 'two', expectedChanges: 0 },
        ],
      });
      expect(duplicate.statements).toEqual(statements);
      expect(() => strictStatements(duplicate.statements)).toThrow(/duplicate.*index/i);

      const outOfRange = prepareIpdDischargeLegacyStatements(db, {
        tenantId: '100', operationKey: 'op', statements,
        critical: [{ statementIndex: 1, stepKey: 'bad', expectedChanges: 0 }],
      });
      expect(outOfRange.statements).toEqual(statements);
      expect(() => strictStatements(outOfRange.statements)).toThrow(/range/i);
    } finally { sqlite.close(); }
  });
});

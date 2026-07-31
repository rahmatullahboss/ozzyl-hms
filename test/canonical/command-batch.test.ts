import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import {
  CanonicalIdempotencyConflictError,
  createRequestFingerprint,
} from '../../src/lib/canonical/idempotency';
import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

type Assert<T extends true> = T;
type D1ImplementsCanonicalBatchAdapter = Assert<D1Database extends CanonicalBatchDatabase ? true : false>;
void (0 as unknown as D1ImplementsCanonicalBatchAdapter);

type SqlValue = string | number | bigint | null | Uint8Array;

type RunResult = {
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
};

class SqliteCanonicalStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteCanonicalStatement {
    return new SqliteCanonicalStatement(
      this.database,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run(): Promise<RunResult> {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function createTransactionalDatabase(database: DatabaseSync): CanonicalBatchDatabase {
  return {
    prepare(sql: string) {
      return new SqliteCanonicalStatement(database, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results: RunResult[] = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function createHarness(): {
  sqlite: DatabaseSync;
  db: CanonicalBatchDatabase;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE canonical_test_entities (
      tenant_id TEXT NOT NULL,
      entity_public_id TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE (tenant_id, entity_public_id)
    );

    CREATE TABLE canonical_test_reconciliation (
      tenant_id TEXT NOT NULL,
      command_key TEXT NOT NULL,
      observed_count INTEGER NOT NULL,
      UNIQUE (tenant_id, command_key)
    );
  `);
  return { sqlite, db: createTransactionalDatabase(sqlite) };
}

function createCommand(
  db: CanonicalBatchDatabase,
  input: {
    tenantId?: string;
    key?: string;
    entityId?: string;
    requestValue?: string;
    storedValue?: string;
    resultValue?: string;
    failAfterDomain?: boolean;
  } = {},
) {
  const tenantId = input.tenantId ?? 'tenant-a';
  const key = input.key ?? 'command-1';
  const entityId = input.entityId ?? 'entity-1';
  const requestValue = input.requestValue ?? 'requested-value';
  const storedValue = input.storedValue ?? requestValue;
  const resultValue = input.resultValue ?? storedValue;

  const statements: CanonicalPreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO canonical_test_entities (tenant_id, entity_public_id, value)
         VALUES (?, ?, ?)`,
      )
      .bind(tenantId, entityId, storedValue),
  ];

  if (input.failAfterDomain) {
    statements.push(
      db
        .prepare(
          `INSERT INTO canonical_test_entities (tenant_id, entity_public_id, value)
           VALUES (?, ?, ?)`,
        )
        .bind(tenantId, entityId, 'duplicate-failure'),
    );
  }

  return {
    tenantId,
    commandName: 'canonical.test.create',
    idempotencyKey: key,
    request: { entityId, value: requestValue },
    statements,
    reconciliationStatements: [
      db
        .prepare(
          `INSERT INTO canonical_test_reconciliation (tenant_id, command_key, observed_count)
           VALUES (?, ?, ?)`,
        )
        .bind(tenantId, key, 1),
    ],
    result: { entityId, value: resultValue },
    event: {
      eventPublicId: `event-${tenantId}-${key}`,
      aggregateType: 'canonical_test_entity',
      aggregatePublicId: entityId,
      eventType: 'canonical.test.created',
      occurredAtUtc: '2026-07-13T18:00:00.000Z',
      businessDate: '2026-07-14',
      payload: { entityId, value: storedValue },
    },
  };
}

describe('canonical request fingerprints', () => {
  it('is stable across object key order and distinguishes semantic changes', async () => {
    const first = await createRequestFingerprint({ amount: '12.34', nested: { b: 2, a: 1 } });
    const reordered = await createRequestFingerprint({ nested: { a: 1, b: 2 }, amount: '12.34' });
    const changed = await createRequestFingerprint({ nested: { a: 1, b: 3 }, amount: '12.34' });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('rejects values that cannot be represented as a stable JSON command request', async () => {
    await expect(createRequestFingerprint({ value: Number.NaN })).rejects.toThrow(/serializable|finite/i);
    await expect(createRequestFingerprint({ value: undefined })).rejects.toThrow(/serializable|undefined/i);
    await expect(createRequestFingerprint({ value: 1n })).rejects.toThrow(/serializable|bigint/i);
    const sparse: unknown[] = [];
    sparse[1] = 'value';
    await expect(createRequestFingerprint(sparse)).rejects.toThrow(/sparse|serializable/i);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(createRequestFingerprint(circular)).rejects.toThrow(/circular|serializable/i);
  });
});

describe('canonical atomic command batch', () => {
  it('commits domain, reconciliation, idempotency result, and outbox event in one batch', async () => {
    const { sqlite, db } = createHarness();
    try {
      const result = await runCanonicalBatch(db, createCommand(db));

      expect(result).toEqual({ status: 'applied', result: { entityId: 'entity-1', value: 'requested-value' } });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_entities').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_reconciliation').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 1 });

      const outbox = sqlite
        .prepare(
          `SELECT tenant_id, idempotency_key, event_type, status, payload_json
           FROM canonical_outbox_events`,
        )
        .get() as Record<string, unknown>;
      expect(outbox).toMatchObject({
        tenant_id: 'tenant-a',
        idempotency_key: 'command-1',
        event_type: 'canonical.test.created',
        status: 'pending',
      });
      const payload = JSON.parse(String(outbox.payload_json));
      expect(payload.command).toMatchObject({
        name: 'canonical.test.create',
        result: { entityId: 'entity-1', value: 'requested-value' },
      });
      expect(payload.event).toEqual({ entityId: 'entity-1', value: 'requested-value' });
    } finally {
      sqlite.close();
    }
  });

  it('replays the recorded result without executing replacement domain statements', async () => {
    const { sqlite, db } = createHarness();
    try {
      await runCanonicalBatch(db, createCommand(db));
      const replay = await runCanonicalBatch(
        db,
        createCommand(db, {
          storedValue: 'must-not-write',
          resultValue: 'must-not-return',
          requestValue: 'requested-value',
        }),
      );

      expect(replay).toEqual({ status: 'replayed', result: { entityId: 'entity-1', value: 'requested-value' } });
      expect(sqlite.prepare('SELECT tenant_id, entity_public_id, value FROM canonical_test_entities').all()).toEqual([
        { tenant_id: 'tenant-a', entity_public_id: 'entity-1', value: 'requested-value' },
      ]);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects reuse of the same tenant/key for a different semantic request', async () => {
    const { sqlite, db } = createHarness();
    try {
      await runCanonicalBatch(db, createCommand(db));

      await expect(
        runCanonicalBatch(db, createCommand(db, { requestValue: 'different-request' })),
      ).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_entities').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('replays the winning transaction when a concurrent request claims the key after precheck', async () => {
    const { sqlite, db } = createHarness();
    let injectedWinner = false;
    const racingDb: CanonicalBatchDatabase = {
      prepare(sql: string) {
        return db.prepare(sql);
      },
      async batch(statements) {
        if (!injectedWinner) {
          injectedWinner = true;
          await db.batch(statements);
        }
        return db.batch(statements);
      },
    };

    try {
      const result = await runCanonicalBatch(racingDb, createCommand(racingDb));

      expect(result).toEqual({ status: 'replayed', result: { entityId: 'entity-1', value: 'requested-value' } });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_entities').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_reconciliation').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('scopes the same idempotency key independently by tenant', async () => {
    const { sqlite, db } = createHarness();
    try {
      await runCanonicalBatch(db, createCommand(db, { tenantId: 'tenant-a', entityId: 'entity-a' }));
      await runCanonicalBatch(db, createCommand(db, { tenantId: 'tenant-b', entityId: 'entity-b' }));

      expect(sqlite.prepare('SELECT tenant_id, entity_public_id FROM canonical_test_entities ORDER BY tenant_id').all()).toEqual([
        { tenant_id: 'tenant-a', entity_public_id: 'entity-a' },
        { tenant_id: 'tenant-b', entity_public_id: 'entity-b' },
      ]);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 2 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects ambiguous whitespace identifiers and impossible business dates before writing', async () => {
    const { sqlite, db } = createHarness();
    try {
      await expect(
        runCanonicalBatch(db, createCommand(db, { tenantId: ' tenant-a' })),
      ).rejects.toThrow(/whitespace/i);

      const invalidDateCommand = createCommand(db, { key: 'invalid-date' });
      invalidDateCommand.event.businessDate = '2026-02-30';
      await expect(runCanonicalBatch(db, invalidDateCommand)).rejects.toThrow(/businessDate|calendar/i);

      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_entities').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back every domain, reconciliation, and outbox write when any statement fails', async () => {
    const { sqlite, db } = createHarness();
    try {
      await expect(runCanonicalBatch(db, createCommand(db, { failAfterDomain: true }))).rejects.toThrow(
        /UNIQUE constraint failed/,
      );

      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_entities').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_test_reconciliation').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});

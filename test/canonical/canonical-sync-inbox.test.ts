import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  CanonicalSyncInboxConflictError,
  CanonicalSyncInboxStateError,
  claimCanonicalSyncInboxEvent,
  completeCanonicalSyncInboxEvent,
  deadLetterCanonicalSyncInboxEvent,
  inspectCanonicalSyncInboxEnvelope,
  receiveCanonicalSyncEnvelope,
  scheduleCanonicalSyncRetry,
} from '../../src/lib/canonical/local-sync-inbox';
import {
  createCanonicalSyncEnvelope,
  type CanonicalSyncEnvelope,
  type CreateCanonicalSyncEnvelopeInput,
} from '../../src/lib/canonical/local-sync-protocol';

const NOW = '2026-07-25T00:00:00Z';
const CLAIM_EXPIRY = '2026-07-25T00:05:00Z';
const RETRY_AT = '2026-07-25T00:10:00Z';
const ERROR_HASH = 'c'.repeat(64);

type RunResult = {
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
};

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SQLInputValue[],
    );
  }

  async run(): Promise<RunResult> {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
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
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE sync_business_apply (
      tenant_id TEXT NOT NULL,
      entity_public_id TEXT NOT NULL,
      applied_version INTEGER NOT NULL,
      operation TEXT NOT NULL,
      PRIMARY KEY (tenant_id, entity_public_id)
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
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

function input(overrides: Partial<CreateCanonicalSyncEnvelopeInput> = {}): CreateCanonicalSyncEnvelopeInput {
  return {
    tenantId: '100',
    eventPublicId: 'event-invoice-1',
    entityType: 'invoice',
    entityPublicId: 'invoice-1',
    eventType: 'canonical.invoice.issued',
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc: NOW,
    sourceNodePublicId: 'node-local-1',
    payload: { totalMinor: 10000, currencyCode: 'BDT' },
    dependencies: [
      { entityType: 'encounter', entityPublicId: 'encounter-1', minimumVersion: 1 },
    ],
    ...overrides,
  };
}

async function envelope(overrides: Partial<CreateCanonicalSyncEnvelopeInput> = {}): Promise<CanonicalSyncEnvelope> {
  return createCanonicalSyncEnvelope(input(overrides));
}

async function receiveAndClaim(
  db: CanonicalBatchDatabase,
  item: CanonicalSyncEnvelope,
  claimPublicId = 'claim-1',
) {
  await receiveCanonicalSyncEnvelope(db, item, NOW);
  return claimCanonicalSyncInboxEvent(db, {
    tenantId: item.tenantId,
    eventPublicId: item.eventPublicId,
    claimPublicId,
    claimOwnerPublicId: 'node-worker-1',
    claimedAtUtc: NOW,
    claimExpiresAtUtc: CLAIM_EXPIRY,
  });
}

function row(sqlite: DatabaseSync, eventPublicId = 'event-invoice-1') {
  return sqlite.prepare(`
    SELECT * FROM canonical_sync_inbox_events
    WHERE tenant_id='100' AND event_public_id=?
  `).get(eventPublicId) as Record<string, unknown> | undefined;
}

describe('canonical sync durable receive', () => {
  it('receives one pending event with exact dependencies and replays identical evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await expect(receiveCanonicalSyncEnvelope(db, item, NOW)).resolves.toEqual({
        status: 'received', eventPublicId: item.eventPublicId,
      });
      await expect(receiveCanonicalSyncEnvelope(db, item, NOW)).resolves.toEqual({
        status: 'replayed', eventPublicId: item.eventPublicId,
      });
      expect(row(sqlite)?.status).toBe('pending');
      const dependencies = sqlite.prepare(`
        SELECT dependency_entity_type,dependency_entity_public_id,minimum_version
        FROM canonical_sync_inbox_dependencies
      `).all();
      expect(dependencies).toEqual([{
        dependency_entity_type: 'encounter',
        dependency_entity_public_id: 'encounter-1',
        minimum_version: 1,
      }]);
    } finally {
      sqlite.close();
    }
  });

  it('replays an identical concurrent receive after a unique-constraint race', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      let raced = false;
      const raceDb: CanonicalBatchDatabase = {
        prepare(sql: string) {
          return db.prepare(sql);
        },
        async batch(statements: CanonicalPreparedStatement[]) {
          if (!raced) {
            raced = true;
            await db.batch(statements);
            throw new Error('UNIQUE constraint failed: canonical_sync_inbox_events.tenant_id, canonical_sync_inbox_events.event_public_id');
          }
          return db.batch(statements);
        },
      };
      await expect(receiveCanonicalSyncEnvelope(raceDb, item, NOW)).resolves.toEqual({
        status: 'replayed',
        eventPublicId: item.eventPublicId,
      });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_dependencies`).get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('isolates identical event identities across tenants', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await envelope();
      const second = await envelope({ tenantId: '200' });
      await receiveCanonicalSyncEnvelope(db, first, NOW);
      await receiveCanonicalSyncEnvelope(db, second, NOW);
      expect(sqlite.prepare(`
        SELECT tenant_id,event_public_id FROM canonical_sync_inbox_events ORDER BY tenant_id
      `).all()).toEqual([
        { tenant_id: '100', event_public_id: 'event-invoice-1' },
        { tenant_id: '200', event_public_id: 'event-invoice-1' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when event, idempotency, or dependency evidence is reused with different semantics', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await envelope();
      await receiveCanonicalSyncEnvelope(db, first, NOW);
      const conflictingEvent = await envelope({ payload: { totalMinor: 12000 } });
      await expect(receiveCanonicalSyncEnvelope(db, conflictingEvent, NOW))
        .rejects.toBeInstanceOf(CanonicalSyncInboxConflictError);
      sqlite.prepare(`
        UPDATE canonical_sync_inbox_events
        SET entity_type='payment_receipt'
        WHERE tenant_id='100' AND event_public_id='event-invoice-1'
      `).run();
      await expect(receiveCanonicalSyncEnvelope(db, first, NOW))
        .rejects.toBeInstanceOf(CanonicalSyncInboxConflictError);
      sqlite.prepare(`
        UPDATE canonical_sync_inbox_events
        SET entity_type='invoice'
        WHERE tenant_id='100' AND event_public_id='event-invoice-1'
      `).run();
      sqlite.prepare(`
        UPDATE canonical_sync_inbox_dependencies
        SET minimum_version=2
        WHERE tenant_id='100' AND inbox_event_public_id='event-invoice-1'
      `).run();
      await expect(receiveCanonicalSyncEnvelope(db, first, NOW))
        .rejects.toBeInstanceOf(CanonicalSyncInboxConflictError);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical sync claim/retry lifecycle', () => {
  it('claims pending work exclusively and increments attempt evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      const receipt = await receiveAndClaim(db, item);
      expect(receipt).toEqual({
        tenantId: '100',
        eventPublicId: 'event-invoice-1',
        claimPublicId: 'claim-1',
        claimOwnerPublicId: 'node-worker-1',
        claimExpiresAtUtc: CLAIM_EXPIRY,
        attemptCount: 1,
      });
      await expect(claimCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: item.eventPublicId,
        claimPublicId: 'claim-2', claimOwnerPublicId: 'node-worker-2',
        claimedAtUtc: '2026-07-25T00:01:00Z', claimExpiresAtUtc: '2026-07-25T00:06:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      expect(row(sqlite)?.claim_public_id).toBe('claim-1');
    } finally {
      sqlite.close();
    }
  });

  it('reclaims expired leases and due retries but rejects future retries', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await envelope();
      await receiveAndClaim(db, first);
      const reclaimed = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: first.eventPublicId,
        claimPublicId: 'claim-2', claimOwnerPublicId: 'node-worker-2',
        claimedAtUtc: CLAIM_EXPIRY, claimExpiresAtUtc: '2026-07-25T00:15:00Z',
      });
      expect(reclaimed.attemptCount).toBe(2);

      await scheduleCanonicalSyncRetry(db, {
        tenantId: '100', eventPublicId: first.eventPublicId, claimPublicId: 'claim-2',
        updatedAtUtc: '2026-07-25T00:06:00Z', nextAttemptAtUtc: RETRY_AT,
        errorCode: 'DEPENDENCY_PENDING', errorHash: ERROR_HASH,
      });
      await expect(claimCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: first.eventPublicId,
        claimPublicId: 'claim-3', claimOwnerPublicId: 'node-worker-3',
        claimedAtUtc: '2026-07-25T00:09:59Z', claimExpiresAtUtc: '2026-07-25T00:20:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      const due = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: first.eventPublicId,
        claimPublicId: 'claim-3', claimOwnerPublicId: 'node-worker-3',
        claimedAtUtc: RETRY_AT, claimExpiresAtUtc: '2026-07-25T00:20:00Z',
      });
      expect(due.attemptCount).toBe(3);
      expect(row(sqlite)?.error_code).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it('rejects retry and dead-letter transitions after the claim lease expires', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await receiveAndClaim(db, item);
      await expect(scheduleCanonicalSyncRetry(db, {
        tenantId: '100', eventPublicId: item.eventPublicId, claimPublicId: 'claim-1',
        updatedAtUtc: CLAIM_EXPIRY, nextAttemptAtUtc: RETRY_AT,
        errorCode: 'RETRY', errorHash: ERROR_HASH,
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      await expect(deadLetterCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: item.eventPublicId, claimPublicId: 'claim-1',
        updatedAtUtc: CLAIM_EXPIRY, errorCode: 'POISON_EVENT', errorHash: ERROR_HASH,
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      expect(row(sqlite)?.status).toBe('applying');
    } finally {
      sqlite.close();
    }
  });

  it('requires exact claims for retry and dead-letter transitions', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await receiveAndClaim(db, item);
      await expect(scheduleCanonicalSyncRetry(db, {
        tenantId: '100', eventPublicId: item.eventPublicId, claimPublicId: 'wrong-claim',
        updatedAtUtc: NOW, nextAttemptAtUtc: RETRY_AT,
        errorCode: 'RETRY', errorHash: ERROR_HASH,
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      expect(row(sqlite)?.status).toBe('applying');
      await deadLetterCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: item.eventPublicId, claimPublicId: 'claim-1',
        updatedAtUtc: '2026-07-25T00:02:00Z', errorCode: 'POISON_EVENT', errorHash: ERROR_HASH,
      });
      expect(row(sqlite)).toMatchObject({
        status: 'dead_letter', claim_public_id: null, error_code: 'POISON_EVENT', error_hash: ERROR_HASH,
      });
      await expect(claimCanonicalSyncInboxEvent(db, {
        tenantId: '100', eventPublicId: item.eventPublicId,
        claimPublicId: 'claim-2', claimOwnerPublicId: 'node-worker-2',
        claimedAtUtc: '2026-07-25T00:03:00Z', claimExpiresAtUtc: '2026-07-25T00:08:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical sync inbox inspection', () => {
  it('returns null before receive and exact pending/applying/applied lifecycle evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await expect(inspectCanonicalSyncInboxEnvelope(db, item)).resolves.toBeNull();

      await receiveCanonicalSyncEnvelope(db, item, NOW);
      await expect(inspectCanonicalSyncInboxEnvelope(db, item)).resolves.toEqual({
        tenantId: '100',
        eventPublicId: item.eventPublicId,
        status: 'pending',
        attemptCount: 0,
        claimPublicId: null,
        claimOwnerPublicId: null,
        claimExpiresAtUtc: null,
        nextAttemptAtUtc: null,
        appliedAtUtc: null,
        errorCode: null,
        errorHash: null,
      });

      await claimCanonicalSyncInboxEvent(db, {
        tenantId: item.tenantId,
        eventPublicId: item.eventPublicId,
        claimPublicId: 'inspect-claim-1',
        claimOwnerPublicId: 'inspect-worker-1',
        claimedAtUtc: NOW,
        claimExpiresAtUtc: CLAIM_EXPIRY,
      });
      await expect(inspectCanonicalSyncInboxEnvelope(db, item)).resolves.toMatchObject({
        status: 'applying',
        attemptCount: 1,
        claimPublicId: 'inspect-claim-1',
        claimOwnerPublicId: 'inspect-worker-1',
        claimExpiresAtUtc: CLAIM_EXPIRY,
      });

      await completeCanonicalSyncInboxEvent(db, {
        envelope: item,
        claimPublicId: 'inspect-claim-1',
        appliedAtUtc: '2026-07-25T00:03:00Z',
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply VALUES ('100','invoice-1',1,'upsert')
        `)],
      });
      await expect(inspectCanonicalSyncInboxEnvelope(db, item)).resolves.toMatchObject({
        status: 'applied',
        attemptCount: 1,
        claimPublicId: null,
        appliedAtUtc: '2026-07-25T00:03:00Z',
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects same identity inspection with different semantic or dependency evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await receiveCanonicalSyncEnvelope(db, item, NOW);
      const payloadConflict = await envelope({ payload: { totalMinor: 9999, currencyCode: 'BDT' } });
      await expect(inspectCanonicalSyncInboxEnvelope(db, payloadConflict))
        .rejects.toBeInstanceOf(CanonicalSyncInboxConflictError);
      const dependencyConflict = await envelope({
        dependencies: [{ entityType: 'encounter', entityPublicId: 'encounter-2', minimumVersion: 1 }],
      });
      await expect(inspectCanonicalSyncInboxEnvelope(db, dependencyConflict))
        .rejects.toBeInstanceOf(CanonicalSyncInboxConflictError);
      expect(row(sqlite)?.status).toBe('pending');
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical sync atomic applied receipt', () => {
  it('requires business authority and commits business, version, and applied receipt atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await receiveAndClaim(db, item);
      await expect(completeCanonicalSyncInboxEvent(db, {
        envelope: item, claimPublicId: 'claim-1', appliedAtUtc: '2026-07-25T00:03:00Z',
        authoritativeStatements: [],
      })).rejects.toThrow(/authoritativeStatements/i);

      await completeCanonicalSyncInboxEvent(db, {
        envelope: item,
        claimPublicId: 'claim-1',
        appliedAtUtc: '2026-07-25T00:03:00Z',
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply (tenant_id,entity_public_id,applied_version,operation)
          VALUES ('100','invoice-1',1,'upsert')
        `)],
      });
      expect(row(sqlite)).toMatchObject({
        status: 'applied', applied_at_utc: '2026-07-25T00:03:00Z', claim_public_id: null,
      });
      expect(sqlite.prepare(`SELECT * FROM canonical_sync_entity_versions`).get()).toMatchObject({
        tenant_id: '100', entity_type: 'invoice', entity_public_id: 'invoice-1',
        applied_version: 1, last_event_public_id: 'event-invoice-1', last_operation: 'upsert',
      });
      expect(sqlite.prepare(`SELECT * FROM sync_business_apply`).get()).toMatchObject({ applied_version: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('advances a precreated version-zero authority row to version one', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES ('100','invoice','invoice-1',0,NULL,NULL,NULL,?)
      `).run(NOW);
      const item = await envelope();
      await receiveAndClaim(db, item);
      await completeCanonicalSyncInboxEvent(db, {
        envelope: item,
        claimPublicId: 'claim-1',
        appliedAtUtc: '2026-07-25T00:03:00Z',
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply VALUES ('100','invoice-1',1,'upsert')
        `)],
      });
      expect(sqlite.prepare(`SELECT * FROM canonical_sync_entity_versions`).get()).toMatchObject({
        applied_version: 1,
        last_event_public_id: 'event-invoice-1',
        last_operation: 'upsert',
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects completion after the claim lease expires and rolls back business statements', async () => {
    const { sqlite, db } = harness();
    try {
      const item = await envelope();
      await receiveAndClaim(db, item);
      await expect(completeCanonicalSyncInboxEvent(db, {
        envelope: item,
        claimPublicId: 'claim-1',
        appliedAtUtc: CLAIM_EXPIRY,
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply VALUES ('100','invoice-1',1,'upsert')
        `)],
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM sync_business_apply`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_entity_versions`).get()).toEqual({ count: 0 });
      expect(row(sqlite)?.status).toBe('applying');
    } finally {
      sqlite.close();
    }
  });

  it('advances exact versions and records tombstones', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await envelope();
      await receiveAndClaim(db, first);
      await completeCanonicalSyncInboxEvent(db, {
        envelope: first, claimPublicId: 'claim-1', appliedAtUtc: '2026-07-25T00:03:00Z',
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply VALUES ('100','invoice-1',1,'upsert')
        `)],
      });
      const second = await envelope({
        eventPublicId: 'event-invoice-2', aggregateVersion: 2,
        eventType: 'canonical.invoice.cancelled', operation: 'tombstone', payload: { reasonCode: 'cancelled' },
      });
      await receiveAndClaim(db, second, 'claim-2');
      await completeCanonicalSyncInboxEvent(db, {
        envelope: second, claimPublicId: 'claim-2', appliedAtUtc: '2026-07-25T00:04:00Z',
        authoritativeStatements: [db.prepare(`
          UPDATE sync_business_apply SET applied_version=2,operation='tombstone'
          WHERE tenant_id='100' AND entity_public_id='invoice-1'
        `)],
      });
      expect(sqlite.prepare(`SELECT * FROM canonical_sync_entity_versions`).get()).toMatchObject({
        applied_version: 2, last_event_public_id: 'event-invoice-2', last_operation: 'tombstone',
      });
      expect(sqlite.prepare(`SELECT * FROM sync_business_apply`).get()).toMatchObject({
        applied_version: 2, operation: 'tombstone',
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls business and version mutations back on stale claim, version gap, or business failure', async () => {
    const { sqlite, db } = harness();
    try {
      const gap = await envelope({ eventPublicId: 'event-invoice-2', aggregateVersion: 2 });
      await receiveAndClaim(db, gap);
      await expect(completeCanonicalSyncInboxEvent(db, {
        envelope: gap, claimPublicId: 'claim-1', appliedAtUtc: '2026-07-25T00:03:00Z',
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply VALUES ('100','invoice-1',2,'upsert')
        `)],
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM sync_business_apply`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_entity_versions`).get()).toEqual({ count: 0 });
      expect(row(sqlite, 'event-invoice-2')?.status).toBe('applying');

      const fresh = await envelope({ eventPublicId: 'event-other-1', entityPublicId: 'invoice-2' });
      await receiveAndClaim(db, fresh, 'claim-other');
      await expect(completeCanonicalSyncInboxEvent(db, {
        envelope: fresh, claimPublicId: 'wrong-claim', appliedAtUtc: '2026-07-25T00:04:00Z',
        authoritativeStatements: [db.prepare(`
          INSERT INTO sync_business_apply VALUES ('100','invoice-2',1,'upsert')
        `)],
      })).rejects.toBeInstanceOf(CanonicalSyncInboxStateError);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM sync_business_apply`).get()).toEqual({ count: 0 });

      await expect(completeCanonicalSyncInboxEvent(db, {
        envelope: fresh, claimPublicId: 'claim-other', appliedAtUtc: '2026-07-25T00:04:00Z',
        authoritativeStatements: [db.prepare(`INSERT INTO missing_table VALUES (1)`) ],
      })).rejects.toThrow(/missing_table/i);
      expect(row(sqlite, 'event-other-1')?.status).toBe('applying');
    } finally {
      sqlite.close();
    }
  });
});

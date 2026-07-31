import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  closeCashCustodySession,
  prepareRecordCashCustodyMovement,
  reverseCashCustodyMovement,
} from '../../src/lib/canonical/contracts/manage-cash-custody';
import { executeLiveCashCustodyMovement } from '../../src/lib/canonical/live-cash-custody';


type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0515_canonical_accounting_outbox.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      UNIQUE(tenant_id,source_key)
    );
  `);
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
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
  } satisfies CanonicalBatchDatabase;
  return { sqlite, db };
}

const HASH = 'a'.repeat(64);

function movementInput(overrides: Partial<Parameters<typeof prepareRecordCashCustodyMovement>[1]> = {}) {
  return {
    tenantId: 'tenant-a',
    custodyType: 'counter_session' as const,
    legacyCounterId: 3,
    legacyCounterSessionId: 9,
    movementType: 'handover' as const,
    direction: 'out' as const,
    amountMinor: 2500,
    occurredAtUtc: '2026-07-29T06:00:00.000Z',
    businessDate: '2026-07-29',
    sourceType: 'legacy_cash_handover',
    sourcePublicId: 'handover-9',
    sourceTable: 'legacy_cash_movements',
    sourceEvidenceSha256: HASH,
    idempotencyKey: 'cash-handover-9',
    outboxEventPublicId: 'outbox-cash-handover-9',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('canonical cash custody commands', () => {
  it('prepares compatibility, mapping, receipt and outbox for one atomic batch', async () => {
    const { sqlite, db } = harness();
    try {
      const prepared = await prepareRecordCashCustodyMovement(db, movementInput(), {
        authoritativeStatements: [db.prepare(`
          INSERT INTO legacy_cash_movements(tenant_id,source_key,amount_minor)
          VALUES ('tenant-a','handover-9',2500)
        `)],
      });
      expect(prepared.status).toBe('prepared');
      expect(count(sqlite, 'legacy_cash_movements')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);

      await db.batch([...prepared.statements]);
      expect(count(sqlite, 'legacy_cash_movements')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(sqlite.prepare(`
        SELECT event_type,aggregate_public_id,payload_json
        FROM canonical_outbox_events
      `).get()).toMatchObject({
        event_type: 'canonical.cash_custody.movement_recorded',
        aggregate_public_id: 'counter-session:9',
      });

      const replay = await prepareRecordCashCustodyMovement(db, movementInput());
      expect(replay).toMatchObject({ status: 'replayed', statements: [] });
      await expect(prepareRecordCashCustodyMovement(db, movementInput({ amountMinor: 2600 })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally { sqlite.close(); }
  });

  it('rolls back compatibility and all Canonical evidence when one statement fails', async () => {
    const { sqlite, db } = harness();
    try {
      const prepared = await prepareRecordCashCustodyMovement(db, movementInput({
        sourcePublicId: 'handover-fail',
        idempotencyKey: 'cash-handover-fail',
        outboxEventPublicId: 'outbox-cash-handover-fail',
      }), {
        authoritativeStatements: [db.prepare(`
          INSERT INTO legacy_cash_movements(tenant_id,source_key,amount_minor)
          VALUES ('tenant-a','handover-fail',NULL)
        `)],
      });
      await expect(db.batch([...prepared.statements])).rejects.toThrow();
      expect(count(sqlite, 'legacy_cash_movements')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('records an equal-and-opposite immutable reversal event', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_outbox_events(
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status,
          published_at_utc
        ) VALUES (
          'tenant-a','outbox-original','canonical_cash_custody','counter-session:9',
          'canonical.cash_custody.movement_recorded',1,'{}','2026-07-29T05:00:00.000Z',
          '2026-07-29','outbox-original','published','2026-07-29T05:01:00.000Z'
        );
        INSERT INTO canonical_cash_custody_balances(
          tenant_id,custody_public_id,custody_type,legacy_counter_id,
          legacy_counter_session_id,balance_minor,version,projection_guard,source_evidence_sha256
        ) VALUES ('tenant-a','counter-session:9','counter_session',3,9,-2500,1,1,'${HASH}');
        INSERT INTO canonical_cash_custody_movements(
          tenant_id,custody_movement_public_id,outbox_event_public_id,custody_public_id,
          movement_type,direction,amount_minor,signed_amount_minor,balance_before_minor,
          balance_after_minor,legacy_counter_id,legacy_counter_session_id,occurred_at_utc,
          business_date,balance_guard,source_evidence_sha256
        ) VALUES (
          'tenant-a','cashmove-original','outbox-original','counter-session:9','handover','out',
          2500,-2500,0,-2500,3,9,'2026-07-29T05:00:00.000Z','2026-07-29',1,'${HASH}'
        );
      `);
      const result = await reverseCashCustodyMovement(db, {
        tenantId: 'tenant-a',
        originalCustodyMovementPublicId: 'cashmove-original',
        occurredAtUtc: '2026-07-29T06:30:00.000Z',
        businessDate: '2026-07-29',
        reasonCode: 'handover_rejected',
        sourceType: 'legacy_cash_handover_reversal',
        sourcePublicId: 'handover-9-reversal',
        sourceTable: 'legacy_cash_movements',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'cash-handover-9-reversal',
        outboxEventPublicId: 'outbox-cash-handover-9-reversal',
      });
      expect(result.status).toBe('applied');
      const payload = JSON.parse(String((sqlite.prepare(`
        SELECT payload_json FROM canonical_outbox_events
        WHERE event_public_id='outbox-cash-handover-9-reversal'
      `).get() as { payload_json: string }).payload_json));
      expect(payload.event).toMatchObject({ movementType: 'adjustment', direction: 'in', amountMinor: 2500 });
    } finally { sqlite.close(); }
  });

  it('closes only the exact current custody balance and rejects stale balance', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_cash_custody_balances(
          tenant_id,custody_public_id,custody_type,legacy_counter_id,
          legacy_counter_session_id,balance_minor,version,projection_guard,source_evidence_sha256
        ) VALUES ('tenant-a','counter-session:9','counter_session',3,9,5000,2,1,'${HASH}');
      `);
      const result = await closeCashCustodySession(db, {
        tenantId: 'tenant-a',
        custodyPublicId: 'counter-session:9',
        expectedBalanceMinor: 5000,
        countedMinor: 4900,
        occurredAtUtc: '2026-07-29T07:00:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_counter_close',
        sourcePublicId: 'counter-close-9',
        sourceTable: 'billing_counter_sessions',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'counter-close-9',
        outboxEventPublicId: 'outbox-counter-close-9',
      });
      expect(result).toMatchObject({ status: 'applied', result: { varianceMinor: -100 } });
      sqlite.exec(`
        UPDATE canonical_cash_custody_balances
        SET balance_minor=5200,version=3
        WHERE tenant_id='tenant-a' AND custody_public_id='counter-session:9';
      `);
      await expect(closeCashCustodySession(db, {
        tenantId: 'tenant-a',
        custodyPublicId: 'counter-session:9',
        expectedBalanceMinor: 5000,
        countedMinor: 4900,
        occurredAtUtc: '2026-07-29T07:00:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_counter_close',
        sourcePublicId: 'counter-close-9',
        sourceTable: 'billing_counter_sessions',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'counter-close-9',
        outboxEventPublicId: 'outbox-counter-close-9',
      })).resolves.toMatchObject({ status: 'replayed', result: { varianceMinor: -100 } });
      await expect(closeCashCustodySession(db, {
        tenantId: 'tenant-a',
        custodyPublicId: 'counter-session:9',
        expectedBalanceMinor: 5100,
        countedMinor: 4900,
        occurredAtUtc: '2026-07-29T07:10:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_counter_close',
        sourcePublicId: 'counter-close-9-stale',
        sourceTable: 'billing_counter_sessions',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'counter-close-9-stale',
        outboxEventPublicId: 'outbox-counter-close-9-stale',
      })).rejects.toThrow(/balance changed/i);
    } finally { sqlite.close(); }
  });

  it('commits strict legacy movement, mapping and outbox in one batch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_feature_flags(
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (
          '100','canonical_financial_dual_write_v1','financial','shadow',1,1,
          '{"writePolicy":"strict","tenantScope":["100"]}'
        );
      `);
      const execution = await executeLiveCashCustodyMovement(db, {
        tenantId: '100',
        legacyStatements: [db.prepare(`
          INSERT INTO legacy_cash_movements(tenant_id,source_key,amount_minor)
          VALUES ('100','strict-handover',3200)
        `)],
        custodyType: 'counter_session',
        legacyCounterId: 5,
        legacyCounterSessionId: 11,
        movementType: 'handover',
        direction: 'out',
        amount: 32,
        occurredAtUtc: '2026-07-29T08:00:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_counter_handover',
        sourcePublicId: 'strict-handover',
        sourceTable: 'legacy_cash_movements',
        evidence: { sessionId: 11, actorId: 7 },
      });
      expect(execution.mode).toBe('strict');
      expect(count(sqlite, 'legacy_cash_movements')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('rolls back strict legacy and Canonical custody evidence together', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_feature_flags(
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (
          '100','canonical_financial_dual_write_v1','financial','shadow',1,1,
          '{"writePolicy":"strict","tenantScope":["100"]}'
        );
      `);
      await expect(executeLiveCashCustodyMovement(db, {
        tenantId: '100',
        legacyStatements: [db.prepare(`
          INSERT INTO legacy_cash_movements(tenant_id,source_key,amount_minor)
          VALUES ('100','strict-failure',NULL)
        `)],
        custodyType: 'counter_session',
        legacyCounterId: 5,
        legacyCounterSessionId: 11,
        movementType: 'handover',
        direction: 'out',
        amount: 32,
        occurredAtUtc: '2026-07-29T08:10:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_counter_handover',
        sourcePublicId: 'strict-failure',
        sourceTable: 'legacy_cash_movements',
        evidence: { sessionId: 11, actorId: 7 },
      })).rejects.toMatchObject({ code: 'CANONICAL_STRICT_WRITE_FAILED' });
      expect(count(sqlite, 'legacy_cash_movements')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally { sqlite.close(); }
  });
});

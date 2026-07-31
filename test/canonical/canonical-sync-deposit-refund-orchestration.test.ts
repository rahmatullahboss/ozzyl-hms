import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { collectPayment } from '../../src/lib/canonical/commands/collect-payment';
import { recordDeposit, refundDeposit } from '../../src/lib/canonical/commands/apply-deposit';
import { createCanonicalSyncDatabaseDeliveryPort } from '../../src/lib/canonical/local-sync-delivery';
import { convertCanonicalOutboxEventToSyncEnvelope } from '../../src/lib/canonical/local-sync-outbox-converter';
import { runCanonicalSyncOrchestrationOnce } from '../../src/lib/canonical/local-sync-orchestrator';

const TENANT = '100';
const SOURCE_NODE = 'node-deposit-source';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      params.map((value) => value === undefined ? null : value) as SQLInputValue[],
    );
  }

  async run() {
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

function database(sqlite: DatabaseSync): CanonicalBatchDatabase {
  return {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
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
}

function apply(sqlite: DatabaseSync, migrations: readonly string[]): void {
  for (const migration of migrations) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
}

const DOMAIN_MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
] as const;

function sourceHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT
    );
  `);
  apply(sqlite, [
    ...DOMAIN_MIGRATIONS,
    '0541_canonical_local_sync_protocol.sql',
    '0542_canonical_sync_inbox_lifecycle.sql',
    '0543_canonical_sync_outbox_lifecycle.sql',
  ]);
  sqlite.exec(`INSERT INTO patients VALUES (101,'100','uhid:P-001');`);
  return { sqlite, db: database(sqlite) };
}

function targetHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT NOT NULL,
      UNIQUE (tenant_id,sync_key)
    );
  `);
  apply(sqlite, [
    ...DOMAIN_MIGRATIONS,
    '0541_canonical_local_sync_protocol.sql',
    '0542_canonical_sync_inbox_lifecycle.sql',
  ]);
  sqlite.exec(`INSERT INTO patients VALUES (201,'100','uhid:P-001');`);
  return { sqlite, db: database(sqlite) };
}

function orchestration(index: number) {
  const minute = index * 10;
  const timestamp = (offset: number) => `2099-01-02T00:${String(minute + offset).padStart(2, '0')}:00Z`;
  return {
    tenantId: TENANT,
    sourceNodePublicId: SOURCE_NODE,
    sourceClaimOwnerPublicId: 'source-worker-deposit',
    targetClaimOwnerPublicId: 'target-worker-deposit',
    sourceMaxAttempts: 3,
    targetMaxAttempts: 3,
    timeline: {
      sourceClaimedAtUtc: timestamp(0),
      sourceClaimExpiresAtUtc: timestamp(8),
      targetReceivedAtUtc: timestamp(1),
      targetClaimedAtUtc: timestamp(2),
      targetClaimExpiresAtUtc: timestamp(7),
      targetAppliedAtUtc: timestamp(3),
      sourcePublishedAtUtc: timestamp(4),
      sourceNextAttemptAtUtc: timestamp(5),
      targetNextAttemptAtUtc: timestamp(6),
    },
  };
}

describe('canonical deposit refund offline orchestration', () => {
  it('converges receipt, deposit, and refund across nodes with exact replay', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    const delivery = createCanonicalSyncDatabaseDeliveryPort(target.db);
    try {
      await collectPayment(source.db, {
        tenantId: TENANT,
        receiptPublicId: 'receipt-deposit-1',
        receiptNumber: 'R-DEP-001',
        legacyPatientId: 101,
        currencyCode: 'BDT',
        receivedAtUtc: '2026-07-25T11:00:00.000Z',
        businessDate: '2026-07-25',
        tenders: [{
          tenderPublicId: 'tender-deposit-1',
          tenderType: 'card',
          methodCode: 'visa',
          amountMinor: 500,
          status: 'captured',
          externalTransactionId: 'txn-deposit-1',
          sourceEvidenceSha256: 'a'.repeat(64),
        }],
        allocations: [],
        unallocatedMinor: 500,
        sourceType: 'runtime_payment',
        sourcePublicId: 'payment-source-deposit-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'b'.repeat(64),
        idempotencyKey: 'collect-payment-deposit-1',
        outboxEventPublicId: 'outbox-payment-deposit-1',
      });
      await recordDeposit(source.db, {
        tenantId: TENANT,
        depositPublicId: 'deposit-1',
        depositNumber: 'DEP-001',
        receiptPublicId: 'receipt-deposit-1',
        sourceType: 'runtime_deposit',
        sourcePublicId: 'deposit-source-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'c'.repeat(64),
        idempotencyKey: 'record-deposit-1',
        outboxEventPublicId: 'outbox-deposit-record',
      });
      const refundInput = {
        tenantId: TENANT,
        refundPublicId: 'refund-deposit-1',
        depositPublicId: 'deposit-1',
        amountMinor: 100,
        tenderType: 'card',
        methodCode: 'visa',
        refundedAtUtc: '2026-07-25T11:30:00.000Z',
        businessDate: '2026-07-25',
        sourceType: 'runtime_deposit_refund',
        sourcePublicId: 'deposit-refund-source-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'd'.repeat(64),
        idempotencyKey: 'refund-deposit-1',
        outboxEventPublicId: 'outbox-deposit-refund',
      } as const;
      await refundDeposit(source.db, refundInput);

      expect(source.sqlite.prepare(`
        SELECT event_public_id,aggregate_type,event_type FROM canonical_outbox_events ORDER BY id
      `).all()).toEqual([
        {
          event_public_id: 'outbox-payment-deposit-1',
          aggregate_type: 'canonical_payment_receipt',
          event_type: 'canonical.payment.receipt.posted',
        },
        {
          event_public_id: 'outbox-deposit-record',
          aggregate_type: 'canonical_deposit',
          event_type: 'canonical.deposit.recorded',
        },
        {
          event_public_id: 'outbox-deposit-refund',
          aggregate_type: 'canonical_refund',
          event_type: 'canonical.deposit.refunded',
        },
      ]);

      const results = [];
      for (let index = 0; index < 3; index += 1) {
        results.push(await runCanonicalSyncOrchestrationOnce(
          source.db,
          delivery,
          orchestration(index),
        ));
      }
      expect(results.map((result) => [result.status, result.status === 'idle' ? null : result.eventPublicId]))
        .toEqual([
          ['published', 'outbox-payment-deposit-1'],
          ['published', 'outbox-deposit-record'],
          ['published', 'outbox-deposit-refund'],
        ]);
      await expect(runCanonicalSyncOrchestrationOnce(source.db, delivery, orchestration(3)))
        .resolves.toEqual({ status: 'idle' });

      expect(target.sqlite.prepare(`
        SELECT total_minor,allocated_total_minor,unallocated_minor,status
        FROM canonical_payment_receipts WHERE receipt_public_id='receipt-deposit-1'
      `).get()).toEqual({
        total_minor: 500,
        allocated_total_minor: 0,
        unallocated_minor: 500,
        status: 'posted',
      });
      expect(target.sqlite.prepare(`
        SELECT amount_minor,applied_minor,refunded_minor,available_minor,status
        FROM canonical_deposits WHERE deposit_public_id='deposit-1'
      `).get()).toEqual({
        amount_minor: 500,
        applied_minor: 0,
        refunded_minor: 100,
        available_minor: 400,
        status: 'posted',
      });
      expect(target.sqlite.prepare(`
        SELECT source_type,deposit_public_id,amount_minor,tender_type,method_code,status,
               source_available_before_minor,source_available_after_minor
        FROM canonical_refunds WHERE refund_public_id='refund-deposit-1'
      `).get()).toEqual({
        source_type: 'deposit',
        deposit_public_id: 'deposit-1',
        amount_minor: 100,
        tender_type: 'card',
        method_code: 'visa',
        status: 'posted',
        source_available_before_minor: 500,
        source_available_after_minor: 400,
      });
      expect(target.sqlite.prepare(`
        SELECT entity_type,applied_version,last_event_public_id
        FROM canonical_sync_entity_versions
        WHERE entity_type IN ('payment_receipt','deposit')
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'deposit', applied_version: 2, last_event_public_id: 'outbox-deposit-refund' },
        { entity_type: 'payment_receipt', applied_version: 1, last_event_public_id: 'outbox-payment-deposit-1' },
      ]);

      await expect(refundDeposit(source.db, refundInput))
        .resolves.toMatchObject({ status: 'replayed' });
      expect(source.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_outbox_events`).get())
        .toEqual({ count: 3 });

      const refundEnvelope = await convertCanonicalOutboxEventToSyncEnvelope(source.db, {
        tenantId: TENANT,
        eventPublicId: 'outbox-deposit-refund',
        sourceNodePublicId: SOURCE_NODE,
      });
      expect(refundEnvelope).toMatchObject({
        entityType: 'deposit',
        entityPublicId: 'deposit-1',
        aggregateVersion: 2,
        operation: 'upsert',
      });
      await expect(delivery.deliver({
        envelope: refundEnvelope,
        receivedAtUtc: '2099-01-02T02:30:00Z',
        targetClaimPublicId: 'replay-deposit-refund',
        targetClaimOwnerPublicId: 'target-worker-deposit',
        targetClaimedAtUtc: '2099-01-02T02:30:10Z',
        targetClaimExpiresAtUtc: '2099-01-02T02:40:10Z',
        targetAppliedAtUtc: '2099-01-02T02:30:20Z',
        targetNextAttemptAtUtc: '2099-01-02T02:50:00Z',
        targetMaxAttempts: 3,
      })).resolves.toMatchObject({ status: 'applied', replayed: true });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_refunds`).get())
        .toEqual({ count: 1 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 3 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });
});

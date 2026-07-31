import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { claimCanonicalSyncInboxEvent, receiveCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-inbox';
import { completeCanonicalSyncBusinessEvent } from '../../src/lib/canonical/local-sync-business-apply';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import { createCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SQLInputValue[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.sqlite, this.sql, params.map((v) => v === undefined ? null : v) as SQLInputValue[]); }
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
  sqlite.exec(`
    CREATE TABLE canonical_invoices (
      tenant_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,due_minor INTEGER NOT NULL,credited_minor INTEGER NOT NULL,
      net_due_minor INTEGER NOT NULL,adjustment_projection_guard INTEGER NOT NULL,status TEXT NOT NULL,
      cancelled_at_utc TEXT,updated_at_utc TEXT NOT NULL,PRIMARY KEY(tenant_id,invoice_public_id)
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT NOT NULL,accrual_public_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,
      practitioner_public_id TEXT,adjusted_minor INTEGER NOT NULL,settled_minor INTEGER NOT NULL,
      payable_minor INTEGER NOT NULL,status TEXT NOT NULL,updated_at_utc TEXT NOT NULL,
      PRIMARY KEY(tenant_id,accrual_public_id)
    );
    CREATE TABLE canonical_compensation_adjustments (
      tenant_id TEXT NOT NULL,adjustment_public_id TEXT NOT NULL,accrual_public_id TEXT NOT NULL,
      settlement_public_id TEXT,settlement_allocation_public_id TEXT,adjustment_type TEXT NOT NULL,
      reason_code TEXT NOT NULL,amount_minor INTEGER NOT NULL,accrual_adjusted_before_minor INTEGER NOT NULL,
      accrual_adjusted_after_minor INTEGER NOT NULL,accrual_settled_before_minor INTEGER NOT NULL,
      accrual_settled_after_minor INTEGER NOT NULL,accrual_payable_before_minor INTEGER NOT NULL,
      accrual_payable_after_minor INTEGER NOT NULL,occurred_at_utc TEXT NOT NULL,business_date TEXT NOT NULL,
      balance_guard INTEGER NOT NULL,source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY(tenant_id,adjustment_public_id)
    );
    INSERT INTO canonical_invoices VALUES ('100','invoice-1',900,0,900,0,900,1,'posted',NULL,'2026-07-25T01:30:00Z');
    INSERT INTO canonical_compensation_accruals VALUES
      ('100','accrual-1','invoice-1','practitioner-1',0,0,100,'accrued','2026-07-25T01:40:00Z'),
      ('100','accrual-2','invoice-1',NULL,10,0,50,'unassigned','2026-07-25T01:40:00Z');
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.prepare(`
    INSERT INTO canonical_sync_entity_versions (
      tenant_id,entity_type,entity_public_id,applied_version,last_event_public_id,
      last_operation,last_payload_sha256,updated_at_utc
    ) VALUES ('100','invoice','invoice-1',1,'outbox-invoice-issued','upsert',?,'2026-07-25T01:30:00Z')
  `).run('f'.repeat(64));
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db };
}

async function cancellationEnvelope() {
  const compensationAdjustments = [
    {
      adjustmentPublicId: 'adjustment-1', accrualPublicId: 'accrual-1', adjustmentType: 'service_cancellation',
      reasonCode: 'invoice_cancelled', amountMinor: 100, adjustedBeforeMinor: 0, adjustedAfterMinor: 100,
      settledBeforeMinor: 0, settledAfterMinor: 0, payableBeforeMinor: 100, payableAfterMinor: 0,
      statusBefore: 'accrued', statusAfter: 'reversed', occurredAtUtc: '2026-07-25T02:00:00Z',
      businessDate: '2026-07-25', sourceEvidenceSha256: 'a'.repeat(64),
    },
    {
      adjustmentPublicId: 'adjustment-2', accrualPublicId: 'accrual-2', adjustmentType: 'service_cancellation',
      reasonCode: 'invoice_cancelled', amountMinor: 50, adjustedBeforeMinor: 10, adjustedAfterMinor: 60,
      settledBeforeMinor: 0, settledAfterMinor: 0, payableBeforeMinor: 50, payableAfterMinor: 0,
      statusBefore: 'unassigned', statusAfter: 'reversed', occurredAtUtc: '2026-07-25T02:00:00Z',
      businessDate: '2026-07-25', sourceEvidenceSha256: 'b'.repeat(64),
    },
  ];
  const event = {
    invoicePublicId: 'invoice-1', status: 'cancelled', totalMinor: 900,
    reversedCompensationMinor: 150, reversedCompensationCount: 2,
  };
  return createCanonicalSyncEnvelope({
    tenantId: '100', eventPublicId: 'outbox-invoice-cancelled', entityType: 'invoice',
    entityPublicId: 'invoice-1', eventType: 'canonical.invoice.cancelled', aggregateVersion: 2,
    operation: 'tombstone', occurredAtUtc: '2026-07-25T02:00:00Z', sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event,
      mutation: {
        kind: 'invoice_cancelled', entityPublicId: 'invoice-1', totalMinor: 900,
        cancelledAtUtc: '2026-07-25T02:00:00Z', compensationAdjustments,
      },
    }),
  });
}

async function apply(db: CanonicalBatchDatabase) {
  const envelope = await cancellationEnvelope();
  await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T03:00:00Z');
  const claim = await claimCanonicalSyncInboxEvent(db, {
    tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-cancel-1',
    claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T03:00:10Z',claimExpiresAtUtc: '2026-07-25T04:00:10Z',
  });
  await completeCanonicalSyncBusinessEvent(db, {
    envelope,claimPublicId: claim.claimPublicId,appliedAtUtc: '2026-07-25T03:00:20Z',
  });
}

describe('canonical sync invoice cancellation apply', () => {
  it('atomically cancels the unpaid invoice and reverses all compensation payables', async () => {
    const { sqlite, db } = harness();
    try {
      await apply(db);
      expect(sqlite.prepare(`SELECT status,cancelled_at_utc,adjustment_projection_guard FROM canonical_invoices`).get())
        .toEqual({ status: 'cancelled', cancelled_at_utc: '2026-07-25T02:00:00Z', adjustment_projection_guard: 1 });
      expect(sqlite.prepare(`SELECT accrual_public_id,adjusted_minor,payable_minor,status FROM canonical_compensation_accruals ORDER BY accrual_public_id`).all())
        .toEqual([
          { accrual_public_id: 'accrual-1', adjusted_minor: 100, payable_minor: 0, status: 'reversed' },
          { accrual_public_id: 'accrual-2', adjusted_minor: 60, payable_minor: 0, status: 'reversed' },
        ]);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_compensation_adjustments`).get()).toEqual({ count: 2 });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions WHERE entity_type='invoice'`).get())
        .toEqual({ applied_version: 2 });
    } finally { sqlite.close(); }
  });

  it('rolls back invoice, adjustments, version, and inbox receipt when an accrual is stale', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE canonical_compensation_accruals SET payable_minor=99 WHERE accrual_public_id='accrual-1'`).run();
      await expect(apply(db)).rejects.toThrow();
      expect(sqlite.prepare(`SELECT status,cancelled_at_utc FROM canonical_invoices`).get())
        .toEqual({ status: 'posted', cancelled_at_utc: null });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_compensation_adjustments`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions WHERE entity_type='invoice'`).get())
        .toEqual({ applied_version: 1 });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-invoice-cancelled'`).get())
        .toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('fails closed when the invoice is no longer unpaid and uncredited', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE canonical_invoices SET paid_minor=100,due_minor=800,net_due_minor=800`).run();
      await expect(apply(db)).rejects.toThrow();
      expect(sqlite.prepare(`SELECT status FROM canonical_invoices`).get()).toEqual({ status: 'posted' });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_compensation_adjustments`).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
});

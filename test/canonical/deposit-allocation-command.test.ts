import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  applyAvailableDeposits,
  refundAvailableDeposits,
} from '../../src/lib/canonical/commands/allocate-deposit-balance';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      controls.beforeBatch?.(sqlite);
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

function seedReceiptAndDeposit(
  sqlite: DatabaseSync,
  input: {
    depositPublicId: string;
    depositNumber: string;
    receiptPublicId: string;
    amountMinor: number;
    receivedAtUtc: string;
    patientId?: number;
  },
): void {
  const patientId = input.patientId ?? 101;
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES ('tenant-a',?,?,?,?,?,0,?,'posted',?,'2026-07-14',?,1,?,0,?,1)
  `).run(
    input.receiptPublicId,
    input.depositNumber,
    patientId,
    'BDT',
    input.amountMinor,
    input.amountMinor,
    input.receivedAtUtc,
    input.receivedAtUtc,
    'a'.repeat(64),
    input.amountMinor,
  );
  sqlite.prepare(`
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
      currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
      received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?, 'BDT',?,0,0,?,'posted',?,'2026-07-14',?,1,?)
  `).run(
    input.depositPublicId,
    input.depositNumber,
    input.receiptPublicId,
    patientId,
    input.amountMinor,
    input.amountMinor,
    input.receivedAtUtc,
    input.receivedAtUtc,
    'b'.repeat(64),
  );
}

function seedInvoice(sqlite: DatabaseSync, totalMinor = 7_000): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','inv-1','INV-1',101,'BDT',?,0,?,0,?,0,?,1,'posted',?,?,?)
  `).run(
    totalMinor,
    totalMinor,
    totalMinor,
    totalMinor,
    '2026-07-14T02:00:00.000Z',
    '2026-07-14T02:00:00.000Z',
    'c'.repeat(64),
  );
}

function seedTwoDeposits(sqlite: DatabaseSync): void {
  seedReceiptAndDeposit(sqlite, {
    depositPublicId: 'dep-oldest',
    depositNumber: 'DEP-OLD',
    receiptPublicId: 'receipt-old',
    amountMinor: 3_000,
    receivedAtUtc: '2026-07-10T03:00:00.000Z',
  });
  seedReceiptAndDeposit(sqlite, {
    depositPublicId: 'dep-newer',
    depositNumber: 'DEP-NEW',
    receiptPublicId: 'receipt-new',
    amountMinor: 4_000,
    receivedAtUtc: '2026-07-11T03:00:00.000Z',
  });
}

const sourceIdentity = {
  tenantId: 'tenant-a',
  legacyPatientId: 101,
  amountMinor: 5_000,
  occurredAtUtc: '2026-07-14T05:00:00.000Z',
  businessDate: '2026-07-14',
  sourceType: 'legacy_live_deposit_operation',
  sourcePublicId: 'DOP-1',
  sourceTable: 'billing_deposits',
  sourceEvidenceSha256: 'd'.repeat(64),
  idempotencyKey: 'deposit-operation:DOP-1',
  outboxEventPublicId: 'outbox-deposit-operation-1',
};

describe('multi-source canonical deposit commands', () => {
  it('refunds oldest available deposits in one batch', async () => {
    const { sqlite, db } = harness();
    seedTwoDeposits(sqlite);

    const result = await refundAvailableDeposits(db, {
      ...sourceIdentity,
      operationPublicId: 'deposit-refund-op-1',
      tenderType: 'cash',
      methodCode: 'cash',
    }, {
      authoritativeStatements: [
        db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)').bind('tenant-a', 'legacy-refund-1'),
      ],
    });

    expect(result.status).toBe('applied');
    expect(result.result.allocations).toEqual([
      expect.objectContaining({ depositPublicId: 'dep-oldest', amountMinor: 3_000, availableMinor: 0 }),
      expect.objectContaining({ depositPublicId: 'dep-newer', amountMinor: 2_000, availableMinor: 2_000 }),
    ]);
    expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_refunds').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) count FROM legacy_financial').get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT available_minor,refunded_minor FROM canonical_deposits WHERE deposit_public_id='dep-oldest'").get())
      .toEqual({ available_minor: 0, refunded_minor: 3_000 });
  });

  it('applies multiple deposits to one invoice with one final invoice update', async () => {
    const { sqlite, db } = harness();
    seedTwoDeposits(sqlite);
    seedInvoice(sqlite);

    const result = await applyAvailableDeposits(db, {
      ...sourceIdentity,
      operationPublicId: 'deposit-apply-op-1',
      invoicePublicId: 'inv-1',
      invoiceLinePublicId: null,
    }, {
      authoritativeStatements: [
        db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)').bind('tenant-a', 'legacy-apply-1'),
      ],
    });

    expect(result.status).toBe('applied');
    expect(result.result.allocations.map((row) => [row.depositPublicId, row.amountMinor])).toEqual([
      ['dep-oldest', 3_000],
      ['dep-newer', 2_000],
    ]);
    expect(result.result.invoiceNetDueMinor).toBe(2_000);
    expect(sqlite.prepare('SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id=?').get('inv-1'))
      .toEqual({ paid_minor: 5_000, due_minor: 2_000, net_due_minor: 2_000 });
    expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_deposit_applications').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) count FROM legacy_financial').get()).toEqual({ count: 1 });
  });

  it('rejects insufficient balance before the legacy authority is written', async () => {
    const { sqlite, db } = harness();
    seedTwoDeposits(sqlite);

    await expect(refundAvailableDeposits(db, {
      ...sourceIdentity,
      amountMinor: 7_001,
      operationPublicId: 'deposit-refund-op-insufficient',
      tenderType: 'card',
      methodCode: 'card',
    }, {
      authoritativeStatements: [
        db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)').bind('tenant-a', 'must-not-write'),
      ],
    })).rejects.toThrow(/insufficient/i);

    expect(sqlite.prepare('SELECT COUNT(*) count FROM legacy_financial').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_refunds').get()).toEqual({ count: 0 });
  });

  it('rolls back legacy and canonical writes when a source balance changes before commit', async () => {
    let changed = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (changed) return;
        changed = true;
        database.prepare(`
          UPDATE canonical_deposits
          SET refunded_minor=1000,available_minor=2000
          WHERE tenant_id='tenant-a' AND deposit_public_id='dep-oldest'
        `).run();
      },
    });
    seedTwoDeposits(sqlite);

    await expect(refundAvailableDeposits(db, {
      ...sourceIdentity,
      operationPublicId: 'deposit-refund-op-race',
      tenderType: 'card',
      methodCode: 'card',
    }, {
      authoritativeStatements: [
        db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)').bind('tenant-a', 'legacy-race'),
      ],
    })).rejects.toThrow();

    expect(sqlite.prepare('SELECT COUNT(*) count FROM legacy_financial').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_refunds').get()).toEqual({ count: 0 });
  });

  it('replays the aggregate operation without duplicate source rows', async () => {
    const { sqlite, db } = harness();
    seedTwoDeposits(sqlite);
    const input = {
      ...sourceIdentity,
      operationPublicId: 'deposit-refund-op-replay',
      tenderType: 'card' as const,
      methodCode: 'card',
    };

    const first = await refundAvailableDeposits(db, input);
    const second = await refundAvailableDeposits(db, input);

    expect(first.status).toBe('applied');
    expect(second.status).toBe('replayed');
    expect(second.result).toEqual(first.result);
    expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_refunds').get()).toEqual({ count: 2 });
  });
});

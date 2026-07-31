import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import type { CollectPaymentInput } from '../../src/lib/canonical/commands/collect-payment';
import type { RecordDepositInput } from '../../src/lib/canonical/commands/apply-deposit';
import { settleGatewayPayment } from '../../src/lib/canonical/commands/settle-gateway-payment';

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
    CREATE TABLE legacy_gateway_settlements (
      tenant_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      UNIQUE (tenant_id, payment_id)
    );
  `);

  let beforeBatchCalled = false;
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      if (!beforeBatchCalled) {
        beforeBatchCalled = true;
        controls.beforeBatch?.(sqlite);
      }
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

  seedInvoice(sqlite);
  return { sqlite, db };
}

function seedInvoice(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','invoice-1','INV-1',101,'BDT',10000,0,10000,0,10000,0,10000,1,'posted',?,?,?)
  `).run(
    '2026-07-24T05:00:00.000Z',
    '2026-07-24T05:00:00.000Z',
    'a'.repeat(64),
  );
}

function payment(overrides: Partial<CollectPaymentInput> = {}): CollectPaymentInput {
  return {
    tenantId: 'tenant-a',
    receiptPublicId: 'gateway-payment-receipt-1',
    receiptNumber: 'GW-RCPT-1',
    legacyPatientId: 101,
    currencyCode: 'BDT',
    receivedAtUtc: '2026-07-24T05:30:00.000Z',
    businessDate: '2026-07-24',
    legacyCollectorId: 7,
    legacyCounterId: null,
    legacyCounterSessionId: null,
    externalTransactionId: 'gateway-tx-1',
    tenders: [{
      tenderPublicId: 'gateway-payment-tender-1',
      tenderType: 'gateway',
      methodCode: 'sslcommerz',
      amountMinor: 6000,
      status: 'captured',
      externalTransactionId: 'gateway-tx-1',
      sourceEvidenceSha256: 'b'.repeat(64),
    }],
    allocations: [{
      allocationPublicId: 'gateway-allocation-1',
      invoicePublicId: 'invoice-1',
      invoiceLinePublicId: null,
      amountMinor: 6000,
      sourceEvidenceSha256: 'c'.repeat(64),
    }],
    unallocatedMinor: 0,
    sourceType: 'payment_gateway_log',
    sourcePublicId: 'gateway-log-1:payment',
    sourceTable: 'payment_gateway_logs',
    sourceEvidenceSha256: 'd'.repeat(64),
    idempotencyKey: 'gateway-payment-child-1',
    outboxEventPublicId: 'gateway-payment-event-1',
    cashCustodyEventPublicId: null,
    ...overrides,
  };
}

function advanceDeposit(overrides: Partial<RecordDepositInput> = {}): RecordDepositInput {
  return {
    tenantId: 'tenant-a',
    depositPublicId: 'gateway-deposit-1',
    depositNumber: 'ADV-GW-1',
    receiptPublicId: 'gateway-advance-receipt-1',
    receiptAuthority: {
      legacyPatientId: 101,
      currencyCode: 'BDT',
      amountMinor: 4000,
      tenderPublicId: 'gateway-advance-tender-1',
      tenderType: 'gateway',
      methodCode: 'sslcommerz',
      receivedAtUtc: '2026-07-24T05:30:00.000Z',
      businessDate: '2026-07-24',
      sourceEvidenceSha256: 'e'.repeat(64),
    },
    sourceType: 'payment_gateway_log',
    sourcePublicId: 'gateway-log-1:advance',
    sourceTable: 'payment_gateway_logs',
    sourceEvidenceSha256: 'f'.repeat(64),
    idempotencyKey: 'gateway-advance-child-1',
    outboxEventPublicId: 'gateway-deposit-event-1',
    ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    commandIdempotencyKey: 'gateway-settlement-1',
    commandOutboxEventPublicId: 'gateway-settlement-event-1',
    occurredAtUtc: '2026-07-24T05:30:00.000Z',
    businessDate: '2026-07-24',
    payment: payment(),
    advanceDeposit: null,
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('settleGatewayPayment', () => {
  it('atomically posts an invoice-only gateway payment', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(settleGatewayPayment(db, command())).resolves.toEqual({
        status: 'applied',
        result: {
          paymentReceiptPublicId: 'gateway-payment-receipt-1',
          advanceDepositPublicId: null,
          appliedToBillMinor: 6000,
          depositMinor: 0,
          totalMinor: 6000,
        },
      });

      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(1);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(1);
      expect(count(sqlite, 'canonical_deposits')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='invoice-1'
      `).get()).toEqual({ paid_minor: 6000, due_minor: 4000, net_due_minor: 4000 });
      expect(count(sqlite, 'canonical_outbox_events')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('atomically posts an advance-only gateway deposit backed by a separate unallocated receipt', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(settleGatewayPayment(db, command({
        payment: null,
        advanceDeposit: advanceDeposit(),
      }))).resolves.toMatchObject({
        status: 'applied',
        result: {
          paymentReceiptPublicId: null,
          advanceDepositPublicId: 'gateway-deposit-1',
          appliedToBillMinor: 0,
          depositMinor: 4000,
          totalMinor: 4000,
        },
      });

      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(1);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(0);
      expect(count(sqlite, 'canonical_deposits')).toBe(1);
      expect(sqlite.prepare(`
        SELECT total_minor,allocated_total_minor,unallocated_minor,status
        FROM canonical_payment_receipts
      `).get()).toEqual({
        total_minor: 4000,
        allocated_total_minor: 0,
        unallocated_minor: 4000,
        status: 'posted',
      });
      expect(sqlite.prepare(`
        SELECT amount_minor,available_minor,status FROM canonical_deposits
      `).get()).toEqual({ amount_minor: 4000, available_minor: 4000, status: 'posted' });
      expect(count(sqlite, 'canonical_outbox_events')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('commits split bill payment, advance deposit, and authoritative legacy statements in one batch', async () => {
    const { sqlite, db } = harness();
    try {
      const authoritativeStatements = [
        db.prepare(`INSERT INTO legacy_gateway_settlements (tenant_id,payment_id) VALUES (?,?)`)
          .bind('tenant-a', 'gateway-tx-1'),
      ];
      await expect(settleGatewayPayment(db, command({
        advanceDeposit: advanceDeposit(),
      }), { authoritativeStatements })).resolves.toMatchObject({
        status: 'applied',
        result: { appliedToBillMinor: 6000, depositMinor: 4000, totalMinor: 10000 },
      });

      expect(count(sqlite, 'legacy_gateway_settlements')).toBe(1);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(2);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(2);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(1);
      expect(count(sqlite, 'canonical_deposits')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(3);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(3);
    } finally {
      sqlite.close();
    }
  });

  it('replays identical evidence and rejects conflicting evidence under the same command key', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(settleGatewayPayment(db, command())).resolves.toMatchObject({ status: 'applied' });
      await expect(settleGatewayPayment(db, command())).resolves.toMatchObject({ status: 'replayed' });

      const changedPayment = payment({
        tenders: [{ ...payment().tenders[0], amountMinor: 5000 }],
        allocations: [{ ...payment().allocations[0], amountMinor: 5000 }],
      });
      await expect(settleGatewayPayment(db, command({ payment: changedPayment })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back authoritative legacy and canonical facts when the invoice becomes stale before commit', async () => {
    const { sqlite, db } = harness({
      beforeBatch(database) {
        database.prepare(`
          UPDATE canonical_invoices
          SET paid_minor=1000,due_minor=9000,net_due_minor=9000
          WHERE invoice_public_id='invoice-1'
        `).run();
      },
    });
    try {
      const authoritativeStatements = [
        db.prepare(`INSERT INTO legacy_gateway_settlements (tenant_id,payment_id) VALUES (?,?)`)
          .bind('tenant-a', 'gateway-tx-1'),
      ];
      await expect(settleGatewayPayment(db, command(), { authoritativeStatements })).rejects.toThrow();

      expect(count(sqlite, 'legacy_gateway_settlements')).toBe(0);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='invoice-1'
      `).get()).toEqual({ paid_minor: 1000, due_minor: 9000 });
    } finally {
      sqlite.close();
    }
  });
});

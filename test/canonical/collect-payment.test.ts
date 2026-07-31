import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import { collectPayment } from '../../src/lib/canonical/commands/collect-payment';

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

  seedInvoice(sqlite, {
    invoicePublicId: 'inv-1',
    invoiceNumber: 'INV-1',
    totalMinor: 10000,
  });
  seedInvoice(sqlite, {
    invoicePublicId: 'inv-2',
    invoiceNumber: 'INV-2',
    totalMinor: 10000,
  });

  return { sqlite, db };
}

function seedInvoice(
  sqlite: DatabaseSync,
  input: {
    tenantId?: string;
    invoicePublicId: string;
    invoiceNumber: string;
    patientId?: number;
    currencyCode?: string;
    totalMinor: number;
  },
): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,0,?,0,?,0,?,1,'posted',?,?,?)
  `).run(
    input.tenantId ?? 'tenant-a',
    input.invoicePublicId,
    input.invoiceNumber,
    input.patientId ?? 101,
    input.currencyCode ?? 'BDT',
    input.totalMinor,
    input.totalMinor,
    input.totalMinor,
    input.totalMinor,
    '2026-07-14T03:00:00.000Z',
    '2026-07-14T03:00:00.000Z',
    'a'.repeat(64),
  );
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    receiptPublicId: 'rcpt-1',
    receiptNumber: 'RCPT-1',
    legacyPatientId: 101,
    currencyCode: 'BDT',
    receivedAtUtc: '2026-07-14T03:30:00.000Z',
    businessDate: '2026-07-14',
    legacyCollectorId: 7,
    legacyCounterId: 3,
    legacyCounterSessionId: 9,
    externalTransactionId: null,
    tenders: [
      {
        tenderPublicId: 'tender-cash-1',
        tenderType: 'cash' as const,
        methodCode: 'cash',
        amountMinor: 5000,
        status: 'captured' as const,
        externalTransactionId: null,
        sourceEvidenceSha256: 'b'.repeat(64),
      },
      {
        tenderPublicId: 'tender-card-1',
        tenderType: 'card' as const,
        methodCode: 'card',
        amountMinor: 10000,
        status: 'captured' as const,
        externalTransactionId: 'card-tx-1',
        sourceEvidenceSha256: 'c'.repeat(64),
      },
    ],
    allocations: [
      {
        allocationPublicId: 'alloc-1',
        invoicePublicId: 'inv-1',
        invoiceLinePublicId: null,
        amountMinor: 8000,
        sourceEvidenceSha256: 'd'.repeat(64),
      },
      {
        allocationPublicId: 'alloc-2',
        invoicePublicId: 'inv-2',
        invoiceLinePublicId: null,
        amountMinor: 4000,
        sourceEvidenceSha256: 'e'.repeat(64),
      },
    ],
    unallocatedMinor: 3000,
    sourceType: 'runtime_payment',
    sourcePublicId: 'runtime-payment-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'f'.repeat(64),
    idempotencyKey: 'collect-payment-1',
    outboxEventPublicId: 'outbox-payment-1',
    cashCustodyEventPublicId: 'outbox-cash-1',
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('collect canonical payment command', () => {
  it('atomically posts split tenders, multi-invoice allocations, exact balances, mappings, and PHI-free outbox events', async () => {
    const { sqlite, db } = harness();
    try {
      expect(await collectPayment(db, input())).toEqual({
        status: 'applied',
        result: {
          receiptPublicId: 'rcpt-1',
          status: 'posted',
          totalMinor: 15000,
          allocatedMinor: 12000,
          unallocatedMinor: 3000,
          cashTenderMinor: 5000,
        },
      });

      expect(sqlite.prepare(`
        SELECT total_minor,allocated_total_minor,unallocated_minor,status
        FROM canonical_payment_receipts
      `).get()).toEqual({
        total_minor: 15000,
        allocated_total_minor: 12000,
        unallocated_minor: 3000,
        status: 'posted',
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_tenders')).toBe(2);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_allocations')).toBe(2);
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
        paid_minor: 8000,
        due_minor: 2000,
      });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-2'`).get()).toEqual({
        paid_minor: 4000,
        due_minor: 6000,
      });
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='payment_receipt'")).toBe(1);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(2);

      const primary = sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events WHERE idempotency_key='collect-payment-1'`).get() as { payload_json: string };
      expect(primary.payload_json).not.toContain('legacyPatientId');
      expect(primary.payload_json).not.toContain('101');
      expect(JSON.parse(primary.payload_json).event).toEqual({
        allocatedMinor: 12000,
        cashTenderMinor: 5000,
        receiptPublicId: 'rcpt-1',
        status: 'posted',
        totalMinor: 15000,
        unallocatedMinor: 3000,
      });

      const cash = sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events WHERE event_public_id='outbox-cash-1'`).get() as { payload_json: string };
      expect(cash.payload_json).not.toContain('legacyPatientId');
      expect(JSON.parse(cash.payload_json)).toEqual({
        cashAmountMinor: 5000,
        counterId: 3,
        counterSessionId: 9,
        receiptPublicId: 'rcpt-1',
      });
    } finally { sqlite.close(); }
  });

  it('replays safely and rejects semantic idempotency conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      await collectPayment(db, input());
      expect(await collectPayment(db, input())).toMatchObject({ status: 'replayed' });
      await expect(collectPayment(db, input({ receiptNumber: 'RCPT-CHANGED' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_receipts')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('persists a verifying gateway receipt without allocations or invoice balance changes', async () => {
    const { sqlite, db } = harness();
    try {
      const gatewayInput = input({
        receiptPublicId: 'rcpt-gateway',
        receiptNumber: 'RCPT-GATEWAY',
        tenders: [{
          tenderPublicId: 'tender-gateway',
          tenderType: 'gateway',
          methodCode: 'gateway',
          amountMinor: 10000,
          status: 'verifying',
          externalTransactionId: 'gateway-tx-1',
          sourceEvidenceSha256: '1'.repeat(64),
        }],
        allocations: [],
        unallocatedMinor: 10000,
        sourcePublicId: 'runtime-payment-gateway',
        sourceEvidenceSha256: '2'.repeat(64),
        idempotencyKey: 'collect-payment-gateway',
        outboxEventPublicId: 'outbox-payment-gateway',
        cashCustodyEventPublicId: null,
      });
      expect(await collectPayment(db, gatewayInput)).toMatchObject({
        status: 'applied',
        result: { status: 'pending', totalMinor: 10000, allocatedMinor: 0, unallocatedMinor: 10000 },
      });
      expect(sqlite.prepare(`SELECT status,posted_at_utc,failed_at_utc FROM canonical_payment_receipts`).get()).toEqual({
        status: 'pending',
        posted_at_utc: null,
        failed_at_utc: null,
      });
      expect(sqlite.prepare(`SELECT status FROM canonical_payment_tenders`).get()).toEqual({ status: 'verifying' });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
        paid_minor: 0,
        due_minor: 10000,
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_allocations')).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('does not emit cash-custody authority for failed cash tenders', async () => {
    const { sqlite, db } = harness();
    try {
      expect(await collectPayment(db, input({
        receiptPublicId: 'rcpt-failed-cash',
        receiptNumber: 'RCPT-FAILED-CASH',
        tenders: [{
          tenderPublicId: 'tender-failed-cash',
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: 5000,
          status: 'failed',
          externalTransactionId: null,
          sourceEvidenceSha256: '9'.repeat(64),
        }],
        allocations: [],
        unallocatedMinor: 5000,
        sourcePublicId: 'runtime-payment-failed-cash',
        sourceEvidenceSha256: '0'.repeat(64),
        idempotencyKey: 'collect-payment-failed-cash',
        outboxEventPublicId: 'outbox-payment-failed-cash',
        cashCustodyEventPublicId: null,
      }))).toMatchObject({
        status: 'applied',
        result: { status: 'failed', cashTenderMinor: 0 },
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE aggregate_type='canonical_cash_custody'")).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rejects over-allocation and exact reconciliation mismatches without partial state', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(collectPayment(db, input({
        tenders: [{
          tenderPublicId: 'tender-overpay',
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: 11000,
          status: 'captured',
          externalTransactionId: null,
          sourceEvidenceSha256: '3'.repeat(64),
        }],
        allocations: [{
          allocationPublicId: 'alloc-overpay',
          invoicePublicId: 'inv-1',
          invoiceLinePublicId: null,
          amountMinor: 11000,
          sourceEvidenceSha256: '4'.repeat(64),
        }],
        unallocatedMinor: 0,
      }))).rejects.toThrow(/outstanding balance/i);

      await expect(collectPayment(db, input({ unallocatedMinor: 2000 })))
        .rejects.toThrow(/receipt total must equal allocations plus unallocated balance/i);

      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_receipts')).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
        paid_minor: 0,
        due_minor: 10000,
      });
    } finally { sqlite.close(); }
  });

  it('rejects mixed tender lifecycle, duplicate ids, and cross-tenant invoice allocations', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, {
      tenantId: 'tenant-b',
      invoicePublicId: 'inv-b',
      invoiceNumber: 'INV-B',
      totalMinor: 5000,
    });
    try {
      await expect(collectPayment(db, input({
        tenders: [
          {
            tenderPublicId: 'tender-duplicate',
            tenderType: 'cash',
            methodCode: 'cash',
            amountMinor: 5000,
            status: 'captured',
            externalTransactionId: null,
            sourceEvidenceSha256: '5'.repeat(64),
          },
          {
            tenderPublicId: 'tender-duplicate',
            tenderType: 'gateway',
            methodCode: 'gateway',
            amountMinor: 10000,
            status: 'verifying',
            externalTransactionId: 'gateway-mixed',
            sourceEvidenceSha256: '6'.repeat(64),
          },
        ],
        allocations: [],
        unallocatedMinor: 15000,
      }))).rejects.toThrow(/duplicate tenderPublicId|tender statuses must agree/);

      await expect(collectPayment(db, input({
        tenders: [{
          tenderPublicId: 'tender-cross',
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: 5000,
          status: 'captured',
          externalTransactionId: null,
          sourceEvidenceSha256: '7'.repeat(64),
        }],
        allocations: [{
          allocationPublicId: 'alloc-cross',
          invoicePublicId: 'inv-b',
          invoiceLinePublicId: null,
          amountMinor: 5000,
          sourceEvidenceSha256: '8'.repeat(64),
        }],
        unallocatedMinor: 0,
      }))).rejects.toThrow(/invoice not found/i);

      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_receipts')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back a stale invoice-balance batch using triggerless allocation guards', async () => {
    let injected = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (injected) return;
        injected = true;
        database.prepare(`
          UPDATE canonical_invoices
          SET paid_minor=1000,due_minor=9000,net_due_minor=9000
          WHERE tenant_id='tenant-a' AND invoice_public_id='inv-1'
        `).run();
      },
    });
    try {
      await expect(collectPayment(db, input({
        tenders: [{
          tenderPublicId: 'tender-stale',
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: 10000,
          status: 'captured',
          externalTransactionId: null,
          sourceEvidenceSha256: 'a'.repeat(64),
        }],
        allocations: [{
          allocationPublicId: 'alloc-stale',
          invoicePublicId: 'inv-1',
          invoiceLinePublicId: null,
          amountMinor: 10000,
          sourceEvidenceSha256: 'b'.repeat(64),
        }],
        unallocatedMinor: 0,
        sourcePublicId: 'runtime-payment-stale',
        sourceEvidenceSha256: 'c'.repeat(64),
        idempotencyKey: 'collect-payment-stale',
        outboxEventPublicId: 'outbox-payment-stale',
        cashCustodyEventPublicId: 'outbox-cash-stale',
      }))).rejects.toThrow(/stale_invoice_balance_guard|stale invoice balance/i);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_receipts')).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='collect-payment-stale'")).toBe(0);
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
        paid_minor: 1000,
        due_minor: 9000,
      });
    } finally { sqlite.close(); }
  });

  it('rolls back receipt, invoice balances, primary outbox, and mapping when the cash-custody event conflicts', async () => {
    const { sqlite, db } = harness();
    sqlite.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        payload_json,occurred_at_utc,idempotency_key,status
      ) VALUES ('tenant-a','outbox-cash-1','existing','existing','existing.event',
                '{}','2026-07-14T03:00:00.000Z','existing-cash-event','pending')
    `).run();
    try {
      await expect(collectPayment(db, input())).rejects.toThrow(/UNIQUE constraint failed/);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_payment_receipts')).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='collect-payment-1'")).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='payment_receipt'")).toBe(0);
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
        paid_minor: 0,
        due_minor: 10000,
      });
    } finally { sqlite.close(); }
  });

  it('commits authoritative legacy payment state and rolls it back on canonical failure', async () => {
    const { sqlite, db } = harness();
    try {
      await collectPayment(db, input(), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
            .bind('tenant-a', 'payment-success'),
        ],
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

      sqlite.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          payload_json,occurred_at_utc,idempotency_key,status
        ) VALUES ('tenant-a','outbox-cash-failure','existing','existing','existing.event',
                  '{}','2026-07-14T03:00:00.000Z','existing-cash-failure','pending')
      `).run();

      await expect(collectPayment(db, input({
        receiptPublicId: 'rcpt-failure',
        receiptNumber: 'RCPT-FAILURE',
        tenders: [{
          tenderPublicId: 'tender-failure',
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: 1000,
          status: 'captured',
          externalTransactionId: null,
          sourceEvidenceSha256: '7'.repeat(64),
        }],
        allocations: [{
          allocationPublicId: 'alloc-failure',
          invoicePublicId: 'inv-1',
          invoiceLinePublicId: null,
          amountMinor: 1000,
          sourceEvidenceSha256: '8'.repeat(64),
        }],
        unallocatedMinor: 0,
        sourcePublicId: 'runtime-payment-failure',
        sourceEvidenceSha256: '9'.repeat(64),
        idempotencyKey: 'collect-payment-failure',
        outboxEventPublicId: 'outbox-payment-failure',
        cashCustodyEventPublicId: 'outbox-cash-failure',
      }), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
            .bind('tenant-a', 'payment-rollback'),
        ],
      })).rejects.toThrow(/UNIQUE constraint failed/);

      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
    } finally { sqlite.close(); }
  });
});

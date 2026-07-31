import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  issueInvoiceWithFullPayment,
  type IssueInvoiceWithFullPaymentInput,
} from '../../src/lib/canonical/commands/issue-invoice-full-payment';

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
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
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

const MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
] as const;

const NOW = '2026-07-23T12:00:00.000Z';
const DATE = '2026-07-23';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function harness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  sqlite.exec(`
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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

function input(overrides: Partial<IssueInvoiceWithFullPaymentInput> = {}): IssueInvoiceWithFullPaymentInput {
  const base: IssueInvoiceWithFullPaymentInput = {
    tenantId: '100',
    commandIdempotencyKey: 'appointment-paid:100:77:INV-1:RCP-1',
    invoice: {
      tenantId: '100',
      invoicePublicId: 'invoice-full-1',
      invoiceNumber: 'INV-1',
      legacyPatientId: 501,
      currencyCode: 'BDT',
      issuedAtUtc: NOW,
      businessDate: DATE,
      lines: [{
        linePublicId: 'invoice-line-full-1',
        lineType: 'other_adjustment',
        serviceEventPublicId: null,
        adjustmentCode: 'APPOINTMENT_DOCTOR_VISIT',
        quantity: 1,
        unitAmountMinor: 100_000,
        sourceEvidenceSha256: HASH_A,
      }],
      sourceType: 'legacy_appointment_bill',
      sourcePublicId: 'appointment:77:INV-1',
      sourceTable: 'bills',
      sourceEvidenceSha256: HASH_B,
      idempotencyKey: 'invoice-inner-unused',
      outboxEventPublicId: 'outbox-invoice-full-1',
    },
    payment: {
      receiptPublicId: 'receipt-full-1',
      receiptNumber: 'RCP-1',
      tenderPublicId: 'tender-full-1',
      allocationPublicId: 'allocation-full-1',
      tenderType: 'cash',
      methodCode: 'cash',
      amountMinor: 100_000,
      externalTransactionId: null,
      legacyCollectorId: 9,
      legacyCounterId: 3,
      legacyCounterSessionId: 30,
      receivedAtUtc: NOW,
      sourceType: 'legacy_appointment_payment',
      sourcePublicId: 'RCP-1',
      sourceTable: 'payments',
      sourceEvidenceSha256: HASH_C,
      paymentOutboxEventPublicId: 'outbox-payment-full-1',
      cashCustodyEventPublicId: 'outbox-cash-full-1',
    },
  };
  return {
    ...base,
    ...overrides,
    invoice: { ...base.invoice, ...(overrides.invoice ?? {}) },
    payment: { ...base.payment, ...(overrides.payment ?? {}) },
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

function countEvent(sqlite: DatabaseSync, eventType: string): number {
  return Number((sqlite.prepare(
    'SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type=?',
  ).get(eventType) as { count: number }).count);
}

describe('issueInvoiceWithFullPayment', () => {
  it('atomically creates a fully paid cash invoice and custody evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await issueInvoiceWithFullPayment(db, input());

      expect(result).toMatchObject({
        status: 'applied',
        result: {
          invoicePublicId: 'invoice-full-1',
          receiptPublicId: 'receipt-full-1',
          invoiceTotalMinor: 100_000,
          paidMinor: 100_000,
          cashTenderMinor: 100_000,
          status: 'paid',
        },
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor,status
        FROM canonical_invoices WHERE tenant_id='100' AND invoice_public_id='invoice-full-1'
      `).get()).toMatchObject({ paid_minor: 100_000, due_minor: 0, credited_minor: 0, net_due_minor: 0, status: 'posted' });
      expect(sqlite.prepare(`
        SELECT total_minor,allocated_total_minor,unallocated_minor,refunded_minor,
               net_received_minor,status,reconciliation_guard
        FROM canonical_payment_receipts WHERE tenant_id='100' AND receipt_public_id='receipt-full-1'
      `).get()).toMatchObject({
        total_minor: 100_000,
        allocated_total_minor: 100_000,
        unallocated_minor: 0,
        refunded_minor: 0,
        net_received_minor: 100_000,
        status: 'posted',
        reconciliation_guard: 1,
      });
      expect(countEvent(sqlite, 'canonical.invoice.issued')).toBe(1);
      expect(countEvent(sqlite, 'canonical.payment.receipt.posted')).toBe(1);
      expect(countEvent(sqlite, 'canonical.cash_custody.collection_recorded')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('creates no cash custody event for a captured card payment', async () => {
    const { sqlite, db } = harness();
    try {
      const cardInput = input({
        payment: {
          ...input().payment,
          tenderType: 'card',
          methodCode: 'card',
          externalTransactionId: 'CARD-TXN-1001',
          cashCustodyEventPublicId: null,
        },
      });
      const result = await issueInvoiceWithFullPayment(db, cardInput);
      expect(result.result.cashTenderMinor).toBe(0);
      expect(countEvent(sqlite, 'canonical.cash_custody.collection_recorded')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects non-cash payment without external transaction authority', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(issueInvoiceWithFullPayment(db, input({
        payment: {
          ...input().payment,
          tenderType: 'card',
          methodCode: 'card',
          externalTransactionId: null,
          cashCustodyEventPublicId: null,
        },
      }))).rejects.toThrow(/external transaction/i);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('requires payment amount to equal the invoice total', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(issueInvoiceWithFullPayment(db, input({
        payment: { ...input().payment, amountMinor: 90_000 },
      }))).rejects.toThrow(/equal invoice total/i);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('replays the same request and rejects a changed request under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const request = input();
      await expect(issueInvoiceWithFullPayment(db, request)).resolves.toMatchObject({ status: 'applied' });
      await expect(issueInvoiceWithFullPayment(db, request)).resolves.toMatchObject({ status: 'replayed' });
      await expect(issueInvoiceWithFullPayment(db, input({
        invoice: { ...request.invoice, invoiceNumber: 'INV-CHANGED' },
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back authoritative legacy rows when canonical state fails', async () => {
    const request = input();
    const { sqlite, db } = harness({
      beforeBatch(database) {
        database.prepare(`
          INSERT INTO canonical_invoices (
            tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
            subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
            credited_minor,net_due_minor,adjustment_projection_guard,status,
            issued_at_utc,posted_at_utc,source_evidence_sha256
          ) VALUES ('100','invoice-full-1','OTHER',501,'BDT',1,0,1,0,1,0,1,1,'posted',?,?,?)
        `).run(NOW, NOW, HASH_A);
      },
    });
    try {
      await expect(issueInvoiceWithFullPayment(db, request, {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)')
            .bind('100', 'legacy-bill-1'),
        ],
      })).rejects.toThrow();
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

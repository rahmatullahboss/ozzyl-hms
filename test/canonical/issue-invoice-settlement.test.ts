import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  issueInvoiceWithSettlement,
  type IssueInvoiceWithSettlementInput,
} from '../../src/lib/canonical/commands/issue-invoice-settlement';

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

function baseInput(overrides: Partial<IssueInvoiceWithSettlementInput> = {}): IssueInvoiceWithSettlementInput {
  const base: IssueInvoiceWithSettlementInput = {
    tenantId: '100',
    commandIdempotencyKey: 'provisional-settlement:INV-P-1',
    invoice: {
      tenantId: '100',
      invoicePublicId: 'invoice-settlement-1',
      invoiceNumber: 'INV-P-1',
      legacyPatientId: 501,
      currencyCode: 'BDT',
      issuedAtUtc: NOW,
      businessDate: DATE,
      lines: [{
        linePublicId: 'invoice-settlement-line-1',
        lineType: 'other_adjustment',
        serviceEventPublicId: null,
        adjustmentCode: 'PROVISIONAL_TEST',
        quantity: 1,
        unitAmountMinor: 100_000,
        sourceEvidenceSha256: HASH_A,
      }],
      sourceType: 'legacy_live_bill',
      sourcePublicId: 'INV-P-1',
      sourceTable: 'bills',
      sourceEvidenceSha256: HASH_B,
      idempotencyKey: 'legacy_live_bill:INV-P-1',
      outboxEventPublicId: 'outbox-invoice-settlement-1',
    },
    payment: null,
    deposit: null,
  };
  return {
    ...base,
    ...overrides,
    invoice: { ...base.invoice, ...(overrides.invoice ?? {}) },
    payment: overrides.payment === undefined ? base.payment : overrides.payment,
    deposit: overrides.deposit === undefined ? base.deposit : overrides.deposit,
  };
}

function payment(amountMinor = 40_000, overrides: Record<string, unknown> = {}) {
  return {
    receiptPublicId: 'receipt-settlement-1',
    receiptNumber: 'RCP-P-1',
    tenderPublicId: 'tender-settlement-1',
    allocationPublicId: 'allocation-settlement-1',
    tenderType: 'cash' as const,
    methodCode: 'cash',
    amountMinor,
    externalTransactionId: null,
    legacyCollectorId: 9,
    legacyCounterId: 3,
    legacyCounterSessionId: 30,
    receivedAtUtc: NOW,
    sourceType: 'legacy_live_payment',
    sourcePublicId: 'RCP-P-1',
    sourceTable: 'payments',
    sourceEvidenceSha256: HASH_C,
    paymentOutboxEventPublicId: 'outbox-payment-settlement-1',
    cashCustodyEventPublicId: 'outbox-cash-settlement-1',
    ...overrides,
  };
}

function deposit(amountMinor: number) {
  return {
    adjustmentNumber: 'DAD-P-1',
    amountMinor,
    appliedAtUtc: NOW,
    businessDate: DATE,
    sourceType: 'legacy_live_deposit',
    sourceTable: 'billing_deposits',
  };
}

function seedDeposit(
  sqlite: DatabaseSync,
  input: {
    depositPublicId: string;
    receiptPublicId: string;
    depositNumber: string;
    amountMinor: number;
    receivedAtUtc: string;
    patientId?: number;
  },
): void {
  const patientId = input.patientId ?? 501;
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES ('100',?,?,?,?,?,0,?,'posted',?,?,?,1,?,0,?,1)
  `).run(
    input.receiptPublicId,
    input.depositNumber,
    patientId,
    'BDT',
    input.amountMinor,
    input.amountMinor,
    input.receivedAtUtc,
    DATE,
    input.receivedAtUtc,
    HASH_A,
    input.amountMinor,
  );
  sqlite.prepare(`
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
      currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
      received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('100',?,?,?,?, 'BDT',?,0,0,?,'posted',?,?,?,1,?)
  `).run(
    input.depositPublicId,
    input.depositNumber,
    input.receiptPublicId,
    patientId,
    input.amountMinor,
    input.amountMinor,
    input.receivedAtUtc,
    DATE,
    input.receivedAtUtc,
    HASH_B,
  );
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

function countEvent(sqlite: DatabaseSync, eventType: string): number {
  return Number((sqlite.prepare(
    'SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type=?',
  ).get(eventType) as { count: number }).count);
}

describe('issueInvoiceWithSettlement', () => {
  it('creates a credit invoice with no settlement authority', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await issueInvoiceWithSettlement(db, baseInput());
      expect(result.result).toMatchObject({
        totalMinor: 100_000,
        paymentMinor: 0,
        depositMinor: 0,
        paidMinor: 0,
        dueMinor: 100_000,
        receiptPublicId: null,
        depositApplications: [],
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices
        WHERE invoice_public_id='invoice-settlement-1'
      `).get()).toEqual({ paid_minor: 0, due_minor: 100_000, net_due_minor: 100_000 });
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('creates a partially paid cash invoice', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await issueInvoiceWithSettlement(db, baseInput({ payment: payment() }));
      expect(result.result).toMatchObject({
        totalMinor: 100_000,
        paymentMinor: 40_000,
        depositMinor: 0,
        paidMinor: 40_000,
        dueMinor: 60_000,
        cashTenderMinor: 40_000,
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices
        WHERE invoice_public_id='invoice-settlement-1'
      `).get()).toEqual({ paid_minor: 40_000, due_minor: 60_000, net_due_minor: 60_000 });
      expect(sqlite.prepare(`
        SELECT invoice_due_before_minor,invoice_due_after_minor,amount_minor
        FROM canonical_payment_allocations
      `).get()).toEqual({ invoice_due_before_minor: 100_000, invoice_due_after_minor: 60_000, amount_minor: 40_000 });
      expect(countEvent(sqlite, 'canonical.cash_custody.collection_recorded')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('creates a fully paid non-cash invoice without cash custody authority', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await issueInvoiceWithSettlement(db, baseInput({
        payment: payment(100_000, {
          tenderType: 'card',
          methodCode: 'card',
          externalTransactionId: 'CARD-TX-100',
          cashCustodyEventPublicId: null,
        }),
      }));
      expect(result.result).toMatchObject({
        totalMinor: 100_000,
        paymentMinor: 100_000,
        depositMinor: 0,
        paidMinor: 100_000,
        dueMinor: 0,
        cashTenderMinor: 0,
      });
      expect(sqlite.prepare(`
        SELECT status,external_transaction_id,remaining_minor
        FROM canonical_payment_tenders
      `).get()).toEqual({
        status: 'captured',
        external_transaction_id: 'CARD-TX-100',
        remaining_minor: 100_000,
      });
      expect(countEvent(sqlite, 'canonical.cash_custody.collection_recorded')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices
        WHERE invoice_public_id='invoice-settlement-1'
      `).get()).toEqual({ paid_minor: 100_000, due_minor: 0, net_due_minor: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('allocates several deposits oldest first in the same invoice command', async () => {
    const { sqlite, db } = harness();
    try {
      seedDeposit(sqlite, {
        depositPublicId: 'deposit-old',
        receiptPublicId: 'deposit-receipt-old',
        depositNumber: 'DEP-OLD',
        amountMinor: 30_000,
        receivedAtUtc: '2026-07-20T08:00:00.000Z',
      });
      seedDeposit(sqlite, {
        depositPublicId: 'deposit-new',
        receiptPublicId: 'deposit-receipt-new',
        depositNumber: 'DEP-NEW',
        amountMinor: 50_000,
        receivedAtUtc: '2026-07-21T08:00:00.000Z',
      });

      const result = await issueInvoiceWithSettlement(db, baseInput({ deposit: deposit(60_000) }));
      expect(result.result.depositApplications.map((row) => [row.depositPublicId, row.amountMinor])).toEqual([
        ['deposit-old', 30_000],
        ['deposit-new', 30_000],
      ]);
      expect(result.result).toMatchObject({ depositMinor: 60_000, paidMinor: 60_000, dueMinor: 40_000 });
      expect(countEvent(sqlite, 'canonical.deposit.applied')).toBe(2);
      const applicationEvidence = sqlite.prepare(`
        SELECT a.application_public_id,a.source_evidence_sha256,m.evidence_sha256
        FROM canonical_deposit_applications a
        JOIN canonical_source_mappings m
          ON m.tenant_id=a.tenant_id
         AND m.entity_type='deposit_application'
         AND m.canonical_public_id=a.application_public_id
        ORDER BY a.application_public_id
      `).all() as Array<{
        application_public_id: string;
        source_evidence_sha256: string;
        evidence_sha256: string;
      }>;
      expect(applicationEvidence).toHaveLength(2);
      for (const row of applicationEvidence) {
        expect(row.source_evidence_sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(row.source_evidence_sha256).not.toBe(HASH_B);
        expect(row.evidence_sha256).toBe(row.source_evidence_sha256);
      }
      expect(new Set(applicationEvidence.map((row) => row.source_evidence_sha256)).size).toBe(2);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices
        WHERE invoice_public_id='invoice-settlement-1'
      `).get()).toEqual({ paid_minor: 60_000, due_minor: 40_000, net_due_minor: 40_000 });
      expect(sqlite.prepare("SELECT available_minor FROM canonical_deposits WHERE deposit_public_id='deposit-old'").get())
        .toEqual({ available_minor: 0 });
      expect(sqlite.prepare("SELECT available_minor FROM canonical_deposits WHERE deposit_public_id='deposit-new'").get())
        .toEqual({ available_minor: 20_000 });
    } finally {
      sqlite.close();
    }
  });

  it('combines deposit settlement with a partial direct payment', async () => {
    const { sqlite, db } = harness();
    try {
      seedDeposit(sqlite, {
        depositPublicId: 'deposit-only',
        receiptPublicId: 'deposit-receipt-only',
        depositNumber: 'DEP-ONLY',
        amountMinor: 30_000,
        receivedAtUtc: '2026-07-20T08:00:00.000Z',
      });
      const result = await issueInvoiceWithSettlement(db, baseInput({
        deposit: deposit(30_000),
        payment: payment(20_000),
      }));
      expect(result.result).toMatchObject({
        totalMinor: 100_000,
        depositMinor: 30_000,
        paymentMinor: 20_000,
        paidMinor: 50_000,
        dueMinor: 50_000,
      });
      expect(sqlite.prepare(`
        SELECT invoice_due_before_minor,invoice_due_after_minor FROM canonical_payment_allocations
      `).get()).toEqual({ invoice_due_before_minor: 70_000, invoice_due_after_minor: 50_000 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects settlement beyond invoice total and missing non-cash reference', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(issueInvoiceWithSettlement(db, baseInput({
        payment: payment(100_001),
      }))).rejects.toThrow(/exceeds invoice total/i);
      await expect(issueInvoiceWithSettlement(db, baseInput({
        payment: payment(40_000, {
          tenderType: 'card',
          methodCode: 'card',
          externalTransactionId: null,
          cashCustodyEventPublicId: null,
        }),
      }))).rejects.toThrow(/external transaction/i);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects insufficient canonical deposit coverage before authoritative legacy writes', async () => {
    const { sqlite, db } = harness();
    try {
      seedDeposit(sqlite, {
        depositPublicId: 'deposit-small',
        receiptPublicId: 'deposit-receipt-small',
        depositNumber: 'DEP-SMALL',
        amountMinor: 20_000,
        receivedAtUtc: '2026-07-20T08:00:00.000Z',
      });
      await expect(issueInvoiceWithSettlement(db, baseInput({ deposit: deposit(30_000) }), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)')
            .bind('100', 'legacy-must-not-write'),
        ],
      })).rejects.toThrow(/deposit balance is insufficient/i);
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back legacy and canonical rows when a deposit changes after preflight', async () => {
    let changed = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (changed) return;
        changed = true;
        database.prepare(`
          UPDATE canonical_deposits
          SET applied_minor=10_000,available_minor=20_000
          WHERE deposit_public_id='deposit-race'
        `).run();
      },
    });
    try {
      seedDeposit(sqlite, {
        depositPublicId: 'deposit-race',
        receiptPublicId: 'deposit-receipt-race',
        depositNumber: 'DEP-RACE',
        amountMinor: 30_000,
        receivedAtUtc: '2026-07-20T08:00:00.000Z',
      });
      await expect(issueInvoiceWithSettlement(db, baseInput({ deposit: deposit(30_000) }), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)')
            .bind('100', 'legacy-race'),
        ],
      })).rejects.toThrow();
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('replays the same request and rejects changed settlement under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const request = baseInput({ payment: payment(40_000) });
      await expect(issueInvoiceWithSettlement(db, request)).resolves.toMatchObject({ status: 'applied' });
      await expect(issueInvoiceWithSettlement(db, request)).resolves.toMatchObject({ status: 'replayed' });
      await expect(issueInvoiceWithSettlement(db, baseInput({ payment: payment(30_000) })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});

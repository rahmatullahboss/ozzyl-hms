import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  resolveLiveCreditNoteCashRefundFunding,
  type CreditNoteCashRefundFundingPlan,
} from '../../src/lib/canonical/live-credit-note-cash-refund';

type SqlValue = string | number | bigint | null | Uint8Array;

type AllResult<T> = { results: T[] };

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<AllResult<T>> {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
  }
}

interface RefundQueryDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): SqliteStatement;
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
  '0533_canonical_credit_note_cash_refunds.sql',
] as const;

const HASH = 'a'.repeat(64);
const NOW = '2026-07-23T11:00:00.000Z';
const DATE = '2026-07-23';

function createHarness(): { sqlite: DatabaseSync; db: RefundQueryDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  const db: RefundQueryDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { sqlite, db };
}

function seedInvoice(sqlite: DatabaseSync, tenantId = '100'): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,101,'BDT',20000,0,20000,15000,5000,0,5000,1,'posted',?,?,?)
  `).run(tenantId, `invoice-${tenantId}`, `INV-${tenantId}`, NOW, NOW, HASH);
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'invoice',?,'legacy_live_bill','INV-71','bills','mapped',1,?)
  `).run(tenantId, `invoice-${tenantId}`, HASH);
}

function seedReceipt(
  sqlite: DatabaseSync,
  input: {
    receiptId: string;
    receivedAtUtc: string;
    amountMinor: number;
    allocations?: Array<{ id: string; amountMinor: number }>;
    tenders: Array<{ id: string; type: string; method: string; amountMinor: number }>;
    tenantId?: string;
  },
): void {
  const tenantId = input.tenantId ?? '100';
  const allocations = input.allocations ?? [{ id: `${input.receiptId}-allocation`, amountMinor: input.amountMinor }];
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,refunded_minor,net_received_minor,
      refund_projection_guard,reconciliation_guard,source_evidence_sha256
    ) VALUES (?,?,?,101,'BDT',?,?,0,'posted',?,?,?,0,?,1,1,?)
  `).run(
    tenantId,
    input.receiptId,
    `RCP-${input.receiptId}`,
    input.amountMinor,
    input.amountMinor,
    input.receivedAtUtc,
    DATE,
    input.receivedAtUtc,
    input.amountMinor,
    HASH,
  );
  for (const allocation of allocations) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
        allocated_at_utc,reversed_minor,remaining_minor,reversal_projection_guard,
        balance_guard,source_evidence_sha256
      ) VALUES (?,?,?, ?,?,20000,?,'active',?,0,?,1,1,?)
    `).run(
      tenantId,
      allocation.id,
      input.receiptId,
      `invoice-${tenantId}`,
      allocation.amountMinor,
      20000 - allocation.amountMinor,
      input.receivedAtUtc,
      allocation.amountMinor,
      HASH,
    );
  }
  for (const tender of input.tenders) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,captured_at_utc,reversed_minor,remaining_minor,
        reversal_projection_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,'captured',?,0,?,1,?)
    `).run(
      tenantId,
      tender.id,
      input.receiptId,
      tender.type,
      tender.method,
      tender.amountMinor,
      input.receivedAtUtc,
      tender.amountMinor,
      HASH,
    );
  }
}

const authority = {
  tenantId: '100',
  creditNoteNo: 'CN-71',
  billId: 71,
  billInvoiceNo: 'INV-71',
  cashRefund: 30,
  refundedAtUtc: NOW,
};

function expectPlanTotals(plan: CreditNoteCashRefundFundingPlan, expectedMinor: number): void {
  expect(plan.receiptSlices.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(expectedMinor);
  expect(plan.allocationSlices.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(expectedMinor);
  expect(plan.tenderAttributions.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(expectedMinor);
}

describe('live credit-note cash-refund funding resolver', () => {
  it('resolves one cash receipt into deterministic receipt, allocation, and tender slices', async () => {
    const { sqlite, db } = createHarness();
    try {
      seedInvoice(sqlite);
      seedReceipt(sqlite, {
        receiptId: 'receipt-cash',
        receivedAtUtc: '2026-07-23T10:00:00.000Z',
        amountMinor: 5000,
        tenders: [{ id: 'tender-cash', type: 'cash', method: 'cash', amountMinor: 5000 }],
      });

      const plan = await resolveLiveCreditNoteCashRefundFunding(db, authority);

      expect(plan.invoicePublicId).toBe('invoice-100');
      expect(plan.refundPublicId).toMatch(/^crrefund_/);
      expect(plan.receiptSlices).toEqual([
        expect.objectContaining({ receiptPublicId: 'receipt-cash', amountMinor: 3000, receiptRefundedBeforeMinor: 0, receiptNetReceivedBeforeMinor: 5000 }),
      ]);
      expect(plan.allocationSlices).toEqual([
        expect.objectContaining({ receiptPublicId: 'receipt-cash', allocationPublicId: 'receipt-cash-allocation', amountMinor: 3000, allocationRemainingBeforeMinor: 5000 }),
      ]);
      expect(plan.tenderAttributions).toEqual([
        expect.objectContaining({ tenderPublicId: 'tender-cash', amountMinor: 3000, tenderType: 'cash', attributableBeforeMinor: 5000 }),
      ]);
      expectPlanTotals(plan, 3000);
    } finally {
      sqlite.close();
    }
  });

  it('uses an older cash-funded receipt before a newer card-only receipt', async () => {
    const { sqlite, db } = createHarness();
    try {
      seedInvoice(sqlite);
      seedReceipt(sqlite, {
        receiptId: 'receipt-card-new',
        receivedAtUtc: '2026-07-23T10:30:00.000Z',
        amountMinor: 4000,
        tenders: [{ id: 'tender-card-new', type: 'card', method: 'visa', amountMinor: 4000 }],
      });
      seedReceipt(sqlite, {
        receiptId: 'receipt-cash-old',
        receivedAtUtc: '2026-07-23T09:00:00.000Z',
        amountMinor: 4000,
        tenders: [{ id: 'tender-cash-old', type: 'cash', method: 'cash', amountMinor: 4000 }],
      });

      const plan = await resolveLiveCreditNoteCashRefundFunding(db, { ...authority, cashRefund: 50 });

      expect(plan.receiptSlices.map((row) => [row.receiptPublicId, row.amountMinor])).toEqual([
        ['receipt-cash-old', 4000],
        ['receipt-card-new', 1000],
      ]);
      expect(plan.tenderAttributions.map((row) => row.tenderPublicId)).toEqual([
        'tender-cash-old',
        'tender-card-new',
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('uses newest eligible receipts and cash-first tenders while subtracting prior attribution', async () => {
    const { sqlite, db } = createHarness();
    try {
      seedInvoice(sqlite);
      seedReceipt(sqlite, {
        receiptId: 'receipt-mixed',
        receivedAtUtc: '2026-07-23T10:30:00.000Z',
        amountMinor: 6000,
        allocations: [
          { id: 'allocation-z', amountMinor: 3000 },
          { id: 'allocation-a', amountMinor: 3000 },
        ],
        tenders: [
          { id: 'tender-card', type: 'card', method: 'visa', amountMinor: 4000 },
          { id: 'tender-cash', type: 'cash', method: 'cash', amountMinor: 2000 },
        ],
      });
      sqlite.prepare(`
        INSERT INTO canonical_credit_notes (
          tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
          legacy_patient_id,currency_code,reason_code,total_minor,
          invoice_credited_before_minor,invoice_credited_after_minor,
          invoice_net_due_before_minor,invoice_net_due_after_minor,status,
          issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
          source_evidence_sha256
        ) VALUES ('100','old-credit','CN-OLD','invoice-100',101,'BDT','old',1000,
          0,1000,5000,4000,'posted',?,?,?,1,?)
      `).run(NOW, DATE, NOW, HASH);
      sqlite.prepare(`
        INSERT INTO canonical_credit_note_cash_refunds (
          tenant_id,refund_public_id,credit_note_public_id,invoice_public_id,
          amount_minor,payout_tender_type,payout_method_code,legacy_counter_id,
          legacy_counter_session_id,status,refunded_at_utc,business_date,
          reconciliation_guard,source_evidence_sha256
        ) VALUES ('100','old-refund','old-credit','invoice-100',1000,'cash','cash',1,1,
          'posted',?,?,1,?)
      `).run(NOW, DATE, HASH);
      sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_receipts (
          tenant_id,receipt_slice_public_id,refund_public_id,receipt_public_id,
          amount_minor,receipt_refunded_before_minor,receipt_refunded_after_minor,
          receipt_net_received_before_minor,receipt_net_received_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('100','old-receipt-slice','old-refund','receipt-mixed',1000,0,1000,6000,5000,1,?)
      `).run(HASH);
      sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_tender_attributions (
          tenant_id,tender_attribution_public_id,refund_public_id,receipt_slice_public_id,
          receipt_public_id,tender_public_id,amount_minor,original_tender_type,
          original_method_code,attributable_before_minor,attributable_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('100','old-tender-attr','old-refund','old-receipt-slice','receipt-mixed',
          'tender-cash',1000,'cash','cash',2000,1000,1,?)
      `).run(HASH);

      const plan = await resolveLiveCreditNoteCashRefundFunding(db, { ...authority, cashRefund: 40 });

      expect(plan.allocationSlices.map((row) => row.allocationPublicId)).toEqual(['allocation-z', 'allocation-a']);
      expect(plan.tenderAttributions.map((row) => [row.tenderPublicId, row.amountMinor, row.attributableBeforeMinor])).toEqual([
        ['tender-cash', 1000, 1000],
        ['tender-card', 3000, 4000],
      ]);
      expectPlanTotals(plan, 4000);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed for missing mapping or insufficient canonical allocation/tender authority', async () => {
    const { sqlite, db } = createHarness();
    try {
      await expect(resolveLiveCreditNoteCashRefundFunding(db, authority))
        .rejects.toThrow(/invoice mapping not found/i);

      seedInvoice(sqlite);
      seedReceipt(sqlite, {
        receiptId: 'receipt-short',
        receivedAtUtc: NOW,
        amountMinor: 2000,
        tenders: [{ id: 'tender-short', type: 'card', method: 'visa', amountMinor: 2000 }],
      });

      await expect(resolveLiveCreditNoteCashRefundFunding(db, authority))
        .rejects.toThrow(/insufficient canonical payment funding/i);
    } finally {
      sqlite.close();
    }
  });

  it('does not cross tenant boundaries when resolving invoice or payment funding', async () => {
    const { sqlite, db } = createHarness();
    try {
      seedInvoice(sqlite, 'other');
      seedReceipt(sqlite, {
        tenantId: 'other',
        receiptId: 'other-receipt',
        receivedAtUtc: NOW,
        amountMinor: 5000,
        tenders: [{ id: 'other-tender', type: 'cash', method: 'cash', amountMinor: 5000 }],
      });

      await expect(resolveLiveCreditNoteCashRefundFunding(db, authority))
        .rejects.toThrow(/invoice mapping not found/i);
    } finally {
      sqlite.close();
    }
  });
});

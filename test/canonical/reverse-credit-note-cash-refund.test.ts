import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  issueCreditNoteWithCashRefund,
  type IssueCreditNoteCashRefundInput,
} from '../../src/lib/canonical/commands/issue-credit-note-cash-refund';
import {
  reverseCreditNoteCashRefund,
  type ReverseCreditNoteCashRefundInput,
} from '../../src/lib/canonical/commands/reverse-credit-note-cash-refund';

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
  '0533_canonical_credit_note_cash_refunds.sql',
  '0550_canonical_credit_note_cash_refund_reversals.sql',
] as const;

const ISSUED_AT = '2026-07-23T11:00:00.000Z';
const REVERSED_AT = '2026-07-26T12:30:00.000Z';
const DATE = '2026-07-26';
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
    CREATE TABLE legacy_reversal (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
    CREATE TABLE diagnostic_performer_reserves (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE doctor_commission_accruals (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      status TEXT NOT NULL
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

function seedAuthority(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('100','invoice-1','INV-1',101,'BDT',10000,0,10000,8000,2000,0,2000,1,
      'posted',?,?,?)
  `).run(ISSUED_AT, ISSUED_AT, HASH_A);
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('100','invoice','invoice-1','legacy_bill','71','bills','mapped',1,?)
  `).run(HASH_A);
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,refunded_minor,net_received_minor,
      refund_projection_guard,reconciliation_guard,source_evidence_sha256
    ) VALUES ('100','receipt-1','RCP-1',101,'BDT',8000,8000,0,'posted',?,?,?,0,8000,1,1,?)
  `).run(ISSUED_AT, '2026-07-23', ISSUED_AT, HASH_A);
  sqlite.prepare(`
    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
      amount_minor,status,captured_at_utc,reversed_minor,remaining_minor,
      reversal_projection_guard,source_evidence_sha256
    ) VALUES ('100','tender-card','receipt-1','card','visa',8000,'captured',?,0,8000,1,?)
  `).run(ISSUED_AT, HASH_A);
  sqlite.prepare(`
    INSERT INTO canonical_payment_allocations (
      tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
      amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
      allocated_at_utc,reversed_minor,remaining_minor,reversal_projection_guard,
      balance_guard,source_evidence_sha256
    ) VALUES ('100','allocation-1','receipt-1','invoice-1',8000,10000,2000,'active',?,0,8000,1,1,?)
  `).run(ISSUED_AT, HASH_A);
}

function issueInput(): IssueCreditNoteCashRefundInput {
  return {
    tenantId: '100',
    creditNotePublicId: 'credit-note-1',
    creditNoteNumber: 'CN-1',
    invoicePublicId: 'invoice-1',
    reasonCode: 'approved_refund',
    issuedAtUtc: ISSUED_AT,
    businessDate: '2026-07-23',
    lines: [{
      creditLinePublicId: 'credit-line-1',
      invoiceLinePublicId: null,
      amountMinor: 5000,
      reasonCode: 'approved_refund',
      sourceEvidenceSha256: HASH_A,
    }],
    sourceType: 'legacy_live_credit_note',
    sourcePublicId: 'CN-1',
    sourceTable: 'billing_credit_notes',
    sourceEvidenceSha256: HASH_A,
    idempotencyKey: 'credit-note-cash-refund:CN-1',
    outboxEventPublicId: 'outbox-credit-1',
    refundPublicId: 'credit-refund-1',
    cashRefundMinor: 3000,
    payoutMethodCode: 'cash',
    legacyCounterId: 12,
    legacyCounterSessionId: 34,
    refundSourceEvidenceSha256: HASH_B,
    receiptSlices: [{
      receiptSlicePublicId: 'receipt-slice-1',
      receiptPublicId: 'receipt-1',
      amountMinor: 3000,
      receiptRefundedBeforeMinor: 0,
      receiptRefundedAfterMinor: 3000,
      receiptNetReceivedBeforeMinor: 8000,
      receiptNetReceivedAfterMinor: 5000,
      sourceEvidenceSha256: HASH_B,
    }],
    allocationSlices: [{
      allocationSlicePublicId: 'allocation-slice-1',
      receiptSlicePublicId: 'receipt-slice-1',
      receiptPublicId: 'receipt-1',
      allocationPublicId: 'allocation-1',
      amountMinor: 3000,
      allocationReversedBeforeMinor: 0,
      allocationReversedAfterMinor: 3000,
      allocationRemainingBeforeMinor: 8000,
      allocationRemainingAfterMinor: 5000,
      sourceEvidenceSha256: HASH_B,
    }],
    tenderAttributions: [{
      tenderAttributionPublicId: 'tender-attribution-1',
      receiptSlicePublicId: 'receipt-slice-1',
      receiptPublicId: 'receipt-1',
      tenderPublicId: 'tender-card',
      amountMinor: 3000,
      tenderType: 'card',
      methodCode: 'visa',
      attributableBeforeMinor: 8000,
      attributableAfterMinor: 5000,
      sourceEvidenceSha256: HASH_B,
    }],
    cashRefundEventPublicId: 'outbox-cash-refund-1',
    cashCustodyEventPublicId: 'outbox-cash-custody-1',
  };
}

function reversalInput(overrides: Partial<ReverseCreditNoteCashRefundInput> = {}): ReverseCreditNoteCashRefundInput {
  return {
    tenantId: '100',
    reversalPublicId: 'credit-refund-reversal-1',
    refundPublicId: 'credit-refund-1',
    reasonCode: 'approval_rejected',
    reversedAtUtc: REVERSED_AT,
    businessDate: DATE,
    actorUserId: 601,
    sourceType: 'approval_request',
    sourcePublicId: '55',
    sourceTable: 'approval_requests',
    sourceEvidenceSha256: HASH_C,
    idempotencyKey: 'credit-note-cash-refund-reversal:approval-55',
    outboxEventPublicId: 'outbox-credit-refund-reversal-1',
    recoveryRequiredEventPublicId: 'outbox-refund-recovery-required-1',
    ...overrides,
  };
}

async function issue(sqlite: DatabaseSync, db: CanonicalBatchDatabase): Promise<void> {
  seedAuthority(sqlite);
  await issueCreditNoteWithCashRefund(db, issueInput());
}

describe('reverseCreditNoteCashRefund', () => {
  it('restores invoice, receipt, allocation, and tender attribution authority without deleting original facts', async () => {
    const { sqlite, db } = harness();
    try {
      await issue(sqlite, db);
      const result = await reverseCreditNoteCashRefund(db, reversalInput(), {
        authoritativeStatements: [
          db.prepare(`INSERT INTO legacy_reversal (tenant_id,source_id) VALUES (?,?)`)
            .bind('100', 'approval-55'),
        ],
      });

      expect(result).toEqual({
        status: 'applied',
        result: {
          reversalPublicId: 'credit-refund-reversal-1',
          refundPublicId: 'credit-refund-1',
          creditNotePublicId: 'credit-note-1',
          invoicePublicId: 'invoice-1',
          totalMinor: 5000,
          cashRefundMinor: 3000,
          invoicePaidMinor: 8000,
          invoiceDueMinor: 2000,
          invoiceCreditedMinor: 0,
          invoiceNetDueMinor: 2000,
          legacyCounterId: 12,
          legacyCounterSessionId: 34,
        },
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE tenant_id='100' AND invoice_public_id='invoice-1'
      `).get()).toEqual({ paid_minor: 8000, due_minor: 2000, credited_minor: 0, net_due_minor: 2000 });
      expect(sqlite.prepare(`
        SELECT status,reversed_at_utc FROM canonical_credit_notes
        WHERE tenant_id='100' AND credit_note_public_id='credit-note-1'
      `).get()).toEqual({ status: 'reversed', reversed_at_utc: REVERSED_AT });
      expect(sqlite.prepare(`
        SELECT status,reversed_at_utc FROM canonical_credit_note_cash_refunds
        WHERE tenant_id='100' AND refund_public_id='credit-refund-1'
      `).get()).toEqual({ status: 'reversed', reversed_at_utc: REVERSED_AT });
      expect(sqlite.prepare(`
        SELECT refunded_minor,net_received_minor,status
        FROM canonical_payment_receipts WHERE tenant_id='100' AND receipt_public_id='receipt-1'
      `).get()).toEqual({ refunded_minor: 0, net_received_minor: 8000, status: 'posted' });
      expect(sqlite.prepare(`
        SELECT reversed_minor,remaining_minor,status,reversed_at_utc
        FROM canonical_payment_allocations WHERE tenant_id='100' AND allocation_public_id='allocation-1'
      `).get()).toEqual({ reversed_minor: 0, remaining_minor: 8000, status: 'active', reversed_at_utc: null });
      expect(sqlite.prepare(`
        SELECT remaining_minor-COALESCE((
          SELECT SUM(attr.amount_minor)
          FROM canonical_credit_note_refund_tender_attributions attr
          INNER JOIN canonical_credit_note_cash_refunds refund
            ON refund.tenant_id=attr.tenant_id AND refund.refund_public_id=attr.refund_public_id
          WHERE attr.tenant_id=t.tenant_id
            AND attr.tender_public_id=t.tender_public_id
            AND refund.status='posted'
        ),0) AS attributable_minor
        FROM canonical_payment_tenders t
        WHERE tenant_id='100' AND tender_public_id='tender-card'
      `).get()).toEqual({ attributable_minor: 8000 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_lines`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_refund_receipts`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_refund_allocations`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_refund_tender_attributions`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_cash_refund_reversals`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM legacy_reversal`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`
        SELECT entity_type, canonical_public_id, source_type, source_public_id, source_table
        FROM canonical_source_mappings
        WHERE tenant_id='100' AND entity_type='credit_note_cash_refund_reversal'
      `).get()).toEqual({
        entity_type: 'credit_note_cash_refund_reversal',
        canonical_public_id: 'credit-refund-reversal-1',
        source_type: 'approval_request',
        source_public_id: '55',
        source_table: 'approval_requests',
      });
      expect(sqlite.prepare(`
        SELECT event_type FROM canonical_outbox_events
        WHERE event_type IN (
          'canonical.credit_note.cash_refund_reversed',
          'canonical.cash_custody.refund_recovery_required'
        ) ORDER BY event_type
      `).all()).toEqual([
        { event_type: 'canonical.cash_custody.refund_recovery_required' },
        { event_type: 'canonical.credit_note.cash_refund_reversed' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('replays the same reversal and rejects a changed request under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      await issue(sqlite, db);
      expect((await reverseCreditNoteCashRefund(db, reversalInput())).status).toBe('applied');
      expect((await reverseCreditNoteCashRefund(db, reversalInput())).status).toBe('replayed');
      await expect(reverseCreditNoteCashRefund(db, reversalInput({ reasonCode: 'changed' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_cash_refund_reversals`).get())
        .toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed and rolls back authoritative statements when a source balance changes before commit', async () => {
    const { sqlite, db } = harness({
      beforeBatch(database) {
        const issued = database.prepare(`
          SELECT COUNT(*) AS count
          FROM canonical_credit_note_cash_refunds
          WHERE tenant_id='100' AND refund_public_id='credit-refund-1'
        `).get() as { count: number };
        if (Number(issued.count) !== 1) return;
        database.prepare(`
          UPDATE canonical_payment_receipts
          SET refunded_minor=2500,net_received_minor=5500
          WHERE tenant_id='100' AND receipt_public_id='receipt-1'
        `).run();
      },
    });
    try {
      await issue(sqlite, db);
      await expect(reverseCreditNoteCashRefund(db, reversalInput(), {
        authoritativeStatements: [
          db.prepare(`INSERT INTO legacy_reversal (tenant_id,source_id) VALUES (?,?)`)
            .bind('100', 'approval-55'),
        ],
      })).rejects.toThrow(/constraint|reconciliation|guard/i);
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_cash_refund_reversals`).get())
        .toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM legacy_reversal`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT status FROM canonical_credit_note_cash_refunds
        WHERE tenant_id='100' AND refund_public_id='credit-refund-1'
      `).get()).toEqual({ status: 'posted' });
    } finally {
      sqlite.close();
    }
  });

  it('rejects a refund that is already reversed by another authority', async () => {
    const { sqlite, db } = harness();
    try {
      await issue(sqlite, db);
      sqlite.prepare(`
        UPDATE canonical_credit_note_cash_refunds
        SET status='reversed',reversed_at_utc=?
        WHERE tenant_id='100' AND refund_public_id='credit-refund-1'
      `).run(REVERSED_AT);
      await expect(reverseCreditNoteCashRefund(db, reversalInput()))
        .rejects.toThrow(/not posted|already reversed/i);
    } finally {
      sqlite.close();
    }
  });
});

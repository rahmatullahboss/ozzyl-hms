import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { cancelSettlement, type CancelSettlementInput } from '../../src/lib/canonical/commands/cancel-settlement';
import { finalizeSettlement } from '../../src/lib/canonical/commands/finalize-settlement';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
  }
}

const HASH = 'a'.repeat(64);

function harness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}): {
  sqlite: DatabaseSync;
  db: CanonicalBatchDatabase;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
    '0513_canonical_practitioner_compensation.sql',
    '0532_canonical_financial_batch_assertions.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));

  sqlite.exec(`
    CREATE TABLE billing_settlements (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      settlement_receipt_no TEXT NOT NULL,
      payable_amount REAL NOT NULL,
      paid_amount REAL NOT NULL,
      deposit_deducted REAL NOT NULL,
      discount_amount REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      due REAL NOT NULL,
      status TEXT NOT NULL,
      settlement_id INTEGER
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      receipt_no TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      received_by INTEGER,
      counter_id INTEGER,
      counter_session_id INTEGER
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_bill_id INTEGER,
      created_by INTEGER,
      counter_id INTEGER,
      counter_session_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE bill_discount_allocations (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      settlement_id INTEGER,
      allocation_type TEXT NOT NULL,
      discount_reason TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_name TEXT,
      note TEXT
    );
    CREATE TABLE diagnostic_performer_reserves (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE doctor_commission_accruals (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE legacy_cancelled (
      tenant_id TEXT NOT NULL,
      settlement_receipt_no TEXT NOT NULL,
      UNIQUE (tenant_id, settlement_receipt_no)
    );

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,
      posted_at_utc,source_evidence_sha256,paid_minor,due_minor,credited_minor,
      net_due_minor,adjustment_projection_guard
    ) VALUES (
      '100','inv-1','INV-1',501,'BDT',50000,0,50000,'posted',
      '2026-07-24T08:00:00.000Z','2026-07-24T08:00:00.000Z','${HASH}',
      0,50000,0,50000,1
    );
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('100','invoice','inv-1','legacy_bill','1','bills','mapped',1,'${HASH}');

    INSERT INTO billing_settlements VALUES
      (44,'100',501,'STL-MIX',500,100,200,100,'cash',9,7,8,1);
    INSERT INTO bills VALUES
      (1,'100',501,'INV-1',500,400,100,'partially_paid',44);
    INSERT INTO payments VALUES
      (63,'100',1,100,'STL-MIX-B1','cash',9,7,8);
    INSERT INTO billing_deposits VALUES
      (72,'100',501,'STL-MIX-DAD-B1',200,'adjustment',1,9,7,8,1);
    INSERT INTO bill_discount_allocations VALUES
      (82,'100',1,44,'hospital_discount','settlement_discount',100,'Manager','Mixed settlement discount');

    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES (
      '100','mix-dep-r','MIX-DEP-R',501,'BDT',30000,0,30000,'posted',
      '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
      1,'${HASH}',0,30000,1
    );
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,
      legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
      available_minor,status,received_at_utc,business_date,posted_at_utc,
      reconciliation_guard,source_evidence_sha256
    ) VALUES (
      '100','mix-dep','MIX-DEP','mix-dep-r',501,'BDT',30000,0,0,30000,'posted',
      '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
      1,'${HASH}'
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
        const results: unknown[] = [];
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

function finalizeInput() {
  return {
    tenantId: '100',
    commandIdempotencyKey: 'settlement:STL-MIX',
    settlementPublicId: 'stl-public-mix',
    settlementReceiptNumber: 'STL-MIX',
    legacyPatientId: 501,
    currencyCode: 'BDT' as const,
    occurredAtUtc: '2026-07-24T12:00:00.000Z',
    businessDate: '2026-07-24',
    legacyCollectorId: 9,
    legacyCounterId: 7,
    legacyCounterSessionId: 8,
    paymentMethod: 'cash',
    tenderType: 'cash' as const,
    bills: [{
      billId: 1,
      invoicePublicId: 'inv-1',
      invoiceNumber: 'INV-1',
      legacyTotalMinor: 50_000,
      legacyPaidBeforeMinor: 0,
      legacyDueBeforeMinor: 50_000,
      canonicalPaidBeforeMinor: 0,
      canonicalDueBeforeMinor: 50_000,
      canonicalCreditedBeforeMinor: 0,
      canonicalNetDueBeforeMinor: 50_000,
      cashMinor: 10_000,
      depositMinor: 20_000,
      discountMinor: 10_000,
      paymentReceiptNumber: 'STL-MIX-B1',
      depositAdjustmentReceiptNumber: 'STL-MIX-DAD-B1',
      discountNumber: 'STL-MIX-DISC-B1',
      discountReasonCode: 'settlement_discount',
      discountAllocationType: 'hospital_discount',
      discountReferenceName: 'Manager',
      discountNote: 'Mixed settlement discount',
    }],
  };
}

async function prepareCancellation(
  db: CanonicalBatchDatabase,
): Promise<CancelSettlementInput> {
  const finalized = await finalizeSettlement(db, finalizeInput());
  const bill = finalized.result.bills[0];
  return {
    tenantId: '100',
    commandIdempotencyKey: 'settlement-cancel:STL-MIX',
    settlementPublicId: 'stl-public-mix',
    settlementReceiptNumber: 'STL-MIX',
    cancellationSourcePublicId: 'STL-MIX',
    reasonCode: 'SETTLEMENT_CANCELLED',
    cancelledAtUtc: '2026-07-25T03:00:00.000Z',
    businessDate: '2026-07-25',
    bills: [{
      billId: 1,
      invoicePublicId: 'inv-1',
      invoiceNumber: 'INV-1',
      totalMinor: 50_000,
      paidBeforeSettlementMinor: 0,
      dueBeforeSettlementMinor: 50_000,
      creditedBeforeSettlementMinor: 0,
      netDueBeforeSettlementMinor: 50_000,
      paidAfterSettlementMinor: 30_000,
      dueAfterSettlementMinor: 20_000,
      creditedAfterSettlementMinor: 10_000,
      netDueAfterSettlementMinor: 10_000,
      cashMinor: 10_000,
      depositMinor: 20_000,
      discountMinor: 10_000,
      paymentReceiptPublicId: bill.paymentReceiptPublicId,
      depositApplications: bill.depositApplications.map((application) => ({
        applicationPublicId: application.applicationPublicId,
        depositPublicId: application.depositPublicId,
        amountMinor: application.amountMinor,
      })),
      creditNotePublicId: bill.creditNotePublicId,
    }],
  };
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get() as { count: number }).count);
}

function authoritativeStatement(db: CanonicalBatchDatabase): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO legacy_cancelled (tenant_id,settlement_receipt_no)
    VALUES ('100','STL-MIX')
  `);
}

describe('cancelSettlement', () => {
  it('atomically reverses mixed settlement authority and restores pre-settlement projections', async () => {
    const { sqlite, db } = harness();
    try {
      const input = await prepareCancellation(db);
      const result = await cancelSettlement(db, input, {
        authoritativeStatements: [authoritativeStatement(db)],
      });

      expect(result).toMatchObject({
        status: 'applied',
        result: {
          settlementPublicId: 'stl-public-mix',
          settlementReceiptNumber: 'STL-MIX',
          cashMinor: 10_000,
          depositMinor: 20_000,
          discountMinor: 10_000,
        },
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 0, due_minor: 50_000, credited_minor: 0, net_due_minor: 50_000 });
      expect(sqlite.prepare(`
        SELECT applied_minor,available_minor FROM canonical_deposits WHERE deposit_public_id='mix-dep'
      `).get()).toEqual({ applied_minor: 0, available_minor: 30_000 });
      expect(sqlite.prepare(`
        SELECT status,reversed_at_utc FROM canonical_deposit_applications
      `).get()).toEqual({ status: 'reversed', reversed_at_utc: '2026-07-25T03:00:00.000Z' });
      expect(sqlite.prepare(`
        SELECT status,reversed_at_utc FROM canonical_credit_notes
      `).get()).toEqual({ status: 'reversed', reversed_at_utc: '2026-07-25T03:00:00.000Z' });
      expect(sqlite.prepare(`
        SELECT status,refunded_minor,net_received_minor FROM canonical_payment_receipts
        WHERE receipt_number='STL-MIX-B1'
      `).get()).toEqual({ status: 'reversed', refunded_minor: 10_000, net_received_minor: 0 });
      expect(count(sqlite, 'canonical_payment_reversals')).toBe(1);
      expect(count(sqlite, 'canonical_refunds', "WHERE source_type='payment'")).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings', "WHERE entity_type='settlement_cancellation'")).toBe(1);
      expect(count(sqlite, 'legacy_cancelled')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('replays identical evidence and rejects semantic conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      const input = await prepareCancellation(db);
      const first = await cancelSettlement(db, input);
      const replay = await cancelSettlement(db, input);
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      await expect(cancelSettlement(db, { ...input, reasonCode: 'DIFFERENT_REASON' }))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_payment_reversals')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back canonical reversal when authoritative legacy SQL fails', async () => {
    const { sqlite, db } = harness();
    try {
      const input = await prepareCancellation(db);
      await expect(cancelSettlement(db, input, {
        authoritativeStatements: [db.prepare('INSERT INTO missing_legacy_cancel VALUES (1)')],
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_payment_reversals')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 30_000, due_minor: 20_000, credited_minor: 10_000, net_due_minor: 10_000 });
      expect(sqlite.prepare(`SELECT status FROM canonical_credit_notes`).get()).toEqual({ status: 'posted' });
      expect(sqlite.prepare(`SELECT status FROM canonical_deposit_applications`).get()).toEqual({ status: 'active' });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed on prior partial reversal and stale invoice state', async () => {
    const firstHarness = harness();
    try {
      const input = await prepareCancellation(firstHarness.db);
      firstHarness.sqlite.exec(`
        UPDATE canonical_payment_allocations
        SET reversed_minor=1,remaining_minor=amount_minor-1
        WHERE receipt_public_id=(SELECT receipt_public_id FROM canonical_payment_receipts WHERE receipt_number='STL-MIX-B1');
      `);
      await expect(cancelSettlement(firstHarness.db, input)).rejects.toThrow(/fully reversible|partial|reversal/i);
      expect(count(firstHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      firstHarness.sqlite.close();
    }

    const secondHarness = harness();
    try {
      const input = await prepareCancellation(secondHarness.db);
      secondHarness.sqlite.exec(`
        UPDATE canonical_invoices
        SET paid_minor=29999,due_minor=20001,net_due_minor=10001
        WHERE invoice_public_id='inv-1';
      `);
      await expect(cancelSettlement(secondHarness.db, input)).rejects.toThrow(/snapshot|stale|balance/i);
      expect(count(secondHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      secondHarness.sqlite.close();
    }
  });

  it('fails closed for paid mapped compensation and conflicting settlement mappings', async () => {
    const firstHarness = harness();
    try {
      const input = await prepareCancellation(firstHarness.db);
      firstHarness.sqlite.exec(`INSERT INTO doctor_commission_accruals VALUES ('100',1,'paid')`);
      await expect(cancelSettlement(firstHarness.db, input)).rejects.toThrow(/paid|compensation|settlement/i);
      expect(count(firstHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      firstHarness.sqlite.close();
    }

    const secondHarness = harness();
    try {
      const input = await prepareCancellation(secondHarness.db);
      secondHarness.sqlite.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('100','settlement','stl-public-mix','legacy_settlement','STL-CONFLICT',
                  'billing_settlements','mapped',1,?)
      `).run(HASH);
      await expect(cancelSettlement(secondHarness.db, input)).rejects.toThrow(/mapping|conflict|duplicate/i);
      expect(count(secondHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      secondHarness.sqlite.close();
    }
  });

  it('fails closed when deposit, discount, or source-mapping evidence is already reversed or missing', async () => {
    const depositHarness = harness();
    try {
      const input = await prepareCancellation(depositHarness.db);
      depositHarness.sqlite.exec(`
        UPDATE canonical_deposit_applications
        SET status='reversed',reversed_at_utc='2026-07-24T23:00:00.000Z';
      `);
      await expect(cancelSettlement(depositHarness.db, input)).rejects.toThrow(/deposit application.*reversible/i);
      expect(count(depositHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      depositHarness.sqlite.close();
    }

    const creditHarness = harness();
    try {
      const input = await prepareCancellation(creditHarness.db);
      creditHarness.sqlite.exec(`
        UPDATE canonical_credit_notes
        SET status='reversed',reversed_at_utc='2026-07-24T23:00:00.000Z';
      `);
      await expect(cancelSettlement(creditHarness.db, input)).rejects.toThrow(/credit note.*reversible/i);
      expect(count(creditHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      creditHarness.sqlite.close();
    }

    const mappingHarness = harness();
    try {
      const input = await prepareCancellation(mappingHarness.db);
      mappingHarness.sqlite.exec(`
        DELETE FROM canonical_source_mappings
        WHERE entity_type='deposit_application';
      `);
      await expect(cancelSettlement(mappingHarness.db, input)).rejects.toThrow(/mapping.*missing/i);
      expect(count(mappingHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
    } finally {
      mappingHarness.sqlite.close();
    }
  });

  it('blocks settled canonical compensation before any cancellation mutation', async () => {
    const { sqlite, db } = harness();
    try {
      const input = await prepareCancellation(db);
      sqlite.exec(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES ('100','prac-paid','internal','Paid Practitioner','active');
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,adjustment_code,
          quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES ('100','line-paid','inv-1','other_adjustment','TEST',1,50000,50000,'${HASH}');
        INSERT INTO canonical_compensation_rules (
          tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
          practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
          calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
          priority,effective_from,effective_to,status,source_evidence_sha256
        ) VALUES ('100','rule-paid',1,'all',NULL,NULL,'prac-paid','performing',
                  'performer_reserve','fixed',1000,'gross','ignore','exclude',0,NULL,
                  10,'2026-01-01',NULL,'active','${HASH}');
        INSERT INTO canonical_compensation_accruals (
          tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
          service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
          rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
          gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
          earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
          business_date,payable_projection_guard,source_evidence_sha256
        ) VALUES ('100','accrual-paid','inv-1','line-paid',NULL,'prac-paid','performing',
                  'performer_reserve','rule-paid',1,'gross','fixed',1000,'BDT',50000,0,0,0,
                  50000,1000,0,500,500,'partially_settled','2026-07-24T12:30:00.000Z',
                  '2026-07-24',1,'${HASH}');
      `);

      await expect(cancelSettlement(db, input)).rejects.toThrow(/paid|compensation|settlement/i);
      expect(count(sqlite, 'canonical_payment_reversals')).toBe(0);
      expect(sqlite.prepare(`SELECT status FROM canonical_credit_notes`).get()).toEqual({ status: 'posted' });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the complete batch when a payment or deposit balance changes after planning', async () => {
    let racePayment = false;
    const paymentHarness = harness({
      beforeBatch(sqlite) {
        if (!racePayment) return;
        racePayment = false;
        sqlite.exec(`
          UPDATE canonical_payment_allocations
          SET remaining_minor=amount_minor-1,reversed_minor=1
          WHERE receipt_public_id=(
            SELECT receipt_public_id FROM canonical_payment_receipts
            WHERE receipt_number='STL-MIX-B1'
          );
        `);
      },
    });
    try {
      const input = await prepareCancellation(paymentHarness.db);
      racePayment = true;
      await expect(cancelSettlement(paymentHarness.db, input)).rejects.toThrow();
      expect(count(paymentHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
      expect(count(paymentHarness.sqlite, 'canonical_source_mappings', "WHERE entity_type='settlement_cancellation'")).toBe(0);
      expect(paymentHarness.sqlite.prepare(`SELECT status FROM canonical_credit_notes`).get()).toEqual({ status: 'posted' });
      expect(paymentHarness.sqlite.prepare(`SELECT status FROM canonical_deposit_applications`).get()).toEqual({ status: 'active' });
    } finally {
      paymentHarness.sqlite.close();
    }

    let raceDeposit = false;
    const depositHarness = harness({
      beforeBatch(sqlite) {
        if (!raceDeposit) return;
        raceDeposit = false;
        sqlite.exec(`
          UPDATE canonical_deposits
          SET applied_minor=applied_minor-1,available_minor=available_minor+1
          WHERE deposit_public_id='mix-dep';
        `);
      },
    });
    try {
      const input = await prepareCancellation(depositHarness.db);
      raceDeposit = true;
      await expect(cancelSettlement(depositHarness.db, input)).rejects.toThrow();
      expect(count(depositHarness.sqlite, 'canonical_payment_reversals')).toBe(0);
      expect(count(depositHarness.sqlite, 'canonical_source_mappings', "WHERE entity_type='settlement_cancellation'")).toBe(0);
      expect(depositHarness.sqlite.prepare(`SELECT status FROM canonical_credit_notes`).get()).toEqual({ status: 'posted' });
      expect(depositHarness.sqlite.prepare(`SELECT status FROM canonical_deposit_applications`).get()).toEqual({ status: 'active' });
    } finally {
      depositHarness.sqlite.close();
    }
  });
});

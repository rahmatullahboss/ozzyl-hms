import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
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
}

const HASH = 'a'.repeat(64);

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
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
    CREATE TABLE doctor_commission_accruals (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,
      posted_at_utc,source_evidence_sha256,paid_minor,due_minor,credited_minor,
      net_due_minor,adjustment_projection_guard
    ) VALUES
      ('100','inv-1','INV-1',501,'BDT',50000,0,50000,'posted',
       '2026-07-24T08:00:00.000Z','2026-07-24T08:00:00.000Z','${HASH}',0,50000,0,50000,1),
      ('100','inv-2','INV-2',501,'BDT',50000,0,50000,'posted',
       '2026-07-24T08:00:00.000Z','2026-07-24T08:00:00.000Z','${HASH}',0,50000,0,50000,1);

    INSERT INTO billing_settlements VALUES
      (41,'100',501,'STL-1',1000,800,0,0,'cash',9,7,8,1);
    INSERT INTO bills VALUES
      (1,'100',501,'INV-1',500,500,0,'paid',41),
      (2,'100',501,'INV-2',500,300,200,'partially_paid',41);
    INSERT INTO payments VALUES
      (61,'100',1,500,'STL-1-B1','cash',9,7,8),
      (62,'100',2,300,'STL-1-B2','cash',9,7,8);
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
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

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function cashOnlyInput() {
  return {
    tenantId: '100',
    commandIdempotencyKey: 'settlement:STL-1',
    settlementPublicId: 'stl-public-1',
    settlementReceiptNumber: 'STL-1',
    legacyPatientId: 501,
    currencyCode: 'BDT' as const,
    occurredAtUtc: '2026-07-24T09:00:00.000Z',
    businessDate: '2026-07-24',
    legacyCollectorId: 9,
    legacyCounterId: 7,
    legacyCounterSessionId: 8,
    paymentMethod: 'cash',
    tenderType: 'cash' as const,
    bills: [
      {
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
        cashMinor: 50_000,
        depositMinor: 0,
        discountMinor: 0,
        paymentReceiptNumber: 'STL-1-B1',
        depositAdjustmentReceiptNumber: null,
        discountNumber: null,
        discountReasonCode: null,
        discountAllocationType: null,
        discountReferenceName: null,
        discountNote: null,
      },
      {
        billId: 2,
        invoicePublicId: 'inv-2',
        invoiceNumber: 'INV-2',
        legacyTotalMinor: 50_000,
        legacyPaidBeforeMinor: 0,
        legacyDueBeforeMinor: 50_000,
        canonicalPaidBeforeMinor: 0,
        canonicalDueBeforeMinor: 50_000,
        canonicalCreditedBeforeMinor: 0,
        canonicalNetDueBeforeMinor: 50_000,
        cashMinor: 30_000,
        depositMinor: 0,
        discountMinor: 0,
        paymentReceiptNumber: 'STL-1-B2',
        depositAdjustmentReceiptNumber: null,
        discountNumber: null,
        discountReasonCode: null,
        discountAllocationType: null,
        discountReferenceName: null,
        discountNote: null,
      },
    ],
  };
}

function depositOnlyInput() {
  return {
    tenantId: '100',
    commandIdempotencyKey: 'settlement:STL-DEP',
    settlementPublicId: 'stl-public-dep',
    settlementReceiptNumber: 'STL-DEP',
    legacyPatientId: 501,
    currencyCode: 'BDT' as const,
    occurredAtUtc: '2026-07-24T10:00:00.000Z',
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
      cashMinor: 0,
      depositMinor: 40_000,
      discountMinor: 0,
      paymentReceiptNumber: null,
      depositAdjustmentReceiptNumber: 'STL-DEP-DAD-B1',
      discountNumber: null,
      discountReasonCode: null,
      discountAllocationType: null,
      discountReferenceName: null,
      discountNote: null,
    }],
  };
}

function discountOnlyInput() {
  return {
    tenantId: '100',
    commandIdempotencyKey: 'settlement:STL-DISC',
    settlementPublicId: 'stl-public-disc',
    settlementReceiptNumber: 'STL-DISC',
    legacyPatientId: 501,
    currencyCode: 'BDT' as const,
    occurredAtUtc: '2026-07-24T11:00:00.000Z',
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
      cashMinor: 0,
      depositMinor: 0,
      discountMinor: 20_000,
      paymentReceiptNumber: null,
      depositAdjustmentReceiptNumber: null,
      discountNumber: 'STL-DISC-DISC-B1',
      discountReasonCode: 'settlement_discount',
      discountAllocationType: 'hospital_discount',
      discountReferenceName: 'Manager',
      discountNote: 'Approved settlement discount',
    }],
  };
}

function mixedInput() {
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

describe('finalizeSettlement', () => {
  it('atomically creates per-bill cash receipts and updates mapped invoice balances', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await finalizeSettlement(db, cashOnlyInput());

      expect(result.status).toBe('applied');
      expect(result.result).toMatchObject({
        settlementPublicId: 'stl-public-1',
        settlementReceiptNumber: 'STL-1',
        cashMinor: 80_000,
        depositMinor: 0,
        discountMinor: 0,
      });
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(2);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(2);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(2);
      expect(sqlite.prepare(`
        SELECT invoice_number,paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices
        ORDER BY invoice_number
      `).all()).toEqual([
        { invoice_number: 'INV-1', paid_minor: 50_000, due_minor: 0, credited_minor: 0, net_due_minor: 0 },
        { invoice_number: 'INV-2', paid_minor: 30_000, due_minor: 20_000, credited_minor: 0, net_due_minor: 20_000 },
      ]);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(3);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(5);
    } finally {
      sqlite.close();
    }
  });

  it('applies one legacy deposit adjustment FIFO across canonical deposit sources', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (42,'100',501,'STL-DEP',500,0,400,0,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,400,100,'partially_paid',42);
        INSERT INTO billing_deposits VALUES
          (71,'100',501,'STL-DEP-DAD-B1',400,'adjustment',1,9,7,8,1);

        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
          refunded_minor,net_received_minor,refund_projection_guard
        ) VALUES
          ('100','dep-r1','DEP-R1',501,'BDT',30000,0,30000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}',0,30000,1),
          ('100','dep-r2','DEP-R2',501,'BDT',30000,0,30000,'posted',
           '2026-07-21T08:00:00.000Z','2026-07-21','2026-07-21T08:00:00.000Z',1,'${HASH}',0,30000,1);
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES
          ('100','dep-1','DEP-1','dep-r1',501,'BDT',30000,0,0,30000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}'),
          ('100','dep-2','DEP-2','dep-r2',501,'BDT',30000,0,0,30000,'posted',
           '2026-07-21T08:00:00.000Z','2026-07-21','2026-07-21T08:00:00.000Z',1,'${HASH}');
      `);

      const result = await finalizeSettlement(db, depositOnlyInput());

      expect(result.status).toBe('applied');
      expect(result.result.depositMinor).toBe(40_000);
      expect(result.result.bills[0].depositApplications).toHaveLength(2);
      expect(sqlite.prepare(`
        SELECT deposit_public_id,applied_minor,available_minor
        FROM canonical_deposits ORDER BY received_at_utc
      `).all()).toEqual([
        { deposit_public_id: 'dep-1', applied_minor: 30_000, available_minor: 0 },
        { deposit_public_id: 'dep-2', applied_minor: 10_000, available_minor: 20_000 },
      ]);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 40_000, due_minor: 10_000, credited_minor: 0, net_due_minor: 10_000 });
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('records settlement discount as canonical credit without increasing paid authority', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (43,'100',501,'STL-DISC',500,0,0,200,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,200,300,'partially_paid',43);
        INSERT INTO bill_discount_allocations VALUES
          (81,'100',1,43,'hospital_discount','settlement_discount',200,'Manager','Approved settlement discount');
      `);

      const result = await finalizeSettlement(db, discountOnlyInput());

      expect(result.status).toBe('applied');
      expect(result.result.discountMinor).toBe(20_000);
      expect(result.result.bills[0]).toMatchObject({
        paymentReceiptPublicId: null,
        creditNotePublicId: expect.any(String),
        paidMinor: 0,
        dueMinor: 50_000,
        creditedMinor: 20_000,
        netDueMinor: 30_000,
      });
      expect(count(sqlite, 'canonical_credit_notes')).toBe(1);
      expect(count(sqlite, 'canonical_credit_note_lines')).toBe(1);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 0, due_minor: 50_000, credited_minor: 20_000, net_due_minor: 30_000 });
    } finally {
      sqlite.close();
    }
  });

  it('applies mixed cash, deposit, then discount against one working invoice balance', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
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
        ) VALUES
          ('100','mix-dep-r','MIX-DEP-R',501,'BDT',30000,0,30000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}',0,30000,1);
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES
          ('100','mix-dep','MIX-DEP','mix-dep-r',501,'BDT',30000,0,0,30000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}');
      `);

      const result = await finalizeSettlement(db, mixedInput());

      expect(result.status).toBe('applied');
      expect(result.result).toMatchObject({ cashMinor: 10_000, depositMinor: 20_000, discountMinor: 10_000 });
      expect(result.result.bills[0]).toMatchObject({
        paidMinor: 30_000,
        dueMinor: 20_000,
        creditedMinor: 10_000,
        netDueMinor: 10_000,
        paymentReceiptPublicId: expect.any(String),
        creditNotePublicId: expect.any(String),
      });
      expect(result.result.bills[0].depositApplications).toHaveLength(1);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 30_000, due_minor: 20_000, credited_minor: 10_000, net_due_minor: 10_000 });
    } finally {
      sqlite.close();
    }
  });

  it('reconciles partial settlement against an invoice with pre-existing canonical credit', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        UPDATE canonical_invoices
        SET paid_minor=10000,due_minor=40000,credited_minor=5000,net_due_minor=35000
        WHERE invoice_public_id='inv-1';
        INSERT INTO billing_settlements VALUES
          (45,'100',501,'STL-CREDIT',350,50,100,50,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,350,150,'partially_paid',45);
        INSERT INTO payments VALUES
          (64,'100',1,50,'STL-CREDIT-B1','cash',9,7,8);
        INSERT INTO billing_deposits VALUES
          (73,'100',501,'STL-CREDIT-DAD-B1',100,'adjustment',1,9,7,8,1);
        INSERT INTO bill_discount_allocations VALUES
          (83,'100',1,45,'hospital_discount','settlement_discount',50,'Manager','Credit-aware settlement');
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
          refunded_minor,net_received_minor,refund_projection_guard
        ) VALUES (
          '100','credit-dep-r','CREDIT-DEP-R',501,'BDT',10000,0,10000,'posted',
          '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
          1,'${HASH}',0,10000,1
        );
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES (
          '100','credit-dep','CREDIT-DEP','credit-dep-r',501,'BDT',10000,0,0,10000,'posted',
          '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
          1,'${HASH}'
        );
      `);

      const result = await finalizeSettlement(db, {
        tenantId: '100',
        commandIdempotencyKey: 'settlement:STL-CREDIT',
        settlementPublicId: 'stl-public-credit',
        settlementReceiptNumber: 'STL-CREDIT',
        legacyPatientId: 501,
        currencyCode: 'BDT',
        occurredAtUtc: '2026-07-24T12:30:00.000Z',
        businessDate: '2026-07-24',
        legacyCollectorId: 9,
        legacyCounterId: 7,
        legacyCounterSessionId: 8,
        paymentMethod: 'cash',
        tenderType: 'cash',
        bills: [{
          billId: 1,
          invoicePublicId: 'inv-1',
          invoiceNumber: 'INV-1',
          legacyTotalMinor: 50_000,
          legacyPaidBeforeMinor: 15_000,
          legacyDueBeforeMinor: 35_000,
          canonicalPaidBeforeMinor: 10_000,
          canonicalDueBeforeMinor: 40_000,
          canonicalCreditedBeforeMinor: 5_000,
          canonicalNetDueBeforeMinor: 35_000,
          cashMinor: 5_000,
          depositMinor: 10_000,
          discountMinor: 5_000,
          paymentReceiptNumber: 'STL-CREDIT-B1',
          depositAdjustmentReceiptNumber: 'STL-CREDIT-DAD-B1',
          discountNumber: 'STL-CREDIT-DISC-B1',
          discountReasonCode: 'settlement_discount',
          discountAllocationType: 'hospital_discount',
          discountReferenceName: 'Manager',
          discountNote: 'Credit-aware settlement',
        }],
      });

      expect(result.status).toBe('applied');
      expect(result.result.bills[0]).toMatchObject({
        paidMinor: 25_000,
        dueMinor: 25_000,
        creditedMinor: 10_000,
        netDueMinor: 15_000,
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({
        paid_minor: 25_000,
        due_minor: 25_000,
        credited_minor: 10_000,
        net_due_minor: 15_000,
      });
    } finally {
      sqlite.close();
    }
  });

  it('replays identical evidence and rejects changed settlement evidence under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await finalizeSettlement(db, cashOnlyInput());
      const replay = await finalizeSettlement(db, cashOnlyInput());
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(2);

      const changed = cashOnlyInput();
      changed.bills[0].cashMinor = 49_999;
      await expect(finalizeSettlement(db, changed)).rejects.toBeInstanceOf(
        CanonicalIdempotencyConflictError,
      );
    } finally {
      sqlite.close();
    }
  });

  it('rolls back canonical facts when authoritative legacy SQL fails', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(finalizeSettlement(db, cashOnlyInput(), {
        authoritativeStatements: [db.prepare('INSERT INTO missing_settlement_authority VALUES (1)')],
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 0, due_minor: 50_000, credited_minor: 0, net_due_minor: 50_000 });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the outer batch when an invoice balance changes after planning', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(finalizeSettlement(db, cashOnlyInput(), {
        authoritativeStatements: [db.prepare(`
          UPDATE canonical_invoices
          SET paid_minor=1000,due_minor=49000,net_due_minor=49000
          WHERE tenant_id='100' AND invoice_public_id='inv-1'
        `)],
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 0, due_minor: 50_000, net_due_minor: 50_000 });
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a canonical deposit balance changes after FIFO planning', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (42,'100',501,'STL-DEP',500,0,400,0,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,400,100,'partially_paid',42);
        INSERT INTO billing_deposits VALUES
          (71,'100',501,'STL-DEP-DAD-B1',400,'adjustment',1,9,7,8,1);
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
          refunded_minor,net_received_minor,refund_projection_guard
        ) VALUES
          ('100','dep-r1','DEP-R1',501,'BDT',60000,0,60000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}',0,60000,1);
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES
          ('100','dep-1','DEP-1','dep-r1',501,'BDT',60000,0,0,60000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}');
      `);
      await expect(finalizeSettlement(db, depositOnlyInput(), {
        authoritativeStatements: [db.prepare(`
          UPDATE canonical_deposits
          SET applied_minor=1,available_minor=59999
          WHERE tenant_id='100' AND deposit_public_id='dep-1'
        `)],
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(0);
      expect(sqlite.prepare(`
        SELECT applied_minor,available_minor
        FROM canonical_deposits WHERE deposit_public_id='dep-1'
      `).get()).toEqual({ applied_minor: 0, available_minor: 60_000 });
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a canonical deposit FIFO identity changes after planning', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (42,'100',501,'STL-DEP',500,0,400,0,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,400,100,'partially_paid',42);
        INSERT INTO billing_deposits VALUES
          (71,'100',501,'STL-DEP-DAD-B1',400,'adjustment',1,9,7,8,1);
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
          refunded_minor,net_received_minor,refund_projection_guard
        ) VALUES
          ('100','dep-r1','DEP-R1',501,'BDT',60000,0,60000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}',0,60000,1);
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES
          ('100','dep-1','DEP-1','dep-r1',501,'BDT',60000,0,0,60000,'posted',
           '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}');
      `);

      await expect(finalizeSettlement(db, depositOnlyInput(), {
        authoritativeStatements: [db.prepare(`
          UPDATE canonical_deposits
          SET received_at_utc='2026-07-25T08:00:00.000Z'
          WHERE tenant_id='100' AND deposit_public_id='dep-1'
        `)],
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(0);
      expect(sqlite.prepare(`
        SELECT received_at_utc,applied_minor,available_minor
        FROM canonical_deposits WHERE deposit_public_id='dep-1'
      `).get()).toEqual({
        received_at_utc: '2026-07-20T08:00:00.000Z',
        applied_minor: 0,
        available_minor: 60_000,
      });
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when an expected committed payment source row is missing', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec("DELETE FROM payments WHERE receipt_no='STL-1-B1'");
      await expect(finalizeSettlement(db, cashOnlyInput())).rejects.toThrow();
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when an expected committed deposit-adjustment source row is missing', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (42,'100',501,'STL-DEP',500,0,400,0,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,400,100,'partially_paid',42);
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
          refunded_minor,net_received_minor,refund_projection_guard
        ) VALUES (
          '100','missing-dep-r','MISSING-DEP-R',501,'BDT',60000,0,60000,'posted',
          '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
          1,'${HASH}',0,60000,1
        );
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES (
          '100','missing-dep','MISSING-DEP','missing-dep-r',501,'BDT',60000,0,0,60000,'posted',
          '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
          1,'${HASH}'
        );
      `);

      await expect(finalizeSettlement(db, depositOnlyInput())).rejects.toThrow();
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(sqlite.prepare(`
        SELECT applied_minor,available_minor FROM canonical_deposits
        WHERE deposit_public_id='missing-dep'
      `).get()).toEqual({ applied_minor: 0, available_minor: 60_000 });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when an expected committed discount-allocation source row is missing', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (43,'100',501,'STL-DISC',500,0,0,200,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,200,300,'partially_paid',43);
      `);

      await expect(finalizeSettlement(db, discountOnlyInput())).rejects.toThrow();
      expect(count(sqlite, 'canonical_credit_notes')).toBe(0);
      expect(count(sqlite, 'canonical_credit_note_lines')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when committed settlement header evidence changes before mapping', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec("UPDATE billing_settlements SET payment_mode='card' WHERE settlement_receipt_no='STL-1'");

      await expect(finalizeSettlement(db, cashOnlyInput())).rejects.toThrow();
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor FROM canonical_invoices
        WHERE invoice_public_id='inv-1'
      `).get()).toEqual({ paid_minor: 0, due_minor: 50_000 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects settlement discount before mutation when paid doctor compensation exists', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM payments;
        DELETE FROM bills;
        DELETE FROM billing_settlements;
        INSERT INTO billing_settlements VALUES
          (43,'100',501,'STL-DISC',500,0,0,200,'cash',9,7,8,1);
        INSERT INTO bills VALUES
          (1,'100',501,'INV-1',500,200,300,'partially_paid',43);
        INSERT INTO bill_discount_allocations VALUES
          (81,'100',1,43,'hospital_discount','settlement_discount',200,'Manager','Approved settlement discount');
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (
          '100','invoice','inv-1','legacy_bill','1','bills','mapped',1,'${HASH}'
        );
        INSERT INTO doctor_commission_accruals VALUES ('100',1,'paid');
      `);
      await expect(finalizeSettlement(db, discountOnlyInput()))
        .rejects.toThrow(/paid performer|compensation/i);
      expect(count(sqlite, 'canonical_credit_notes')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

});

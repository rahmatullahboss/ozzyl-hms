import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { cancelSettlement } from '../../src/lib/canonical/commands/cancel-settlement';
import {
  executeSettlementCancellationOriginalLegacy,
  prepareSettlementCancellationStrictContext,
  prepareSettlementCancellationStrictStatements,
  type SettlementCancellationInput,
} from '../../src/lib/canonical/settlement-cancellation';

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
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
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
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE billing_settlements (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      settlement_receipt_no TEXT NOT NULL,
      payable_amount REAL NOT NULL,
      paid_amount REAL NOT NULL,
      deposit_deducted REAL NOT NULL,
      discount_amount REAL NOT NULL,
      discount_by_name TEXT,
      payment_mode TEXT NOT NULL,
      remarks TEXT,
      created_by INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
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
      payment_type TEXT,
      receipt_no TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      received_by INTEGER,
      counter_id INTEGER,
      counter_session_id INTEGER,
      date TEXT
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_bill_id INTEGER,
      remarks TEXT,
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
      percent REAL,
      reference_name TEXT,
      note TEXT,
      created_by INTEGER
    );
    CREATE TABLE billing_credit_bill_status (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      settlement_status TEXT NOT NULL,
      settlement_id INTEGER,
      updated_at TEXT
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id INTEGER,
      reference_type TEXT,
      payment_method TEXT,
      description TEXT
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT
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
    CREATE TABLE accounting_vouchers (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE accounting_journal_lines (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      voucher_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      debit_amount REAL NOT NULL,
      credit_amount REAL NOT NULL,
      memo TEXT,
      line_no INTEGER NOT NULL
    );
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      posted_voucher_id INTEGER,
      posted_at TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (tenant_id, source_event_key)
    );

    INSERT INTO billing_counter_sessions VALUES (8,'100',7,9,'active');
    INSERT INTO billing_settlements VALUES
      (44,'100',501,'STL-MIX',500,100,200,100,'Manager','cash','Mixed',9,7,8,1,NULL);
    INSERT INTO bills VALUES
      (1,'100',501,'INV-1',500,400,100,'partially_paid',44);
    INSERT INTO payments VALUES
      (63,'100',1,100,'due','STL-MIX-B1','cash',9,7,8,'2026-07-24 18:00:00');
    INSERT INTO billing_deposits VALUES
      (72,'100',501,'STL-MIX-DAD-B1',200,'adjustment',1,'Settlement deduction',9,7,8,1);
    INSERT INTO bill_discount_allocations VALUES
      (82,'100',1,44,'hospital_discount','settlement_discount',100,20,'Manager','Mixed',9);
    INSERT INTO billing_credit_bill_status VALUES (91,'100',1,'Completed',44,NULL);
    INSERT INTO emp_cash_transactions VALUES
      (101,'100',9,7,8,'CollectionFromReceivable',100,44,'settlement','cash','Settlement STL-MIX');

    INSERT INTO accounting_vouchers VALUES (301,'100','settlement_discount:STL-MIX-DISC-B1:settlement_discount','verified');
    INSERT INTO accounting_journal_lines VALUES
      (401,'100',301,111,100,0,'Discount debit',1),
      (402,'100',301,222,0,100,'Receivable credit',2);
    INSERT INTO accounting_posting_events VALUES
      (201,'100','payment:STL-MIX-B1:payment_received','payment','STL-MIX-B1','payment_received',
       '2026-07-24','{"settlementReceiptNo":"STL-MIX","receiptNo":"STL-MIX-B1","billId":1,"patientId":501,"amount":100,"paymentMethod":"cash","paymentType":"due"}',
       'pending',0,NULL,NULL,NULL,'9',NULL,NULL),
      (202,'100','patient_deposit_adjustment:STL-MIX-DAD-B1:patient_deposit_adjusted',
       'patient_deposit_adjustment','STL-MIX-DAD-B1','patient_deposit_adjusted','2026-07-24',
       '{"settlementReceiptNo":"STL-MIX","receiptNo":"STL-MIX-DAD-B1","billId":1,"patientId":501,"amount":200}',
       'failed',1,'retry',NULL,NULL,'9',NULL,NULL),
      (203,'100','settlement_discount:STL-MIX-DISC-B1:settlement_discount','settlement_discount',
       'STL-MIX-DISC-B1','settlement_discount','2026-07-24',
       '{"settlementReceiptNo":"STL-MIX","receiptNo":"STL-MIX-DISC-B1","billId":1,"patientId":501,"amount":100,"discountAllocations":[{"allocationType":"hospital_discount","amount":100}]}',
       'posted',1,NULL,301,'2026-07-24 18:01:00','9',NULL,NULL);

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,
      posted_at_utc,source_evidence_sha256,paid_minor,due_minor,credited_minor,
      net_due_minor,adjustment_projection_guard
    ) VALUES (
      '100','inv-1','INV-1',501,'BDT',50000,0,50000,'posted',
      '2026-07-24T08:00:00.000Z','2026-07-24T08:00:00.000Z','${HASH}',
      30000,20000,10000,10000,1
    );
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES (
      '100','pay-r','STL-MIX-B1',501,'BDT',10000,10000,0,'posted',
      '2026-07-24T12:00:00.000Z','2026-07-24','2026-07-24T12:00:00.000Z',1,'${HASH}',0,10000,1
    );
    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
      amount_minor,reversed_minor,remaining_minor,status,captured_at_utc,source_evidence_sha256
    ) VALUES ('100','pay-t','pay-r','cash','cash',10000,0,10000,'captured',
              '2026-07-24T12:00:00.000Z','${HASH}');
    INSERT INTO canonical_payment_allocations (
      tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
      amount_minor,invoice_due_before_minor,invoice_due_after_minor,reversed_minor,
      remaining_minor,status,allocated_at_utc,source_evidence_sha256
    ) VALUES ('100','pay-a','pay-r','inv-1',10000,50000,40000,0,10000,'active',
              '2026-07-24T12:00:00.000Z','${HASH}');
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES (
      '100','dep-r','DEP-R',501,'BDT',30000,0,30000,'posted',
      '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}',0,30000,1
    );
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,
      legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
      available_minor,status,received_at_utc,business_date,posted_at_utc,
      reconciliation_guard,source_evidence_sha256
    ) VALUES (
      '100','dep-1','DEP-1','dep-r',501,'BDT',30000,20000,0,10000,'posted',
      '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',1,'${HASH}'
    );
    INSERT INTO canonical_deposit_applications (
      tenant_id,application_public_id,deposit_public_id,invoice_public_id,
      amount_minor,deposit_available_before_minor,deposit_available_after_minor,
      invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,
      invoice_due_after_minor,invoice_net_due_before_minor,invoice_net_due_after_minor,
      status,applied_at_utc,source_evidence_sha256
    ) VALUES ('100','dep-app','dep-1','inv-1',20000,30000,10000,10000,30000,
              40000,20000,40000,20000,'active','2026-07-24T12:00:00.000Z','${HASH}');
    INSERT INTO canonical_credit_notes (
      tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
      legacy_patient_id,currency_code,reason_code,total_minor,
      invoice_credited_before_minor,invoice_credited_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,status,
      issued_at_utc,business_date,posted_at_utc,source_evidence_sha256
    ) VALUES ('100','credit-1','STL-MIX-DISC-B1','inv-1',501,'BDT',
              'settlement_discount',10000,0,10000,20000,10000,'posted',
              '2026-07-24T12:00:00.000Z','2026-07-24',
              '2026-07-24T12:00:00.000Z','${HASH}');
    INSERT INTO canonical_credit_note_lines (
      tenant_id,credit_line_public_id,credit_note_public_id,invoice_public_id,
      invoice_line_public_id,amount_minor,reason_code,source_evidence_sha256
    ) VALUES ('100','credit-line','credit-1','inv-1',NULL,10000,
              'settlement_discount','${HASH}');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('100','invoice','inv-1','legacy_bill','1','bills','mapped',1,'${HASH}'),
      ('100','settlement','stl-1','legacy_settlement','STL-MIX','billing_settlements','mapped',1,'${HASH}'),
      ('100','payment_receipt','pay-r','legacy_settlement_payment','STL-MIX-B1','payments','mapped',1,'${HASH}'),
      ('100','deposit_application','dep-app','legacy_settlement_deposit_adjustment','STL-MIX-DAD-B1','billing_deposits','mapped',1,'${HASH}'),
      ('100','credit_note','credit-1','legacy_settlement_discount','STL-MIX-DISC-B1','bill_discount_allocations','mapped',1,'${HASH}');
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

function cancellationInput(): SettlementCancellationInput {
  return {
    tenantId: '100',
    userId: 9,
    settlementId: 44,
    businessDate: '2026-07-25',
    cancelledAtUtc: '2026-07-24T21:30:00.000Z',
    activeCounterId: 7,
    activeCounterSessionId: 8,
    settlement: {
      id: 44,
      patientId: 501,
      receiptNo: 'STL-MIX',
      payableAmount: 500,
      paidAmount: 100,
      depositDeducted: 200,
      discountAmount: 100,
      discountByName: 'Manager',
      paymentMode: 'cash',
      remarks: 'Mixed',
      createdBy: 9,
      counterId: 7,
      counterSessionId: 8,
      isActive: 1,
    },
    bills: [{
      id: 1,
      invoiceNo: 'INV-1',
      patientId: 501,
      total: 500,
      paid: 400,
      due: 100,
      status: 'partially_paid',
      settlementId: 44,
    }],
  };
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get() as { count: number }).count);
}

describe('settlement cancellation authority adapter', () => {
  it('commits exact legacy rollback, canonical reversal, and posted-voucher reversal intent atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const context = await prepareSettlementCancellationStrictContext(db, cancellationInput());
      const result = await cancelSettlement(db, context.commandInput, {
        authoritativeStatements: prepareSettlementCancellationStrictStatements(db, context),
      });

      expect(result.status).toBe('applied');
      expect(sqlite.prepare('SELECT paid,due,status,settlement_id FROM bills WHERE id=1').get()).toEqual({
        paid: 0,
        due: 500,
        status: 'open',
        settlement_id: null,
      });
      expect(sqlite.prepare('SELECT is_active FROM billing_settlements WHERE id=44').get()).toEqual({ is_active: 0 });
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'billing_deposits')).toBe(0);
      expect(count(sqlite, 'bill_discount_allocations')).toBe(0);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(0);
      expect(sqlite.prepare('SELECT settlement_status,settlement_id FROM billing_credit_bill_status').get()).toEqual({
        settlement_status: 'Pending',
        settlement_id: null,
      });
      expect(count(sqlite, 'accounting_posting_events', "WHERE source_type IN ('payment','patient_deposit_adjustment')")).toBe(0);
      expect(count(sqlite, 'accounting_posting_events', "WHERE id=203 AND status='posted'")).toBe(1);
      const reversal = sqlite.prepare(`
        SELECT event_type,payload_json,status FROM accounting_posting_events
        WHERE source_type='settlement_cancellation_accounting_reversal'
      `).get() as { event_type: string; payload_json: string; status: string };
      expect(reversal.event_type).toBe('manual_journal');
      expect(reversal.status).toBe('pending');
      expect(JSON.parse(reversal.payload_json)).toMatchObject({
        lines: [
          { accountId: 111, debit: 0, credit: 100 },
          { accountId: 222, debit: 100, credit: 0 },
        ],
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,credited_minor,net_due_minor FROM canonical_invoices
      `).get()).toEqual({ paid_minor: 0, due_minor: 50000, credited_minor: 0, net_due_minor: 50000 });
      expect(count(sqlite, 'audit_logs', "WHERE action='CANCEL'")).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed before mutation for missing discount evidence or accounting processing races', async () => {
    const missingHarness = harness();
    try {
      missingHarness.sqlite.exec('DELETE FROM bill_discount_allocations');
      await expect(prepareSettlementCancellationStrictContext(missingHarness.db, cancellationInput()))
        .rejects.toThrow(/discount.*evidence|allocation/i);
      expect(missingHarness.sqlite.prepare('SELECT is_active FROM billing_settlements').get()).toEqual({ is_active: 1 });
    } finally {
      missingHarness.sqlite.close();
    }

    const processingHarness = harness();
    try {
      processingHarness.sqlite.exec("UPDATE accounting_posting_events SET status='processing' WHERE id=201");
      await expect(prepareSettlementCancellationStrictContext(processingHarness.db, cancellationInput()))
        .rejects.toThrow(/processing|race/i);
      expect(processingHarness.sqlite.prepare('SELECT is_active FROM billing_settlements').get()).toEqual({ is_active: 1 });
    } finally {
      processingHarness.sqlite.close();
    }
  });

  it('rolls back both legacy and canonical authority when a legacy balance changes after planning', async () => {
    let race = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (!race) return;
        race = false;
        database.exec('UPDATE bills SET paid=399,due=101 WHERE id=1');
      },
    });
    try {
      const context = await prepareSettlementCancellationStrictContext(db, cancellationInput());
      race = true;
      await expect(cancelSettlement(db, context.commandInput, {
        authoritativeStatements: prepareSettlementCancellationStrictStatements(db, context),
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_payment_reversals')).toBe(0);
      expect(sqlite.prepare('SELECT is_active FROM billing_settlements').get()).toEqual({ is_active: 1 });
      expect(count(sqlite, 'payments')).toBe(1);
      expect(sqlite.prepare('SELECT status FROM canonical_credit_notes').get()).toEqual({ status: 'posted' });
    } finally {
      sqlite.close();
    }
  });

  it('preserves the reviewed legacy heuristic cancellation workflow', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        DELETE FROM accounting_posting_events WHERE source_type='settlement_discount';
        DELETE FROM bill_discount_allocations;
      `);
      const result = await executeSettlementCancellationOriginalLegacy(db, cancellationInput());
      expect(result.results.length).toBeGreaterThan(0);
      expect(sqlite.prepare('SELECT paid,due,status,settlement_id FROM bills').get()).toEqual({
        paid: 0,
        due: 500,
        status: 'open',
        settlement_id: null,
      });
      expect(sqlite.prepare('SELECT is_active FROM billing_settlements').get()).toEqual({ is_active: 0 });
    } finally {
      sqlite.close();
    }
  });
});

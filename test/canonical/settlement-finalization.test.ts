import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  buildSettlementPlan,
  executeSettlementOriginalLegacy,
  prepareSettlementStrictContext,
  prepareSettlementStrictStatements,
  type SettlementPreparationInput,
} from '../../src/lib/canonical/settlement-finalization';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
} from '../../src/lib/accounting-posting';

class RecordedStatement implements CanonicalPreparedStatement {
  readonly params: unknown[];

  constructor(
    readonly sql: string,
    params: unknown[] = [],
  ) {
    this.params = params;
  }

  bind(...values: unknown[]): RecordedStatement {
    return new RecordedStatement(this.sql, values);
  }

  async run(): Promise<unknown> {
    return { success: true, meta: { changes: 1, last_row_id: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (/SELECT id FROM billing_settlements/i.test(this.sql)) {
      return { id: 41 } as T;
    }
    return null;
  }
}

function recorder() {
  let batchStatements: RecordedStatement[] = [];
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new RecordedStatement(sql);
    },
    async batch(statements) {
      batchStatements = [...statements] as RecordedStatement[];
      return statements.map((_statement, index) => ({
        success: true,
        meta: { changes: 1, last_row_id: index === 0 ? 41 : 0 },
      }));
    },
  };
  return { db, statements: () => batchStatements };
}

type SqlValue = string | number | bigint | null | Uint8Array;

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

function strictHarness() {
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      UNIQUE (tenant_id, settlement_receipt_no)
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      receipt_no TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      received_by INTEGER,
      counter_id INTEGER,
      counter_session_id INTEGER,
      tenant_id TEXT NOT NULL,
      date TEXT,
      UNIQUE (tenant_id, receipt_no)
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (tenant_id, deposit_receipt_no)
    );
    CREATE TABLE bill_discount_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      settlement_id INTEGER,
      allocation_type TEXT NOT NULL,
      discount_reason TEXT NOT NULL,
      amount REAL NOT NULL,
      percent REAL,
      reference_name TEXT,
      note TEXT,
      created_by INTEGER,
      UNIQUE (tenant_id, bill_id, settlement_id, allocation_type, discount_reason)
    );
    CREATE TABLE billing_credit_bill_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      settlement_status TEXT NOT NULL,
      settlement_id INTEGER,
      updated_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT,
      UNIQUE (tenant_id, source_event_key)
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

    INSERT INTO billing_counter_sessions VALUES (8,'100',7,9,'active');
    INSERT INTO bills VALUES (1,'100',501,'INV-1',500,0,500,'due',NULL);
    INSERT INTO billing_deposits (
      tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,is_active
    ) VALUES ('100',501,'DEP-LEGACY',300,'deposit',1);

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

    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES (
      '100','dep-r','DEP-R',501,'BDT',30000,0,30000,'posted',
      '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
      1,'${HASH}',0,30000,1
    );
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,
      legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
      available_minor,status,received_at_utc,business_date,posted_at_utc,
      reconciliation_guard,source_evidence_sha256
    ) VALUES (
      '100','dep-1','DEP-1','dep-r',501,'BDT',30000,0,0,30000,'posted',
      '2026-07-20T08:00:00.000Z','2026-07-20','2026-07-20T08:00:00.000Z',
      1,'${HASH}'
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
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

function strictInput(calls: string[] = []): SettlementPreparationInput {
  return {
    tenantId: '100',
    userId: 9,
    patientId: 501,
    requestedBillIds: [1],
    bills: [{
      id: 1,
      invoiceNo: 'INV-1',
      patientId: 501,
      total: 500,
      paid: 0,
      due: 500,
      status: 'due',
      settlementId: null,
    }],
    paidAmount: 100,
    depositDeducted: 200,
    discountAmount: 100,
    discountByName: 'Manager',
    discountReasonCode: 'settlement_discount',
    discountAllocationType: 'hospital_discount',
    paymentMode: 'cash',
    remarks: 'Approved mixed settlement',
    businessDate: '2026-07-24',
    occurredAtUtc: '2026-07-24T12:00:00.000Z',
    counterId: 7,
    counterSessionId: 8,
    dependencies: {
      async nextReceiptNo() {
        calls.push('sequence');
        return 'STL-STRICT';
      },
    },
  };
}

function input(calls: string[] = []): SettlementPreparationInput {
  return {
    tenantId: '100',
    userId: 9,
    patientId: 501,
    requestedBillIds: [2, 1],
    bills: [
      { id: 2, invoiceNo: 'INV-2', patientId: 501, total: 500, paid: 0, due: 500, status: 'due', settlementId: null },
      { id: 1, invoiceNo: 'INV-1', patientId: 501, total: 500, paid: 0, due: 500, status: 'due', settlementId: null },
    ],
    paidAmount: 600,
    depositDeducted: 200,
    discountAmount: 100,
    discountByName: 'Manager',
    discountReasonCode: 'settlement_discount',
    discountAllocationType: 'hospital_discount',
    paymentMode: 'cash',
    remarks: 'Approved mixed settlement',
    businessDate: '2026-07-24',
    occurredAtUtc: '2026-07-24T12:00:00.000Z',
    counterId: 7,
    counterSessionId: 8,
    dependencies: {
      async nextReceiptNo() {
        calls.push('sequence');
        return 'STL-1';
      },
    },
  };
}

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function countRows(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('settlement finalization legacy authority', () => {
  it('allocates cash, deposit and discount in bill order with stable source receipts', () => {
    const plan = buildSettlementPlan(input(), 'STL-1');

    expect(plan.payableAmount).toBe(1000);
    expect(plan.billPlans).toEqual([
      expect.objectContaining({
        id: 1,
        cashApplied: 500,
        depositApplied: 0,
        discountApplied: 0,
        paidAfter: 500,
        dueAfter: 0,
        statusAfter: 'paid',
        paymentReceiptNo: 'STL-1-B1',
        depositReceiptNo: null,
        discountReceiptNo: null,
      }),
      expect.objectContaining({
        id: 2,
        cashApplied: 100,
        depositApplied: 200,
        discountApplied: 100,
        paidAfter: 400,
        dueAfter: 100,
        statusAfter: 'partially_paid',
        paymentReceiptNo: 'STL-1-B2',
        depositReceiptNo: 'STL-1-DAD-B2',
        discountReceiptNo: 'STL-1-DISC-B2',
      }),
    ]);
  });

  it('preserves the original mutation and accounting-event statement order', async () => {
    const calls: string[] = [];
    const { db, statements } = recorder();

    const result = await executeSettlementOriginalLegacy(db, input(calls));
    const sql = statements().map((statement) => normalized(statement.sql));

    expect(calls).toEqual(['sequence']);
    expect(result.settlementId).toBe(41);
    expect(result.context.receiptNo).toBe('STL-1');
    expect(sql).toHaveLength(14);
    expect(sql[0]).toContain('INSERT INTO billing_settlements');
    expect(sql[1]).toContain('UPDATE bills SET paid');
    expect(sql[2]).toContain('INSERT INTO payments');
    expect(sql[3]).toContain('UPDATE bills SET paid');
    expect(sql[4]).toContain('INSERT INTO payments');
    expect(sql[5]).toContain('INSERT INTO billing_deposits');
    expect(sql[6]).toContain('INSERT INTO bill_discount_allocations');
    expect(sql[7]).toContain('UPDATE billing_credit_bill_status');
    expect(sql[8]).toContain('INSERT INTO emp_cash_transactions');
    expect(sql[9]).toContain('INSERT OR IGNORE INTO accounting_posting_events');
    expect(sql[10]).toContain('INSERT OR IGNORE INTO accounting_posting_events');
    expect(sql[11]).toContain('INSERT OR IGNORE INTO accounting_posting_events');
    expect(sql[12]).toContain('INSERT OR IGNORE INTO accounting_posting_events');
    expect(sql[13]).toContain('INSERT INTO audit_logs');

    expect(statements()[2].params).toContain('STL-1-B1');
    expect(statements()[4].params).toContain('STL-1-B2');
    expect(statements()[5].params).toContain('STL-1-DAD-B2');
    expect(statements()[6].params).toContain('hospital_discount');
    expect(statements()[6].params).toContain('settlement_discount');
  });

  it('preserves legacy total-minus-paid authority when the stored due projection is stale', async () => {
    const { db } = recorder();
    const legacy = input();
    legacy.requestedBillIds = [1];
    legacy.bills = [{
      id: 1,
      invoiceNo: 'INV-1',
      patientId: 501,
      total: 500,
      paid: 100,
      due: 999,
      status: 'stale_status',
      settlementId: 77,
    }];
    legacy.paidAmount = 100;
    legacy.depositDeducted = 0;
    legacy.discountAmount = 0;

    const result = await executeSettlementOriginalLegacy(db, legacy);

    expect(result.context.payableAmount).toBe(400);
    expect(result.context.billPlans).toEqual([
      expect.objectContaining({
        id: 1,
        due: 400,
        cashApplied: 100,
        paidAfter: 200,
        dueAfter: 300,
      }),
    ]);
  });

  it('preserves every requested bill id for credit-status, audit and post-commit metadata', async () => {
    const { db, statements } = recorder();
    const legacy = input();
    legacy.requestedBillIds = [2, 1];
    legacy.bills = [
      {
        id: 2,
        invoiceNo: 'INV-2',
        patientId: 501,
        total: 500,
        paid: 500,
        due: 0,
        status: 'paid',
        settlementId: null,
      },
      {
        id: 1,
        invoiceNo: 'INV-1',
        patientId: 501,
        total: 500,
        paid: 0,
        due: 500,
        status: 'open',
        settlementId: null,
      },
    ];
    legacy.paidAmount = 100;
    legacy.depositDeducted = 0;
    legacy.discountAmount = 0;

    const result = await executeSettlementOriginalLegacy(db, legacy);
    const creditStatus = statements().find((statement) => (
      normalized(statement.sql).includes('UPDATE billing_credit_bill_status')
    ));
    const audit = statements().find((statement) => (
      normalized(statement.sql).includes('INSERT INTO audit_logs')
    ));

    expect(result.context.requestedBillIds).toEqual([2, 1]);
    expect(creditStatus?.params.slice(-2)).toEqual([2, 1]);
    expect(JSON.parse(String(audit?.params[4]))).toMatchObject({ billIds: [2, 1] });
  });

  it('keeps the original helper free of canonical and assertion authority', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/canonical/settlement-finalization.ts', 'utf8');
    const start = source.indexOf('function originalLegacyStatements(');
    const end = source.indexOf('export async function executeSettlementOriginalLegacy(', start);
    const section = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(section).not.toContain('canonical_');
    expect(section).not.toContain('prepareFinancialBatchAssertion');
    expect(section).not.toContain('changes()');
  });

  it('rejects missing canonical invoice mapping before allocating the settlement receipt', async () => {
    const calls: string[] = [];
    const { db } = recorder();

    await expect(prepareSettlementStrictContext(db, input(calls)))
      .rejects.toThrow(/invoice mapping/i);
    expect(calls).toEqual([]);
  });

  it('resolves exact invoice and deposit authority before allocating the receipt', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput(calls));
      expect(calls).toEqual(['sequence']);
      expect(context.receiptNo).toBe('STL-STRICT');
      expect(context.canonicalInvoices.get(1)).toMatchObject({
        invoicePublicId: 'inv-1',
        totalMinor: 50_000,
        paidMinor: 0,
        dueMinor: 50_000,
        creditedMinor: 0,
        netDueMinor: 50_000,
      });
      expect(context.legacyDepositBalanceMinor).toBe(30_000);
      expect(context.canonicalDeposits).toEqual([
        expect.objectContaining({ depositPublicId: 'dep-1', availableMinor: 30_000 }),
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('rejects invoice balance drift before allocating the receipt', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      sqlite.exec(`
        UPDATE canonical_invoices
        SET paid_minor=1000,due_minor=49000,net_due_minor=49000
        WHERE invoice_public_id='inv-1'
      `);
      await expect(prepareSettlementStrictContext(db, strictInput(calls)))
        .rejects.toThrow(/balances do not reconcile/i);
      expect(calls).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('rejects legacy and canonical deposit drift before allocating the receipt', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      sqlite.exec(`
        UPDATE canonical_deposits
        SET applied_minor=1000,available_minor=29000
        WHERE deposit_public_id='dep-1'
      `);
      await expect(prepareSettlementStrictContext(db, strictInput(calls)))
        .rejects.toThrow(/deposit balances do not reconcile/i);
      expect(calls).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('atomically commits guarded mixed legacy settlement authority', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput(calls));
      await db.batch(prepareSettlementStrictStatements(db, context));

      expect(sqlite.prepare(`
        SELECT patient_id,settlement_receipt_no,payable_amount,paid_amount,
               deposit_deducted,discount_amount,counter_id,counter_session_id
        FROM billing_settlements
      `).get()).toEqual({
        patient_id: 501,
        settlement_receipt_no: 'STL-STRICT',
        payable_amount: 500,
        paid_amount: 100,
        deposit_deducted: 200,
        discount_amount: 100,
        counter_id: 7,
        counter_session_id: 8,
      });
      expect(sqlite.prepare(`SELECT paid,due,status,settlement_id FROM bills WHERE id=1`).get())
        .toEqual({ paid: 400, due: 100, status: 'partially_paid', settlement_id: 1 });
      expect(countRows(sqlite, 'payments')).toBe(1);
      expect(countRows(sqlite, 'bill_discount_allocations')).toBe(1);
      expect(countRows(sqlite, 'emp_cash_transactions')).toBe(1);
      expect(countRows(sqlite, 'accounting_posting_events')).toBe(3);
      expect(countRows(sqlite, 'audit_logs')).toBe(1);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it.each([
    ['legacy bill balance', 'UPDATE bills SET paid=1,due=499 WHERE id=1'],
    ['counter session', "UPDATE billing_counter_sessions SET status='closed' WHERE id=8"],
    ['invoice mapping', "DELETE FROM canonical_source_mappings WHERE entity_type='invoice'"],
    ['canonical invoice status', "UPDATE canonical_invoices SET status='cancelled',cancelled_at_utc='2026-07-24T12:30:00.000Z' WHERE invoice_public_id='inv-1'"],
    ['canonical deposit balance', "UPDATE canonical_deposits SET applied_minor=1,available_minor=29999 WHERE deposit_public_id='dep-1'"],
  ])('rolls back every strict row for a current %s race', async (_label, mutation) => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput(calls));
      sqlite.exec(mutation);
      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();

      expect(countRows(sqlite, 'billing_settlements')).toBe(0);
      expect(countRows(sqlite, 'payments')).toBe(0);
      expect(countRows(sqlite, 'bill_discount_allocations')).toBe(0);
      expect(countRows(sqlite, 'emp_cash_transactions')).toBe(0);
      expect(countRows(sqlite, 'accounting_posting_events')).toBe(0);
      expect(countRows(sqlite, 'audit_logs')).toBe(0);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a conflicting invoice mapping appears after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput());
      sqlite.exec(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,
          posted_at_utc,source_evidence_sha256,paid_minor,due_minor,credited_minor,
          net_due_minor,adjustment_projection_guard
        ) VALUES (
          '100','inv-conflict','INV-CONFLICT',501,'BDT',50000,0,50000,'posted',
          '2026-07-24T08:00:00.000Z','2026-07-24T08:00:00.000Z','${HASH}',
          0,50000,0,50000,1
        );
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (
          '100','invoice','inv-conflict','legacy_live_bill','INV-1',
          'bills','mapped',1,'${HASH}'
        );
      `);

      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();
      expect(countRows(sqlite, 'billing_settlements')).toBe(0);
      expect(countRows(sqlite, 'payments')).toBe(0);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when the settlement receipt is claimed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput());
      sqlite.exec(`
        INSERT INTO billing_settlements (
          tenant_id,patient_id,settlement_receipt_no,payable_amount,paid_amount,
          deposit_deducted,discount_amount,payment_mode,created_by,counter_id,counter_session_id
        ) VALUES ('100',501,'STL-STRICT',500,0,0,0,'cash',9,7,8)
      `);
      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();
      expect(countRows(sqlite, 'billing_settlements')).toBe(1);
      expect(countRows(sqlite, 'payments')).toBe(0);
      expect(sqlite.prepare('SELECT paid,due,settlement_id FROM bills WHERE id=1').get())
        .toEqual({ paid: 0, due: 500, settlement_id: null });
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a per-bill payment receipt is claimed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput());
      sqlite.exec(`
        INSERT INTO payments (
          bill_id,amount,payment_type,receipt_no,payment_method,received_by,
          counter_id,counter_session_id,tenant_id,date
        ) VALUES (1,1,'due','STL-STRICT-B1','cash',9,7,8,'100','2026-07-24')
      `);
      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();
      expect(countRows(sqlite, 'billing_settlements')).toBe(0);
      expect(countRows(sqlite, 'payments')).toBe(1);
      expect(sqlite.prepare('SELECT paid,due,settlement_id FROM bills WHERE id=1').get())
        .toEqual({ paid: 0, due: 500, settlement_id: null });
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a deposit adjustment receipt is claimed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput());
      sqlite.exec(`
        INSERT INTO billing_deposits (
          tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,
          reference_bill_id,created_by,counter_id,counter_session_id,is_active
        ) VALUES ('100',501,'STL-STRICT-DAD-B1',1,'adjustment',1,9,7,8,0)
      `);
      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();
      expect(countRows(sqlite, 'billing_settlements')).toBe(0);
      expect(countRows(sqlite, 'payments')).toBe(0);
      expect(countRows(sqlite, 'billing_deposits')).toBe(2);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a settlement discount allocation is claimed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput());
      sqlite.exec(`
        INSERT INTO bill_discount_allocations (
          tenant_id,bill_id,settlement_id,allocation_type,discount_reason,
          amount,percent,reference_name,note,created_by
        ) VALUES (
          '100',1,1,'hospital_discount','settlement_discount',1,0.2,
          'Manager','Approved mixed settlement',9
        )
      `);

      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();
      expect(countRows(sqlite, 'billing_settlements')).toBe(0);
      expect(countRows(sqlite, 'payments')).toBe(0);
      expect(countRows(sqlite, 'bill_discount_allocations')).toBe(1);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when an accounting event key is claimed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareSettlementStrictContext(db, strictInput());
      const key = createPostingEventKey(
        'payment',
        'STL-STRICT-B1',
        ACCOUNTING_EVENT_TYPES.paymentReceived,
      );
      sqlite.prepare(`
        INSERT INTO accounting_posting_events (
          tenant_id,source_event_key,source_type,source_id,event_type,
          event_date,payload_json,created_by
        ) VALUES (?,?,?,?,?,?,?,?)
      `).run(
        '100', key, 'payment', 'STL-STRICT-B1',
        ACCOUNTING_EVENT_TYPES.paymentReceived, '2026-07-24', '{}', '9',
      );
      await expect(db.batch(prepareSettlementStrictStatements(db, context))).rejects.toThrow();
      expect(countRows(sqlite, 'billing_settlements')).toBe(0);
      expect(countRows(sqlite, 'payments')).toBe(0);
      expect(countRows(sqlite, 'accounting_posting_events')).toBe(1);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  prepareGatewayPaymentLegacyStatements,
  prepareGatewayPaymentOriginalLegacyStatements,
  prepareGatewayPaymentStrictStatements,
  type GatewayPaymentLegacyInput,
} from '../../src/lib/canonical/gateway-payment-verification';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
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

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0532_canonical_financial_batch_assertions.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      due REAL NOT NULL,
      status TEXT NOT NULL,
      tenant_id TEXT NOT NULL
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      receipt_no TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      received_by TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      date TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      external_transaction_id TEXT,
      UNIQUE (tenant_id, receipt_no),
      UNIQUE (tenant_id, idempotency_key)
    );
    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      remarks TEXT NOT NULL,
      reference_bill_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE (tenant_id, deposit_receipt_no)
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id INTEGER NOT NULL,
      reference_type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE TABLE payment_gateway_logs (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      raw_response TEXT,
      updated_at TEXT
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
      created_by TEXT NOT NULL,
      UNIQUE (tenant_id, source_event_key)
    );
  `);
  sqlite.prepare(`
    INSERT INTO bills (id,patient_id,total,paid,due,status,tenant_id)
    VALUES (10,20,1000,200,800,'partially_paid','100')
  `).run();
  sqlite.prepare(`
    INSERT INTO payment_gateway_logs (id,tenant_id,bill_id,status)
    VALUES (50,'100',10,'verifying')
  `).run();

  let strictPrepareCount = 0;
  const db = {
    prepare(sql: string) {
      if (/canonical_financial_batch_assertions/i.test(sql)) strictPrepareCount += 1;
      return new Statement(sqlite, sql);
    },
  };
  return { sqlite, db, strictPrepareCount: () => strictPrepareCount };
}

function input(overrides: Partial<GatewayPaymentLegacyInput> = {}): GatewayPaymentLegacyInput {
  return {
    tenantId: '100',
    userId: '9',
    gatewayLogId: 50,
    billId: 10,
    patientId: 20,
    expectedBillTotal: 1000,
    expectedBillPaid: 200,
    expectedBillStatus: 'partially_paid',
    confirmedAmount: 1000,
    amountForBill: 800,
    depositAmount: 200,
    newPaid: 1000,
    newBillStatus: 'paid',
    receiptNo: 'BKASH-TX-1',
    advanceReceiptNo: 'BKASH-TX-1-ADV',
    gateway: 'bkash',
    paymentId: 'gateway-payment-1',
    externalTransactionId: 'TX-1',
    businessDate: '2026-07-24',
    rawResponseJson: JSON.stringify({ success: true, appliedToBill: 800, depositAmount: 200 }),
    ...overrides,
  };
}

async function runBatch(sqlite: DatabaseSync, statements: readonly unknown[]): Promise<void> {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of statements as Statement[]) await statement.run();
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('gateway payment legacy and strict settlement adapter', () => {
  it('keeps the original legacy batch free of strict and canonical-only dependencies', async () => {
    const { sqlite, db } = harness();
    try {
      const statements = prepareGatewayPaymentOriginalLegacyStatements(
        db as unknown as D1Database,
        input(),
      );
      const sql = (statements as unknown as Statement[]).map((statement) => statement.sql).join('\n');

      expect(statements).toHaveLength(6);
      expect(sql).toMatch(/INSERT INTO payments/i);
      expect(sql).toMatch(/UPDATE bills SET paid = \?, status = \?, due = MAX\(0, total - \?\)/i);
      expect(sql).toMatch(/INSERT INTO income/i);
      expect(sql).toMatch(/INSERT INTO billing_deposits/i);
      expect(sql).toMatch(/INSERT INTO emp_cash_transactions/i);
      expect(sql).toMatch(/UPDATE payment_gateway_logs SET status = 'success'/i);
      expect(sql).not.toMatch(/canonical_financial_batch_assertions|accounting_posting_events|changes\(\)/i);
      expect(sql).not.toMatch(/expectedBill|status = 'verifying'|NOT EXISTS/i);

      await runBatch(sqlite, statements);
      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'income')).toBe(1);
      expect(count(sqlite, 'billing_deposits')).toBe(1);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(1);
      expect(sqlite.prepare('SELECT paid,due,status FROM bills WHERE id=10').get())
        .toEqual({ paid: 1000, due: 0, status: 'paid' });
      expect(sqlite.prepare('SELECT status FROM payment_gateway_logs WHERE id=50').get())
        .toEqual({ status: 'success' });
    } finally {
      sqlite.close();
    }
  });

  it('attaches a lazy strict factory and restores legacy post-commit accounting events', async () => {
    const { sqlite, db, strictPrepareCount } = harness();
    try {
      const statements = prepareGatewayPaymentLegacyStatements(
        db as unknown as D1Database,
        input(),
      ) as D1PreparedStatement[] & {
        strictAuthoritativeStatements?: () => readonly D1PreparedStatement[];
        legacyPostCommit?: () => Promise<void>;
      };

      expect(strictPrepareCount()).toBe(0);
      expect(typeof statements.strictAuthoritativeStatements).toBe('function');
      expect(typeof statements.legacyPostCommit).toBe('function');

      const strictStatements = statements.strictAuthoritativeStatements?.() ?? [];
      expect(strictPrepareCount()).toBeGreaterThan(0);
      expect((strictStatements as unknown as Statement[]).map((row) => row.sql).join('\n'))
        .toMatch(/canonical_financial_batch_assertions/i);

      await runBatch(sqlite, statements);
      await statements.legacyPostCommit?.();

      expect(count(sqlite, 'accounting_posting_events')).toBe(2);
      expect(sqlite.prepare(`
        SELECT source_type,event_type FROM accounting_posting_events ORDER BY source_type
      `).all()).toEqual([
        { source_type: 'deposit', event_type: 'patient_deposit_received' },
        { source_type: 'payment', event_type: 'payment_received' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('commits guarded payment, advance, gateway log, and accounting events in strict mode', async () => {
    const { sqlite, db } = harness();
    try {
      const statements = prepareGatewayPaymentStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await runBatch(sqlite, statements);

      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'income')).toBe(1);
      expect(count(sqlite, 'billing_deposits')).toBe(1);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(1);
      expect(count(sqlite, 'accounting_posting_events')).toBe(2);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare('SELECT paid,due,status FROM bills WHERE id=10').get())
        .toEqual({ paid: 1000, due: 0, status: 'paid' });
      expect(sqlite.prepare('SELECT status FROM payment_gateway_logs WHERE id=50').get())
        .toEqual({ status: 'success' });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back every strict write when the bill snapshot is stale', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE bills SET paid=300,due=700 WHERE id=10`).run();
      const statements = prepareGatewayPaymentStrictStatements(
        db as unknown as D1Database,
        input(),
      );

      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'income')).toBe(0);
      expect(count(sqlite, 'billing_deposits')).toBe(0);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
      expect(sqlite.prepare('SELECT paid,due,status FROM bills WHERE id=10').get())
        .toEqual({ paid: 300, due: 700, status: 'partially_paid' });
      expect(sqlite.prepare('SELECT status FROM payment_gateway_logs WHERE id=50').get())
        .toEqual({ status: 'verifying' });
    } finally {
      sqlite.close();
    }
  });

  it('rejects physical-cash classification for gateway settlement compatibility rows', () => {
    const { sqlite, db } = harness();
    try {
      expect(() => prepareGatewayPaymentStrictStatements(
        db as unknown as D1Database,
        input({ gateway: 'cash' }),
      )).toThrow(/reviewed non-cash provider/i);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back every strict write when the gateway log is no longer verifying', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE payment_gateway_logs SET status='success' WHERE id=50`).run();
      const statements = prepareGatewayPaymentStrictStatements(
        db as unknown as D1Database,
        input(),
      );

      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'income')).toBe(0);
      expect(count(sqlite, 'billing_deposits')).toBe(0);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
      expect(sqlite.prepare('SELECT paid,due,status FROM bills WHERE id=10').get())
        .toEqual({ paid: 200, due: 800, status: 'partially_paid' });
      expect(sqlite.prepare('SELECT status FROM payment_gateway_logs WHERE id=50').get())
        .toEqual({ status: 'success' });
    } finally {
      sqlite.close();
    }
  });
});

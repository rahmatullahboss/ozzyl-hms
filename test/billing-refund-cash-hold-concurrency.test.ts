import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      opening_cash REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER,
      payment_method TEXT,
      transaction_type TEXT,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER,
      movement_type TEXT,
      amount REAL NOT NULL DEFAULT 0
    );
  `);
  database.exec(readFileSync('migrations/0421_billing_refund_cash_holds.sql', 'utf8'));
  return database;
}

function insertHold(database: DatabaseSync, input: {
  approvalRequestId: number;
  billId: number;
  amount: number;
  employeeId?: number;
  counterId?: number;
  sessionId?: number;
  idempotencyKey?: string;
}) {
  database.prepare(`
    INSERT INTO billing_refund_cash_holds (
      tenant_id, approval_request_id, bill_id, patient_id, amount,
      payment_method, employee_id, counter_id, counter_session_id,
      status, idempotency_key
    ) VALUES ('tenant-1', ?, ?, 50, ?, 'cash', ?, ?, ?, 'held', ?)
  `).run(
    input.approvalRequestId,
    input.billId,
    input.amount,
    input.employeeId ?? 3,
    input.counterId ?? 7,
    input.sessionId ?? 17,
    input.idempotencyKey ?? `refund-${input.approvalRequestId}`,
  );
}

describe('billing refund cash-hold concurrency guards', () => {
  it('atomically rejects over-reservation against live counter cash', () => {
    const database = createDatabase();
    database.prepare(`
      INSERT INTO billing_counter_sessions (id, tenant_id, employee_id, counter_id, opening_cash, status)
      VALUES (17, 'tenant-1', 3, 7, 1000, 'active')
    `).run();
    database.prepare(`
      INSERT INTO emp_cash_transactions (tenant_id, counter_session_id, payment_method, transaction_type, amount)
      VALUES ('tenant-1', 17, 'cash', 'CashSales', 500),
             ('tenant-1', 17, 'cash', 'SalesReturn', 100)
    `).run();
    database.prepare(`
      INSERT INTO cash_drawer_movements (tenant_id, counter_session_id, movement_type, amount)
      VALUES ('tenant-1', 17, 'cash_in', 50),
             ('tenant-1', 17, 'cash_drop', 100)
    `).run();

    // Expected drawer cash is 1,350. The first request reserves 1,000.
    insertHold(database, { approvalRequestId: 1, billId: 75, amount: 1000 });
    expect(() => insertHold(database, { approvalRequestId: 2, billId: 76, amount: 400 }))
      .toThrow(/insufficient counter cash for refund hold/i);

    database.prepare(`
      UPDATE billing_refund_cash_holds SET status = 'released' WHERE approval_request_id = 1
    `).run();
    expect(() => insertHold(database, { approvalRequestId: 2, billId: 76, amount: 400 })).not.toThrow();
  });

  it('allows only one active hold per bill and validates the originating session', () => {
    const database = createDatabase();
    database.prepare(`
      INSERT INTO billing_counter_sessions (id, tenant_id, employee_id, counter_id, opening_cash, status)
      VALUES (17, 'tenant-1', 3, 7, 2000, 'active')
    `).run();

    insertHold(database, { approvalRequestId: 1, billId: 75, amount: 500 });
    expect(() => insertHold(database, { approvalRequestId: 2, billId: 75, amount: 200 }))
      .toThrow(/unique constraint failed/i);
    expect(() => insertHold(database, { approvalRequestId: 3, billId: 77, amount: 100, employeeId: 99 }))
      .toThrow(/active originating counter session/i);
  });
});

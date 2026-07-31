import { describe, expect, it } from 'vitest';
import { prepareCreateRefundHold } from '../src/lib/billing-refund-cash-hold';
import { createSqliteD1Harness } from './helpers/sqlite-d1';

function setup() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      request_data TEXT NOT NULL
    );
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      opening_cash REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER,
      payment_method TEXT,
      transaction_type TEXT,
      amount REAL
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER,
      movement_type TEXT,
      amount REAL
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_method TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      UNIQUE (tenant_id, approval_request_id),
      UNIQUE (tenant_id, idempotency_key)
    );
    INSERT INTO billing_counter_sessions
      (id, tenant_id, employee_id, counter_id, status, opening_cash)
    VALUES (17, 'tenant-1', 101, 7, 'active', 1000);
    INSERT INTO emp_cash_transactions
      (id, tenant_id, counter_session_id, payment_method, transaction_type, amount)
    VALUES (1, 'tenant-1', 17, 'cash', 'CashSales', 500);
    INSERT INTO billing_refund_cash_holds (
      tenant_id, approval_request_id, bill_id, patient_id, amount,
      payment_method, employee_id, counter_id, counter_session_id,
      status, idempotency_key
    ) VALUES (
      'tenant-1', 55, 16, 8, 200,
      'cash', 101, 7, 17,
      'held', 'existing-hold'
    );
  `);
  return harness;
}

function prepareBatch(harness: ReturnType<typeof setup>, amount: number, key: string) {
  const approvalInsert = harness.db.prepare(`
    INSERT INTO approval_requests (tenant_id, type, request_data)
    VALUES ('tenant-1', 'refund', ?)
  `).bind(JSON.stringify({ key }));
  const holdInsert = prepareCreateRefundHold(harness.db, {
    tenantId: 'tenant-1',
    approvalRequestIdLookupSql: `
      SELECT id
      FROM approval_requests
      WHERE tenant_id = ?
        AND json_extract(request_data, '$.key') = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    approvalLookupBindings: ['tenant-1', key],
    billId: 99,
    patientId: 8,
    amount,
    employeeId: 101,
    counterId: 7,
    counterSessionId: 17,
    idempotencyKey: `hold-${key}`,
  });
  return [approvalInsert, holdInsert];
}

describe('atomic refund cash hold creation', () => {
  it('rolls back both approval and hold when current available cash is insufficient', async () => {
    const harness = setup();

    await expect(harness.db.batch(prepareBatch(harness, 1400, 'insufficient')))
      .rejects.toThrow(/amount > 0/i);

    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM approval_requests
      WHERE json_extract(request_data, '$.key') = 'insufficient'
    `).get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM billing_refund_cash_holds
      WHERE idempotency_key = 'hold-insufficient'
    `).get()).toEqual({ count: 0 });
  });

  it('creates the approval and hold when the active session still has enough cash', async () => {
    const harness = setup();

    const results = await harness.db.batch(prepareBatch(harness, 400, 'allowed'));

    expect(Number((results[0] as any).meta.changes)).toBe(1);
    expect(Number((results[1] as any).meta.changes)).toBe(1);
    expect(harness.sqlite.prepare(`
      SELECT amount, employee_id, counter_id, counter_session_id, status
      FROM billing_refund_cash_holds
      WHERE idempotency_key = 'hold-allowed'
    `).get()).toEqual({
      amount: 400,
      employee_id: 101,
      counter_id: 7,
      counter_session_id: 17,
      status: 'held',
    });
  });

  it('rolls back when the counter session closes between precheck and insert', async () => {
    const harness = setup();
    harness.sqlite.prepare("UPDATE billing_counter_sessions SET status = 'closed' WHERE id = 17").run();

    await expect(harness.db.batch(prepareBatch(harness, 100, 'closed-session')))
      .rejects.toThrow(/amount > 0/i);

    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM approval_requests
      WHERE json_extract(request_data, '$.key') = 'closed-session'
    `).get()).toEqual({ count: 0 });
  });
});

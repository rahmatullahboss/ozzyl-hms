import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  commitLabCancellationCore,
  loadLabCancellationResult,
  markLabCancellationCompleted,
  reserveLabCancellationOperation,
} from '../src/lib/lab-cancellation-operation';

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: Array<string | number | bigint | null | Uint8Array> = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(
      this.database,
      this.sql,
      params.map((value) => value === undefined ? null : value) as Array<string | number | bigint | null | Uint8Array>,
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>() {
    return {
      results: this.database.prepare(this.sql).all(...this.params) as T[],
      success: true,
      meta: {},
    };
  }
}

function createTransactionalD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql);
    },
    async batch(statements: SqliteD1Statement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql: string) {
      database.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

function createHarness(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      due REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      updated_at TEXT
    );

    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      line_total REAL NOT NULL,
      status TEXT DEFAULT 'active',
      cancelled_by TEXT,
      cancelled_at TEXT,
      cancel_reason TEXT
    );

    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT
    );

    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      updated_at TEXT
    );

    CREATE TABLE visit_services (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      status TEXT,
      updated_at TEXT
    );

    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_item_id INTEGER,
      status TEXT,
      notes TEXT,
      updated_at TEXT
    );

    CREATE TABLE lab_cancellation_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      lab_order_item_id INTEGER NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing', 'core_completed', 'completed', 'failed')),
      skip_invoice_update INTEGER NOT NULL DEFAULT 0,
      bill_id INTEGER,
      lab_order_id INTEGER NOT NULL,
      cancelled_amount REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      notes TEXT,
      last_error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      UNIQUE(tenant_id, lab_order_item_id)
    );

    INSERT INTO bills (id, tenant_id, total, due, paid, status)
    VALUES (20, 'tenant-a', 7000, 7000, 0, 'open');
    INSERT INTO invoice_items (id, tenant_id, bill_id, line_total, status)
    VALUES (501, 'tenant-a', 20, 5000, 'active'),
           (502, 'tenant-a', 20, 2000, 'active');
    INSERT INTO lab_orders (id, tenant_id, status)
    VALUES (12, 'tenant-a', 'pending');
    INSERT INTO lab_order_items (id, tenant_id, lab_order_id, status)
    VALUES (77, 'tenant-a', 12, 'pending'),
           (78, 'tenant-a', 12, 'completed');
    INSERT INTO visit_services (id, tenant_id, reference_type, reference_id, status)
    VALUES (1, 'tenant-a', 'lab_order_item', 77, 'billed');
    INSERT INTO doctor_commission_accruals (id, tenant_id, lab_order_item_id, status)
    VALUES (1, 'tenant-a', 77, 'accrued');
  `);
  return { sqlite, d1: createTransactionalD1(sqlite) };
}

async function reserve(d1: D1Database, requestHash = 'hash-a') {
  return reserveLabCancellationOperation(d1, {
    tenantId: 'tenant-a',
    userId: '7',
    itemId: 77,
    requestHash,
    skipInvoiceUpdate: false,
    billId: 20,
    labOrderId: 12,
    cancelledAmount: 5000,
    reason: 'Patient refused this test',
  });
}

describe('lab cancellation operation saga', () => {
  it('commits invoice, bill, lab, visit, commission and order status as one core transaction', async () => {
    const { sqlite, d1 } = createHarness();
    await reserve(d1);

    await commitLabCancellationCore(d1, {
      tenantId: 'tenant-a',
      userId: '7',
      itemId: 77,
      labOrderId: 12,
      invoiceItemIds: [501],
      billIds: [20],
      skipInvoiceUpdate: false,
      reason: 'Patient refused this test',
    });

    expect(sqlite.prepare('SELECT status FROM invoice_items WHERE id = 501').get()).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT total, due, status FROM bills WHERE id = 20').get()).toMatchObject({
      total: 2000,
      due: 2000,
      status: 'open',
    });
    expect(sqlite.prepare('SELECT status FROM lab_order_items WHERE id = 77').get()).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status FROM visit_services WHERE id = 1').get()).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status FROM doctor_commission_accruals WHERE id = 1').get()).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status FROM lab_orders WHERE id = 12').get()).toMatchObject({ status: 'completed' });
    expect(sqlite.prepare('SELECT status FROM lab_cancellation_operations WHERE lab_order_item_id = 77').get()).toMatchObject({
      status: 'core_completed',
    });

    await markLabCancellationCompleted(d1, { tenantId: 'tenant-a', itemId: 77 });
    const result = await loadLabCancellationResult(d1, { tenantId: 'tenant-a', itemId: 77, replayed: true });
    expect(result).toMatchObject({
      itemId: 77,
      billId: 20,
      labOrderId: 12,
      cancelledAmount: 5000,
      newBillTotal: 2000,
      orderStatus: 'completed',
      replayed: true,
    });
  });

  it('rolls back every core mutation when the final order-status update fails', async () => {
    const { sqlite, d1 } = createHarness();
    await reserve(d1);
    sqlite.exec(`
      CREATE TRIGGER fail_lab_order_cancel
      BEFORE UPDATE ON lab_orders
      BEGIN
        SELECT RAISE(ABORT, 'forced lab order update failure');
      END;
    `);

    await expect(commitLabCancellationCore(d1, {
      tenantId: 'tenant-a',
      userId: '7',
      itemId: 77,
      labOrderId: 12,
      invoiceItemIds: [501],
      billIds: [20],
      skipInvoiceUpdate: false,
      reason: 'Patient refused this test',
    })).rejects.toThrow('forced lab order update failure');

    expect(sqlite.prepare('SELECT status FROM invoice_items WHERE id = 501').get()).toMatchObject({ status: 'active' });
    expect(sqlite.prepare('SELECT total, due, status FROM bills WHERE id = 20').get()).toMatchObject({
      total: 7000,
      due: 7000,
      status: 'open',
    });
    expect(sqlite.prepare('SELECT status FROM lab_order_items WHERE id = 77').get()).toMatchObject({ status: 'pending' });
    expect(sqlite.prepare('SELECT status FROM visit_services WHERE id = 1').get()).toMatchObject({ status: 'billed' });
    expect(sqlite.prepare('SELECT status FROM doctor_commission_accruals WHERE id = 1').get()).toMatchObject({ status: 'accrued' });
    expect(sqlite.prepare('SELECT status FROM lab_cancellation_operations WHERE lab_order_item_id = 77').get()).toMatchObject({
      status: 'processing',
    });
  });

  it('replays the same reservation and rejects changed cancellation details', async () => {
    const { d1 } = createHarness();
    const first = await reserve(d1, 'hash-a');
    const replay = await reserve(d1, 'hash-a');
    expect(replay.id).toBe(first.id);

    await expect(reserve(d1, 'hash-b')).rejects.toMatchObject({ status: 409 });
  });
});

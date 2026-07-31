import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { executeTenant100FinancialSmokeFixture } from '../../src/lib/canonical/tenant-100-financial-smoke-fixture';

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
    const before = this.sqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
    this.sqlite.prepare(this.sql).run(...this.params);
    const after = this.sqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
    return { changes: Number(after.count) - Number(before.count) };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function productionSchemaHarness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL
    );
    CREATE TABLE patients_old (
      id INTEGER PRIMARY KEY
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY
    );
    CREATE TABLE accounting_vouchers (
      id INTEGER PRIMARY KEY
    );
    INSERT INTO patients (id, tenant_id) VALUES (7, '100');
    INSERT INTO patients_old (id) VALUES (7);
    INSERT INTO users (id) VALUES (11);

    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      test_bill REAL DEFAULT 0,
      admission_bill REAL DEFAULT 0,
      doctor_visit_bill REAL DEFAULT 0,
      operation_bill REAL DEFAULT 0,
      medicine_bill REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      due REAL DEFAULT 0,
      tenant_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      invoice_no TEXT,
      visit_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','partially_paid','paid','cancelled')),
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      created_by INTEGER,
      cancelled_by INTEGER,
      cancelled_at TEXT,
      cancel_reason TEXT,
      counter_id INTEGER,
      counter_session_id INTEGER,
      tax_total REAL,
      discount_by_name TEXT,
      UNIQUE (tenant_id, invoice_no),
      FOREIGN KEY (patient_id) REFERENCES patients_old(id)
    );

    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      item_category TEXT NOT NULL
        CHECK(item_category IN ('test','doctor_visit','procedure','operation','medicine','admission','other')),
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price INTEGER NOT NULL,
      line_total INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      cancelled_by INTEGER,
      cancelled_at TEXT,
      cancel_reason TEXT,
      tenant_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT CHECK(payment_type IN ('current', 'due')),
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      tenant_id INTEGER NOT NULL,
      receipt_no TEXT,
      received_by INTEGER,
      payment_method TEXT,
      type TEXT DEFAULT 'current',
      idempotency_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      payment_source TEXT DEFAULT 'reception'
        CHECK(payment_source IN ('reception','pharmacy','lab','ipd','ot','other')),
      external_transaction_id TEXT,
      counter_id INTEGER,
      counter_session_id INTEGER,
      UNIQUE (tenant_id, receipt_no),
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    );

    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      source TEXT NOT NULL
        CHECK(source IN ('pharmacy','laboratory','doctor_visit','admission','operation','ambulance','other')),
      amount REAL NOT NULL,
      description TEXT,
      bill_id INTEGER,
      tenant_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      FOREIGN KEY (bill_id) REFERENCES bills(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('bill_created','bill_cancelled')),
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','posted','failed','dead_letter','approved')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      posted_voucher_id INTEGER,
      posted_at TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now', '+6 hours')),
      updated_at TEXT,
      UNIQUE(tenant_id, source_event_key),
      FOREIGN KEY (posted_voucher_id) REFERENCES accounting_vouchers(id)
    );

    CREATE TRIGGER trg_bills_insert_accounting_event
    AFTER INSERT ON bills
    FOR EACH ROW
    WHEN (COALESCE(NEW.total, 0) > 0 OR COALESCE(NEW.discount, 0) > 0)
    BEGIN
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (
        NEW.tenant_id,
        'billing:' || NEW.id || ':bill_created',
        'billing',
        CAST(NEW.id AS TEXT),
        'bill_created',
        COALESCE(date(NEW.created_at), date('now', '+6 hours')),
        json_object(
          'billId', NEW.id,
          'invoiceNo', NEW.invoice_no,
          'patientId', NEW.patient_id,
          'visitId', NEW.visit_id,
          'subtotal', COALESCE(NEW.subtotal, 0),
          'discount', COALESCE(NEW.discount, 0),
          'total', COALESCE(NEW.total, 0),
          'testBill', COALESCE(NEW.test_bill, 0),
          'doctorVisitBill', COALESCE(NEW.doctor_visit_bill, 0),
          'admissionBill', COALESCE(NEW.admission_bill, 0),
          'operationBill', COALESCE(NEW.operation_bill, 0),
          'medicineBill', COALESCE(NEW.medicine_bill, 0),
          'counterId', NEW.counter_id,
          'counterSessionId', NEW.counter_session_id,
          'recovered', 0,
          'source', 'db_trigger'
        ),
        COALESCE(CAST(NEW.created_by AS TEXT), 'system')
      );
    END;

    CREATE TABLE canonical_service_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      UNIQUE (tenant_id, event_public_id)
    );
  `);
  for (const migration of [
    'migrations/0510_canonical_invoices.sql',
    'migrations/0511_canonical_payments.sql',
    'migrations/0512_canonical_adjustments.sql',
  ]) {
    sqlite.exec(readFileSync(migration, 'utf8'));
  }

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
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
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count);
}

describe('tenant-100 financial smoke against production legacy and canonical schema', () => {
  it('documents the production-only payment_type constraint that rejected the original fixture', () => {
    const { sqlite } = productionSchemaHarness();
    try {
      const bill = sqlite.prepare(`
        INSERT INTO bills (patient_id,invoice_no,total,paid,due,status,tenant_id,created_by)
        VALUES (7,'constraint-proof',1,0,1,'open',100,11)
        RETURNING id
      `).get() as { id: number };
      expect(() => sqlite.prepare(`
        INSERT INTO payments (bill_id,amount,payment_type,tenant_id)
        VALUES (?,1,'full',100)
      `).run(bill.id)).toThrow(/CHECK constraint failed/i);
    } finally {
      sqlite.close();
    }
  });

  it('satisfies production payment constraints and the bills accounting trigger, then leaves no fixture rows', async () => {
    const { sqlite, db } = productionSchemaHarness();
    try {
      const result = await executeTenant100FinancialSmokeFixture(db, {
        tenantId: '100',
        runId: 'prod-schema-001',
        patientId: 7,
        actorId: 11,
        amountMinor: 100,
        atUtc: '2026-07-19T02:00:00.000Z',
        businessDate: '2026-07-19',
        expectedWorkerVersionTag: 'cdb101-financial-smoke-fix-20260719-c1',
        actualWorkerVersionTag: 'cdb101-financial-smoke-fix-20260719-c1',
      });

      expect(result.cleanupVerified).toBe(true);
      expect(result.legacyRemainingRows).toBe(0);
      expect(result.canonicalRemainingRows).toBe(0);
      expect(result.accountingRemainingRows).toBe(0);
      for (const table of [
        'bills',
        'invoice_items',
        'payments',
        'income',
        'accounting_posting_events',
        'canonical_invoices',
        'canonical_invoice_lines',
        'canonical_payment_receipts',
        'canonical_payment_tenders',
        'canonical_payment_allocations',
        'canonical_payment_reversals',
        'canonical_refunds',
      ]) {
        expect(count(sqlite, table), table).toBe(0);
      }
      expect(count(sqlite, 'patients')).toBe(1);
      expect(count(sqlite, 'patients_old')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('does not remove an unrelated accounting event', async () => {
    const { sqlite, db } = productionSchemaHarness();
    try {
      sqlite.prepare(`
        INSERT INTO accounting_posting_events (
          tenant_id,source_event_key,source_type,source_id,event_type,event_date,payload_json,created_by
        ) VALUES ('100','billing:999:bill_created','billing','999','bill_created','2026-07-19',?, '11')
      `).run(JSON.stringify({ invoiceNo: 'UNRELATED-999', source: 'db_trigger' }));

      await executeTenant100FinancialSmokeFixture(db, {
        tenantId: '100',
        runId: 'prod-schema-unrelated',
        patientId: 7,
        actorId: 11,
        amountMinor: 100,
        atUtc: '2026-07-19T02:05:00.000Z',
        businessDate: '2026-07-19',
        expectedWorkerVersionTag: 'cdb101-financial-smoke-fix-20260719-c1',
        actualWorkerVersionTag: 'cdb101-financial-smoke-fix-20260719-c1',
      });

      const remaining = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM accounting_posting_events
        WHERE source_event_key='billing:999:bill_created'
      `).get() as { count: number };
      expect(Number(remaining.count)).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});

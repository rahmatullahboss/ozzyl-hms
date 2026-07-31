import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  executeLabBillingOriginalLegacy,
  prepareLabBillingStrictStatements,
} from '../../src/lib/canonical/lab-billing-finalization';

type SqlValue = string | number | bigint | null | Uint8Array;
class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement { return new Statement(this.sqlite, this.sql, values as SqlValue[]); }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0532_canonical_financial_batch_assertions.sql', 'utf8'));
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE patients (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL);
    CREATE TABLE visits (id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL,tenant_id TEXT NOT NULL);
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,department_code TEXT,department_name TEXT,is_active INTEGER
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,service_department_id INTEGER NOT NULL,
      item_code TEXT,item_name TEXT,price REAL,is_active INTEGER
    );
    CREATE TABLE lab_test_catalog (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,code TEXT,name TEXT,category TEXT,price REAL,
      billing_service_item_id INTEGER,is_active INTEGER
    );
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT,patient_id INTEGER,visit_id INTEGER,
      ordered_by INTEGER,ordering_clinician_doctor_id INTEGER,order_date TEXT,tenant_id TEXT,
      bill_id INTEGER,billing_status TEXT,updated_at TEXT
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,patient_id INTEGER,visit_id INTEGER,invoice_no TEXT,
      test_bill REAL,admission_bill REAL,doctor_visit_bill REAL,operation_bill REAL,medicine_bill REAL,
      discount REAL,total REAL,paid REAL,due REAL,status TEXT,tenant_id TEXT,fiscal_year_id INTEGER,
      invoice_code TEXT,is_insurance_billing INTEGER,co_payment_amount INTEGER,created_by INTEGER
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,lab_order_id INTEGER,lab_test_id INTEGER,unit_price REAL,
      discount REAL,line_total REAL,status TEXT,tenant_id TEXT,source TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,bill_id INTEGER,item_category TEXT,description TEXT,
      quantity INTEGER,unit_price REAL,line_total REAL,reference_id INTEGER,tenant_id TEXT
    );
    CREATE TABLE visit_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT,visit_id INTEGER,patient_id INTEGER,
      service_type TEXT,description TEXT,service_item_id INTEGER,amount REAL,discount_amount REAL,
      quantity INTEGER,total_amount REAL,reference_type TEXT,reference_id INTEGER,status TEXT,
      bill_id INTEGER,created_by INTEGER
    );
    INSERT INTO patients VALUES (501,'100');
    INSERT INTO visits VALUES (77,501,'100');
    INSERT INTO billing_service_departments VALUES (10,'100','LAB','Laboratory',1);
    INSERT INTO billing_service_items VALUES (20,'100',10,'CBC','CBC',500,1);
    INSERT INTO lab_test_catalog VALUES (301,'100','CBC','CBC','Hematology',450,20,1);
  `);
  async function batch(statements: readonly CanonicalPreparedStatement[]) {
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
  }
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    batch,
  };
  return { sqlite, db, batch };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    operationKey: 'lab-billing:LO-1:INV-1',
    userId: 9,
    patientId: 501,
    visitId: 77,
    orderNo: 'LO-1',
    orderDate: '2026-07-24',
    orderingClinicianDoctorId: 91,
    invoiceNo: 'INV-1',
    fiscalYearId: null,
    invoiceCode: 'BL',
    orderTotal: 450,
    categoryTotals: {
      testBill: 450, admissionBill: 0, doctorVisitBill: 0, operationBill: 0, medicineBill: 0,
    },
    hasItemSource: true,
    hasLabOrderUpdatedAt: true,
    items: [{
      lineNumber: 1,
      duplicateOrdinal: 0,
      testId: 301,
      name: 'CBC',
      price: 500,
      discount: 50,
      lineTotal: 450,
      billingServiceItemId: 20,
    }],
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('executeLabBillingOriginalLegacy', () => {
  it('preserves the original direct inserts and dependent batch without strict revalidation', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE billing_service_items SET price=510 WHERE id=20`).run();
      const results = await executeLabBillingOriginalLegacy(db, input());

      expect(results[0]).toMatchObject({ meta: { last_row_id: 1 } });
      expect(results[1]).toMatchObject({ meta: { last_row_id: 1 } });
      expect(count(sqlite, 'lab_orders')).toBe(1);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'lab_order_items')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(1);
      expect(count(sqlite, 'visit_services')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare(`SELECT bill_id,billing_status FROM lab_orders`).get())
        .toEqual({ bill_id: 1, billing_status: 'unpaid' });
    } finally { sqlite.close(); }
  });
});

describe('prepareLabBillingStrictStatements', () => {
  it('creates the complete lab order and billing chain in one guarded batch', async () => {
    const { sqlite, db, batch } = harness();
    try {
      const prepared = prepareLabBillingStrictStatements(db, input());
      await batch(prepared.statements);
      expect(count(sqlite, 'lab_orders')).toBe(1);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'lab_order_items')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(1);
      expect(count(sqlite, 'visit_services')).toBe(1);
      expect(sqlite.prepare(`SELECT bill_id,billing_status FROM lab_orders`).get())
        .toEqual({ bill_id: 1, billing_status: 'unpaid' });
      expect(sqlite.prepare(`SELECT reference_id FROM invoice_items`).get()).toEqual({ reference_id: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_financial_batch_assertions`).get())
        .toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });

  it('rolls back all rows when catalog price or service linkage changes after preflight', async () => {
    const { sqlite, db, batch } = harness();
    try {
      sqlite.prepare(`UPDATE billing_service_items SET price=510 WHERE id=20`).run();
      const prepared = prepareLabBillingStrictStatements(db, input());
      await expect(batch(prepared.statements)).rejects.toThrow();
      expect(count(sqlite, 'lab_orders')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'lab_order_items')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back duplicate order or invoice identities and stale tenant ownership', async () => {
    const { sqlite, db, batch } = harness();
    try {
      sqlite.prepare(`INSERT INTO lab_orders (order_no,tenant_id) VALUES ('LO-1','100')`).run();
      await expect(batch(prepareLabBillingStrictStatements(db, input()).statements)).rejects.toThrow();
      expect(count(sqlite, 'bills')).toBe(0);
      sqlite.prepare(`DELETE FROM lab_orders`).run();
      sqlite.prepare(`UPDATE patients SET tenant_id='101' WHERE id=501`).run();
      await expect(batch(prepareLabBillingStrictStatements(db, input()).statements)).rejects.toThrow();
      expect(count(sqlite, 'lab_orders')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);

      sqlite.prepare(`UPDATE patients SET tenant_id='100' WHERE id=501`).run();
      sqlite.prepare(`UPDATE visits SET patient_id=999 WHERE id=77`).run();
      await expect(batch(prepareLabBillingStrictStatements(db, input()).statements)).rejects.toThrow();
      expect(count(sqlite, 'lab_orders')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
    } finally { sqlite.close(); }
  });
});

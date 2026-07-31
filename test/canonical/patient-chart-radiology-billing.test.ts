import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  executePatientChartRadiologyOriginalLegacy,
  preparePatientChartRadiologyStrictContext,
  preparePatientChartRadiologyStrictStatements,
  type PatientChartRadiologyBillingDependencies,
} from '../../src/lib/canonical/patient-chart-radiology-billing';

type SqlValue = string | number | bigint | null | Uint8Array;
type RecordedCall = { kind: 'run' | 'dependency'; label: string; sql?: string; params?: unknown[] };

class RecordingStatement implements CanonicalPreparedStatement {
  constructor(private readonly calls: RecordedCall[], readonly sql: string, readonly params: unknown[] = []) {}
  bind(...values: unknown[]): RecordingStatement { return new RecordingStatement(this.calls, this.sql, values); }
  async run(): Promise<unknown> {
    this.calls.push({ kind: 'run', label: 'sql', sql: this.sql, params: this.params });
    if (/INSERT INTO radiology_requisitions/i.test(this.sql)) return { success: true, meta: { changes: 1, last_row_id: 41 } };
    if (/INSERT INTO bills/i.test(this.sql)) return { success: true, meta: { changes: 1, last_row_id: 71 } };
    return { success: true, meta: { changes: 1, last_row_id: 0 } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return null; }
}

function originalHarness() {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) { return new RecordingStatement(calls, sql); },
    async batch(statements: readonly CanonicalPreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { calls, db };
}

const mappedItem = {
  id: 301,
  imagingTypeId: 11,
  imagingTypeName: 'X-Ray',
  name: 'Chest X-Ray',
  procedureCode: 'XR-CHEST',
  price: 1200,
  pricePaisa: 120_000,
  billingServiceItemId: 20,
};

function dependencies(calls: RecordedCall[], overrides: Partial<PatientChartRadiologyBillingDependencies> = {}): PatientChartRadiologyBillingDependencies {
  return {
    async resolveImagingItemByName(name: string) {
      calls.push({ kind: 'dependency', label: `resolve:${name}` });
      return mappedItem;
    },
    async nextAccessionNo() {
      calls.push({ kind: 'dependency', label: 'nextAccessionNo' });
      return 'RADACC-1';
    },
    async nextInvoiceNo() {
      calls.push({ kind: 'dependency', label: 'nextInvoiceNo' });
      return 'INV-1';
    },
    ...overrides,
  };
}

function input(deps: PatientChartRadiologyBillingDependencies, overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    userId: 9,
    patientId: 501,
    orderDate: '2026-07-24',
    requestedAtUtc: '2026-07-23T18:00:00.000Z',
    submittedImagingTypeName: 'X-Ray',
    submittedImagingItemName: 'Chest X-Ray',
    urgency: 'urgent' as const,
    requisitionRemarks: 'Persistent cough',
    dependencies: deps,
    ...overrides,
  };
}

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): SqliteStatement { return new SqliteStatement(this.sqlite, this.sql, values as SqlValue[]); }
  async run(): Promise<unknown> {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function strictHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0532_canonical_financial_batch_assertions.sql', 'utf8'));
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE patients (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL);
    CREATE TABLE radiology_imaging_types (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,name TEXT,is_active INTEGER);
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,department_code TEXT,department_name TEXT,is_active INTEGER
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,service_department_id INTEGER,
      item_code TEXT,item_name TEXT,price REAL,is_active INTEGER
    );
    CREATE TABLE radiology_imaging_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,imaging_type_id INTEGER,name TEXT,procedure_code TEXT,
      price_paisa INTEGER,billing_service_item_id INTEGER,is_active INTEGER
    );
    CREATE TABLE radiology_requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT,patient_id INTEGER,imaging_type_id INTEGER,
      imaging_type_name TEXT,imaging_item_id INTEGER,imaging_item_name TEXT,procedure_code TEXT,
      imaging_date TEXT,accession_no TEXT,requisition_remarks TEXT,urgency TEXT,order_status TEXT,
      created_by INTEGER,bill_id INTEGER,billing_status TEXT,updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_rad_accession ON radiology_requisitions(tenant_id,accession_no);
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,patient_id INTEGER,invoice_no TEXT,test_bill REAL,
      doctor_visit_bill REAL,admission_bill REAL,operation_bill REAL,medicine_bill REAL,discount REAL,
      total REAL,paid REAL,due REAL,status TEXT,tenant_id TEXT,created_by INTEGER,created_at TEXT,updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_bill_invoice_no ON bills(tenant_id,invoice_no);
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,bill_id INTEGER,item_category TEXT,description TEXT,
      quantity INTEGER,unit_price REAL,line_total REAL,reference_id INTEGER,tenant_id TEXT,created_at TEXT
    );
    INSERT INTO patients VALUES (501,'100');
    INSERT INTO radiology_imaging_types VALUES (11,'100','X-Ray',1);
    INSERT INTO billing_service_departments VALUES (10,'100','RAD','Radiology',1);
    INSERT INTO billing_service_items VALUES (20,'100',10,'XR-CHEST','Chest X-Ray',1200,1);
    INSERT INTO radiology_imaging_items VALUES (301,'100',11,'Chest X-Ray','XR-CHEST',110000,20,1);
  `);
  const db = {
    prepare(sql: string) { return new SqliteStatement(sqlite, sql); },
    async batch(statements: readonly CanonicalPreparedStatement[]) {
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
    },
  };
  return { sqlite, db };
}

function strictContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100', userId: 9, patientId: 501,
    orderDate: '2026-07-24', requestedAtUtc: '2026-07-23T18:00:00.000Z',
    submittedImagingTypeName: 'X-Ray', submittedImagingItemName: 'Chest X-Ray',
    urgency: 'urgent' as const, requisitionRemarks: 'Persistent cough',
    accessionNo: 'RADACC-1', invoiceNo: 'INV-1',
    imagingItem: mappedItem,
    imagingTypeName: 'X-Ray', imagingItemName: 'Chest X-Ray', procedureCode: 'XR-CHEST',
    total: 1200,
    categoryTotals: { testBill: 1200, doctorVisitBill: 0, admissionBill: 0, operationBill: 0, medicineBill: 0 },
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('executePatientChartRadiologyOriginalLegacy', () => {
  it('preserves lookup, sequence and write order for a mapped positive requisition', async () => {
    const { calls, db } = originalHarness();
    const result = await executePatientChartRadiologyOriginalLegacy(db as never, input(dependencies(calls)));
    expect(result.results).toHaveLength(2);
    expect(result.context).toMatchObject({ accessionNo: 'RADACC-1', invoiceNo: 'INV-1', total: 1200 });
    expect(calls.map((call) => call.label)).toEqual([
      'resolve:Chest X-Ray', 'nextAccessionNo', 'sql', 'nextInvoiceNo', 'sql', 'sql', 'sql',
    ]);
    const sql = calls.map((call) => call.sql ?? '').join('\n');
    expect(sql).not.toMatch(/canonical_|financial_batch_assertions|visit_services/i);
  });

  it('preserves free-text zero-value success when no imaging item resolves', async () => {
    const { calls, db } = originalHarness();
    const deps = dependencies(calls, { resolveImagingItemByName: vi.fn(async () => null) });
    const result = await executePatientChartRadiologyOriginalLegacy(db as never, input(deps, {
      submittedImagingTypeName: 'Custom Scan', submittedImagingItemName: 'Outside Scan',
    }));
    expect(result.context).toMatchObject({
      imagingTypeName: 'Custom Scan', imagingItemName: 'Outside Scan', total: 0,
    });
    const bill = calls.find((call) => call.kind === 'run' && /INSERT INTO bills/i.test(call.sql ?? ''));
    expect(bill?.params).toEqual(expect.arrayContaining([0, 'paid']));
  });
});

describe('preparePatientChartRadiologyStrictContext', () => {
  it('validates mapping and positive price before allocating identities', async () => {
    const calls: RecordedCall[] = [];
    const context = await preparePatientChartRadiologyStrictContext(input(dependencies(calls)));
    expect(calls.map((call) => call.label)).toEqual([
      'resolve:Chest X-Ray', 'nextAccessionNo', 'nextInvoiceNo',
    ]);
    expect(context).toMatchObject({ accessionNo: 'RADACC-1', invoiceNo: 'INV-1', total: 1200 });
  });

  it.each([
    ['missing item', null, 'active imaging item'],
    ['zero price', { ...mappedItem, price: 0, pricePaisa: 0 }, 'positive price'],
    ['missing mapping', { ...mappedItem, billingServiceItemId: null }, 'billing service mapping'],
  ])('rejects %s before sequence allocation', async (_name, row, message) => {
    const calls: RecordedCall[] = [];
    const deps = dependencies(calls, { resolveImagingItemByName: vi.fn(async () => row as never) });
    await expect(preparePatientChartRadiologyStrictContext(input(deps))).rejects.toThrow(message);
    expect(calls.some((call) => call.label === 'nextAccessionNo')).toBe(false);
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });
});

describe('preparePatientChartRadiologyStrictStatements', () => {
  it('commits the requisition, bill, invoice item and bill link atomically', async () => {
    const { sqlite, db } = strictHarness();
    try {
      await db.batch(preparePatientChartRadiologyStrictStatements(db as never, strictContext()));
      expect(count(sqlite, 'radiology_requisitions')).toBe(1);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare('SELECT imaging_item_name,bill_id,billing_status FROM radiology_requisitions').get())
        .toEqual({ imaging_item_name: 'Chest X-Ray', bill_id: 1, billing_status: 'unpaid' });
      expect(sqlite.prepare('SELECT reference_id FROM invoice_items').get()).toEqual({ reference_id: 1 });
    } finally { sqlite.close(); }
  });

  it('rolls back all rows when current billing price changes after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      sqlite.prepare('UPDATE billing_service_items SET price=1250 WHERE id=20').run();
      await expect(db.batch(preparePatientChartRadiologyStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(count(sqlite, 'radiology_requisitions')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back all rows for a tenant/patient mismatch', async () => {
    const { sqlite, db } = strictHarness();
    try {
      await expect(db.batch(preparePatientChartRadiologyStrictStatements(db as never, strictContext({ patientId: 999 }))))
        .rejects.toThrow();
      expect(count(sqlite, 'radiology_requisitions')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
    } finally { sqlite.close(); }
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  executeRadiologyOrderOriginalLegacy,
  prepareRadiologyOrderStrictContext,
  prepareRadiologyOrderStrictStatements,
  type RadiologyOrderBillingDependencies,
  type RadiologyOrderBillingInput,
  type RadiologyOrderBillingContext,
} from '../../src/lib/canonical/radiology-order-billing';

interface Call {
  kind: 'first' | 'all' | 'run' | 'batch' | 'dependency';
  label: string;
  sql?: string;
  params?: unknown[];
}

class MockStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly calls: Call[],
    private readonly resolver: (kind: 'first' | 'all' | 'run', sql: string, params: unknown[]) => unknown,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): MockStatement { return new MockStatement(this.calls, this.resolver, this.sql, values); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.calls.push({ kind: 'first', label: 'sql', sql: this.sql, params: this.params });
    return this.resolver('first', this.sql, this.params) as T | null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.calls.push({ kind: 'all', label: 'sql', sql: this.sql, params: this.params });
    return { results: this.resolver('all', this.sql, this.params) as T[] };
  }
  async run(): Promise<unknown> {
    this.calls.push({ kind: 'run', label: 'sql', sql: this.sql, params: this.params });
    return this.resolver('run', this.sql, this.params);
  }
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

function originalHarness(options: { catalogAuthorityAvailable?: boolean } = {}) {
  const calls: Call[] = [];
  const resolver = (kind: 'first' | 'all' | 'run', sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
    if (kind === 'first' && normalized.includes('from patients')) return { id: 501 };
    if (kind === 'first' && normalized.includes('from visits')) return { id: 601 };
    if (kind === 'first' && normalized.includes('from admissions')) return { id: 701 };
    if (kind === 'first' && normalized.includes('from doctors')) return { id: 801 };
    if (kind === 'first' && normalized.includes('from radiology_imaging_types')) {
      return normalized.includes('select name') ? { name: 'X-Ray' } : { id: 11 };
    }
    if (kind === 'first' && normalized.includes('join billing_service_departments')) {
      return options.catalogAuthorityAvailable === false ? null : { id: 301 };
    }
    if (kind === 'first' && normalized.includes('from radiology_imaging_items')) return { id: 301 };
    if (kind === 'run' && normalized.includes('insert into radiology_requisitions')) {
      return { success: true, meta: { changes: 1, last_row_id: 41 } };
    }
    if (kind === 'run' && normalized.includes('insert into bills')) {
      return { success: true, meta: { changes: 1, last_row_id: 71 } };
    }
    return { success: true, meta: { changes: 1, last_row_id: 0 } };
  };
  const db = {
    prepare(sql: string) { return new MockStatement(calls, resolver, sql); },
    async batch(statements: readonly CanonicalPreparedStatement[]) {
      calls.push({ kind: 'batch', label: `batch:${statements.length}` });
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { calls, db };
}

function dependencies(
  calls: Call[],
  overrides: Partial<RadiologyOrderBillingDependencies> = {},
): RadiologyOrderBillingDependencies {
  return {
    async resolveBillingRow(itemId) {
      calls.push({ kind: 'dependency', label: `resolve:${itemId}` });
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
    async assertAccountingPeriodOpen(date) {
      calls.push({ kind: 'dependency', label: `period:${date}` });
    },
    ...overrides,
  };
}

function input(calls: Call[], overrides: Partial<RadiologyOrderBillingInput> = {}): RadiologyOrderBillingInput {
  return {
    tenantId: '100', userId: 9, patientId: 501,
    visitId: 601, admissionId: 701,
    imagingTypeId: 11, submittedImagingTypeName: null,
    imagingItemId: 301, submittedImagingItemName: null,
    submittedProcedureCode: null,
    prescriberId: 801, prescriberName: 'Dr A',
    imagingDate: '2026-07-24', requestedAtUtc: '2026-07-23T18:00:00.000Z',
    requisitionRemarks: 'Persistent cough', urgency: 'urgent',
    wardName: 'Ward A', hasInsurance: true,
    dependencies: dependencies(calls),
    ...overrides,
  };
}

function labels(calls: Call[]): string[] {
  return calls.map((call) => {
    if (call.kind === 'dependency' || call.kind === 'batch') return call.label;
    const sql = call.sql?.replace(/\s+/g, ' ').toLowerCase() ?? '';
    if (sql.includes('from patients')) return 'patient';
    if (sql.includes('from visits')) return 'visit';
    if (sql.includes('from admissions')) return 'admission';
    if (sql.includes('from doctors')) return 'prescriber';
    if (sql.includes('from radiology_imaging_types')) return sql.includes('select name') ? 'type-name' : 'type';
    if (sql.includes('from radiology_imaging_items')) return 'item';
    if (sql.includes('insert into radiology_requisitions')) return 'requisition';
    if (sql.includes('insert into bills')) return 'bill';
    if (sql.includes('insert into invoice_items')) return 'invoice-item';
    if (sql.includes('update radiology_requisitions')) return 'link';
    return call.kind;
  });
}

describe('executeRadiologyOrderOriginalLegacy', () => {
  it('preserves source validation, enrichment, sequence and write order', async () => {
    const { calls, db } = originalHarness();
    const result = await executeRadiologyOrderOriginalLegacy(db as never, input(calls));
    expect(result).toMatchObject({ requisitionId: 41, billId: 71 });
    expect(result.context).toMatchObject({
      accessionNo: 'RADACC-1', invoiceNo: 'INV-1', total: 1200,
      imagingTypeName: 'X-Ray', imagingItemName: 'Chest X-Ray',
      visitId: 601, admissionId: 701, prescriberId: 801,
      wardName: 'Ward A', hasInsurance: true,
    });
    expect(labels(calls)).toEqual([
      'patient', 'visit', 'admission', 'prescriber', 'type', 'item',
      'type-name', 'resolve:301', 'period:2026-07-24',
      'nextAccessionNo', 'nextInvoiceNo', 'requisition', 'bill',
      'batch:2', 'invoice-item', 'link',
    ]);
    expect(calls.map((call) => call.sql ?? '').join('\n'))
      .not.toMatch(/canonical_|financial_batch_assertions/i);
  });

  it('preserves free-text zero-value success without catalog dependencies', async () => {
    const { calls, db } = originalHarness();
    const result = await executeRadiologyOrderOriginalLegacy(db as never, input(calls, {
      visitId: null, admissionId: null, imagingTypeId: null, imagingItemId: null,
      prescriberId: null, submittedImagingTypeName: 'Outside Scan',
      submittedImagingItemName: 'Imported MRI', submittedProcedureCode: 'EXT-MRI',
      dependencies: dependencies(calls, {
        resolveBillingRow: vi.fn(async () => null),
      }),
    }));
    expect(result.context).toMatchObject({
      imagingTypeName: 'Outside Scan', imagingItemName: 'Imported MRI',
      procedureCode: 'EXT-MRI', total: 0,
    });
    expect(labels(calls)).toEqual([
      'patient', 'period:2026-07-24', 'nextAccessionNo', 'nextInvoiceNo',
      'requisition', 'bill', 'batch:2', 'invoice-item', 'link',
    ]);
    const bill = calls.find((call) => /INSERT INTO bills/i.test(call.sql ?? ''));
    expect(bill?.params).toEqual(expect.arrayContaining([0, 'paid']));
  });
});

describe('prepareRadiologyOrderStrictContext', () => {
  it('validates all source authority before sequence allocation', async () => {
    const { calls, db } = originalHarness();
    const context = await prepareRadiologyOrderStrictContext(db as never, input(calls));
    expect(context).toMatchObject({ accessionNo: 'RADACC-1', invoiceNo: 'INV-1', total: 1200 });
    expect(labels(calls)).toEqual([
      'patient', 'visit', 'admission', 'prescriber', 'type', 'item',
      'type-name', 'resolve:301', 'item', 'period:2026-07-24',
      'nextAccessionNo', 'nextInvoiceNo',
    ]);
  });

  it('rejects missing active RAD catalog authority before sequences', async () => {
    const { calls, db } = originalHarness({ catalogAuthorityAvailable: false });
    await expect(prepareRadiologyOrderStrictContext(db as never, input(calls)))
      .rejects.toThrow(/catalog authority changed/i);
    expect(calls.some((call) => call.label === 'nextAccessionNo')).toBe(false);
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });

  it.each([
    ['missing item id', { imagingItemId: null }, 'imaging item'],
    ['missing mapping', {}, 'billing service mapping'],
    ['zero price', {}, 'positive price'],
    ['price mismatch', {}, 'minor-unit price'],
  ])('rejects %s before sequences', async (name, inputOverrides, message) => {
    const { calls, db } = originalHarness();
    const row = name === 'missing mapping'
      ? { ...mappedItem, billingServiceItemId: null }
      : name === 'zero price'
        ? { ...mappedItem, price: 0, pricePaisa: 0 }
        : name === 'price mismatch'
          ? { ...mappedItem, price: 1200, pricePaisa: 119_999 }
          : mappedItem;
    const deps = dependencies(calls, { resolveBillingRow: vi.fn(async () => row as never) });
    await expect(prepareRadiologyOrderStrictContext(db as never, input(calls, {
      ...inputOverrides,
      dependencies: deps,
    }))).rejects.toThrow(message);
    expect(calls.some((call) => call.label === 'nextAccessionNo')).toBe(false);
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });
});

type SqlValue = string | number | bigint | null | Uint8Array;
class SqliteStatement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): SqliteStatement { return new SqliteStatement(this.sqlite, this.sql, values as SqlValue[]); }
  async run() {
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
    CREATE TABLE visits (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL);
    CREATE TABLE admissions (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,status TEXT);
    CREATE TABLE doctors (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,is_active INTEGER);
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT,patient_id INTEGER,visit_id INTEGER,admission_id INTEGER,
      imaging_type_id INTEGER,imaging_type_name TEXT,imaging_item_id INTEGER,imaging_item_name TEXT,
      procedure_code TEXT,prescriber_id INTEGER,prescriber_name TEXT,imaging_date TEXT,accession_no TEXT,
      requisition_remarks TEXT,urgency TEXT,ward_name TEXT,has_insurance INTEGER,order_status TEXT,
      created_by INTEGER,bill_id INTEGER,billing_status TEXT,updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_rad_accession ON radiology_requisitions(tenant_id,accession_no);
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,patient_id INTEGER,visit_id INTEGER,invoice_no TEXT,subtotal REAL,
      test_bill REAL,doctor_visit_bill REAL,admission_bill REAL,operation_bill REAL,medicine_bill REAL,
      discount REAL,total REAL,paid REAL,due REAL,status TEXT,tenant_id TEXT,created_by INTEGER,
      counter_id INTEGER,counter_session_id INTEGER,created_at TEXT,updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_bill_invoice_no ON bills(tenant_id,invoice_no);
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,source_event_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,source_id TEXT NOT NULL,event_type TEXT NOT NULL,event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,created_by TEXT NOT NULL
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
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,bill_id INTEGER,item_category TEXT,description TEXT,
      quantity INTEGER,unit_price REAL,line_total REAL,reference_id INTEGER,tenant_id TEXT,created_at TEXT
    );
    INSERT INTO patients VALUES (501,'100');
    INSERT INTO visits VALUES (601,'100',501);
    INSERT INTO admissions VALUES (701,'100',501,'admitted');
    INSERT INTO doctors VALUES (801,'100',1);
    INSERT INTO radiology_imaging_types VALUES (11,'100','X-Ray',1);
    INSERT INTO billing_service_departments VALUES (10,'100','RAD','Radiology',1);
    INSERT INTO billing_service_items VALUES (20,'100',10,'XR-CHEST','Chest X-Ray',1200,1);
    INSERT INTO radiology_imaging_items VALUES (301,'100',11,'Chest X-Ray','XR-CHEST',120000,20,1);
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

function strictContext(overrides: Partial<RadiologyOrderBillingContext> = {}): RadiologyOrderBillingContext {
  return {
    tenantId: '100', userId: 9, patientId: 501, visitId: 601, admissionId: 701,
    imagingTypeId: 11, submittedImagingTypeName: null,
    imagingItemId: 301, submittedImagingItemName: null, submittedProcedureCode: null,
    prescriberId: 801, prescriberName: 'Dr A', imagingDate: '2026-07-24',
    requestedAtUtc: '2026-07-23T18:00:00.000Z', requisitionRemarks: 'Persistent cough',
    urgency: 'urgent', wardName: 'Ward A', hasInsurance: true,
    accessionNo: 'RADACC-1', invoiceNo: 'INV-1', imagingItem: mappedItem,
    imagingTypeName: 'X-Ray', imagingItemName: 'Chest X-Ray', procedureCode: 'XR-CHEST',
    total: 1200,
    categoryTotals: { testBill: 1200, doctorVisitBill: 0, admissionBill: 0, operationBill: 0, medicineBill: 0 },
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('prepareRadiologyOrderStrictStatements', () => {
  it('commits the full RIS requisition, bill, invoice item and link atomically', async () => {
    const { sqlite, db } = strictHarness();
    try {
      await db.batch(prepareRadiologyOrderStrictStatements(db as never, strictContext()));
      expect(count(sqlite, 'radiology_requisitions')).toBe(1);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(1);
      expect(count(sqlite, 'accounting_posting_events')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare(`
        SELECT source_event_key,source_type,event_type,json_extract(payload_json,'$.source') AS source
        FROM accounting_posting_events
      `).get()).toEqual({
        source_event_key: 'billing:1:bill_created',
        source_type: 'billing',
        event_type: 'bill_created',
        source: 'db_trigger',
      });
      expect(sqlite.prepare(`
        SELECT visit_id,admission_id,prescriber_id,ward_name,has_insurance,bill_id,billing_status
        FROM radiology_requisitions
      `).get()).toEqual({
        visit_id: 601, admission_id: 701, prescriber_id: 801,
        ward_name: 'Ward A', has_insurance: 1, bill_id: 1, billing_status: 'unpaid',
      });
      expect(sqlite.prepare('SELECT visit_id,total,status FROM bills').get())
        .toEqual({ visit_id: 601, total: 1200, status: 'open' });
      expect(sqlite.prepare('SELECT reference_id FROM invoice_items').get()).toEqual({ reference_id: 1 });
    } finally { sqlite.close(); }
  });

  it.each([
    ['price', "UPDATE billing_service_items SET price=1250 WHERE id=20"],
    ['service department', "UPDATE billing_service_departments SET department_code='LAB' WHERE id=10"],
    ['item type', 'UPDATE radiology_imaging_items SET imaging_type_id=12 WHERE id=301'],
    ['visit patient', 'UPDATE visits SET patient_id=999 WHERE id=601'],
    ['admission patient', 'UPDATE admissions SET patient_id=999 WHERE id=701'],
    ['prescriber activity', 'UPDATE doctors SET is_active=0 WHERE id=801'],
  ])('rolls back every row for a current %s race', async (_name, mutation) => {
    const { sqlite, db } = strictHarness();
    try {
      sqlite.exec(mutation);
      await expect(db.batch(prepareRadiologyOrderStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(count(sqlite, 'radiology_requisitions')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally { sqlite.close(); }
  });
});

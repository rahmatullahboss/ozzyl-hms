import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  executePatientChartLabOrderOriginalLegacy,
  preparePatientChartLabOrderStrictContext,
  preparePatientChartLabOrderStrictStatements,
  type PatientChartLabBillingDependencies,
} from '../../src/lib/canonical/patient-chart-lab-billing';

type SqlValue = string | number | bigint | null | Uint8Array;

type RecordedCall = {
  kind: 'prepare' | 'run' | 'dependency';
  label: string;
  sql?: string;
  params?: unknown[];
};

class RecordingStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly calls: RecordedCall[],
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): RecordingStatement {
    return new RecordingStatement(this.calls, this.sql, values);
  }

  async run(): Promise<unknown> {
    this.calls.push({ kind: 'run', label: 'sql', sql: this.sql, params: this.params });
    if (/INSERT INTO lab_orders/i.test(this.sql)) {
      return { success: true, meta: { changes: 1, last_row_id: 41 } };
    }
    if (/INSERT INTO bills/i.test(this.sql)) {
      return { success: true, meta: { changes: 1, last_row_id: 71 } };
    }
    if (/INSERT INTO lab_order_items/i.test(this.sql)) {
      const offset = this.calls.filter((call) => call.kind === 'run' && /INSERT INTO lab_order_items/i.test(call.sql ?? '')).length;
      return { success: true, meta: { changes: 1, last_row_id: 100 + offset } };
    }
    return { success: true, meta: { changes: 1, last_row_id: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }
}

function originalHarness() {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      calls.push({ kind: 'prepare', label: 'sql', sql });
      return new RecordingStatement(calls, sql);
    },
    async batch(statements: readonly CanonicalPreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { calls, db };
}

function requestInput(dependencies: PatientChartLabBillingDependencies, overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    userId: 9,
    patientId: 501,
    visitId: 77,
    orderingClinicianDoctorId: 91,
    orderDate: '2026-07-24',
    orderedAtUtc: '2026-07-23T18:00:00.000Z',
    notes: 'Check infection markers',
    requestItems: [
      { labTestId: 301, instructions: 'Urgent CBC' },
      { labTestId: 302, instructions: 'Fasting sample' },
    ],
    dependencies,
    ...overrides,
  };
}

function dependencies(calls: RecordedCall[], overrides: Partial<PatientChartLabBillingDependencies> = {}): PatientChartLabBillingDependencies {
  const rows = new Map([
    [301, { id: 301, name: 'CBC', category: 'Hematology', price: 500, billingServiceItemId: 20 }],
    [302, { id: 302, name: 'Glucose', category: 'Biochemistry', price: 300, billingServiceItemId: 21 }],
  ]);
  return {
    async nextOrderNo() {
      calls.push({ kind: 'dependency', label: 'nextOrderNo' });
      return 'LAB-1';
    },
    async nextInvoiceNo() {
      calls.push({ kind: 'dependency', label: 'nextInvoiceNo' });
      return 'INV-1';
    },
    async resolveLabTest(labTestId: number) {
      calls.push({ kind: 'dependency', label: `resolve:${labTestId}` });
      return rows.get(labTestId) ?? null;
    },
    ...overrides,
  };
}

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.sqlite, this.sql, values as SqlValue[]);
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

function strictHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0532_canonical_financial_batch_assertions.sql', 'utf8'));
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE patients (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL);
    CREATE TABLE visits (id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL,doctor_id INTEGER,visit_date TEXT,tenant_id TEXT NOT NULL);
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
      order_date TEXT,notes TEXT,ordered_by INTEGER,tenant_id TEXT,bill_id INTEGER,billing_status TEXT,updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_lab_order_no ON lab_orders(tenant_id,order_no);
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,lab_order_id INTEGER,lab_test_id INTEGER,unit_price REAL,
      discount REAL,line_total REAL,status TEXT,instructions TEXT,notes TEXT,tenant_id TEXT,source TEXT
    );
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
    INSERT INTO visits VALUES (77,501,91,'2026-07-24','100');
    INSERT INTO billing_service_departments VALUES (10,'100','LAB','Laboratory',1);
    INSERT INTO billing_service_items VALUES (20,'100',10,'CBC','CBC',500,1);
    INSERT INTO billing_service_items VALUES (21,'100',10,'GLU','Glucose',300,1);
    INSERT INTO lab_test_catalog VALUES (301,'100','CBC','CBC','Hematology',450,20,1);
    INSERT INTO lab_test_catalog VALUES (302,'100','GLU','Glucose','Biochemistry',250,21,1);
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
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    batch,
  };
  return { sqlite, db, batch };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function strictContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '100',
    userId: 9,
    patientId: 501,
    visitId: 77,
    orderingClinicianDoctorId: 91,
    orderNo: 'LAB-1',
    invoiceNo: 'INV-1',
    orderDate: '2026-07-24',
    orderedAtUtc: '2026-07-23T18:00:00.000Z',
    notes: 'Check infection markers',
    total: 800,
    categoryTotals: {
      testBill: 800,
      doctorVisitBill: 0,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    },
    items: [
      {
        lineNumber: 1,
        duplicateOrdinal: 0,
        labTestId: 301,
        billingServiceItemId: 20,
        name: 'CBC',
        category: 'Hematology',
        price: 500,
        instructions: 'Urgent CBC',
      },
      {
        lineNumber: 2,
        duplicateOrdinal: 0,
        labTestId: 302,
        billingServiceItemId: 21,
        name: 'Glucose',
        category: 'Biochemistry',
        price: 300,
        instructions: 'Fasting sample',
      },
    ],
    ...overrides,
  };
}

describe('executePatientChartLabOrderOriginalLegacy', () => {
  it('preserves the quick-route mutation order, notes and instructions without strict leakage', async () => {
    const { calls, db } = originalHarness();
    const deps = dependencies(calls);

    const result = await executePatientChartLabOrderOriginalLegacy(db as never, requestInput(deps));

    expect(result.results).toHaveLength(2);
    expect(result.context).toMatchObject({
      orderNo: 'LAB-1',
      invoiceNo: 'INV-1',
      total: 800,
      notes: 'Check infection markers',
    });
    const execution = calls.filter((call) => call.kind !== 'prepare');
    expect(execution.map((call) => call.label)).toEqual([
      'nextOrderNo',
      'sql',
      'resolve:301',
      'sql',
      'resolve:302',
      'sql',
      'nextInvoiceNo',
      'sql',
      'sql',
      'sql',
      'sql',
    ]);

    const orderInsert = calls.find((call) => call.kind === 'run' && /INSERT INTO lab_orders/i.test(call.sql ?? ''));
    expect(orderInsert?.params).toContain('Check infection markers');
    const itemInserts = calls.filter((call) => call.kind === 'run' && /INSERT INTO lab_order_items/i.test(call.sql ?? ''));
    expect(itemInserts[0]?.params).toEqual(expect.arrayContaining(['Urgent CBC', 'Urgent CBC']));
    expect(itemInserts[1]?.params).toEqual(expect.arrayContaining(['Fasting sample', 'Fasting sample']));

    const sql = calls.map((call) => call.sql ?? '').join('\n');
    expect(sql).not.toMatch(/visit_services/i);
    expect(sql).not.toMatch(/canonical_/i);
    expect(sql).not.toMatch(/financial_batch_assertions/i);
  });

  it('retains the inserted order when a later catalog lookup fails', async () => {
    const { calls, db } = originalHarness();
    const deps = dependencies(calls, {
      async resolveLabTest(labTestId: number) {
        calls.push({ kind: 'dependency', label: `resolve:${labTestId}` });
        if (labTestId === 302) return null;
        return { id: 301, name: 'CBC', category: 'Hematology', price: 500, billingServiceItemId: 20 };
      },
    });

    await expect(executePatientChartLabOrderOriginalLegacy(db as never, requestInput(deps)))
      .rejects.toThrow('Lab test 302 not found');

    expect(calls.some((call) => call.kind === 'run' && /INSERT INTO lab_orders/i.test(call.sql ?? ''))).toBe(true);
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });
});

describe('preparePatientChartLabOrderStrictContext', () => {
  it('resolves and validates all tests before allocating identities and computes duplicate ordinals', async () => {
    const calls: RecordedCall[] = [];
    const deps = dependencies(calls);
    const context = await preparePatientChartLabOrderStrictContext(requestInput(deps, {
      requestItems: [
        { labTestId: 301, instructions: 'First' },
        { labTestId: 301, instructions: 'Repeat' },
      ],
    }));

    expect(calls.map((call) => call.label)).toEqual([
      'resolve:301',
      'resolve:301',
      'nextOrderNo',
      'nextInvoiceNo',
    ]);
    expect(context.items.map((item) => item.duplicateOrdinal)).toEqual([0, 1]);
    expect(context.items.map((item) => item.instructions)).toEqual(['First', 'Repeat']);
    expect(context.total).toBe(1000);
  });

  it.each([
    {
      name: 'missing test',
      dependencies: (calls: RecordedCall[]) => dependencies(calls, { resolveLabTest: vi.fn(async () => null) }),
      message: 'Lab test 301 not found',
    },
    {
      name: 'zero total',
      dependencies: (calls: RecordedCall[]) => dependencies(calls, {
        resolveLabTest: vi.fn(async (labTestId: number) => ({
          id: labTestId,
          name: 'Free test',
          category: null,
          price: 0,
          billingServiceItemId: 20,
        })),
      }),
      message: 'positive total',
    },
    {
      name: 'missing billing mapping',
      dependencies: (calls: RecordedCall[]) => dependencies(calls, {
        resolveLabTest: vi.fn(async (labTestId: number) => ({
          id: labTestId,
          name: 'CBC',
          category: 'Hematology',
          price: 500,
          billingServiceItemId: null,
        })),
      }),
      message: 'billing service mapping',
    },
  ])('rejects $name before sequence allocation', async ({ dependencies: buildDependencies, message }) => {
    const calls: RecordedCall[] = [];
    await expect(preparePatientChartLabOrderStrictContext(requestInput(buildDependencies(calls), {
      requestItems: [{ labTestId: 301, instructions: null }],
    }))).rejects.toThrow(message);
    expect(calls.some((call) => call.label === 'nextOrderNo')).toBe(false);
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });
});

describe('preparePatientChartLabOrderStrictStatements', () => {
  it('commits the complete quick-lab order and bill chain without visit services', async () => {
    const { sqlite, db, batch } = strictHarness();
    try {
      await batch(preparePatientChartLabOrderStrictStatements(db as never, strictContext()));

      expect(count(sqlite, 'lab_orders')).toBe(1);
      expect(count(sqlite, 'lab_order_items')).toBe(2);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(2);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare('SELECT notes,bill_id,billing_status FROM lab_orders').get()).toEqual({
        notes: 'Check infection markers',
        bill_id: 1,
        billing_status: 'unpaid',
      });
      expect(sqlite.prepare('SELECT instructions,notes FROM lab_order_items ORDER BY id').all()).toEqual([
        { instructions: 'Urgent CBC', notes: 'Urgent CBC' },
        { instructions: 'Fasting sample', notes: 'Fasting sample' },
      ]);
      expect(sqlite.prepare('SELECT reference_id FROM invoice_items ORDER BY id').all()).toEqual([
        { reference_id: 1 },
        { reference_id: 2 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back all rows when catalog price or service linkage changes after preflight', async () => {
    const { sqlite, db, batch } = strictHarness();
    try {
      sqlite.prepare('UPDATE billing_service_items SET price=510 WHERE id=20').run();
      await expect(batch(preparePatientChartLabOrderStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(count(sqlite, 'lab_orders')).toBe(0);
      expect(count(sqlite, 'lab_order_items')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back duplicate identities and stale patient or visit ownership', async () => {
    const { sqlite, db, batch } = strictHarness();
    try {
      sqlite.prepare("INSERT INTO lab_orders (order_no,tenant_id) VALUES ('LAB-1','100')").run();
      await expect(batch(preparePatientChartLabOrderStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(count(sqlite, 'bills')).toBe(0);

      sqlite.prepare('DELETE FROM lab_orders').run();
      sqlite.prepare("UPDATE patients SET tenant_id='101' WHERE id=501").run();
      await expect(batch(preparePatientChartLabOrderStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(count(sqlite, 'lab_orders')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);

      sqlite.prepare("UPDATE patients SET tenant_id='100' WHERE id=501").run();
      sqlite.prepare('UPDATE visits SET patient_id=999 WHERE id=77').run();
      await expect(batch(preparePatientChartLabOrderStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(count(sqlite, 'lab_orders')).toBe(0);
      expect(count(sqlite, 'bills')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

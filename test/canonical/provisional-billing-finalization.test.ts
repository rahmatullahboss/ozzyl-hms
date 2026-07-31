import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { calculateBillCategoryTotals } from '../../src/lib/billing-category-totals';
import {
  prepareProvisionalBillingLegacyStatements,
  prepareProvisionalBillingStrictStatements,
  type ProvisionalBillingLegacyFinalizationInput,
} from '../../src/lib/canonical/provisional-billing-finalization';

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
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    return this.sqlite.prepare(this.sql).run(...this.params);
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER,
      invoice_no TEXT NOT NULL,
      test_bill REAL NOT NULL DEFAULT 0,
      doctor_visit_bill REAL NOT NULL DEFAULT 0,
      admission_bill REAL NOT NULL DEFAULT 0,
      operation_bill REAL NOT NULL DEFAULT 0,
      medicine_bill REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      discount_by_name TEXT,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      due REAL NOT NULL,
      status TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      remarks TEXT,
      tenant_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, invoice_no)
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      item_category TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      reference_id INTEGER,
      tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER,
      visit_id INTEGER,
      item_category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      department TEXT,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      discount_amount REAL,
      total_amount REAL NOT NULL,
      doctor_id INTEGER,
      doctor_name TEXT,
      reference_id INTEGER,
      bill_status TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      billed_bill_id INTEGER
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      receipt_no TEXT NOT NULL,
      received_by TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      date TEXT NOT NULL,
      UNIQUE (tenant_id, receipt_no)
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id INTEGER NOT NULL,
      reference_type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_bill_id INTEGER NOT NULL,
      remarks TEXT,
      created_by TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      UNIQUE (tenant_id, deposit_receipt_no)
    );
    CREATE TABLE bill_discount_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      allocation_type TEXT NOT NULL,
      discount_reason TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_name TEXT,
      note TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_by TEXT NOT NULL
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
  const db = { prepare(sql: string) { return new Statement(sqlite, sql); } };
  return { sqlite, db };
}

function input(overrides: Partial<ProvisionalBillingLegacyFinalizationInput> = {}): ProvisionalBillingLegacyFinalizationInput {
  const items = [{
    id: 901,
    patientId: 501,
    admissionId: null,
    visitId: 601,
    itemCategory: 'test',
    description: 'CBC',
    department: 'Laboratory',
    quantity: 2,
    unitPrice: 500,
    discountAmount: 100,
    lineTotal: 900,
    doctorId: 101,
    doctorName: 'Dr Test',
    referenceId: 55,
  }];
  const base: ProvisionalBillingLegacyFinalizationInput = {
    tenantId: '100',
    userId: '9',
    patientId: 501,
    visitId: 601,
    invoiceNo: 'INV-PROV-1',
    categoryTotals: calculateBillCategoryTotals([{ category: 'test', amount: 900 }]),
    subtotal: 900,
    discount: 50,
    discountByName: 'Scheme Patient',
    total: 850,
    paid: 200,
    due: 350,
    billStatus: 'open',
    paymentMethod: 'cash',
    remarks: 'Provisional conversion',
    counterId: 3,
    counterSessionId: 30,
    paymentReceiptNo: 'RCP-PROV-1',
    depositAdjustmentReceiptNo: 'DAD-PROV-1',
    depositDeducted: 300,
    businessDate: '2026-07-23',
    items,
    schemeAllocation: {
      allocationType: 'scheme',
      amount: 50,
      referenceName: 'Scheme Patient',
      note: 'Scheme: Test Scheme',
      metadataJson: '{"source":"provisional_bill"}',
    },
    accountingExtraPayload: { source: 'provisional_bill' },
  };
  return { ...base, ...overrides, items: overrides.items ?? base.items };
}

function seedItem(sqlite: DatabaseSync, overrides: Record<string, unknown> = {}): void {
  const row = {
    id: 901,
    tenant_id: '100',
    patient_id: 501,
    admission_id: null,
    visit_id: 601,
    item_category: 'test',
    item_name: 'CBC',
    department: 'Laboratory',
    unit_price: 500,
    quantity: 2,
    discount_amount: 100,
    total_amount: 900,
    doctor_id: 101,
    doctor_name: 'Dr Test',
    reference_id: 55,
    bill_status: 'provisional',
    is_active: 1,
    ...overrides,
  };
  sqlite.prepare(`
    INSERT INTO billing_provisional_items (
      id,tenant_id,patient_id,admission_id,visit_id,item_category,item_name,department,
      unit_price,quantity,discount_amount,total_amount,doctor_id,doctor_name,reference_id,
      bill_status,is_active
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id, row.tenant_id, row.patient_id, row.admission_id, row.visit_id,
    row.item_category, row.item_name, row.department, row.unit_price, row.quantity,
    row.discount_amount, row.total_amount, row.doctor_id, row.doctor_name, row.reference_id,
    row.bill_status, row.is_active,
  );
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

function expectFinancialTablesEmpty(sqlite: DatabaseSync): void {
  for (const table of [
    'bills', 'invoice_items', 'payments', 'emp_cash_transactions',
    'billing_deposits', 'bill_discount_allocations', 'accounting_posting_events',
  ]) expect(count(sqlite, table), table).toBe(0);
}

describe('provisional billing guarded legacy finalization', () => {
  it('keeps the original legacy batch free of strict SQL and restores post-commit settlement events', async () => {
    const { sqlite, db } = harness();
    try {
      seedItem(sqlite);
      const statements = prepareProvisionalBillingLegacyStatements(
        db as unknown as D1Database,
        input(),
      ) as D1PreparedStatement[] & { legacyPostCommit?: () => Promise<void> };
      const sql = (statements as unknown as Statement[]).map((statement) => statement.sql).join('\n');
      expect(sql).not.toMatch(/canonical_financial_batch_assertions|accounting_posting_events|changes\(\)/i);

      await runBatch(sqlite, statements);
      await statements.legacyPostCommit?.();

      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'billing_deposits')).toBe(1);
      expect(count(sqlite, 'accounting_posting_events')).toBe(3);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare('SELECT bill_status,billed_bill_id FROM billing_provisional_items WHERE id=901').get())
        .toEqual({ bill_status: 'finalized', billed_bill_id: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('commits bill, item, payment, deposit, scheme, and accounting authority together', async () => {
    const { sqlite, db } = harness();
    try {
      seedItem(sqlite);
      const statements = prepareProvisionalBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await runBatch(sqlite, statements);

      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(1);
      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(1);
      expect(count(sqlite, 'billing_deposits')).toBe(1);
      expect(count(sqlite, 'bill_discount_allocations')).toBe(1);
      expect(count(sqlite, 'accounting_posting_events')).toBe(3);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare('SELECT total,paid,due,status FROM bills').get())
        .toEqual({ total: 850, paid: 200, due: 350, status: 'open' });
      expect(sqlite.prepare('SELECT bill_status,billed_bill_id FROM billing_provisional_items WHERE id=901').get())
        .toEqual({ bill_status: 'finalized', billed_bill_id: 1 });
    } finally { sqlite.close(); }
  });

  it('preserves exact legacy source text including surrounding whitespace', async () => {
    const { sqlite, db } = harness();
    try {
      seedItem(sqlite, {
        item_category: ' test ',
        item_name: ' CBC ',
        department: ' Laboratory ',
        doctor_name: ' Dr Test ',
      });
      const statements = prepareProvisionalBillingStrictStatements(
        db as unknown as D1Database,
        input({
          items: [{
            ...input().items[0],
            itemCategory: ' test ',
            description: ' CBC ',
            department: ' Laboratory ',
            doctorName: ' Dr Test ',
          }],
        }),
      );
      await runBatch(sqlite, statements);
      expect(sqlite.prepare('SELECT item_category,description FROM invoice_items').get())
        .toEqual({ item_category: ' test ', description: ' CBC ' });
      expect(sqlite.prepare('SELECT bill_status FROM billing_provisional_items WHERE id=901').get())
        .toEqual({ bill_status: 'finalized' });
    } finally { sqlite.close(); }
  });

  it.each([
    ['unit price', { unit_price: 499 }],
    ['quantity', { quantity: 1 }],
    ['discount', { discount_amount: 99 }],
    ['net total', { total_amount: 899 }],
    ['status', { bill_status: 'finalized' }],
    ['patient', { patient_id: 999 }],
    ['visit', { visit_id: 999 }],
    ['category', { item_category: 'service' }],
    ['description', { item_name: 'Changed CBC' }],
    ['doctor', { doctor_id: 999 }],
    ['reference', { reference_id: 999 }],
  ] as const)('rolls back every financial row when %s changed after snapshot', async (_label, mutation) => {
    const { sqlite, db } = harness();
    try {
      seedItem(sqlite, mutation);
      const statements = prepareProvisionalBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);
      expectFinancialTablesEmpty(sqlite);
    } finally { sqlite.close(); }
  });

  it('rolls back when payment receipt identity already exists', async () => {
    const { sqlite, db } = harness();
    try {
      seedItem(sqlite);
      sqlite.exec(`
        INSERT INTO bills (
          patient_id,visit_id,invoice_no,total,paid,due,status,payment_method,tenant_id,
          created_by,counter_id,counter_session_id,created_at
        ) VALUES (1,NULL,'EXISTING',1,1,0,'paid','cash','100','1',1,1,'2026-07-23');
        INSERT INTO payments (
          bill_id,amount,payment_type,receipt_no,received_by,payment_method,counter_id,
          counter_session_id,tenant_id,date
        ) VALUES (1,1,'current','RCP-PROV-1','1','cash',1,1,'100','2026-07-23');
      `);
      const statements = prepareProvisionalBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'billing_deposits')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back when deposit adjustment or accounting identity already exists', async () => {
    const { sqlite, db } = harness();
    try {
      seedItem(sqlite);
      sqlite.exec(`
        INSERT INTO bills (
          patient_id,visit_id,invoice_no,total,paid,due,status,payment_method,tenant_id,
          created_by,counter_id,counter_session_id,created_at
        ) VALUES (1,NULL,'EXISTING',1,1,0,'paid','cash','100','1',1,1,'2026-07-23');
        INSERT INTO billing_deposits (
          tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,reference_bill_id,
          remarks,created_by,counter_id,counter_session_id
        ) VALUES ('100',1,'DAD-PROV-1',1,'adjustment',1,NULL,'1',1,1);
      `);
      const statements = prepareProvisionalBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);
      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'billing_deposits')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
    } finally { sqlite.close(); }
  });
});

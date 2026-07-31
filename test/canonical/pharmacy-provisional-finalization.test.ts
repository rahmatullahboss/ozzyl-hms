import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import type { PharmacySaleContext } from '../../src/lib/canonical/pharmacy-sale-types';
import {
  executePharmacyProvisionalOriginalLegacy,
  preparePharmacyProvisionalStrictContext,
  preparePharmacyProvisionalStrictStatements,
  type PharmacyProvisionalFinalizationInput,
} from '../../src/lib/canonical/pharmacy-provisional-finalization';

type Call = { kind: 'first' | 'all' | 'run' | 'batch' | 'dependency'; sql?: string; params?: unknown[]; label?: string };

class MockStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly calls: Call[],
    private readonly resolver: (kind: 'first' | 'all' | 'run', sql: string, params: unknown[]) => unknown,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): MockStatement { return new MockStatement(this.calls, this.resolver, this.sql, values); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.calls.push({ kind: 'first', sql: this.sql, params: this.params });
    return this.resolver('first', this.sql, this.params) as T | null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.calls.push({ kind: 'all', sql: this.sql, params: this.params });
    return { results: this.resolver('all', this.sql, this.params) as T[] };
  }
  async run(): Promise<unknown> {
    this.calls.push({ kind: 'run', sql: this.sql, params: this.params });
    return this.resolver('run', this.sql, this.params);
  }
}

function legacyHarness(options: {
  batchFails?: boolean;
  quantity?: number;
  duplicateQuantities?: number[];
  stockUpdateChanges?: number[];
} = {}) {
  const calls: Call[] = [];
  let stockUpdateIndex = 0;
  const resolver = (kind: 'first' | 'all' | 'run', sql: string) => {
    const normalized = sql.toLowerCase();
    if (kind === 'first' && normalized.includes('from pharmacy_provisional_invoices')) {
      return {
        id: 5, patient_id: 501, patient_visit_id: null, prescriber_id: null,
        total_amount: 100, discount_pct: 0, counter_id: null,
      };
    }
    if (kind === 'all' && normalized.includes('from pharmacy_provisional_items')) {
      const quantities = options.duplicateQuantities ?? [options.quantity ?? 1];
      return quantities.map((quantity, index) => ({
        id: 6 + index, item_id: 20, stock_id: 30, batch_no: 'B-001', expiry_date: '2027-01-01',
        quantity, price: 100, sale_price: 100,
        discount_pct: 0, vat_pct: 0, total_amount: quantity * 100,
      }));
    }
    if (kind === 'first' && normalized.includes('from pharmacy_stock')) {
      return { item_id: 20, available_qty: 10, cost_price: 50, batch_no: 'B-001', expiry_date: '2027-01-01', item_name: 'Test medicine' };
    }
    if (kind === 'first' && normalized.includes('from billing_deposits')) return { balance: 1000 };
    if (kind === 'run' && normalized.includes("set status = 'converting'")) return { meta: { changes: 1 } };
    if (kind === 'run' && normalized.includes('set available_qty = available_qty -')) {
      const changes = options.stockUpdateChanges?.[stockUpdateIndex] ?? 1;
      stockUpdateIndex += 1;
      return { meta: { changes } };
    }
    if (kind === 'run' && normalized.includes('insert into pharmacy_invoices')) return { meta: { changes: 1, last_row_id: 71 } };
    if (kind === 'run' && normalized.includes('insert into billing_deposits')) return { meta: { changes: 1 } };
    return { meta: { changes: 1 } };
  };
  const db = {
    prepare(sql: string) { return new MockStatement(calls, resolver, sql); },
    async batch(statements: readonly CanonicalPreparedStatement[]) {
      calls.push({ kind: 'batch', label: String(statements.length) });
      if (options.batchFails) throw new Error('batch failed');
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  return { calls, db };
}

function input(
  calls: Call[],
  overrides: Partial<PharmacyProvisionalFinalizationInput> = {},
): PharmacyProvisionalFinalizationInput {
  return {
    tenantId: '100',
    userId: 9,
    provisionalId: 5,
    businessDate: '2026-07-24',
    occurredAtUtc: '2026-07-24T04:00:00.000Z',
    paymentMode: 'cash',
    externalTransactionId: null,
    paidAmount: 60,
    creditAmount: 40,
    depositDeductAmount: 0,
    tender: 60,
    discountAmount: 0,
    remarks: null,
    dependencies: {
      async nextInvoiceNo() {
        calls.push({ kind: 'dependency', label: 'nextInvoiceNo' });
        return 'PH-1';
      },
      async hydrateCanonicalAuthority(context) { return context; },
    },
    ...overrides,
  };
}

function labels(calls: Call[]): string[] {
  return calls.map((call) => {
    if (call.kind === 'dependency' || call.kind === 'batch') return call.label ?? call.kind;
    const sql = call.sql?.toLowerCase() ?? '';
    if (sql.includes('from pharmacy_provisional_invoices')) return 'load-provisional';
    if (sql.includes("set status = 'converting'")) return 'claim';
    if (sql.includes('from pharmacy_provisional_items')) return 'load-items';
    if (sql.includes('from pharmacy_stock')) return 'load-stock';
    if (sql.includes('set available_qty = available_qty -')) return 'deduct-stock';
    if (sql.includes('set available_qty = available_qty +')) return 'restore-stock';
    if (sql.includes('insert into pharmacy_invoices')) return 'insert-invoice';
    if (sql.includes("set status = 'active'")) return 'restore-status';
    if (sql.includes('delete from pharmacy_invoices')) return 'delete-invoice';
    return call.kind;
  });
}

describe('executePharmacyProvisionalOriginalLegacy', () => {
  it('preserves claim, stock-first, invoice and batch order', async () => {
    const { calls, db } = legacyHarness();
    const result = await executePharmacyProvisionalOriginalLegacy(db as never, input(calls));
    expect(result.context).toMatchObject({
      sourceKind: 'provisional_conversion', sourceDocumentId: 5,
      invoiceNo: 'PH-1', total: 100, paidAmount: 60, creditAmount: 40,
    });
    expect(result.invoiceId).toBe(71);
    expect(labels(calls)).toEqual([
      'load-provisional', 'claim', 'load-items', 'load-stock', 'deduct-stock',
      'nextInvoiceNo', 'insert-invoice', '3',
    ]);
    const originalSql = calls.map((call) => call.sql ?? '').join('\n');
    expect(originalSql).not.toMatch(/canonical_|financial_batch_assertions/i);
  });

  it('restores stock, source status and invoice when the final batch fails', async () => {
    const { calls, db } = legacyHarness({ batchFails: true });
    await expect(executePharmacyProvisionalOriginalLegacy(db as never, input(calls)))
      .rejects.toThrow('batch failed');
    expect(labels(calls)).toEqual(expect.arrayContaining([
      'restore-stock', 'restore-status', 'delete-invoice',
    ]));
  });

  it('preserves per-line prevalidation and compensates when a duplicate stock line depletes later', async () => {
    const { calls, db } = legacyHarness({
      duplicateQuantities: [6, 6],
      stockUpdateChanges: [1, 0],
    });
    await expect(executePharmacyProvisionalOriginalLegacy(db as never, input(calls, {
      paidAmount: 1200,
      creditAmount: 0,
      tender: 1200,
    }))).rejects.toThrow(/concurrent sale/i);
    expect(labels(calls).filter((label) => label === 'load-stock')).toHaveLength(2);
    expect(labels(calls)).toContain('restore-stock');
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });
});

describe('preparePharmacyProvisionalStrictContext', () => {
  it('rejects fractional quantity before canonical hydration or invoice allocation', async () => {
    const { calls, db } = legacyHarness({ quantity: 1.5 });
    const hydrate = vi.fn(async (context: PharmacySaleContext) => context);
    const strictInput = input(calls, {
      dependencies: {
        nextInvoiceNo: async () => {
          calls.push({ kind: 'dependency', label: 'nextInvoiceNo' });
          return 'PH-1';
        },
        hydrateCanonicalAuthority: hydrate,
      },
    });
    await expect(preparePharmacyProvisionalStrictContext(db as never, strictInput))
      .rejects.toThrow(/positive safe integer/i);
    expect(hydrate).not.toHaveBeenCalled();
    expect(calls.some((call) => call.label === 'nextInvoiceNo')).toBe(false);
  });

  it('hydrates canonical authority before allocating the invoice number', async () => {
    const { calls, db } = legacyHarness();
    const hydrate = vi.fn(async (sale: PharmacySaleContext) => ({
      ...sale,
      items: sale.items.map((item) => ({
        ...item,
        sourceUnitCode: 'EA',
        canonical: {
          itemPublicId: 'invitem_20', servicePublicId: 'svc_20', lotPublicId: 'lot_30',
          locationPublicId: 'loc_pharm', baseUnitCode: 'EA', conversionNumerator: 1,
          conversionDenominator: 1, balanceBeforeBase: 10, balanceVersion: 0,
        },
      })),
    }));
    const context = await preparePharmacyProvisionalStrictContext(db as never, input(calls, {
      dependencies: {
        nextInvoiceNo: async () => {
          calls.push({ kind: 'dependency', label: 'nextInvoiceNo' });
          return 'PH-1';
        },
        hydrateCanonicalAuthority: hydrate,
      },
    }));
    expect(context.items[0].canonical?.itemPublicId).toBe('invitem_20');
    expect(hydrate).toHaveBeenCalledOnce();
    expect(calls.findIndex((call) => call.label === 'nextInvoiceNo'))
      .toBeGreaterThan(calls.findIndex((call) => call.kind === 'first' && call.sql?.includes('pharmacy_stock')));
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
    CREATE TABLE pharmacy_provisional_invoices (
      id INTEGER PRIMARY KEY,status TEXT,is_active INTEGER,tenant_id TEXT,patient_id INTEGER,
      patient_visit_id INTEGER,prescriber_id INTEGER,counter_id INTEGER,discount_pct REAL,updated_at TEXT
    );
    CREATE TABLE pharmacy_stock (
      id INTEGER PRIMARY KEY,item_id INTEGER,available_qty REAL,cost_price REAL,is_active INTEGER,
      tenant_id TEXT,updated_at TEXT
    );
    CREATE TABLE pharmacy_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_no TEXT,patient_id INTEGER,patient_visit_id INTEGER,
      counter_id INTEGER,is_outdoor_patient INTEGER,visit_type TEXT,prescriber_id INTEGER,
      subtotal REAL,discount_amount REAL,discount_pct REAL,vat_amount REAL,total_amount REAL,
      paid_amount REAL,credit_amount REAL,tender REAL,change_amount REAL,payment_mode TEXT,
      deposit_deduct_amount REAL,status TEXT,paid_date TEXT,remarks TEXT,tenant_id TEXT,created_by INTEGER
    );
    CREATE UNIQUE INDEX uq_pharmacy_invoice ON pharmacy_invoices(tenant_id,invoice_no);
    CREATE TABLE pharmacy_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id INTEGER,item_id INTEGER,stock_id INTEGER,
      batch_no TEXT,expiry_date TEXT,quantity REAL,mrp REAL,price REAL,subtotal REAL,
      discount_pct REAL,discount_amount REAL,vat_pct REAL,vat_amount REAL,total_amount REAL,
      tenant_id TEXT,created_by INTEGER
    );
    CREATE TABLE pharmacy_stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER,stock_id INTEGER,transaction_type TEXT,
      reference_type TEXT,reference_id INTEGER,batch_no TEXT,out_qty REAL,price REAL,
      tenant_id TEXT,created_by INTEGER
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT,patient_id INTEGER,deposit_receipt_no TEXT,
      amount REAL,transaction_type TEXT,reference_bill_id INTEGER,remarks TEXT,created_by INTEGER,
      counter_id INTEGER,counter_session_id INTEGER
    );
    INSERT INTO pharmacy_provisional_invoices VALUES (5,'active',1,'100',501,NULL,NULL,NULL,0,NULL);
    INSERT INTO pharmacy_stock VALUES (30,20,10,50,1,'100',NULL);
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

function strictContext(): PharmacySaleContext {
  return {
    tenantId: '100', userId: 9, patientId: 501, patientVisitId: null,
    prescriberId: null, counterId: null, sourceKind: 'provisional_conversion',
    sourceDocumentId: 5, invoiceNo: 'PH-1', businessDate: '2026-07-24',
    occurredAtUtc: '2026-07-24T04:00:00.000Z', paymentMode: 'cash',
    externalTransactionId: null, tender: 60, subtotal: 100, sourceDiscountPct: 7, discountAmount: 0,
    total: 100, paidAmount: 60, creditAmount: 40, depositDeductAmount: 0, remarks: null,
    items: [{
      lineNumber: 1, duplicateOrdinal: 0, sourceItemId: 6, pharmacyItemId: 20,
      stockId: 30, itemName: 'Test medicine', batchNo: 'B-001', expiryDate: '2027-01-01',
      sourceUnitCode: 'EA', quantity: 1, mrp: 100, price: 100, salePrice: 100,
      discountPct: 0, vatPct: 0, subtotal: 100, total: 100, costPrice: 50,
      legacyAvailableBefore: 10,
      canonical: {
        itemPublicId: 'invitem_20', servicePublicId: 'svc_20', lotPublicId: 'lot_30',
        locationPublicId: 'loc_pharm', baseUnitCode: 'EA', conversionNumerator: 1,
        conversionDenominator: 1, balanceBeforeBase: 10, balanceVersion: 0,
      },
    }],
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('preparePharmacyProvisionalStrictStatements', () => {
  it('commits claim, stock, invoice, line, transaction and converted status atomically', async () => {
    const { sqlite, db } = strictHarness();
    try {
      await db.batch(preparePharmacyProvisionalStrictStatements(db as never, strictContext()));
      expect(sqlite.prepare('SELECT status FROM pharmacy_provisional_invoices').get()).toEqual({ status: 'converted' });
      expect(sqlite.prepare('SELECT available_qty FROM pharmacy_stock').get()).toEqual({ available_qty: 9 });
      expect(count(sqlite, 'pharmacy_invoices')).toBe(1);
      expect(sqlite.prepare('SELECT discount_pct FROM pharmacy_invoices').get()).toEqual({ discount_pct: 7 });
      expect(count(sqlite, 'pharmacy_invoice_items')).toBe(1);
      expect(count(sqlite, 'pharmacy_stock_transactions')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back everything when stock changed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      sqlite.prepare('UPDATE pharmacy_stock SET available_qty=8 WHERE id=30').run();
      await expect(db.batch(preparePharmacyProvisionalStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(sqlite.prepare('SELECT status FROM pharmacy_provisional_invoices').get()).toEqual({ status: 'active' });
      expect(sqlite.prepare('SELECT available_qty FROM pharmacy_stock').get()).toEqual({ available_qty: 8 });
      expect(count(sqlite, 'pharmacy_invoices')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back everything when stock item identity changed after preflight', async () => {
    const { sqlite, db } = strictHarness();
    try {
      sqlite.prepare('UPDATE pharmacy_stock SET item_id=21 WHERE id=30').run();
      await expect(db.batch(preparePharmacyProvisionalStrictStatements(db as never, strictContext())))
        .rejects.toThrow();
      expect(sqlite.prepare('SELECT status FROM pharmacy_provisional_invoices').get()).toEqual({ status: 'active' });
      expect(sqlite.prepare('SELECT item_id,available_qty FROM pharmacy_stock').get())
        .toEqual({ item_id: 21, available_qty: 10 });
      expect(count(sqlite, 'pharmacy_invoices')).toBe(0);
    } finally { sqlite.close(); }
  });
});

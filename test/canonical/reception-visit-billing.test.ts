import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { prepareCanonicalBillingServiceMapping } from '../../src/lib/canonical/live-service-catalog-recovery';
import {
  executeReceptionVisitBillingOriginalLegacy,
  prepareReceptionVisitBillingStrictContext,
  prepareReceptionVisitBillingStrictStatements,
  ReceptionVisitBillingError,
  type ReceptionVisitBillingContext,
  type ReceptionVisitBillingPreparationInput,
} from '../../src/lib/canonical/reception-visit-billing';

type Call = {
  sql: string;
  params: unknown[];
  method: 'run' | 'first' | 'batch';
};

class RecordingStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly calls: Call[],
    readonly sql: string,
    readonly params: unknown[] = [],
    private readonly firstResolver?: (sql: string, params: unknown[]) => unknown,
  ) {}

  bind(...values: unknown[]): RecordingStatement {
    return new RecordingStatement(this.calls, this.sql, values, this.firstResolver);
  }

  async run() {
    this.calls.push({ sql: this.sql, params: this.params, method: 'run' });
    return { success: true, meta: { changes: 1, last_row_id: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.calls.push({ sql: this.sql, params: this.params, method: 'first' });
    return (this.firstResolver?.(this.sql, this.params) as T | null | undefined) ?? null;
  }
}

function service(overrides: Partial<ReceptionVisitBillingPreparationInput['services'][number]> = {}) {
  return {
    id: 31,
    patientId: 501,
    visitId: 77,
    serviceType: 'doctor_visit',
    description: 'Consultation',
    serviceItemId: 20,
    doctorId: 801,
    amount: 500,
    discountAmount: 0,
    quantity: 1,
    totalAmount: 500,
    referenceType: null,
    referenceId: null,
    ...overrides,
  };
}

function input(
  calls: string[],
  overrides: Partial<ReceptionVisitBillingPreparationInput> = {},
): ReceptionVisitBillingPreparationInput {
  const base: ReceptionVisitBillingPreparationInput = {
    tenantId: '100',
    userId: 9,
    visitId: 77,
    patientId: 501,
    visitDoctorId: 801,
    businessDate: '2026-07-24',
    issuedAtUtc: '2026-07-24T03:00:00.000Z',
    subtotal: 800,
    discount: 50,
    discountByName: 'Manager',
    total: 750,
    categoryTotals: {
      testBill: 300,
      doctorVisitBill: 500,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    },
    discountAllocations: [{
      allocationType: 'hospital_discount',
      reason: 'normal_hospital_discount',
      doctorId: null,
      amount: 50,
      referenceName: 'Manager',
      note: null,
      metadataJson: '{"source":"reception_visit_bill"}',
    }],
    services: [
      service(),
      service({
        id: 32,
        serviceType: 'test',
        description: 'Complete Blood Count',
        serviceItemId: 21,
        doctorId: null,
        amount: 300,
        totalAmount: 300,
        referenceType: 'lab_order_item',
        referenceId: 902,
      }),
    ],
    dependencies: {
      assertAccountingPeriodOpen: async () => {
        calls.push('period');
      },
      nextInvoiceNo: async () => {
        calls.push('invoice');
        return 'INV-1';
      },
    },
  };
  return {
    ...base,
    ...overrides,
    services: overrides.services ?? base.services,
    discountAllocations: overrides.discountAllocations ?? base.discountAllocations,
    dependencies: overrides.dependencies ?? base.dependencies,
  };
}

function label(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.startsWith('update visit_services') && normalized.includes("set status = 'billing'")) return 'claim';
  if (normalized.startsWith('insert into bills')) return 'bill';
  if (normalized.startsWith('insert into bill_discount_allocations')) return 'allocation';
  if (normalized.startsWith('insert into invoice_items')) return 'invoice-item';
  if (normalized.startsWith('update visit_services') && normalized.includes("set status = 'billed'")) return 'service-link';
  if (normalized.startsWith('update doctor_commission_accruals')) return 'commission-link';
  if (normalized.startsWith('update lab_orders')) return 'lab-link';
  if (normalized.startsWith('update visit_services') && normalized.includes("set status = 'pending'")) return 'reset';
  if (normalized.startsWith('select id from bills')) return 'bill-lookup';
  return normalized.slice(0, 60);
}

function harness(options: { billInsertId?: number; lookupBillId?: number | null } = {}) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      return new RecordingStatement(calls, sql, [], (query) => (
        label(query) === 'bill-lookup' && options.lookupBillId
          ? { id: options.lookupBillId }
          : null
      ));
    },
    async batch(statements: readonly CanonicalPreparedStatement[]) {
      const results = [];
      for (const [index, statement] of statements.entries()) {
        const recording = statement as RecordingStatement;
        calls.push({ sql: recording.sql, params: recording.params, method: 'batch' });
        results.push({
          success: true,
          meta: {
            changes: 1,
            last_row_id: index === 1 ? (options.billInsertId ?? 41) : 0,
          },
        });
      }
      return results;
    },
  };
  return { calls, db };
}

describe('executeReceptionVisitBillingOriginalLegacy', () => {
  it('preserves accounting-period, invoice-allocation and original batch statement order', async () => {
    const dependencyCalls: string[] = [];
    const { calls, db } = harness({ billInsertId: 41 });

    const result = await executeReceptionVisitBillingOriginalLegacy(
      db as never,
      input(dependencyCalls),
    );

    expect(dependencyCalls).toEqual(['period', 'invoice']);
    expect(result.billId).toBe(41);
    expect(result.context).toMatchObject({
      invoiceNo: 'INV-1',
      subtotal: 800,
      discount: 50,
      total: 750,
    });
    expect(calls.filter((call) => call.method === 'batch').map((call) => label(call.sql))).toEqual([
      'claim',
      'bill',
      'allocation',
      'invoice-item',
      'service-link',
      'invoice-item',
      'service-link',
      'commission-link',
      'lab-link',
      'reset',
    ]);
  });

  it('preserves invoice-item reference rules and lab linkage binds', async () => {
    const { calls, db } = harness({ billInsertId: 41 });
    await executeReceptionVisitBillingOriginalLegacy(db as never, input([]));

    const invoiceItems = calls.filter((call) => call.method === 'batch' && label(call.sql) === 'invoice-item');
    expect(invoiceItems).toHaveLength(2);
    expect(invoiceItems[0].params).toContain(20);
    expect(invoiceItems[1].params).toContain(902);

    const commission = calls.find((call) => call.method === 'batch' && label(call.sql) === 'commission-link');
    const lab = calls.find((call) => call.method === 'batch' && label(call.sql) === 'lab-link');
    expect(commission?.params).toContain(902);
    expect(lab?.params).toContain(902);
    expect(lab?.params).toContain(750);
  });

  it('falls back to the committed bill lookup when the batch result omits last_row_id', async () => {
    const { db } = harness({ billInsertId: 0, lookupBillId: 55 });
    const result = await executeReceptionVisitBillingOriginalLegacy(db as never, input([]));
    expect(result.billId).toBe(55);
  });

  it('throws the historical concurrency conflict when no bill was committed', async () => {
    const { db } = harness({ billInsertId: 0, lookupBillId: null });
    await expect(executeReceptionVisitBillingOriginalLegacy(db as never, input([])))
      .rejects.toMatchObject<Partial<ReceptionVisitBillingError>>({
        name: 'ReceptionVisitBillingError',
        status: 409,
      });
  });

  it('keeps the original executor free of canonical and assertion SQL', async () => {
    const { calls, db } = harness({ billInsertId: 41 });
    await executeReceptionVisitBillingOriginalLegacy(db as never, input([]));
    const sql = calls.map((call) => call.sql).join('\n').toLowerCase();
    expect(sql).not.toContain('canonical_');
    expect(sql).not.toContain('changes()');
    expect(sql).not.toContain('billing_service_departments');
    expect(sql).not.toContain('canonical_financial_batch_assertions');
  });
});

type SqlValue = string | number | bigint | null | Uint8Array;
const SOURCE_HASH = 'a'.repeat(64);

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
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
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    '0505_canonical_program_foundation.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0532_canonical_financial_batch_assertions.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));

  sqlite.exec(`
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER
    );
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      department_code TEXT NOT NULL,
      department_name TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service_department_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE visit_services (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visit_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      description TEXT NOT NULL,
      service_item_id INTEGER NOT NULL,
      doctor_id INTEGER,
      amount REAL NOT NULL,
      discount_amount REAL NOT NULL,
      quantity INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      status TEXT NOT NULL,
      bill_id INTEGER
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER,
      visit_id INTEGER,
      invoice_no TEXT,
      subtotal REAL DEFAULT 0,
      test_bill REAL,
      admission_bill REAL,
      doctor_visit_bill REAL,
      operation_bill REAL,
      medicine_bill REAL,
      discount REAL,
      discount_by_name TEXT,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT,
      tenant_id TEXT,
      created_by INTEGER,
      counter_id INTEGER,
      counter_session_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE bill_discount_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT,
      bill_id INTEGER,
      allocation_type TEXT,
      discount_reason TEXT,
      doctor_id INTEGER,
      amount REAL,
      reference_name TEXT,
      note TEXT,
      metadata_json TEXT,
      created_by INTEGER
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER,
      item_category TEXT,
      description TEXT,
      quantity INTEGER,
      unit_price REAL,
      line_total REAL,
      reference_id INTEGER,
      tenant_id TEXT
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT,
      lab_order_item_id INTEGER,
      bill_id INTEGER,
      updated_at TEXT
    );
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      patient_id INTEGER,
      visit_id INTEGER,
      bill_id INTEGER,
      billing_status TEXT,
      updated_at TEXT
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      lab_order_id INTEGER
    );
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL
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
        json_object('billId', NEW.id, 'invoiceNo', NEW.invoice_no, 'source', 'db_trigger'),
        COALESCE(CAST(NEW.created_by AS TEXT), 'system')
      );
    END;

    INSERT INTO visits VALUES (77, '100', 501, 801);
    INSERT INTO billing_service_departments VALUES
      (10, '100', 'OPD', 'Outpatient', 1),
      (11, '100', 'LAB', 'Laboratory', 1);
    INSERT INTO billing_service_items VALUES
      (20, '100', 10, 'CONSULT', 'Consultation', 500, 1),
      (21, '100', 11, 'CBC', 'Complete Blood Count', 300, 1);
    INSERT INTO visit_services VALUES
      (31, '100', 77, 501, 'doctor_visit', 'Consultation', 20, 801, 500, 0, 1, 500, NULL, NULL, 'pending', NULL),
      (32, '100', 77, 501, 'test', 'Complete Blood Count', 21, NULL, 300, 0, 1, 300, 'lab_order_item', 902, 'pending', NULL);
    INSERT INTO lab_orders VALUES (70, '100', 501, 77, NULL, 'not_billed', NULL);
    INSERT INTO lab_order_items VALUES (902, '100', 70);
    INSERT INTO doctor_commission_accruals (tenant_id, lab_order_item_id, bill_id)
      VALUES ('100', 902, NULL);
    INSERT INTO canonical_encounters (
      tenant_id, encounter_public_id, legacy_patient_id, encounter_type,
      status, started_at_utc, source_evidence_sha256
    ) VALUES (
      '100', 'enc-visit-77', 501, 'outpatient',
      'in_progress', '2026-07-24T02:00:00.000Z', '${SOURCE_HASH}'
    );
    INSERT INTO canonical_source_mappings (
      tenant_id, entity_type, canonical_public_id, source_type,
      source_public_id, source_table, mapping_status, mapping_version, evidence_sha256
    ) VALUES (
      '100', 'encounter', 'enc-visit-77', 'legacy_visit',
      '77', 'visits', 'mapped', 1, '${SOURCE_HASH}'
    );
  `);

  const db = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
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

function strictInput(
  calls: string[],
  overrides: Partial<ReceptionVisitBillingPreparationInput> = {},
): ReceptionVisitBillingPreparationInput {
  return input(calls, {
    ...overrides,
    dependencies: overrides.dependencies ?? {
      assertAccountingPeriodOpen: async () => {
        calls.push('period');
      },
      nextInvoiceNo: async () => {
        calls.push('invoice');
        return 'INV-STRICT-1';
      },
    },
  });
}

function countRows(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('prepareReceptionVisitBillingStrictContext', () => {
  it('validates encounter and recoverable service authority before invoice allocation', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls));
      expect(context).toMatchObject({
        invoiceNo: 'INV-STRICT-1',
        patientId: 501,
        visitId: 77,
        subtotal: 800,
        discount: 50,
        total: 750,
      });
      expect(calls).toEqual(['period', 'invoice']);
    } finally {
      sqlite.close();
    }
  });

  it('rejects missing encounter mapping before period and invoice allocation', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      sqlite.exec("DELETE FROM canonical_source_mappings WHERE entity_type='encounter'");
      await expect(prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls)))
        .rejects.toThrow(/encounter mapping/i);
      expect(calls).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('rejects inactive billing service authority before period and invoice allocation', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      sqlite.exec('UPDATE billing_service_items SET is_active=0 WHERE id=21');
      await expect(prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls)))
        .rejects.toThrow(/service/i);
      expect(calls).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('rejects an inactive canonical service mapping before period and invoice allocation', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const mapping = await prepareCanonicalBillingServiceMapping(db as never, {
        tenantId: '100',
        billingServiceItemId: 20,
      });
      await db.batch([...mapping.statements, ...mapping.reconciliationStatements]);
      sqlite.prepare(`
        UPDATE canonical_service_catalog_items
        SET status='inactive'
        WHERE tenant_id='100' AND service_public_id=?
      `).run(mapping.servicePublicId);
      await expect(prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls)))
        .rejects.toThrow(/active canonical service/i);
      expect(calls).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('rejects line arithmetic mismatch before period and invoice allocation', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const invalid = strictInput(calls, {
        services: [service({ totalAmount: 499 }), strictInput([]).services[1]],
      });
      await expect(prepareReceptionVisitBillingStrictContext(db as never, invalid))
        .rejects.toThrow(/arithmetic/i);
      expect(calls).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back strict authority when a mapped canonical service becomes inactive after preflight', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const mapping = await prepareCanonicalBillingServiceMapping(db as never, {
        tenantId: '100',
        billingServiceItemId: 20,
      });
      await db.batch([...mapping.statements, ...mapping.reconciliationStatements]);
      const context = await prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls));
      sqlite.prepare(`
        UPDATE canonical_service_catalog_items
        SET status='inactive'
        WHERE tenant_id='100' AND service_public_id=?
      `).run(mapping.servicePublicId);

      await expect(db.batch(prepareReceptionVisitBillingStrictStatements(db as never, context)))
        .rejects.toThrow();
      expect(countRows(sqlite, 'bills')).toBe(0);
      expect(countRows(sqlite, 'invoice_items')).toBe(0);
      expect(countRows(sqlite, 'accounting_posting_events')).toBe(0);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('allows a positive subtotal to be fully discounted to zero', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls, {
        discount: 800,
        total: 0,
        discountAllocations: [{
          allocationType: 'hospital_discount',
          reason: 'normal_hospital_discount',
          doctorId: null,
          amount: 800,
          referenceName: 'Manager',
          note: null,
          metadataJson: '{"source":"reception_visit_bill"}',
        }],
      }));
      expect(context.total).toBe(0);
      expect(calls).toEqual(['period', 'invoice']);
    } finally {
      sqlite.close();
    }
  });
});

describe('prepareReceptionVisitBillingStrictStatements', () => {
  it('atomically commits exact services, discount allocation, bill, items, lab links and trigger event', async () => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls));
      await db.batch(prepareReceptionVisitBillingStrictStatements(db as never, context));

      expect(countRows(sqlite, 'bills')).toBe(1);
      expect(countRows(sqlite, 'invoice_items')).toBe(2);
      expect(countRows(sqlite, 'bill_discount_allocations')).toBe(1);
      expect(countRows(sqlite, 'accounting_posting_events')).toBe(1);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare('SELECT status, bill_id FROM visit_services ORDER BY id').all()).toEqual([
        { status: 'billed', bill_id: 1 },
        { status: 'billed', bill_id: 1 },
      ]);
      expect(sqlite.prepare('SELECT bill_id, billing_status FROM lab_orders WHERE id=70').get())
        .toEqual({ bill_id: 1, billing_status: 'unpaid' });
      expect(sqlite.prepare('SELECT bill_id FROM doctor_commission_accruals WHERE lab_order_item_id=902').get())
        .toEqual({ bill_id: 1 });
    } finally {
      sqlite.close();
    }
  });

  it.each([
    ['service amount', 'UPDATE visit_services SET amount=501 WHERE id=31'],
    ['service patient', 'UPDATE visit_services SET patient_id=999 WHERE id=31'],
    ['service reference', 'UPDATE visit_services SET reference_id=903 WHERE id=32'],
    ['service status', "UPDATE visit_services SET status='billed' WHERE id=31"],
    ['service bill link', 'UPDATE visit_services SET bill_id=99 WHERE id=31'],
    ['service catalog activity', 'UPDATE billing_service_items SET is_active=0 WHERE id=20'],
    ['service catalog price', 'UPDATE billing_service_items SET price=501 WHERE id=20'],
    ['service catalog name', "UPDATE billing_service_items SET item_name='Changed Consultation' WHERE id=20"],
    ['service catalog code', "UPDATE billing_service_items SET item_code='CONSULT-NEW' WHERE id=20"],
    ['service catalog department', 'UPDATE billing_service_items SET service_department_id=11 WHERE id=20'],
    ['service department activity', 'UPDATE billing_service_departments SET is_active=0 WHERE id=10'],
    ['service department code', "UPDATE billing_service_departments SET department_code='OTHER' WHERE id=10"],
    ['visit doctor', 'UPDATE visits SET doctor_id=802 WHERE id=77'],
    ['encounter mapping', "DELETE FROM canonical_source_mappings WHERE entity_type='encounter'"],
    ['encounter status', "UPDATE canonical_encounters SET status='completed' WHERE encounter_public_id='enc-visit-77'"],
    ['lab reference', 'UPDATE lab_order_items SET lab_order_id=71 WHERE id=902'],
  ])('rolls back every strict row for a current %s race', async (_label, mutation) => {
    const calls: string[] = [];
    const { sqlite, db } = strictHarness();
    try {
      const context = await prepareReceptionVisitBillingStrictContext(db as never, strictInput(calls));
      sqlite.exec(mutation);
      await expect(db.batch(prepareReceptionVisitBillingStrictStatements(db as never, context)))
        .rejects.toThrow();
      expect(countRows(sqlite, 'bills')).toBe(0);
      expect(countRows(sqlite, 'invoice_items')).toBe(0);
      expect(countRows(sqlite, 'bill_discount_allocations')).toBe(0);
      expect(countRows(sqlite, 'accounting_posting_events')).toBe(0);
      expect(countRows(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

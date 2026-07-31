import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { calculateBillCategoryTotals } from '../../src/lib/billing-category-totals';
import {
  prepareAppointmentBillingLegacyStatements,
  prepareAppointmentBillingStrictStatements,
  type AppointmentLegacyFinalizationInput,
} from '../../src/lib/canonical/appointment-billing-finalization';

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
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
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
      created_at TEXT NOT NULL
    );
    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      discount_amount REAL,
      total_amount REAL NOT NULL,
      bill_status TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      billed_bill_id INTEGER,
      canonical_source_key TEXT
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      receipt_no TEXT NOT NULL,
      received_by TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      external_transaction_id TEXT,
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
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT
    );
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      billing_status TEXT,
      discount_by_name TEXT,
      discount_amount REAL,
      final_fee REAL,
      discount_reason TEXT,
      updated_at TEXT
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
        json_object('billId', NEW.id, 'source', 'db_trigger'),
        COALESCE(CAST(NEW.created_by AS TEXT), 'system')
      );
    END;
  `);
  const db = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
  };
  return { sqlite, db };
}

function seedCanonicalAppointmentService(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links(
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('100','ptl-501',501,'unlinked','unverified','no_link_placeholder',
      ?,'2026-07-23T00:00:00.000Z',1)
  `).run('a'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_encounters(
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,started_at_utc,source_kind,
      source_evidence_sha256
    ) VALUES ('100','enc-601',501,'ptl-501','outpatient','in_progress',1,
      '2026-07-23T03:00:00.000Z','runtime',?)
  `).run('b'.repeat(64));
  sqlite.exec(`
    INSERT INTO canonical_practitioners(
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('100','practitioner-101','internal','Doctor A','active');
    INSERT INTO doctors(id,tenant_id,canonical_source_key)
    VALUES (101,'100',NULL);
    INSERT INTO canonical_source_mappings(
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('100','practitioner','practitioner-101','legacy_doctor','101','doctors','mapped',1,lower(hex(randomblob(32)))),
      ('100','encounter','enc-601','legacy_visit','601','visits','mapped',1,lower(hex(randomblob(32))));
  `);
}

function input(overrides: Partial<AppointmentLegacyFinalizationInput> = {}): AppointmentLegacyFinalizationInput {
  const base: AppointmentLegacyFinalizationInput = {
    tenantId: '100',
    userId: '9',
    appointmentId: 77,
    expectedBillingStatus: 'unpaid',
    billingStatus: 'paid',
    patientId: 501,
    visitId: 601,
    invoiceNo: 'INV-A-1',
    categoryTotals: calculateBillCategoryTotals([{ category: 'doctor_visit', amount: 1000 }]),
    discount: 0,
    discountByName: null,
    total: 1000,
    paid: 1000,
    due: 0,
    billStatus: 'paid',
    paymentMethod: 'cash',
    remarks: null,
    counterId: 3,
    counterSessionId: 30,
    paymentReceiptNo: 'RCP-A-1',
    externalTransactionId: null,
    businessDate: '2026-07-23',
    occurredAtUtc: '2026-07-23T04:00:00.000Z',
    items: [{
      id: 901,
      itemCategory: 'doctor_visit',
      description: 'Consultation - Dr. A',
      quantity: 1,
      unitPrice: 1000,
      discountAmount: 0,
      lineTotal: 1000,
      referenceId: 101,
      doctorId: 101,
      canonicalSourceKey: 'appointment-service:77:901',
    }],
    schemeDiscount: null,
    schemeAllocation: null,
    accountingExtraPayload: { doctorId: 101 },
  };
  return { ...base, ...overrides, items: overrides.items ?? base.items };
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

describe('appointment guarded legacy finalization', () => {
  it('keeps the production-trigger legacy batch untouched and restores old post-commit events', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare("INSERT INTO appointments (id,tenant_id,billing_status) VALUES (77,'100','unpaid')").run();
      sqlite.prepare("INSERT INTO billing_provisional_items (id,tenant_id,patient_id,appointment_id,unit_price,quantity,discount_amount,total_amount,bill_status,is_active) VALUES (901,'100',501,77,1000,1,0,1000,'provisional',1)").run();

      const statements = prepareAppointmentBillingLegacyStatements(
        db as unknown as D1Database,
        input(),
      ) as D1PreparedStatement[] & {
        legacyPostCommit?: () => Promise<void>;
        strictAuthoritativeStatements?: () => Promise<readonly D1PreparedStatement[]>;
      };
      const sql = (statements as unknown as Statement[]).map((statement) => statement.sql).join('\n');
      expect(sql).not.toMatch(/canonical_financial_batch_assertions|accounting_posting_events|changes\(\)/i);
      expect(typeof statements.strictAuthoritativeStatements).toBe('function');
      expect(Object.keys(statements)).not.toContain('strictAuthoritativeStatements');

      await runBatch(sqlite, statements);
      await statements.legacyPostCommit?.();

      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'accounting_posting_events')).toBe(2);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare("SELECT billing_status FROM appointments WHERE id=77").get())
        .toMatchObject({ billing_status: 'paid' });
      expect(sqlite.prepare("SELECT canonical_source_key FROM billing_provisional_items WHERE id=901").get())
        .toEqual({ canonical_source_key: 'appointment-service:77:901' });
    } finally {
      sqlite.close();
    }
  });

  it('commits appointment finance and accepted consultation service evidence in one strict batch', async () => {
    const { sqlite, db } = harness();
    try {
      seedCanonicalAppointmentService(sqlite);
      sqlite.prepare("INSERT INTO appointments (id,tenant_id,billing_status) VALUES (77,'100','unpaid')").run();
      sqlite.prepare("INSERT INTO billing_provisional_items (id,tenant_id,patient_id,appointment_id,unit_price,quantity,discount_amount,total_amount,bill_status,is_active) VALUES (901,'100',501,77,1000,1,0,1000,'provisional',1)").run();

      const legacy = prepareAppointmentBillingLegacyStatements(
        db as unknown as D1Database,
        input(),
      ) as D1PreparedStatement[] & {
        strictAuthoritativeStatements?: () => Promise<readonly D1PreparedStatement[]>;
      };
      const statements = await legacy.strictAuthoritativeStatements?.();
      expect(statements).toBeDefined();
      await runBatch(sqlite, statements ?? []);

      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'canonical_service_requests')).toBe(1);
      expect(count(sqlite, 'canonical_service_events')).toBe(1);
      expect(count(sqlite, 'canonical_service_participants')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(2);
      expect(sqlite.prepare(`
        SELECT encounter_public_id,status,fulfilled_quantity
        FROM canonical_service_requests
      `).get()).toEqual({
        encounter_public_id: 'enc-601',
        status: 'active',
        fulfilled_quantity: 0,
      });
      expect(sqlite.prepare(`
        SELECT event_type,status,quantity,encounter_public_id
        FROM canonical_service_events
      `).get()).toEqual({
        event_type: 'accepted',
        status: 'posted',
        quantity: 1,
        encounter_public_id: 'enc-601',
      });
      expect(sqlite.prepare(`
        SELECT bill_status,canonical_source_key
        FROM billing_provisional_items WHERE id=901
      `).get()).toEqual({
        bill_status: 'finalized',
        canonical_source_key: 'appointment-service:77:901',
      });
    } finally {
      sqlite.close();
    }
  });

  it('commits the complete bill, payment, appointment, and accounting transition', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare("INSERT INTO appointments (id,tenant_id,billing_status) VALUES (77,'100','unpaid')").run();
      sqlite.prepare("INSERT INTO billing_provisional_items (id,tenant_id,patient_id,appointment_id,unit_price,quantity,discount_amount,total_amount,bill_status,is_active) VALUES (901,'100',501,77,1000,1,0,1000,'provisional',1)").run();

      const statements = prepareAppointmentBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await runBatch(sqlite, statements);

      expect(count(sqlite, 'bills')).toBe(1);
      expect(count(sqlite, 'invoice_items')).toBe(1);
      expect(count(sqlite, 'payments')).toBe(1);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(1);
      expect(count(sqlite, 'accounting_posting_events')).toBe(2);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
      expect(sqlite.prepare("SELECT billing_status FROM appointments WHERE id=77").get())
        .toMatchObject({ billing_status: 'paid' });
      expect(sqlite.prepare("SELECT bill_status,billed_bill_id,canonical_source_key FROM billing_provisional_items WHERE id=901").get())
        .toMatchObject({
          bill_status: 'finalized',
          billed_bill_id: 1,
          canonical_source_key: 'appointment-service:77:901',
        });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back all financial rows when appointment status changed concurrently', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare("INSERT INTO appointments (id,tenant_id,billing_status) VALUES (77,'100','paid')").run();
      sqlite.prepare("INSERT INTO billing_provisional_items (id,tenant_id,patient_id,appointment_id,unit_price,quantity,discount_amount,total_amount,bill_status,is_active) VALUES (901,'100',501,77,1000,1,0,1000,'provisional',1)").run();

      const statements = prepareAppointmentBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);

      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'emp_cash_transactions')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
      expect(sqlite.prepare("SELECT billing_status FROM appointments WHERE id=77").get())
        .toMatchObject({ billing_status: 'paid' });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the bill when a provisional item was already finalized', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare("INSERT INTO appointments (id,tenant_id,billing_status) VALUES (77,'100','unpaid')").run();
      sqlite.prepare("INSERT INTO billing_provisional_items (id,tenant_id,patient_id,appointment_id,unit_price,quantity,discount_amount,total_amount,bill_status,is_active) VALUES (901,'100',501,77,1000,1,0,1000,'finalized',1)").run();

      const statements = prepareAppointmentBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);

      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when provisional financial values changed after the route snapshot', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare("INSERT INTO appointments (id,tenant_id,billing_status) VALUES (77,'100','unpaid')").run();
      sqlite.prepare("INSERT INTO billing_provisional_items (id,tenant_id,patient_id,appointment_id,unit_price,quantity,discount_amount,total_amount,bill_status,is_active) VALUES (901,'100',501,77,900,1,0,900,'provisional',1)").run();

      const statements = prepareAppointmentBillingStrictStatements(
        db as unknown as D1Database,
        input(),
      );
      await expect(runBatch(sqlite, statements)).rejects.toThrow(/assertion_value|CHECK constraint/i);

      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'accounting_posting_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

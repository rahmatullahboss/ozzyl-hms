import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  executeTenant100FinancialSmokeFixture,
  type Tenant100FinancialSmokeFixtureInput,
} from '../../src/lib/canonical/tenant-100-financial-smoke-fixture';

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
    try {
      const before = this.sqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
      this.sqlite.prepare(this.sql).run(...this.params);
      const after = this.sqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
      return { changes: Number(after.count) - Number(before.count) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SQL failed (${this.params.length} params): ${message}\n${this.sql}`, { cause: error });
    }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function createHarness(options: {
  rejectCanonicalReceipt?: boolean;
  corruptFinalLegacyState?: boolean;
} = {}): {
  sqlite: DatabaseSync;
  db: CanonicalBatchDatabase;
  metrics: { batchCalls: number };
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL
    );
    INSERT INTO patients (id, tenant_id) VALUES (7, '100');

    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      invoice_no TEXT,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT NOT NULL DEFAULT 'open',
      tenant_id TEXT NOT NULL,
      created_by INTEGER,
      cancelled_by INTEGER,
      cancelled_at TEXT,
      cancel_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, invoice_no)
    );

    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      item_category TEXT NOT NULL,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      status TEXT DEFAULT 'active',
      cancelled_by INTEGER,
      cancelled_at TEXT,
      cancel_reason TEXT,
      tenant_id TEXT NOT NULL
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      amount REAL NOT NULL,
      payment_type TEXT CHECK(payment_type IN ('current','due')),
      receipt_no TEXT,
      idempotency_key TEXT,
      external_transaction_id TEXT,
      received_by INTEGER,
      payment_method TEXT,
      date TEXT DEFAULT CURRENT_TIMESTAMP,
      tenant_id TEXT NOT NULL,
      UNIQUE (tenant_id, receipt_no)
    );

    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      bill_id INTEGER REFERENCES bills(id),
      tenant_id TEXT NOT NULL,
      created_by INTEGER
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
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      UNIQUE (tenant_id, source_event_key)
    );

    CREATE TRIGGER trg_bills_insert_accounting_event
    AFTER INSERT ON bills
    FOR EACH ROW
    WHEN COALESCE(NEW.total,0) > 0
    BEGIN
      INSERT INTO accounting_posting_events (
        tenant_id,source_event_key,source_type,source_id,event_type,event_date,payload_json,created_by
      ) VALUES (
        NEW.tenant_id,
        'billing:' || NEW.id || ':bill_created',
        'billing',
        CAST(NEW.id AS TEXT),
        'bill_created',
        date(NEW.created_at),
        json_object('invoiceNo',NEW.invoice_no,'source','db_trigger'),
        COALESCE(CAST(NEW.created_by AS TEXT),'system')
      );
    END;

    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      adjustment_total_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      due_minor INTEGER NOT NULL,
      credited_minor INTEGER NOT NULL,
      net_due_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      posted_at_utc TEXT,
      cancelled_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id, invoice_public_id),
      UNIQUE (tenant_id, invoice_number)
    );

    CREATE TABLE canonical_invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      line_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      line_type TEXT NOT NULL,
      adjustment_code TEXT,
      quantity INTEGER NOT NULL,
      unit_amount_minor INTEGER NOT NULL,
      line_amount_minor INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      FOREIGN KEY (tenant_id, invoice_public_id)
        REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, line_public_id)
    );

    CREATE TABLE canonical_payment_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      allocated_total_minor INTEGER NOT NULL,
      unallocated_minor INTEGER NOT NULL,
      refunded_minor INTEGER NOT NULL,
      net_received_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      received_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      legacy_collector_id INTEGER,
      external_transaction_id TEXT,
      posted_at_utc TEXT,
      reversed_at_utc TEXT,
      reconciliation_guard INTEGER NOT NULL,
      refund_projection_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      ${options.rejectCanonicalReceipt ? "CHECK (receipt_public_id <> 'cdb-smoke-run-001-receipt')" : 'CHECK (total_minor > 0)'},
      UNIQUE (tenant_id, receipt_public_id),
      UNIQUE (tenant_id, receipt_number)
    );

    CREATE TABLE canonical_payment_tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_type TEXT NOT NULL,
      method_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      reversed_minor INTEGER NOT NULL,
      remaining_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      external_transaction_id TEXT,
      captured_at_utc TEXT,
      reversed_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      FOREIGN KEY (tenant_id, receipt_public_id)
        REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, tender_public_id)
    );

    CREATE TABLE canonical_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      reversed_minor INTEGER NOT NULL,
      remaining_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      allocated_at_utc TEXT NOT NULL,
      reversed_at_utc TEXT,
      balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      FOREIGN KEY (tenant_id, receipt_public_id)
        REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, invoice_public_id)
        REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, allocation_public_id)
    );

    CREATE TABLE canonical_payment_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      reversal_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      reason_code TEXT NOT NULL,
      status TEXT NOT NULL,
      reversed_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      allocation_reversed_before_minor INTEGER NOT NULL,
      allocation_reversed_after_minor INTEGER NOT NULL,
      tender_reversed_before_minor INTEGER NOT NULL,
      tender_reversed_after_minor INTEGER NOT NULL,
      receipt_refunded_before_minor INTEGER NOT NULL,
      receipt_refunded_after_minor INTEGER NOT NULL,
      invoice_paid_before_minor INTEGER NOT NULL,
      invoice_paid_after_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      invoice_net_due_before_minor INTEGER NOT NULL,
      invoice_net_due_after_minor INTEGER NOT NULL,
      compensation_guard INTEGER NOT NULL,
      balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      FOREIGN KEY (tenant_id, receipt_public_id)
        REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, tender_public_id)
        REFERENCES canonical_payment_tenders(tenant_id, tender_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, allocation_public_id)
        REFERENCES canonical_payment_allocations(tenant_id, allocation_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, invoice_public_id)
        REFERENCES canonical_invoices(tenant_id, invoice_public_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, reversal_public_id)
    );

    CREATE TABLE canonical_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      refund_public_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      payment_reversal_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      tender_type TEXT NOT NULL,
      method_code TEXT NOT NULL,
      status TEXT NOT NULL,
      refunded_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      liability_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      FOREIGN KEY (tenant_id, receipt_public_id)
        REFERENCES canonical_payment_receipts(tenant_id, receipt_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, tender_public_id)
        REFERENCES canonical_payment_tenders(tenant_id, tender_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, allocation_public_id)
        REFERENCES canonical_payment_allocations(tenant_id, allocation_public_id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, payment_reversal_public_id)
        REFERENCES canonical_payment_reversals(tenant_id, reversal_public_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, refund_public_id)
    );
  `);

  if (options.corruptFinalLegacyState) {
    sqlite.exec(`
      CREATE TRIGGER corrupt_smoke_bill_after_cancel
      AFTER UPDATE OF status ON bills
      WHEN NEW.status='cancelled'
      BEGIN
        UPDATE bills SET due=999 WHERE id=NEW.id;
      END;
    `);
  }

  const metrics = { batchCalls: 0 };
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
      metrics.batchCalls += 1;
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

  return { sqlite, db, metrics };
}

function input(overrides: Partial<Tenant100FinancialSmokeFixtureInput> = {}): Tenant100FinancialSmokeFixtureInput {
  return {
    tenantId: '100',
    runId: 'run-001',
    patientId: 7,
    actorId: 11,
    amountMinor: 100,
    atUtc: '2026-07-19T01:00:00.000Z',
    businessDate: '2026-07-19',
    expectedWorkerVersionTag: 'cdb101-financial-smoke-fix-20260719-c1',
    actualWorkerVersionTag: 'cdb101-financial-smoke-fix-20260719-c1',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count);
}

describe('tenant-100 safe reversible financial smoke fixture', () => {
  it('atomically creates and reverses legacy plus canonical facts, then removes every fixture row', async () => {
    const { sqlite, db, metrics } = createHarness();
    try {
      const result = await executeTenant100FinancialSmokeFixture(db, input());

      expect(metrics.batchCalls).toBe(1);
      expect(result).toMatchObject({
        tenantId: '100',
        runId: 'run-001',
        candidateVersionBound: true,
        lifecycleVerified: true,
        cleanupVerified: true,
        patientRowsCreated: 0,
        legacyRemainingRows: 0,
        canonicalRemainingRows: 0,
        accountingRemainingRows: 0,
      });
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
    } finally {
      sqlite.close();
    }
  });

  it('fails before writes unless tenant and exact candidate Worker version are bound', async () => {
    const { sqlite, db } = createHarness();
    try {
      await expect(executeTenant100FinancialSmokeFixture(db, input({ tenantId: '101' as '100' })))
        .rejects.toThrow(/tenant 100/i);
      await expect(executeTenant100FinancialSmokeFixture(db, input({ actualWorkerVersionTag: 'baseline-version' })))
        .rejects.toThrow(/Worker version/i);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails before writes and preserves orphan fixture markers from a reused runId', async () => {
    const { sqlite, db, metrics } = createHarness();
    try {
      sqlite.prepare(`
        INSERT INTO income (date,source,amount,description,bill_id,tenant_id,created_by)
        VALUES ('2026-07-19','other',1,'cdb-smoke-run-001:payment',NULL,'100',11)
      `).run();

      await expect(executeTenant100FinancialSmokeFixture(db, input()))
        .rejects.toThrow(/collides|already exists/i);
      expect(metrics.batchCalls).toBe(0);
      expect(count(sqlite, 'income')).toBe(1);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back legacy writes when a canonical insert fails inside the lifecycle batch', async () => {
    const { sqlite, db } = createHarness({ rejectCanonicalReceipt: true });
    try {
      await expect(executeTenant100FinancialSmokeFixture(db, input()))
        .rejects.toThrow(/CHECK constraint failed/);
      expect(count(sqlite, 'bills')).toBe(0);
      expect(count(sqlite, 'invoice_items')).toBe(0);
      expect(count(sqlite, 'payments')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects a corrupted reversal lifecycle while still removing every synthetic row', async () => {
    const { sqlite, db } = createHarness({ corruptFinalLegacyState: true });
    try {
      await expect(executeTenant100FinancialSmokeFixture(db, input()))
        .rejects.toThrow(/atomic batch invariant failed/i);
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
    } finally {
      sqlite.close();
    }
  });
});

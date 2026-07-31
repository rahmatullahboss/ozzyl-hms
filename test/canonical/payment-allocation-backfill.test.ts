import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillPayments,
  type PaymentBackfillDatabase,
  type PaymentBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-payments';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PaymentBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function adapter(
  sqlite: DatabaseSync,
  controls: { failNextPaymentBatch?: boolean } = {},
): PaymentBackfillDatabase {
  return {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          results.push(await statements[index].run());
          if (
            controls.failNextPaymentBatch
            && statements.some((statement) => (statement as Statement).sql.includes('canonical_payment_receipts'))
            && index === 0
          ) {
            controls.failNextPaymentBatch = false;
            throw new Error('synthetic payment batch failure');
          }
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fixture(controls: { failNextPaymentBatch?: boolean } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT,
      settlement_type_id INTEGER,
      receipt_no TEXT,
      idempotency_key TEXT,
      external_transaction_id TEXT,
      received_by INTEGER,
      payment_method TEXT,
      counter_id INTEGER,
      counter_session_id INTEGER,
      date TEXT,
      tenant_id TEXT NOT NULL
    );
  `);
  return { sqlite, db: adapter(sqlite, controls) };
}

function seedInvoice(
  sqlite: DatabaseSync,
  input: {
    tenantId?: string;
    billId?: number;
    invoicePublicId?: string;
    invoiceNumber?: string;
    patientId?: number;
    totalMinor?: number;
  } = {},
): void {
  const tenantId = input.tenantId ?? '1';
  const billId = input.billId ?? 1;
  const invoicePublicId = input.invoicePublicId ?? `inv-${billId}`;
  const invoiceNumber = input.invoiceNumber ?? `INV-${billId}`;
  const patientId = input.patientId ?? 10;
  const totalMinor = input.totalMinor ?? 10000;
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?, 'BDT',?,0,?,0,?,0,?,1,'posted',?,?,?)
  `).run(
    tenantId,
    invoicePublicId,
    invoiceNumber,
    patientId,
    totalMinor,
    totalMinor,
    totalMinor,
    totalMinor,
    '2026-07-01T03:00:00.000Z',
    '2026-07-01T03:00:00.000Z',
    'a'.repeat(64),
  );
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'invoice',?,'legacy_bill',?,'bills','mapped',1,?)
  `).run(tenantId, invoicePublicId, String(billId), 'b'.repeat(64));
}

const options = {
  tenantId: '1',
  runPublicId: 'run-payment-1',
  currencyCode: 'BDT',
  nowUtc: '2026-07-14T03:00:00.000Z',
};

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}${where}`).get() as { count: number }).count);
}

describe('canonical payment migration', () => {
  it('uses a triggerless remote-D1-compatible migration with atomic reconciliation guards', () => {
    const migration = readFileSync('migrations/0511_canonical_payments.sql', 'utf8');
    expect(migration).not.toContain('CREATE TRIGGER');
    expect(migration).toContain('reconciliation_guard INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('balance_guard INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('CHECK (reconciliation_guard = 1)');
    expect(migration).toContain('CHECK (balance_guard = 1)');
  });

  it('enforces row-local money, lifecycle, safe-integer, and tenant-scoped FK constraints', () => {
    const { sqlite } = fixture();
    seedInvoice(sqlite);
    try {
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,refunded_minor,net_received_minor,
          refund_projection_guard,source_evidence_sha256
        ) VALUES ('1','rcpt-invalid-total','R-INVALID',10,'BDT',10000,9000,0,'posted',
                  '2026-07-14T03:00:00.000Z','2026-07-14','2026-07-14T03:00:00.000Z',0,10000,1,?)
      `).run('c'.repeat(64))).toThrow(/CHECK constraint failed/);

      sqlite.prepare(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,refunded_minor,net_received_minor,
          refund_projection_guard,source_evidence_sha256
        ) VALUES ('1','rcpt-valid','R-VALID',10,'BDT',10000,10000,0,'posted',
                  '2026-07-14T03:00:00.000Z','2026-07-14','2026-07-14T03:00:00.000Z',0,10000,1,?)
      `).run('c'.repeat(64));
      sqlite.prepare(`
        INSERT INTO canonical_payment_tenders (
          tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
          amount_minor,status,captured_at_utc,reversed_minor,remaining_minor,
          reversal_projection_guard,source_evidence_sha256
        ) VALUES ('1','tender-valid','rcpt-valid','cash','cash',10000,'captured',
                  '2026-07-14T03:00:00.000Z',0,10000,1,?)
      `).run('d'.repeat(64));
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
          amount_minor,status,allocated_at_utc,invoice_due_before_minor,
          invoice_due_after_minor,reversed_minor,remaining_minor,
          reversal_projection_guard,source_evidence_sha256
        ) VALUES ('1','alloc-cross-tenant','rcpt-valid','missing-invoice',10000,'active',
                  '2026-07-14T03:00:00.000Z',10000,0,0,10000,1,?)
      `).run('e'.repeat(64))).toThrow(/FOREIGN KEY constraint failed/);
      expect(count(sqlite, 'pragma_foreign_key_check')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('keeps SQL and Drizzle parity for tenant-scoped payment authorities and invoice-line allocation keys', () => {
    const migration = readFileSync('migrations/0511_canonical_payments.sql', 'utf8');
    const drizzle = readFileSync('src/db/schema/canonical/billing.ts', 'utf8');
    for (const table of [
      'canonical_payment_receipts',
      'canonical_payment_tenders',
      'canonical_payment_allocations',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(drizzle).toContain(`'${table}'`);
    }
    expect(migration).toContain('uq_canonical_invoice_lines_invoice_line');
    expect(drizzle).toContain('uq_canonical_invoice_lines_invoice_line');
    expect(migration).toContain('fk_canonical_payment_allocations_invoice_line');
    expect(drizzle).toContain('fk_canonical_payment_allocations_invoice_line');
  });
});

describe('canonical payment backfill', () => {
  it('backfills a deterministic one-bill payment into one exact receipt, tender, and allocation', async () => {
    const { sqlite, db } = fixture();
    seedInvoice(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES (1,'1',10,100,100,0,'paid','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO payments VALUES (
        1,1,100,'bill_payment',NULL,'R-1','legacy-pay-1',NULL,7,'cash',3,9,
        '2026-07-01 09:30:00','1'
      );
    `);
    try {
      expect(await backfillPayments(db, options)).toEqual({
        completed: true,
        counts: {
          scanned: 1,
          receiptsCreated: 1,
          tendersCreated: 1,
          allocationsCreated: 1,
          mappingsCreated: 3,
          issuesCreated: 0,
        },
      });
      expect(sqlite.prepare(`
        SELECT receipt_number,total_minor,allocated_total_minor,unallocated_minor,status
        FROM canonical_payment_receipts
      `).get()).toEqual({
        receipt_number: 'R-1',
        total_minor: 10000,
        allocated_total_minor: 10000,
        unallocated_minor: 0,
        status: 'posted',
      });
      expect(sqlite.prepare(`SELECT tender_type,amount_minor,status FROM canonical_payment_tenders`).get()).toEqual({
        tender_type: 'cash',
        amount_minor: 10000,
        status: 'captured',
      });
      expect(sqlite.prepare(`SELECT invoice_public_id,amount_minor,status FROM canonical_payment_allocations`).get()).toEqual({
        invoice_public_id: 'inv-1',
        amount_minor: 10000,
        status: 'active',
      });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
        paid_minor: 10000,
        due_minor: 0,
      });
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type IN ('payment_receipt','payment_tender','payment_allocation')")).toBe(3);
      expect(count(sqlite, 'canonical_processing_issues', " WHERE issue_type='payment_backfill'")).toBe(0);

      const replay = await backfillPayments(db, options);
      expect(replay).toEqual({
        completed: true,
        counts: {
          scanned: 0,
          receiptsCreated: 0,
          tendersCreated: 0,
          allocationsCreated: 0,
          mappingsCreated: 0,
          issuesCreated: 0,
        },
      });
    } finally { sqlite.close(); }
  });

  it('classifies duplicate receipt groups without creating guessed multi-bill allocations', async () => {
    const { sqlite, db } = fixture();
    seedInvoice(sqlite, { billId: 1, invoicePublicId: 'inv-1', invoiceNumber: 'INV-1' });
    seedInvoice(sqlite, { billId: 2, invoicePublicId: 'inv-2', invoiceNumber: 'INV-2' });
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00'),
        (2,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO payments VALUES
        (1,1,50,'settlement',1,'SET-1','settlement-1',NULL,7,'cash',3,9,'2026-07-01 09:30:00','1'),
        (2,2,50,'settlement',1,'SET-1','settlement-1',NULL,7,'cash',3,9,'2026-07-01 09:30:00','1');
    `);
    try {
      const result = await backfillPayments(db, options);
      expect(result.counts).toMatchObject({ scanned: 2, receiptsCreated: 0, tendersCreated: 0, allocationsCreated: 0 });
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(sqlite.prepare(`
        SELECT issue_code,COUNT(*) issue_rows
        FROM canonical_processing_issues
        WHERE issue_type='payment_backfill'
        GROUP BY issue_code
      `).get()).toEqual({ issue_code: 'PAYMENT_DUPLICATE_RECEIPT_GROUP', issue_rows: 2 });
      expect(sqlite.prepare(`
        SELECT entity_type,mapping_status,canonical_public_id,COUNT(*) count
        FROM canonical_source_mappings
        WHERE entity_type IN ('payment_receipt','payment_tender','payment_allocation')
        GROUP BY entity_type,mapping_status,canonical_public_id
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'payment_allocation', mapping_status: 'ambiguous', canonical_public_id: null, count: 2 },
        { entity_type: 'payment_receipt', mapping_status: 'ambiguous', canonical_public_id: null, count: 2 },
        { entity_type: 'payment_tender', mapping_status: 'ambiguous', canonical_public_id: null, count: 2 },
      ]);
    } finally { sqlite.close(); }
  });

  it('classifies duplicate receipt numbers even when stronger legacy identifiers differ', async () => {
    const { sqlite, db } = fixture();
    seedInvoice(sqlite, { billId: 1, invoicePublicId: 'inv-1', invoiceNumber: 'INV-1' });
    seedInvoice(sqlite, { billId: 2, invoicePublicId: 'inv-2', invoiceNumber: 'INV-2' });
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00'),
        (2,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO payments VALUES
        (1,1,50,'bill_payment',NULL,'R-SHARED','idempotency-a','external-a',7,'cash',3,9,'2026-07-01 09:30:00','1'),
        (2,2,50,'bill_payment',NULL,'R-SHARED','idempotency-b','external-b',7,'cash',3,9,'2026-07-01 09:31:00','1');
    `);
    try {
      await backfillPayments(db, options);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(sqlite.prepare(`
        SELECT issue_code,COUNT(*) issue_rows
        FROM canonical_processing_issues
        WHERE issue_type='payment_backfill'
        GROUP BY issue_code
      `).get()).toEqual({ issue_code: 'PAYMENT_DUPLICATE_RECEIPT_GROUP', issue_rows: 2 });
    } finally { sqlite.close(); }
  });

  it('defers deposits, credits, refunds, and reversals to CDB-061 instead of creating allocations', async () => {
    const { sqlite, db } = fixture();
    seedInvoice(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES (1,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO payments VALUES (
        1,1,50,'deposit',NULL,'R-DEPOSIT',NULL,NULL,7,'cash',3,9,
        '2026-07-01 09:30:00','1'
      );
    `);
    try {
      await backfillPayments(db, options);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE issue_type='payment_backfill'
      `).get()).toEqual({ issue_code: 'PAYMENT_SCOPE_DEFERRED_CDB061' });
    } finally { sqlite.close(); }
  });

  it('classifies missing invoice authority and unsupported payment methods with stable evidence', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00'),
        (2,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO payments VALUES
        (1,1,50,'bill_payment',NULL,'R-1',NULL,NULL,7,'cash',3,9,'2026-07-01 09:30:00','1'),
        (2,2,50,'bill_payment',NULL,'R-2',NULL,NULL,7,'crypto',3,9,'2026-07-01 09:30:00','1');
    `);
    seedInvoice(sqlite, { billId: 2, invoicePublicId: 'inv-2', invoiceNumber: 'INV-2' });
    try {
      await backfillPayments(db, options);
      expect(sqlite.prepare(`
        SELECT issue_code,COUNT(*) issue_rows
        FROM canonical_processing_issues
        WHERE issue_type='payment_backfill'
        GROUP BY issue_code
        ORDER BY issue_code
      `).all()).toEqual([
        { issue_code: 'PAYMENT_INVOICE_UNRESOLVED', issue_rows: 1 },
        { issue_code: 'PAYMENT_METHOD_UNRESOLVED', issue_rows: 1 },
      ]);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE evidence_sha256 IS NULL AND entity_type LIKE 'payment_%'")).toBe(0);
      expect(count(sqlite, 'pragma_foreign_key_check')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rolls back failed source batches and resumes without duplicate rows', async () => {
    const controls = { failNextPaymentBatch: true };
    const { sqlite, db } = fixture(controls);
    seedInvoice(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES (1,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO payments VALUES (
        1,1,50,'bill_payment',NULL,'R-1',NULL,NULL,7,'cash',3,9,'2026-07-01 09:30:00','1'
      );
    `);
    try {
      await expect(backfillPayments(db, options)).rejects.toThrow(/synthetic payment batch failure/);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type LIKE 'payment_%'")).toBe(0);
      expect(sqlite.prepare(`SELECT cursor_value FROM canonical_backfill_checkpoints WHERE entity_type='payment_receipt'`).get()).toEqual({ cursor_value: null });

      const resumed = await backfillPayments(db, options);
      expect(resumed.counts).toMatchObject({ receiptsCreated: 1, tendersCreated: 1, allocationsCreated: 1 });
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(1);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('rejects failed terminal run reuse and source-evidence drift', async () => {
    const { sqlite, db } = fixture();
    sqlite.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
      ) VALUES ('1','run-failed','0511_canonical_payments.sql','backfill','failed',?,?,?,?)
    `).run(options.nowUtc, options.nowUtc, options.nowUtc, options.nowUtc);
    try {
      await expect(backfillPayments(db, { ...options, runPublicId: 'run-failed' }))
        .rejects.toThrow(/terminal: failed/);

      sqlite.exec(`
        INSERT INTO bills VALUES (1,'1',10,100,0,100,'open','2026-07-01 09:00:00','2026-07-01 10:00:00');
        INSERT INTO payments VALUES (
          1,1,50,'bill_payment',NULL,'R-1',NULL,NULL,7,'cash',3,9,'2026-07-01 09:30:00','1'
        );
      `);
      await backfillPayments(db, options);
      sqlite.prepare(`UPDATE payments SET amount=60 WHERE id=1`).run();
      await expect(backfillPayments(db, {
        ...options,
        runPublicId: 'run-payment-drift',
        nowUtc: '2026-07-14T03:01:00.000Z',
      })).rejects.toThrow(/evidence drift/i);
    } finally { sqlite.close(); }
  });
});

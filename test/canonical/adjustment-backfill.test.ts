import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillAdjustments,
  type AdjustmentBackfillDatabase,
  type AdjustmentBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-adjustments';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements AdjustmentBackfillPreparedStatement {
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

  async all<T = Record<string, unknown>>() {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function fixture(controls: { failBatch?: number } = {}) {
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
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      payment_method TEXT,
      remarks TEXT,
      reference_bill_id INTEGER,
      counter_id INTEGER,
      counter_session_id INTEGER,
      is_active INTEGER,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE billing_credit_notes (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      credit_note_no TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      total_amount REAL NOT NULL,
      refund_amount REAL NOT NULL,
      payment_mode TEXT,
      remarks TEXT,
      counter_id INTEGER,
      counter_session_id INTEGER,
      status TEXT,
      approved_by INTEGER,
      approved_at TEXT,
      is_active INTEGER,
      created_by INTEGER,
      created_at TEXT
    );
    CREATE TABLE billing_credit_note_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      credit_note_id INTEGER NOT NULL,
      invoice_item_id INTEGER NOT NULL,
      item_name TEXT,
      unit_price REAL,
      return_quantity INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      remarks TEXT,
      created_at TEXT
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      credit_note_id INTEGER,
      held_at TEXT NOT NULL,
      consumed_at TEXT,
      released_at TEXT,
      resolved_by INTEGER,
      resolution_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE diagnostic_performer_reserves (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE doctor_commission_accruals (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      status TEXT NOT NULL
    );
  `);

  let batchNumber = 0;
  const db: AdjustmentBackfillDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      batchNumber += 1;
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        if (controls.failBatch === batchNumber) throw new Error('synthetic adjustment batch failure');
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

function seedReceipt(sqlite: DatabaseSync, sourceDepositId = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,refunded_minor,net_received_minor,
      refund_projection_guard,reconciliation_guard,source_evidence_sha256
    ) VALUES ('1','receipt-deposit-1','R-DEP-1',10,'BDT',10000,0,10000,'posted',
              '2026-07-01T03:00:00.000Z','2026-07-01','2026-07-01T03:00:00.000Z',
              0,10000,1,1,?)
  `).run('a'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('1','payment_receipt','receipt-deposit-1','legacy_billing_deposit',?,
              'billing_deposits','mapped',1,?)
  `).run(String(sourceDepositId), 'b'.repeat(64));
}

function seedInvoice(sqlite: DatabaseSync, billId = 11, itemId = 101): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('1','inv-11','INV-11',10,'BDT',10000,0,10000,0,10000,0,10000,1,
              'posted','2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z',?)
  `).run('c'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,adjustment_code,
      quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('1','inv-line-101','inv-11','other_adjustment','LEGACY',1,10000,10000,?)
  `).run('d'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('1','invoice','inv-11','legacy_bill',?,'bills','mapped',1,?),
      ('1','invoice_line','inv-line-101','legacy_invoice_item',?,'invoice_items','mapped',1,?)
  `).run(String(billId), 'e'.repeat(64), String(itemId), 'f'.repeat(64));
}

function seedValidSources(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO billing_deposits VALUES
      (1,'1',10,'DEP-1',100,'deposit','cash',NULL,NULL,1,2,1,7,'2026-07-01 09:00:00',NULL);
    INSERT INTO billing_credit_notes VALUES
      (21,'1','CN-21',11,10,'service correction',20,0,NULL,NULL,1,2,'approved',7,
       '2026-07-01 10:00:00',1,7,'2026-07-01 10:00:00');
    INSERT INTO billing_credit_note_items VALUES
      (31,'1',21,101,'Synthetic',20,1,20,NULL,'2026-07-01 10:00:00');
  `);
}

const options = {
  tenantId: '1',
  runPublicId: 'adjustment-run-1',
  currencyCode: 'BDT',
  nowUtc: '2026-07-14T03:00:00.000Z',
};

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}${where}`).get() as { count: number }).count);
}

describe('canonical adjustment backfill', () => {
  it('creates exact deposit and credit authorities only from fully mapped evidence', async () => {
    const { sqlite, db } = fixture();
    seedReceipt(sqlite);
    seedInvoice(sqlite);
    seedValidSources(sqlite);
    try {
      const result = await backfillAdjustments(db, options);
      expect(result).toMatchObject({
        completed: true,
        counts: {
          scanned: 2,
          depositsCreated: 1,
          creditNotesCreated: 1,
          creditLinesCreated: 1,
          refundsCreated: 0,
          reversalsCreated: 0,
          issuesCreated: 0,
        },
      });
      expect(sqlite.prepare(`SELECT amount_minor,applied_minor,refunded_minor,available_minor FROM canonical_deposits`).get()).toEqual({
        amount_minor: 10000,
        applied_minor: 0,
        refunded_minor: 0,
        available_minor: 10000,
      });
      expect(sqlite.prepare(`SELECT total_minor,credited_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='inv-11'`).get()).toEqual({
        total_minor: 10000,
        credited_minor: 2000,
        net_due_minor: 8000,
      });
      expect(count(sqlite, 'canonical_credit_note_lines')).toBe(1);
      expect((await backfillAdjustments(db, options)).counts).toMatchObject({
        scanned: 0,
        depositsCreated: 0,
        creditNotesCreated: 0,
        creditLinesCreated: 0,
        mappingsCreated: 0,
        issuesCreated: 0,
      });
    } finally { sqlite.close(); }
  });

  it('classifies unresolved deposit, credit, refund, and unsupported transaction evidence without guessing', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO billing_deposits VALUES
        (1,'1',10,'DEP-1',100,'deposit','cash',NULL,NULL,1,2,1,7,'2026-07-01 09:00:00',NULL),
        (2,'1',10,'DEP-2',25,'withdrawal','cash',NULL,NULL,1,2,1,7,'2026-07-01 09:30:00',NULL);
      INSERT INTO billing_credit_notes VALUES
        (21,'1','CN-21',11,10,'service correction',20,0,NULL,NULL,1,2,'approved',7,
         '2026-07-01 10:00:00',1,7,'2026-07-01 10:00:00');
      INSERT INTO billing_credit_note_items VALUES
        (31,'1',21,101,'Synthetic',20,1,20,NULL,'2026-07-01 10:00:00');
      INSERT INTO billing_refund_cash_holds VALUES
        (41,'1',501,11,10,5,'cash',7,1,2,'consumed','refund-key-1',21,
         '2026-07-01 11:00:00','2026-07-01 11:10:00',NULL,7,'approved',
         '2026-07-01 11:00:00','2026-07-01 11:10:00');
    `);
    try {
      const result = await backfillAdjustments(db, options);
      expect(result.counts).toMatchObject({ scanned: 4, depositsCreated: 0, creditNotesCreated: 0, refundsCreated: 0, reversalsCreated: 0 });
      expect(sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE issue_type='adjustment_backfill' ORDER BY issue_code
      `).all()).toEqual([
        { issue_code: 'CREDIT_NOTE_INVOICE_UNRESOLVED' },
        { issue_code: 'DEPOSIT_RECEIPT_UNRESOLVED' },
        { issue_code: 'DEPOSIT_TRANSACTION_TYPE_UNSUPPORTED' },
        { issue_code: 'REFUND_PAYMENT_AUTHORITY_UNRESOLVED' },
      ]);
      expect(count(sqlite, 'canonical_source_mappings', ` WHERE mapping_status='ambiguous' AND entity_type IN ('deposit','credit_note','credit_note_line','refund','payment_reversal')`)).toBe(6);
    } finally { sqlite.close(); }
  });

  it('blocks credit-note authority when performer or commission liability is already paid', async () => {
    const { sqlite, db } = fixture();
    seedInvoice(sqlite);
    sqlite.exec(`
      INSERT INTO billing_credit_notes VALUES
        (21,'1','CN-21',11,10,'service correction',20,0,NULL,NULL,1,2,'approved',7,
         '2026-07-01 10:00:00',1,7,'2026-07-01 10:00:00');
      INSERT INTO billing_credit_note_items VALUES
        (31,'1',21,101,'Synthetic',20,1,20,NULL,'2026-07-01 10:00:00');
      INSERT INTO diagnostic_performer_reserves VALUES ('1',11,'paid');
    `);
    try {
      await backfillAdjustments(db, options);
      expect(count(sqlite, 'canonical_credit_notes')).toBe(0);
      expect(sqlite.prepare(`SELECT issue_code FROM canonical_processing_issues`).get()).toEqual({
        issue_code: 'CREDIT_NOTE_COMPENSATION_SETTLED',
      });
    } finally { sqlite.close(); }
  });

  it('stops at a checkpoint limit and resumes duplicate-free', async () => {
    const { sqlite, db } = fixture();
    seedReceipt(sqlite);
    seedInvoice(sqlite);
    seedValidSources(sqlite);
    try {
      const first = await backfillAdjustments(db, { ...options, maxSourceRecords: 1 });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(1);
      const second = await backfillAdjustments(db, { ...options, maxSourceRecords: 10 });
      expect(second.completed).toBe(true);
      expect(second.counts.scanned).toBe(1);
      expect(count(sqlite, 'canonical_deposits')).toBe(1);
      expect(count(sqlite, 'canonical_credit_notes')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('rolls back a failed source batch and resumes from the prior checkpoint', async () => {
    const { sqlite, db } = fixture({ failBatch: 1 });
    seedReceipt(sqlite);
    sqlite.exec(`
      INSERT INTO billing_deposits VALUES
        (1,'1',10,'DEP-1',100,'deposit','cash',NULL,NULL,1,2,1,7,'2026-07-01 09:00:00',NULL);
    `);
    try {
      await expect(backfillAdjustments(db, options)).rejects.toThrow(/synthetic adjustment batch failure/);
      expect(count(sqlite, 'canonical_deposits')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', ` WHERE entity_type='deposit'`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rejects source-evidence drift and failed terminal run reuse', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO billing_deposits VALUES
        (1,'1',10,'DEP-1',100,'deposit','cash',NULL,NULL,1,2,1,7,'2026-07-01 09:00:00',NULL);
    `);
    try {
      await backfillAdjustments(db, options);
      sqlite.prepare(`UPDATE billing_deposits SET amount=101 WHERE id=1`).run();
      await expect(backfillAdjustments(db, { ...options, runPublicId: 'adjustment-run-2' })).rejects.toThrow(/evidence drift/i);

      sqlite.prepare(`
        INSERT INTO canonical_migration_runs (
          tenant_id,run_public_id,migration_name,migration_kind,status,
          started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
        ) VALUES ('1','adjustment-run-failed','0512_canonical_adjustments.sql','backfill','failed',?,?,?,?)
      `).run(options.nowUtc, options.nowUtc, options.nowUtc, options.nowUtc);
      await expect(backfillAdjustments(db, { ...options, runPublicId: 'adjustment-run-failed' })).rejects.toThrow(/terminal: failed/i);
    } finally { sqlite.close(); }
  });
});

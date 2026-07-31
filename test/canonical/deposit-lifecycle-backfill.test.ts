import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillDepositLifecycle,
  type DepositLifecycleDatabase,
  type DepositLifecyclePreparedStatement,
} from '../../scripts/canonical/backfill-deposit-lifecycle';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements DepositLifecyclePreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run(): Promise<unknown> {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function fixture(): { sqlite: DatabaseSync; db: DepositLifecycleDatabase } {
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
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,amount REAL NOT NULL,transaction_type TEXT NOT NULL,
      payment_method TEXT,remarks TEXT,reference_bill_id INTEGER,counter_id INTEGER,
      counter_session_id INTEGER,is_active INTEGER,created_by INTEGER,
      created_at TEXT,updated_at TEXT
    );
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,posted_at_utc,
      source_evidence_sha256,paid_minor,due_minor,credited_minor,net_due_minor,
      adjustment_projection_guard
    ) VALUES ('100','inv-1','INV-1',10,'BDT',30000,0,30000,'posted',
      '2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z',
      '${'a'.repeat(64)}',0,30000,0,30000,1);
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('100','invoice','inv-1','legacy_bill','1','bills','mapped',1,'${'b'.repeat(64)}');

    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,
      posted_at_utc,reconciliation_guard,source_evidence_sha256,refunded_minor,net_received_minor,
      refund_projection_guard
    ) VALUES
      ('100','r1','DEP-1',10,'BDT',10000,0,10000,'posted','2026-07-01T01:00:00.000Z','2026-07-01','2026-07-01T01:00:00.000Z',1,'${'c'.repeat(64)}',0,10000,1),
      ('100','r2','DEP-2',10,'BDT',20000,0,20000,'posted','2026-07-01T02:00:00.000Z','2026-07-01','2026-07-01T02:00:00.000Z',1,'${'d'.repeat(64)}',0,20000,1);
    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,amount_minor,status,
      captured_at_utc,source_evidence_sha256,reversed_minor,remaining_minor,reversal_projection_guard
    ) VALUES
      ('100','t1','r1','cash','cash',10000,'captured','2026-07-01T01:00:00.000Z','${'e'.repeat(64)}',0,10000,1),
      ('100','t2','r2','cash','cash',20000,'captured','2026-07-01T02:00:00.000Z','${'f'.repeat(64)}',0,20000,1);
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('100','payment_receipt','r1','legacy_billing_deposit','1','billing_deposits','mapped',1,'${'1'.repeat(64)}'),
      ('100','payment_tender','t1','legacy_billing_deposit','1','billing_deposits','mapped',1,'${'1'.repeat(64)}'),
      ('100','payment_receipt','r2','legacy_billing_deposit','2','billing_deposits','mapped',1,'${'2'.repeat(64)}'),
      ('100','payment_tender','t2','legacy_billing_deposit','2','billing_deposits','mapped',1,'${'2'.repeat(64)}');

    INSERT INTO billing_deposits VALUES
      (1,'100',10,'DEP-1',100,'deposit','cash',NULL,NULL,1,1,1,1,'2026-07-01 07:00:00','2026-07-01 07:00:00'),
      (2,'100',10,'DEP-2',200,'deposit','cash',NULL,NULL,1,1,1,1,'2026-07-01 08:00:00','2026-07-01 08:00:00'),
      (3,'100',10,'DAD-1',150,'adjustment','cash',NULL,1,1,1,1,1,'2026-07-01 09:00:00','2026-07-01 09:00:00'),
      (4,'100',10,'DRF-1',50,'refund','cash',NULL,NULL,1,1,1,1,'2026-07-01 10:00:00','2026-07-01 10:00:00');
  `);
  const db: DepositLifecycleDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
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
  return { sqlite, db };
}

describe('deposit lifecycle backfill', () => {
  it('reconstructs pooled legacy adjustments and refunds with deterministic FIFO fragments', async () => {
    const { sqlite, db } = fixture();
    try {
      const result = await backfillDepositLifecycle(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(result).toMatchObject({
        completed: true,depositsCreated: 2,applicationsCreated: 2,refundsCreated: 1,
        transactionsMapped: 2,reused: 0,
      });
      expect(sqlite.prepare(`
        SELECT deposit_number,amount_minor,applied_minor,refunded_minor,available_minor
        FROM canonical_deposits ORDER BY received_at_utc
      `).all()).toEqual([
        { deposit_number: 'DEP-1',amount_minor: 10000,applied_minor: 10000,refunded_minor: 0,available_minor: 0 },
        { deposit_number: 'DEP-2',amount_minor: 20000,applied_minor: 5000,refunded_minor: 5000,available_minor: 10000 },
      ]);
      expect(sqlite.prepare(`SELECT COUNT(*) count, SUM(amount_minor) total FROM canonical_deposit_applications`).get())
        .toEqual({ count: 2,total: 15000 });
      expect(sqlite.prepare(`SELECT COUNT(*) count, SUM(amount_minor) total FROM canonical_refunds`).get())
        .toEqual({ count: 1,total: 5000 });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get())
        .toEqual({ paid_minor: 15000,due_minor: 15000,net_due_minor: 15000 });
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status FROM canonical_source_mappings
        WHERE entity_type='deposit_lifecycle_transaction' ORDER BY source_public_id
      `).all()).toEqual([
        { source_public_id: '3',mapping_status: 'mapped' },
        { source_public_id: '4',mapping_status: 'mapped' },
      ]);

      const second = await backfillDepositLifecycle(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(second).toMatchObject({
        completed: true,depositsCreated: 0,applicationsCreated: 0,refundsCreated: 0,
        transactionsMapped: 0,reused: 4,
      });
    } finally { sqlite.close(); }
  });

  it('fails before partial writes when FIFO balance or invoice authority is insufficient', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`UPDATE billing_deposits SET amount=500 WHERE id=3`);
    try {
      await expect(backfillDepositLifecycle(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      })).rejects.toThrow(/insufficient/i);
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_deposit_applications`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_refunds`).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
});

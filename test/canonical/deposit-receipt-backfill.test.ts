import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillDepositReceipts,
  type DepositReceiptBackfillDatabase,
  type DepositReceiptPreparedStatement,
} from '../../scripts/canonical/backfill-deposit-receipts';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements DepositReceiptPreparedStatement {
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

function fixture(): { sqlite: DatabaseSync; db: DepositReceiptBackfillDatabase } {
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
  `);
  const db: DepositReceiptBackfillDatabase = {
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

describe('deposit receipt backfill', () => {
  it('creates an unallocated posted receipt and captured tender for an active deposit', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO billing_deposits VALUES
        (1,'100',10,'DEP-1',500,'deposit','Mobile Banking',NULL,NULL,7,8,1,9,'2026-07-01 09:00:00','2026-07-01 09:00:00');
    `);
    try {
      const result = await backfillDepositReceipts(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(result).toMatchObject({ completed: true, scanned: 1, receiptsCreated: 1, tendersCreated: 1, reused: 0 });
      expect(sqlite.prepare(`
        SELECT receipt_number,total_minor,allocated_total_minor,unallocated_minor,status,legacy_patient_id
        FROM canonical_payment_receipts
      `).get()).toEqual({
        receipt_number: 'DEP-1',total_minor: 50000,allocated_total_minor: 0,
        unallocated_minor: 50000,status: 'posted',legacy_patient_id: 10,
      });
      expect(sqlite.prepare(`
        SELECT tender_type,method_code,amount_minor,status FROM canonical_payment_tenders
      `).get()).toEqual({ tender_type: 'mobile_wallet',method_code: 'mobile_banking',amount_minor: 50000,status: 'captured' });
      expect(sqlite.prepare(`
        SELECT entity_type,mapping_status FROM canonical_source_mappings
        WHERE source_type='legacy_billing_deposit' ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'payment_receipt',mapping_status: 'mapped' },
        { entity_type: 'payment_tender',mapping_status: 'mapped' },
      ]);

      const second = await backfillDepositReceipts(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(second).toMatchObject({ completed: true, receiptsCreated: 0, tendersCreated: 0, reused: 1 });
    } finally { sqlite.close(); }
  });

  it('does not turn adjustment, refund, inactive, invalid, or duplicate receipt rows into deposits', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO billing_deposits VALUES
        (1,'100',10,'ADJ-1',100,'adjustment','cash',NULL,1,7,8,1,9,'2026-07-01 09:00:00','2026-07-01 09:00:00'),
        (2,'100',10,'REF-1',100,'refund','cash',NULL,NULL,7,8,1,9,'2026-07-01 09:00:00','2026-07-01 09:00:00'),
        (3,'100',10,'DEP-X',100,'deposit','cash',NULL,NULL,7,8,0,9,'2026-07-01 09:00:00','2026-07-01 09:00:00'),
        (4,'100',10,'DUP',100,'deposit','cash',NULL,NULL,7,8,1,9,'2026-07-01 09:00:00','2026-07-01 09:00:00'),
        (5,'100',10,'DUP',100,'deposit','cash',NULL,NULL,7,8,1,9,'2026-07-01 09:00:00','2026-07-01 09:00:00'),
        (6,'100',10,'BAD',0,'deposit','cash',NULL,NULL,7,8,1,9,'2026-07-01 09:00:00','2026-07-01 09:00:00');
    `);
    try {
      const result = await backfillDepositReceipts(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(result).toMatchObject({ completed: true, scanned: 6, receiptsCreated: 0, skipped: 4, ambiguous: 2 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_payment_receipts`).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
});

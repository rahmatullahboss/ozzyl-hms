import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillBillPaidResiduals,
  type BillPaidResidualDatabase,
  type BillPaidResidualPreparedStatement,
} from '../../scripts/canonical/backfill-bill-paid-residuals';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements BillPaidResidualPreparedStatement {
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

function fixture(): { sqlite: DatabaseSync; db: BillPaidResidualDatabase } {
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
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      invoice_no TEXT,invoice_code TEXT,total REAL NOT NULL,paid REAL,paid_amount REAL,
      due REAL,status TEXT,created_at TEXT,updated_at TEXT
    );
    INSERT INTO bills VALUES
      (1,'100',10,'INV-1','I1',300,300,300,0,'paid','2026-07-01 09:00:00','2026-07-01 10:00:00'),
      (2,'100',10,'INV-2','I2',100,0,0,100,'paid','2026-07-01 09:00:00','2026-07-01 10:00:00');
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,posted_at_utc,
      source_evidence_sha256,paid_minor,due_minor,credited_minor,net_due_minor,
      adjustment_projection_guard
    ) VALUES
      ('100','inv-1','INV-1',10,'BDT',30000,0,30000,'posted','2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z','${'a'.repeat(64)}',10000,20000,0,20000,1),
      ('100','inv-2','INV-2',10,'BDT',10000,0,10000,'posted','2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z','${'b'.repeat(64)}',5000,5000,0,5000,1);
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('100','invoice','inv-1','legacy_bill','1','bills','mapped',1,'${'c'.repeat(64)}'),
      ('100','invoice','inv-2','legacy_bill','2','bills','mapped',1,'${'d'.repeat(64)}');
  `);
  const db: BillPaidResidualDatabase = {
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

describe('bill paid residual backfill', () => {
  it('creates one explicit residual receipt and preserves verified payment over a stale due header', async () => {
    const { sqlite, db } = fixture();
    try {
      const result = await backfillBillPaidResiduals(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(result).toMatchObject({
        completed: true,billsScanned: 2,residualReceiptsCreated: 1,
        residualAllocationsCreated: 1,staleDueClassifications: 1,reused: 0,
      });
      expect(sqlite.prepare(`
        SELECT receipt_number,total_minor,allocated_total_minor,unallocated_minor,status
        FROM canonical_payment_receipts
      `).get()).toEqual({
        receipt_number: 'HIST-INV-1',total_minor: 20000,allocated_total_minor: 20000,
        unallocated_minor: 0,status: 'posted',
      });
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices ORDER BY invoice_number
      `).all()).toEqual([
        { paid_minor: 30000,due_minor: 0,net_due_minor: 0 },
        { paid_minor: 5000,due_minor: 5000,net_due_minor: 5000 },
      ]);
      expect(sqlite.prepare(`
        SELECT issue_code,status,resolution_code FROM canonical_processing_issues
        WHERE issue_type='bill_balance_reconciliation'
      `).get()).toEqual({
        issue_code: 'LEGACY_DUE_STALE_AGAINST_VERIFIED_PAYMENT',
        status: 'resolved',resolution_code: 'VERIFIED_PAYMENT_AUTHORITY_PRESERVED',
      });

      sqlite.prepare("UPDATE bills SET updated_at='2026-07-20 18:47:58' WHERE id=1").run();
      sqlite.prepare(`
        UPDATE canonical_source_mappings
        SET evidence_sha256=?
        WHERE tenant_id='100' AND entity_type='bill_balance_authority'
          AND source_type='legacy_bill_paid_residual' AND source_public_id='1'
      `).run('f'.repeat(64));
      const second = await backfillBillPaidResiduals(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(second).toMatchObject({
        completed: true,residualReceiptsCreated: 0,residualAllocationsCreated: 0,
        staleDueClassifications: 0,reused: 2,
      });

      sqlite.prepare(`
        UPDATE canonical_invoices
        SET paid_minor=25000,due_minor=5000,net_due_minor=5000
        WHERE tenant_id='100' AND invoice_public_id='inv-1'
      `).run();
      await expect(backfillBillPaidResiduals(db, {
        tenantId: '100',currencyCode: 'BDT',nowUtc: '2026-07-18T08:00:00.000Z',
      })).rejects.toThrow('Bill balance evidence drift detected for bill 1');
    } finally { sqlite.close(); }
  });
});

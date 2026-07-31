import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { projectLegacyBillPaymentHistory } from '../../src/lib/canonical/legacy-bill-payment-recovery';
import { createDeterministicSourceId } from '../../src/lib/canonical/source-mapping';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
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
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
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
      tenant_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT,
      total REAL NOT NULL,
      paid REAL NOT NULL DEFAULT 0,
      due REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax_total REAL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      item_category TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      tax_amount REAL,
      reference_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT,
      receipt_no TEXT,
      payment_method TEXT,
      received_by INTEGER,
      created_at TEXT NOT NULL,
      counter_id INTEGER,
      counter_session_id INTEGER,
      external_transaction_id TEXT
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_bill_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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

function seedLegacyPartialPayment(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO bills (
      id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
    ) VALUES (6788,102,2283,'INV-D-2026-000651',900,900,0,0,0,'paid','2026-07-20 18:05:43')
  `).run();
  sqlite.prepare(`
    INSERT INTO invoice_items (
      id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
    ) VALUES
      (2881,102,6788,'test',1,400,400,0,396,'active','2026-07-20 18:05:43'),
      (2882,102,6788,'test',1,500,500,0,244,'active','2026-07-20 18:05:43')
  `).run();
  sqlite.prepare(`
    INSERT INTO payments (
      id,tenant_id,bill_id,amount,payment_type,receipt_no,payment_method,received_by,
      created_at,counter_id,counter_session_id,external_transaction_id
    ) VALUES
      (1775,102,6788,400,'current','RCP-001545','cash',119,'2026-07-20 12:05:43',9,90,NULL),
      (1786,102,6788,500,'due','RCP-001555','cash',119,'2026-07-20 13:13:35',9,90,NULL)
  `).run();
}

describe('legacy bill payment recovery', () => {
  it('creates a missing canonical invoice and replays every legacy payment idempotently', async () => {
    const { sqlite, db } = harness();
    try {
      seedLegacyPartialPayment(sqlite);

      const first = await projectLegacyBillPaymentHistory(db, { tenantId: '102', billId: 6788 });
      const second = await projectLegacyBillPaymentHistory(db, { tenantId: '102', billId: 6788 });

      expect(first).toEqual({
        invoicePublicId: expect.stringMatching(/^inv_/),
        projectedReceiptCount: 2,
      });
      expect(second).toEqual(first);
      expect(sqlite.prepare(`
        SELECT total_minor,paid_minor,due_minor,net_due_minor
        FROM canonical_invoices WHERE tenant_id='102' AND invoice_number='INV-D-2026-000651'
      `).get()).toEqual({
        total_minor: 90000,
        paid_minor: 90000,
        due_minor: 0,
        net_due_minor: 0,
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count,COALESCE(SUM(total_minor),0) AS total_minor
        FROM canonical_payment_receipts WHERE tenant_id='102'
      `).get()).toEqual({ count: 2, total_minor: 90000 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count,COALESCE(SUM(amount_minor),0) AS amount_minor
        FROM canonical_payment_allocations WHERE tenant_id='102'
      `).get()).toEqual({ count: 2, amount_minor: 90000 });
      expect(sqlite.prepare(`
        SELECT entity_type,COUNT(*) AS count
        FROM canonical_source_mappings WHERE tenant_id='102'
          AND entity_type IN ('invoice','payment_receipt')
        GROUP BY entity_type ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'invoice', count: 1 },
        { entity_type: 'payment_receipt', count: 2 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('recovers discounted invoice lines with the live source identity and original gross authority', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO bills (
          id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
        ) VALUES (6790,102,2283,'INV-A-2026-000653',400,400,0,100,0,'paid','2026-07-22 16:00:00')
      `).run();
      sqlite.prepare(`
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
        ) VALUES (2890,102,6790,'doctor_visit',1,500,400,0,3,'active','2026-07-22 16:00:00')
      `).run();

      const result = await projectLegacyBillPaymentHistory(db, { tenantId: '102', billId: 6790 });
      const expectedLinePublicId = await createDeterministicSourceId(
        'invline',
        '102',
        'legacy_live_bill_line',
        'INV-A-2026-000653:1:doctor_visit:3',
      );

      expect(result.projectedReceiptCount).toBe(0);
      expect(sqlite.prepare(`
        SELECT line_public_id,line_type,adjustment_code,line_amount_minor
        FROM canonical_invoice_lines
        WHERE tenant_id='102' AND invoice_public_id=?
        ORDER BY CASE line_type WHEN 'other_adjustment' THEN 0 ELSE 1 END
      `).all(result.invoicePublicId)).toEqual([
        {
          line_public_id: expectedLinePublicId,
          line_type: 'other_adjustment',
          adjustment_code: 'LEGACY_DOCTOR_VISIT',
          line_amount_minor: 50000,
        },
        {
          line_public_id: expect.stringMatching(/^invline_/),
          line_type: 'discount',
          adjustment_code: 'LEGACY_DISCOUNT',
          line_amount_minor: -10000,
        },
      ]);
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor
        FROM canonical_invoices
        WHERE tenant_id='102' AND invoice_number='INV-A-2026-000653'
      `).get()).toEqual({
        subtotal_minor: 50000,
        adjustment_total_minor: -10000,
        total_minor: 40000,
      });
    } finally {
      sqlite.close();
    }
  });

  it('refuses to silently recover a bill that also has legacy deposit adjustments', async () => {
    const { sqlite, db } = harness();
    try {
      seedLegacyPartialPayment(sqlite);
      sqlite.prepare(`
        INSERT INTO billing_deposits (
          id,tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,
          reference_bill_id,is_active,created_at
        ) VALUES (1,102,2283,'DAD-1',100,'adjustment',6788,1,'2026-07-20 12:30:00')
      `).run();

      await expect(projectLegacyBillPaymentHistory(db, {
        tenantId: '102',
        billId: 6788,
      })).rejects.toThrow(/deposit adjustment/i);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_invoices').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_payment_receipts').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillInvoiceItemDeliveries,
  type InvoiceItemDeliveryDatabase,
  type InvoiceItemDeliveryPreparedStatement,
} from '../../scripts/canonical/backfill-invoice-item-deliveries';
import {
  backfillInvoices,
  type InvoiceBackfillDatabase,
} from '../../scripts/canonical/backfill-invoices';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements InvoiceItemDeliveryPreparedStatement {
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
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function adapter(database: DatabaseSync): InvoiceItemDeliveryDatabase & InvoiceBackfillDatabase {
  return {
    prepare(sql: string) {
      return new Statement(database, sql);
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results: unknown[] = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fixture(): { sqlite: DatabaseSync; db: InvoiceItemDeliveryDatabase & InvoiceBackfillDatabase } {
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
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      invoice_no TEXT, invoice_code TEXT, discount REAL, tax_total REAL,
      total REAL, status TEXT, cancelled_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, bill_id INTEGER NOT NULL,
      item_category TEXT, description TEXT, quantity INTEGER, unit_price INTEGER,
      line_total INTEGER, reference_id INTEGER, status TEXT, cancelled_at TEXT,
      tax_amount REAL, created_at TEXT
    );
    CREATE TABLE lab_order_items (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE radiology_requisitions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE procedure_orders (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE patient_bed_infos (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE prescription_items (id INTEGER PRIMARY KEY);
    CREATE TABLE prescriptions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE consultations (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
  `);
  return { sqlite, db: adapter(sqlite) };
}

describe('invoice-item historical delivery backfill', () => {
  it('creates retired catalog evidence and lets an otherwise untyped invoice reconcile', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'100',10,'INV-1','CODE-1',0,0,200,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'100',1,'medicine','Historical Medicine',2,100,200,NULL,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      const delivery = await backfillInvoiceItemDeliveries(db, {
        tenantId: '100',
        currencyCode: 'BDT',
        nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(delivery).toMatchObject({ completed: true, eventsCreated: 1, reused: 0 });
      expect(sqlite.prepare(`
        SELECT item_kind,status FROM canonical_service_catalog_items
      `).get()).toEqual({ item_kind: 'product', status: 'retired' });
      expect(sqlite.prepare(`
        SELECT event_type,quantity,status FROM canonical_service_events
      `).get()).toEqual({ event_type: 'dispensed', quantity: 2, status: 'posted' });

      const invoice = await backfillInvoices(db, {
        tenantId: '100',
        runPublicId: 'invoice-after-historical-event',
        currencyCode: 'BDT',
        nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(invoice.completed).toBe(true);
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_invoices`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`
        SELECT source_type,mapping_status FROM canonical_source_mappings
        WHERE entity_type='service_event'
      `).get()).toEqual({ source_type: 'legacy_invoice_item_delivery', mapping_status: 'mapped' });

      const second = await backfillInvoiceItemDeliveries(db, {
        tenantId: '100',
        currencyCode: 'BDT',
        nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(second).toMatchObject({ completed: true, eventsCreated: 0, reused: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('projects a header-only legacy bill as one explicit historical delivery', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'100',10,'INV-HEADER-ONLY','CODE-HO',10,5,95,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
    `);
    try {
      const delivery = await backfillInvoiceItemDeliveries(db, {
        tenantId: '100',
        currencyCode: 'BDT',
        nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(delivery).toMatchObject({ completed: true, headerEventsCreated: 1 });
      expect(sqlite.prepare(`
        SELECT source_type,mapping_status FROM canonical_source_mappings
        WHERE entity_type='service_event'
      `).get()).toEqual({ source_type: 'legacy_bill_header_delivery', mapping_status: 'mapped' });

      const invoice = await backfillInvoices(db, {
        tenantId: '100',
        runPublicId: 'invoice-header-only',
        currencyCode: 'BDT',
        nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(invoice.completed).toBe(true);
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor
        FROM canonical_invoices
      `).get()).toEqual({ subtotal_minor: 10000, adjustment_total_minor: -500, total_minor: 9500 });
      expect(sqlite.prepare(`
        SELECT line_type,adjustment_code,line_amount_minor
        FROM canonical_invoice_lines ORDER BY line_type,adjustment_code
      `).all()).toEqual([
        { line_type: 'discount', adjustment_code: 'LEGACY_HEADER_DISCOUNT', line_amount_minor: -1000 },
        { line_type: 'service', adjustment_code: null, line_amount_minor: 10000 },
        { line_type: 'tax', adjustment_code: 'LEGACY_HEADER_TAX', line_amount_minor: 500 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('does not project cancelled or financially invalid lines', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'100',10,'INV-1','CODE-1',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'100',1,'test','Cancelled',1,100,100,NULL,'cancelled','2026-07-01 09:30:00',0,'2026-07-01 09:00:00'),
        (2,'100',1,'test','Invalid',0,100,0,NULL,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      const result = await backfillInvoiceItemDeliveries(db, {
        tenantId: '100',
        currencyCode: 'BDT',
        nowUtc: '2026-07-18T08:00:00.000Z',
      });
      expect(result).toMatchObject({ completed: true, eventsCreated: 0, skipped: 2 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_service_events`).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});

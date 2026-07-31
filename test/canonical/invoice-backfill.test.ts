import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillInvoices,
  type InvoiceBackfillDatabase,
  type InvoiceBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-invoices';
import { createDeterministicSourceId } from '../../src/lib/canonical/source-mapping';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements InvoiceBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((v) => v === undefined ? null : v) as SqlValue[]);
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function adapter(sqlite: DatabaseSync, controls: { failNextInvoiceBatch?: boolean } = {}): InvoiceBackfillDatabase {
  return {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          results.push(await statements[index].run());
          if (controls.failNextInvoiceBatch
              && statements.some((s) => (s as Statement).sql.includes('canonical_invoices'))
              && index === 0) {
            controls.failNextInvoiceBatch = false;
            throw new Error('synthetic invoice batch failure');
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

function fixture(controls: { failNextInvoiceBatch?: boolean } = {}) {
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
      item_category TEXT, quantity INTEGER, unit_price INTEGER, line_total INTEGER,
      reference_id INTEGER, status TEXT, cancelled_at TEXT, tax_amount REAL,
      created_at TEXT
    );
    CREATE TABLE lab_order_items (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE radiology_requisitions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE procedure_orders (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE patient_bed_infos (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE prescription_items (id INTEGER PRIMARY KEY);
    CREATE TABLE prescriptions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE consultations (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
  `);
  return { sqlite, db: adapter(sqlite, controls) };
}

function seedEvent(
  sqlite: DatabaseSync,
  input: { tenantId?: string; eventId?: string; sourceType?: string; sourceId?: number } = {},
): void {
  const tenantId = input.tenantId ?? '1';
  const eventId = input.eventId ?? 'evt-1';
  const sourceType = input.sourceType ?? 'legacy_lab_order_item';
  const sourceId = input.sourceId ?? 11;
  sqlite.prepare(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES (?,?,'laboratory','Synthetic Service','service','active',?)
  `).run(tenantId, `svc-${eventId}`, 'a'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,service_public_id,event_type,quantity,status,
      occurred_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,'completed',1,'posted','2026-07-01T03:00:00.000Z',?)
  `).run(tenantId, eventId, `svc-${eventId}`, 'b'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'service_event',?,?,?,'source_table','mapped',1,?)
  `).run(tenantId, eventId, sourceType, String(sourceId), 'c'.repeat(64));
  const sourceTable = sourceType === 'legacy_lab_order_item'
    ? 'lab_order_items'
    : sourceType === 'legacy_radiology_requisition'
      ? 'radiology_requisitions'
      : sourceType === 'legacy_procedure_order'
        ? 'procedure_orders'
        : 'patient_bed_infos';
  sqlite.prepare(`INSERT INTO ${sourceTable}(id,tenant_id) VALUES (?,?)`).run(sourceId, tenantId);
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}${where}`).get() as { count: number }).count);
}

const options = {
  tenantId: '1',
  runPublicId: 'run-invoice-1',
  currencyCode: 'BDT',
  nowUtc: '2026-07-14T07:00:00.000Z',
};

describe('canonical invoice migration', () => {
  it('creates invoice and typed-line authorities with exact totals and unique event claims', () => {
    const { sqlite } = fixture();
    try {
      expect(sqlite.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('canonical_invoices','canonical_invoice_lines') ORDER BY name`).all()).toEqual([
        { name: 'canonical_invoice_lines' },
        { name: 'canonical_invoices' },
      ]);
      seedEvent(sqlite);
      sqlite.prepare(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
          credited_minor,net_due_minor,adjustment_projection_guard,status,issued_at_utc,
          posted_at_utc,source_evidence_sha256
        ) VALUES ('1','inv-1','INV-1',10,'BDT',10000,0,10000,0,10000,0,10000,1,'posted',
                  '2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z',?)
      `).run('d'.repeat(64));
      sqlite.prepare(`
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES ('1','line-1','inv-1','service','evt-1',1,10000,10000,?)
      `).run('e'.repeat(64));
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES ('1','line-2','inv-1','service','evt-1',1,10000,10000,?)
      `).run('f'.repeat(64))).toThrow(/UNIQUE constraint failed/);
    } finally { sqlite.close(); }
  });

  it('requires lifecycle timestamps, safe integer money, and matching partial-index parity', () => {
    const { sqlite } = fixture();
    try {
      seedEvent(sqlite);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
          credited_minor,net_due_minor,adjustment_projection_guard,status,issued_at_utc,
          source_evidence_sha256
        ) VALUES ('1','inv-no-post','INV-NO-POST',10,'BDT',10000,0,10000,0,10000,0,10000,1,'posted',
                  '2026-07-01T03:00:00.000Z',?)
      `).run('d'.repeat(64))).toThrow(/CHECK constraint failed/);

      sqlite.prepare(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
          credited_minor,net_due_minor,adjustment_projection_guard,status,issued_at_utc,
          posted_at_utc,source_evidence_sha256
        ) VALUES ('1','inv-safe','INV-SAFE',10,'BDT',0,0,0,0,0,0,0,1,'posted',
                  '2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z',?)
      `).run('d'.repeat(64));
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES ('1','line-overflow','inv-safe','service','evt-1',
                  9007199254740991,2,18014398509481982,?)
      `).run('e'.repeat(64))).toThrow();

      const drizzle = readFileSync('src/db/schema/canonical/billing.ts', 'utf8');
      expect(drizzle).toContain(".where(sql`${table.serviceEventPublicId} IS NOT NULL`)");
    } finally { sqlite.close(); }
  });
});

describe('canonical invoice backfill', () => {
  it('creates a typed posted invoice with explicit discount and tax adjustments', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-1','CODE-1',20,5,185,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',2,100,180,11,'active',NULL,5,'2026-07-01 09:00:00');
    `);
    try {
      const first = await backfillInvoices(db, options);
      expect(first.completed).toBe(true);
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(sqlite.prepare(`SELECT subtotal_minor,adjustment_total_minor,total_minor,status FROM canonical_invoices`).get()).toEqual({
        subtotal_minor: 20000,
        adjustment_total_minor: -1500,
        total_minor: 18500,
        status: 'posted',
      });
      expect(sqlite.prepare(`SELECT line_type,line_amount_minor FROM canonical_invoice_lines ORDER BY line_type,line_amount_minor`).all()).toEqual([
        { line_type: 'discount', line_amount_minor: -2000 },
        { line_type: 'service', line_amount_minor: 20000 },
        { line_type: 'tax', line_amount_minor: 500 },
      ]);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type='invoice'")).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type='invoice_line'")).toBe(1);

      const second = await backfillInvoices(db, { ...options, runPublicId: 'run-invoice-2' });
      expect(second.counts).toMatchObject({ invoicesCreated: 0, linesCreated: 0, mappingsCreated: 0, issuesCreated: 0 });
    } finally { sqlite.close(); }
  });

  it('adopts a compatible live-projected invoice instead of colliding on invoice number', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-LIVE','CODE-LIVE',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00');
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
        subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
        credited_minor,net_due_minor,adjustment_projection_guard,status,issued_at_utc,
        posted_at_utc,source_evidence_sha256
      ) VALUES ('1','inv-live','INV-LIVE',10,'BDT',10000,0,10000,0,10000,0,10000,1,'posted',
                '2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z','d'||printf('%063d',0));
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES ('1','invoice','inv-live','legacy_live_bill','INV-LIVE','runtime','mapped',1,'e'||printf('%063d',0));
    `);
    try {
      const result = await backfillInvoices(db, options);
      expect(result.completed).toBe(true);
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(sqlite.prepare(`
        SELECT canonical_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='invoice' AND source_type='legacy_bill' AND source_public_id='1'
      `).get()).toEqual({ canonical_public_id: 'inv-live', mapping_status: 'mapped' });
      expect(count(sqlite, 'canonical_processing_issues', " WHERE issue_code='INVOICE_LIVE_PROJECTION_CONFLICT'")).toBe(0);
    } finally { sqlite.close(); }
  });

  it('accepts an implicit line discount when the legacy header omitted the discount total', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-IMPLICIT','CODE-I',0,0,90,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',1,100,90,11,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      const result = await backfillInvoices(db, options);
      expect(result.completed).toBe(true);
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor
        FROM canonical_invoices
      `).get()).toEqual({ subtotal_minor: 10000, adjustment_total_minor: -1000, total_minor: 9000 });
      expect(sqlite.prepare(`
        SELECT adjustment_code,line_amount_minor FROM canonical_invoice_lines
        WHERE line_type='discount'
      `).get()).toEqual({ adjustment_code: 'LEGACY_LINE_DISCOUNT', line_amount_minor: -1000 });
    } finally {
      sqlite.close();
    }
  });

  it('preserves explicit header-level discount and tax adjustments', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-HEADER','CODE-H',10,5,95,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      const result = await backfillInvoices(db, options);
      expect(result.completed).toBe(true);
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor
        FROM canonical_invoices
      `).get()).toEqual({
        subtotal_minor: 10000,
        adjustment_total_minor: -500,
        total_minor: 9500,
      });
      expect(sqlite.prepare(`
        SELECT line_type,adjustment_code,line_amount_minor
        FROM canonical_invoice_lines
        ORDER BY line_type,adjustment_code
      `).all()).toEqual([
        { line_type: 'discount', adjustment_code: 'LEGACY_HEADER_DISCOUNT', line_amount_minor: -1000 },
        { line_type: 'service', adjustment_code: null, line_amount_minor: 10000 },
        { line_type: 'tax', adjustment_code: 'LEGACY_HEADER_TAX', line_amount_minor: 500 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('classifies untyped and financially inconsistent bills without creating canonical invoices', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-1','CODE-1',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00'),
        (2,'1',10,'INV-2','CODE-2',0,0,200,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'doctor_visit',1,100,100,1,'active',NULL,0,'2026-07-01 09:00:00'),
        (2,'1',2,'other',1,100,150,NULL,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      const result = await backfillInvoices(db, options);
      expect(result.completed).toBe(true);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type='invoice' AND mapping_status='ambiguous'")).toBe(2);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type='invoice_line' AND mapping_status='ambiguous'")).toBe(2);
      expect(sqlite.prepare(`SELECT issue_code FROM canonical_processing_issues WHERE issue_type='invoice_backfill' ORDER BY issue_code`).all()).toEqual([
        { issue_code: 'INVOICE_FINANCIAL_VARIANCE' },
        { issue_code: 'INVOICE_TYPED_LINE_UNRESOLVED' },
      ]);
    } finally { sqlite.close(); }
  });

  it('retries an unchanged ambiguous invoice after a deterministic historical event becomes available', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-RETRY','CODE-RETRY',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'medicine',1,100,100,NULL,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      const first = await backfillInvoices(db, options);
      expect(first.completed).toBe(true);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(sqlite.prepare(`
        SELECT mapping_status FROM canonical_source_mappings
        WHERE entity_type='invoice' AND source_public_id='1'
      `).get()).toEqual({ mapping_status: 'ambiguous' });

      seedEvent(sqlite, {
        eventId: 'evt-historical-1',
        sourceType: 'legacy_invoice_item_delivery',
        sourceId: 1,
      });
      const second = await backfillInvoices(db, {
        ...options,
        runPublicId: 'run-invoice-retry',
      });
      expect(second.completed).toBe(true);
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(sqlite.prepare(`
        SELECT mapping_status,canonical_public_id IS NOT NULL AS has_id
        FROM canonical_source_mappings
        WHERE entity_type='invoice' AND source_public_id='1'
      `).get()).toEqual({ mapping_status: 'mapped', has_id: 1 });
      expect(sqlite.prepare(`
        SELECT status,resolution_code FROM canonical_processing_issues
        WHERE issue_type='invoice_backfill' AND source_public_id='1'
      `).get()).toEqual({ status: 'resolved', resolution_code: 'RETRIED_WITH_TYPED_EVENT' });
    } finally {
      sqlite.close();
    }
  });

  it('preserves cancelled lifecycle and tenant-scoped invoice numbers', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite, { tenantId: '1', eventId: 'evt-1', sourceId: 11 });
    seedEvent(sqlite, { tenantId: '2', eventId: 'evt-2', sourceId: 21 });
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-SAME','CODE-1',0,0,100,'cancelled','2026-07-02 09:00:00','2026-07-01 09:00:00','2026-07-02 09:00:00'),
        (2,'2',20,'INV-SAME','CODE-2',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00'),
        (2,'2',2,'test',1,100,100,21,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      await backfillInvoices(db, options);
      await backfillInvoices(db, { ...options, tenantId: '2', runPublicId: 'run-tenant-2' });
      expect(sqlite.prepare(`SELECT tenant_id,status FROM canonical_invoices ORDER BY tenant_id`).all()).toEqual([
        { tenant_id: '1', status: 'cancelled' },
        { tenant_id: '2', status: 'posted' },
      ]);
    } finally { sqlite.close(); }
  });

  it('classifies cancelled source lines without treating them as active financial authority', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-1','CODE-1',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00'),
        (2,'1',1,'other',1,999,999,NULL,'cancelled','2026-07-01 09:30:00',0,'2026-07-01 09:00:00');
    `);
    try {
      await backfillInvoices(db, options);
      expect(sqlite.prepare(`SELECT total_minor FROM canonical_invoices`).get()).toEqual({ total_minor: 10000 });
      expect(sqlite.prepare(`
        SELECT source_public_id,canonical_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='invoice_line'
        ORDER BY source_public_id
      `).all()).toEqual([
        { source_public_id: '1', canonical_public_id: expect.any(String), mapping_status: 'mapped' },
        { source_public_id: '2', canonical_public_id: null, mapping_status: 'rejected' },
      ]);
      expect(sqlite.prepare(`SELECT issue_code FROM canonical_processing_issues WHERE issue_type='invoice_backfill'`).all()).toEqual([
        { issue_code: 'INVOICE_CANCELLED_LINE_EXCLUDED' },
      ]);
    } finally { sqlite.close(); }
  });

  it('rolls back deterministic line-id conflicts instead of committing evidence-less mappings', async () => {
    const { sqlite, db } = fixture();
    seedEvent(sqlite, { eventId: 'evt-1', sourceId: 11 });
    seedEvent(sqlite, { eventId: 'evt-2', sourceId: 12 });
    sqlite.exec(`
      INSERT INTO bills VALUES
        (1,'1',10,'INV-1','CODE-1',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES
        (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00');
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
        subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
        credited_minor,net_due_minor,adjustment_projection_guard,status,issued_at_utc,
        posted_at_utc,source_evidence_sha256
      ) VALUES ('1','inv-existing','INV-EXISTING',10,'BDT',10000,0,10000,0,10000,0,10000,1,'posted',
                '2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z','${'d'.repeat(64)}');
    `);
    const conflictingLineId = await createDeterministicSourceId(
      'invl', '1', 'legacy_invoice_item', '1:service',
    );
    sqlite.prepare(`
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
        quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES ('1',?,'inv-existing','service','evt-2',1,10000,10000,?)
    `).run(conflictingLineId, 'e'.repeat(64));
    try {
      await expect(backfillInvoices(db, options)).rejects.toThrow(/UNIQUE constraint failed/);
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type IN ('invoice','invoice_line')")).toBe(0);
      expect(sqlite.prepare(`SELECT cursor_value FROM canonical_backfill_checkpoints WHERE entity_type='invoice'`).get()).toEqual({ cursor_value: null });
    } finally { sqlite.close(); }
  });

  it('rejects failed terminal migration-run reuse and treats succeeded reuse as a no-op', async () => {
    const { sqlite, db } = fixture();
    sqlite.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
      ) VALUES ('1','run-failed','0510_canonical_invoices.sql','backfill','failed',?,?,?,?)
    `).run(options.nowUtc, options.nowUtc, options.nowUtc, options.nowUtc);
    try {
      await expect(backfillInvoices(db, { ...options, runPublicId: 'run-failed' })).rejects.toThrow(/terminal: failed/);
      seedEvent(sqlite);
      sqlite.exec(`
        INSERT INTO bills VALUES (1,'1',10,'INV-1','CODE-1',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
        INSERT INTO invoice_items VALUES (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00');
      `);
      await backfillInvoices(db, options);
      const replay = await backfillInvoices(db, options);
      expect(replay).toMatchObject({ completed: true, counts: { scanned: 0, invoicesCreated: 0, linesCreated: 0, mappingsCreated: 0, issuesCreated: 0 } });
    } finally { sqlite.close(); }
  });

  it('rolls back failed batches, detects evidence drift, and resumes without duplicates', async () => {
    const controls = { failNextInvoiceBatch: true };
    const { sqlite, db } = fixture(controls);
    seedEvent(sqlite);
    sqlite.exec(`
      INSERT INTO bills VALUES (1,'1',10,'INV-1','CODE-1',0,0,100,'paid',NULL,'2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO invoice_items VALUES (1,'1',1,'test',1,100,100,11,'active',NULL,0,'2026-07-01 09:00:00');
    `);
    try {
      await expect(backfillInvoices(db, options)).rejects.toThrow(/synthetic invoice batch failure/);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(sqlite.prepare(`SELECT cursor_value FROM canonical_backfill_checkpoints WHERE entity_type='invoice'`).get()).toEqual({ cursor_value: null });
      await backfillInvoices(db, options);
      sqlite.prepare(`UPDATE bills SET total=101 WHERE id=1`).run();
      const drift = await backfillInvoices(db, { ...options, runPublicId: 'run-drift' });
      expect(drift.counts.issuesCreated).toBe(1);
      expect(sqlite.prepare(`SELECT total_minor FROM canonical_invoices`).get()).toEqual({ total_minor: 10000 });
    } finally { sqlite.close(); }
  });
});

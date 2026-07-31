import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import type { PharmacySaleContext } from '../../src/lib/canonical/pharmacy-sale-types';
import { settlePharmacySale } from '../../src/lib/canonical/commands/settle-pharmacy-sale';

type SqlValue = string | number | bigint | null | Uint8Array;
const HASH = 'a'.repeat(64);
const NOW = '2026-07-24T04:00:00.000Z';
const DATE = '2026-07-24';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
    '0513_canonical_practitioner_compensation.sql',
    '0514_canonical_inventory_links.sql',
    '0515_canonical_accounting_outbox.sql',
    '0532_canonical_financial_batch_assertions.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE pharmacy_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_no TEXT NOT NULL,tenant_id TEXT NOT NULL
    );
    CREATE UNIQUE INDEX uq_pharmacy_invoice_no ON pharmacy_invoices(tenant_id,invoice_no);
    CREATE TABLE pharmacy_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id INTEGER NOT NULL,item_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,tenant_id TEXT NOT NULL
    );
    CREATE TABLE pharmacy_stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,stock_id INTEGER NOT NULL,item_id INTEGER NOT NULL,
      reference_type TEXT,reference_id INTEGER,tenant_id TEXT NOT NULL
    );
    CREATE TABLE legacy_authority (id INTEGER PRIMARY KEY, value TEXT NOT NULL);

    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('100','svc_med_20','product','PHARMACY-20','Test medicine','EA','active','${HASH}');
    INSERT INTO canonical_inventory_items (
      tenant_id,item_public_id,item_kind,legacy_pharmacy_item_id,service_public_id,
      display_name,base_unit_code,status,source_evidence_sha256
    ) VALUES ('100','invitem_20','medicine',20,'svc_med_20','Test medicine','EA','active','${HASH}');
    INSERT INTO canonical_inventory_locations (
      tenant_id,location_public_id,location_type,location_code,display_name,status,source_evidence_sha256
    ) VALUES ('100','invloc_pharmacy','pharmacy','PHARMACY-RICH','Pharmacy stock','active','${HASH}');
    INSERT INTO canonical_inventory_lots (
      tenant_id,lot_public_id,item_public_id,legacy_pharmacy_stock_id,lot_code,expiry_date,status,source_evidence_sha256
    ) VALUES ('100','invlot_30','invitem_20',30,'B-001','2027-01-01','active','${HASH}');
    INSERT INTO canonical_inventory_stock_policies (
      tenant_id,item_public_id,location_public_id,allow_negative_stock,source_evidence_sha256
    ) VALUES ('100','invitem_20','invloc_pharmacy',0,'${HASH}');
    INSERT INTO canonical_inventory_balances (
      tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
      projection_guard,source_evidence_sha256
    ) VALUES ('100','invitem_20','invloc_pharmacy','invlot_30',10,0,1,'${HASH}');
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
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

function context(overrides: Partial<PharmacySaleContext> = {}): PharmacySaleContext {
  return {
    tenantId: '100',
    userId: 9,
    patientId: 501,
    patientVisitId: null,
    prescriberId: null,
    counterId: null,
    sourceKind: 'prescription_dispense',
    sourceDocumentId: 15,
    invoiceNo: 'PH-1',
    businessDate: DATE,
    occurredAtUtc: NOW,
    paymentMode: 'cash',
    externalTransactionId: null,
    tender: 60,
    subtotal: 100,
    sourceDiscountPct: 0,
    discountAmount: 0,
    total: 100,
    paidAmount: 60,
    creditAmount: 40,
    depositDeductAmount: 0,
    remarks: null,
    items: [{
      lineNumber: 1,
      duplicateOrdinal: 0,
      sourceItemId: 16,
      pharmacyItemId: 20,
      stockId: 30,
      itemName: 'Test medicine',
      batchNo: 'B-001',
      expiryDate: '2027-01-01',
      sourceUnitCode: 'EA',
      quantity: 1,
      mrp: 100,
      price: 100,
      salePrice: 100,
      discountPct: 0,
      vatPct: 0,
      subtotal: 100,
      total: 100,
      costPrice: 50,
      legacyAvailableBefore: 10,
      canonical: {
        itemPublicId: 'invitem_20',
        servicePublicId: 'svc_med_20',
        lotPublicId: 'invlot_30',
        locationPublicId: 'invloc_pharmacy',
        baseUnitCode: 'EA',
        conversionNumerator: 1,
        conversionDenominator: 1,
        balanceBeforeBase: 10,
        balanceVersion: 0,
      },
    }],
    ...overrides,
  };
}

function authoritativeStatements(db: CanonicalBatchDatabase, lineCount = 1) {
  const statements: CanonicalPreparedStatement[] = [
    db.prepare("INSERT INTO pharmacy_invoices (invoice_no,tenant_id) VALUES ('PH-1','100')"),
  ];
  for (let index = 0; index < lineCount; index += 1) {
    statements.push(
      db.prepare(`
        INSERT INTO pharmacy_invoice_items (invoice_id,item_id,stock_id,tenant_id)
        SELECT id,20,30,'100' FROM pharmacy_invoices WHERE tenant_id='100' AND invoice_no='PH-1'
      `),
      db.prepare(`
        INSERT INTO pharmacy_stock_transactions (stock_id,item_id,reference_type,reference_id,tenant_id)
        SELECT 30,20,'invoice',id,'100' FROM pharmacy_invoices WHERE tenant_id='100' AND invoice_no='PH-1'
      `),
    );
  }
  return statements;
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('settlePharmacySale', () => {
  it('atomically creates fulfilled service, invoice settlement and linked stock sale authority', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await settlePharmacySale(db, context(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      expect(result.result).toMatchObject({
        invoiceNo: 'PH-1', totalMinor: 10_000, paidMinor: 6_000,
        dueMinor: 4_000, movementCount: 1,
      });
      expect(sqlite.prepare(`
        SELECT status,requested_quantity,fulfilled_quantity FROM canonical_service_requests
      `).get()).toEqual({ status: 'fulfilled', requested_quantity: 1, fulfilled_quantity: 1 });
      expect(sqlite.prepare(`
        SELECT event_type,quantity,status FROM canonical_service_events
      `).get()).toEqual({ event_type: 'dispensed', quantity: 1, status: 'posted' });
      expect(sqlite.prepare(`
        SELECT subtotal_minor,total_minor,paid_minor,due_minor FROM canonical_invoices
      `).get()).toEqual({ subtotal_minor: 10_000, total_minor: 10_000, paid_minor: 6_000, due_minor: 4_000 });
      expect(sqlite.prepare(`
        SELECT quantity_base,version FROM canonical_inventory_balances
      `).get()).toEqual({ quantity_base: 9, version: 1 });
      expect(sqlite.prepare(`
        SELECT movement_type,direction,source_public_id,service_event_public_id,
               invoice_public_id,invoice_line_public_id,balance_before_base,balance_after_base
        FROM canonical_inventory_movements
      `).get()).toMatchObject({
        movement_type: 'sale', direction: 'out', source_public_id: '1',
        balance_before_base: 10, balance_after_base: 9,
      });
      expect(sqlite.prepare(`
        SELECT entity_type,source_public_id FROM canonical_source_mappings
        WHERE source_table IN ('pharmacy_invoice_items','pharmacy_stock_transactions')
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'inventory_movement', source_public_id: '1' },
        { entity_type: 'service_event', source_public_id: '1' },
        { entity_type: 'service_request', source_public_id: '1' },
      ]);
    } finally { sqlite.close(); }
  });

  it('chains duplicate stock-line balances and source ordinals within one invoice', async () => {
    const { sqlite, db } = harness();
    try {
      const base = context();
      const first = base.items[0];
      const second = {
        ...first,
        lineNumber: 2,
        duplicateOrdinal: 1,
        sourceItemId: 17,
        quantity: 2,
        subtotal: 200,
        total: 200,
        legacyAvailableBefore: 9,
      };
      const result = await settlePharmacySale(db, context({
        tender: 100,
        subtotal: 300,
        total: 300,
        paidAmount: 100,
        creditAmount: 200,
        items: [first, second],
      }), {
        authoritativeStatements: authoritativeStatements(db, 2),
      });

      expect(result.result.movementCount).toBe(2);
      expect(sqlite.prepare('SELECT quantity_base,version FROM canonical_inventory_balances').get())
        .toEqual({ quantity_base: 7, version: 2 });
      expect(sqlite.prepare(`
        SELECT balance_before_base,balance_after_base,source_public_id
        FROM canonical_inventory_movements ORDER BY id
      `).all()).toEqual([
        { balance_before_base: 10, balance_after_base: 9, source_public_id: '1' },
        { balance_before_base: 9, balance_after_base: 7, source_public_id: '2' },
      ]);
      expect(sqlite.prepare(`
        SELECT entity_type,source_public_id FROM canonical_source_mappings
        WHERE source_table='pharmacy_stock_transactions'
        ORDER BY source_public_id
      `).all()).toEqual([
        { entity_type: 'inventory_movement', source_public_id: '1' },
        { entity_type: 'inventory_movement', source_public_id: '2' },
      ]);
    } finally { sqlite.close(); }
  });

  it('applies canonical deposit authority alongside a cash payment and credit due', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,
          posted_at_utc,reconciliation_guard,source_evidence_sha256,
          refunded_minor,net_received_minor,refund_projection_guard
        ) VALUES ('100','receipt_dep','DEP-R-1',501,'BDT',5000,0,5000,'posted',
          '2026-07-20T04:00:00.000Z','2026-07-20','2026-07-20T04:00:00.000Z',1,'${HASH}',
          0,5000,1);
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,currency_code,
          amount_minor,applied_minor,refunded_minor,available_minor,status,received_at_utc,business_date,
          posted_at_utc,reconciliation_guard,source_evidence_sha256
        ) VALUES ('100','deposit_1','DEP-1','receipt_dep',501,'BDT',5000,0,0,5000,'posted',
          '2026-07-20T04:00:00.000Z','2026-07-20','2026-07-20T04:00:00.000Z',1,'${HASH}');
      `);
      const result = await settlePharmacySale(db, context({
        tender: 20,
        paidAmount: 20,
        depositDeductAmount: 30,
        creditAmount: 50,
      }), { authoritativeStatements: authoritativeStatements(db) });
      expect(result.result).toMatchObject({ paidMinor: 5_000, dueMinor: 5_000, depositMinor: 3_000 });
      expect(sqlite.prepare('SELECT applied_minor,available_minor FROM canonical_deposits').get())
        .toEqual({ applied_minor: 3_000, available_minor: 2_000 });
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('replays identical evidence and rejects changed content under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await settlePharmacySale(db, context(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      const replay = await settlePharmacySale(db, context(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      await expect(settlePharmacySale(db, context({ creditAmount: 39, paidAmount: 61, tender: 61 })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally { sqlite.close(); }
  });

  it('rolls back legacy and canonical facts when authoritative pharmacy writes fail', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(settlePharmacySale(db, context(), {
        authoritativeStatements: [
          db.prepare("INSERT INTO pharmacy_invoices (invoice_no,tenant_id) VALUES ('PH-1','100')"),
          db.prepare('INSERT INTO missing_pharmacy_authority VALUES (1)'),
        ],
      })).rejects.toThrow();
      expect(count(sqlite, 'pharmacy_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_inventory_movements')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally { sqlite.close(); }
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import { recordStockMovement } from '../../src/lib/canonical/commands/record-stock-movement';
import {
  backfillInventory,
  type InventoryBackfillDatabase,
  type InventoryBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-inventory';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement, InventoryBackfillPreparedStatement {
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

function migrations(sqlite: DatabaseSync): void {
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
    '0513_canonical_practitioner_compensation.sql',
    '0514_canonical_inventory_links.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
}

function commandHarness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  migrations(sqlite);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      controls.beforeBatch?.(sqlite);
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
  seedInventory(sqlite);
  return { sqlite, db };
}

function seedInventory(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_inventory_items (
      tenant_id,item_public_id,item_kind,display_name,base_unit_code,status,
      source_evidence_sha256
    ) VALUES ('tenant-a','item-1','medicine','Medicine A','unit','active','${'1'.repeat(64)}');
    INSERT INTO canonical_inventory_locations (
      tenant_id,location_public_id,location_type,display_name,status,source_evidence_sha256
    ) VALUES
      ('tenant-a','loc-main','store','Main Store','active','${'2'.repeat(64)}'),
      ('tenant-a','loc-ward','ward','Ward Store','active','${'3'.repeat(64)}');
    INSERT INTO canonical_inventory_lots (
      tenant_id,lot_public_id,item_public_id,lot_code,expiry_date,status,source_evidence_sha256
    ) VALUES ('tenant-a','lot-1','item-1','BATCH-1','2027-12-31','active','${'4'.repeat(64)}');
    INSERT INTO canonical_inventory_unit_conversions (
      tenant_id,conversion_public_id,item_public_id,source_unit_code,base_unit_code,
      numerator,denominator,status,source_evidence_sha256
    ) VALUES
      ('tenant-a','conv-box','item-1','box','unit',10,1,'active','${'5'.repeat(64)}'),
      ('tenant-a','conv-half','item-1','half','unit',1,2,'active','${'6'.repeat(64)}');
    INSERT INTO canonical_inventory_stock_policies (
      tenant_id,item_public_id,location_public_id,allow_negative_stock,source_evidence_sha256
    ) VALUES
      ('tenant-a','item-1','loc-main',0,'${'7'.repeat(64)}'),
      ('tenant-a','item-1','loc-ward',0,'${'8'.repeat(64)}');
    INSERT INTO canonical_inventory_balances (
      tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
      projection_guard,source_evidence_sha256
    ) VALUES
      ('tenant-a','item-1','loc-main','lot-1',100,1,1,'${'9'.repeat(64)}'),
      ('tenant-a','item-1','loc-ward','lot-1',0,0,1,'${'a'.repeat(64)}');
  `);
}

function seedServiceAndInvoice(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','svc-med','product','Medicine A','unit','active','${'b'.repeat(64)}');
    UPDATE canonical_inventory_items
      SET service_public_id='svc-med'
      WHERE tenant_id='tenant-a' AND item_public_id='item-1';
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,service_public_id,event_type,quantity,status,
      occurred_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','evt-dispense','svc-med','dispensed',1,'posted',
              '2026-07-14T04:00:00.000Z','${'c'.repeat(64)}');
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','inv-med','INV-MED',101,'BDT',1000,0,1000,0,1000,0,1000,1,
              'posted','2026-07-14T04:01:00.000Z','2026-07-14T04:01:00.000Z','${'d'.repeat(64)}');
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('tenant-a','line-med','inv-med','service','evt-dispense',1,1000,1000,'${'e'.repeat(64)}');
  `);
}

function movementInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    movementPublicId: 'move-1',
    movementType: 'issue' as const,
    itemPublicId: 'item-1',
    locationPublicId: 'loc-main',
    lotPublicId: 'lot-1',
    sourceQuantity: 10,
    sourceUnitCode: 'unit',
    occurredAtUtc: '2026-07-14T05:00:00.000Z',
    businessDate: '2026-07-14',
    actorUserId: 7,
    sourceType: 'runtime_inventory',
    sourcePublicId: 'runtime-1',
    sourceLinePublicId: 'line-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'f'.repeat(64),
    serviceEventPublicId: null,
    invoicePublicId: null,
    invoiceLinePublicId: null,
    idempotencyKey: 'inventory-movement-1',
    outboxEventPublicId: 'outbox-inventory-1',
    ...overrides,
  };
}

function balance(sqlite: DatabaseSync, location = 'loc-main'): number {
  return Number((sqlite.prepare(`
    SELECT quantity_base quantity FROM canonical_inventory_balances
    WHERE tenant_id='tenant-a' AND item_public_id='item-1'
      AND location_public_id=? AND lot_public_id='lot-1'
  `).get(location) as { quantity: number }).quantity);
}

function movementRows(sqlite: DatabaseSync): Array<Record<string, unknown>> {
  return sqlite.prepare(`
    SELECT movement_public_id,movement_type,direction,quantity_base,signed_quantity_base,
           location_public_id,transfer_public_id,service_event_public_id,
           invoice_public_id,invoice_line_public_id,balance_before_base,balance_after_base
    FROM canonical_inventory_movements ORDER BY id
  `).all() as Array<Record<string, unknown>>;
}

function sourceTables(sqlite: DatabaseSync): void {
  sqlite.exec(`
    CREATE TABLE InventoryUnitOfMeasurement (
      UOMId INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,UOMName TEXT NOT NULL
    );
    CREATE TABLE InventoryItem (
      ItemId INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,ItemName TEXT NOT NULL,
      ItemCode TEXT,UOMId INTEGER,IsFixedAsset INTEGER DEFAULT 0,IsActive INTEGER DEFAULT 1
    );
    CREATE TABLE InventoryStore (
      StoreId INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,StoreName TEXT NOT NULL,
      StoreCode TEXT,StoreType TEXT,IsActive INTEGER DEFAULT 1
    );
    CREATE TABLE InventoryStock (
      StockId INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,ItemId INTEGER NOT NULL,
      StoreId INTEGER NOT NULL,BatchNo TEXT,ExpiryDate TEXT,AvailableQuantity REAL NOT NULL
    );
    CREATE TABLE InventoryStockTransaction (
      TransactionId INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,ItemId INTEGER,
      StockId INTEGER,StoreId INTEGER,TransactionType TEXT NOT NULL,ReferenceNo TEXT,
      ReferenceId INTEGER,InQuantity REAL DEFAULT 0,OutQuantity REAL DEFAULT 0,
      BalanceQuantity REAL DEFAULT 0,TransactionDate TEXT,CreatedBy INTEGER,CreatedOn TEXT
    );
    CREATE TABLE pharmacy_uom (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,name TEXT NOT NULL,is_active INTEGER DEFAULT 1
    );
    CREATE TABLE pharmacy_items (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,item_code TEXT,name TEXT NOT NULL,
      uom_id INTEGER,inventory_item_id INTEGER,is_active INTEGER DEFAULT 1
    );
    CREATE TABLE pharmacy_stock (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,item_id INTEGER NOT NULL,
      batch_no TEXT,expiry_date TEXT,available_qty REAL NOT NULL
    );
    CREATE TABLE pharmacy_stock_transactions (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,stock_id INTEGER NOT NULL,item_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,reference_type TEXT,reference_id INTEGER,batch_no TEXT,
      expiry_date TEXT,in_qty REAL DEFAULT 0,out_qty REAL DEFAULT 0,created_at TEXT,created_by INTEGER,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE medicines (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,name TEXT NOT NULL,unit TEXT,quantity INTEGER DEFAULT 0
    );
    CREATE TABLE medicine_stock_batches (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,medicine_id INTEGER NOT NULL,
      batch_no TEXT,expiry_date TEXT,quantity_available INTEGER NOT NULL
    );
    CREATE TABLE medicine_stock_movements (
      id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,medicine_id INTEGER NOT NULL,batch_id INTEGER,
      movement_type TEXT NOT NULL,quantity INTEGER NOT NULL,reference_type TEXT,reference_id INTEGER,
      movement_date TEXT NOT NULL,created_by INTEGER,created_at TEXT
    );
  `);
}

function seedSources(sqlite: DatabaseSync): void {
  sourceTables(sqlite);
  sqlite.exec(`
    INSERT INTO InventoryUnitOfMeasurement VALUES (1,'tenant-a','Piece');
    INSERT INTO InventoryItem VALUES (10,'tenant-a','Gloves','GLV',1,0,1);
    INSERT INTO InventoryStore VALUES (20,'tenant-a','Main Store','MAIN','main',1);
    INSERT INTO InventoryStock VALUES (30,'tenant-a',10,20,'G-1','2027-01-31',7);
    INSERT INTO InventoryStockTransaction VALUES
      (100,'tenant-a',10,30,20,'lab-stock-in','GRN-1',1,10,0,10,'2026-07-10',1,'2026-07-10 10:00:00'),
      (101,'tenant-a',10,30,20,'issue','ISS-1',2,0,3,7,'2026-07-11',2,'2026-07-11 10:00:00');

    INSERT INTO pharmacy_uom VALUES (1,'tenant-a','tablet',1);
    INSERT INTO pharmacy_items VALUES (40,'tenant-a','MED-1','Medicine Rich',1,NULL,1);
    INSERT INTO pharmacy_stock VALUES (50,'tenant-a',40,'P-1','2027-02-28',4);
    INSERT INTO pharmacy_stock_transactions VALUES
      (200,'tenant-a',50,40,'purchase','grn',1,'P-1','2027-02-28',5,0,'2026-07-10 11:00:00',1,1),
      (201,'tenant-a',50,40,'sale','invoice',2,'P-1','2027-02-28',0,1,'2026-07-11 11:00:00',2,1);

    INSERT INTO medicines VALUES (60,'tenant-a','Medicine Legacy','capsule',2);
    INSERT INTO medicine_stock_batches VALUES (70,'tenant-a',60,'L-1','2027-03-31',2);
    INSERT INTO medicine_stock_movements VALUES
      (300,'tenant-a',60,70,'purchase_in',3,'purchase',1,'2026-07-10',1,'2026-07-10 12:00:00'),
      (301,'tenant-a',60,70,'sale_out',1,'sale',2,'2026-07-11',2,'2026-07-11 12:00:00');
  `);
}

function backfillHarness() {
  const sqlite = new DatabaseSync(':memory:');
  migrations(sqlite);
  seedSources(sqlite);
  const db: InventoryBackfillDatabase = {
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

describe('canonical inventory reconciliation', () => {
  it('creates the typed inventory authority with strict movement math', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      migrations(sqlite);
      const tables = sqlite.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name LIKE 'canonical_inventory_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'canonical_inventory_balances',
        'canonical_inventory_items',
        'canonical_inventory_locations',
        'canonical_inventory_lots',
        'canonical_inventory_movements',
        'canonical_inventory_stock_policies',
        'canonical_inventory_transfers',
        'canonical_inventory_unit_conversions',
      ]);
      expect(() => sqlite.exec(`
        INSERT INTO canonical_inventory_items (
          tenant_id,item_public_id,item_kind,display_name,base_unit_code,status,source_evidence_sha256
        ) VALUES ('t','i','other','I','unit','active','${'1'.repeat(64)}');
        INSERT INTO canonical_inventory_locations (
          tenant_id,location_public_id,location_type,display_name,status,source_evidence_sha256
        ) VALUES ('t','l','other','L','active','${'2'.repeat(64)}');
        INSERT INTO canonical_inventory_lots (
          tenant_id,lot_public_id,item_public_id,lot_code,status,source_evidence_sha256
        ) VALUES ('t','lot','i','UNBATCHED','active','${'3'.repeat(64)}');
        INSERT INTO canonical_inventory_movements (
          tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
          movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
          conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
          balance_after_base,source_type,source_public_id,source_line_public_id,source_table,
          status,occurred_at_utc,business_date,balance_guard,source_evidence_sha256
        ) VALUES ('t','m','i','l','lot','issue','out',1,'unit',1,1,1,1,0,-1,
          'x','1','1','x','posted','2026-07-14T00:00:00.000Z','2026-07-14',1,'${'4'.repeat(64)}');
      `)).toThrow();
    } finally { sqlite.close(); }
  });

  it('records purchase receipt and exact unit-converted issue movements', async () => {
    const { sqlite, db } = commandHarness();
    try {
      const receipt = await recordStockMovement(db, movementInput({
        movementPublicId: 'move-receipt',movementType: 'purchase_receipt',sourceQuantity: 2,
        sourceUnitCode: 'box',sourcePublicId: 'grn-1',sourceLinePublicId: 'grn-line-1',
        idempotencyKey: 'receipt-1',outboxEventPublicId: 'outbox-receipt-1',
      }));
      expect(receipt).toMatchObject({ status: 'applied', result: { quantityBase: 20, balanceBeforeBase: 100, balanceAfterBase: 120 } });
      const issue = await recordStockMovement(db, movementInput({
        movementPublicId: 'move-issue-box',sourceQuantity: 2,sourceUnitCode: 'box',
        sourcePublicId: 'issue-2',sourceLinePublicId: 'issue-line-2',
        idempotencyKey: 'issue-box-1',outboxEventPublicId: 'outbox-issue-box-1',
      }));
      expect(issue.result).toMatchObject({ quantityBase: 20, balanceBeforeBase: 120, balanceAfterBase: 100 });
      expect(balance(sqlite)).toBe(100);
    } finally { sqlite.close(); }
  });

  it('records an inter-location transfer as one paired outbound/inbound fact', async () => {
    const { sqlite, db } = commandHarness();
    try {
      const result = await recordStockMovement(db, movementInput({
        movementPublicId: 'move-transfer-out',movementType: 'transfer',sourceQuantity: 20,
        destinationLocationPublicId: 'loc-ward',transferPublicId: 'transfer-1',
        inboundMovementPublicId: 'move-transfer-in',sourcePublicId: 'dispatch-1',
        sourceLinePublicId: 'dispatch-line-1',idempotencyKey: 'transfer-1',
        outboxEventPublicId: 'outbox-transfer-1',
      }));
      expect(result.result).toMatchObject({ transferPublicId: 'transfer-1', balanceBeforeBase: 100, balanceAfterBase: 80, destinationBalanceAfterBase: 20 });
      expect(balance(sqlite)).toBe(80);
      expect(balance(sqlite, 'loc-ward')).toBe(20);
      expect(movementRows(sqlite).map((row) => row.movement_type)).toEqual(['transfer_out', 'transfer_in']);
      expect((sqlite.prepare(`SELECT status FROM canonical_inventory_transfers`).get() as { status: string }).status).toBe('posted');
    } finally { sqlite.close(); }
  });

  it.each([
    ['issue', 'out'], ['dispense', 'out'], ['sale', 'out'], ['patient_return', 'in'],
    ['supplier_return', 'out'], ['waste', 'out'], ['expiry', 'out'],
    ['adjustment_in', 'in'], ['adjustment_out', 'out'],
  ] as const)('persists typed %s movement direction %s', async (movementType, direction) => {
    const { sqlite, db } = commandHarness();
    try {
      if (movementType === 'dispense' || movementType === 'sale') seedServiceAndInvoice(sqlite);
      await recordStockMovement(db, movementInput({
        movementPublicId: `move-${movementType}`,movementType,sourceQuantity: 1,
        sourcePublicId: `source-${movementType}`,sourceLinePublicId: `line-${movementType}`,
        serviceEventPublicId: movementType === 'dispense' || movementType === 'sale' ? 'evt-dispense' : null,
        invoicePublicId: movementType === 'sale' ? 'inv-med' : null,
        invoiceLinePublicId: movementType === 'sale' ? 'line-med' : null,
        idempotencyKey: `idem-${movementType}`,outboxEventPublicId: `outbox-${movementType}`,
      }));
      expect(movementRows(sqlite)[0]).toMatchObject({ movement_type: movementType, direction });
    } finally { sqlite.close(); }
  });

  it('rejects non-integral conversion and blocked negative stock, but permits explicit negative policy', async () => {
    const { sqlite, db } = commandHarness();
    try {
      await expect(recordStockMovement(db, movementInput({ sourceUnitCode: 'half',sourceQuantity: 1 })))
        .rejects.toThrow(/integral/i);
      await expect(recordStockMovement(db, movementInput({ sourceQuantity: 101 })))
        .rejects.toThrow(/negative stock/i);
      sqlite.exec(`UPDATE canonical_inventory_stock_policies SET allow_negative_stock=1 WHERE location_public_id='loc-main'`);
      const result = await recordStockMovement(db, movementInput({ sourceQuantity: 101 }));
      expect(result.result.balanceAfterBase).toBe(-1);
      expect(balance(sqlite)).toBe(-1);
    } finally { sqlite.close(); }
  });

  it('replays identical requests and rejects semantic idempotency conflicts', async () => {
    const { sqlite, db } = commandHarness();
    try {
      const first = await recordStockMovement(db, movementInput());
      const replay = await recordStockMovement(db, movementInput());
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(balance(sqlite)).toBe(90);
      expect(movementRows(sqlite)).toHaveLength(1);
      await expect(recordStockMovement(db, movementInput({ sourceQuantity: 11 })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally { sqlite.close(); }
  });

  it('prevents duplicate dispense and sale stock-out links atomically', async () => {
    const { sqlite, db } = commandHarness();
    try {
      seedServiceAndInvoice(sqlite);
      await recordStockMovement(db, movementInput({
        movementPublicId: 'dispense-1',movementType: 'dispense',sourceQuantity: 1,
        serviceEventPublicId: 'evt-dispense',sourcePublicId: 'disp-1',sourceLinePublicId: 'disp-line-1',
        idempotencyKey: 'dispense-1',outboxEventPublicId: 'outbox-dispense-1',
      }));
      await expect(recordStockMovement(db, movementInput({
        movementPublicId: 'dispense-2',movementType: 'dispense',sourceQuantity: 1,
        serviceEventPublicId: 'evt-dispense',sourcePublicId: 'disp-2',sourceLinePublicId: 'disp-line-2',
        idempotencyKey: 'dispense-2',outboxEventPublicId: 'outbox-dispense-2',
      }))).rejects.toThrow();
      expect(balance(sqlite)).toBe(99);
      expect(movementRows(sqlite)).toHaveLength(1);

      await recordStockMovement(db, movementInput({
        movementPublicId: 'sale-1',movementType: 'sale',sourceQuantity: 1,
        serviceEventPublicId: 'evt-dispense',invoicePublicId: 'inv-med',invoiceLinePublicId: 'line-med',
        sourcePublicId: 'sale-1',sourceLinePublicId: 'sale-line-1',
        idempotencyKey: 'sale-1',outboxEventPublicId: 'outbox-sale-1',
      })).catch(() => undefined);
      expect(balance(sqlite)).toBe(99);
    } finally { sqlite.close(); }
  });

  it('rolls back the command when the balance changes between read and batch', async () => {
    let raced = false;
    const { sqlite, db } = commandHarness({ beforeBatch(database) {
      if (raced) return;
      raced = true;
      database.exec(`UPDATE canonical_inventory_balances SET quantity_base=95,version=2 WHERE location_public_id='loc-main'`);
    } });
    try {
      await expect(recordStockMovement(db, movementInput())).rejects.toThrow();
      expect(balance(sqlite)).toBe(95);
      expect(movementRows(sqlite)).toHaveLength(0);
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events`).get() as { count: number }).count).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rejects cross-tenant references', async () => {
    const { sqlite, db } = commandHarness();
    try {
      await expect(recordStockMovement(db, movementInput({ tenantId: 'tenant-b' }))).rejects.toThrow();
      expect(balance(sqlite)).toBe(100);
    } finally { sqlite.close(); }
  });

  it('stores PHI-free idempotency and outbox payloads', async () => {
    const { sqlite, db } = commandHarness();
    try {
      await recordStockMovement(db, movementInput());
      const payload = String((sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events`).get() as { payload_json: string }).payload_json);
      expect(payload).toContain('move-1');
      expect(payload).toContain('item-1');
      expect(payload).not.toMatch(/patient(?:Name|Id|Code)?|phone|address/i);
    } finally { sqlite.close(); }
  });

  it('backfills general, rich-pharmacy, and legacy-medicine movements and reconciles exact balances', async () => {
    const { sqlite, db } = backfillHarness();
    try {
      const result = await backfillInventory(db, {
        tenantId: 'tenant-a',runPublicId: 'inventory-run-1',nowUtc: '2026-07-14T06:00:00.000Z',
      });
      expect(result.completed).toBe(true);
      expect(result.counts).toMatchObject({ scanned: 6, movementsCreated: 6, issuesCreated: 0 });
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_inventory_items`).get() as { count: number }).count).toBe(3);
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_inventory_movements`).get() as { count: number }).count).toBe(6);
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_inventory_balances`).get() as { count: number }).count).toBe(3);
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM pragma_foreign_key_check`).get() as { count: number }).count).toBe(0);
      const replay = await backfillInventory(db, {
        tenantId: 'tenant-a',runPublicId: 'inventory-run-2',nowUtc: '2026-07-14T06:30:00.000Z',
      });
      expect(replay.counts.movementsCreated).toBe(0);
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_inventory_movements`).get() as { count: number }).count).toBe(6);
    } finally { sqlite.close(); }
  });

  it('classifies source drift instead of rewriting mapped movement evidence', async () => {
    const { sqlite, db } = backfillHarness();
    try {
      await backfillInventory(db, { tenantId: 'tenant-a',runPublicId: 'inventory-drift-1',nowUtc: '2026-07-14T06:00:00.000Z' });
      sqlite.exec(`UPDATE InventoryStockTransaction SET OutQuantity=4 WHERE TransactionId=101`);
      const result = await backfillInventory(db, { tenantId: 'tenant-a',runPublicId: 'inventory-drift-2',nowUtc: '2026-07-14T07:00:00.000Z' });
      expect(result.counts.movementsCreated).toBe(0);
      expect(result.counts.issuesCreated).toBeGreaterThan(0);
      const codes = sqlite.prepare(`SELECT issue_code FROM canonical_processing_issues ORDER BY id`).all() as Array<{ issue_code: string }>;
      expect(codes.map((row) => row.issue_code)).toContain('INVENTORY_SOURCE_DRIFT');
    } finally { sqlite.close(); }
  });

  it('resumes from checkpoints without duplicate movements and reuses terminal runs', async () => {
    const { sqlite, db } = backfillHarness();
    try {
      const partial = await backfillInventory(db, {
        tenantId: 'tenant-a',runPublicId: 'inventory-checkpoint',nowUtc: '2026-07-14T06:00:00.000Z',maxSourceRecords: 2,
      });
      expect(partial.completed).toBe(false);
      expect(partial.counts.scanned).toBe(2);
      const resumed = await backfillInventory(db, {
        tenantId: 'tenant-a',runPublicId: 'inventory-checkpoint',nowUtc: '2026-07-14T06:30:00.000Z',maxSourceRecords: 20,
      });
      expect(resumed.completed).toBe(true);
      expect((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_inventory_movements`).get() as { count: number }).count).toBe(6);
      const terminal = await backfillInventory(db, {
        tenantId: 'tenant-a',runPublicId: 'inventory-checkpoint',nowUtc: '2026-07-14T07:00:00.000Z',maxSourceRecords: 20,
      });
      expect(terminal.completed).toBe(true);
      expect(terminal.counts.scanned).toBe(0);
    } finally { sqlite.close(); }
  });

  it('records cache variance and unknown movement types as explicit issues', async () => {
    const { sqlite, db } = backfillHarness();
    try {
      sqlite.exec(`
        UPDATE InventoryStock SET AvailableQuantity=99 WHERE StockId=30;
        INSERT INTO InventoryStockTransaction VALUES
          (102,'tenant-a',10,30,20,'mystery','X',3,0,1,98,'2026-07-12',3,'2026-07-12 10:00:00'),
          (103,'tenant-a',10,30,20,'transfer','TR-1',4,0,1,97,'2026-07-13',4,'2026-07-13 10:00:00');
      `);
      const result = await backfillInventory(db, {
        tenantId: 'tenant-a',runPublicId: 'inventory-issues',nowUtc: '2026-07-14T06:00:00.000Z',
      });
      expect(result.counts.issuesCreated).toBeGreaterThanOrEqual(3);
      const codes = sqlite.prepare(`SELECT DISTINCT issue_code FROM canonical_processing_issues ORDER BY issue_code`).all() as Array<{ issue_code: string }>;
      expect(codes.map((row) => row.issue_code)).toEqual(expect.arrayContaining([
        'INVENTORY_BALANCE_VARIANCE',
        'INVENTORY_MOVEMENT_TYPE_UNKNOWN',
        'INVENTORY_TRANSFER_PAIR_UNRESOLVED',
      ]));
    } finally { sqlite.close(); }
  });
});

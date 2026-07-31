import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { mirrorInventoryLabReagentReceipt } from '../src/lib/lab-inventory-bridge';

const TENANT_ID = 92001;
const USER_ID = 992;

type SqliteValue = string | number | bigint | null | Uint8Array;
type RunMeta = { changes: number; last_row_id: number; duration: number };

class SqliteD1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.database,
      this.sql,
      params.map((param) => (param === undefined ? null : param)) as SqliteValue[],
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    const statement = this.database.prepare(this.sql);
    return { results: statement.all(...this.params) as T[], success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql);
    return (statement.get(...this.params) as T | undefined) ?? null;
  }

  async run(): Promise<{ success: boolean; meta: RunMeta }> {
    const statement = this.database.prepare(this.sql);
    const result = statement.run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.database.prepare(this.sql);
    const rows = statement.all(...this.params) as Record<string, unknown>[];
    return rows.map((row) => Object.values(row) as T);
  }
}

function createSqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1PreparedStatement(database, sql);
    },
    batch: async (statements: SqliteD1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.run())),
    exec: async (sql: string) => {
      database.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function applyInventoryBridgeSchema(sqlite: DatabaseSync): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE lab_test_catalog (id INTEGER PRIMARY KEY, code TEXT, name TEXT, tenant_id INTEGER);
    CREATE TABLE lab_orders (id INTEGER PRIMARY KEY, tenant_id INTEGER);
    CREATE TABLE radiology_requisitions (id INTEGER PRIMARY KEY);
    CREATE TABLE radiology_reports (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_machines (id INTEGER PRIMARY KEY);
    CREATE TABLE film_types (id INTEGER PRIMARY KEY);
    CREATE TABLE InventoryItem (
      ItemId INTEGER PRIMARY KEY,
      ItemName TEXT NOT NULL,
      ItemCode TEXT,
      ItemType TEXT,
      PurchasePrice INTEGER,
      ReOrderLevel INTEGER,
      StorageCondition TEXT,
      IsExpiryRequired INTEGER,
      tenant_id INTEGER NOT NULL
    );
  `);

  const migrationFiles = [
    '0170_lab_consumables_monitoring.sql',
    ...readdirSync('migrations')
      .filter((name) => /^037[2-9]_lab_(consumable|operation_logs|inventory_bridge)/.test(name))
      .sort(),
  ];

  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }

  sqlite.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(TENANT_ID, 'Inventory Bridge Tenant');
  sqlite.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(USER_ID, 'Lab Inventory Admin');
}

function createHarness(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  applyInventoryBridgeSchema(sqlite);
  return { sqlite, d1: createSqliteD1(sqlite) };
}

function seedInventoryItem(sqlite: DatabaseSync, options: { itemType: string; isExpiryRequired?: number; itemId?: number } = { itemType: 'lab_reagent' }): number {
  const itemId = options.itemId ?? 70001;
  sqlite.prepare(`
    INSERT INTO InventoryItem
      (ItemId, ItemName, ItemCode, ItemType, PurchasePrice, ReOrderLevel, StorageCondition, IsExpiryRequired, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    `Bridge Item ${itemId}`,
    `BR-${itemId}`,
    options.itemType,
    125,
    5,
    '2-8C',
    options.isExpiryRequired ?? 0,
    TENANT_ID,
  );
  return itemId;
}

describe('lab inventory bridge DB integration', () => {
  it('mirrors lab reagent inventory receipts as QC-pending lots even without inventory expiry requirement', async () => {
    const { sqlite, d1 } = createHarness();
    const itemId = seedInventoryItem(sqlite, { itemType: 'lab_reagent', isExpiryRequired: 0 });

    const result = await mirrorInventoryLabReagentReceipt(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      itemId,
      inventoryStockId: 88001,
      goodsReceiptItemId: 99001,
      batchNo: 'INV-LOT-1',
      expiryDate: null,
      quantity: 12,
      purchasePrice: 130,
      receivedDate: '2026-06-23',
      remarks: 'GRN bridge test',
    });

    expect(result).toMatchObject({ mirrored: true, skippedReason: null });

    const stock = sqlite.prepare(`
      SELECT s.qc_status, s.quantity_received, s.inventory_stock_id, s.goods_receipt_item_id, c.inventory_item_id
      FROM lab_consumable_stock s
      JOIN lab_consumables c ON c.id = s.consumable_id
      WHERE s.id = ?
    `).get(result.stockId) as {
      qc_status: string;
      quantity_received: number;
      inventory_stock_id: number;
      goods_receipt_item_id: number;
      inventory_item_id: number;
    };

    expect(stock).toMatchObject({
      qc_status: 'pending',
      quantity_received: 12,
      inventory_stock_id: 88001,
      goods_receipt_item_id: 99001,
      inventory_item_id: itemId,
    });

    const movement = sqlite.prepare(`
      SELECT movement_type, quantity, reference_type, reference_id
      FROM lab_consumable_movements
      WHERE stock_id = ?
    `).get(result.stockId) as { movement_type: string; quantity: number; reference_type: string; reference_id: number };

    expect(movement).toMatchObject({
      movement_type: 'purchase_in',
      quantity: 12,
      reference_type: 'inventory_gr_item',
      reference_id: 99001,
    });
  });

  it('rejects non-positive receipt quantities before writing lab stock ledger rows', async () => {
    const { sqlite, d1 } = createHarness();
    const itemId = seedInventoryItem(sqlite, { itemType: 'lab_reagent', isExpiryRequired: 1, itemId: 70002 });

    await expect(mirrorInventoryLabReagentReceipt(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      itemId,
      inventoryStockId: 88002,
      goodsReceiptItemId: 99002,
      batchNo: 'INV-ZERO-QTY',
      expiryDate: '2099-12-31',
      quantity: 0,
      purchasePrice: 130,
      receivedDate: '2026-06-23',
      remarks: 'invalid GRN bridge test',
    })).rejects.toThrow('quantity must be positive');

    const stockCount = sqlite.prepare('SELECT COUNT(*) AS count FROM lab_consumable_stock').get() as { count: number };
    const movementCount = sqlite.prepare('SELECT COUNT(*) AS count FROM lab_consumable_movements').get() as { count: number };

    expect(stockCount.count).toBe(0);
    expect(movementCount.count).toBe(0);
  });

  it('skips non-lab inventory items before applying lab reagent quantity validation', async () => {
    const { sqlite, d1 } = createHarness();
    const itemId = seedInventoryItem(sqlite, { itemType: 'general', itemId: 70003 });

    const result = await mirrorInventoryLabReagentReceipt(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      itemId,
      inventoryStockId: 88003,
      goodsReceiptItemId: 99003,
      batchNo: 'NON-LAB-ZERO-QTY',
      expiryDate: null,
      quantity: 0,
      purchasePrice: 50,
      receivedDate: '2026-06-23',
      remarks: 'non-lab inventory should be ignored',
    });

    expect(result).toMatchObject({
      mirrored: false,
      consumableId: null,
      stockId: null,
      skippedReason: 'not_lab_reagent',
    });

    const consumableCount = sqlite.prepare('SELECT COUNT(*) AS count FROM lab_consumables').get() as { count: number };
    const stockCount = sqlite.prepare('SELECT COUNT(*) AS count FROM lab_consumable_stock').get() as { count: number };
    const movementCount = sqlite.prepare('SELECT COUNT(*) AS count FROM lab_consumable_movements').get() as { count: number };

    expect(consumableCount.count).toBe(0);
    expect(stockCount.count).toBe(0);
    expect(movementCount.count).toBe(0);
  });
});

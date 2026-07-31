import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0410_inventory_goods_receipt_atomicity.sql', 'utf8');

describe('inventory goods receipt atomicity migration', () => {
  it('defines operation identity, replay status and the PO guard', () => {
    expect(migration).toContain('ALTER TABLE InventoryGoodsReceipt ADD COLUMN OperationKey TEXT');
    expect(migration).toContain('ALTER TABLE InventoryGoodsReceipt ADD COLUMN RequestHash TEXT');
    expect(migration).toContain("OperationStatus TEXT NOT NULL DEFAULT 'completed'");
    expect(migration).toContain('idx_inventory_gr_operation_key');
    expect(migration).toContain('inventory_gr_batch_guard');
    expect(migration).toContain('CHECK(assertion_value = 1)');
  });

  it('applies to an existing GR schema and enforces operation uniqueness and the guard', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE InventoryGoodsReceipt (
        GoodsReceiptId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        GRNumber TEXT,
        CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE InventoryGoodsReceiptItem (
        GRItemId INTEGER PRIMARY KEY AUTOINCREMENT,
        GoodsReceiptId INTEGER NOT NULL
      );
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        GRItemId INTEGER
      );
    `);

    sqlite.exec(migration);

    const columns = sqlite.prepare("PRAGMA table_info('InventoryGoodsReceipt')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'OperationKey',
      'RequestHash',
      'OperationStatus',
    ]));
    const itemColumns = sqlite.prepare("PRAGMA table_info('InventoryGoodsReceiptItem')").all() as Array<{ name: string }>;
    expect(itemColumns.map((column) => column.name)).toContain('OperationLineKey');
    const stockColumns = sqlite.prepare("PRAGMA table_info('InventoryStock')").all() as Array<{ name: string }>;
    expect(stockColumns.map((column) => column.name)).toContain('ReceiptOperationLineKey');

    sqlite.prepare(`
      INSERT INTO InventoryGoodsReceipt (tenant_id, GRNumber, OperationKey, RequestHash)
      VALUES ('tenant-a', 'GRN-1', 'op-1', 'hash-1')
    `).run();
    expect(() => sqlite.prepare(`
      INSERT INTO InventoryGoodsReceipt (tenant_id, GRNumber, OperationKey, RequestHash)
      VALUES ('tenant-a', 'GRN-2', 'op-1', 'hash-2')
    `).run()).toThrow();

    expect(() => sqlite.prepare(`
      INSERT INTO inventory_gr_batch_guard (tenant_id, operation_key, item_id, assertion_value)
      VALUES ('tenant-a', 'op-guard', 1, 0)
    `).run()).toThrow();
  });
});

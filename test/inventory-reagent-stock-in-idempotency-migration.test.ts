import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0421_lab_reagent_stock_in_idempotency.sql';

describe('reagent stock-in idempotency migration', () => {
  it('allows ordinary inventory references but rejects duplicate lab stock-in and backfill references per tenant', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE InventoryStockTransaction (
        TransactionId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        TransactionType TEXT NOT NULL,
        ReferenceNo TEXT
      );
    `);
    sqlite.exec(readFileSync(migrationPath, 'utf8'));

    const insert = sqlite.prepare(`
      INSERT INTO InventoryStockTransaction (tenant_id, TransactionType, ReferenceNo)
      VALUES (?, ?, ?)
    `);

    insert.run('tenant-a', 'purchase', 'REF-1');
    insert.run('tenant-a', 'purchase', 'REF-1');
    insert.run('tenant-a', 'lab-stock-in', 'LAB-STOCK-IN:key-1');
    insert.run('tenant-b', 'lab-stock-in', 'LAB-STOCK-IN:key-1');
    insert.run('tenant-a', 'lab-stock-in', null);
    insert.run('tenant-a', 'lab-stock-in', null);
    insert.run('tenant-a', 'lab-legacy-backfill', 'LAB-LEGACY-STOCK:1');

    expect(() => insert.run('tenant-a', 'lab-stock-in', 'LAB-STOCK-IN:key-1')).toThrow(/UNIQUE constraint failed/);
    expect(() => insert.run('tenant-a', 'lab-legacy-backfill', 'LAB-LEGACY-STOCK:1')).toThrow(/UNIQUE constraint failed/);
  });
});

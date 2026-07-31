import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0401_inventory_issue_request_atomicity.sql';

describe('inventory issue request atomicity migration', () => {
  it('adds operation journal, deterministic request keys and a rollback guard', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_issue_operation');
    expect(sql).toContain('UNIQUE (tenant_id, idempotency_key)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_issue_batch_guard');
    expect(sql).toContain('CHECK(assertion_value = 1)');
    expect(sql).toContain('ALTER TABLE InventoryConsumption ADD COLUMN OperationKey TEXT');
    expect(sql).toContain("ALTER TABLE InventoryConsumption ADD COLUMN OperationStatus TEXT NOT NULL DEFAULT 'completed'");
    expect(sql).toContain('ALTER TABLE InventoryConsumptionItem ADD COLUMN OperationAllocationKey TEXT');
    expect(sql).toContain('idx_inventory_consumption_operation_key');
    expect(sql).toContain('idx_inventory_consumption_item_allocation_key');
  });

  it('applies on the existing inventory schema and enforces the rollback assertion', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE InventoryConsumption (
        ConsumptionId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ConsumptionNo TEXT NOT NULL
      );
      CREATE TABLE InventoryConsumptionItem (
        ConsumptionItemId INTEGER PRIMARY KEY AUTOINCREMENT,
        ConsumptionId INTEGER NOT NULL
      );
    `);

    sqlite.exec(readFileSync(migrationPath, 'utf8'));

    const consumptionColumns = sqlite.prepare('PRAGMA table_info(InventoryConsumption)').all() as Array<{ name: string }>;
    const itemColumns = sqlite.prepare('PRAGMA table_info(InventoryConsumptionItem)').all() as Array<{ name: string }>;
    expect(consumptionColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'OperationKey',
      'OperationStatus',
    ]));
    expect(itemColumns.map((column) => column.name)).toContain('OperationAllocationKey');

    expect(() => sqlite.prepare(`
      INSERT INTO inventory_issue_batch_guard
        (tenant_id, operation_key, step_key, assertion_value)
      VALUES ('tenant-a', 'operation-a', 'stock-1', 0)
    `).run()).toThrow(/CHECK constraint failed/i);
  });
});

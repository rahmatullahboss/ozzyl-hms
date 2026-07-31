import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { recordInventoryDemand } from '../../src/lib/inventory-intelligence/demand';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: SqlValue[] = []) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE inventory_demand_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      demand_date DATE NOT NULL,
      source_scope TEXT NOT NULL,
      consumed_qty REAL NOT NULL DEFAULT 0,
      billed_event_count INTEGER NOT NULL DEFAULT 0,
      completed_event_count INTEGER NOT NULL DEFAULT 0,
      waste_qty REAL NOT NULL DEFAULT 0,
      adjustment_qty REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, inventory_item_id, demand_date, source_scope)
    );
    CREATE TABLE inventory_demand_source_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      demand_date DATE NOT NULL,
      source_scope TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, source_type, source_id)
    );
  `);
  const d1 = { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database;
  return { sqlite, d1 };
}

describe('inventory demand aggregation', () => {
  it('counts a duplicate source event only once and heals the daily aggregate', async () => {
    const { sqlite, d1 } = createDb();
    const input = {
      tenantId: 'tenant-1',
      itemId: 7,
      demandDate: '2026-07-10',
      quantity: 2,
      sourceScope: 'department_issue',
      sourceType: 'inventory_consumption_item',
      sourceId: '501',
    };

    expect((await recordInventoryDemand(d1, input)).recorded).toBe(true);
    expect((await recordInventoryDemand(d1, input)).recorded).toBe(false);

    const daily = sqlite.prepare(`
      SELECT consumed_qty, completed_event_count
      FROM inventory_demand_daily
      WHERE tenant_id = ? AND inventory_item_id = ? AND demand_date = ? AND source_scope = ?
    `).get('tenant-1', 7, '2026-07-10', 'department_issue') as any;

    expect(daily.consumed_qty).toBe(2);
    expect(daily.completed_event_count).toBe(1);
  });

  it('aggregates distinct events for the same item and day', async () => {
    const { sqlite, d1 } = createDb();

    await recordInventoryDemand(d1, {
      tenantId: 'tenant-1', itemId: 7, demandDate: '2026-07-10', quantity: 2,
      sourceScope: 'lab_consumption', sourceType: 'inventory_consumption_item', sourceId: '601',
    });
    await recordInventoryDemand(d1, {
      tenantId: 'tenant-1', itemId: 7, demandDate: '2026-07-10', quantity: 1.5,
      sourceScope: 'lab_consumption', sourceType: 'inventory_consumption_item', sourceId: '602',
    });

    const daily = sqlite.prepare('SELECT consumed_qty, completed_event_count FROM inventory_demand_daily').get() as any;
    expect(daily.consumed_qty).toBe(3.5);
    expect(daily.completed_event_count).toBe(2);
  });
});

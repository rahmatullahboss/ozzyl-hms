import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  applyBillingServiceCatalogMutation,
  applyBillingServiceCategoryPriceMutation,
  billingPriceMapCanonicalSourceKey,
  billingServiceCanonicalSourceKey,
} from '../../src/lib/canonical/service-catalog-route-integration';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      department_code TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,
      item_name TEXT NOT NULL,
      item_code TEXT,
      service_department_id INTEGER,
      price REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      tenant_id TEXT NOT NULL
    );
    CREATE TABLE billing_item_price_category_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      service_item_id INTEGER NOT NULL,
      price_category_id INTEGER NOT NULL,
      price REAL NOT NULL,
      is_discount_applicable INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT,
      UNIQUE(tenant_id,service_item_id,price_category_id)
    );
  `);
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0508_canonical_service_catalog.sql',
    '0569_service_catalog_route_identity.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec("INSERT INTO billing_service_departments (id,tenant_id,department_code,is_active) VALUES (1,'tenant-a','LAB',1)");

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

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('service catalog route integration', () => {
  it('commits legacy service, default category price, Canonical facts, mappings and outbox in one batch', async () => {
    const { sqlite, db } = harness();
    try {
      const serviceItemId = 10;
      const categoryId = 3;
      const sourceKey = billingServiceCanonicalSourceKey(serviceItemId);
      const mapKey = billingPriceMapCanonicalSourceKey(serviceItemId, categoryId);
      await applyBillingServiceCatalogMutation(db, {
        tenantId: 'tenant-a',
        canonicalSourceKey: sourceKey,
        snapshot: {
          serviceItemId,
          itemName: 'CBC',
          itemCode: 'LAB-CBC',
          departmentCode: 'LAB',
          price: 500,
          isActive: true,
        },
        defaultPriceCategoryId: categoryId,
        occurredAtUtc: '2026-07-29T10:00:00.000Z',
        businessDate: '2026-07-29',
        idempotencyKey: 'route-service-create-10',
      }, {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO billing_service_items
              (id,item_name,item_code,service_department_id,price,is_active,tenant_id,canonical_source_key)
            VALUES (?,?,?,?,?,?,?,?)
          `).bind(serviceItemId, 'CBC', 'LAB-CBC', 1, 500, 1, 'tenant-a', sourceKey),
          db.prepare(`
            INSERT INTO billing_item_price_category_maps
              (tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,canonical_source_key)
            VALUES (?,?,?,?,?,?,?)
          `).bind('tenant-a', serviceItemId, categoryId, 500, 1, 1, mapKey),
        ],
      });

      expect(count(sqlite, 'billing_service_items')).toBe(1);
      expect(count(sqlite, 'billing_item_price_category_maps')).toBe(1);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(1);
      expect(count(sqlite, 'canonical_service_prices')).toBe(2);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(3);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
      expect(sqlite.prepare(`SELECT canonical_source_key FROM billing_service_items WHERE id=10`).get())
        .toEqual({ canonical_source_key: sourceKey });
    } finally {
      sqlite.close();
    }
  });

  it('replaces and retires a category price while preserving immutable price history', async () => {
    const { sqlite, db } = harness();
    try {
      const serviceItemId = 10;
      const categoryId = 3;
      const sourceKey = billingServiceCanonicalSourceKey(serviceItemId);
      sqlite.prepare(`
        INSERT INTO billing_service_items
          (id,item_name,item_code,service_department_id,price,is_active,tenant_id,canonical_source_key)
        VALUES (10,'CBC','LAB-CBC',1,500,1,'tenant-a',?)
      `).run(sourceKey);
      await applyBillingServiceCatalogMutation(db, {
        tenantId: 'tenant-a',
        canonicalSourceKey: sourceKey,
        snapshot: { serviceItemId, itemName: 'CBC', itemCode: 'LAB-CBC', departmentCode: 'LAB', price: 500, isActive: true },
        occurredAtUtc: '2026-07-29T10:00:00.000Z',
        businessDate: '2026-07-29',
        idempotencyKey: 'bootstrap-service-10',
      });

      const mapKey = billingPriceMapCanonicalSourceKey(serviceItemId, categoryId);
      await applyBillingServiceCategoryPriceMutation(db, {
        tenantId: 'tenant-a', serviceItemId, priceCategoryId: categoryId, price: 650, isActive: true,
        occurredAtUtc: '2026-07-29T11:00:00.000Z', businessDate: '2026-07-29', idempotencyKey: 'price-create-10-3',
      }, {
        authoritativeStatements: [db.prepare(`
          INSERT INTO billing_item_price_category_maps
            (tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,canonical_source_key)
          VALUES ('tenant-a',10,3,650,1,1,?)
        `).bind(mapKey)],
      });
      await applyBillingServiceCategoryPriceMutation(db, {
        tenantId: 'tenant-a', serviceItemId, priceCategoryId: categoryId, price: 700, isActive: true,
        occurredAtUtc: '2026-07-29T12:00:00.000Z', businessDate: '2026-07-29', idempotencyKey: 'price-update-10-3',
      }, {
        authoritativeStatements: [db.prepare(`
          UPDATE billing_item_price_category_maps SET price=700 WHERE tenant_id='tenant-a' AND service_item_id=10 AND price_category_id=3
        `)],
      });
      await applyBillingServiceCategoryPriceMutation(db, {
        tenantId: 'tenant-a', serviceItemId, priceCategoryId: categoryId, price: 700, isActive: false,
        occurredAtUtc: '2026-07-29T13:00:00.000Z', businessDate: '2026-07-29', idempotencyKey: 'price-delete-10-3',
      }, {
        authoritativeStatements: [db.prepare(`
          UPDATE billing_item_price_category_maps SET is_active=0 WHERE tenant_id='tenant-a' AND service_item_id=10 AND price_category_id=3
        `)],
      });

      const rows = sqlite.prepare(`
        SELECT amount_minor,status FROM canonical_service_prices
        WHERE price_context_type='price_category' ORDER BY valid_from_utc
      `).all();
      expect(rows).toEqual([
        { amount_minor: 65_000, status: 'retired' },
        { amount_minor: 70_000, status: 'retired' },
      ]);
      expect(sqlite.prepare(`SELECT price,is_active FROM billing_item_price_category_maps`).get())
        .toEqual({ price: 700, is_active: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back legacy compatibility, Canonical facts, mappings and outbox when any statement fails', async () => {
    const { sqlite, db } = harness();
    try {
      const sourceKey = billingServiceCanonicalSourceKey(99);
      await expect(applyBillingServiceCatalogMutation(db, {
        tenantId: 'tenant-a',
        canonicalSourceKey: sourceKey,
        snapshot: { serviceItemId: 99, itemName: 'Rollback', itemCode: 'ROLLBACK', departmentCode: 'LAB', price: 100, isActive: true },
        occurredAtUtc: '2026-07-29T10:00:00.000Z',
        businessDate: '2026-07-29',
        idempotencyKey: 'rollback-service-route',
      }, {
        authoritativeStatements: [
          db.prepare(`INSERT INTO billing_service_items (id,item_name,price,is_active,tenant_id,canonical_source_key) VALUES (99,'Rollback',100,1,'tenant-a',?)`).bind(sourceKey),
          db.prepare(`INSERT INTO billing_service_items (id,item_name,price,is_active,tenant_id,canonical_source_key) VALUES (99,'Duplicate',100,1,'tenant-a',?)`).bind(sourceKey),
        ],
      })).rejects.toThrow();

      expect(count(sqlite, 'billing_service_items')).toBe(0);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(0);
      expect(count(sqlite, 'canonical_service_prices')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

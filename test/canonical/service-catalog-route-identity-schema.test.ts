import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('service catalog route identity migration', () => {
  it('adds tenant-scoped nullable unique source keys without rewriting existing rows', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE billing_service_items (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          item_name TEXT NOT NULL
        );
        CREATE TABLE billing_item_price_category_maps (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          service_item_id INTEGER NOT NULL,
          price_category_id INTEGER NOT NULL
        );
        INSERT INTO billing_service_items(id,tenant_id,item_name)
        VALUES (1,'tenant-a','Consultation');
        INSERT INTO billing_item_price_category_maps(id,tenant_id,service_item_id,price_category_id)
        VALUES (1,'tenant-a',1,1);
      `);
      sqlite.exec(readFileSync('migrations/0569_service_catalog_route_identity.sql', 'utf8'));

      expect(sqlite.prepare(`SELECT canonical_source_key FROM billing_service_items WHERE id=1`).get())
        .toEqual({ canonical_source_key: null });
      expect(sqlite.prepare(`SELECT canonical_source_key FROM billing_item_price_category_maps WHERE id=1`).get())
        .toEqual({ canonical_source_key: null });

      sqlite.exec(`
        INSERT INTO billing_service_items(id,tenant_id,item_name,canonical_source_key)
        VALUES
          (2,'tenant-a','Lab','service-key'),
          (3,'tenant-b','Lab','service-key'),
          (4,'tenant-a','Other A',NULL),
          (5,'tenant-a','Other B',NULL);
        INSERT INTO billing_item_price_category_maps(
          id,tenant_id,service_item_id,price_category_id,canonical_source_key
        ) VALUES
          (2,'tenant-a',2,1,'price-key'),
          (3,'tenant-b',3,1,'price-key'),
          (4,'tenant-a',4,1,NULL),
          (5,'tenant-a',5,1,NULL);
      `);

      expect(() => sqlite.exec(`
        INSERT INTO billing_service_items(id,tenant_id,item_name,canonical_source_key)
        VALUES (6,'tenant-a','Duplicate','service-key');
      `)).toThrow(/unique/i);
      expect(() => sqlite.exec(`
        INSERT INTO billing_item_price_category_maps(
          id,tenant_id,service_item_id,price_category_id,canonical_source_key
        ) VALUES (6,'tenant-a',6,1,'price-key');
      `)).toThrow(/unique/i);
    } finally {
      sqlite.close();
    }
  });
});

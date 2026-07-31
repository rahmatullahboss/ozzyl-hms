import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('service delivery route identity migration', () => {
  it('adds nullable tenant-unique source keys without rewriting existing rows', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE visit_services (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE TABLE billing_provisional_items (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          bill_status TEXT NOT NULL
        );
        INSERT INTO visit_services(id,tenant_id,status) VALUES (1,'tenant-a','pending');
        INSERT INTO billing_provisional_items(id,tenant_id,bill_status) VALUES (1,'tenant-a','provisional');
      `);
      sqlite.exec(readFileSync('migrations/0568_service_delivery_route_identity.sql', 'utf8'));

      expect(sqlite.prepare(`SELECT canonical_source_key FROM visit_services WHERE id=1`).get())
        .toEqual({ canonical_source_key: null });
      expect(sqlite.prepare(`SELECT canonical_source_key FROM billing_provisional_items WHERE id=1`).get())
        .toEqual({ canonical_source_key: null });

      sqlite.exec(`
        INSERT INTO visit_services(id,tenant_id,status,canonical_source_key)
        VALUES (2,'tenant-a','pending','service-source-1');
        INSERT INTO visit_services(id,tenant_id,status,canonical_source_key)
        VALUES (3,'tenant-b','pending','service-source-1');
        INSERT INTO billing_provisional_items(id,tenant_id,bill_status,canonical_source_key)
        VALUES (2,'tenant-a','provisional','provisional-source-1');
        INSERT INTO billing_provisional_items(id,tenant_id,bill_status,canonical_source_key)
        VALUES (3,'tenant-b','provisional','provisional-source-1');
      `);
      expect(() => sqlite.exec(`
        INSERT INTO visit_services(id,tenant_id,status,canonical_source_key)
        VALUES (4,'tenant-a','pending','service-source-1')
      `)).toThrow();
      expect(() => sqlite.exec(`
        INSERT INTO billing_provisional_items(id,tenant_id,bill_status,canonical_source_key)
        VALUES (4,'tenant-a','provisional','provisional-source-1')
      `)).toThrow();
    } finally {
      sqlite.close();
    }
  });
});

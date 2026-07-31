import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0561_compensation_rule_route_identity.sql', 'utf8');

describe('compensation rule route identity migration', () => {
  it('adds a nullable stable source key with tenant-scoped uniqueness', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE doctor_commission_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          doctor_id INTEGER NOT NULL
        );
      `);
      db.exec(migration);

      const columns = db.prepare('PRAGMA table_info(doctor_commission_rules)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('canonical_source_key');

      const indexes = db.prepare('PRAGMA index_list(doctor_commission_rules)').all() as Array<{ name: string; unique: number; partial: number }>;
      expect(indexes).toContainEqual(expect.objectContaining({
        name: 'uq_doctor_commission_rules_canonical_source_key',
        unique: 1,
        partial: 1,
      }));

      const insert = db.prepare(`
        INSERT INTO doctor_commission_rules (tenant_id,doctor_id,canonical_source_key)
        VALUES (?,?,?)
      `);
      insert.run('tenant-a', 1, 'route-rule-1');
      expect(() => insert.run('tenant-a', 2, 'route-rule-1')).toThrow();
      expect(() => insert.run('tenant-b', 2, 'route-rule-1')).not.toThrow();
      expect(() => insert.run('tenant-a', 3, null)).not.toThrow();
      expect(() => insert.run('tenant-a', 4, null)).not.toThrow();
    } finally {
      db.close();
    }
  });
});

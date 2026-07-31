import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0534_lab_order_clinical_attribution.sql';
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('lab order clinical attribution migration', () => {
  it('adds a nullable ordering clinician column without rewriting entered-by identity', () => {
    expect(migration).not.toBe('');
    expect(migration).toContain('ADD COLUMN ordering_clinician_doctor_id INTEGER');
    expect(migration).toContain('idx_lab_orders_ordering_clinician');
    expect(migration).not.toMatch(/UPDATE\s+lab_orders\s+SET\s+ordered_by/i);
  });

  it('backfills only an unambiguous same-tenant doctor profile', () => {
    expect(migration).not.toBe('');

    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE doctors (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id INTEGER
      );

      CREATE TABLE lab_orders (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ordered_by INTEGER,
        order_date TEXT
      );

      INSERT INTO doctors (id, tenant_id, user_id) VALUES
        (41, 'tenant-a', 7001),
        (51, 'tenant-a', 8001),
        (52, 'tenant-a', 8001),
        (61, 'tenant-b', 9001);

      INSERT INTO lab_orders (id, tenant_id, ordered_by, order_date) VALUES
        (1, 'tenant-a', 7001, '2026-07-23'),
        (2, 'tenant-a', 9001, '2026-07-23'),
        (3, 'tenant-a', 8001, '2026-07-23');
    `);

    sqlite.exec(migration);

    const rows = sqlite.prepare(`
      SELECT id, ordered_by, ordering_clinician_doctor_id
      FROM lab_orders
      ORDER BY id
    `).all() as Array<{
      id: number;
      ordered_by: number;
      ordering_clinician_doctor_id: number | null;
    }>;

    expect(rows).toEqual([
      { id: 1, ordered_by: 7001, ordering_clinician_doctor_id: 41 },
      { id: 2, ordered_by: 9001, ordering_clinician_doctor_id: null },
      { id: 3, ordered_by: 8001, ordering_clinician_doctor_id: null },
    ]);

    const index = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_lab_orders_ordering_clinician'
    `).get() as { name: string } | undefined;

    expect(index?.name).toBe('idx_lab_orders_ordering_clinician');
    sqlite.close();
  });
});

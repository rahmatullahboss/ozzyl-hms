import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0570_doctor_commission_rule_version_snapshot.sql';

function openLegacyDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE doctor_commission_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      rate_type TEXT NOT NULL,
      rate_value INTEGER NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      commission_rule_id INTEGER,
      commission_amount REAL NOT NULL DEFAULT 0
    );
    INSERT INTO doctor_commission_rules (
      tenant_id, doctor_id, service_type, rate_type, rate_value, updated_at
    ) VALUES ('tenant-a', 7, 'lab_test', 'percent', 2500, '2026-07-01 10:00:00');
    INSERT INTO doctor_commission_accruals (
      tenant_id, doctor_id, commission_rule_id, commission_amount
    ) VALUES ('tenant-a', 7, 1, 250);
  `);
  return sqlite;
}

function applyMigration(sqlite: DatabaseSync): void {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true);
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
}

describe('doctor commission rule explanation migration', () => {
  it('starts legacy rule version tracking without guessing existing accrual history', () => {
    const sqlite = openLegacyDatabase();
    applyMigration(sqlite);

    const rule = sqlite.prepare('SELECT rule_version FROM doctor_commission_rules WHERE id = 1').get() as { rule_version: number };
    const accrual = sqlite.prepare(`
      SELECT commission_rule_version_snapshot, commission_reason_code
      FROM doctor_commission_accruals
      WHERE id = 1
    `).get() as { commission_rule_version_snapshot: number | null; commission_reason_code: string | null };

    expect(rule.rule_version).toBe(1);
    expect(accrual).toEqual({
      commission_rule_version_snapshot: null,
      commission_reason_code: null,
    });
  });

  it('accepts only supported reason codes and positive snapshots', () => {
    const sqlite = openLegacyDatabase();
    applyMigration(sqlite);

    expect(() => sqlite.prepare(`
      UPDATE doctor_commission_accruals
      SET commission_rule_version_snapshot = 2,
          commission_reason_code = 'rule_matched'
      WHERE id = 1
    `).run()).not.toThrow();

    expect(() => sqlite.prepare(`
      UPDATE doctor_commission_accruals
      SET commission_reason_code = 'invented_success'
      WHERE id = 1
    `).run()).toThrow(/CHECK constraint failed/);

    expect(() => sqlite.prepare(`
      UPDATE doctor_commission_accruals
      SET commission_rule_version_snapshot = 0
      WHERE id = 1
    `).run()).toThrow(/CHECK constraint failed/);
  });

  it('requires tracked rule versions to stay positive', () => {
    const sqlite = openLegacyDatabase();
    applyMigration(sqlite);

    expect(() => sqlite.prepare(`
      UPDATE doctor_commission_rules SET rule_version = 0 WHERE id = 1
    `).run()).toThrow(/CHECK constraint failed/);
  });
});

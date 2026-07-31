import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0500_admin_exception_cases.sql';

function openMigratedDatabase(): DatabaseSync {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true);

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
  return sqlite;
}

describe('admin exception case migration', () => {
  it('creates tenant-scoped case and event tables with the approved lifecycle constraints', () => {
    const sqlite = openMigratedDatabase();
    const rows = sqlite.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('admin_exception_cases', 'admin_exception_events')
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;

    expect(rows.map((row) => row.name)).toEqual([
      'admin_exception_cases',
      'admin_exception_events',
    ]);

    const caseSql = rows.find((row) => row.name === 'admin_exception_cases')?.sql ?? '';
    expect(caseSql).toContain("CHECK(severity IN ('critical','warning','info'))");
    expect(caseSql).toContain(
      "CHECK(status IN ('open','acknowledged','in_progress','snoozed','resolved','dismissed'))",
    );
    expect(caseSql).toContain('UNIQUE(tenant_id, rule_key, fingerprint)');
    expect(caseSql).toContain('UNIQUE(tenant_id, id)');
    expect(caseSql).toContain('CHECK(json_valid(metadata_json))');

    const eventSql = rows.find((row) => row.name === 'admin_exception_events')?.sql ?? '';
    const normalizedEventSql = eventSql.replace(/\s+/g, ' ');
    expect(normalizedEventSql).toContain(
      'FOREIGN KEY(tenant_id, case_id) REFERENCES admin_exception_cases(tenant_id, id)',
    );
    expect(eventSql).toContain('CHECK(json_valid(metadata_json))');
  });

  it('enforces fingerprint uniqueness within one tenant and permits the same fingerprint across tenants', () => {
    const sqlite = openMigratedDatabase();
    const insert = sqlite.prepare(`
      INSERT INTO admin_exception_cases (
        tenant_id,
        rule_key,
        fingerprint,
        source_type,
        source_id,
        module,
        severity,
        title,
        description,
        first_detected_at,
        last_detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const values = [
      'tenant-a',
      'cash.stale_handover',
      'handover:42',
      'cash_handover',
      '42',
      'cash',
      'warning',
      'Stale handover',
      'The handover is still pending.',
      '2026-07-14 09:00:00',
      '2026-07-14 09:00:00',
    ] as const;

    insert.run(...values);
    expect(() => insert.run(...values)).toThrow(/UNIQUE constraint failed/);

    insert.run(
      'tenant-b',
      values[1],
      values[2],
      values[3],
      values[4],
      values[5],
      values[6],
      values[7],
      values[8],
      values[9],
      values[10],
    );
  });

  it('rejects invalid lifecycle values and orphan events', () => {
    const sqlite = openMigratedDatabase();

    const insertCase = sqlite.prepare(`
      INSERT INTO admin_exception_cases (
        tenant_id,
        rule_key,
        fingerprint,
        source_type,
        source_id,
        module,
        severity,
        title,
        description,
        status,
        first_detected_at,
        last_detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    expect(() => insertCase.run(
      'tenant-a',
      'billing.high_discount',
      'bill:1:discount',
      'bill',
      '1',
      'billing',
      'urgent',
      'High discount',
      'A discount exceeded policy.',
      'open',
      '2026-07-14 09:00:00',
      '2026-07-14 09:00:00',
    )).toThrow(/CHECK constraint failed/);

    expect(() => insertCase.run(
      'tenant-a',
      'billing.high_discount',
      'bill:2:discount',
      'bill',
      '2',
      'billing',
      'warning',
      'High discount',
      'A discount exceeded policy.',
      'closed',
      '2026-07-14 09:00:00',
      '2026-07-14 09:00:00',
    )).toThrow(/CHECK constraint failed/);

    expect(() => sqlite.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id,
        case_id,
        event_type
      ) VALUES (?, ?, ?)
    `).run('tenant-a', 999, 'acknowledged')).toThrow(/FOREIGN KEY constraint failed/);

    sqlite.prepare(`
      INSERT INTO admin_exception_cases (
        tenant_id,
        rule_key,
        fingerprint,
        source_type,
        source_id,
        module,
        severity,
        title,
        description,
        first_detected_at,
        last_detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'tenant-a',
      'inventory.low_stock',
      'medicine:9:low-stock',
      'medicine',
      '9',
      'inventory',
      'info',
      'Low stock',
      'Stock is below the threshold.',
      '2026-07-14 09:00:00',
      '2026-07-14 09:00:00',
    );
    const caseRow = sqlite.prepare(`
      SELECT id
      FROM admin_exception_cases
      WHERE tenant_id = 'tenant-a'
        AND fingerprint = 'medicine:9:low-stock'
    `).get() as { id: number };

    expect(() => sqlite.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id,
        case_id,
        event_type
      ) VALUES (?, ?, ?)
    `).run('tenant-b', caseRow.id, 'acknowledged')).toThrow(/FOREIGN KEY constraint failed/);

    expect(() => sqlite.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id,
        case_id,
        event_type,
        metadata_json
      ) VALUES (?, ?, ?, ?)
    `).run('tenant-a', caseRow.id, 'acknowledged', '{invalid')).toThrow(/CHECK constraint failed/);
  });

  it('creates the required tenant lifecycle and timeline indexes', () => {
    const sqlite = openMigratedDatabase();
    const indexes = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name LIKE 'idx_admin_exception_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_admin_exception_cases_assignee_status',
      'idx_admin_exception_cases_rule_last_detected',
      'idx_admin_exception_cases_status_severity_updated',
      'idx_admin_exception_events_case_created',
    ]);
  });
});

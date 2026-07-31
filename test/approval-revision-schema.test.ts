import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0549_approval_revision_policy.sql';
const prerequisiteMigrations = [
  'migrations/0279_approval_billing_shift_tables.sql',
  'migrations/0380_expand_approval_request_types.sql',
  'migrations/0381_create_approval_events.sql',
  'migrations/0382_approval_execution_lock.sql',
  'migrations/0516_two_person_approval_policy.sql',
  'migrations/0526_receivable_write_off_approval.sql',
] as const;

function openApprovalDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const path of prerequisiteMigrations) {
    expect(existsSync(path), `${path} should exist`).toBe(true);
    sqlite.exec(readFileSync(path, 'utf8'));
  }
  return sqlite;
}

function applyRevisionMigration(sqlite: DatabaseSync): void {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true);
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
}

function columnNames(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

describe('approval revision policy migration', () => {
  it('adds request and decision revision fields while preserving existing decisions', () => {
    const sqlite = openApprovalDatabase();
    const requestId = Number(sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data,
        status, required_approvals, approval_count, first_approved_at
      ) VALUES ('tenant-a', 'refund', 77, 9, '{}', 'pending', 2, 1, '2026-07-26 10:00:00')
    `).run().lastInsertRowid);
    sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id,
        approver_id, approver_role, decision, notes
      ) VALUES ('tenant-a', 'approval_requests', ?, 11, 'hospital_admin', 'approve', 'first review')
    `).run(requestId);

    applyRevisionMigration(sqlite);

    expect(columnNames(sqlite, 'approval_requests')).toContain('approval_revision');
    expect(columnNames(sqlite, 'approval_decisions')).toEqual(expect.arrayContaining([
      'approval_revision',
      'superseded_at',
      'superseded_by_revision',
      'superseded_reason',
    ]));

    expect(sqlite.prepare(`
      SELECT approval_revision, approval_count, first_approved_at
      FROM approval_requests WHERE id = ?
    `).get(requestId)).toMatchObject({
      approval_revision: 1,
      approval_count: 1,
      first_approved_at: '2026-07-26 10:00:00',
    });
    expect(sqlite.prepare(`
      SELECT approval_revision, approver_id, notes, superseded_at
      FROM approval_decisions WHERE approval_request_id = ?
    `).get(requestId)).toMatchObject({
      approval_revision: 1,
      approver_id: 11,
      notes: 'first review',
      superseded_at: null,
    });
  });

  it('allows the same approver once per revision and rejects a duplicate in the same revision', () => {
    const sqlite = openApprovalDatabase();
    const requestId = Number(sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data
      ) VALUES ('tenant-a', 'refund', 78, 9, '{}')
    `).run().lastInsertRowid);

    applyRevisionMigration(sqlite);

    sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id, approval_revision,
        approver_id, approver_role, decision
      ) VALUES ('tenant-a', 'approval_requests', ?, 1, 11, 'hospital_admin', 'approve')
    `).run(requestId);

    sqlite.prepare(`
      UPDATE approval_requests SET approval_revision = 2 WHERE id = ?
    `).run(requestId);
    sqlite.prepare(`
      UPDATE approval_decisions
      SET superseded_at = '2026-07-26 11:00:00',
          superseded_by_revision = 2,
          superseded_reason = 'More evidence required'
      WHERE approval_request_id = ? AND approval_revision = 1
    `).run(requestId);

    expect(() => sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id, approval_revision,
        approver_id, approver_role, decision
      ) VALUES ('tenant-a', 'approval_requests', ?, 2, 11, 'hospital_admin', 'approve')
    `).run(requestId)).not.toThrow();

    expect(() => sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id, approval_revision,
        approver_id, approver_role, decision
      ) VALUES ('tenant-a', 'approval_requests', ?, 2, 11, 'hospital_admin', 'approve')
    `).run(requestId)).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects incomplete supersession metadata', () => {
    const sqlite = openApprovalDatabase();
    applyRevisionMigration(sqlite);
    const requestId = Number(sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data
      ) VALUES ('tenant-a', 'refund', 79, 9, '{}')
    `).run().lastInsertRowid);

    expect(() => sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id, approval_revision,
        approver_id, approver_role, decision, superseded_at
      ) VALUES ('tenant-a', 'approval_requests', ?, 1, 11, 'hospital_admin', 'approve', '2026-07-26 11:00:00')
    `).run(requestId)).toThrow(/CHECK constraint failed/);
  });

  it('allows request-info and info-submitted events used by revision correction', () => {
    const sqlite = openApprovalDatabase();
    applyRevisionMigration(sqlite);
    const requestId = Number(sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data
      ) VALUES ('tenant-a', 'refund', 80, 9, '{}')
    `).run().lastInsertRowid);

    expect(() => sqlite.prepare(`
      INSERT INTO approval_events (
        tenant_id, approval_request_id, action, actor_id, old_status, new_status, notes
      ) VALUES ('tenant-a', ?, 'request_info', 11, 'pending', 'pending', 'Need evidence')
    `).run(requestId)).not.toThrow();
    expect(() => sqlite.prepare(`
      INSERT INTO approval_events (
        tenant_id, approval_request_id, action, actor_id, old_status, new_status, notes
      ) VALUES ('tenant-a', ?, 'info_submitted', 9, 'pending', 'pending', 'Evidence attached')
    `).run(requestId)).not.toThrow();
  });
});

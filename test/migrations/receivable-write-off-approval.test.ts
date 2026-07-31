import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { approvalTypeSchema } from '../../src/schemas/approval';

const migrationPath = 'migrations/0526_receivable_write_off_approval.sql';
const prerequisiteMigrations = [
  'migrations/0279_approval_billing_shift_tables.sql',
  'migrations/0380_expand_approval_request_types.sql',
  'migrations/0381_create_approval_events.sql',
  'migrations/0382_approval_execution_lock.sql',
  'migrations/0516_two_person_approval_policy.sql',
] as const;

function openCurrentApprovalDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  for (const path of prerequisiteMigrations) {
    expect(existsSync(path), `${path} should exist`).toBe(true);
    sqlite.exec(readFileSync(path, 'utf8'));
  }

  return sqlite;
}

function applyWriteOffMigration(sqlite: DatabaseSync): void {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true);
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
}

describe('receivable write-off approval migration', () => {
  it('adds the receivable_write_off type to the current approval table', () => {
    const sqlite = openCurrentApprovalDatabase();
    applyWriteOffMigration(sqlite);

    const table = sqlite.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'approval_requests'
    `).get() as { sql: string };
    const normalized = table.sql.replace(/\s+/g, ' ');

    for (const type of [
      'bill_edit',
      'bill_cancel',
      'discount',
      'refund',
      'payment_void',
      'cash_handover',
      'expense',
      'stock_adjustment',
      'doctor_payout',
      'manual_adjustment',
      'credit_note',
      'receivable_write_off',
    ]) {
      expect(normalized).toContain(`'${type}'`);
    }

    expect(() => sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data
      ) VALUES ('tenant-a', 'receivable_write_off', 101, 7, '{}')
    `).run()).not.toThrow();

    expect(() => sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data
      ) VALUES ('tenant-a', 'unsupported_adjustment', 102, 7, '{}')
    `).run()).toThrow(/CHECK constraint failed/);
  });

  it('preserves current execution-lock and two-person approval columns and row values', () => {
    const sqlite = openCurrentApprovalDatabase();
    sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id,
        type,
        entity_id,
        entity_no,
        requested_by,
        request_data,
        status,
        reviewed_by,
        reviewed_at,
        review_notes,
        created_at,
        execution_status,
        execution_attempts,
        execution_started_at,
        execution_completed_at,
        execution_error,
        locked_by,
        locked_at,
        required_approvals,
        approval_count,
        first_approved_at,
        fully_approved_at
      ) VALUES (
        'tenant-a',
        'manual_adjustment',
        55,
        'ADJ-55',
        11,
        '{"reason":"existing"}',
        'approved',
        12,
        '2026-07-22 12:00:00',
        'reviewed',
        '2026-07-22 10:00:00',
        'succeeded',
        2,
        '2026-07-22 11:00:00',
        '2026-07-22 12:00:00',
        NULL,
        12,
        '2026-07-22 11:00:00',
        3,
        3,
        '2026-07-22 11:30:00',
        '2026-07-22 12:00:00'
      )
    `).run();

    applyWriteOffMigration(sqlite);

    const columns = sqlite.prepare('PRAGMA table_info(approval_requests)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'tenant_id',
      'type',
      'entity_id',
      'entity_no',
      'requested_by',
      'request_data',
      'status',
      'reviewed_by',
      'reviewed_at',
      'review_notes',
      'created_at',
      'execution_status',
      'execution_attempts',
      'execution_started_at',
      'execution_completed_at',
      'execution_error',
      'locked_by',
      'locked_at',
      'required_approvals',
      'approval_count',
      'first_approved_at',
      'fully_approved_at',
    ]);

    const row = sqlite.prepare(`
      SELECT * FROM approval_requests WHERE tenant_id = 'tenant-a' AND entity_id = 55
    `).get() as Record<string, unknown>;
    expect(row).toMatchObject({
      type: 'manual_adjustment',
      entity_no: 'ADJ-55',
      requested_by: 11,
      status: 'approved',
      reviewed_by: 12,
      review_notes: 'reviewed',
      execution_status: 'succeeded',
      execution_attempts: 2,
      locked_by: 12,
      required_approvals: 3,
      approval_count: 3,
      first_approved_at: '2026-07-22 11:30:00',
      fully_approved_at: '2026-07-22 12:00:00',
    });
  });

  it('preserves approval events when D1 applies the migration inside an active transaction', () => {
    const sqlite = openCurrentApprovalDatabase();
    const approval = sqlite.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, requested_by, request_data
      ) VALUES ('tenant-a', 'refund', 77, 9, '{}')
    `).run();
    sqlite.prepare(`
      INSERT INTO approval_events (
        tenant_id, approval_request_id, action, actor_id, old_status, new_status, notes, metadata
      ) VALUES ('tenant-a', ?, 'created', 9, NULL, 'pending', 'existing event', '{}')
    `).run(Number(approval.lastInsertRowid));

    sqlite.exec('BEGIN IMMEDIATE;');
    applyWriteOffMigration(sqlite);
    sqlite.exec('COMMIT;');

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM approval_requests').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM approval_events').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(`
      SELECT action, notes
      FROM approval_events
      WHERE approval_request_id = ?
    `).get(Number(approval.lastInsertRowid))).toEqual({
      action: 'created',
      notes: 'existing event',
    });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('recreates every current approval queue and execution index', () => {
    const sqlite = openCurrentApprovalDatabase();
    applyWriteOffMigration(sqlite);

    const indexes = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_approval_requests_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_approval_requests_entity',
      'idx_approval_requests_execution_status',
      'idx_approval_requests_progress',
      'idx_approval_requests_tenant',
      'idx_approval_requests_tenant_status_created',
      'idx_approval_requests_tenant_status_type_created',
      'idx_approval_requests_tenant_type_status',
    ]);
  });

  it('exposes receivable_write_off through the shared approval type schema', () => {
    expect(approvalTypeSchema.safeParse('receivable_write_off').success).toBe(true);
  });
});

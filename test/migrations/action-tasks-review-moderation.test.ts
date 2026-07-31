import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const providerReviewsMigrationPath = 'migrations/0121_provider_reviews.sql';
const migrationPath = 'migrations/0503_action_tasks_review_moderation.sql';

function openMigratedDatabase(): DatabaseSync {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true);

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(providerReviewsMigrationPath, 'utf8'));
  sqlite.prepare(`
    INSERT INTO provider_reviews (
      reviewer_global_patient_id,
      target_type,
      target_tenant_id,
      rating,
      review_text
    ) VALUES (?, ?, ?, ?, ?)
  `).run('patient-public-1', 'hospital', 'tenant-a', 5, 'Existing review');
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
  return sqlite;
}

function insertTask(
  sqlite: DatabaseSync,
  input: {
    tenantId: string;
    title?: string;
    sourceType?: string | null;
    sourcePublicId?: string | null;
    sourceMetadataJson?: string;
    priority?: string;
    status?: string;
    dueAtUtc?: string | null;
    completedBy?: number | null;
    completedAtUtc?: string | null;
    completionNote?: string | null;
  },
): number {
  const result = sqlite.prepare(`
    INSERT INTO admin_action_tasks (
      tenant_id,
      title,
      source_type,
      source_public_id,
      source_metadata_json,
      priority,
      status,
      due_at_utc,
      completed_by,
      completed_at_utc,
      completion_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.tenantId,
    input.title ?? 'Follow up',
    input.sourceType ?? null,
    input.sourcePublicId ?? null,
    input.sourceMetadataJson ?? '{}',
    input.priority ?? 'medium',
    input.status ?? 'open',
    input.dueAtUtc ?? null,
    input.completedBy ?? null,
    input.completedAtUtc ?? null,
    input.completionNote ?? null,
  );

  return Number(result.lastInsertRowid);
}

describe('action tasks and review moderation migration', () => {
  it('adds persistent task tables and backward-compatible structured review columns without losing reviews', () => {
    const sqlite = openMigratedDatabase();
    const tables = sqlite.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          'admin_action_tasks',
          'admin_action_task_events',
          'provider_review_moderation_events'
        )
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      'admin_action_task_events',
      'admin_action_tasks',
      'provider_review_moderation_events',
    ]);

    const taskSql = tables.find((row) => row.name === 'admin_action_tasks')?.sql.replace(/\s+/g, ' ') ?? '';
    expect(taskSql).toContain("CHECK(priority IN ('critical','high','medium','low'))");
    expect(taskSql).toContain("CHECK(status IN ('open','in_progress','completed','cancelled'))");
    expect(taskSql).toContain('CHECK(json_valid(source_metadata_json))');
    expect(taskSql).toContain('UNIQUE(tenant_id, id)');

    const taskEventSql = tables.find((row) => row.name === 'admin_action_task_events')?.sql.replace(/\s+/g, ' ') ?? '';
    expect(taskEventSql).toContain('CHECK(json_valid(metadata_json))');
    expect(taskEventSql).toContain(
      'FOREIGN KEY(tenant_id, task_id) REFERENCES admin_action_tasks(tenant_id, id)',
    );

    const moderationEventSql = tables.find((row) => row.name === 'provider_review_moderation_events')?.sql.replace(/\s+/g, ' ') ?? '';
    expect(moderationEventSql).toContain('CHECK(json_valid(metadata_json))');
    expect(moderationEventSql).toContain(
      'FOREIGN KEY(tenant_id, review_id) REFERENCES provider_reviews(target_tenant_id, id)',
    );

    const reviewColumns = sqlite.prepare(`PRAGMA table_info('provider_reviews')`).all() as Array<{ name: string }>;
    expect(reviewColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'moderation_reason_code',
      'moderation_note',
      'moderated_by',
      'moderated_at_utc',
      'provider_reply',
      'provider_reply_at_utc',
      'provider_reply_by',
      'moderation_reason',
      'moderated_at',
      'provider_reply_at',
    ]));

    expect(sqlite.prepare(`SELECT review_text FROM provider_reviews WHERE id = 1`).get()).toEqual({
      review_text: 'Existing review',
    });
  });

  it('enforces tenant-scoped source uniqueness and task lifecycle, JSON, and UTC constraints', () => {
    const sqlite = openMigratedDatabase();

    insertTask(sqlite, {
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:10',
      dueAtUtc: '2026-07-20T04:00:00.000Z',
    });

    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:10',
    })).toThrow(/UNIQUE constraint failed/);

    insertTask(sqlite, {
      tenantId: 'tenant-b',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:10',
    });

    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: null,
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      sourceType: 'invoice',
      sourcePublicId: 'invoice:10',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      sourceMetadataJson: '{invalid',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      dueAtUtc: '2026-07-20 04:00:00',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      priority: 'urgent',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      status: 'completed',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask(sqlite, {
      tenantId: 'tenant-a',
      status: 'open',
      completedBy: 7,
      completedAtUtc: '2026-07-20T04:00:00.000Z',
      completionNote: 'Done',
    })).toThrow(/CHECK constraint failed/);

    insertTask(sqlite, {
      tenantId: 'tenant-a',
      status: 'completed',
      completedBy: 7,
      completedAtUtc: '2026-07-20T04:00:00.000Z',
      completionNote: 'Completed with evidence.',
    });
  });

  it('enforces task event JSON, lifecycle values, and the composite tenant boundary', () => {
    const sqlite = openMigratedDatabase();
    const taskId = insertTask(sqlite, {
      tenantId: 'tenant-a',
      sourceType: 'exception',
      sourcePublicId: 'exception-case:20',
    });
    const insertEvent = sqlite.prepare(`
      INSERT INTO admin_action_task_events (
        tenant_id,
        task_id,
        event_type,
        old_status,
        new_status,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    expect(() => insertEvent.run(
      'tenant-b',
      taskId,
      'assigned',
      'open',
      'open',
      '{}',
    )).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      taskId,
      'assigned',
      'pending',
      'open',
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      taskId,
      'assigned',
      'open',
      'open',
      '{invalid',
    )).toThrow(/CHECK constraint failed/);

    insertEvent.run(
      'tenant-a',
      taskId,
      'assigned',
      'open',
      'open',
      JSON.stringify({ assignedTo: 7 }),
    );
  });

  it('enforces structured moderation reasons, state values, JSON, and review tenant isolation', () => {
    const sqlite = openMigratedDatabase();
    const insertEvent = sqlite.prepare(`
      INSERT INTO provider_review_moderation_events (
        tenant_id,
        review_id,
        event_type,
        actor_id,
        reason_code,
        old_state,
        new_state,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    expect(() => insertEvent.run(
      'tenant-b',
      1,
      'approved',
      7,
      null,
      0,
      1,
      '{}',
    )).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'rejected',
      7,
      null,
      0,
      -1,
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'rejected',
      7,
      'not_a_reason',
      0,
      -1,
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'approved',
      7,
      null,
      2,
      1,
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'approved',
      7,
      null,
      null,
      1,
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'approved',
      7,
      'spam',
      0,
      1,
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'reply_posted',
      7,
      null,
      0,
      1,
      '{}',
    )).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent.run(
      'tenant-a',
      1,
      'approved',
      7,
      null,
      0,
      1,
      '{invalid',
    )).toThrow(/CHECK constraint failed/);

    insertEvent.run(
      'tenant-a',
      1,
      'rejected',
      7,
      'spam',
      0,
      -1,
      JSON.stringify({ source: 'moderation-drawer' }),
    );
  });

  it('creates task queue, source, event, and review moderation timeline indexes', () => {
    const sqlite = openMigratedDatabase();
    const indexes = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND (
          name LIKE 'idx_admin_action_%'
          OR name = 'uq_admin_action_tasks_source'
          OR name = 'uq_provider_reviews_tenant_id'
          OR name = 'idx_provider_review_moderation_events_review_created'
        )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_admin_action_task_events_task_created',
      'idx_admin_action_tasks_assignee_status',
      'idx_admin_action_tasks_status_due',
      'idx_provider_review_moderation_events_review_created',
      'uq_admin_action_tasks_source',
      'uq_provider_reviews_tenant_id',
    ]);
  });
});

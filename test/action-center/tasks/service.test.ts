import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness, type SqliteD1Harness } from '../../helpers/sqlite-d1';
import {
  TaskValidationError,
  createManualTask,
  transitionTask,
  upsertSourceTask,
} from '../../../src/services/actionCenter/tasks/service';

function createHarness(): SqliteD1Harness {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(readFileSync('migrations/0121_provider_reviews.sql', 'utf8'));
  harness.sqlite.exec(readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8'));
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    INSERT INTO users (id, tenant_id, name) VALUES
      (7, 'tenant-a', 'Task Admin'),
      (8, 'tenant-a', 'Task Owner'),
      (20, 'tenant-b', 'Other Tenant User');
  `);
  return harness;
}

function taskRow(harness: SqliteD1Harness, taskId: number): Record<string, unknown> {
  return harness.sqlite.prepare(`
    SELECT
      id,
      tenant_id,
      title,
      description,
      source_type,
      source_public_id,
      source_href,
      source_metadata_json,
      priority,
      status,
      assigned_to,
      due_at_utc,
      completed_by,
      completed_at_utc,
      completion_note,
      created_by,
      created_at_utc,
      updated_at_utc
    FROM admin_action_tasks
    WHERE id = ?
  `).get(taskId) as Record<string, unknown>;
}

function eventRows(harness: SqliteD1Harness, taskId: number): Array<Record<string, unknown>> {
  return harness.sqlite.prepare(`
    SELECT event_type, actor_id, old_status, new_status, note, metadata_json, created_at_utc
    FROM admin_action_task_events
    WHERE task_id = ?
    ORDER BY id
  `).all(taskId) as Array<Record<string, unknown>>;
}

describe('persistent task service', () => {
  it('deduplicates and updates one source-linked task without appending no-op events', async () => {
    const harness = createHarness();
    const firstId = await upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:101',
      sourceHref: '/action/collections?case=101',
      sourceMetadata: { legacyBillId: 501, collectionCaseId: 101 },
      title: 'Follow up collection',
      description: 'Call the patient.',
      priority: 'high',
      assignedTo: 8,
      dueAtUtc: '2026-07-20T04:00:00.000Z',
      actorId: 7,
      nowUtc: '2026-07-15T04:00:00.000Z',
    });

    const secondId = await upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:101',
      sourceHref: '/action/collections?case=101&authority=canonical',
      sourceMetadata: {
        legacyBillId: 501,
        canonicalInvoicePublicId: 'invoice-public-501',
        collectionCaseId: 101,
      },
      title: 'Follow up canonical collection',
      description: 'Call the patient and record the outcome.',
      priority: 'critical',
      assignedTo: 8,
      dueAtUtc: '2026-07-21T04:00:00.000Z',
      actorId: 7,
      nowUtc: '2026-07-15T04:01:00.000Z',
    });

    const thirdId = await upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:101',
      sourceHref: '/action/collections?case=101&authority=canonical',
      sourceMetadata: {
        legacyBillId: 501,
        canonicalInvoicePublicId: 'invoice-public-501',
        collectionCaseId: 101,
      },
      title: 'Follow up canonical collection',
      description: 'Call the patient and record the outcome.',
      priority: 'critical',
      assignedTo: 8,
      dueAtUtc: '2026-07-21T04:00:00.000Z',
      actorId: 7,
      nowUtc: '2026-07-15T04:02:00.000Z',
    });

    expect(firstId).toBe(secondId);
    expect(secondId).toBe(thirdId);
    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM admin_action_tasks`).get()).toEqual({ count: 1 });
    expect(taskRow(harness, firstId)).toEqual(expect.objectContaining({
      title: 'Follow up canonical collection',
      source_href: '/action/collections?case=101&authority=canonical',
      source_metadata_json: JSON.stringify({
        legacyBillId: 501,
        canonicalInvoicePublicId: 'invoice-public-501',
        collectionCaseId: 101,
      }),
      priority: 'critical',
      assigned_to: 8,
      due_at_utc: '2026-07-21T04:00:00.000Z',
      updated_at_utc: '2026-07-15T04:01:00.000Z',
    }));
    expect(eventRows(harness, firstId).map((row) => row.event_type)).toEqual([
      'created',
      'source_updated',
    ]);
  });

  it('does not passively reopen completed source work and requires an explicit due follow-up to reopen it', async () => {
    const harness = createHarness();
    const taskId = await upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'exception',
      sourcePublicId: 'exception-case:44',
      sourceHref: '/action/exceptions?case=44',
      sourceMetadata: { exceptionCaseId: 44 },
      title: 'Investigate exception',
      priority: 'high',
      assignedTo: 8,
      actorId: 7,
      nowUtc: '2026-07-15T05:00:00.000Z',
    });
    const updatedAtUtc = String(taskRow(harness, taskId).updated_at_utc);

    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 8,
      expectedUpdatedAtUtc: updatedAtUtc,
      transition: { action: 'complete', note: 'Source reviewed; task evidence recorded.' },
      nowUtc: '2026-07-15T05:01:00.000Z',
    })).toBe('updated');

    await upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'exception',
      sourcePublicId: 'exception-case:44',
      sourceHref: '/action/exceptions?case=44&source=canonical',
      sourceMetadata: {
        exceptionCaseId: 44,
        canonicalInvoicePublicId: 'invoice-public-44',
      },
      title: 'Investigate exception again',
      priority: 'critical',
      assignedTo: 8,
      actorId: 7,
      nowUtc: '2026-07-15T05:02:00.000Z',
    });

    expect(taskRow(harness, taskId)).toEqual(expect.objectContaining({
      status: 'completed',
      title: 'Investigate exception',
      source_href: '/action/exceptions?case=44&source=canonical',
      source_metadata_json: JSON.stringify({
        canonicalInvoicePublicId: 'invoice-public-44',
        exceptionCaseId: 44,
      }),
      completed_by: 8,
      completed_at_utc: '2026-07-15T05:01:00.000Z',
      completion_note: 'Source reviewed; task evidence recorded.',
    }));
    expect(eventRows(harness, taskId).map((row) => row.event_type)).toEqual([
      'created',
      'completed',
      'source_relinked',
    ]);

    await expect(upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'exception',
      sourcePublicId: 'exception-case:44',
      sourceHref: '/action/exceptions?case=44',
      sourceMetadata: { exceptionCaseId: 44 },
      title: 'Investigate exception again',
      priority: 'critical',
      assignedTo: 8,
      actorId: 7,
      reopenCompleted: true,
      nowUtc: '2026-07-15T05:03:00.000Z',
    })).rejects.toBeInstanceOf(TaskValidationError);

    const reopenedId = await upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'exception',
      sourcePublicId: 'exception-case:44',
      sourceHref: '/action/exceptions?case=44',
      sourceMetadata: { exceptionCaseId: 44 },
      title: 'Investigate exception again',
      priority: 'critical',
      assignedTo: 8,
      dueAtUtc: '2026-07-22T04:00:00.000Z',
      actorId: 7,
      reopenCompleted: true,
      nowUtc: '2026-07-15T05:04:00.000Z',
    });

    expect(reopenedId).toBe(taskId);
    expect(taskRow(harness, taskId)).toEqual(expect.objectContaining({
      status: 'open',
      title: 'Investigate exception again',
      completed_by: null,
      completed_at_utc: null,
      completion_note: null,
      due_at_utc: '2026-07-22T04:00:00.000Z',
    }));
    expect(eventRows(harness, taskId).map((row) => row.event_type)).toEqual([
      'created',
      'completed',
      'source_relinked',
      'reopened',
    ]);
  });

  it('creates manual tasks with a stable generated identity and one creation event', async () => {
    const harness = createHarness();
    const taskId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Review weekly operations',
      description: 'Prepare the weekly operational summary.',
      priority: 'medium',
      assignedTo: 8,
      dueAtUtc: '2026-07-25T04:00:00.000Z',
      actorId: 7,
      nowUtc: '2026-07-15T06:00:00.000Z',
    });

    const row = taskRow(harness, taskId);
    expect(row).toEqual(expect.objectContaining({
      tenant_id: 'tenant-a',
      title: 'Review weekly operations',
      source_type: 'manual',
      source_href: null,
      priority: 'medium',
      assigned_to: 8,
      created_by: 7,
      status: 'open',
    }));
    expect(String(row.source_public_id)).toMatch(/^manual-task:[0-9a-f-]{36}$/);
    expect(eventRows(harness, taskId)).toEqual([
      expect.objectContaining({
        event_type: 'created',
        actor_id: 7,
        old_status: null,
        new_status: 'open',
      }),
    ]);
  });

  it('assigns, starts, and reschedules tasks with append-only actor events', async () => {
    const harness = createHarness();
    const taskId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Operational follow-up',
      priority: 'low',
      actorId: 7,
      nowUtc: '2026-07-15T07:00:00.000Z',
    });

    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T07:00:00.000Z',
      transition: { action: 'assign', assignedTo: 8, note: 'Assign to operations owner.' },
      nowUtc: '2026-07-15T07:01:00.000Z',
    })).toBe('updated');
    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 8,
      expectedUpdatedAtUtc: '2026-07-15T07:01:00.000Z',
      transition: { action: 'start', note: 'Work started.' },
      nowUtc: '2026-07-15T07:02:00.000Z',
    })).toBe('updated');
    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 8,
      expectedUpdatedAtUtc: '2026-07-15T07:02:00.000Z',
      transition: {
        action: 'reschedule',
        dueAtUtc: '2026-07-26T04:00:00.000Z',
        note: 'Waiting for the report.',
      },
      nowUtc: '2026-07-15T07:03:00.000Z',
    })).toBe('updated');

    expect(taskRow(harness, taskId)).toEqual(expect.objectContaining({
      status: 'in_progress',
      assigned_to: 8,
      due_at_utc: '2026-07-26T04:00:00.000Z',
      updated_at_utc: '2026-07-15T07:03:00.000Z',
    }));
    expect(eventRows(harness, taskId).map((row) => ({
      eventType: row.event_type,
      actorId: row.actor_id,
      oldStatus: row.old_status,
      newStatus: row.new_status,
    }))).toEqual([
      { eventType: 'created', actorId: 7, oldStatus: null, newStatus: 'open' },
      { eventType: 'assigned', actorId: 7, oldStatus: 'open', newStatus: 'open' },
      { eventType: 'started', actorId: 8, oldStatus: 'open', newStatus: 'in_progress' },
      { eventType: 'rescheduled', actorId: 8, oldStatus: 'in_progress', newStatus: 'in_progress' },
    ]);
  });

  it('requires completion and cancellation evidence and blocks terminal transitions', async () => {
    const harness = createHarness();
    const completeId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Complete me',
      priority: 'medium',
      actorId: 7,
      nowUtc: '2026-07-15T08:00:00.000Z',
    });

    await expect(transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId: completeId,
      actorId: 7,
      transition: { action: 'complete', note: '   ' },
      nowUtc: '2026-07-15T08:01:00.000Z',
    })).rejects.toBeInstanceOf(TaskValidationError);

    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId: completeId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T08:00:00.000Z',
      transition: { action: 'complete', note: 'Evidence attached.' },
      nowUtc: '2026-07-15T08:02:00.000Z',
    })).toBe('updated');
    expect(taskRow(harness, completeId)).toEqual(expect.objectContaining({
      status: 'completed',
      completed_by: 7,
      completed_at_utc: '2026-07-15T08:02:00.000Z',
      completion_note: 'Evidence attached.',
    }));
    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId: completeId,
      actorId: 7,
      transition: { action: 'start' },
      nowUtc: '2026-07-15T08:03:00.000Z',
    })).toBe('conflict');

    const cancelId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Cancel me',
      priority: 'low',
      actorId: 7,
      nowUtc: '2026-07-15T08:10:00.000Z',
    });
    await expect(transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId: cancelId,
      actorId: 7,
      transition: { action: 'cancel', note: '' },
      nowUtc: '2026-07-15T08:11:00.000Z',
    })).rejects.toBeInstanceOf(TaskValidationError);
    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId: cancelId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T08:10:00.000Z',
      transition: { action: 'cancel', note: 'No longer required.' },
      nowUtc: '2026-07-15T08:12:00.000Z',
    })).toBe('updated');
    expect(taskRow(harness, cancelId)).toEqual(expect.objectContaining({
      status: 'cancelled',
      completed_by: null,
      completed_at_utc: null,
      completion_note: null,
    }));
  });

  it('returns conflicts for stale writes without appending an event', async () => {
    const harness = createHarness();
    const taskId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Concurrency check',
      priority: 'medium',
      actorId: 7,
      nowUtc: '2026-07-15T09:00:00.000Z',
    });

    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T09:00:00.000Z',
      transition: { action: 'reschedule', dueAtUtc: '2026-07-30T04:00:00.000Z' },
      nowUtc: '2026-07-15T09:01:00.000Z',
    })).toBe('updated');
    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T09:00:00.000Z',
      transition: { action: 'reschedule', dueAtUtc: '2026-07-31T04:00:00.000Z' },
      nowUtc: '2026-07-15T09:02:00.000Z',
    })).toBe('conflict');

    expect(taskRow(harness, taskId)).toEqual(expect.objectContaining({
      due_at_utc: '2026-07-30T04:00:00.000Z',
      updated_at_utc: '2026-07-15T09:01:00.000Z',
    }));
    expect(eventRows(harness, taskId).map((row) => row.event_type)).toEqual(['created', 'rescheduled']);
  });

  it('advances optimistic timestamps when two mutations share the same requested millisecond', async () => {
    const harness = createHarness();
    const taskId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Same millisecond task',
      priority: 'medium',
      actorId: 7,
      nowUtc: '2026-07-15T09:30:00.000Z',
    });

    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T09:30:00.000Z',
      transition: { action: 'assign', assignedTo: 8 },
      nowUtc: '2026-07-15T09:30:00.000Z',
    })).toBe('updated');

    expect(taskRow(harness, taskId)).toEqual(expect.objectContaining({
      assigned_to: 8,
      updated_at_utc: '2026-07-15T09:30:00.001Z',
    }));
    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T09:30:00.000Z',
      transition: { action: 'start' },
      nowUtc: '2026-07-15T09:30:00.000Z',
    })).toBe('conflict');
    expect(eventRows(harness, taskId).map((row) => row.event_type)).toEqual(['created', 'assigned']);
  });

  it('enforces tenant isolation and tenant-safe assignees', async () => {
    const harness = createHarness();
    const taskId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Tenant task',
      priority: 'medium',
      actorId: 7,
      nowUtc: '2026-07-15T10:00:00.000Z',
    });

    expect(await transitionTask({
      db: harness.db,
      tenantId: 'tenant-b',
      taskId,
      actorId: 20,
      transition: { action: 'start' },
      nowUtc: '2026-07-15T10:01:00.000Z',
    })).toBe('not_found');

    await expect(transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      transition: { action: 'assign', assignedTo: 20 },
      nowUtc: '2026-07-15T10:02:00.000Z',
    })).rejects.toBeInstanceOf(TaskValidationError);
    await expect(upsertSourceTask({
      db: harness.db,
      tenantId: 'tenant-a',
      sourceType: 'collection',
      sourcePublicId: 'collection-case:bad-assignee',
      sourceHref: '/action/collections',
      sourceMetadata: { legacyBillId: 0 },
      title: 'Invalid source metadata',
      priority: 'medium',
      assignedTo: 20,
      actorId: 7,
      nowUtc: '2026-07-15T10:03:00.000Z',
    })).rejects.toBeInstanceOf(TaskValidationError);

    expect(eventRows(harness, taskId)).toHaveLength(1);
  });

  it('rolls back the task update when event insertion fails', async () => {
    const harness = createHarness();
    const taskId = await createManualTask({
      db: harness.db,
      tenantId: 'tenant-a',
      title: 'Atomic task',
      priority: 'medium',
      actorId: 7,
      nowUtc: '2026-07-15T11:00:00.000Z',
    });
    harness.sqlite.exec(`
      CREATE TRIGGER fail_started_task_event
      BEFORE INSERT ON admin_action_task_events
      WHEN NEW.event_type = 'started'
      BEGIN
        SELECT RAISE(ABORT, 'task event blocked');
      END;
    `);

    await expect(transitionTask({
      db: harness.db,
      tenantId: 'tenant-a',
      taskId,
      actorId: 7,
      expectedUpdatedAtUtc: '2026-07-15T11:00:00.000Z',
      transition: { action: 'start' },
      nowUtc: '2026-07-15T11:01:00.000Z',
    })).rejects.toThrow(/task event blocked/);

    expect(taskRow(harness, taskId)).toEqual(expect.objectContaining({
      status: 'open',
      updated_at_utc: '2026-07-15T11:00:00.000Z',
    }));
    expect(eventRows(harness, taskId).map((row) => row.event_type)).toEqual(['created']);
  });
});

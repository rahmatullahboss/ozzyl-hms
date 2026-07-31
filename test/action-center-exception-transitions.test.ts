import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ExceptionTransitionValidationError,
  transitionExceptionCase,
} from '../src/services/actionCenter/exceptions/transitions';
import { transitionTask } from '../src/services/actionCenter/tasks/service';
import { createSqliteD1Harness } from './helpers/sqlite-d1';

const providerReviewsMigration = readFileSync('migrations/0121_provider_reviews.sql', 'utf8');
const migrationSql = readFileSync('migrations/0500_admin_exception_cases.sql', 'utf8');
const taskMigration = readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8');

function setup(tenantId = 'tenant-example') {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(providerReviewsMigration);
  harness.sqlite.exec(migrationSql);
  harness.sqlite.exec(taskMigration);
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    INSERT INTO users (id, tenant_id, name) VALUES
      (77, 'tenant-example', 'Exception Admin'),
      (88, 'tenant-example', 'Cash Supervisor'),
      (99, 'tenant-other', 'Other Tenant User');
  `);
  harness.sqlite.prepare(`
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
      source_href,
      status,
      first_detected_at,
      last_detected_at,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId,
    'cash.stale_handover',
    'handover:42',
    'cash_handover',
    '42',
    'cash',
    'warning',
    'Stale cash handover',
    'Pending handover is older than 24 hours.',
    '/cash/handover/42',
    'open',
    '2026-07-14 09:00:00',
    '2026-07-14 09:00:00',
    '{}',
    '2026-07-14 09:00:00',
    '2026-07-14 09:00:00',
  );
  return harness;
}

function currentCase(harness: ReturnType<typeof setup>) {
  return harness.sqlite.prepare(`SELECT * FROM admin_exception_cases WHERE id = 1`).get() as Record<string, unknown>;
}

function events(harness: ReturnType<typeof setup>) {
  return harness.sqlite.prepare(`
    SELECT event_type, actor_id, old_status, new_status, note
    FROM admin_exception_events
    ORDER BY id
  `).all() as Array<Record<string, unknown>>;
}

function linkedTasks(harness: ReturnType<typeof setup>) {
  return harness.sqlite.prepare(`
    SELECT id, source_public_id, source_href, source_metadata_json, title,
           priority, status, assigned_to, completed_by, completed_at_utc,
           completion_note, updated_at_utc
    FROM admin_action_tasks
    WHERE tenant_id = 'tenant-example' AND source_type = 'exception'
    ORDER BY id
  `).all() as Array<Record<string, unknown>>;
}

function linkedTaskEvents(harness: ReturnType<typeof setup>) {
  return harness.sqlite.prepare(`
    SELECT event_type, old_status, new_status, note
    FROM admin_action_task_events
    WHERE tenant_id = 'tenant-example'
    ORDER BY id
  `).all() as Array<Record<string, unknown>>;
}

async function transition(
  harness: ReturnType<typeof setup>,
  transitionInput: Parameters<typeof transitionExceptionCase>[0]['transition'],
  now: string,
) {
  return transitionExceptionCase({
    db: harness.db,
    tenantId: 'tenant-example',
    caseId: 1,
    actorId: 77,
    now,
    transition: transitionInput,
  });
}

describe('exception lifecycle transitions', () => {
  it('executes valid lifecycle actions through conditional update plus event insert in one batch', async () => {
    const harness = setup();

    await expect(transition(harness, { action: 'acknowledge', note: 'Reviewed' }, '2026-07-14 10:00:00')).resolves.toBe('updated');
    expect(currentCase(harness).status).toBe('acknowledged');
    expect(currentCase(harness).acknowledged_by).toBe(77);

    await expect(transition(harness, { action: 'start', note: 'Investigating' }, '2026-07-14 10:10:00')).resolves.toBe('updated');
    expect(currentCase(harness).status).toBe('in_progress');

    await expect(transition(harness, {
      action: 'snooze',
      snoozedUntil: '2026-07-15 10:20:00',
      note: 'Waiting for shift owner',
    }, '2026-07-14 10:20:00')).resolves.toBe('updated');
    expect(currentCase(harness).status).toBe('snoozed');

    await expect(transition(harness, { action: 'reopen', note: 'Resume review' }, '2026-07-14 10:30:00')).resolves.toBe('updated');
    expect(currentCase(harness).status).toBe('open');

    await expect(transition(harness, {
      action: 'resolve',
      resolutionCode: 'verified',
      note: 'Cash was received and verified.',
    }, '2026-07-14 10:40:00')).resolves.toBe('updated');
    expect(currentCase(harness).status).toBe('resolved');
    expect(currentCase(harness).resolution_code).toBe('verified');

    await expect(transition(harness, { action: 'reopen', note: 'Source recurred' }, '2026-07-14 10:50:00')).resolves.toBe('updated');
    await expect(transition(harness, { action: 'dismiss', reason: 'False positive' }, '2026-07-14 11:00:00')).resolves.toBe('updated');
    expect(currentCase(harness).status).toBe('dismissed');
    expect(currentCase(harness).dismissal_reason).toBe('False positive');

    expect(events(harness).map((event) => event.event_type)).toEqual([
      'acknowledged',
      'started',
      'snoozed',
      'reopened',
      'resolved',
      'reopened',
      'dismissed',
    ]);
    expect(harness.batchCalls).toHaveLength(7);
    expect(harness.batchCalls.every((batch) => batch.length === 2)).toBe(true);
    expect(harness.batchCalls.every((batch) => batch[0]?.sql.includes('updated_at = ?'))).toBe(true);
  });

  it('assigns an active case without changing its lifecycle status', async () => {
    const harness = setup();

    await expect(transition(harness, {
      action: 'assign',
      assignedTo: 88,
      note: 'Owned by cash supervisor',
    }, '2026-07-14 10:00:00')).resolves.toBe('updated');

    expect(currentCase(harness).assigned_to).toBe(88);
    expect(currentCase(harness).status).toBe('open');
    expect(events(harness)).toEqual([
      expect.objectContaining({
        event_type: 'assigned',
        actor_id: 77,
        old_status: 'open',
        new_status: 'open',
      }),
    ]);
  });

  it('deduplicates an assigned exception task and completing the task alone leaves the source active', async () => {
    const harness = setup();

    await expect(transition(harness, {
      action: 'assign',
      assignedTo: 88,
      note: 'Owned by cash supervisor',
    }, '2026-07-14 10:00:00')).resolves.toBe('updated');
    await expect(transition(harness, {
      action: 'start',
      note: 'Investigation started',
    }, '2026-07-14 10:05:00')).resolves.toBe('updated');

    expect(linkedTasks(harness)).toEqual([
      expect.objectContaining({
        source_public_id: 'exception-case:1',
        source_href: '/action/exceptions?case=1',
        source_metadata_json: JSON.stringify({ exceptionCaseId: 1 }),
        title: 'Stale cash handover',
        priority: 'high',
        status: 'open',
        assigned_to: 88,
      }),
    ]);
    expect(linkedTaskEvents(harness).map((event) => event.event_type)).toEqual(['created']);

    const task = linkedTasks(harness)[0];
    await expect(transitionTask({
      db: harness.db,
      tenantId: 'tenant-example',
      taskId: Number(task.id),
      actorId: 88,
      expectedUpdatedAtUtc: String(task.updated_at_utc),
      transition: {
        action: 'complete',
        note: 'Task evidence recorded without changing the exception source.',
      },
      nowUtc: '2026-07-14T10:06:00.000Z',
    })).resolves.toBe('updated');

    expect(currentCase(harness).status).toBe('in_progress');
    expect(linkedTasks(harness)[0]).toEqual(expect.objectContaining({
      status: 'completed',
      completed_by: 88,
      completion_note: 'Task evidence recorded without changing the exception source.',
    }));
  });

  it('completes or cancels an active linked task when the exception source closes', async () => {
    const resolvedHarness = setup();
    await transition(resolvedHarness, {
      action: 'assign',
      assignedTo: 88,
    }, '2026-07-14 10:00:00');
    await expect(transition(resolvedHarness, {
      action: 'resolve',
      resolutionCode: 'verified',
      note: 'Source evidence verified.',
    }, '2026-07-14 10:10:00')).resolves.toBe('updated');

    expect(linkedTasks(resolvedHarness)[0]).toEqual(expect.objectContaining({
      status: 'completed',
      completed_by: 77,
      completion_note: 'Source evidence verified.',
    }));
    expect(linkedTaskEvents(resolvedHarness).map((event) => event.event_type)).toEqual([
      'created',
      'completed',
    ]);

    const dismissedHarness = setup();
    await transition(dismissedHarness, {
      action: 'assign',
      assignedTo: 88,
    }, '2026-07-14 10:00:00');
    await expect(transition(dismissedHarness, {
      action: 'dismiss',
      reason: 'False positive',
    }, '2026-07-14 10:10:00')).resolves.toBe('updated');

    expect(linkedTasks(dismissedHarness)[0]).toEqual(expect.objectContaining({
      status: 'cancelled',
      completed_by: null,
      completion_note: null,
    }));
    expect(linkedTaskEvents(dismissedHarness).map((event) => event.event_type)).toEqual([
      'created',
      'cancelled',
    ]);
  });

  it('rejects a cross-tenant assignee before mutating the exception source', async () => {
    const harness = setup();

    await expect(transition(harness, {
      action: 'assign',
      assignedTo: 99,
      note: 'Must not cross tenant boundaries.',
    }, '2026-07-14 10:00:00')).rejects.toBeInstanceOf(ExceptionTransitionValidationError);

    expect(currentCase(harness)).toEqual(expect.objectContaining({
      status: 'open',
      assigned_to: null,
      updated_at: '2026-07-14 09:00:00',
    }));
    expect(events(harness)).toEqual([]);
    expect(linkedTasks(harness)).toEqual([]);
  });

  it('repairs a linked task on an idempotent terminal-source retry after task event failure', async () => {
    const harness = setup();
    await transition(harness, {
      action: 'assign',
      assignedTo: 88,
    }, '2026-07-14 10:00:00');
    harness.sqlite.exec(`
      CREATE TRIGGER block_exception_task_completion
      BEFORE INSERT ON admin_action_task_events
      WHEN NEW.event_type = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'task completion blocked');
      END;
    `);

    await expect(transition(harness, {
      action: 'resolve',
      resolutionCode: 'verified',
      note: 'Source evidence verified.',
    }, '2026-07-14 10:10:00')).rejects.toThrow(/task completion blocked/);
    expect(currentCase(harness).status).toBe('resolved');
    expect(linkedTasks(harness)[0]).toEqual(expect.objectContaining({ status: 'open' }));

    harness.sqlite.exec('DROP TRIGGER block_exception_task_completion;');
    await expect(transition(harness, {
      action: 'resolve',
      resolutionCode: 'retry-request',
      note: 'Retry payload must not replace persisted source evidence.',
    }, '2026-07-14 10:11:00')).resolves.toBe('conflict');

    expect(linkedTasks(harness)[0]).toEqual(expect.objectContaining({
      status: 'completed',
      completed_by: 77,
      completion_note: 'Source evidence verified.',
    }));
    expect(linkedTaskEvents(harness).map((event) => event.event_type)).toEqual([
      'created',
      'completed',
    ]);
  });

  it('requires meaningful resolve, dismiss, reopen, assign, and snooze inputs', async () => {
    const harness = setup();

    await expect(transition(harness, {
      action: 'resolve',
      resolutionCode: '',
      note: '',
    }, '2026-07-14 10:00:00')).rejects.toBeInstanceOf(ExceptionTransitionValidationError);
    await expect(transition(harness, {
      action: 'dismiss',
      reason: ' ',
    }, '2026-07-14 10:00:00')).rejects.toBeInstanceOf(ExceptionTransitionValidationError);
    await expect(transition(harness, {
      action: 'reopen',
      note: ' ',
    }, '2026-07-14 10:00:00')).rejects.toBeInstanceOf(ExceptionTransitionValidationError);
    await expect(transition(harness, {
      action: 'assign',
      assignedTo: 0,
    }, '2026-07-14 10:00:00')).rejects.toBeInstanceOf(ExceptionTransitionValidationError);
    await expect(transition(harness, {
      action: 'snooze',
      snoozedUntil: '2026-07-14 09:00:00',
    }, '2026-07-14 10:00:00')).rejects.toBeInstanceOf(ExceptionTransitionValidationError);

    expect(harness.batchCalls).toHaveLength(0);
  });

  it('returns not_found for absent or cross-tenant cases', async () => {
    const harness = setup('tenant-other');

    await expect(transitionExceptionCase({
      db: harness.db,
      tenantId: 'tenant-example',
      caseId: 1,
      actorId: 77,
      now: '2026-07-14 10:00:00',
      transition: { action: 'acknowledge' },
    })).resolves.toBe('not_found');
    expect(harness.batchCalls).toHaveLength(0);
  });

  it('returns conflict when the conditional update loses a stale-write race and writes no event', async () => {
    const harness = setup();
    harness.beforeBatch = () => {
      harness.beforeBatch = undefined;
      harness.sqlite.exec(`
        UPDATE admin_exception_cases
        SET updated_at = '2026-07-14 09:30:00'
        WHERE id = 1
      `);
    };

    await expect(transition(harness, { action: 'acknowledge' }, '2026-07-14 10:00:00')).resolves.toBe('conflict');

    expect(currentCase(harness).status).toBe('open');
    expect(events(harness)).toEqual([]);
    expect(harness.batchCalls).toHaveLength(1);
  });

  it('returns conflict for an action that is invalid from the current state', async () => {
    const harness = setup();
    harness.sqlite.exec(`UPDATE admin_exception_cases SET status = 'resolved' WHERE id = 1`);

    await expect(transition(harness, { action: 'start' }, '2026-07-14 10:00:00')).resolves.toBe('conflict');
    expect(currentCase(harness).status).toBe('resolved');
    expect(events(harness)).toEqual([]);
  });
});

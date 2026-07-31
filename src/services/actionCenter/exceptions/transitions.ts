import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { settleSourceTask, upsertSourceTask } from '../tasks/service';

export type ExceptionTransition =
  | { action: 'acknowledge'; note?: string }
  | { action: 'assign'; assignedTo: number; note?: string }
  | { action: 'start'; note?: string }
  | { action: 'snooze'; snoozedUntil: string; note?: string }
  | { action: 'resolve'; resolutionCode: string; note: string }
  | { action: 'dismiss'; reason: string }
  | { action: 'reopen'; note: string };

interface ExceptionCaseStateRow {
  id: number;
  status: string;
  assigned_to: number | null;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  resolution_note: string | null;
  dismissal_reason: string | null;
  updated_at: string;
}

interface TransitionPlan {
  statement: D1PreparedStatement;
  eventType: string;
  targetStatus: string;
  note: string | null;
}

const ACTIVE_STATUSES = new Set(['open', 'acknowledged', 'in_progress', 'snoozed']);

export class ExceptionTransitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExceptionTransitionValidationError';
  }
}

function requiredText(value: string | undefined, label: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new ExceptionTransitionValidationError(`${label} is required.`);
  return text;
}

function optionalText(value: string | undefined): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function timestampValue(value: string): number {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  return Date.parse(withZone);
}

function validateTransition(transition: ExceptionTransition, now: string): void {
  switch (transition.action) {
    case 'assign':
      if (!Number.isInteger(transition.assignedTo) || transition.assignedTo <= 0) {
        throw new ExceptionTransitionValidationError('A valid assignee is required.');
      }
      break;
    case 'snooze': {
      const snoozedUntil = timestampValue(transition.snoozedUntil);
      const current = timestampValue(now);
      if (!Number.isFinite(snoozedUntil) || !Number.isFinite(current) || snoozedUntil <= current) {
        throw new ExceptionTransitionValidationError('Snooze time must be in the future.');
      }
      break;
    }
    case 'resolve':
      requiredText(transition.resolutionCode, 'Resolution code');
      requiredText(transition.note, 'Resolution note');
      break;
    case 'dismiss':
      requiredText(transition.reason, 'Dismissal reason');
      break;
    case 'reopen':
      requiredText(transition.note, 'Reopen note');
      break;
    default:
      break;
  }
}

function isAllowed(status: string, transition: ExceptionTransition): boolean {
  switch (transition.action) {
    case 'acknowledge':
      return status === 'open' || status === 'snoozed';
    case 'assign':
      return ACTIVE_STATUSES.has(status);
    case 'start':
      return status === 'open' || status === 'acknowledged' || status === 'snoozed';
    case 'snooze':
      return status === 'open' || status === 'acknowledged' || status === 'in_progress';
    case 'resolve':
    case 'dismiss':
      return ACTIVE_STATUSES.has(status);
    case 'reopen':
      return status === 'resolved' || status === 'dismissed' || status === 'snoozed';
  }
}

function buildTransitionPlan(input: {
  db: D1Database;
  tenantId: string;
  caseId: number;
  actorId: number;
  now: string;
  oldStatus: string;
  oldUpdatedAt: string;
  transition: ExceptionTransition;
}): TransitionPlan {
  const {
    db,
    tenantId,
    caseId,
    actorId,
    now,
    oldStatus,
    oldUpdatedAt,
    transition,
  } = input;

  switch (transition.action) {
    case 'acknowledge': {
      const note = optionalText(transition.note);
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET status = 'acknowledged',
              acknowledged_by = ?,
              acknowledged_at = ?,
              snoozed_until = NULL,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(actorId, now, now, caseId, tenantId, oldStatus, oldUpdatedAt),
        eventType: 'acknowledged',
        targetStatus: 'acknowledged',
        note,
      };
    }
    case 'assign': {
      const note = optionalText(transition.note);
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET assigned_to = ?,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(transition.assignedTo, now, caseId, tenantId, oldStatus, oldUpdatedAt),
        eventType: 'assigned',
        targetStatus: oldStatus,
        note,
      };
    }
    case 'start': {
      const note = optionalText(transition.note);
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET status = 'in_progress',
              snoozed_until = NULL,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(now, caseId, tenantId, oldStatus, oldUpdatedAt),
        eventType: 'started',
        targetStatus: 'in_progress',
        note,
      };
    }
    case 'snooze': {
      const note = optionalText(transition.note);
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET status = 'snoozed',
              snoozed_until = ?,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(transition.snoozedUntil, now, caseId, tenantId, oldStatus, oldUpdatedAt),
        eventType: 'snoozed',
        targetStatus: 'snoozed',
        note,
      };
    }
    case 'resolve': {
      const resolutionCode = requiredText(transition.resolutionCode, 'Resolution code');
      const note = requiredText(transition.note, 'Resolution note');
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET status = 'resolved',
              resolved_by = ?,
              resolved_at = ?,
              resolution_code = ?,
              resolution_note = ?,
              dismissed_by = NULL,
              dismissed_at = NULL,
              dismissal_reason = NULL,
              snoozed_until = NULL,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(
          actorId,
          now,
          resolutionCode,
          note,
          now,
          caseId,
          tenantId,
          oldStatus,
          oldUpdatedAt,
        ),
        eventType: 'resolved',
        targetStatus: 'resolved',
        note,
      };
    }
    case 'dismiss': {
      const reason = requiredText(transition.reason, 'Dismissal reason');
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET status = 'dismissed',
              dismissed_by = ?,
              dismissed_at = ?,
              dismissal_reason = ?,
              resolved_by = NULL,
              resolved_at = NULL,
              resolution_code = NULL,
              resolution_note = NULL,
              snoozed_until = NULL,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(
          actorId,
          now,
          reason,
          now,
          caseId,
          tenantId,
          oldStatus,
          oldUpdatedAt,
        ),
        eventType: 'dismissed',
        targetStatus: 'dismissed',
        note: reason,
      };
    }
    case 'reopen': {
      const note = requiredText(transition.note, 'Reopen note');
      return {
        statement: db.prepare(`
          UPDATE admin_exception_cases
          SET status = 'open',
              acknowledged_by = NULL,
              acknowledged_at = NULL,
              resolved_by = NULL,
              resolved_at = NULL,
              resolution_code = NULL,
              resolution_note = NULL,
              dismissed_by = NULL,
              dismissed_at = NULL,
              dismissal_reason = NULL,
              snoozed_until = NULL,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status = ?
            AND updated_at = ?
        `).bind(now, caseId, tenantId, oldStatus, oldUpdatedAt),
        eventType: 'reopened',
        targetStatus: 'open',
        note,
      };
    }
  }
}

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function taskTimestamp(value: string): string {
  const parsed = timestampValue(value);
  if (!Number.isFinite(parsed)) {
    throw new ExceptionTransitionValidationError('Transition time must be valid.');
  }
  return new Date(parsed).toISOString();
}

function taskPriority(severity: ExceptionCaseStateRow['severity']): 'critical' | 'high' | 'medium' {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'high';
  return 'medium';
}

function matchingTerminalRetry(
  current: ExceptionCaseStateRow,
  transition: ExceptionTransition,
): boolean {
  return (current.status === 'resolved' && transition.action === 'resolve')
    || (current.status === 'dismissed' && transition.action === 'dismiss');
}

async function validateLinkedTaskParticipants(input: {
  db: D1Database;
  tenantId: string;
  actorId: number;
  current: ExceptionCaseStateRow;
  transition: ExceptionTransition;
}): Promise<void> {
  if (
    input.transition.action !== 'assign'
    && input.transition.action !== 'start'
    && input.transition.action !== 'resolve'
    && input.transition.action !== 'dismiss'
  ) {
    return;
  }

  const assignedTo = input.transition.action === 'assign'
    ? input.transition.assignedTo
    : input.transition.action === 'start'
      ? input.current.assigned_to
      : null;
  const userIds = [input.actorId, assignedTo]
    .filter((value): value is number => value !== null);
  const placeholders = userIds.map(() => '?').join(', ');
  const rows = await input.db.prepare(`
    SELECT id
    FROM users
    WHERE tenant_id = ?
      AND id IN (${placeholders})
  `).bind(input.tenantId, ...userIds).all<{ id: number }>();
  const tenantUsers = new Set((rows.results ?? []).map((row) => Number(row.id)));

  if (!tenantUsers.has(input.actorId)) {
    throw new ExceptionTransitionValidationError('Actor must belong to this tenant.');
  }
  if (assignedTo !== null && !tenantUsers.has(assignedTo)) {
    throw new ExceptionTransitionValidationError('Assignee must belong to this tenant.');
  }
}

async function synchronizeLinkedTask(input: {
  db: D1Database;
  tenantId: string;
  actorId: number;
  current: ExceptionCaseStateRow;
  transition: ExceptionTransition;
  now: string;
}): Promise<void> {
  const sourcePublicId = `exception-case:${input.current.id}`;
  const nowUtc = taskTimestamp(input.now);

  if (input.transition.action === 'assign' || input.transition.action === 'start') {
    const assignedTo = input.transition.action === 'assign'
      ? input.transition.assignedTo
      : input.current.assigned_to;
    if (assignedTo === null) return;

    await upsertSourceTask({
      db: input.db,
      tenantId: input.tenantId,
      sourceType: 'exception',
      sourcePublicId,
      sourceHref: `/action/exceptions?case=${input.current.id}`,
      sourceMetadata: { exceptionCaseId: input.current.id },
      title: input.current.title,
      description: input.current.description,
      priority: taskPriority(input.current.severity),
      assignedTo,
      actorId: input.actorId,
      nowUtc,
    });
    return;
  }

  if (input.transition.action === 'resolve') {
    const note = input.current.status === 'resolved'
      ? requiredText(input.current.resolution_note ?? undefined, 'Resolution note')
      : requiredText(input.transition.note, 'Resolution note');
    await settleSourceTask({
      db: input.db,
      tenantId: input.tenantId,
      sourceType: 'exception',
      sourcePublicId,
      actorId: input.actorId,
      outcome: 'completed',
      note,
      nowUtc,
    });
  } else if (input.transition.action === 'dismiss') {
    const note = input.current.status === 'dismissed'
      ? requiredText(input.current.dismissal_reason ?? undefined, 'Dismissal reason')
      : requiredText(input.transition.reason, 'Dismissal reason');
    await settleSourceTask({
      db: input.db,
      tenantId: input.tenantId,
      sourceType: 'exception',
      sourcePublicId,
      actorId: input.actorId,
      outcome: 'cancelled',
      note,
      nowUtc,
    });
  }
}

export async function transitionExceptionCase(input: {
  db: D1Database;
  tenantId: string;
  caseId: number;
  actorId: number;
  transition: ExceptionTransition;
  now?: string;
}): Promise<'updated' | 'not_found' | 'conflict'> {
  const now = input.now ?? new Date().toISOString();
  validateTransition(input.transition, now);

  const current = await input.db.prepare(`
    SELECT id, status, assigned_to, title, description, severity,
           resolution_note, dismissal_reason, updated_at
    FROM admin_exception_cases
    WHERE id = ?
      AND tenant_id = ?
    LIMIT 1
  `).bind(input.caseId, input.tenantId).first<ExceptionCaseStateRow>();

  if (!current) return 'not_found';
  if (!isAllowed(current.status, input.transition)) {
    if (matchingTerminalRetry(current, input.transition)) {
      await validateLinkedTaskParticipants({
        db: input.db,
        tenantId: input.tenantId,
        actorId: input.actorId,
        current,
        transition: input.transition,
      });
      await synchronizeLinkedTask({
        db: input.db,
        tenantId: input.tenantId,
        actorId: input.actorId,
        current,
        transition: input.transition,
        now,
      });
    }
    return 'conflict';
  }

  await validateLinkedTaskParticipants({
    db: input.db,
    tenantId: input.tenantId,
    actorId: input.actorId,
    current,
    transition: input.transition,
  });

  const plan = buildTransitionPlan({
    db: input.db,
    tenantId: input.tenantId,
    caseId: input.caseId,
    actorId: input.actorId,
    now,
    oldStatus: current.status,
    oldUpdatedAt: current.updated_at,
    transition: input.transition,
  });

  const results = await input.db.batch([
    plan.statement,
    input.db.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id,
        case_id,
        event_type,
        actor_id,
        old_status,
        new_status,
        note,
        metadata_json,
        created_at
      )
      SELECT ?, id, ?, ?, ?, ?, ?, '{}', ?
      FROM admin_exception_cases
      WHERE id = ?
        AND tenant_id = ?
        AND status = ?
        AND updated_at = ?
        AND changes() = 1
    `).bind(
      input.tenantId,
      plan.eventType,
      input.actorId,
      current.status,
      plan.targetStatus,
      plan.note,
      now,
      input.caseId,
      input.tenantId,
      plan.targetStatus,
      now,
    ),
  ]);

  if (changes(results[0]) === 0) return 'conflict';

  await synchronizeLinkedTask({
    db: input.db,
    tenantId: input.tenantId,
    actorId: input.actorId,
    current,
    transition: input.transition,
    now,
  });
  return 'updated';
}

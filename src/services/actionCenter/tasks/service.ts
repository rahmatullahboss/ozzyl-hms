import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types';
import {
  TASK_PRIORITIES,
  TASK_SOURCE_TYPES,
  type CreateManualTaskInput,
  type TaskPriority,
  type TaskSourceMetadata,
  type TaskStatus,
  type TaskTransition,
  type TaskTransitionResult,
  type TransitionTaskInput,
  type UpsertSourceTaskInput,
} from './types';

interface IdRow {
  id: number;
}

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  sourceType: string;
  sourcePublicId: string;
  sourceHref: string | null;
  sourceMetadataJson: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: number | null;
  dueAtUtc: string | null;
  completedBy: number | null;
  completedAtUtc: string | null;
  completionNote: string | null;
  updatedAtUtc: string;
}

interface NormalizedTaskFields {
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignedTo: number | null;
  dueAtUtc: string | null;
}

interface DesiredTransition {
  status: TaskStatus;
  assignedTo: number | null;
  dueAtUtc: string | null;
  completedBy: number | null;
  completedAtUtc: string | null;
  completionNote: string | null;
  eventType: string;
  eventNote: string | null;
  eventMetadata: Record<string, unknown>;
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['open', 'in_progress']);

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

export class TaskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskConflictError';
  }
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new TaskValidationError(`${label} is required.`);
  }
  if (text.length > maxLength) {
    throw new TaskValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new TaskValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TaskValidationError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function utcTimestamp(value: string, label: string): string {
  const timestamp = requiredText(value, label, 40);
  if (!timestamp.endsWith('Z') || !Number.isFinite(Date.parse(timestamp))) {
    throw new TaskValidationError(`${label} must be a valid UTC timestamp.`);
  }
  return timestamp;
}

function nowUtc(value?: string): string {
  return utcTimestamp(value ?? new Date().toISOString(), 'Current time');
}

function nextUtcTimestamp(currentUpdatedAtUtc: string, requestedNowUtc: string): string {
  const current = Date.parse(utcTimestamp(currentUpdatedAtUtc, 'Current task timestamp'));
  const requested = Date.parse(utcTimestamp(requestedNowUtc, 'Requested task timestamp'));
  return requested > current
    ? requestedNowUtc
    : new Date(current + 1).toISOString();
}

function normalizePriority(value: TaskPriority): TaskPriority {
  if (!(TASK_PRIORITIES as readonly string[]).includes(value)) {
    throw new TaskValidationError('Task priority is invalid.');
  }
  return value;
}

function normalizeSourceMetadata(metadata?: TaskSourceMetadata): TaskSourceMetadata {
  if (!metadata) return {};
  const normalized: TaskSourceMetadata = {};

  if (metadata.legacyBillId !== undefined) {
    normalized.legacyBillId = positiveId(metadata.legacyBillId, 'Legacy bill ID');
  }
  if (metadata.canonicalInvoicePublicId !== undefined) {
    normalized.canonicalInvoicePublicId = requiredText(
      metadata.canonicalInvoicePublicId,
      'Canonical invoice public ID',
      200,
    );
  }
  if (metadata.collectionCaseId !== undefined) {
    normalized.collectionCaseId = positiveId(metadata.collectionCaseId, 'Collection case ID');
  }
  if (metadata.exceptionCaseId !== undefined) {
    normalized.exceptionCaseId = positiveId(metadata.exceptionCaseId, 'Exception case ID');
  }

  return normalized;
}

function normalizeTaskFields(input: {
  title: string;
  description?: string;
  priority: TaskPriority;
  assignedTo?: number;
  dueAtUtc?: string;
}): NormalizedTaskFields {
  return {
    title: requiredText(input.title, 'Task title', 500),
    description: optionalText(input.description, 'Task description', 4000),
    priority: normalizePriority(input.priority),
    assignedTo: input.assignedTo === undefined
      ? null
      : positiveId(input.assignedTo, 'Assignee'),
    dueAtUtc: input.dueAtUtc === undefined
      ? null
      : utcTimestamp(input.dueAtUtc, 'Task due time'),
  };
}

async function requireTenantUser(input: {
  db: D1Database;
  tenantId: string;
  userId: number;
  label: string;
}): Promise<void> {
  positiveId(input.userId, input.label);
  const user = await input.db.prepare(`
    SELECT id
    FROM users
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(input.userId, input.tenantId).first<IdRow>();
  if (!user) {
    throw new TaskValidationError(`${input.label} must belong to this tenant.`);
  }
}

async function validateActorAndAssignee(input: {
  db: D1Database;
  tenantId: string;
  actorId: number;
  assignedTo: number | null;
}): Promise<void> {
  await requireTenantUser({
    db: input.db,
    tenantId: input.tenantId,
    userId: input.actorId,
    label: 'Actor',
  });
  if (input.assignedTo !== null) {
    await requireTenantUser({
      db: input.db,
      tenantId: input.tenantId,
      userId: input.assignedTo,
      label: 'Assignee',
    });
  }
}

function resultChanges(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function insertedTaskEvent(input: {
  db: D1Database;
  tenantId: string;
  sourceType: string;
  sourcePublicId: string;
  actorId: number;
  nowUtc: string;
}): D1PreparedStatement {
  return input.db.prepare(`
    INSERT INTO admin_action_task_events (
      tenant_id,
      task_id,
      event_type,
      actor_id,
      old_status,
      new_status,
      note,
      metadata_json,
      created_at_utc
    )
    SELECT ?, id, 'created', ?, NULL, 'open', NULL, ?, ?
    FROM admin_action_tasks
    WHERE tenant_id = ?
      AND source_type = ?
      AND source_public_id = ?
      AND status = 'open'
      AND updated_at_utc = ?
      AND changes() = 1
    LIMIT 1
  `).bind(
    input.tenantId,
    input.actorId,
    JSON.stringify({
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
    }),
    input.nowUtc,
    input.tenantId,
    input.sourceType,
    input.sourcePublicId,
    input.nowUtc,
  );
}

function updatedTaskEvent(input: {
  db: D1Database;
  tenantId: string;
  taskId: number;
  actorId: number;
  eventType: string;
  oldStatus: TaskStatus;
  newStatus: TaskStatus;
  note: string | null;
  metadata: Record<string, unknown>;
  nowUtc: string;
}): D1PreparedStatement {
  return input.db.prepare(`
    INSERT INTO admin_action_task_events (
      tenant_id,
      task_id,
      event_type,
      actor_id,
      old_status,
      new_status,
      note,
      metadata_json,
      created_at_utc
    )
    SELECT ?, id, ?, ?, ?, ?, ?, ?, ?
    FROM admin_action_tasks
    WHERE tenant_id = ?
      AND id = ?
      AND status = ?
      AND updated_at_utc = ?
      AND changes() = 1
  `).bind(
    input.tenantId,
    input.eventType,
    input.actorId,
    input.oldStatus,
    input.newStatus,
    input.note,
    JSON.stringify(input.metadata),
    input.nowUtc,
    input.tenantId,
    input.taskId,
    input.newStatus,
    input.nowUtc,
  );
}

async function findTaskBySource(input: {
  db: D1Database;
  tenantId: string;
  sourceType: string;
  sourcePublicId: string;
}): Promise<TaskRow | null> {
  return input.db.prepare(`
    SELECT
      id,
      title,
      description,
      source_type AS "sourceType",
      source_public_id AS "sourcePublicId",
      source_href AS "sourceHref",
      source_metadata_json AS "sourceMetadataJson",
      priority,
      status,
      assigned_to AS "assignedTo",
      due_at_utc AS "dueAtUtc",
      completed_by AS "completedBy",
      completed_at_utc AS "completedAtUtc",
      completion_note AS "completionNote",
      updated_at_utc AS "updatedAtUtc"
    FROM admin_action_tasks
    WHERE tenant_id = ?
      AND source_type = ?
      AND source_public_id = ?
      AND status <> 'cancelled'
    ORDER BY id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.sourceType,
    input.sourcePublicId,
  ).first<TaskRow>();
}

async function findTaskById(input: {
  db: D1Database;
  tenantId: string;
  taskId: number;
}): Promise<TaskRow | null> {
  return input.db.prepare(`
    SELECT
      id,
      title,
      description,
      source_type AS "sourceType",
      source_public_id AS "sourcePublicId",
      source_href AS "sourceHref",
      source_metadata_json AS "sourceMetadataJson",
      priority,
      status,
      assigned_to AS "assignedTo",
      due_at_utc AS "dueAtUtc",
      completed_by AS "completedBy",
      completed_at_utc AS "completedAtUtc",
      completion_note AS "completionNote",
      updated_at_utc AS "updatedAtUtc"
    FROM admin_action_tasks
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(input.tenantId, input.taskId).first<TaskRow>();
}

async function insertTask(input: {
  db: D1Database;
  tenantId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceHref: string | null;
  sourceMetadataJson: string;
  fields: NormalizedTaskFields;
  actorId: number;
  nowUtc: string;
  ignoreConflict: boolean;
}): Promise<number> {
  const insertKeyword = input.ignoreConflict ? 'INSERT OR IGNORE' : 'INSERT';
  const results = await input.db.batch([
    input.db.prepare(`
      ${insertKeyword} INTO admin_action_tasks (
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
        created_by,
        created_at_utc,
        updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.fields.title,
      input.fields.description,
      input.sourceType,
      input.sourcePublicId,
      input.sourceHref,
      input.sourceMetadataJson,
      input.fields.priority,
      input.fields.assignedTo,
      input.fields.dueAtUtc,
      input.actorId,
      input.nowUtc,
      input.nowUtc,
    ),
    insertedTaskEvent({
      db: input.db,
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      actorId: input.actorId,
      nowUtc: input.nowUtc,
    }),
  ]);

  if (resultChanges(results[0]) !== 1 && !input.ignoreConflict) {
    throw new TaskConflictError('Task could not be created.');
  }

  const created = await input.db.prepare(`
    SELECT id
    FROM admin_action_tasks
    WHERE tenant_id = ?
      AND source_type = ?
      AND source_public_id = ?
      AND status <> 'cancelled'
    ORDER BY id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.sourceType,
    input.sourcePublicId,
  ).first<IdRow>();
  if (!created) {
    throw new TaskConflictError('Task source changed concurrently.');
  }
  return Number(created.id);
}

export async function createManualTask(input: CreateManualTaskInput): Promise<number> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 120);
  const fields = normalizeTaskFields(input);
  const timestamp = nowUtc(input.nowUtc);
  await validateActorAndAssignee({
    db: input.db,
    tenantId,
    actorId: input.actorId,
    assignedTo: fields.assignedTo,
  });

  return insertTask({
    db: input.db,
    tenantId,
    sourceType: 'manual',
    sourcePublicId: `manual-task:${crypto.randomUUID()}`,
    sourceHref: null,
    sourceMetadataJson: '{}',
    fields,
    actorId: input.actorId,
    nowUtc: timestamp,
    ignoreConflict: false,
  });
}

export async function upsertSourceTask(input: UpsertSourceTaskInput): Promise<number> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 120);
  if (!(TASK_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) {
    throw new TaskValidationError('Task source type is invalid.');
  }
  const sourcePublicId = requiredText(input.sourcePublicId, 'Task source public ID', 240);
  const sourceHref = requiredText(input.sourceHref, 'Task source link', 1000);
  const fields = normalizeTaskFields(input);
  const metadataJson = JSON.stringify(normalizeSourceMetadata(input.sourceMetadata));
  const requestedTimestamp = nowUtc(input.nowUtc);
  if (input.reopenCompleted && fields.dueAtUtc === null) {
    throw new TaskValidationError('Reopening completed source work requires a due time.');
  }
  await validateActorAndAssignee({
    db: input.db,
    tenantId,
    actorId: input.actorId,
    assignedTo: fields.assignedTo,
  });

  const current = await findTaskBySource({
    db: input.db,
    tenantId,
    sourceType: input.sourceType,
    sourcePublicId,
  });
  if (!current) {
    return insertTask({
      db: input.db,
      tenantId,
      sourceType: input.sourceType,
      sourcePublicId,
      sourceHref,
      sourceMetadataJson: metadataJson,
      fields,
      actorId: input.actorId,
      nowUtc: requestedTimestamp,
      ignoreConflict: true,
    });
  }

  const desiredMetadataJson = input.sourceMetadata === undefined
    ? current.sourceMetadataJson
    : metadataJson;
  const timestamp = nextUtcTimestamp(current.updatedAtUtc, requestedTimestamp);

  if (current.status === 'completed' && !input.reopenCompleted) {
    if (
      current.sourceHref === sourceHref
      && current.sourceMetadataJson === desiredMetadataJson
    ) {
      return current.id;
    }

    const results = await input.db.batch([
      input.db.prepare(`
        UPDATE admin_action_tasks
        SET source_href = ?,
            source_metadata_json = ?,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND id = ?
          AND status = 'completed'
          AND updated_at_utc = ?
      `).bind(
        sourceHref,
        desiredMetadataJson,
        timestamp,
        tenantId,
        current.id,
        current.updatedAtUtc,
      ),
      updatedTaskEvent({
        db: input.db,
        tenantId,
        taskId: current.id,
        actorId: input.actorId,
        eventType: 'source_relinked',
        oldStatus: 'completed',
        newStatus: 'completed',
        note: null,
        metadata: {
          sourceType: input.sourceType,
          sourcePublicId,
          sourceHref,
        },
        nowUtc: timestamp,
      }),
    ]);
    if (resultChanges(results[0]) !== 1) {
      throw new TaskConflictError('Task source changed concurrently.');
    }
    return current.id;
  }

  const desiredDescription = input.description === undefined
    ? current.description
    : fields.description;
  const desiredAssignedTo = input.assignedTo === undefined
    ? current.assignedTo
    : fields.assignedTo;
  const desiredDueAtUtc = input.dueAtUtc === undefined
    ? current.dueAtUtc
    : fields.dueAtUtc;
  const desiredStatus: TaskStatus = current.status === 'completed' ? 'open' : current.status;

  const unchanged = current.status !== 'completed'
    && current.title === fields.title
    && current.description === desiredDescription
    && current.sourceHref === sourceHref
    && current.sourceMetadataJson === desiredMetadataJson
    && current.priority === fields.priority
    && current.assignedTo === desiredAssignedTo
    && current.dueAtUtc === desiredDueAtUtc;
  if (unchanged) return current.id;

  const eventType = current.status === 'completed' ? 'reopened' : 'source_updated';
  const update = input.db.prepare(`
    UPDATE admin_action_tasks
    SET title = ?,
        description = ?,
        source_href = ?,
        source_metadata_json = ?,
        priority = ?,
        status = ?,
        assigned_to = ?,
        due_at_utc = ?,
        completed_by = NULL,
        completed_at_utc = NULL,
        completion_note = NULL,
        updated_at_utc = ?
    WHERE tenant_id = ?
      AND id = ?
      AND status = ?
      AND updated_at_utc = ?
  `).bind(
    fields.title,
    desiredDescription,
    sourceHref,
    desiredMetadataJson,
    fields.priority,
    desiredStatus,
    desiredAssignedTo,
    desiredDueAtUtc,
    timestamp,
    tenantId,
    current.id,
    current.status,
    current.updatedAtUtc,
  );
  const results = await input.db.batch([
    update,
    updatedTaskEvent({
      db: input.db,
      tenantId,
      taskId: current.id,
      actorId: input.actorId,
      eventType,
      oldStatus: current.status,
      newStatus: desiredStatus,
      note: null,
      metadata: {
        sourceType: input.sourceType,
        sourcePublicId,
        ...(current.status === 'completed' ? { dueAtUtc: desiredDueAtUtc } : {}),
      },
      nowUtc: timestamp,
    }),
  ]);
  if (resultChanges(results[0]) !== 1) {
    throw new TaskConflictError('Task source changed concurrently.');
  }
  return current.id;
}

export async function settleSourceTask(input: {
  db: D1Database;
  tenantId: string;
  sourceType: 'exception' | 'collection';
  sourcePublicId: string;
  actorId: number;
  outcome: 'completed' | 'cancelled';
  note: string;
  nowUtc?: string;
}): Promise<'updated' | 'unchanged'> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 120);
  const sourcePublicId = requiredText(input.sourcePublicId, 'Task source public ID', 240);
  const note = requiredText(input.note, 'Source settlement note', 2000);
  const current = await findTaskBySource({
    db: input.db,
    tenantId,
    sourceType: input.sourceType,
    sourcePublicId,
  });
  if (!current || current.status === 'completed' || current.status === 'cancelled') {
    return 'unchanged';
  }

  const result = await transitionTask({
    db: input.db,
    tenantId,
    taskId: current.id,
    actorId: input.actorId,
    expectedUpdatedAtUtc: current.updatedAtUtc,
    transition: input.outcome === 'completed'
      ? { action: 'complete', note }
      : { action: 'cancel', note },
    nowUtc: input.nowUtc,
  });
  if (result === 'updated') return 'updated';

  const latest = await findTaskBySource({
    db: input.db,
    tenantId,
    sourceType: input.sourceType,
    sourcePublicId,
  });
  if (!latest || latest.status === 'completed' || latest.status === 'cancelled') {
    return 'unchanged';
  }
  throw new TaskConflictError('Linked task changed concurrently.');
}

function validateTransition(transition: TaskTransition): void {
  switch (transition.action) {
    case 'assign':
      positiveId(transition.assignedTo, 'Assignee');
      optionalText(transition.note, 'Assignment note', 2000);
      break;
    case 'start':
      optionalText(transition.note, 'Start note', 2000);
      break;
    case 'reschedule':
      utcTimestamp(transition.dueAtUtc, 'Task due time');
      optionalText(transition.note, 'Reschedule note', 2000);
      break;
    case 'complete':
      requiredText(transition.note, 'Completion note', 2000);
      break;
    case 'cancel':
      requiredText(transition.note, 'Cancellation note', 2000);
      break;
  }
}

function desiredTransition(input: {
  current: TaskRow;
  transition: TaskTransition;
  actorId: number;
  nowUtc: string;
}): DesiredTransition | null {
  if (!ACTIVE_STATUSES.has(input.current.status)) return null;

  switch (input.transition.action) {
    case 'assign':
      return {
        status: input.current.status,
        assignedTo: input.transition.assignedTo,
        dueAtUtc: input.current.dueAtUtc,
        completedBy: null,
        completedAtUtc: null,
        completionNote: null,
        eventType: 'assigned',
        eventNote: optionalText(input.transition.note, 'Assignment note', 2000),
        eventMetadata: { assignedTo: input.transition.assignedTo },
      };
    case 'start':
      if (input.current.status !== 'open') return null;
      return {
        status: 'in_progress',
        assignedTo: input.current.assignedTo,
        dueAtUtc: input.current.dueAtUtc,
        completedBy: null,
        completedAtUtc: null,
        completionNote: null,
        eventType: 'started',
        eventNote: optionalText(input.transition.note, 'Start note', 2000),
        eventMetadata: {},
      };
    case 'reschedule':
      return {
        status: input.current.status,
        assignedTo: input.current.assignedTo,
        dueAtUtc: utcTimestamp(input.transition.dueAtUtc, 'Task due time'),
        completedBy: null,
        completedAtUtc: null,
        completionNote: null,
        eventType: 'rescheduled',
        eventNote: optionalText(input.transition.note, 'Reschedule note', 2000),
        eventMetadata: { dueAtUtc: input.transition.dueAtUtc },
      };
    case 'complete': {
      const note = requiredText(input.transition.note, 'Completion note', 2000);
      return {
        status: 'completed',
        assignedTo: input.current.assignedTo,
        dueAtUtc: input.current.dueAtUtc,
        completedBy: input.actorId,
        completedAtUtc: input.nowUtc,
        completionNote: note,
        eventType: 'completed',
        eventNote: note,
        eventMetadata: {},
      };
    }
    case 'cancel': {
      const note = requiredText(input.transition.note, 'Cancellation note', 2000);
      return {
        status: 'cancelled',
        assignedTo: input.current.assignedTo,
        dueAtUtc: input.current.dueAtUtc,
        completedBy: null,
        completedAtUtc: null,
        completionNote: null,
        eventType: 'cancelled',
        eventNote: note,
        eventMetadata: {},
      };
    }
  }
}

export async function transitionTask(input: TransitionTaskInput): Promise<TaskTransitionResult> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 120);
  positiveId(input.taskId, 'Task ID');
  const requestedTimestamp = nowUtc(input.nowUtc);
  if (input.expectedUpdatedAtUtc !== undefined) {
    utcTimestamp(input.expectedUpdatedAtUtc, 'Expected task timestamp');
  }
  validateTransition(input.transition);
  await requireTenantUser({
    db: input.db,
    tenantId,
    userId: input.actorId,
    label: 'Actor',
  });

  const current = await findTaskById({
    db: input.db,
    tenantId,
    taskId: input.taskId,
  });
  if (!current) return 'not_found';
  if (
    input.expectedUpdatedAtUtc !== undefined
    && current.updatedAtUtc !== input.expectedUpdatedAtUtc
  ) {
    return 'conflict';
  }
  if (input.transition.action === 'assign') {
    await requireTenantUser({
      db: input.db,
      tenantId,
      userId: input.transition.assignedTo,
      label: 'Assignee',
    });
  }

  const timestamp = nextUtcTimestamp(current.updatedAtUtc, requestedTimestamp);
  const desired = desiredTransition({
    current,
    transition: input.transition,
    actorId: input.actorId,
    nowUtc: timestamp,
  });
  if (!desired) return 'conflict';

  const update = input.db.prepare(`
    UPDATE admin_action_tasks
    SET status = ?,
        assigned_to = ?,
        due_at_utc = ?,
        completed_by = ?,
        completed_at_utc = ?,
        completion_note = ?,
        updated_at_utc = ?
    WHERE tenant_id = ?
      AND id = ?
      AND status = ?
      AND updated_at_utc = ?
  `).bind(
    desired.status,
    desired.assignedTo,
    desired.dueAtUtc,
    desired.completedBy,
    desired.completedAtUtc,
    desired.completionNote,
    timestamp,
    tenantId,
    current.id,
    current.status,
    current.updatedAtUtc,
  );
  const results = await input.db.batch([
    update,
    updatedTaskEvent({
      db: input.db,
      tenantId,
      taskId: current.id,
      actorId: input.actorId,
      eventType: desired.eventType,
      oldStatus: current.status,
      newStatus: desired.status,
      note: desired.eventNote,
      metadata: desired.eventMetadata,
      nowUtc: timestamp,
    }),
  ]);

  return resultChanges(results[0]) === 1 ? 'updated' : 'conflict';
}

export type {
  CreateManualTaskInput,
  TaskPriority,
  TaskSourceMetadata,
  TaskStatus,
  TaskTransition,
  TransitionTaskInput,
  UpsertSourceTaskInput,
} from './types';

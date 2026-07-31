import type { D1Database } from '@cloudflare/workers-types';
import type { TaskPriority, TaskStatus } from './types';

export type TaskListView = 'mine' | 'team' | 'due_today' | 'overdue' | 'completed' | 'all';

export interface TaskListQuery {
  view: TaskListView;
  priority?: TaskPriority;
  sourceType?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface TaskListItem {
  id: number;
  title: string;
  description: string | null;
  sourceType: string;
  sourcePublicId: string;
  sourceHref: string | null;
  sourceMetadata: Record<string, unknown>;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: number | null;
  assignedToName: string | null;
  dueAtUtc: string | null;
  completedBy: number | null;
  completedByName: string | null;
  completedAtUtc: string | null;
  completionNote: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  isOverdue: boolean;
}

export interface TaskOperationalSummary {
  open: number;
  overdue: number;
  assignedToMe: number;
  assignedOverdue: number;
}

export interface LegacyTaskSummary {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  overdue: number;
}

interface TaskRow {
  id: number | string;
  title: string;
  description: string | null;
  sourceType: string;
  sourcePublicId: string;
  sourceHref: string | null;
  sourceMetadataJson: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: number | string | null;
  assignedToName: string | null;
  dueAtUtc: string | null;
  completedBy: number | string | null;
  completedByName: string | null;
  completedAtUtc: string | null;
  completionNote: string | null;
  createdBy: number | string | null;
  createdByName: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  isOverdue: number | string | null;
}

interface CountRow {
  total?: number | string | null;
}

interface OperationalSummaryRow {
  open_count?: number | string | null;
  overdue_count?: number | string | null;
  assigned_to_me_count?: number | string | null;
  assigned_overdue_count?: number | string | null;
}

interface LegacySummaryRow {
  total_count?: number | string | null;
  pending_count?: number | string | null;
  in_progress_count?: number | string | null;
  completed_count?: number | string | null;
  overdue_count?: number | string | null;
}

interface TaskEventRow {
  id: number | string;
  eventType: string;
  actorId: number | string | null;
  actorName: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  note: string | null;
  metadataJson: string;
  createdAtUtc: string;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function jsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapTask(row: TaskRow): TaskListItem {
  return {
    id: numberValue(row.id),
    title: row.title,
    description: row.description,
    sourceType: row.sourceType,
    sourcePublicId: row.sourcePublicId,
    sourceHref: row.sourceHref,
    sourceMetadata: jsonObject(row.sourceMetadataJson),
    priority: row.priority,
    status: row.status,
    assignedTo: nullableNumber(row.assignedTo),
    assignedToName: row.assignedToName,
    dueAtUtc: row.dueAtUtc,
    completedBy: nullableNumber(row.completedBy),
    completedByName: row.completedByName,
    completedAtUtc: row.completedAtUtc,
    completionNote: row.completionNote,
    createdBy: nullableNumber(row.createdBy),
    createdByName: row.createdByName,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
    isOverdue: numberValue(row.isOverdue) === 1,
  };
}

function taskSelectSql(): string {
  return `
    SELECT
      t.id,
      t.title,
      t.description,
      t.source_type AS "sourceType",
      t.source_public_id AS "sourcePublicId",
      t.source_href AS "sourceHref",
      t.source_metadata_json AS "sourceMetadataJson",
      t.priority,
      t.status,
      t.assigned_to AS "assignedTo",
      assignee.name AS "assignedToName",
      t.due_at_utc AS "dueAtUtc",
      t.completed_by AS "completedBy",
      completer.name AS "completedByName",
      t.completed_at_utc AS "completedAtUtc",
      t.completion_note AS "completionNote",
      t.created_by AS "createdBy",
      creator.name AS "createdByName",
      t.created_at_utc AS "createdAtUtc",
      t.updated_at_utc AS "updatedAtUtc",
      CASE
        WHEN t.status IN ('open','in_progress')
          AND t.due_at_utc IS NOT NULL
          AND datetime(t.due_at_utc) < datetime(?)
        THEN 1 ELSE 0
      END AS "isOverdue"
    FROM admin_action_tasks t
    LEFT JOIN users assignee
      ON assignee.id = t.assigned_to
     AND assignee.tenant_id = t.tenant_id
    LEFT JOIN users completer
      ON completer.id = t.completed_by
     AND completer.tenant_id = t.tenant_id
    LEFT JOIN users creator
      ON creator.id = t.created_by
     AND creator.tenant_id = t.tenant_id
  `;
}

function listConditions(input: {
  tenantId: string;
  userId: number;
  query: TaskListQuery;
  nowUtc: string;
}): { sql: string; binds: unknown[] } {
  const conditions = ['t.tenant_id = ?'];
  const binds: unknown[] = [input.tenantId];

  switch (input.query.view) {
    case 'mine':
      conditions.push("t.status IN ('open','in_progress')", 't.assigned_to = ?');
      binds.push(input.userId);
      break;
    case 'team':
      conditions.push("t.status IN ('open','in_progress')");
      break;
    case 'due_today':
      conditions.push(
        "t.status IN ('open','in_progress')",
        't.due_at_utc IS NOT NULL',
        'date(t.due_at_utc) = date(?)',
      );
      binds.push(input.nowUtc);
      break;
    case 'overdue':
      conditions.push(
        "t.status IN ('open','in_progress')",
        't.due_at_utc IS NOT NULL',
        'datetime(t.due_at_utc) < datetime(?)',
      );
      binds.push(input.nowUtc);
      break;
    case 'completed':
      conditions.push("t.status = 'completed'");
      break;
    case 'all':
      break;
  }

  if (input.query.priority) {
    conditions.push('t.priority = ?');
    binds.push(input.query.priority);
  }
  if (input.query.sourceType) {
    conditions.push('t.source_type = ?');
    binds.push(input.query.sourceType);
  }
  if (input.query.search) {
    conditions.push(`(
      lower(t.title) LIKE ?
      OR lower(COALESCE(t.description, '')) LIKE ?
      OR lower(t.source_public_id) LIKE ?
      OR lower(t.source_metadata_json) LIKE ?
    )`);
    const search = `%${input.query.search.toLowerCase()}%`;
    binds.push(search, search, search, search);
  }

  return { sql: conditions.join(' AND '), binds };
}

export async function listTasks(input: {
  db: D1Database;
  tenantId: string;
  userId: number;
  query: TaskListQuery;
  nowUtc?: string;
}): Promise<{
  items: TaskListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  const where = listConditions({ ...input, nowUtc });
  const offset = (input.query.page - 1) * input.query.limit;
  const [rows, count] = await Promise.all([
    input.db.prepare(`
      ${taskSelectSql()}
      WHERE ${where.sql}
      ORDER BY
        CASE t.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        CASE WHEN t.due_at_utc IS NULL THEN 1 ELSE 0 END,
        datetime(t.due_at_utc) ASC,
        datetime(t.updated_at_utc) DESC,
        t.id ASC
      LIMIT ? OFFSET ?
    `).bind(nowUtc, ...where.binds, input.query.limit, offset).all<TaskRow>(),
    input.db.prepare(`
      SELECT COUNT(*) AS total
      FROM admin_action_tasks t
      WHERE ${where.sql}
    `).bind(...where.binds).first<CountRow>(),
  ]);
  const total = Math.max(0, Math.trunc(numberValue(count?.total)));
  return {
    items: (rows.results ?? []).map(mapTask),
    pagination: {
      page: input.query.page,
      limit: input.query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / input.query.limit),
    },
  };
}

export async function getTaskDetail(input: {
  db: D1Database;
  tenantId: string;
  taskId: number;
  nowUtc?: string;
}): Promise<(TaskListItem & { sourceStatusSummary: Record<string, unknown> | null }) | null> {
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  const row = await input.db.prepare(`
    ${taskSelectSql()}
    WHERE t.tenant_id = ? AND t.id = ?
    LIMIT 1
  `).bind(nowUtc, input.tenantId, input.taskId).first<TaskRow>();
  if (!row) return null;
  const task = mapTask(row);

  let sourceStatusSummary: Record<string, unknown> | null = null;
  if (task.sourceType === 'exception') {
    const match = /^exception-case:(\d+)$/.exec(task.sourcePublicId);
    if (match) {
      sourceStatusSummary = await input.db.prepare(`
        SELECT status, severity, rule_key AS "ruleKey"
        FROM admin_exception_cases
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `).bind(input.tenantId, Number(match[1])).first<Record<string, unknown>>();
    }
  } else if (task.sourceType === 'collection') {
    const match = /^collection-case:(\d+)$/.exec(task.sourcePublicId);
    if (match) {
      sourceStatusSummary = await input.db.prepare(`
        SELECT status, next_followup_at_utc AS "nextFollowupAtUtc"
        FROM collection_cases
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `).bind(input.tenantId, Number(match[1])).first<Record<string, unknown>>();
    }
  }

  return { ...task, sourceStatusSummary };
}

export async function getTaskEvents(input: {
  db: D1Database;
  tenantId: string;
  taskId: number;
}): Promise<Array<{
  id: number;
  eventType: string;
  actorId: number | null;
  actorName: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAtUtc: string;
}> | null> {
  const exists = await input.db.prepare(`
    SELECT id
    FROM admin_action_tasks
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(input.tenantId, input.taskId).first<{ id: number }>();
  if (!exists) return null;

  const result = await input.db.prepare(`
    SELECT
      e.id,
      e.event_type AS "eventType",
      e.actor_id AS "actorId",
      actor.name AS "actorName",
      e.old_status AS "oldStatus",
      e.new_status AS "newStatus",
      e.note,
      e.metadata_json AS "metadataJson",
      e.created_at_utc AS "createdAtUtc"
    FROM admin_action_task_events e
    LEFT JOIN users actor
      ON actor.id = e.actor_id
     AND actor.tenant_id = e.tenant_id
    WHERE e.tenant_id = ? AND e.task_id = ?
    ORDER BY e.created_at_utc ASC, e.id ASC
  `).bind(input.tenantId, input.taskId).all<TaskEventRow>();

  return (result.results ?? []).map((event) => ({
    id: numberValue(event.id),
    eventType: event.eventType,
    actorId: nullableNumber(event.actorId),
    actorName: event.actorName,
    oldStatus: event.oldStatus,
    newStatus: event.newStatus,
    note: event.note,
    metadata: jsonObject(event.metadataJson),
    createdAtUtc: event.createdAtUtc,
  }));
}

export async function loadTaskOperationalSummary(input: {
  db: D1Database;
  tenantId: string;
  userId: number;
  nowUtc?: string;
}): Promise<TaskOperationalSummary> {
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  const row = await input.db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE
        WHEN status IN ('open','in_progress')
          AND due_at_utc IS NOT NULL
          AND datetime(due_at_utc) < datetime(?)
        THEN 1 ELSE 0 END
      ) AS overdue_count,
      SUM(CASE
        WHEN status IN ('open','in_progress') AND assigned_to = ?
        THEN 1 ELSE 0 END
      ) AS assigned_to_me_count,
      SUM(CASE
        WHEN status IN ('open','in_progress')
          AND assigned_to = ?
          AND due_at_utc IS NOT NULL
          AND datetime(due_at_utc) < datetime(?)
        THEN 1 ELSE 0 END
      ) AS assigned_overdue_count
    FROM admin_action_tasks
    WHERE tenant_id = ?
  `).bind(
    nowUtc,
    input.userId,
    input.userId,
    nowUtc,
    input.tenantId,
  ).first<OperationalSummaryRow>();

  return {
    open: Math.max(0, Math.trunc(numberValue(row?.open_count))),
    overdue: Math.max(0, Math.trunc(numberValue(row?.overdue_count))),
    assignedToMe: Math.max(0, Math.trunc(numberValue(row?.assigned_to_me_count))),
    assignedOverdue: Math.max(0, Math.trunc(numberValue(row?.assigned_overdue_count))),
  };
}

export async function loadLegacyTaskSummary(input: {
  db: D1Database;
  tenantId: string;
  nowUtc?: string;
}): Promise<LegacyTaskSummary> {
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  const row = await input.db.prepare(`
    SELECT
      SUM(CASE WHEN status <> 'cancelled' THEN 1 ELSE 0 END) AS total_count,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE
        WHEN status IN ('open','in_progress')
          AND due_at_utc IS NOT NULL
          AND datetime(due_at_utc) < datetime(?)
        THEN 1 ELSE 0 END
      ) AS overdue_count
    FROM admin_action_tasks
    WHERE tenant_id = ?
  `).bind(nowUtc, input.tenantId).first<LegacySummaryRow>();

  return {
    total: Math.max(0, Math.trunc(numberValue(row?.total_count))),
    pending: Math.max(0, Math.trunc(numberValue(row?.pending_count))),
    inProgress: Math.max(0, Math.trunc(numberValue(row?.in_progress_count))),
    completed: Math.max(0, Math.trunc(numberValue(row?.completed_count))),
    overdue: Math.max(0, Math.trunc(numberValue(row?.overdue_count))),
  };
}

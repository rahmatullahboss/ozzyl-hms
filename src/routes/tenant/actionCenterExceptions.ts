import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getFullTimestampGMT6 } from '../../lib/date-utils';
import { requireRole } from '../../middleware/rbac';
import { syncExceptionCases } from '../../services/actionCenter/exceptions/sync';
import {
  ExceptionTransitionValidationError,
  transitionExceptionCase,
  type ExceptionTransition,
} from '../../services/actionCenter/exceptions/transitions';

const actionCenterExceptionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const EXCEPTION_ROLES = [
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
] as const;

const exceptionListQuery = z.object({
  status: z.enum(['active', 'open', 'acknowledged', 'in_progress', 'snoozed', 'resolved', 'dismissed', 'all']).default('open'),
  severity: z.enum(['critical', 'warning', 'info']).optional(),
  type: z.string().trim().max(120).optional(),
  assignee: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });
const optionalNote = z.object({ note: z.string().trim().max(1000).optional() });
const assignBody = z.object({
  assignedTo: z.coerce.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
});
const snoozeBody = z.object({
  snoozedUntil: z.string().trim().min(1).max(40),
  note: z.string().trim().max(1000).optional(),
});
const resolveBody = z.object({
  resolutionCode: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(2000),
});
const dismissBody = z.object({ reason: z.string().trim().min(1).max(2000) });
const reopenBody = z.object({ note: z.string().trim().min(1).max(2000) });

interface ExceptionCaseRow {
  id: number | string;
  rule_key: string;
  fingerprint: string;
  source_type: string;
  source_id: string;
  module: string;
  severity: string;
  title: string;
  description: string;
  source_href?: string | null;
  status: string;
  assigned_to?: number | string | null;
  assigned_to_name?: string | null;
  first_detected_at: string;
  last_detected_at: string;
  acknowledged_by?: number | string | null;
  acknowledged_at?: string | null;
  resolved_by?: number | string | null;
  resolved_at?: string | null;
  resolution_code?: string | null;
  resolution_note?: string | null;
  dismissed_by?: number | string | null;
  dismissed_at?: string | null;
  dismissal_reason?: string | null;
  snoozed_until?: string | null;
  metadata_json?: string | null;
  created_at: string;
  updated_at: string;
}

interface ExceptionEventRow {
  id: number | string;
  event_type: string;
  actor_id?: number | string | null;
  actor_name?: string | null;
  old_status?: string | null;
  new_status?: string | null;
  note?: string | null;
  metadata_json?: string | null;
  created_at: string;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseTimestamp(value: string): number {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+06:00`;
  const timestamp = Date.parse(withZone);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mapCase(row: ExceptionCaseRow, now = getFullTimestampGMT6()) {
  const ageMs = Math.max(0, parseTimestamp(now) - parseTimestamp(row.first_detected_at));
  return {
    id: Number(row.id),
    ruleKey: row.rule_key,
    fingerprint: row.fingerprint,
    sourceType: row.source_type,
    sourceId: String(row.source_id),
    module: row.module,
    severity: row.severity,
    title: row.title,
    description: row.description,
    sourceHref: row.source_href ?? null,
    status: row.status,
    assignedTo: nullableNumber(row.assigned_to),
    assignedToName: row.assigned_to_name ?? null,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    acknowledgedBy: nullableNumber(row.acknowledged_by),
    acknowledgedAt: row.acknowledged_at ?? null,
    resolvedBy: nullableNumber(row.resolved_by),
    resolvedAt: row.resolved_at ?? null,
    resolutionCode: row.resolution_code ?? null,
    resolutionNote: row.resolution_note ?? null,
    dismissedBy: nullableNumber(row.dismissed_by),
    dismissedAt: row.dismissed_at ?? null,
    dismissalReason: row.dismissal_reason ?? null,
    snoozedUntil: row.snoozed_until ?? null,
    metadata: parseJson(row.metadata_json),
    slaAgeHours: Number((ageMs / 3_600_000).toFixed(1)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: ExceptionEventRow) {
  return {
    id: Number(row.id),
    eventType: row.event_type,
    actorId: nullableNumber(row.actor_id),
    actorName: row.actor_name ?? null,
    oldStatus: row.old_status ?? null,
    newStatus: row.new_status ?? null,
    note: row.note ?? null,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  };
}

async function loadCase(db: Env['DB'], tenantId: string, caseId: number): Promise<ExceptionCaseRow | null> {
  return db.prepare(`
    SELECT
      c.*,
      assignee.name AS assigned_to_name
    FROM admin_exception_cases c
    LEFT JOIN users assignee
      ON assignee.id = c.assigned_to
     AND assignee.tenant_id = c.tenant_id
    WHERE c.id = ?
      AND c.tenant_id = ?
    LIMIT 1
  `).bind(caseId, tenantId).first<ExceptionCaseRow>();
}

actionCenterExceptionRoutes.use('*', requireRole(...EXCEPTION_ROLES));

actionCenterExceptionRoutes.get('/', zValidator('query', exceptionListQuery), async (c) => {
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');
  const where = ['c.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (query.status === 'active') {
    where.push(`(
      c.status IN ('open', 'acknowledged', 'in_progress', 'snoozed')
      AND (
        c.status <> 'snoozed'
        OR c.snoozed_until IS NULL
        OR datetime(c.snoozed_until) <= datetime(?)
      )
    )`);
    params.push(getFullTimestampGMT6());
  } else if (query.status !== 'all') {
    where.push('c.status = ?');
    params.push(query.status);
  }
  if (query.severity) {
    where.push('c.severity = ?');
    params.push(query.severity);
  }
  if (query.type) {
    where.push('c.rule_key = ?');
    params.push(query.type);
  }
  if (query.assignee) {
    where.push('c.assigned_to = ?');
    params.push(query.assignee);
  }
  if (query.search) {
    where.push(`(
      LOWER(c.title) LIKE ?
      OR LOWER(c.description) LIKE ?
      OR LOWER(c.source_id) LIKE ?
      OR LOWER(c.rule_key) LIKE ?
    )`);
    const term = `%${query.search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  const whereSql = where.join('\n AND ');
  const countRow = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM admin_exception_cases c
    WHERE ${whereSql}
  `).bind(...params).first<{ total?: number | string | null }>();
  const total = Math.max(0, Math.trunc(Number(countRow?.total ?? 0)));
  const offset = (query.page - 1) * query.limit;

  const result = await c.env.DB.prepare(`
    SELECT
      c.*,
      assignee.name AS assigned_to_name
    FROM admin_exception_cases c
    LEFT JOIN users assignee
      ON assignee.id = c.assigned_to
     AND assignee.tenant_id = c.tenant_id
    WHERE ${whereSql}
    ORDER BY
      CASE c.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
      c.updated_at DESC,
      c.id DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all<ExceptionCaseRow>();

  const summaryRow = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) AS acknowledged,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'snoozed' THEN 1 ELSE 0 END) AS snoozed,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning,
      SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END) AS info
    FROM admin_exception_cases
    WHERE tenant_id = ?
  `).bind(tenantId).first<Record<string, number | string | null>>();

  const summary = Object.fromEntries(
    ['total', 'open', 'acknowledged', 'in_progress', 'snoozed', 'resolved', 'dismissed', 'critical', 'warning', 'info']
      .map((key) => [key, Math.max(0, Math.trunc(Number(summaryRow?.[key] ?? 0)))]),
  );

  return c.json({
    data: {
      items: (result.results ?? []).map((row) => mapCase(row)),
      summary,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    },
  });
});

actionCenterExceptionRoutes.post('/sync', async (c) => {
  const data = await syncExceptionCases({
    db: c.env.DB,
    tenantId: requireTenantId(c),
    actorId: Number(requireUserId(c)),
    now: getFullTimestampGMT6(),
  });
  return c.json({ data });
});

actionCenterExceptionRoutes.get('/:id/events', zValidator('param', idParam), async (c) => {
  const tenantId = requireTenantId(c);
  const { id } = c.req.valid('param');
  const exists = await c.env.DB.prepare(`
    SELECT id
    FROM admin_exception_cases
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(id, tenantId).first<{ id: number }>();
  if (!exists) return c.json({ error: 'Exception case not found' }, 404);

  const result = await c.env.DB.prepare(`
    SELECT
      e.id,
      e.event_type,
      e.actor_id,
      actor.name AS actor_name,
      e.old_status,
      e.new_status,
      e.note,
      e.metadata_json,
      e.created_at
    FROM admin_exception_events e
    LEFT JOIN users actor
      ON actor.id = e.actor_id
     AND actor.tenant_id = e.tenant_id
    WHERE e.tenant_id = ?
      AND e.case_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).bind(tenantId, id).all<ExceptionEventRow>();

  return c.json({ data: (result.results ?? []).map(mapEvent) });
});

actionCenterExceptionRoutes.get('/:id', zValidator('param', idParam), async (c) => {
  const tenantId = requireTenantId(c);
  const { id } = c.req.valid('param');
  const row = await loadCase(c.env.DB, tenantId, id);
  if (!row) return c.json({ error: 'Exception case not found' }, 404);
  return c.json({ data: mapCase(row) });
});

async function runTransition(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  caseId: number,
  transition: ExceptionTransition,
) {
  const tenantId = requireTenantId(c);
  try {
    const result = await transitionExceptionCase({
      db: c.env.DB,
      tenantId,
      caseId,
      actorId: Number(requireUserId(c)),
      transition,
      now: getFullTimestampGMT6(),
    });
    if (result === 'not_found') return c.json({ error: 'Exception case not found' }, 404);
    if (result === 'conflict') return c.json({ error: 'Exception case changed or action is invalid for its current state' }, 409);
    const row = await loadCase(c.env.DB, tenantId, caseId);
    if (!row) return c.json({ error: 'Exception case not found' }, 404);
    return c.json({ data: mapCase(row) });
  } catch (error) {
    if (error instanceof ExceptionTransitionValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
}

actionCenterExceptionRoutes.put('/:id/acknowledge', zValidator('param', idParam), zValidator('json', optionalNote), (c) => (
  runTransition(c, c.req.valid('param').id, { action: 'acknowledge', note: c.req.valid('json').note })
));

actionCenterExceptionRoutes.put('/:id/assign', zValidator('param', idParam), zValidator('json', assignBody), async (c) => {
  const body = c.req.valid('json');
  const tenantId = requireTenantId(c);
  const assignee = await c.env.DB.prepare(`
    SELECT id
    FROM users
    WHERE id = ?
      AND tenant_id = ?
    LIMIT 1
  `).bind(body.assignedTo, tenantId).first<{ id: number }>();
  if (!assignee) return c.json({ error: 'Assignee is not available for this tenant' }, 400);
  return runTransition(c, c.req.valid('param').id, { action: 'assign', assignedTo: body.assignedTo, note: body.note });
});

actionCenterExceptionRoutes.put('/:id/start', zValidator('param', idParam), zValidator('json', optionalNote), (c) => (
  runTransition(c, c.req.valid('param').id, { action: 'start', note: c.req.valid('json').note })
));

actionCenterExceptionRoutes.put('/:id/snooze', zValidator('param', idParam), zValidator('json', snoozeBody), (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, { action: 'snooze', snoozedUntil: body.snoozedUntil, note: body.note });
});

actionCenterExceptionRoutes.put('/:id/resolve', zValidator('param', idParam), zValidator('json', resolveBody), (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, { action: 'resolve', resolutionCode: body.resolutionCode, note: body.note });
});

actionCenterExceptionRoutes.put('/:id/dismiss', zValidator('param', idParam), zValidator('json', dismissBody), (c) => (
  runTransition(c, c.req.valid('param').id, { action: 'dismiss', reason: c.req.valid('json').reason })
));

actionCenterExceptionRoutes.put('/:id/reopen', zValidator('param', idParam), zValidator('json', reopenBody), (c) => (
  runTransition(c, c.req.valid('param').id, { action: 'reopen', note: c.req.valid('json').note })
));

export default actionCenterExceptionRoutes;

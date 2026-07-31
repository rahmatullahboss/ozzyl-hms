import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireTenantId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import {
  getTaskDetail,
  getTaskEvents,
  listTasks,
  type TaskListQuery,
} from '../../services/actionCenter/tasks/query';
import {
  TaskConflictError,
  TaskValidationError,
  createManualTask,
  transitionTask,
  type TaskTransition,
} from '../../services/actionCenter/tasks/service';
import type { Env, Variables } from '../../types';

const taskRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const TASK_ROLES = [
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
] as const;

const TEAM_VIEW_ROLES = new Set<string>([
  'hospital_admin',
  'md',
  'director',
  'manager',
]);

const utcTimestampSchema = z.string()
  .trim()
  .max(40)
  .refine((value) => value.endsWith('Z') && Number.isFinite(Date.parse(value)), {
    message: 'Expected a valid UTC timestamp.',
  });

const taskIdParamSchema = z.object({
  id: z.coerce.number().int().safe().positive(),
});

const listQuerySchema = z.object({
  view: z.enum(['mine', 'team', 'due_today', 'overdue', 'completed', 'all']).default('mine'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  sourceType: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  assignedTo: z.number().int().safe().positive().optional(),
  dueAtUtc: utcTimestampSchema.optional(),
});

const expectedTimestampSchema = utcTimestampSchema.optional();

const assignSchema = z.object({
  assignedTo: z.number().int().safe().positive(),
  note: z.string().trim().max(2000).optional(),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const startSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const rescheduleSchema = z.object({
  dueAtUtc: utcTimestampSchema,
  note: z.string().trim().max(2000).optional(),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const completeSchema = z.object({
  note: z.string().trim().min(1).max(2000),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const cancelSchema = z.object({
  note: z.string().trim().min(1).max(2000),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

function userId(c: Context<{ Bindings: Env; Variables: Variables }>): number {
  return Number(c.get('userId'));
}

function canViewTeamTasks(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
  return TEAM_VIEW_ROLES.has(String(c.get('role') ?? ''));
}

function taskError(c: Context<{ Bindings: Env; Variables: Variables }>, error: unknown) {
  if (error instanceof TaskValidationError) {
    return c.json({ error: error.message }, 422);
  }
  if (error instanceof TaskConflictError) {
    return c.json({ error: error.message }, 409);
  }
  throw error;
}

async function loadDetail(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  taskId: number,
) {
  return getTaskDetail({
    db: c.env.DB,
    tenantId: requireTenantId(c),
    taskId,
  });
}

async function loadAccessibleDetail(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  taskId: number,
) {
  const detail = await loadDetail(c, taskId);
  if (!detail) return null;
  if (canViewTeamTasks(c)) return detail;
  return detail.assignedTo === userId(c) ? detail : null;
}

async function runTransition(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  taskId: number,
  transition: TaskTransition,
  expectedUpdatedAtUtc?: string,
) {
  try {
    const current = await loadAccessibleDetail(c, taskId);
    if (!current) return c.json({ error: 'Task not found.' }, 404);
    if (
      !canViewTeamTasks(c)
      && transition.action === 'assign'
      && transition.assignedTo !== userId(c)
    ) {
      return c.json({ error: 'You can only assign a task to yourself.' }, 403);
    }

    const result = await transitionTask({
      db: c.env.DB,
      tenantId: requireTenantId(c),
      taskId,
      actorId: userId(c),
      expectedUpdatedAtUtc,
      transition,
    });
    if (result === 'not_found') return c.json({ error: 'Task not found.' }, 404);
    if (result === 'conflict') return c.json({ error: 'Task changed or is no longer actionable.' }, 409);

    const detail = await loadDetail(c, taskId);
    if (!detail) return c.json({ error: 'Task not found.' }, 404);
    return c.json({ data: detail });
  } catch (error) {
    return taskError(c, error);
  }
}

taskRoutes.use('*', requireRole(...TASK_ROLES));

taskRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  if (query.view !== 'mine' && !canViewTeamTasks(c)) {
    return c.json({ error: 'This task view requires a management role.' }, 403);
  }

  const result = await listTasks({
    db: c.env.DB,
    tenantId: requireTenantId(c),
    userId: userId(c),
    query: query as TaskListQuery,
  });
  return c.json({ data: result });
});

taskRoutes.post('/', zValidator('json', createTaskSchema), async (c) => {
  const body = c.req.valid('json');
  const actorId = userId(c);
  if (
    !canViewTeamTasks(c)
    && body.assignedTo !== undefined
    && body.assignedTo !== actorId
  ) {
    return c.json({ error: 'You can only create a task assigned to yourself.' }, 403);
  }

  try {
    const taskId = await createManualTask({
      db: c.env.DB,
      tenantId: requireTenantId(c),
      actorId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      assignedTo: canViewTeamTasks(c) ? body.assignedTo : actorId,
      dueAtUtc: body.dueAtUtc,
    });
    const detail = await loadDetail(c, taskId);
    if (!detail) return c.json({ error: 'Task could not be loaded after creation.' }, 409);
    return c.json({ data: detail }, 201);
  } catch (error) {
    return taskError(c, error);
  }
});

taskRoutes.get('/:id/events', zValidator('param', taskIdParamSchema), async (c) => {
  const taskId = c.req.valid('param').id;
  const detail = await loadAccessibleDetail(c, taskId);
  if (!detail) return c.json({ error: 'Task not found.' }, 404);

  const events = await getTaskEvents({
    db: c.env.DB,
    tenantId: requireTenantId(c),
    taskId,
  });
  if (!events) return c.json({ error: 'Task not found.' }, 404);
  return c.json({ data: events });
});

taskRoutes.get('/:id', zValidator('param', taskIdParamSchema), async (c) => {
  const detail = await loadAccessibleDetail(c, c.req.valid('param').id);
  if (!detail) return c.json({ error: 'Task not found.' }, 404);
  return c.json({ data: detail });
});

taskRoutes.put('/:id/assign', zValidator('param', taskIdParamSchema), zValidator('json', assignSchema), async (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, {
    action: 'assign',
    assignedTo: body.assignedTo,
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

taskRoutes.put('/:id/start', zValidator('param', taskIdParamSchema), zValidator('json', startSchema), async (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, {
    action: 'start',
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

taskRoutes.put('/:id/reschedule', zValidator('param', taskIdParamSchema), zValidator('json', rescheduleSchema), async (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, {
    action: 'reschedule',
    dueAtUtc: body.dueAtUtc,
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

taskRoutes.put('/:id/complete', zValidator('param', taskIdParamSchema), zValidator('json', completeSchema), async (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, {
    action: 'complete',
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

taskRoutes.put('/:id/cancel', zValidator('param', taskIdParamSchema), zValidator('json', cancelSchema), async (c) => {
  const body = c.req.valid('json');
  return runTransition(c, c.req.valid('param').id, {
    action: 'cancel',
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

export default taskRoutes;

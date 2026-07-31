import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId, parseId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

// ─── Inline Zod Schemas ────────────────────────────────────────────────────

const carePlanStatusEnum = z.enum([
  'draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error',
]);

const priorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);

const createCarePlanSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  Code: z.string().max(50).optional(),
  CodeText: z.string().max(255).optional(),
  CarePlanType: z.string().max(50),
  Description: z.string().max(2000),
  NoteRelatedTo: z.string().max(500).optional(),
  StartDate: z.string().optional(),
  EndDate: z.string().optional(),
  ProposedDate: z.string().optional(),
  PlanStatus: carePlanStatusEnum,
  ReasonCode: z.string().max(50).optional(),
  ReasonDescription: z.string().max(500).optional(),
  ReasonDateLow: z.string().optional(),
  ReasonDateHigh: z.string().optional(),
  ReasonStatus: z.string().max(50).optional(),
});

const updateCarePlanSchema = createCarePlanSchema.partial();

const createGoalSchema = z.object({
  GoalDescription: z.string().max(2000),
  GoalType: z.string().max(50).optional(),
  GoalCategory: z.string().max(100).optional(),
  TargetDate: z.string().optional(),
  Priority: priorityEnum,
  MeasurementCriteria: z.string().max(1000).optional(),
  BaselineStatus: z.string().max(500).optional(),
  CurrentStatus: z.string().max(50),
  ProgressNotes: z.string().max(2000).optional(),
  AchievementDate: z.string().optional(),
});

const updateGoalSchema = createGoalSchema.partial();

const createInterventionSchema = z.object({
  InterventionDescription: z.string().max(2000),
  InterventionType: z.string().max(50).optional(),
  InterventionCode: z.string().max(50).optional(),
  Frequency: z.string().max(100).optional(),
  Duration: z.string().max(100).optional(),
  Instructions: z.string().max(2000).optional(),
  ResponsibleRole: z.string().max(100).optional(),
  Status: z.string().max(50),
  StartDate: z.string().optional(),
  EndDate: z.string().optional(),
  Outcome: z.string().max(50).optional(),
  OutcomeNotes: z.string().max(2000).optional(),
});

const updateInterventionSchema = createInterventionSchema.partial();

const createTaskSchema = z.object({
  GoalId: z.number().int().positive().optional(),
  InterventionId: z.number().int().positive().optional(),
  TaskDescription: z.string().max(2000),
  TaskType: z.string().max(50).optional(),
  AssignedTo: z.number().int().positive().optional(),
  AssignedRole: z.string().max(100).optional(),
  DueDate: z.string().optional(),
  CompletedDate: z.string().optional(),
  Status: z.string().max(50),
  Priority: priorityEnum,
  CompletionNotes: z.string().max(2000).optional(),
  Outcome: z.string().max(50).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

const createTeamMemberSchema = z.object({
  EmployeeId: z.number().int().positive().optional(),
  ExternalProviderId: z.number().int().positive().optional(),
  ProviderName: z.string().max(200),
  ProviderRole: z.string().max(100),
  Specialty: z.string().max(100).optional(),
  ContactEmail: z.string().email().max(200).optional(),
  ContactPhone: z.string().max(50).optional(),
  Organization: z.string().max(200).optional(),
  IsPrimary: z.boolean().default(false),
  InvolvementLevel: z.string().max(50).optional(),
  RoleDescription: z.string().max(500).optional(),
  Notes: z.string().max(2000).optional(),
});

const updateTeamMemberSchema = createTeamMemberSchema.partial();

const createProgressNoteSchema = z.object({
  GoalId: z.number().int().positive().optional(),
  InterventionId: z.number().int().positive().optional(),
  TaskId: z.number().int().positive().optional(),
  NoteDate: z.string(),
  NoteType: z.string().max(50).default('progress'),
  NoteContent: z.string().max(5000),
  RelatedData: z.string().max(2000).optional(),
});

// ─── Helper: build SET clause from partial data ────────────────────────────

function buildUpdateSets(
  fields: Record<string, { column: string; value: unknown }>,
): { setClauses: string[]; params: unknown[] } {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [, { column, value }] of Object.entries(fields)) {
    if (value !== undefined) {
      setClauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  return { setClauses, params };
}

// ─── Helper: verify care plan exists and belongs to tenant ─────────────────

async function findCarePlan(
  db: ReturnType<typeof getDb>,
  carePlanId: number,
  tenantId: string,
) {
  return db.$client
    .prepare(
      'SELECT CarePlanId, PatientId FROM CLN_CarePlan WHERE CarePlanId = ? AND tenant_id = ? AND IsDeleted = 0',
    )
    .bind(carePlanId, tenantId)
    .first();
}

// ═══════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════

export const carePlanRoutes = new Hono<ClinicalEnv>();

// ─── Care Plan CRUD ────────────────────────────────────────────────────────

// GET / — list care plans for patient (query: patientId), include goal count
carePlanRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const status = c.req.query('status');
  const type = c.req.query('type');

  let query = `
    SELECT cp.*,
      (SELECT COUNT(*) FROM CLN_CarePlanGoal g
       WHERE g.CarePlanId = cp.CarePlanId AND g.IsDeleted = 0) AS GoalCount
    FROM CLN_CarePlan cp
    WHERE cp.tenant_id = ? AND cp.PatientId = ? AND cp.IsDeleted = 0
  `;
  const params: unknown[] = [tenantId, Number(patientId)];

  if (status) {
    query += ' AND cp.PlanStatus = ?';
    params.push(status);
  }
  if (type) {
    query += ' AND cp.CarePlanType = ?';
    params.push(type);
  }

  query += ' ORDER BY cp.CreatedDate DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();

  return c.json({ Results: results });
});

// GET /:id — get care plan with goals, interventions, tasks, team members, progress notes
carePlanRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');

  const plan = await db.$client
    .prepare(
      'SELECT * FROM CLN_CarePlan WHERE CarePlanId = ? AND tenant_id = ? AND IsDeleted = 0',
    )
    .bind(carePlanId, tenantId)
    .first();

  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for fetching care plan details.
  // Why: Promise.all() sends 5 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() sends a single network request containing all 5 queries.
  // Impact: Eliminates 4 network round-trips, significantly reducing latency and
  //         making the care plan details load much faster.
  const [goalsRes, interventionsRes, tasksRes, teamMembersRes, progressNotesRes] = await db.$client.batch([
    db.$client
      .prepare(
        `SELECT * FROM CLN_CarePlanGoal
         WHERE CarePlanId = ? AND tenant_id = ? AND IsDeleted = 0
         ORDER BY Priority ASC, CreatedAt DESC`,
      )
      .bind(carePlanId, tenantId),
    db.$client
      .prepare(
        `SELECT * FROM CLN_CarePlanIntervention
         WHERE CarePlanId = ? AND tenant_id = ? AND IsDeleted = 0
         ORDER BY CreatedAt DESC`,
      )
      .bind(carePlanId, tenantId),
    db.$client
      .prepare(
        `SELECT * FROM CLN_CarePlanTask
         WHERE CarePlanId = ? AND tenant_id = ? AND IsDeleted = 0
         ORDER BY
           CASE Priority
             WHEN 'urgent' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             WHEN 'low' THEN 4
           END,
           DueDate ASC`,
      )
      .bind(carePlanId, tenantId),
    db.$client
      .prepare(
        `SELECT * FROM CLN_CarePlanTeamMember
         WHERE CarePlanId = ? AND tenant_id = ? AND IsDeleted = 0 AND IsActive = 1
         ORDER BY IsPrimary DESC, ProviderName ASC`,
      )
      .bind(carePlanId, tenantId),
    db.$client
      .prepare(
        `SELECT * FROM CLN_CarePlanProgressNote
         WHERE CarePlanId = ? AND tenant_id = ?
         ORDER BY NoteDate DESC, CreatedAt DESC`,
      )
      .bind(carePlanId, tenantId),
  ]);

  const goals = { results: goalsRes.results };
  const interventions = { results: interventionsRes.results };
  const tasks = { results: tasksRes.results };
  const teamMembers = { results: teamMembersRes.results };
  const progressNotes = { results: progressNotesRes.results };

  return c.json({
    Results: {
      ...plan,
      Goals: goals.results,
      Interventions: interventions.results,
      Tasks: tasks.results,
      TeamMembers: teamMembers.results,
      ProgressNotes: progressNotes.results,
    },
  });
});

// POST / — create care plan
carePlanRoutes.post('/', zValidator('json', createCarePlanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const now = new Date().toISOString();

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_CarePlan (
        tenant_id, PatientId, EncounterId,
        Code, CodeText, CarePlanType,
        Description, NoteRelatedTo,
        StartDate, EndDate, ProposedDate,
        PlanStatus,
        ReasonCode, ReasonDescription, ReasonDateLow, ReasonDateHigh, ReasonStatus,
        CreatedBy, CreatedDate, IsDeleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      tenantId,
      data.PatientId,
      data.EncounterId ?? null,
      data.Code ?? null,
      data.CodeText ?? null,
      data.CarePlanType,
      data.Description,
      data.NoteRelatedTo ?? null,
      data.StartDate ?? null,
      data.EndDate ?? null,
      data.ProposedDate ?? null,
      data.PlanStatus,
      data.ReasonCode ?? null,
      data.ReasonDescription ?? null,
      data.ReasonDateLow ?? null,
      data.ReasonDateHigh ?? null,
      data.ReasonStatus ?? null,
      userId,
      now,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /:id — update care plan
carePlanRoutes.put('/:id', zValidator('json', updateCarePlanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');
  const data = c.req.valid('json');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  const { setClauses, params } = buildUpdateSets({
    Code: { column: 'Code', value: data.Code },
    CodeText: { column: 'CodeText', value: data.CodeText },
    CarePlanType: { column: 'CarePlanType', value: data.CarePlanType },
    Description: { column: 'Description', value: data.Description },
    NoteRelatedTo: { column: 'NoteRelatedTo', value: data.NoteRelatedTo },
    StartDate: { column: 'StartDate', value: data.StartDate },
    EndDate: { column: 'EndDate', value: data.EndDate },
    ProposedDate: { column: 'ProposedDate', value: data.ProposedDate },
    PlanStatus: { column: 'PlanStatus', value: data.PlanStatus },
    ReasonCode: { column: 'ReasonCode', value: data.ReasonCode },
    ReasonDescription: { column: 'ReasonDescription', value: data.ReasonDescription },
    ReasonDateLow: { column: 'ReasonDateLow', value: data.ReasonDateLow },
    ReasonDateHigh: { column: 'ReasonDateHigh', value: data.ReasonDateHigh },
    ReasonStatus: { column: 'ReasonStatus', value: data.ReasonStatus },
  });

  if (setClauses.length === 0) {
    return c.json({ Results: { message: 'No changes to update' } });
  }

  setClauses.push('ModifiedBy = ?', 'ModifiedAt = ?');
  params.push(userId, new Date().toISOString());
  params.push(carePlanId, tenantId);

  await db.$client
    .prepare(`UPDATE CLN_CarePlan SET ${setClauses.join(', ')} WHERE CarePlanId = ? AND tenant_id = ?`)
    .bind(...params)
    .run();

  return c.json({ Results: { message: 'Care plan updated' } });
});

// DELETE /:id — soft delete (IsDeleted = 1)
carePlanRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  await db.$client
    .prepare(
      'UPDATE CLN_CarePlan SET IsDeleted = 1, DeletedBy = ?, DeletedAt = ? WHERE CarePlanId = ? AND tenant_id = ?',
    )
    .bind(userId, new Date().toISOString(), carePlanId, tenantId)
    .run();

  return c.json({ Results: { message: 'Care plan deleted' } });
});

// ─── Goals ─────────────────────────────────────────────────────────────────

// POST /:id/goals — create goal for care plan
carePlanRoutes.post('/:id/goals', zValidator('json', createGoalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');
  const data = c.req.valid('json');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  const now = new Date().toISOString();

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_CarePlanGoal (
        tenant_id, CarePlanId,
        GoalDescription, GoalType, GoalCategory,
        TargetDate, Priority, MeasurementCriteria, BaselineStatus,
        CurrentStatus, ProgressNotes, AchievementDate,
        CreatedBy, CreatedAt, IsDeleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      tenantId,
      carePlanId,
      data.GoalDescription,
      data.GoalType ?? null,
      data.GoalCategory ?? null,
      data.TargetDate ?? null,
      data.Priority,
      data.MeasurementCriteria ?? null,
      data.BaselineStatus ?? null,
      data.CurrentStatus,
      data.ProgressNotes ?? null,
      data.AchievementDate ?? null,
      userId,
      now,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /goals/:goalId — update goal
carePlanRoutes.put('/goals/:goalId', zValidator('json', updateGoalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const goalId = parseId(c.req.param('goalId'), 'GoalId');

  const goal = await db.$client
    .prepare('SELECT GoalId FROM CLN_CarePlanGoal WHERE GoalId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(goalId, tenantId)
    .first();
  if (!goal) {
    throw new HTTPException(404, { message: 'Goal not found' });
  }

  const data = c.req.valid('json');

  const { setClauses, params } = buildUpdateSets({
    GoalDescription: { column: 'GoalDescription', value: data.GoalDescription },
    GoalType: { column: 'GoalType', value: data.GoalType },
    GoalCategory: { column: 'GoalCategory', value: data.GoalCategory },
    TargetDate: { column: 'TargetDate', value: data.TargetDate },
    Priority: { column: 'Priority', value: data.Priority },
    MeasurementCriteria: { column: 'MeasurementCriteria', value: data.MeasurementCriteria },
    BaselineStatus: { column: 'BaselineStatus', value: data.BaselineStatus },
    CurrentStatus: { column: 'CurrentStatus', value: data.CurrentStatus },
    ProgressNotes: { column: 'ProgressNotes', value: data.ProgressNotes },
    AchievementDate: { column: 'AchievementDate', value: data.AchievementDate },
  });

  if (setClauses.length === 0) {
    return c.json({ Results: { message: 'No changes to update' } });
  }

  setClauses.push('ModifiedBy = ?', 'ModifiedAt = ?');
  params.push(userId, new Date().toISOString());
  params.push(goalId, tenantId);

  await db.$client
    .prepare(`UPDATE CLN_CarePlanGoal SET ${setClauses.join(', ')} WHERE GoalId = ? AND tenant_id = ?`)
    .bind(...params)
    .run();

  return c.json({ Results: { message: 'Goal updated' } });
});

// DELETE /goals/:goalId — soft delete goal
carePlanRoutes.delete('/goals/:goalId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const goalId = parseId(c.req.param('goalId'), 'GoalId');

  const goal = await db.$client
    .prepare('SELECT GoalId FROM CLN_CarePlanGoal WHERE GoalId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(goalId, tenantId)
    .first();
  if (!goal) {
    throw new HTTPException(404, { message: 'Goal not found' });
  }

  await db.$client
    .prepare('UPDATE CLN_CarePlanGoal SET IsDeleted = 1, DeletedBy = ?, DeletedAt = ? WHERE GoalId = ? AND tenant_id = ?')
    .bind(userId, new Date().toISOString(), goalId, tenantId)
    .run();

  return c.json({ Results: { message: 'Goal deleted' } });
});

// ─── Interventions ─────────────────────────────────────────────────────────

// POST /:id/interventions — create intervention
carePlanRoutes.post('/:id/interventions', zValidator('json', createInterventionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');
  const data = c.req.valid('json');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  const now = new Date().toISOString();

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_CarePlanIntervention (
        tenant_id, CarePlanId,
        InterventionDescription, InterventionType, InterventionCode,
        Frequency, Duration, Instructions, ResponsibleRole,
        Status, StartDate, EndDate,
        Outcome, OutcomeNotes,
        CreatedBy, CreatedAt, IsDeleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      tenantId,
      carePlanId,
      data.InterventionDescription,
      data.InterventionType ?? null,
      data.InterventionCode ?? null,
      data.Frequency ?? null,
      data.Duration ?? null,
      data.Instructions ?? null,
      data.ResponsibleRole ?? null,
      data.Status,
      data.StartDate ?? null,
      data.EndDate ?? null,
      data.Outcome ?? null,
      data.OutcomeNotes ?? null,
      userId,
      now,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /interventions/:interventionId — update intervention
carePlanRoutes.put('/interventions/:interventionId', zValidator('json', updateInterventionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const interventionId = parseId(c.req.param('interventionId'), 'InterventionId');

  const row = await db.$client
    .prepare('SELECT InterventionId FROM CLN_CarePlanIntervention WHERE InterventionId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(interventionId, tenantId)
    .first();
  if (!row) {
    throw new HTTPException(404, { message: 'Intervention not found' });
  }

  const data = c.req.valid('json');

  const { setClauses, params } = buildUpdateSets({
    InterventionDescription: { column: 'InterventionDescription', value: data.InterventionDescription },
    InterventionType: { column: 'InterventionType', value: data.InterventionType },
    InterventionCode: { column: 'InterventionCode', value: data.InterventionCode },
    Frequency: { column: 'Frequency', value: data.Frequency },
    Duration: { column: 'Duration', value: data.Duration },
    Instructions: { column: 'Instructions', value: data.Instructions },
    ResponsibleRole: { column: 'ResponsibleRole', value: data.ResponsibleRole },
    Status: { column: 'Status', value: data.Status },
    StartDate: { column: 'StartDate', value: data.StartDate },
    EndDate: { column: 'EndDate', value: data.EndDate },
    Outcome: { column: 'Outcome', value: data.Outcome },
    OutcomeNotes: { column: 'OutcomeNotes', value: data.OutcomeNotes },
  });

  if (setClauses.length === 0) {
    return c.json({ Results: { message: 'No changes to update' } });
  }

  setClauses.push('ModifiedBy = ?', 'ModifiedAt = ?');
  params.push(userId, new Date().toISOString());
  params.push(interventionId, tenantId);

  await db.$client
    .prepare(`UPDATE CLN_CarePlanIntervention SET ${setClauses.join(', ')} WHERE InterventionId = ? AND tenant_id = ?`)
    .bind(...params)
    .run();

  return c.json({ Results: { message: 'Intervention updated' } });
});

// DELETE /interventions/:interventionId — soft delete intervention
carePlanRoutes.delete('/interventions/:interventionId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const interventionId = parseId(c.req.param('interventionId'), 'InterventionId');

  const row = await db.$client
    .prepare('SELECT InterventionId FROM CLN_CarePlanIntervention WHERE InterventionId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(interventionId, tenantId)
    .first();
  if (!row) {
    throw new HTTPException(404, { message: 'Intervention not found' });
  }

  await db.$client
    .prepare('UPDATE CLN_CarePlanIntervention SET IsDeleted = 1, DeletedBy = ?, DeletedAt = ? WHERE InterventionId = ? AND tenant_id = ?')
    .bind(userId, new Date().toISOString(), interventionId, tenantId)
    .run();

  return c.json({ Results: { message: 'Intervention deleted' } });
});

// ─── Tasks ─────────────────────────────────────────────────────────────────

// POST /:id/tasks — create task
carePlanRoutes.post('/:id/tasks', zValidator('json', createTaskSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');
  const data = c.req.valid('json');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  const now = new Date().toISOString();

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_CarePlanTask (
        tenant_id, CarePlanId, GoalId, InterventionId,
        TaskDescription, TaskType,
        AssignedTo, AssignedRole, AssignedDate,
        DueDate, CompletedDate,
        Status, Priority,
        CompletionNotes, Outcome,
        CreatedBy, CreatedAt, IsDeleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      tenantId,
      carePlanId,
      data.GoalId ?? null,
      data.InterventionId ?? null,
      data.TaskDescription,
      data.TaskType ?? null,
      data.AssignedTo ?? null,
      data.AssignedRole ?? null,
      now,
      data.DueDate ?? null,
      data.CompletedDate ?? null,
      data.Status,
      data.Priority,
      data.CompletionNotes ?? null,
      data.Outcome ?? null,
      userId,
      now,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /tasks/:taskId — update task
carePlanRoutes.put('/tasks/:taskId', zValidator('json', updateTaskSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const taskId = parseId(c.req.param('taskId'), 'TaskId');

  const row = await db.$client
    .prepare('SELECT TaskId FROM CLN_CarePlanTask WHERE TaskId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(taskId, tenantId)
    .first();
  if (!row) {
    throw new HTTPException(404, { message: 'Task not found' });
  }

  const data = c.req.valid('json');

  const { setClauses, params } = buildUpdateSets({
    TaskDescription: { column: 'TaskDescription', value: data.TaskDescription },
    TaskType: { column: 'TaskType', value: data.TaskType },
    AssignedTo: { column: 'AssignedTo', value: data.AssignedTo },
    AssignedRole: { column: 'AssignedRole', value: data.AssignedRole },
    DueDate: { column: 'DueDate', value: data.DueDate },
    CompletedDate: { column: 'CompletedDate', value: data.CompletedDate },
    Status: { column: 'Status', value: data.Status },
    Priority: { column: 'Priority', value: data.Priority },
    CompletionNotes: { column: 'CompletionNotes', value: data.CompletionNotes },
    Outcome: { column: 'Outcome', value: data.Outcome },
  });

  if (setClauses.length === 0) {
    return c.json({ Results: { message: 'No changes to update' } });
  }

  setClauses.push('ModifiedBy = ?', 'ModifiedAt = ?');
  params.push(userId, new Date().toISOString());
  params.push(taskId, tenantId);

  await db.$client
    .prepare(`UPDATE CLN_CarePlanTask SET ${setClauses.join(', ')} WHERE TaskId = ? AND tenant_id = ?`)
    .bind(...params)
    .run();

  return c.json({ Results: { message: 'Task updated' } });
});

// DELETE /tasks/:taskId — soft delete task
carePlanRoutes.delete('/tasks/:taskId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const taskId = parseId(c.req.param('taskId'), 'TaskId');

  const row = await db.$client
    .prepare('SELECT TaskId FROM CLN_CarePlanTask WHERE TaskId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(taskId, tenantId)
    .first();
  if (!row) {
    throw new HTTPException(404, { message: 'Task not found' });
  }

  await db.$client
    .prepare('UPDATE CLN_CarePlanTask SET IsDeleted = 1, DeletedBy = ?, DeletedAt = ? WHERE TaskId = ? AND tenant_id = ?')
    .bind(userId, new Date().toISOString(), taskId, tenantId)
    .run();

  return c.json({ Results: { message: 'Task deleted' } });
});

// ─── Team Members ──────────────────────────────────────────────────────────

// POST /:id/team-members — add team member
carePlanRoutes.post('/:id/team-members', zValidator('json', createTeamMemberSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');
  const data = c.req.valid('json');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  const now = new Date().toISOString();

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_CarePlanTeamMember (
        tenant_id, CarePlanId,
        EmployeeId, ExternalProviderId,
        ProviderName, ProviderRole, Specialty,
        ContactEmail, ContactPhone, Organization,
        IsPrimary, IsActive, InvolvementLevel,
        RoleDescription, Notes,
        CreatedBy, CreatedAt, DateAdded, IsDeleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      tenantId,
      carePlanId,
      data.EmployeeId ?? null,
      data.ExternalProviderId ?? null,
      data.ProviderName,
      data.ProviderRole,
      data.Specialty ?? null,
      data.ContactEmail ?? null,
      data.ContactPhone ?? null,
      data.Organization ?? null,
      data.IsPrimary ? 1 : 0,
      data.InvolvementLevel ?? null,
      data.RoleDescription ?? null,
      data.Notes ?? null,
      userId,
      now,
      now,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /team-members/:memberId — update team member
carePlanRoutes.put('/team-members/:memberId', zValidator('json', updateTeamMemberSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const memberId = parseId(c.req.param('memberId'), 'TeamMemberId');

  const row = await db.$client
    .prepare('SELECT TeamMemberId FROM CLN_CarePlanTeamMember WHERE TeamMemberId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(memberId, tenantId)
    .first();
  if (!row) {
    throw new HTTPException(404, { message: 'Team member not found' });
  }

  const data = c.req.valid('json');

  const { setClauses, params } = buildUpdateSets({
    EmployeeId: { column: 'EmployeeId', value: data.EmployeeId },
    ExternalProviderId: { column: 'ExternalProviderId', value: data.ExternalProviderId },
    ProviderName: { column: 'ProviderName', value: data.ProviderName },
    ProviderRole: { column: 'ProviderRole', value: data.ProviderRole },
    Specialty: { column: 'Specialty', value: data.Specialty },
    ContactEmail: { column: 'ContactEmail', value: data.ContactEmail },
    ContactPhone: { column: 'ContactPhone', value: data.ContactPhone },
    Organization: { column: 'Organization', value: data.Organization },
    IsPrimary: { column: 'IsPrimary', value: data.IsPrimary !== undefined ? (data.IsPrimary ? 1 : 0) : undefined },
    InvolvementLevel: { column: 'InvolvementLevel', value: data.InvolvementLevel },
    RoleDescription: { column: 'RoleDescription', value: data.RoleDescription },
    Notes: { column: 'Notes', value: data.Notes },
  });

  if (setClauses.length === 0) {
    return c.json({ Results: { message: 'No changes to update' } });
  }

  setClauses.push('ModifiedBy = ?', 'ModifiedAt = ?');
  params.push(userId, new Date().toISOString());
  params.push(memberId, tenantId);

  await db.$client
    .prepare(`UPDATE CLN_CarePlanTeamMember SET ${setClauses.join(', ')} WHERE TeamMemberId = ? AND tenant_id = ?`)
    .bind(...params)
    .run();

  return c.json({ Results: { message: 'Team member updated' } });
});

// DELETE /team-members/:memberId — remove team member (soft delete + deactivate)
carePlanRoutes.delete('/team-members/:memberId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const memberId = parseId(c.req.param('memberId'), 'TeamMemberId');

  const row = await db.$client
    .prepare('SELECT TeamMemberId FROM CLN_CarePlanTeamMember WHERE TeamMemberId = ? AND tenant_id = ? AND IsDeleted = 0')
    .bind(memberId, tenantId)
    .first();
  if (!row) {
    throw new HTTPException(404, { message: 'Team member not found' });
  }

  await db.$client
    .prepare(
      'UPDATE CLN_CarePlanTeamMember SET IsDeleted = 1, IsActive = 0, DeletedBy = ?, DeletedAt = ? WHERE TeamMemberId = ? AND tenant_id = ?',
    )
    .bind(userId, new Date().toISOString(), memberId, tenantId)
    .run();

  return c.json({ Results: { message: 'Team member removed' } });
});

// ─── Progress Notes ────────────────────────────────────────────────────────

// POST /:id/progress-notes — add progress note
carePlanRoutes.post('/:id/progress-notes', zValidator('json', createProgressNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const carePlanId = parseId(c.req.param('id'), 'CarePlanId');
  const data = c.req.valid('json');

  const plan = await findCarePlan(db, carePlanId, tenantId);
  if (!plan) {
    throw new HTTPException(404, { message: 'Care plan not found' });
  }

  const now = new Date().toISOString();

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_CarePlanProgressNote (
        tenant_id, CarePlanId, GoalId, InterventionId, TaskId,
        NoteDate, NoteType, NoteContent, RelatedData,
        CreatedBy, CreatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId,
      carePlanId,
      data.GoalId ?? null,
      data.InterventionId ?? null,
      data.TaskId ?? null,
      data.NoteDate,
      data.NoteType,
      data.NoteContent,
      data.RelatedData ?? null,
      userId,
      now,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

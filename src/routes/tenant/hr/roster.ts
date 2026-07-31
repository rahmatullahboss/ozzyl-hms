import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { parseId, requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  assignRosterSchema,
  bulkAssignRosterSchema,
  rosterQuerySchema,
  swapRosterSchema,
  cancelRosterSchema,
  createRotationSchema,
  assignRotationSchema,
  generateRosterSchema,
  createHolidaySchema,
} from '../../../schemas/hr';
import {
  createD1RosterRepository,
  createD1RotationRepository,
  createD1WorkCalendarRepository,
  createD1WorkforceDirectoryRepository,
  createD1WorkforceIdempotencyRepository,
  createRosterService,
  createRotationService,
  createWorkCalendarService,
  createWorkforceTransaction,
  WorkforceError,
} from '../../../modules/workforce-management';
import { mapHolidayRow } from '../../../modules/workforce-management/transport/mappers';

const rosterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function createRosterApplication(db: D1Database) {
  const directory = createD1WorkforceDirectoryRepository(db);
  return createRosterService({
    workforceMembers: directory,
    shifts: directory,
    rosters: createD1RosterRepository(db),
    idempotency: createD1WorkforceIdempotencyRepository(db),
    transaction: createWorkforceTransaction(db),
    clock: { nowUtc: () => new Date().toISOString() },
    publicIds: { next: (prefix: string) => `${prefix}_${crypto.randomUUID()}` },
  });
}

function createRotationApplication(db: D1Database) {
  const directory = createD1WorkforceDirectoryRepository(db);
  return createRotationService({
    workforceMembers: directory,
    shifts: directory,
    rotations: createD1RotationRepository(db),
    rosters: createD1RosterRepository(db),
    calendar: createWorkCalendarService({
      calendar: createD1WorkCalendarRepository(db),
    }),
    idempotency: createD1WorkforceIdempotencyRepository(db),
    transaction: createWorkforceTransaction(db),
    clock: { nowUtc: () => new Date().toISOString() },
    publicIds: { next: (prefix: string) => `${prefix}_${crypto.randomUUID()}` },
  });
}

function rethrowWorkforceError(error: unknown): never {
  if (error instanceof WorkforceError) {
    throw new HTTPException(error.httpStatus, { message: error.message });
  }
  throw error;
}

// ─── Duty Roster ──────────────────────────────────────────────────────────────

// GET /api/hr/roster
rosterRoutes.get('/', zValidator('query', rosterQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');

  try {
    const data = await createRosterApplication(c.env.DB).list({
      tenantId,
      from: query.from,
      to: query.to,
      staffId: query.staffId,
      shiftId: query.shiftId,
      department: query.department,
    });
    return c.json({ data });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// POST /api/hr/roster
rosterRoutes.post('/', zValidator('json', assignRosterSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const assignment = await createRosterApplication(c.env.DB).assign({
      tenantId,
      actorUserId,
      staffId: data.staffId,
      shiftId: data.shiftId,
      rosterDate: data.rosterDate,
      remarks: data.remarks,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: assignment }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// POST /api/hr/roster/bulk
rosterRoutes.post('/bulk', zValidator('json', bulkAssignRosterSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const result = await createRotationApplication(c.env.DB).bulkAssign({
      tenantId,
      actorUserId,
      assignments: data.assignments,
      startDate: data.startDate,
      endDate: data.endDate,
      dateMode: data.dateMode,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: result }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// PUT /api/hr/roster/:id/swap
rosterRoutes.put('/:id/swap', zValidator('json', swapRosterSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const rosterId = parseId(c.req.param('id'), 'roster ID');
  const data = c.req.valid('json');

  try {
    const result = await createRosterApplication(c.env.DB).swap({
      tenantId,
      actorUserId,
      rosterId,
      swapWithStaffId: data.swapWithStaffId,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: result });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// DELETE /api/hr/roster/:id
rosterRoutes.delete('/:id', zValidator('json', cancelRosterSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const rosterId = parseId(c.req.param('id'), 'roster ID');
  const data = c.req.valid('json');

  try {
    const assignment = await createRosterApplication(c.env.DB).cancel({
      tenantId,
      actorUserId,
      rosterId,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: assignment });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// ─── Rotation Patterns ───────────────────────────────────────────────────────

// POST /api/hr/roster/rotation
rosterRoutes.post('/rotation', zValidator('json', createRotationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const result = await createRotationApplication(c.env.DB).createPattern({
      tenantId,
      actorUserId,
      patternName: data.patternName,
      cycleDays: data.cycleDays,
      days: data.days,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: result }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// GET /api/hr/roster/rotations
rosterRoutes.get('/rotations', async (c) => {
  const tenantId = requireTenantId(c);

  try {
    const data = await createRotationApplication(c.env.DB).listPatterns(tenantId);
    return c.json({ data });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// POST /api/hr/roster/rotation/assign
rosterRoutes.post('/rotation/assign', zValidator('json', assignRotationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const result = await createRotationApplication(c.env.DB).assignPattern({
      tenantId,
      actorUserId,
      staffId: data.staffId,
      patternId: data.patternId,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      cycleOffset: data.cycleOffset,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: result }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// POST /api/hr/roster/generate
rosterRoutes.post('/generate', zValidator('json', generateRosterSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const result = await createRotationApplication(c.env.DB).generate({
      tenantId,
      actorUserId,
      startDate: data.startDate,
      endDate: data.endDate,
      replaceExisting: data.replaceExisting,
      idempotencyKey: data.idempotencyKey,
    });
    return c.json({ data: result }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// ─── Holidays ─────────────────────────────────────────────────────────────────

// POST /api/hr/roster/holidays
rosterRoutes.post('/holidays', zValidator('json', createHolidaySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_holidays (tenant_id, holiday_name, holiday_date, holiday_type)
    VALUES (?, ?, ?, ?)
  `).bind(tenantId, data.holidayName, data.holidayDate, data.holidayType).run();

  return c.json({ message: 'Holiday created', id: result.meta.last_row_id }, 201);
});

// GET /api/hr/roster/holidays
rosterRoutes.get('/holidays', async (c) => {
  const tenantId = requireTenantId(c);
  const year = c.req.query('year');

  let sql = 'SELECT * FROM hr_holidays WHERE tenant_id = ?';
  const params: (string | number)[] = [Number(tenantId)];

  if (year) {
    sql += ' AND holiday_date LIKE ?';
    params.push(`${year}%`);
  }

  sql += ' ORDER BY holiday_date ASC';

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();

  return c.json({ data: (results ?? []).map(mapHolidayRow) });
});

// DELETE /api/hr/roster/holidays/:id
rosterRoutes.delete('/holidays/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await c.env.DB.prepare(
    'DELETE FROM hr_holidays WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Holiday not found' });

  return c.json({ message: 'Holiday deleted' });
});

export default rosterRoutes;

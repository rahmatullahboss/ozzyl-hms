import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createShiftSchema,
  updateShiftSchema,
  checkInSchema,
  checkOutSchema,
  attendanceReportQuerySchema,
  createWeekendPolicySchema,
  updateWeekendPolicySchema,
  markAbsentSchema,
} from '../../../schemas/hr';
import {
  createD1AttendanceApplication,
  createD1WorkCalendarRepository,
  createWorkCalendarService,
  WorkforceError,
} from '../../../modules/workforce-management';

const attendanceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const ATTENDANCE_TIMEZONE_OFFSET_MINUTES = 360;

function createAttendanceApplication(db: D1Database) {
  return createD1AttendanceApplication({
    db,
    timezoneOffsetMinutes: ATTENDANCE_TIMEZONE_OFFSET_MINUTES,
  });
}

function rethrowWorkforceError(error: unknown): never {
  if (error instanceof WorkforceError) {
    throw new HTTPException(error.httpStatus, { message: error.message });
  }
  throw error;
}

// ─── Shift Management ──────────────────────────────────────────────────────────

// GET /api/hr/attendance/shifts
attendanceRoutes.get('/shifts', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM hr_shifts WHERE tenant_id = ? AND is_active = 1 ORDER BY shift_name'
  ).bind(tenantId).all();

  return c.json({ data: results });
});

// POST /api/hr/attendance/shifts
attendanceRoutes.post('/shifts', zValidator('json', createShiftSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_shifts (tenant_id, shift_name, start_time, end_time, grace_period)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.shiftName, data.startTime, data.endTime, data.gracePeriod).run();

  return c.json({ message: 'Shift created', id: result.meta.last_row_id }, 201);
});

// PUT /api/hr/attendance/shifts/:id
attendanceRoutes.put('/shifts/:id', zValidator('json', updateShiftSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM hr_shifts WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Shift not found' });

  await c.env.DB.prepare(`
    UPDATE hr_shifts
    SET shift_name = ?, start_time = ?, end_time = ?, grace_period = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.shiftName ?? existing.shift_name,
    data.startTime ?? existing.start_time,
    data.endTime ?? existing.end_time,
    data.gracePeriod ?? existing.grace_period,
    id,
    tenantId,
  ).run();

  return c.json({ message: 'Shift updated' });
});

// DELETE /api/hr/attendance/shifts/:id (soft delete)
attendanceRoutes.delete('/shifts/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await c.env.DB.prepare(
    'UPDATE hr_shifts SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Shift not found' });

  return c.json({ message: 'Shift deactivated' });
});

// ─── Check-in / Check-out ──────────────────────────────────────────────────────

// POST /api/hr/attendance/check-in
attendanceRoutes.post('/check-in', zValidator('json', checkInSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');
  const occurredAtUtc = data.occurredAtUtc ?? new Date().toISOString();
  const sourceEventKey = data.sourceEventKey ?? `web:check-in:${data.staffId}:${crypto.randomUUID()}`;

  try {
    const result = await createAttendanceApplication(c.env.DB).punches.recordPunch({
      tenantId,
      actorUserId,
      staffId: data.staffId,
      occurredAtUtc,
      punchType: 'in',
      source: 'web',
      sourceEventKey,
      shiftIdOverride: data.shiftId,
    });
    return c.json({
      message: 'Checked in successfully',
      status: result.status,
      data: result,
    });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// POST /api/hr/attendance/check-out
attendanceRoutes.post('/check-out', zValidator('json', checkOutSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');
  const occurredAtUtc = data.occurredAtUtc ?? new Date().toISOString();
  const sourceEventKey = data.sourceEventKey ?? `web:check-out:${data.staffId}:${crypto.randomUUID()}`;
  const application = createAttendanceApplication(c.env.DB);

  try {
    const context = await application.query.resolveBusinessContext({
      tenantId,
      staffId: data.staffId,
      occurredAtUtc,
    });
    const existingDay = await application.attendance.findDay(
      tenantId,
      data.staffId,
      context.businessDate,
    );
    const result = await application.punches.recordPunch({
      tenantId,
      actorUserId,
      staffId: data.staffId,
      occurredAtUtc,
      punchType: 'out',
      source: 'web',
      sourceEventKey,
      shiftIdOverride: existingDay?.shiftId ?? undefined,
    });
    return c.json({ message: 'Checked out successfully', data: result });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// ─── Attendance Report ─────────────────────────────────────────────────────────

// GET /api/hr/attendance/report?from=&to=&staffId=&page=&limit=
attendanceRoutes.get('/report', zValidator('query', attendanceReportQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');

  const conditions: string[] = ['a.tenant_id = ?'];
  const params: (string | number)[] = [Number(tenantId)];

  if (query.from) {
    conditions.push('COALESCE(a.business_date, a.date) >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('COALESCE(a.business_date, a.date) <= ?');
    params.push(query.to);
  }
  if (query.staffId) {
    conditions.push('a.staff_id = ?');
    params.push(query.staffId);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (query.page - 1) * query.limit;

  const { results } = await c.env.DB.prepare(`
    SELECT
      a.id, a.staff_id, s.name as staff_name, s.position,
      COALESCE(a.business_date, a.date) AS date,
      a.check_in, a.check_out,
      COALESCE(a.projection_status, a.status) AS status,
      a.worked_minutes, a.projection_version,
      sh.shift_name, a.remarks
    FROM hr_attendance a
    JOIN staff s ON a.staff_id = s.id
    LEFT JOIN hr_shifts sh ON a.shift_id = sh.id
    WHERE ${whereClause}
    ORDER BY COALESCE(a.business_date, a.date) DESC, s.name ASC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();

  const countRow = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM hr_attendance a
    WHERE ${whereClause}
  `).bind(...params).first<{ total: number }>();

  return c.json({
    data: results,
    pagination: {
      page: query.page,
      limit: query.limit,
      total: countRow?.total ?? 0,
    },
  });
});

// GET /api/hr/attendance/summary?month=YYYY-MM — Monthly summary per staff
attendanceRoutes.get('/summary', async (c) => {
  const tenantId = requireTenantId(c);
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

  const { results } = await c.env.DB.prepare(`
    SELECT
      s.id as staff_id, s.name as staff_name, s.position,
      COUNT(CASE WHEN COALESCE(a.projection_status, a.status) = 'present' THEN 1 END) as present_days,
      COUNT(CASE WHEN COALESCE(a.projection_status, a.status) = 'late' THEN 1 END) as late_days,
      COUNT(CASE WHEN COALESCE(a.projection_status, a.status) = 'absent' THEN 1 END) as absent_days,
      COUNT(CASE WHEN COALESCE(a.projection_status, a.status) = 'leave' THEN 1 END) as leave_days,
      COUNT(CASE WHEN COALESCE(a.projection_status, a.status) = 'half_day' THEN 1 END) as half_days,
      COUNT(CASE WHEN a.projection_status = 'off_day' THEN 1 END) as off_days,
      COUNT(CASE WHEN a.projection_status = 'incomplete' THEN 1 END) as incomplete_days,
      COUNT(a.id) as total_records
    FROM staff s
    LEFT JOIN hr_attendance a ON s.id = a.staff_id AND a.tenant_id = ?
      AND COALESCE(a.business_date, a.date) LIKE ?
    WHERE s.tenant_id = ? AND s.status = 'active'
    GROUP BY s.id
    ORDER BY s.name
  `).bind(tenantId, `${month}%`, tenantId).all();

  return c.json({ data: results, month });
});

attendanceRoutes.get('/weekend-policies', async (c) => {
  const tenantId = requireTenantId(c);
  const year = c.req.query('year');
  let query = 'SELECT * FROM hr_weekend_policies WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (year) { query += ' AND year = ?'; params.push(Number(year)); }
  query += ' ORDER BY year DESC, day_of_week';
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

attendanceRoutes.post('/weekend-policies', zValidator('json', createWeekendPolicySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const result = await c.env.DB.prepare(`INSERT INTO hr_weekend_policies (tenant_id, year, day_of_week, week_pattern) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, year, day_of_week) DO UPDATE SET week_pattern = excluded.week_pattern, is_active = 1, updated_at = datetime('now', '+6 hours')`).bind(tenantId, data.year, data.dayOfWeek, data.weekPattern).run();
  return c.json({ message: 'Weekend policy saved', id: result.meta.last_row_id }, 201);
});

attendanceRoutes.put('/weekend-policies/:id', zValidator('json', updateWeekendPolicySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const existing = await c.env.DB.prepare('SELECT * FROM hr_weekend_policies WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Weekend policy not found' });
  await c.env.DB.prepare(`UPDATE hr_weekend_policies SET week_pattern = ?, is_active = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`).bind(data.weekPattern ?? existing.week_pattern, data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active, id, tenantId).run();
  return c.json({ message: 'Weekend policy updated' });
});

attendanceRoutes.delete('/weekend-policies/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const result = await c.env.DB.prepare('UPDATE hr_weekend_policies SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Weekend policy not found' });
  return c.json({ message: 'Weekend policy deactivated' });
});

attendanceRoutes.get('/weekend-check', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date');
  if (!date) throw new HTTPException(400, { message: 'date query param required' });

  try {
    const day = await createWorkCalendarService({
      calendar: createD1WorkCalendarRepository(c.env.DB),
    }).evaluateDay(tenantId, date);
    const dayOfMonth = Number(date.slice(8, 10));
    return c.json({
      date,
      dayOfWeek: day.dayOfWeek,
      weekOfMonth: Math.floor((dayOfMonth - 1) / 7) + 1,
      isWeekend: day.isConfiguredWeekend,
      holiday: day.holiday,
      isWorkingDay: day.isWorkingDay,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
});

attendanceRoutes.post('/mark-absent', zValidator('json', markAbsentSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');
  const sourceEventKey = data.sourceEventKey
    ?? `auto-absence:${data.date}:${data.department ?? 'all'}:${crypto.randomUUID()}`;

  try {
    const result = await createAttendanceApplication(c.env.DB).punches.markExpectedAbsences({
      tenantId,
      actorUserId,
      businessDate: data.date,
      department: data.department,
      sourceEventKey,
    });
    return c.json({
      message: result.count === 0
        ? 'No expected workers to mark absent'
        : `Marked ${result.count} expected workers as absent`,
      count: result.count,
    });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

export default attendanceRoutes;

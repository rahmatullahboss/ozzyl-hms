import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  registerDeviceSchema,
  enrollBiometricSchema,
  cardPunchSchema,
  manualPunchSchema,
  punchQuerySchema,
  createOvertimeRuleSchema,
  approveOvertimeSchema,
} from '../../../schemas/hr';
import { mapOvertimeRuleRow } from '../../../modules/workforce-management/transport/mappers';
import {
  createD1AttendanceApplication,
  createD1OvertimeRepository,
  createD1WorkCalendarRepository,
  createOvertimeService,
  createWorkCalendarService,
  hashWorkforceRequest,
  WorkforceError,
} from '../../../modules/workforce-management';

const biometricRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const ATTENDANCE_TIMEZONE_OFFSET_MINUTES = 360;

function createAttendanceApplication(db: D1Database) {
  return createD1AttendanceApplication({
    db,
    timezoneOffsetMinutes: ATTENDANCE_TIMEZONE_OFFSET_MINUTES,
  });
}

function createOvertimeApplication(db: D1Database) {
  return createOvertimeService({
    overtime: createD1OvertimeRepository(db),
    calendar: createWorkCalendarService({
      calendar: createD1WorkCalendarRepository(db),
    }),
    clock: { nowUtc: () => new Date().toISOString() },
  });
}

function rethrowWorkforceError(error: unknown): never {
  if (error instanceof WorkforceError) {
    throw new HTTPException(error.httpStatus, { message: error.message });
  }
  throw error;
}

// ─── Device Management ────────────────────────────────────────────────────────

// POST /api/hr/biometric/devices
biometricRoutes.post('/devices', zValidator('json', registerDeviceSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  // Generate API key and hash it for storage
  const rawApiKey = crypto.randomUUID();
  const keyBuffer = new TextEncoder().encode(rawApiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_biometric_devices (tenant_id, device_name, device_type, device_serial, ip_address, location, api_key_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.deviceName,
    data.deviceType,
    data.deviceSerial ?? null,
    data.ipAddress ?? null,
    data.location ?? null,
    apiKeyHash,
  ).run();

  return c.json({
    message: 'Device registered',
    id: result.meta.last_row_id,
    apiKey: rawApiKey, // Return raw key once — it cannot be retrieved again
  }, 201);
});

// GET /api/hr/biometric/devices
biometricRoutes.get('/devices', async (c) => {
  const tenantId = requireTenantId(c);

  const { results } = await c.env.DB.prepare(
    'SELECT id, device_name, device_type, device_serial, ip_address, location, is_active, created_at FROM hr_biometric_devices WHERE tenant_id = ? ORDER BY device_name'
  ).bind(tenantId).all();

  return c.json({ data: results });
});

// PUT /api/hr/biometric/devices/:id
biometricRoutes.put('/devices/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ deviceName?: string; location?: string; isActive?: boolean }>();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM hr_biometric_devices WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ device_name: string; location: string; is_active: number }>();
  if (!existing) throw new HTTPException(404, { message: 'Device not found' });

  await c.env.DB.prepare(`
    UPDATE hr_biometric_devices
    SET device_name = ?, location = ?, is_active = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    body.deviceName ?? existing.device_name,
    body.location ?? existing.location,
    body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
    id,
    tenantId,
  ).run();

  return c.json({ message: 'Device updated' });
});

// DELETE /api/hr/biometric/devices/:id (soft delete)
biometricRoutes.delete('/devices/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await c.env.DB.prepare(
    'UPDATE hr_biometric_devices SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Device not found' });

  return c.json({ message: 'Device deactivated' });
});

// ─── Biometric Enrollment ─────────────────────────────────────────────────────

// POST /api/hr/biometric/enroll
biometricRoutes.post('/enroll', zValidator('json', enrollBiometricSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_biometric_enrollments (tenant_id, staff_id, device_id, enrollment_type, enrollment_code)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.staffId, data.deviceId ?? null, data.enrollmentType, data.enrollmentCode).run();

  return c.json({ message: 'Biometric enrolled', id: result.meta.last_row_id }, 201);
});

// GET /api/hr/biometric/enrollments/:staffId
biometricRoutes.get('/enrollments/:staffId', async (c) => {
  const tenantId = requireTenantId(c);
  const staffId = Number(c.req.param('staffId'));

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM hr_biometric_enrollments WHERE tenant_id = ? AND staff_id = ? ORDER BY created_at DESC'
  ).bind(tenantId, staffId).all();

  return c.json({ data: results });
});

// DELETE /api/hr/biometric/enroll/:id
biometricRoutes.delete('/enroll/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await c.env.DB.prepare(
    'DELETE FROM hr_biometric_enrollments WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Enrollment not found' });

  return c.json({ message: 'Enrollment removed' });
});

// ─── Card Punch ───────────────────────────────────────────────────────────────

// POST /api/hr/biometric/punch
biometricRoutes.post('/punch', zValidator('json', cardPunchSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const enrollment = await c.env.DB.prepare(`
    SELECT staff_id, device_id
    FROM hr_biometric_enrollments
    WHERE CAST(tenant_id AS TEXT) = ?
      AND enrollment_code = ?
      AND is_active = 1
    LIMIT 1
  `).bind(tenantId, data.enrollmentCode).first<{ staff_id: number; device_id: number | null }>();
  if (!enrollment) throw new HTTPException(404, { message: 'Enrollment code not recognized' });

  const staffId = enrollment.staff_id;
  const punchTime = data.punchTime ?? new Date().toISOString();
  const application = createAttendanceApplication(c.env.DB);
  const context = await application.query.resolveBusinessContext({
    tenantId,
    staffId,
    occurredAtUtc: punchTime,
  });

  let punchType = data.punchType;
  if (punchType === 'in') {
    const lastPunch = await c.env.DB.prepare(`
      SELECT punch_type
      FROM hr_attendance_punches
      WHERE CAST(tenant_id AS TEXT) = ?
        AND staff_id = ?
        AND business_date = ?
        AND is_valid = 1
      ORDER BY punch_time DESC, id DESC
      LIMIT 1
    `).bind(tenantId, staffId, context.businessDate).first<{ punch_type: string }>();
    if (lastPunch?.punch_type === 'in') punchType = 'out';
  }

  const sourceEventKey = data.sourceEventKey
    ?? `device:${await hashWorkforceRequest({
      enrollmentCode: data.enrollmentCode,
      deviceSerial: data.deviceSerial ?? null,
      punchTime,
      punchType,
      rawData: data.rawData ?? null,
    })}`;

  try {
    const result = await application.punches.recordPunch({
      tenantId,
      actorUserId: null,
      staffId,
      occurredAtUtc: punchTime,
      punchType,
      source: 'device',
      sourceEventKey,
      deviceId: enrollment.device_id,
      deviceSerial: data.deviceSerial ?? null,
      rawData: data.rawData ?? null,
    });
    return c.json({ message: 'Punch recorded', staffId, punchType, data: result });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// POST /api/hr/biometric/punch/manual
biometricRoutes.post('/punch/manual', zValidator('json', manualPunchSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const data = c.req.valid('json');
  const sourceEventKey = data.sourceEventKey ?? `manual:${crypto.randomUUID()}`;
  const reason = data.reason ?? data.remarks ?? '';

  const application = createAttendanceApplication(c.env.DB);

  try {
    const context = await application.query.resolveBusinessContext({
      tenantId,
      staffId: data.staffId,
      occurredAtUtc: data.punchTime,
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
      occurredAtUtc: data.punchTime,
      punchType: data.punchType,
      source: 'manual',
      sourceEventKey,
      reason,
      shiftIdOverride: existingDay?.shiftId ?? undefined,
    });
    return c.json({ message: 'Manual punch recorded', data: result }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// GET /api/hr/biometric/punches
biometricRoutes.get('/punches', zValidator('query', punchQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');

  const conditions: string[] = ['CAST(p.tenant_id AS TEXT) = ?'];
  const params: (string | number)[] = [tenantId];

  if (query.date) {
    conditions.push('p.business_date = ?');
    params.push(query.date);
  }
  if (query.from) {
    conditions.push('p.business_date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('p.business_date <= ?');
    params.push(query.to);
  }
  if (query.staffId) {
    conditions.push('p.staff_id = ?');
    params.push(query.staffId);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (query.page - 1) * query.limit;

  const { results } = await c.env.DB.prepare(`
    SELECT
      p.id, p.staff_id, s.name AS staff_name,
      p.punch_time, p.business_date, p.punch_type, p.source,
      p.source_event_key, p.device_serial, p.remarks
    FROM hr_attendance_punches p
    JOIN staff s ON p.staff_id = s.id
    WHERE ${whereClause}
    ORDER BY p.punch_time DESC
    LIMIT ? OFFSET ?
  `).bind(...params, query.limit, offset).all();

  const countRow = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM hr_attendance_punches p
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

// GET /api/hr/biometric/punches/live
biometricRoutes.get('/punches/live', async (c) => {
  const tenantId = requireTenantId(c);
  const today = new Date(Date.now() + ATTENDANCE_TIMEZONE_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);

  const { results } = await c.env.DB.prepare(`
    SELECT
      s.id AS staff_id, s.name AS staff_name, s.position, s.department,
      latest.punch_type AS current_status,
      latest.punch_time AS last_punch_time,
      a.check_in, a.check_out,
      COALESCE(a.projection_status, a.status) AS projection_status
    FROM staff s
    LEFT JOIN hr_attendance a
      ON s.id = a.staff_id
     AND CAST(a.tenant_id AS TEXT) = CAST(s.tenant_id AS TEXT)
     AND COALESCE(a.business_date, a.date) = ?
    LEFT JOIN (
      SELECT p1.staff_id, p1.punch_type, p1.punch_time
      FROM hr_attendance_punches p1
      INNER JOIN (
        SELECT staff_id, MAX(punch_time) AS max_time
        FROM hr_attendance_punches
        WHERE CAST(tenant_id AS TEXT) = ?
          AND business_date = ?
          AND is_valid = 1
        GROUP BY staff_id
      ) p2 ON p1.staff_id = p2.staff_id AND p1.punch_time = p2.max_time
      WHERE CAST(p1.tenant_id AS TEXT) = ? AND p1.is_valid = 1
    ) latest ON s.id = latest.staff_id
    WHERE CAST(s.tenant_id AS TEXT) = ? AND s.status = 'active'
    ORDER BY s.name
  `).bind(today, tenantId, today, tenantId, tenantId).all();

  const staff = results.map((row) => {
    const projectionStatus = String(row.projection_status ?? '');
    const currentStatus = String(row.current_status ?? '');
    const status = projectionStatus === 'leave'
      ? 'leave'
      : projectionStatus === 'off_day'
        ? 'off_day'
        : projectionStatus === 'absent'
          ? 'absent'
          : projectionStatus === 'late'
            ? 'late'
            : projectionStatus === 'incomplete'
              ? 'incomplete'
              : currentStatus === 'break_start'
                ? 'break'
                : currentStatus === 'break_end' || currentStatus === 'in'
                  ? 'in'
                  : currentStatus === 'out'
                    ? 'out'
                    : 'off_day';

    return {
      id: Number(row.staff_id),
      name: String(row.staff_name ?? ''),
      position: String(row.position ?? ''),
      department: String(row.department ?? ''),
      status,
      last_punch_time: row.last_punch_time ?? null,
      avatar_url: null,
    };
  });

  const summary = {
    total: staff.length,
    present: staff.filter((member) =>
      member.status === 'in' || member.status === 'break' || member.status === 'incomplete',
    ).length,
    absent: staff.filter((member) => member.status === 'absent').length,
    late: staff.filter((member) => member.status === 'late').length,
    on_leave: staff.filter((member) => member.status === 'leave').length,
  };

  return c.json({ staff, summary, date: today });
});

// ─── Overtime ─────────────────────────────────────────────────────────────────

// POST /api/hr/biometric/overtime/rules
biometricRoutes.post('/overtime/rules', zValidator('json', createOvertimeRuleSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_overtime_rules (tenant_id, rule_name, multiplier, min_hours_before_ot, max_ot_hours_per_day, applies_on)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.ruleName,
    data.multiplier,
    data.minHoursBeforeOt,
    data.maxOtHoursPerDay,
    data.appliesOn,
  ).run();

  return c.json({ message: 'Overtime rule created', id: result.meta.last_row_id }, 201);
});

// GET /api/hr/biometric/overtime/rules
biometricRoutes.get('/overtime/rules', async (c) => {
  const tenantId = requireTenantId(c);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM hr_overtime_rules WHERE tenant_id = ? ORDER BY rule_name'
  ).bind(tenantId).all<Record<string, unknown>>();

  return c.json({ data: (results ?? []).map(mapOvertimeRuleRow) });
});

// GET /api/hr/biometric/overtime/log
biometricRoutes.get('/overtime/log', async (c) => {
  const tenantId = requireTenantId(c);
  const month = c.req.query('month');
  const staffId = c.req.query('staffId');

  const conditions: string[] = ['CAST(o.tenant_id AS TEXT) = ?'];
  const params: (string | number)[] = [tenantId];

  if (month) {
    conditions.push('o.date LIKE ?');
    params.push(`${month}%`);
  }
  if (staffId) {
    conditions.push('o.staff_id = ?');
    params.push(Number(staffId));
  }

  const whereClause = conditions.join(' AND ');

  const { results } = await c.env.DB.prepare(`
    SELECT
      o.id, o.staff_id, s.name AS staff_name,
      o.date, o.overtime_hours, o.multiplier, o.status,
      o.approved_by
    FROM hr_overtime_log o
    JOIN staff s ON o.staff_id = s.id
    WHERE ${whereClause}
    ORDER BY o.date DESC
  `).bind(...params).all();

  return c.json({ data: results });
});

// PUT /api/hr/biometric/overtime/:id/approve
biometricRoutes.put('/overtime/:id/approve', zValidator('json', approveOvertimeSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const overtimeLogId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  if (!Number.isInteger(overtimeLogId) || overtimeLogId <= 0) {
    throw new HTTPException(404, { message: 'Overtime entry not found' });
  }

  try {
    const result = await createOvertimeApplication(c.env.DB).review({
      tenantId,
      actorUserId,
      overtimeLogId,
      status: data.status,
    });
    return c.json({ message: `Overtime ${data.status}`, data: result });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

export default biometricRoutes;

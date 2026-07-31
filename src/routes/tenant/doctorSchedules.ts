import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createDoctorScheduleSchema, updateDoctorScheduleSchema } from '../../schemas/clinical';
import { getDb } from '../../db';
import { getTodayGMT6 } from '../../lib/date-utils';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import {
  buildAppointmentScheduleRouteContext,
  createAppointmentScheduleSourceKey,
  recordAppointmentScheduleExtension,
  type AppointmentScheduleSnapshot,
} from '../../lib/canonical/appointment-schedule-route-integration';
import { createSourceEvidenceSha256 } from '../../lib/canonical/source-mapping';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const ALLOWED_ROLES = ['hospital_admin', 'md', 'reception'];

interface DoctorScheduleRow {
  id: number;
  tenant_id: string;
  doctor_id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  session_type: string;
  chamber: string | null;
  max_patients: number;
  notes: string | null;
  is_active: number;
  canonical_source_key: string | null;
}

function requireScheduleRole(role: string | undefined): void {
  if (!role || !ALLOWED_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to modify schedules' });
  }
}

function scheduleSnapshot(input: {
  doctorId: number;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  sessionType: string;
  chamber?: string | null;
  maxPatients: number;
  notes?: string | null;
  isActive: boolean;
}): AppointmentScheduleSnapshot {
  return {
    doctorId: input.doctorId,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    sessionType: input.sessionType,
    chamber: input.chamber ?? null,
    maxPatients: input.maxPatients,
    notes: input.notes ?? null,
    isActive: input.isActive,
  };
}

function suppliedIdempotencyKey(request: { header(name: string): string | undefined }): string | null {
  return request.header('Idempotency-Key')?.trim() || null;
}

// GET /api/doctor-schedules/doctors — doctors with schedule_count
app.get('/doctors', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT d.id, d.name, d.specialty, d.bmdc_reg_no, d.qualifications, d.visiting_hours,
           (SELECT COUNT(*) FROM doctor_schedules ds WHERE ds.doctor_id = d.id AND ds.tenant_id = d.tenant_id AND ds.is_active = 1) AS schedule_count
    FROM doctors d
    WHERE d.tenant_id = ?
    ORDER BY d.name
  `).bind(tenantId).all();

  return c.json({ doctors: results });
});

// GET /api/doctor-schedules?doctor_id= (doctor_id is optional — lists all if omitted)
app.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.query('doctor_id');

  let results;
  if (doctorId) {
    const r = await db.$client.prepare(`
      SELECT ds.*, d.name AS doctor_name, d.specialty
      FROM doctor_schedules ds
      LEFT JOIN doctors d ON d.id = ds.doctor_id AND d.tenant_id = ds.tenant_id
      WHERE ds.tenant_id = ? AND ds.doctor_id = ? AND ds.is_active = 1
      ORDER BY CASE ds.day_of_week
        WHEN 'sun' THEN 0 WHEN 'mon' THEN 1 WHEN 'tue' THEN 2
        WHEN 'wed' THEN 3 WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6
      END, ds.start_time
    `).bind(tenantId, Number(doctorId)).all();
    results = r.results;
  } else {
    const r = await db.$client.prepare(`
      SELECT ds.*, d.name AS doctor_name, d.specialty
      FROM doctor_schedules ds
      LEFT JOIN doctors d ON d.id = ds.doctor_id AND d.tenant_id = ds.tenant_id
      WHERE ds.tenant_id = ? AND ds.is_active = 1
      ORDER BY d.name, CASE ds.day_of_week
        WHEN 'sun' THEN 0 WHEN 'mon' THEN 1 WHEN 'tue' THEN 2
        WHEN 'wed' THEN 3 WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6
      END, ds.start_time
    `).bind(tenantId).all();
    results = r.results;
  }

  return c.json({ schedules: results, total: results.length });
});

// POST /api/doctor-schedules
app.post('/', zValidator('json', createDoctorScheduleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireScheduleRole(c.get('role'));
  const body = c.req.valid('json');
  const snapshot = scheduleSnapshot({
    doctorId: body.doctor_id,
    dayOfWeek: body.day_of_week,
    startTime: body.start_time,
    endTime: body.end_time,
    sessionType: body.session_type ?? 'morning',
    chamber: body.chamber ?? null,
    maxPatients: body.max_patients ?? 20,
    notes: body.notes ?? null,
    isActive: true,
  });
  const requestEvidence = await createSourceEvidenceSha256({
    boundary: 'doctor_schedule_create',
    snapshot,
  });
  const suppliedKey = suppliedIdempotencyKey(c.req);
  const sourcePublicId = await createAppointmentScheduleSourceKey(
    tenantId,
    suppliedKey ?? requestEvidence,
  );
  const context = await buildAppointmentScheduleRouteContext(c.env.DB, {
    tenantId,
    sourcePublicId,
    doctorId: snapshot.doctorId,
  });
  const now = new Date().toISOString();
  await recordAppointmentScheduleExtension(c.env.DB, {
    context,
    operation: 'create',
    snapshot,
    authoritativeStatements: [
      db.$client.prepare(`
        INSERT INTO doctor_schedules (
          tenant_id,doctor_id,day_of_week,start_time,end_time,session_type,
          chamber,max_patients,notes,canonical_source_key
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).bind(
        tenantId,
        snapshot.doctorId,
        snapshot.dayOfWeek,
        snapshot.startTime,
        snapshot.endTime,
        snapshot.sessionType,
        snapshot.chamber,
        snapshot.maxPatients,
        snapshot.notes,
        sourcePublicId,
      ),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'CREATE',
        tableName: 'doctor_schedules',
        recordId: sourcePublicId,
        newValue: { ...snapshot, canonicalSourceKey: sourcePublicId },
        ...auditRequestMetadata(c),
      }),
    ],
    actorUserPublicId: String(userId),
    actorSystemKey: 'canonical.appointment.schedule-route',
    idempotencyKey: suppliedKey
      ? `route:doctor-schedule-create:${suppliedKey}`
      : `route:doctor-schedule-create:${requestEvidence}`,
    occurredAtUtc: now,
    businessDate: getTodayGMT6(),
  });

  return c.json({ success: true }, 201);
});

// PUT /api/doctor-schedules/:id
app.put('/:id', zValidator('json', updateDoctorScheduleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireScheduleRole(c.get('role'));
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid schedule id' });
  const body = c.req.valid('json');
  const existing = await db.$client.prepare(`
    SELECT id,tenant_id,doctor_id,day_of_week,start_time,end_time,session_type,
           chamber,max_patients,notes,is_active,canonical_source_key
    FROM doctor_schedules
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(id, tenantId).first<DoctorScheduleRow>();
  if (!existing) throw new HTTPException(404, { message: 'Schedule not found' });
  if (Number(existing.is_active) !== 1) {
    throw new HTTPException(409, { message: 'Retired schedule cannot be updated' });
  }
  const sourcePublicId = existing.canonical_source_key?.trim()
    || await createAppointmentScheduleSourceKey(tenantId, `legacy:${id}`);
  const snapshot = scheduleSnapshot({
    doctorId: Number(existing.doctor_id),
    dayOfWeek: body.day_of_week ?? existing.day_of_week,
    startTime: body.start_time ?? existing.start_time,
    endTime: body.end_time ?? existing.end_time,
    sessionType: body.session_type ?? existing.session_type,
    chamber: body.chamber ?? existing.chamber,
    maxPatients: body.max_patients ?? Number(existing.max_patients),
    notes: body.notes ?? existing.notes,
    isActive: true,
  });
  const context = await buildAppointmentScheduleRouteContext(c.env.DB, {
    tenantId,
    sourcePublicId,
    doctorId: snapshot.doctorId,
  });
  const requestEvidence = await createSourceEvidenceSha256({
    boundary: 'doctor_schedule_update',
    scheduleId: id,
    sourcePublicId,
    snapshot,
  });
  const suppliedKey = suppliedIdempotencyKey(c.req);
  const now = new Date().toISOString();
  await recordAppointmentScheduleExtension(c.env.DB, {
    context,
    operation: 'update',
    snapshot,
    authoritativeStatements: [
      db.$client.prepare(`
        UPDATE doctor_schedules SET
          day_of_week=?,start_time=?,end_time=?,session_type=?,chamber=?,
          max_patients=?,notes=?,canonical_source_key=COALESCE(canonical_source_key,?)
        WHERE id=? AND tenant_id=? AND is_active=1
      `).bind(
        snapshot.dayOfWeek,
        snapshot.startTime,
        snapshot.endTime,
        snapshot.sessionType,
        snapshot.chamber,
        snapshot.maxPatients,
        snapshot.notes,
        sourcePublicId,
        id,
        tenantId,
      ),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'UPDATE',
        tableName: 'doctor_schedules',
        recordId: id,
        oldValue: existing,
        newValue: { ...snapshot, canonicalSourceKey: sourcePublicId },
        ...auditRequestMetadata(c),
      }),
    ],
    actorUserPublicId: String(userId),
    actorSystemKey: 'canonical.appointment.schedule-route',
    idempotencyKey: suppliedKey
      ? `route:doctor-schedule-update:${suppliedKey}`
      : `route:doctor-schedule-update:${requestEvidence}`,
    occurredAtUtc: now,
    businessDate: getTodayGMT6(),
  });

  return c.json({ success: true });
});

// DELETE /api/doctor-schedules/:id
app.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireScheduleRole(c.get('role'));
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid schedule id' });
  const existing = await db.$client.prepare(`
    SELECT id,tenant_id,doctor_id,day_of_week,start_time,end_time,session_type,
           chamber,max_patients,notes,is_active,canonical_source_key
    FROM doctor_schedules
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(id, tenantId).first<DoctorScheduleRow>();
  if (!existing) throw new HTTPException(404, { message: 'Schedule not found' });
  const sourcePublicId = existing.canonical_source_key?.trim()
    || await createAppointmentScheduleSourceKey(tenantId, `legacy:${id}`);
  const snapshot = scheduleSnapshot({
    doctorId: Number(existing.doctor_id),
    dayOfWeek: existing.day_of_week,
    startTime: existing.start_time,
    endTime: existing.end_time,
    sessionType: existing.session_type,
    chamber: existing.chamber,
    maxPatients: Number(existing.max_patients),
    notes: existing.notes,
    isActive: false,
  });
  const context = await buildAppointmentScheduleRouteContext(c.env.DB, {
    tenantId,
    sourcePublicId,
    doctorId: snapshot.doctorId,
  });
  const requestEvidence = await createSourceEvidenceSha256({
    boundary: 'doctor_schedule_retire',
    scheduleId: id,
    sourcePublicId,
    snapshot,
  });
  const suppliedKey = suppliedIdempotencyKey(c.req);
  const now = new Date().toISOString();
  await recordAppointmentScheduleExtension(c.env.DB, {
    context,
    operation: 'retire',
    snapshot,
    authoritativeStatements: [
      db.$client.prepare(`
        UPDATE doctor_schedules
        SET is_active=0,canonical_source_key=COALESCE(canonical_source_key,?)
        WHERE id=? AND tenant_id=? AND is_active=1
      `).bind(sourcePublicId, id, tenantId),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'DELETE',
        tableName: 'doctor_schedules',
        recordId: id,
        oldValue: existing,
        newValue: { ...snapshot, canonicalSourceKey: sourcePublicId },
        ...auditRequestMetadata(c),
      }),
    ],
    actorUserPublicId: String(userId),
    actorSystemKey: 'canonical.appointment.schedule-route',
    idempotencyKey: suppliedKey
      ? `route:doctor-schedule-retire:${suppliedKey}`
      : `route:doctor-schedule-retire:${requestEvidence}`,
    occurredAtUtc: now,
    businessDate: getTodayGMT6(),
  });

  return c.json({ success: true });
});

export default app;

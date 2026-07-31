import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type GAEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  SessionName: z.string().min(1).max(200),
  SessionType: z.enum(['therapy', 'support', 'education', 'skills', 'process']).default('therapy'),
  Description: z.string().max(2000).optional(),
  FacilitatorId: z.number().int().positive().optional(),
  CoFacilitatorId: z.number().int().positive().optional(),
  DepartmentId: z.number().int().positive().optional(),
  LocationName: z.string().max(200).optional(),
  MaxMembers: z.number().int().positive().default(20),
  RecurrencePattern: z.string().optional(),
  ScheduledDate: z.string(),
  ScheduledTime: z.string().optional(),
  Duration: z.number().int().positive().default(60),
});

const updateSessionSchema = createSessionSchema.partial().extend({
  Status: z.enum(['scheduled', 'in-progress', 'completed', 'cancelled']).optional(),
});

const addMemberSchema = z.object({
  PatientId: z.number().int().positive(),
  Notes: z.string().max(1000).optional(),
});

const markAttendanceSchema = z.object({
  Attendees: z.array(z.object({
    PatientId: z.number().int().positive(),
    Status: z.enum(['present', 'absent', 'late', 'excused', 'cancelled']).default('present'),
    MoodRating: z.number().int().min(1).max(10).optional(),
    ParticipationLevel: z.enum(['active', 'moderate', 'minimal', 'none']).optional(),
    ClinicalNotes: z.string().max(2000).optional(),
  })).min(1),
  AttendanceDate: z.string(),
});

const sessionNoteSchema = z.object({
  AttendanceDate: z.string(),
  NoteType: z.enum(['session', 'group', 'individual']).default('session'),
  SessionTheme: z.string().max(200).optional(),
  TopicsDiscussed: z.string().max(5000).optional(),
  GroupDynamics: z.string().max(2000).optional(),
  ClinicalObservations: z.string().max(5000).optional(),
  PlanForNextSession: z.string().max(2000).optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const groupAttendanceRoutes = new Hono<GAEnv>();

// ═══════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════

groupAttendanceRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, type, fromDate, toDate } = c.req.query();

  let query = 'SELECT * FROM GroupSession WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (status) { query += ' AND Status = ?'; params.push(status); }
  if (type) { query += ' AND SessionType = ?'; params.push(type); }
  if (fromDate) { query += ' AND ScheduledDate >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND ScheduledDate <= ?'; params.push(toDate); }
  query += ' ORDER BY ScheduledDate DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

groupAttendanceRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const session = await db.$client.prepare(
    'SELECT * FROM GroupSession WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!session) throw new HTTPException(404, { message: 'Session not found' });

  const [members, notes] = await Promise.all([
    db.$client.prepare(
      'SELECT * FROM GroupSessionMember WHERE tenant_id = ? AND SessionId = ? ORDER BY EnrollmentDate'
    ).bind(tenantId, id).all(),
    db.$client.prepare(
      'SELECT * FROM GroupSessionNote WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1 ORDER BY AttendanceDate DESC'
    ).bind(tenantId, id).all(),
  ]);

  return c.json({ Results: { ...session, members: members.results, notes: notes.results } });
});

groupAttendanceRoutes.post('/', zValidator('json', createSessionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO GroupSession (
      tenant_id, SessionName, SessionType, Description,
      FacilitatorId, CoFacilitatorId, DepartmentId, LocationName,
      MaxMembers, RecurrencePattern, ScheduledDate, ScheduledTime, Duration,
      CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.SessionName, data.SessionType, data.Description ?? null,
    data.FacilitatorId ?? null, data.CoFacilitatorId ?? null,
    data.DepartmentId ?? null, data.LocationName ?? null,
    data.MaxMembers, data.RecurrencePattern ?? null,
    data.ScheduledDate, data.ScheduledTime ?? null, data.Duration, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

groupAttendanceRoutes.put('/:id', zValidator('json', updateSessionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT SessionId FROM GroupSession WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Session not found' });

  const allowedFields: Record<string, string> = {
    SessionName: 'SessionName', SessionType: 'SessionType', Description: 'Description',
    FacilitatorId: 'FacilitatorId', CoFacilitatorId: 'CoFacilitatorId',
    LocationName: 'LocationName', MaxMembers: 'MaxMembers',
    ScheduledDate: 'ScheduledDate', ScheduledTime: 'ScheduledTime',
    Duration: 'Duration', Status: 'Status',
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, col] of Object.entries(allowedFields)) {
    if ((data as Record<string, unknown>)[key] !== undefined) {
      updates.push(`${col} = ?`);
      params.push((data as Record<string, unknown>)[key] as string | number | null);
    }
  }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  params.push(tenantId, id);
  await db.$client.prepare(
    `UPDATE GroupSession SET ${updates.join(', ')} WHERE tenant_id = ? AND SessionId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Members
// ═══════════════════════════════════════════════════════════════════

groupAttendanceRoutes.post('/:id/members', zValidator('json', addMemberSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const sessionId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const session = await db.$client.prepare(
    'SELECT SessionId, MaxMembers FROM GroupSession WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1'
  ).bind(tenantId, sessionId).first<{ SessionId: number; MaxMembers: number }>();
  if (!session) throw new HTTPException(404, { message: 'Session not found' });

  const memberCount = await db.$client.prepare(
    "SELECT COUNT(*) as count FROM GroupSessionMember WHERE tenant_id = ? AND SessionId = ? AND Status = 'active'"
  ).bind(tenantId, sessionId).first<{ count: number }>();

  if (memberCount && memberCount.count >= session.MaxMembers) {
    throw new HTTPException(400, { message: 'Session is at maximum capacity' });
  }

  const result = await db.$client.prepare(`
    INSERT OR IGNORE INTO GroupSessionMember (tenant_id, SessionId, PatientId, EnrollmentDate, Notes)
    VALUES (?, ?, ?, date('now', '+6 hours'), ?)
  `).bind(tenantId, sessionId, data.PatientId, data.Notes ?? null).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

groupAttendanceRoutes.delete('/:id/members/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const sessionId = Number(c.req.param('id'));
  const patientId = Number(c.req.param('patientId'));

  await db.$client.prepare(
    "UPDATE GroupSessionMember SET Status = 'withdrawn' WHERE tenant_id = ? AND SessionId = ? AND PatientId = ?"
  ).bind(tenantId, sessionId, patientId).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Attendance
// ═══════════════════════════════════════════════════════════════════

groupAttendanceRoutes.get('/:id/attendance', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const sessionId = Number(c.req.param('id'));
  const { date } = c.req.query();

  let query = 'SELECT * FROM GroupSessionAttendance WHERE tenant_id = ? AND SessionId = ?';
  const params: (string | number)[] = [tenantId, sessionId];

  if (date) { query += ' AND AttendanceDate = ?'; params.push(date); }
  query += ' ORDER BY AttendanceDate DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

groupAttendanceRoutes.post('/:id/attendance', zValidator('json', markAttendanceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const session = await db.$client.prepare(
    'SELECT SessionId FROM GroupSession WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1'
  ).bind(tenantId, sessionId).first();
  if (!session) throw new HTTPException(404, { message: 'Session not found' });

  const ids: number[] = [];
  for (const attendee of data.Attendees) {
    const result = await db.$client.prepare(`
      INSERT INTO GroupSessionAttendance (
        tenant_id, SessionId, PatientId, AttendanceDate, Status,
        MoodRating, ParticipationLevel, ClinicalNotes, MarkedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, sessionId, attendee.PatientId, data.AttendanceDate,
      attendee.Status, attendee.MoodRating ?? null,
      attendee.ParticipationLevel ?? null, attendee.ClinicalNotes ?? null, userId,
    ).run();
    ids.push(result.meta.last_row_id as number);
  }

  return c.json({ Results: { count: ids.length, ids } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Session Notes
// ═══════════════════════════════════════════════════════════════════

groupAttendanceRoutes.post('/:id/notes', zValidator('json', sessionNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const session = await db.$client.prepare(
    'SELECT SessionId FROM GroupSession WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1'
  ).bind(tenantId, sessionId).first();
  if (!session) throw new HTTPException(404, { message: 'Session not found' });

  const result = await db.$client.prepare(`
    INSERT INTO GroupSessionNote (
      tenant_id, SessionId, AttendanceDate, NoteType, SessionTheme,
      TopicsDiscussed, GroupDynamics, ClinicalObservations, PlanForNextSession,
      CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, sessionId, data.AttendanceDate, data.NoteType,
    data.SessionTheme ?? null, data.TopicsDiscussed ?? null,
    data.GroupDynamics ?? null, data.ClinicalObservations ?? null,
    data.PlanForNextSession ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

groupAttendanceRoutes.delete('/:id/notes/:noteId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const noteId = Number(c.req.param('noteId'));

  await db.$client.prepare(
    "UPDATE GroupSessionNote SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND NoteId = ?"
  ).bind(userId, tenantId, noteId).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════

groupAttendanceRoutes.get('/:id/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const sessionId = Number(c.req.param('id'));

  const session = await db.$client.prepare(
    'SELECT * FROM GroupSession WHERE tenant_id = ? AND SessionId = ? AND IsActive = 1'
  ).bind(tenantId, sessionId).first();
  if (!session) throw new HTTPException(404, { message: 'Session not found' });

  const memberCount = await db.$client.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END) as active FROM GroupSessionMember WHERE tenant_id = ? AND SessionId = ?"
  ).bind(tenantId, sessionId).first<{ total: number; active: number }>();

  const attendanceStats = await db.$client.prepare(`
    SELECT Status, COUNT(*) as count FROM GroupSessionAttendance
    WHERE tenant_id = ? AND SessionId = ? GROUP BY Status
  `).bind(tenantId, sessionId).all<{ Status: string; count: number }>();

  const statsMap: Record<string, number> = {};
  attendanceStats.results?.forEach(row => { statsMap[row.Status] = row.count; });

  return c.json({
    Results: {
      session,
      members: { total: memberCount?.total || 0, active: memberCount?.active || 0 },
      attendance: {
        present: statsMap['present'] || 0,
        absent: statsMap['absent'] || 0,
        late: statsMap['late'] || 0,
        excused: statsMap['excused'] || 0,
      },
    },
  });
});

export default groupAttendanceRoutes;

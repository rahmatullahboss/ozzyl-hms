import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import type { CanonicalPreparedStatement } from '../../lib/canonical/command-batch';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import {
  buildAppointmentRouteContext,
  fulfilRouteAppointment,
  resolveAppointmentRouteEncounter,
  transitionRouteAppointment,
} from '../../lib/canonical/appointment-route-integration';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import {
  cancelRouteEncounter,
  completeRouteEncounter,
  prepareRouteEncounterCompletionBatch,
  resolveEncounterRouteContext,
} from '../../lib/canonical/encounter-route-integration';

type QueueEnv = { Bindings: Env; Variables: Variables };

const queueRoutes = new Hono<QueueEnv>();

interface QueueVisitRow {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  visit_type: string;
  visit_date: string | null;
  status: string | null;
  appointment_id: number | null;
  canonical_source_key: string | null;
}

async function readQueueVisit(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  visitId: number,
): Promise<QueueVisitRow | null> {
  return db.$client.prepare(`
    SELECT id,patient_id,doctor_id,visit_type,visit_date,status,appointment_id,canonical_source_key
    FROM visits
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(visitId, tenantId).first<QueueVisitRow>();
}

function queueVisitSnapshot(visit: QueueVisitRow) {
  return {
    visitId: Number(visit.id),
    patientId: Number(visit.patient_id),
    doctorId: visit.doctor_id == null ? null : Number(visit.doctor_id),
    visitType: String(visit.visit_type),
    visitDate: String(visit.visit_date ?? getTodayGMT6()),
    status: String(visit.status ?? 'initiated'),
    appointmentId: visit.appointment_id == null ? null : Number(visit.appointment_id),
    canonicalSourceKey: visit.canonical_source_key?.trim() || null,
  };
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const issueTokenSchema = z.object({
  patientId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  visitId: z.number().int().positive().optional(),
  priority: z.enum(['normal', 'urgent', 'emergency', 'vip']).default('normal'),
  counterNo: z.string().max(20).optional(),
  \u0074okenNumber: z.number().int().positive().max(99999).optional(),
});

const callNextSchema = z.object({
  departmentId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  counterNo: z.string().max(20).optional(),
});

const updateQueueStatusSchema = z.object({
  status: z.enum(['waiting', 'serving', 'called', 'no_show', 'completed', 'cancelled', 'transferred']),
});

const holdTokenSchema = z.object({
  reason: z.string().max(500).optional(),
});

const recallTokenSchema = z.object({
  counterNo: z.string().max(20).optional(),
});

const transferSchema = z.object({
  toDepartmentId: z.number().int().positive(),
  toDoctorId: z.number().int().positive().optional(),
});

const displayConfigSchema = z.object({
  displayName: z.string().min(1).max(100),
  departmentIds: z.array(z.number()).optional(),
  showDoctorName: z.boolean().default(true),
  showEstimatedWait: z.boolean().default(true),
  showTokenCount: z.boolean().default(true),
  announcementText: z.string().max(500).optional(),
  refreshSeconds: z.number().int().min(5).max(120).default(10),
  theme: z.enum(['default', 'dark', 'hospital_brand']).default('default'),
});

// ─── Helper: generate next \u0074oken ─────────────────────────────────────────────

export async function getNextToken(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  departmentId: number | null,
  date: string,
  customTokenNumber?: number,
): Promise<{ \u0074okenNo: string; \u0074okenNumber: number }> {
  const deptKey = departmentId ?? 0;

  // Ensure counter row exists
  await db.$client.prepare(`
    INSERT INTO queue_\u0074oken_counters (tenant_id, department_id, counter_date, last_\u0074oken, prefix)
    VALUES (?, ?, ?, 0, 'T')
    ON CONFLICT(tenant_id, department_id, counter_date) DO NOTHING
  `).bind(tenantId, deptKey, date).run();

  if (customTokenNumber !== undefined) {
    // Bump counter to at least customTokenNumber so next auto stays ahead.
    await db.$client.prepare(`
      UPDATE queue_\u0074oken_counters
      SET last_\u0074oken = MAX(last_\u0074oken, ?)
      WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
    `).bind(customTokenNumber, tenantId, deptKey, date).run();

    const row = await db.$client.prepare(`
      SELECT last_\u0074oken, prefix FROM queue_\u0074oken_counters
      WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
    `).bind(tenantId, deptKey, date).first<{ last_\u0074oken: number; prefix: string }>();

    const prefix = row?.prefix ?? 'T';
    return {
      \u0074okenNo: `${prefix}${String(customTokenNumber).padStart(3, '0')}`,
      \u0074okenNumber: customTokenNumber,
    };
  }

  // Auto-increment path
  await db.$client.prepare(`
    UPDATE queue_\u0074oken_counters SET last_\u0074oken = last_\u0074oken + 1
    WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
  `).bind(tenantId, deptKey, date).run();

  const row = await db.$client.prepare(`
    SELECT last_\u0074oken, prefix FROM queue_\u0074oken_counters
    WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
  `).bind(tenantId, deptKey, date).first<{ last_\u0074oken: number; prefix: string }>();

  const num = row?.last_\u0074oken ?? 1;
  const prefix = row?.prefix ?? 'T';
  return { \u0074okenNo: `${prefix}${String(num).padStart(3, '0')}`, \u0074okenNumber: num };
}

// ─── Helper: estimate wait time ──────────────────────────────────────────────

async function estimateWait(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  departmentId: number | null,
  date: string,
): Promise<number> {
  // Count waiting + called ahead
  const waiting = await db.$client.prepare(`
    SELECT COUNT(*) as cnt FROM queue_entries
    WHERE tenant_id = ? AND queue_date = ? AND status IN ('waiting','called')
    ${departmentId ? 'AND department_id = ?' : ''}
  `).bind(...(departmentId ? [tenantId, date, departmentId] : [tenantId, date])).first<{ cnt: number }>();

  // Average serve time from completed entries today
  const avg = await db.$client.prepare(`
    SELECT AVG(
      (julianday(serve_end_time) - julianday(serve_start_time)) * 1440
    ) as avg_minutes FROM queue_entries
    WHERE tenant_id = ? AND queue_date = ? AND status = 'completed'
      AND serve_start_time IS NOT NULL AND serve_end_time IS NOT NULL
    ${departmentId ? 'AND department_id = ?' : ''}
  `).bind(...(departmentId ? [tenantId, date, departmentId] : [tenantId, date])).first<{ avg_minutes: number | null }>();

  const avgMin = avg?.avg_minutes ?? 10; // default 10 min if no data
  return Math.round((waiting?.cnt ?? 0) * avgMin);
}

type TokenFilters = {
  departmentId?: string;
  doctorId?: string;
  status?: string;
  date?: string;
};

type QueueStatsRow = {
  total: number | null;
  waiting: number | null;
  called: number | null;
  serving: number | null;
  completed: number | null;
  no_show: number | null;
  cancelled: number | null;
};

async function fetchQueueDepartments(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
) {
  const { results } = await db.$client
    .prepare(`
      WITH doctor_depts AS (
        SELECT MIN(id) AS id, TRIM(specialty) AS name
        FROM doctors
        WHERE tenant_id = ?
          AND is_active = 1
          AND specialty IS NOT NULL
          AND TRIM(specialty) != ''
        GROUP BY TRIM(specialty)
      )
      SELECT id, name FROM doctor_depts
      UNION ALL
      SELECT id, department_name AS name
      FROM billing_service_departments
      WHERE tenant_id = ?
        AND is_active = 1
        AND NOT EXISTS (SELECT 1 FROM doctor_depts)
      ORDER BY name
    `)
    .bind(tenantId, tenantId)
    .all();

  return results;
}

async function fetchQueueTokens(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  filters: TokenFilters,
) {
  const queueDate = filters.date || getTodayGMT6();

  let query = `
    SELECT
      q.id, q.visit_id, q.appointment_id, q.doctor_id, q.\u0074oken_no, q.\u0074oken_number, q.priority, q.status,
      q.check_in_time, q.called_at, q.serve_start_time, q.serve_end_time,
      q.counter_no, q.estimated_wait_minutes,
      q.manual_serial_set_by, q.manual_serial_set_at,
      p.id as patient_id, p.name as patient_name, p.patient_code, p.gender, p.mobile as phone,
      COALESCE(NULLIF(TRIM(dept_doc.specialty), ''), svc_dept.department_name) as department_name,
      doc.name as doctor_name
    FROM queue_entries q
    JOIN patients p ON q.patient_id = p.id AND p.tenant_id = q.tenant_id
    LEFT JOIN doctors dept_doc ON q.department_id = dept_doc.id AND dept_doc.tenant_id = q.tenant_id
    LEFT JOIN billing_service_departments svc_dept ON q.department_id = svc_dept.id AND svc_dept.tenant_id = q.tenant_id
    LEFT JOIN doctors doc ON q.doctor_id = doc.id AND doc.tenant_id = q.tenant_id
    WHERE q.tenant_id = ? AND q.queue_date = ?
  `;
  const params: (string | number)[] = [tenantId, queueDate];

  if (filters.departmentId) { query += ' AND q.department_id = ?'; params.push(Number(filters.departmentId)); }
  if (filters.doctorId) { query += ' AND q.doctor_id = ?'; params.push(Number(filters.doctorId)); }
  if (filters.status && filters.status !== 'all') { query += ' AND q.status = ?'; params.push(filters.status); }
  else { query += " AND q.status != 'cancelled'"; }

  query += ` ORDER BY
    CASE q.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'vip' THEN 2 ELSE 3 END,
    q.\u0074oken_number ASC`;

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return results;
}

async function fetchQueueStats(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  date = getTodayGMT6(),
) {
  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status = 'called' THEN 1 ELSE 0 END) as called,
      SUM(CASE WHEN status = 'serving' THEN 1 ELSE 0 END) as serving,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM queue_entries
    WHERE tenant_id = ? AND queue_date = ?
  `).bind(tenantId, date).first<QueueStatsRow>();

  const { results: nowServing } = await db.$client.prepare(`
    SELECT q.\u0074oken_no, q.counter_no, p.name as patient_name, doc.name as doctor_name
    FROM queue_entries q
    JOIN patients p ON q.patient_id = p.id AND p.tenant_id = q.tenant_id
    LEFT JOIN doctors doc ON q.doctor_id = doc.id AND doc.tenant_id = q.tenant_id
    WHERE q.tenant_id = ? AND q.queue_date = ? AND q.status IN ('serving', 'called')
    ORDER BY q.called_at DESC
  `).bind(tenantId, date).all();

  return { ...stats, nowServing };
}

async function fetchQueueAnnouncements(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  limit: number,
) {
  const { results } = await db.$client.prepare(`
    SELECT \u0074oken_no, patient_name, counter_no, doctor_name, announced_at
    FROM queue_announcements
    WHERE tenant_id = ? AND date(announced_at) = date('now', '+6 hours')
    ORDER BY announced_at DESC LIMIT ?
  `).bind(tenantId, limit).all();

  return results;
}

async function assertVisitCanEnterDoctorQueue(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  visitId?: number,
): Promise<void> {
  if (!visitId) return;

  const visit = await db.$client.prepare(`
    SELECT id, appointment_id
    FROM visits
    WHERE id = ? AND tenant_id = ?
  `).bind(visitId, tenantId).first<{ id: number; appointment_id: number | null }>();

  if (!visit) {
    throw new HTTPException(404, { message: 'Visit not found' });
  }

  if (visit.appointment_id) {
    const appointment = await db.$client.prepare(`
      SELECT billing_status
      FROM appointments
      WHERE id = ? AND tenant_id = ?
    `).bind(visit.appointment_id, tenantId).first<{ billing_status: string | null }>();

    const billingStatus = appointment?.billing_status ?? '';
    const financiallyClearedStatuses = new Set(['paid', 'due_approved', 'no_charge', 'no-charge']);
    if (!financiallyClearedStatuses.has(billingStatus)) {
      throw new HTTPException(409, {
        message: 'Complete appointment payment, due approval, or no-charge approval before issuing a doctor queue \u0074oken',
      });
    }
  }

  const { results } = await db.$client.prepare(`
    SELECT id, total_amount
    FROM visit_services
    WHERE tenant_id = ?
      AND visit_id = ?
      AND service_type = 'doctor_visit'
      AND status = 'pending'
  `).bind(tenantId, visitId).all<{ id: number; total_amount: number | null }>();

  const pendingDoctorCharge = (results ?? []).reduce((sum, service) => {
    return sum + Number(service.total_amount ?? 0);
  }, 0);

  if (pendingDoctorCharge > 0) {
    throw new HTTPException(409, {
      message: 'Collect payment, approve due, or mark no-charge before issuing a doctor queue \u0074oken',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING ROUTES (visits-based)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /departments — active clinical departments
queueRoutes.get('/departments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const results = await fetchQueueDepartments(db, tenantId);
  return c.json({ Results: results });
});

// GET /visits — live queue (legacy, kept for backward compat)
queueRoutes.get('/visits', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { departmentId, doctorId, date, status } = c.req.query();

  let query = `
    SELECT
      v.id as visit_id,
      v.visit_no as visit_code,
      v.visit_date,
      NULL as visit_time,
      v.id as queue_no,
      v.status as visit_status,
      v.visit_type,
      p.id as patient_id,
      p.patient_code,
      p.name as patient_name,
      p.gender,
      p.date_of_birth,
      p.mobile as phone,
      d.name as doctor_name,
      d.specialty as department_name
    FROM visits v
    JOIN patients p ON v.patient_id = p.id AND p.tenant_id = v.tenant_id
    LEFT JOIN doctors d ON v.doctor_id = d.id AND d.tenant_id = v.tenant_id
    WHERE v.tenant_id = ?
  `;

  const params: (string | number)[] = [tenantId];

  if (date) {
    query += ' AND v.visit_date = ?';
    params.push(date);
  } else {
    query += " AND v.visit_date = date('now', '+6 hours')";
  }

  if (departmentId) {
    query += ' AND d.id = ?';
    params.push(Number(departmentId));
  }

  if (doctorId) {
    query += ' AND v.doctor_id = ?';
    params.push(Number(doctorId));
  }

  if (status === 'all') {
    query += " AND COALESCE(v.status, 'initiated') != 'cancelled'";
  } else {
    query += " AND COALESCE(v.status, 'initiated') IN ('checked-in', 'checked_in', 'engaged', 'initiated')";
  }

  query += ' ORDER BY v.id ASC, v.created_at ASC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// PUT /visits/:id/status — update visit status
queueRoutes.put(
  '/visits/:id/status',
  zValidator('json', z.object({
    status: z.enum(['initiated', 'checked-in', 'engaged', 'concluded', 'cancelled']),
  })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = Number(c.req.param('id'));
    const { status } = c.req.valid('json');
    const today = getTodayGMT6();
    const now = getFullTimestampGMT6();
    const visit = await readQueueVisit(db, tenantId, id);
    if (!visit) throw new HTTPException(404, { message: 'Visit not found' });

    const queueStatus =
      status === 'engaged' ? 'serving'
      : status === 'concluded' ? 'completed'
      : status === 'cancelled' ? 'cancelled'
      : 'waiting';
    const authoritativeStatements: CanonicalPreparedStatement[] = [
      db.$client
        .prepare('UPDATE visits SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .bind(status, now, id, tenantId),
      db.$client.prepare(`
        UPDATE queue_entries
        SET status = ?,
            updated_at = ?,
            serve_start_time = CASE WHEN ? = 'serving' THEN COALESCE(serve_start_time, ?) ELSE serve_start_time END,
            serve_end_time = CASE WHEN ? = 'completed' THEN COALESCE(serve_end_time, ?) ELSE serve_end_time END
        WHERE tenant_id = ? AND visit_id = ? AND queue_date = ? AND status NOT IN ('completed', 'cancelled', 'transferred')
      `).bind(
        queueStatus,
        now,
        queueStatus,
        now,
        queueStatus,
        now,
        tenantId,
        id,
        today,
      ),
    ];
    const suppliedKey = c.req.header('Idempotency-Key')?.trim();
    const occurredAtUtc = new Date().toISOString();

    if (status === 'cancelled') {
      const encounterContext = await resolveEncounterRouteContext(c.env.DB, {
        tenantId,
        visit: queueVisitSnapshot(visit),
      });
      await cancelRouteEncounter(c.env.DB, encounterContext, {
        cancelledAtUtc: occurredAtUtc,
        sourceEvidence: { boundary: 'queue_visit_cancelled', visitId: id },
        idempotencyKey: suppliedKey
          ? `route:queue-visit-cancelled:${suppliedKey}`
          : `route:queue-visit-cancelled:${id}:${encounterContext.encounterVersion}`,
        businessDate: today,
        authoritativeStatements,
      });
    } else if (status === 'concluded') {
      const encounterContext = await resolveEncounterRouteContext(c.env.DB, {
        tenantId,
        visit: queueVisitSnapshot(visit),
      });
      if (visit.appointment_id) {
        const routeContext = await buildAppointmentRouteContext(c.env.DB, {
          tenantId,
          legacyAppointmentId: visit.appointment_id,
        });
        const encounterPublicId = await resolveAppointmentRouteEncounter(c.env.DB, tenantId, [
          { sourceType: 'legacy_visit', sourcePublicId: String(id) },
          { sourceType: 'legacy_appointment', sourcePublicId: String(visit.appointment_id) },
        ]);
        if (encounterContext.encounterPublicId !== encounterPublicId) {
          throw new HTTPException(409, { message: 'Appointment and visit encounter mappings do not agree' });
        }
        const completion = await prepareRouteEncounterCompletionBatch(c.env.DB, encounterContext, {
          completedAtUtc: occurredAtUtc,
          sourceEvidence: {
            boundary: 'queue_visit_concluded',
            visitId: id,
            appointmentId: visit.appointment_id,
          },
          idempotencyKey: suppliedKey
            ? `route:queue-encounter-complete:${suppliedKey}`
            : `route:queue-encounter-complete:${id}:${encounterContext.encounterVersion}`,
          businessDate: today,
        });
        authoritativeStatements.unshift(...completion.statements);
        authoritativeStatements.push(
          db.$client.prepare(`
            UPDATE appointments
            SET status='completed',canonical_source_key=COALESCE(canonical_source_key,?),updated_at=?
            WHERE id=? AND tenant_id=?
          `).bind(routeContext.sourcePublicId, now, visit.appointment_id, tenantId),
          prepareMasterDataAudit(c.env.DB, {
            tenantId,
            userId,
            action: 'UPDATE',
            tableName: 'appointments',
            recordId: visit.appointment_id,
            oldValue: { currentStatus: routeContext.currentStatus, statusVersion: routeContext.statusVersion },
            newValue: {
              source: 'queue_visit_concluded',
              status: 'completed',
              encounterPublicId,
              canonicalSourceKey: routeContext.sourcePublicId,
            },
            ...auditRequestMetadata(c),
          }),
        );
        await fulfilRouteAppointment(c.env.DB, routeContext, {
          encounterPublicId,
          authoritativeStatements,
          actorSystemKey: 'canonical.appointment.queue-visit',
          actorUserPublicId: String(userId),
          occurredAtUtc,
          businessDate: today,
          idempotencyKey: suppliedKey
            ? `route:queue-visit-concluded:${suppliedKey}`
            : `route:queue-visit-concluded:${id}:${visit.appointment_id}`,
          reasonCode: 'queue_visit_concluded',
        });
      } else {
        await completeRouteEncounter(c.env.DB, encounterContext, {
          completedAtUtc: occurredAtUtc,
          sourceEvidence: { boundary: 'queue_visit_concluded', visitId: id },
          idempotencyKey: suppliedKey
            ? `route:queue-encounter-complete:${suppliedKey}`
            : `route:queue-encounter-complete:${id}:${encounterContext.encounterVersion}`,
          businessDate: today,
          authoritativeStatements,
        });
      }
    } else {
      await c.env.DB.batch(authoritativeStatements as D1PreparedStatement[]);
    }

    return c.json({ Results: { success: true, status } });
  },
);

// GET /stats — queue statistics for today
queueRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const stats = await db.$client
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN COALESCE(status, 'initiated') IN ('checked-in', 'checked_in', 'initiated') THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN status = 'engaged' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'concluded' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM visits
      WHERE tenant_id = ? AND visit_date = date('now', '+6 hours')
    `)
    .bind(tenantId)
    .first();

  return c.json({ Results: stats });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: TOKEN-BASED QUEUE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

// POST /\u0074oken — Issue a new \u0074oken for a patient
queueRoutes.post('/\u0074oken', zValidator('json', issueTokenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const now = getFullTimestampGMT6();

  await assertVisitCanEnterDoctorQueue(db, tenantId, data.visitId);

  // Fast-path duplicate check when custom number supplied.
  if (data.\u0074okenNumber !== undefined) {
    const dup = await db.$client.prepare(`
      SELECT id, \u0074oken_no FROM queue_entries
      WHERE tenant_id = ? AND department_id IS ? AND queue_date = ? AND \u0074oken_number = ?
    `).bind(tenantId, data.departmentId ?? null, today, data.\u0074okenNumber)
      .first<{ id: number; \u0074oken_no: string }>();

    if (dup) {
      throw new HTTPException(409, {
        message: `Serial ${data.\u0074okenNumber} already issued today (\u0074oken ${dup.\u0074oken_no})`,
      });
    }
  }

  const { \u0074okenNo, \u0074okenNumber } = await getNextToken(
    db, tenantId, data.departmentId ?? null, today, data.\u0074okenNumber,
  );
  const estWait = await estimateWait(db, tenantId, data.departmentId ?? null, today);

  const manualSet = data.\u0074okenNumber !== undefined;
  try {
    const result = await db.$client.prepare(`
      INSERT INTO queue_entries
        (tenant_id, visit_id, patient_id, department_id, doctor_id, \u0074oken_no, \u0074oken_number,
         queue_date, priority, status, check_in_time, counter_no, estimated_wait_minutes,
         manual_serial_set_by, manual_serial_set_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?)
    `).bind(
      tenantId, data.visitId ?? null, data.patientId, data.departmentId ?? null,
      data.doctorId ?? null, \u0074okenNo, \u0074okenNumber, today, data.priority,
      now, data.counterNo ?? null, estWait,
      manualSet ? userId : null, manualSet ? now : null,
    ).run();

    return c.json({
      message: 'Token issued',
      data: {
        id: result.meta.last_row_id, \u0074okenNo, \u0074okenNumber,
        estimatedWait: estWait, priority: data.priority,
        manualSerial: manualSet,
      },
    }, 201);
  } catch (e: any) {
    // Race: another transaction inserted the same number after our pre-check.
    if (String(e?.message ?? '').includes('UNIQUE')) {
      throw new HTTPException(409, {
        message: `Serial ${data.\u0074okenNumber} already issued today`,
      });
    }
    throw e;
  }
});

// GET /\u0074okens — Today's \u0074oken queue (with filters)
queueRoutes.get('/\u0074okens', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await fetchQueueTokens(db, tenantId, c.req.query());
  return c.json({ Results: results });
});

// GET /\u0074okens/stats — Token queue statistics
queueRoutes.get('/\u0074okens/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const stats = await fetchQueueStats(db, tenantId);
  return c.json({ Results: stats });
});

function mapTokenForOverview(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    \u0074okenNumber: String(row.\u0074oken_no ?? row.\u0074oken_number ?? ''),
    patientName: String(row.patient_name ?? ''),
    doctorName: String(row.doctor_name ?? '—'),
    departmentName: String(row.department_name ?? '—'),
    appointmentTime: String(row.check_in_time ?? row.called_at ?? row.serve_start_time ?? ''),
    checkinTime: row.check_in_time ? String(row.check_in_time) : undefined,
    waitingMinutes: Number(row.estimated_wait_minutes ?? 0),
    status: String(row.status ?? 'waiting'),
  };
}

// GET /\u0074okens/overview — \u0074okens + stats in one request for lower polling cost
queueRoutes.get('/\u0074okens/overview', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const filters = c.req.query();
  const date = filters.date || getTodayGMT6();

  const [\u0074okens, rawStats] = await Promise.all([
    fetchQueueTokens(db, tenantId, filters),
    fetchQueueStats(db, tenantId, date),
  ]);

  // Map backend stats (snake_case + extra `called`/`nowServing`) to frontend camelCase shape
  const stats = {
    total: Number(rawStats.total ?? 0),
    waiting: Number(rawStats.waiting ?? 0),
    serving: Number(rawStats.serving ?? 0),
    completed: Number(rawStats.completed ?? 0),
    noShow: Number(rawStats.no_show ?? 0),
    cancelled: Number(rawStats.cancelled ?? 0),
  };

  // Delayed doctors: doctors whose waiting \u0074okens exceed threshold (any \u0074oken waiting > 30 min)
  let delayedDoctors: Array<{ doctorName: string; departmentName: string; delayMinutes: number; waitingPatients: number }> = [];
  try {
    const delayedRows = await db.$client.prepare(`
      SELECT doc.name AS doctor_name, doc.specialty AS department_name,
         CAST((julianday('now') - julianday(MIN(q.created_at))) * 24 * 60 AS INTEGER) AS delay_minutes,
         COUNT(*) AS waiting_patients
      FROM queue_entries q
      JOIN doctors doc ON q.doctor_id = doc.id AND doc.tenant_id = q.tenant_id
      WHERE q.tenant_id = ? AND q.status = 'waiting' AND q.queue_date = ?
      GROUP BY doc.id, doc.name, doc.specialty
      HAVING delay_minutes > 30
      ORDER BY delay_minutes DESC
      LIMIT 10
    `).bind(tenantId, date).all<{
      doctor_name: string; department_name: string; delay_minutes: number; waiting_patients: number;
    }>();
    delayedDoctors = (delayedRows.results || []).map(r => ({
      doctorName: r.doctor_name,
      departmentName: r.department_name ?? '—',
      delayMinutes: r.delay_minutes,
      waitingPatients: r.waiting_patients,
    }));
  } catch {
    // delayedDoctors is optional; degrade gracefully if query fails
  }

  return c.json({ \u0074okens: \u0074okens.map(mapTokenForOverview), stats, delayedDoctors });
});

// GET /display — queue display payload in one request for TV/kiosk polling
queueRoutes.get('/display', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = Math.min(Number(c.req.query('limit') || '10'), 25);

  const [stats, waiting, announcements] = await Promise.all([
    fetchQueueStats(db, tenantId),
    fetchQueueTokens(db, tenantId, { status: 'waiting' }),
    fetchQueueAnnouncements(db, tenantId, limit),
  ]);

  return c.json({ Results: { stats, waiting, announcements } });
});

// POST /call-next — Doctor calls next patient in queue
queueRoutes.post('/call-next', zValidator('json', callNextSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const now = getFullTimestampGMT6();

  // Find next waiting patient (priority first, then \u0074oken number)
  let query = `
    SELECT id, \u0074oken_no, patient_id FROM queue_entries
    WHERE tenant_id = ? AND queue_date = ? AND status = 'waiting'
  `;
  const params: (string | number)[] = [tenantId, today];

  if (data.departmentId) { query += ' AND department_id = ?'; params.push(data.departmentId); }
  if (data.doctorId) { query += ' AND doctor_id = ?'; params.push(data.doctorId); }

  query += ` ORDER BY
    CASE priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'vip' THEN 2 ELSE 3 END,
    \u0074oken_number ASC
    LIMIT 1`;

  const next = await db.$client.prepare(query).bind(...params).first<{ id: number; \u0074oken_no: string; patient_id: number }>();

  if (!next) {
    return c.json({ message: 'No patients waiting', data: null });
  }

  // Update to 'called'
  await db.$client.prepare(`
    UPDATE queue_entries SET status = 'called', called_at = ?, called_by = ?, counter_no = ?, updated_at = ?
    WHERE id = ?
  `).bind(now, userId, data.counterNo ?? null, now, next.id).run();

  // Log announcement
  const patient = await db.$client.prepare('SELECT name FROM patients WHERE id = ?').bind(next.patient_id).first<{ name: string }>();

  await db.$client.prepare(`
    INSERT INTO queue_announcements (tenant_id, queue_entry_id, \u0074oken_no, patient_name, counter_no)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, next.id, next.\u0074oken_no, patient?.name ?? '', data.counterNo ?? null).run();

  return c.json({
    message: 'Patient called',
    data: { queueId: next.id, \u0074okenNo: next.\u0074oken_no, patientName: patient?.name, counterNo: data.counterNo },
  });
});

// PUT /\u0074okens/:id/status — Update queue entry status
queueRoutes.put('/\u0074okens/:id/status', zValidator('json', updateQueueStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const { status } = c.req.valid('json');
  const now = getFullTimestampGMT6();
  const today = getTodayGMT6();
  const queueEntry = await db.$client.prepare(
    'SELECT visit_id, appointment_id FROM queue_entries WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ visit_id: number | null; appointment_id: number | null }>();
  const linkedVisit = queueEntry?.visit_id
    ? await readQueueVisit(db, tenantId, queueEntry.visit_id)
    : null;
  const appointmentId = queueEntry?.appointment_id ?? linkedVisit?.appointment_id ?? null;

  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: (string | number)[] = [status, now];
  if (status === 'serving') { updates.push('serve_start_time = ?'); params.push(now); }
  if (status === 'completed') { updates.push('serve_end_time = ?'); params.push(now); }
  params.push(id, tenantId);

  const authoritativeStatements: CanonicalPreparedStatement[] = [
    db.$client.prepare(`
      UPDATE queue_entries SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?
    `).bind(...params),
  ];
  if (status === 'serving' && queueEntry?.visit_id) {
    authoritativeStatements.push(db.$client.prepare(
      `UPDATE visits SET status = 'engaged', updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).bind(now, queueEntry.visit_id, tenantId));
  }
  if (status === 'completed' && queueEntry?.visit_id) {
    authoritativeStatements.push(db.$client.prepare(
      `UPDATE visits SET status = 'concluded', updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).bind(now, queueEntry.visit_id, tenantId));
  }

  const suppliedKey = c.req.header('Idempotency-Key')?.trim();
  const occurredAtUtc = new Date().toISOString();
  const appointmentIdempotencyKey = appointmentId
    ? (suppliedKey
        ? `route:queue-entry-status:${suppliedKey}`
        : `route:queue-entry-status:${id}:${status}:${appointmentId}`)
    : null;

  if (status === 'completed' && linkedVisit) {
    const encounterContext = await resolveEncounterRouteContext(c.env.DB, {
      tenantId,
      visit: queueVisitSnapshot(linkedVisit),
    });
    if (appointmentId) {
      const routeContext = await buildAppointmentRouteContext(c.env.DB, {
        tenantId,
        legacyAppointmentId: appointmentId,
      });
      const encounterPublicId = await resolveAppointmentRouteEncounter(c.env.DB, tenantId, [
        { sourceType: 'legacy_visit', sourcePublicId: String(linkedVisit.id) },
        { sourceType: 'legacy_appointment', sourcePublicId: String(appointmentId) },
      ]);
      if (encounterContext.encounterPublicId !== encounterPublicId) {
        throw new HTTPException(409, { message: 'Appointment and visit encounter mappings do not agree' });
      }
      const completion = await prepareRouteEncounterCompletionBatch(c.env.DB, encounterContext, {
        completedAtUtc: occurredAtUtc,
        sourceEvidence: {
          boundary: 'queue_entry_completed',
          queueEntryId: id,
          visitId: linkedVisit.id,
          appointmentId,
        },
        idempotencyKey: suppliedKey
          ? `route:queue-entry-encounter:${suppliedKey}`
          : `route:queue-entry-encounter:${id}:${encounterContext.encounterVersion}`,
        businessDate: today,
      });
      authoritativeStatements.unshift(...completion.statements);
      authoritativeStatements.push(
        db.$client.prepare(`
          UPDATE appointments
          SET status=?,canonical_source_key=COALESCE(canonical_source_key,?),updated_at=?
          WHERE id=? AND tenant_id=?
        `).bind(status, routeContext.sourcePublicId, now, appointmentId, tenantId),
        prepareMasterDataAudit(c.env.DB, {
          tenantId,
          userId,
          action: 'UPDATE',
          tableName: 'appointments',
          recordId: appointmentId,
          oldValue: { currentStatus: routeContext.currentStatus, statusVersion: routeContext.statusVersion },
          newValue: {
            source: 'queue_entry_status',
            queueEntryId: id,
            status,
            encounterPublicId,
            canonicalSourceKey: routeContext.sourcePublicId,
          },
          ...auditRequestMetadata(c),
        }),
      );
      await fulfilRouteAppointment(c.env.DB, routeContext, {
        encounterPublicId,
        authoritativeStatements,
        actorSystemKey: 'canonical.appointment.queue-entry',
        actorUserPublicId: String(userId),
        occurredAtUtc,
        businessDate: today,
        idempotencyKey: appointmentIdempotencyKey as string,
        reasonCode: 'queue_entry_completed',
      });
    } else {
      await completeRouteEncounter(c.env.DB, encounterContext, {
        completedAtUtc: occurredAtUtc,
        sourceEvidence: { boundary: 'queue_entry_completed', queueEntryId: id, visitId: linkedVisit.id },
        idempotencyKey: suppliedKey
          ? `route:queue-entry-encounter:${suppliedKey}`
          : `route:queue-entry-encounter:${id}:${encounterContext.encounterVersion}`,
        businessDate: today,
        authoritativeStatements,
      });
    }
  } else if ((status === 'completed' || status === 'no_show') && appointmentId) {
    const routeContext = await buildAppointmentRouteContext(c.env.DB, {
      tenantId,
      legacyAppointmentId: appointmentId,
    });
    authoritativeStatements.push(
      db.$client.prepare(`
        UPDATE appointments
        SET status=?,canonical_source_key=COALESCE(canonical_source_key,?),updated_at=?
        WHERE id=? AND tenant_id=?
      `).bind(status, routeContext.sourcePublicId, now, appointmentId, tenantId),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'UPDATE',
        tableName: 'appointments',
        recordId: appointmentId,
        oldValue: { currentStatus: routeContext.currentStatus, statusVersion: routeContext.statusVersion },
        newValue: {
          source: 'queue_entry_status',
          queueEntryId: id,
          status,
          canonicalSourceKey: routeContext.sourcePublicId,
        },
        ...auditRequestMetadata(c),
      }),
    );
    if (status === 'completed') {
      const encounterPublicId = await resolveAppointmentRouteEncounter(c.env.DB, tenantId, [
        { sourceType: 'legacy_appointment', sourcePublicId: String(appointmentId) },
      ]);
      await fulfilRouteAppointment(c.env.DB, routeContext, {
        encounterPublicId,
        authoritativeStatements,
        actorSystemKey: 'canonical.appointment.queue-entry',
        actorUserPublicId: String(userId),
        occurredAtUtc,
        businessDate: today,
        idempotencyKey: appointmentIdempotencyKey as string,
        reasonCode: 'queue_entry_completed',
      });
    } else {
      await transitionRouteAppointment(c.env.DB, routeContext, {
        toStatus: 'no_show',
        authoritativeStatements,
        actorSystemKey: 'canonical.appointment.queue-entry',
        actorUserPublicId: String(userId),
        occurredAtUtc,
        businessDate: today,
        idempotencyKey: appointmentIdempotencyKey as string,
        reasonCode: 'queue_entry_no_show',
      });
    }
  } else {
    await c.env.DB.batch(authoritativeStatements as D1PreparedStatement[]);
  }

  return c.json({ message: 'Status updated', data: { id, status } });
});

// POST /\u0074okens/:id/hold — send a called \u0074oken back to the waiting queue tail
queueRoutes.post('/\u0074okens/:id/hold', zValidator('json', holdTokenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const now = new Date().toISOString();

  const entry = await db.$client.prepare(
    `SELECT id, status, department_id
     FROM queue_entries
     WHERE id = ? AND tenant_id = ? AND queue_date = ?`,
  ).bind(id, tenantId, today).first<{ id: number; status: string; department_id: number | null }>();

  if (!entry) throw new HTTPException(404, { message: 'Queue entry not found' });
  if (['completed', 'cancelled', 'transferred'].includes(entry.status)) {
    throw new HTTPException(400, { message: `Cannot hold a ${entry.status} \u0074oken` });
  }

  const tail = await db.$client.prepare(`
    SELECT COALESCE(MAX(\u0074oken_number), 0) + 1 AS next_\u0074oken_number
    FROM queue_entries
    WHERE tenant_id = ? AND queue_date = ?
      AND (department_id = ? OR (department_id IS NULL AND ? IS NULL))
  `).bind(tenantId, today, entry.department_id, entry.department_id).first<{ next_\u0074oken_number: number }>();

  const reason = data.reason ? `Held: ${data.reason}` : 'Held by reception';
  await db.$client.prepare(`
    UPDATE queue_entries
    SET status = 'waiting',
        \u0074oken_number = ?,
        called_at = NULL,
        called_by = NULL,
        counter_no = NULL,
        remarks = TRIM(COALESCE(remarks || char(10), '') || ?),
        updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(tail?.next_\u0074oken_number ?? 1, reason, now, id, tenantId).run();

  return c.json({ message: 'Token held', data: { id, status: 'waiting' } });
});

// POST /\u0074okens/:id/recall — call or re-announce a specific \u0074oken
queueRoutes.post('/\u0074okens/:id/recall', zValidator('json', recallTokenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const now = new Date().toISOString();

  const entry = await db.$client.prepare(
    `SELECT id, \u0074oken_no, patient_id, status
     FROM queue_entries
     WHERE id = ? AND tenant_id = ? AND queue_date = ?`,
  ).bind(id, tenantId, today).first<{ id: number; \u0074oken_no: string; patient_id: number; status: string }>();

  if (!entry) throw new HTTPException(404, { message: 'Queue entry not found' });
  if (['completed', 'cancelled', 'transferred'].includes(entry.status)) {
    throw new HTTPException(400, { message: `Cannot recall a ${entry.status} \u0074oken` });
  }

  await db.$client.prepare(`
    UPDATE queue_entries
    SET status = 'called', called_at = ?, called_by = ?, counter_no = COALESCE(?, counter_no), updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(now, userId, data.counterNo ?? null, now, id, tenantId).run();

  const patient = await db.$client.prepare(
    'SELECT name FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(entry.patient_id, tenantId).first<{ name: string }>();

  await db.$client.prepare(`
    INSERT INTO queue_announcements (tenant_id, queue_entry_id, \u0074oken_no, patient_name, counter_no)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, id, entry.\u0074oken_no, patient?.name ?? '', data.counterNo ?? null).run();

  return c.json({
    message: 'Token recalled',
    data: { queueId: id, \u0074okenNo: entry.\u0074oken_no, patientName: patient?.name, counterNo: data.counterNo },
  });
});

// POST /\u0074okens/:id/transfer — Transfer patient to another department
queueRoutes.post('/\u0074okens/:id/transfer', zValidator('json', transferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  // Get current entry
  const entry = await db.$client.prepare(
    'SELECT * FROM queue_entries WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<Record<string, unknown>>();

  if (!entry) return c.json({ error: 'Queue entry not found' }, 404);

  // Mark old as transferred
  await db.$client.prepare(
    "UPDATE queue_entries SET status = 'transferred', updated_at = ? WHERE id = ?"
  ).bind(now, id).run();

  // Issue new \u0074oken in target department
  const today = getTodayGMT6();
  const { \u0074okenNo, \u0074okenNumber } = await getNextToken(db, tenantId, data.toDepartmentId, today);

  const result = await db.$client.prepare(`
    INSERT INTO queue_entries
      (tenant_id, visit_id, patient_id, department_id, doctor_id, \u0074oken_no, \u0074oken_number,
       queue_date, priority, status, check_in_time, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
  `).bind(
    tenantId, entry.visit_id, entry.patient_id, data.toDepartmentId,
    data.toDoctorId ?? null, \u0074okenNo, \u0074okenNumber, today, entry.priority,
    now, `Transferred from \u0074oken ${entry.\u0074oken_no}`,
  ).run();

  return c.json({
    message: 'Patient transferred',
    data: { newId: result.meta.last_row_id, newTokenNo: \u0074okenNo },
  });
});

// GET /announcements — Recent announcements for display board
queueRoutes.get('/announcements', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = Number(c.req.query('limit') || '10');

  const results = await fetchQueueAnnouncements(db, tenantId, limit);
  return c.json({ Results: results });
});

// ─── Display Board Config ────────────────────────────────────────────────────

queueRoutes.post('/display-config', zValidator('json', displayConfigSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO queue_display_config
      (tenant_id, display_name, department_ids, show_doctor_name, show_estimated_wait,
       show_\u0074oken_count, announcement_text, refresh_seconds, theme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.displayName, data.departmentIds ? JSON.stringify(data.departmentIds) : null,
    data.showDoctorName ? 1 : 0, data.showEstimatedWait ? 1 : 0, data.showTokenCount ? 1 : 0,
    data.announcementText ?? null, data.refreshSeconds, data.theme,
  ).run();

  return c.json({ message: 'Display config created', data: { id: result.meta.last_row_id } }, 201);
});

queueRoutes.get('/display-config', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM queue_display_config WHERE tenant_id = ? AND is_active = 1'
  ).bind(tenantId).all();

  return c.json({ Results: results });
});

export default queueRoutes;

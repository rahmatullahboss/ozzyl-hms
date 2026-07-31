import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { requireRole, NURSING_ROLES } from '../../../middleware/rbac';

type NursingEnv = { Bindings: Env; Variables: Variables };

const assignmentsRoutes = new Hono<NursingEnv>();

assignmentsRoutes.use('/*', requireRole(...NURSING_ROLES));

// GET /assignments — list nurses with their assigned patients
assignmentsRoutes.get(
  '/',
  zValidator('query', z.object({ ward: z.string().optional() })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { ward } = c.req.valid('query');

    // Check if nurse_id column exists in admissions
    const columns = await db.$client.prepare(
      "SELECT name FROM pragma_table_info('admissions') WHERE name = 'nurse_id'"
    ).first();
    const hasNurseId = !!columns;

    // Get all nurses
    const nurseQuery = `
      SELECT id, name, username
      FROM users
      WHERE tenant_id = ? AND role = 'nurse'
      ORDER BY name
    `;
    const { results: nurses } = await db.$client.prepare(nurseQuery).bind(tenantId).all();

    // Get admitted patients with nurse assignments
    let patientQuery = `
      SELECT
        a.id AS admission_id,
        a.patient_id,
        ${hasNurseId ? 'a.nurse_id,' : 'NULL AS nurse_id,'}
        a.admission_date,
        p.name AS patient_name,
        p.patient_code,
        b.bed_number,
        b.ward_name
      FROM admissions a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.status = 'admitted'
    `;
    const params: (string | number)[] = [tenantId];

    if (ward) {
      patientQuery += ' AND b.ward_name = ?';
      params.push(ward);
    }

    patientQuery += ' ORDER BY a.admission_date DESC';
    const { results: patients } = await db.$client.prepare(patientQuery).bind(...params).all();

    // Get pending task counts per patient
    let taskCounts: Record<number, number> = {};
    try {
      const { results: tasks } = await db.$client.prepare(`
        SELECT patient_id, COUNT(*) AS cnt
        FROM nur_medication_admin
        WHERE tenant_id = ? AND status = 'pending'
          AND administered_on <= datetime('now', '+6 hours')
        GROUP BY patient_id
      `).bind(tenantId).all();
      taskCounts = Object.fromEntries(
        (tasks as Array<{ patient_id: number; cnt: number }>).map(t => [t.patient_id, t.cnt])
      );
    } catch {
      // Table may not exist
    }

    // Build nurse assignment map
    const nurseAssignments = (nurses as Array<{ id: number; name: string; username: string }>).map(nurse => {
      const assignedPatients = (patients as Array<Record<string, unknown>>)
        .filter(p => p.nurse_id === nurse.id)
        .map(p => ({
          admission_id: p.admission_id,
          patient_id: p.patient_id,
          patient_name: p.patient_name,
          patient_code: p.patient_code,
          bed_number: p.bed_number,
          ward_name: p.ward_name,
          pending_tasks: taskCounts[p.patient_id as number] ?? 0,
        }));

      return {
        nurse_id: nurse.id,
        nurse_name: nurse.name || nurse.username,
        patient_count: assignedPatients.length,
        total_pending_tasks: assignedPatients.reduce((sum, p) => sum + p.pending_tasks, 0),
        patients: assignedPatients,
      };
    });

    return c.json({ Results: nurseAssignments });
  }
);

// GET /assignments/stats — workload statistics
assignmentsRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  // Check if nurse_id column exists
  const columns = await db.$client.prepare(
    "SELECT name FROM pragma_table_info('admissions') WHERE name = 'nurse_id'"
  ).first();
  const hasNurseId = !!columns;

  const totalNurses = await db.$client.prepare(
    "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND role = 'nurse'"
  ).bind(tenantId).first<{ cnt: number }>();

  const totalPatients = await db.$client.prepare(
    "SELECT COUNT(*) AS cnt FROM admissions WHERE tenant_id = ? AND status = 'admitted'"
  ).bind(tenantId).first<{ cnt: number }>();

  let avgPerNurse = 0;
  let busiestNurse: { nurse_id: number; nurse_name: string; patient_count: number } | null = null;

  if (hasNurseId) {
    const nursePatientCounts = await db.$client.prepare(`
      SELECT nurse_id, COUNT(*) AS cnt
      FROM admissions
      WHERE tenant_id = ? AND status = 'admitted' AND nurse_id IS NOT NULL
      GROUP BY nurse_id
    `).bind(tenantId).all<{ nurse_id: number; cnt: number }>();

    const counts = (nursePatientCounts.results || []).map(r => r.cnt);
    avgPerNurse = counts.length > 0
      ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10
      : 0;

    if (nursePatientCounts.results && nursePatientCounts.results.length > 0) {
      const busiest = nursePatientCounts.results.reduce((max, r) => r.cnt > max.cnt ? r : max);
      const nurseInfo = await db.$client.prepare(
        'SELECT name, username FROM users WHERE id = ? AND tenant_id = ?'
      ).bind(busiest.nurse_id, tenantId).first<{ name: string; username: string }>();
      busiestNurse = {
        nurse_id: busiest.nurse_id,
        nurse_name: nurseInfo?.name || nurseInfo?.username || 'Unknown',
        patient_count: busiest.cnt,
      };
    }
  }

  return c.json({
    total_nurses: totalNurses?.cnt ?? 0,
    total_patients: totalPatients?.cnt ?? 0,
    avg_patients_per_nurse: avgPerNurse,
    busiest_nurse: busiestNurse,
  });
});

// GET /assignments/wards — list wards for filter
assignmentsRoutes.get('/wards', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(`
    SELECT DISTINCT ward_name
    FROM beds
    WHERE tenant_id = ? AND ward_name IS NOT NULL AND ward_name != ''
    ORDER BY ward_name
  `).bind(tenantId).all();
  return c.json({ Results: results.map((r: Record<string, unknown>) => r.ward_name) });
});

// PUT /assignments/:admissionId — assign nurse to patient
assignmentsRoutes.put(
  '/:admissionId',
  zValidator('json', z.object({ nurse_id: z.number().int().positive() })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const admissionId = parseInt(c.req.param('admissionId'));
    if (isNaN(admissionId)) throw new HTTPException(400, { message: 'Invalid admission ID' });

    const { nurse_id } = c.req.valid('json');

    // Verify admission exists
    const admission = await db.$client.prepare(
      "SELECT id FROM admissions WHERE id = ? AND tenant_id = ? AND status = 'admitted'"
    ).bind(admissionId, tenantId).first();
    if (!admission) throw new HTTPException(404, { message: 'Admission not found' });

    // Verify nurse exists
    const nurse = await db.$client.prepare(
      "SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'nurse'"
    ).bind(nurse_id, tenantId).first();
    if (!nurse) throw new HTTPException(404, { message: 'Nurse not found' });

    // Update assignment
    // Check if nurse_id column exists in admissions
    const cols = await db.$client.prepare(
      "SELECT name FROM pragma_table_info('admissions')"
    ).all<{ name: string }>();
    const colNames = new Set((cols.results || []).map(r => r.name));

    if (colNames.has('nurse_id')) {
      await db.$client.prepare(
        "UPDATE admissions SET nurse_id = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
      ).bind(nurse_id, admissionId, tenantId).run();
    } else {
      throw new HTTPException(400, { message: 'Nurse assignment not supported — nurse_id column missing' });
    }

    return c.json({ Results: true });
  }
);

export { assignmentsRoutes };

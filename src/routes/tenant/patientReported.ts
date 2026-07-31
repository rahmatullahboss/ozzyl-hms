import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import type { Env, Variables } from '../../types';
import { clinicalReviewSchema } from '../../schemas/clinical-review';

const patientReportedRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

function requireClinicalReviewRole(role: string): void {
  if (!['doctor', 'md', 'nurse', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can access patient-reported review routes' });
  }
}

async function resolvePatientUhid(db: ReturnType<typeof getDb>, tenantId: string, patientId: number): Promise<string | null> {
  const row = await db.$client.prepare(
    'SELECT uhid FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ uhid: string | null }>();

  return row?.uhid ?? null;
}

patientReportedRoutes.get('/patient/:id/summary', async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  requireClinicalReviewRole(role);

  const patientId = Number(c.req.param('id'));
  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);
  const uhid = await resolvePatientUhid(db, tenantId, patientId);

  if (!uhid) {
    return c.json({
      patient_id: patientId,
      uhid: null,
      adverse_reactions: [],
      lifestyle_logs: [],
      highlights: {
        average_sleep_hours: null,
        recent_exercise_minutes: 0,
        pending_review_count: 0,
        severe_adr_count: 0,
      },
    });
  }

  const [{ results: adverseReactions }, { results: lifestyleLogs }] = await Promise.all([
    db.$client.prepare(`
      SELECT id, medication_name, generic_name, reaction, severity, onset_date, outcome_status, notes,
             source, review_status, reviewed_by, reviewed_at, review_notes, created_at, updated_at
      FROM global_patient_adverse_reactions
      WHERE uhid = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(uhid).all<Record<string, unknown>>(),
    db.$client.prepare(`
      SELECT id, logged_on, sleep_hours, exercise_minutes, mood, energy_level, symptom_score, symptoms,
             diet_notes, notes, source, review_status, reviewed_by, reviewed_at, review_notes, created_at, updated_at
      FROM global_patient_lifestyle_logs
      WHERE uhid = ?
      ORDER BY logged_on DESC, created_at DESC
      LIMIT 30
    `).bind(uhid).all<Record<string, unknown>>(),
  ]);

  const sleepValues = (lifestyleLogs ?? [])
    .map((item) => Number(item.sleep_hours))
    .filter((value) => Number.isFinite(value) && value > 0);

  const highlights = {
    average_sleep_hours: sleepValues.length
      ? Number((sleepValues.reduce((sum, value) => sum + value, 0) / sleepValues.length).toFixed(2))
      : null,
    recent_exercise_minutes: (lifestyleLogs ?? []).reduce((sum, item) => sum + Number(item.exercise_minutes ?? 0), 0),
    pending_review_count: [...(adverseReactions ?? []), ...(lifestyleLogs ?? [])]
      .filter((item) => String(item.review_status ?? 'pending_review') === 'pending_review').length,
    severe_adr_count: (adverseReactions ?? []).filter((item) => String(item.severity ?? '') === 'severe').length,
  };

  return c.json({
    patient_id: patientId,
    uhid,
    adverse_reactions: adverseReactions ?? [],
    lifestyle_logs: lifestyleLogs ?? [],
    highlights,
  });
});

patientReportedRoutes.put('/adverse-reactions/:id/review', zValidator('json', clinicalReviewSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  requireClinicalReviewRole(role);
  const userId = Number(requireUserId(c));
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  if (!Number.isFinite(id) || id <= 0) {
    throw new HTTPException(400, { message: 'Invalid adverse reaction id' });
  }

  const db = getDb(c.env.DB);
  const result = await db.$client.prepare(`
    UPDATE global_patient_adverse_reactions
    SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ?
      AND uhid IN (SELECT uhid FROM patients WHERE tenant_id = ?)
  `).bind(data.status, userId, data.notes ?? null, id, tenantId).run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: 'Adverse reaction not found for this tenant' });
  }

  return c.json({ success: true, review_status: data.status });
});

patientReportedRoutes.put('/lifestyle-logs/:id/review', zValidator('json', clinicalReviewSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  requireClinicalReviewRole(role);
  const userId = Number(requireUserId(c));
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  if (!Number.isFinite(id) || id <= 0) {
    throw new HTTPException(400, { message: 'Invalid lifestyle log id' });
  }

  const db = getDb(c.env.DB);
  const result = await db.$client.prepare(`
    UPDATE global_patient_lifestyle_logs
    SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ?
      AND uhid IN (SELECT uhid FROM patients WHERE tenant_id = ?)
  `).bind(data.status, userId, data.notes ?? null, id, tenantId).run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: 'Lifestyle log not found for this tenant' });
  }

  return c.json({ success: true, review_status: data.status });
});

export default patientReportedRoutes;

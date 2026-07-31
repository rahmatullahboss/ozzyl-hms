import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import { assertNoPendingDischargeBilling } from '../../lib/discharge-billing-guards';

const dischargePlanning = new Hono<{ Bindings: Env; Variables: Variables }>();

const DC_STATUS = ['in_progress','ready','approved','discharged','cancelled'] as const;
const DC_TYPE = ['normal','against_medical_advice','transfer','expired','absconded'] as const;

const CHECKLIST_ITEMS = [
  'vitals_stable','medications_reconciled','prescriptions_printed','lab_results_reviewed',
  'pending_tests_cleared','diet_instructions_given','wound_care_instructions','follow_up_scheduled',
  'referrals_arranged','insurance_clearance','billing_cleared','belongings_returned',
  'transport_arranged','patient_education_done','consent_forms_signed',
] as const;

function requireDischargePlanningRole(role: string | undefined): void {
  if (!role || !['doctor', 'nurse', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized for discharge planning' });
  }
}

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

dischargePlanning.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'discharged' THEN 1 ELSE 0 END) as discharged
    FROM discharge_checklists WHERE tenant_id = ?
  `).bind(tenantId).first();

  return c.json(stats ?? {});
});

// ─── List ────────────────────────────────────────────────────────────────────

dischargePlanning.get('/', zValidator('query', z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['dc.tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (status) { conds.push('dc.status = ?'); params.push(status); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM discharge_checklists dc WHERE ${where}`).bind(...params).first<{ cnt: number }>();

  const { results } = await db.$client.prepare(`
    SELECT dc.*, p.name as patient_name, p.patient_code, a.admission_no, b.ward_name
    FROM discharge_checklists dc
    LEFT JOIN patients p ON dc.patient_id = p.id
    LEFT JOIN admissions a ON dc.admission_id = a.id
    LEFT JOIN beds b ON a.bed_id = b.id
    WHERE ${where}
    ORDER BY dc.updated_at DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results ?? [], pagination: { page, limit, total: total?.cnt ?? 0 } });
});

// ─── Get by admission ────────────────────────────────────────────────────────

dischargePlanning.get('/admission/:admissionId', async (c) => {
  const tenantId = requireTenantId(c);
  const admissionId = Number(c.req.param('admissionId'));
  const db = getDb(c.env.DB);

  const dc = await db.$client.prepare('SELECT * FROM discharge_checklists WHERE admission_id = ? AND tenant_id = ?').bind(admissionId, tenantId).first();
  if (!dc) return c.json({ data: null });
  return c.json({ data: dc });
});

// ─── Detail ──────────────────────────────────────────────────────────────────

dischargePlanning.get('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);

  const dc = await db.$client.prepare(`
    SELECT dc.*, p.name as patient_name, p.patient_code, p.mobile as patient_phone,
           a.admission_no, a.admission_date, a.provisional_diagnosis
    FROM discharge_checklists dc
    LEFT JOIN patients p ON dc.patient_id = p.id
    LEFT JOIN admissions a ON dc.admission_id = a.id
    WHERE dc.id = ? AND dc.tenant_id = ?
  `).bind(id, tenantId).first();
  if (!dc) throw new HTTPException(404, { message: 'Discharge plan not found' });

  // Calculate checklist progress
  let done = 0;
  for (const item of CHECKLIST_ITEMS) {
    if ((dc as Record<string, unknown>)[item]) done++;
  }

  return c.json({ ...dc, checklist_progress: { done, total: CHECKLIST_ITEMS.length, percent: Math.round((done / CHECKLIST_ITEMS.length) * 100) } });
});

// ─── Create / Initialize ─────────────────────────────────────────────────────

dischargePlanning.post('/', zValidator('json', z.object({
  admission_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  planned_discharge_date: z.string().optional(),
  discharge_type: z.enum(DC_TYPE).default('normal'),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireDischargePlanningRole(c.get('role'));
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Check if already exists
  const existing = await db.$client.prepare('SELECT id FROM discharge_checklists WHERE admission_id = ? AND tenant_id = ?').bind(d.admission_id, tenantId).first();
  if (existing) throw new HTTPException(400, { message: 'Discharge plan already exists for this admission' });

  const r = await db.$client.prepare(`
    INSERT INTO discharge_checklists (tenant_id, admission_id, patient_id, planned_discharge_date, discharge_type, created_by)
    VALUES (?,?,?,?,?,?)
  `).bind(tenantId, d.admission_id, d.patient_id, d.planned_discharge_date ?? null, d.discharge_type, userId).run();

  return c.json({ message: 'Discharge plan initiated', id: r.meta.last_row_id }, 201);
});

// ─── Update checklist items ──────────────────────────────────────────────────

dischargePlanning.put('/:id/checklist', zValidator('json', z.object({
  vitals_stable: z.boolean().optional(),
  medications_reconciled: z.boolean().optional(),
  prescriptions_printed: z.boolean().optional(),
  lab_results_reviewed: z.boolean().optional(),
  pending_tests_cleared: z.boolean().optional(),
  diet_instructions_given: z.boolean().optional(),
  wound_care_instructions: z.boolean().optional(),
  follow_up_scheduled: z.boolean().optional(),
  referrals_arranged: z.boolean().optional(),
  insurance_clearance: z.boolean().optional(),
  billing_cleared: z.boolean().optional(),
  belongings_returned: z.boolean().optional(),
  transport_arranged: z.boolean().optional(),
  patient_education_done: z.boolean().optional(),
  consent_forms_signed: z.boolean().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  requireDischargePlanningRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const updates: string[] = ["updated_at = datetime('now', '+6 hours')"]; const params: (string | number)[] = [];
  for (const item of CHECKLIST_ITEMS) {
    if ((body as Record<string, unknown>)[item] !== undefined) {
      updates.push(`${item} = ?`);
      params.push((body as Record<string, unknown>)[item] ? 1 : 0);
    }
  }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE discharge_checklists SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  // Auto-check if all items done → set status to 'ready'
  const dc = await db.$client.prepare('SELECT * FROM discharge_checklists WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
  if (dc && dc.status === 'in_progress') {
    const allDone = CHECKLIST_ITEMS.every(item => dc[item]);
    if (allDone) {
      await db.$client.prepare("UPDATE discharge_checklists SET status = 'ready', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
    }
  }

  return c.json({ message: 'Checklist updated' });
});

// ─── Update medication reconciliation + instructions ─────────────────────────

dischargePlanning.put('/:id/medications', zValidator('json', z.object({
  discharge_medications: z.array(z.object({ name: z.string(), dose: z.string(), frequency: z.string(), duration: z.string().optional(), notes: z.string().optional() })).optional(),
  stopped_medications: z.array(z.object({ name: z.string(), reason: z.string() })).optional(),
  new_medications: z.array(z.object({ name: z.string(), dose: z.string(), frequency: z.string(), reason: z.string().optional() })).optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  requireDischargePlanningRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const updates: string[] = ["updated_at = datetime('now', '+6 hours')"]; const params: (string | number | null)[] = [];
  if (body.discharge_medications) { updates.push('discharge_medications = ?'); params.push(JSON.stringify(body.discharge_medications)); }
  if (body.stopped_medications) { updates.push('stopped_medications = ?'); params.push(JSON.stringify(body.stopped_medications)); }
  if (body.new_medications) { updates.push('new_medications = ?'); params.push(JSON.stringify(body.new_medications)); }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE discharge_checklists SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Medications updated' });
});

// ─── Update instructions + follow-up ─────────────────────────────────────────

dischargePlanning.put('/:id/instructions', zValidator('json', z.object({
  activity_restrictions: z.string().optional(),
  dietary_instructions: z.string().optional(),
  wound_care_notes: z.string().optional(),
  warning_signs: z.string().optional(),
  emergency_contact_info: z.string().optional(),
  follow_up_appointments: z.array(z.object({ date: z.string(), doctor: z.string().optional(), department: z.string().optional(), notes: z.string().optional() })).optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  requireDischargePlanningRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const updates: string[] = ["updated_at = datetime('now', '+6 hours')"]; const params: (string | number | null)[] = [];
  const fields = ['activity_restrictions','dietary_instructions','wound_care_notes','warning_signs','emergency_contact_info'];
  for (const f of fields) { if ((body as Record<string, unknown>)[f] !== undefined) { updates.push(`${f} = ?`); params.push(String((body as Record<string, unknown>)[f])); } }
  if (body.follow_up_appointments) { updates.push('follow_up_appointments = ?'); params.push(JSON.stringify(body.follow_up_appointments)); }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE discharge_checklists SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Instructions updated' });
});

// ─── Status update (approve, discharge) ──────────────────────────────────────

dischargePlanning.put('/:id/status', zValidator('json', z.object({
  status: z.enum(DC_STATUS),
  actual_discharge_date: z.string().optional(),
  discharge_type: z.enum(DC_TYPE).optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireDischargePlanningRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = getFullTimestampGMT6();
  const today = getTodayGMT6();
  let dcForStatus: Record<string, unknown> | null = null;

  // For approval or discharge, verify all checklist items are complete
  if (body.status === 'approved' || body.status === 'discharged') {
    const dc = await db.$client.prepare('SELECT * FROM discharge_checklists WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
    if (!dc) throw new HTTPException(404, { message: 'Discharge plan not found' });
    dcForStatus = dc;

    // Against medical advice or expired/absconded can skip checklist
    const skipChecklist = body.discharge_type && ['against_medical_advice', 'expired', 'absconded'].includes(body.discharge_type);
    if (!skipChecklist) {
      const incomplete = CHECKLIST_ITEMS.filter(item => !dc[item]);
      if (incomplete.length > 0) {
        throw new HTTPException(400, { message: `Cannot ${body.status}: ${incomplete.length} checklist items pending (${incomplete.slice(0, 3).join(', ')}${incomplete.length > 3 ? '...' : ''})` });
      }
    }
  }

  const dischargeDate = body.actual_discharge_date ?? today;
  let admissionForDischarge: {
    id: number;
    bed_id: number | null;
    patient_id: number;
    admission_date: string | null;
  } | null = null;

  if (body.status === 'discharged') {
    if (!dcForStatus) {
      dcForStatus = await db.$client.prepare('SELECT * FROM discharge_checklists WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
      if (!dcForStatus) throw new HTTPException(404, { message: 'Discharge plan not found' });
    }

    admissionForDischarge = await db.$client.prepare(`
      SELECT id, bed_id, patient_id, admission_date
      FROM admissions
      WHERE id = ? AND tenant_id = ? AND status IN ('admitted','critical')
    `).bind(Number(dcForStatus.admission_id), tenantId).first<{
      id: number;
      bed_id: number | null;
      patient_id: number;
      admission_date: string | null;
    }>();
    if (!admissionForDischarge) throw new HTTPException(404, { message: 'Active admission not found' });

    await assertAccountingPeriodOpen(c.env.DB, tenantId, dischargeDate, 'Discharge planning final discharge');
    await assertNoPendingDischargeBilling(
      db.$client,
      tenantId,
      admissionForDischarge.id,
      admissionForDischarge.patient_id,
      admissionForDischarge.admission_date,
    );
  }

  const updates: string[] = ['status = ?', "updated_at = datetime('now', '+6 hours')"]; const params: (string | number | null)[] = [body.status];
  if (body.status === 'approved') { updates.push('approved_by = ?', 'approved_at = ?'); params.push(userId, now); }
  if (body.status === 'discharged') { updates.push('actual_discharge_date = ?'); params.push(dischargeDate); }
  if (body.discharge_type) { updates.push('discharge_type = ?'); params.push(body.discharge_type); }
  params.push(id, tenantId);

  if (body.status === 'discharged') {
    const batch: D1PreparedStatement[] = [
      db.$client.prepare(`UPDATE discharge_checklists SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params),
      db.$client.prepare(`
        UPDATE admissions
        SET status = 'discharged', discharge_date = ?, discharge_type = COALESCE(?, discharge_type),
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(dischargeDate, body.discharge_type ?? null, admissionForDischarge!.id, tenantId),
      db.$client.prepare(`
        UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
          days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
          charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
        WHERE tenant_id = ? AND admission_id = ? AND ended_on IS NULL
      `).bind(tenantId, admissionForDischarge!.id),
    ];
    if (admissionForDischarge?.bed_id) {
      batch.push(db.$client.prepare("UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?").bind(admissionForDischarge.bed_id, tenantId));
    }
    await db.$client.batch(batch);
    await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'discharge_checklists', id, null, {
      action: 'discharge_planning_final_discharge',
      admission_id: admissionForDischarge!.id,
      discharge_type: body.discharge_type ?? null,
      discharge_date: dischargeDate,
    });
  } else {
    await db.$client.prepare(`UPDATE discharge_checklists SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  }

  return c.json({ message: `Discharge ${body.status}` });
});

export default dischargePlanning;

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';


const discharge = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const upsertSummarySchema = z.object({
  template_id:             z.number().int().positive().optional(),
  admission_diagnosis:    z.string().optional(),
  final_diagnosis:        z.string().optional(),
  provisional_diagnosis:  z.string().optional(),
  treatment_summary:      z.string().optional(),
  procedures_performed:   z.array(z.string()).optional(),
  medicines_on_discharge: z.array(z.object({
    name:      z.string(),
    dose:      z.string().optional(),
    frequency: z.string().optional(),
    duration:  z.string().optional(),
  })).optional(),
  follow_up_date:         z.string().optional(),
  follow_up_instructions: z.string().optional(),
  doctor_notes:           z.string().optional(),
  chief_complaint:        z.string().optional(),
  presenting_illness:     z.string().optional(),
  hospital_course:        z.string().optional(),
  clinical_findings:      z.string().optional(),
  past_history:           z.string().optional(),
  pending_reports:        z.string().optional(),
  operative_procedure:    z.string().optional(),
  operative_findings:     z.string().optional(),
  histology_report:       z.string().optional(),
  special_notes:          z.string().optional(),
  allergies:              z.string().optional(),
  activities:             z.string().optional(),
  diet:                   z.string().optional(),
  rest_days:              z.number().int().min(0).optional(),
  lab_results:            z.string().optional(),
  imaging_results:        z.string().optional(),
  lab_tests:              z.array(z.string()).optional(),
  imaging_items:          z.array(z.string()).optional(),
  discharge_condition:    z.string().optional(),
  discharge_type:         z.string().optional(),
  status:                 z.enum(['draft', 'final']).optional(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(160),
  department: z.string().max(120).optional(),
  fields_json: z.record(z.unknown()).default({}),
  is_default: z.boolean().default(false),
});

const consultantSchema = z.object({
  consultant_id: z.number().int().positive(),
  role: z.string().max(80).default('consultant'),
});

// ─── Templates ────────────────────────────────────────────────────────────────

discharge.get('/templates/list', requireRole('hospital_admin', 'doctor', 'md', 'nurse', 'reception'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const department = c.req.query('department');
  let sql = `SELECT * FROM discharge_summary_templates WHERE tenant_id = ? AND is_active = 1`;
  const params: (string | number)[] = [String(tenantId)];
  if (department) { sql += ' AND (department = ? OR department IS NULL)'; params.push(department); }
  sql += ' ORDER BY is_default DESC, name';
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  const parsed = (results || []).map((r: any) => ({
    ...r,
    fields: r.fields_json ? JSON.parse(r.fields_json) : {},
  }));
  return c.json({ templates: parsed });
});

discharge.post('/templates', requireRole('hospital_admin', 'doctor', 'md'), zValidator('json', templateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO discharge_summary_templates (tenant_id, name, department, fields_json, is_default, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    String(tenantId),
    data.name,
    data.department ?? null,
    JSON.stringify(data.fields_json),
    data.is_default ? 1 : 0,
    userId ?? 'system',
  ).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

// ─── GET /api/discharge/:admissionId — get or init summary ────────────────────

discharge.get('/:admissionId', requireRole('hospital_admin', 'doctor', 'md', 'nurse', 'reception'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));

  // Get admission details for context
  const admission = await db.$client.prepare(`
    SELECT a.*, p.name as patient_name, p.patient_code, p.date_of_birth, p.gender,
           b.ward_name, b.bed_number,
           s.name as doctor_name,
           s.id as staff_id
    FROM admissions a
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    LEFT JOIN staff s ON s.id = a.doctor_id AND s.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(admissionId, tenantId).first<Record<string, unknown>>();

  if (!admission) {
    throw new HTTPException(404, { message: 'Admission not found' });
  }

  // Get discharge summary (may not exist yet)
  const summary = await db.$client.prepare(
    `SELECT * FROM discharge_summaries WHERE admission_id = ? AND tenant_id = ?`
  ).bind(admissionId, tenantId).first<Record<string, unknown>>();

  // Parse JSON fields if summary exists
  let parsedSummary = summary;
  if (summary) {
    try {
      parsedSummary = {
        ...summary,
        procedures_performed:   summary.procedures_performed
          ? JSON.parse(summary.procedures_performed as string)
          : [],
        medicines_on_discharge: summary.medicines_on_discharge
          ? JSON.parse(summary.medicines_on_discharge as string)
          : [],
        lab_tests: summary.lab_tests ? JSON.parse(summary.lab_tests as string) : [],
        imaging_items: summary.imaging_items ? JSON.parse(summary.imaging_items as string) : [],
      };
    } catch {
      // JSON parse failed — return raw
    }
  }

  let consultants: Record<string, unknown>[] = [];
  if (summary?.id) {
    const consultantResult = await db.$client.prepare(`
      SELECT dsc.*, COALESCE(s.name, d.name) AS consultant_name
      FROM discharge_summary_consultants dsc
      LEFT JOIN staff s ON s.id = dsc.consultant_id AND s.tenant_id = dsc.tenant_id
      LEFT JOIN doctors d ON d.id = dsc.consultant_id AND d.tenant_id = dsc.tenant_id
      WHERE dsc.tenant_id = ? AND dsc.discharge_summary_id = ?
      ORDER BY dsc.role, consultant_name
    `).bind(String(tenantId), summary.id).all();
    consultants = consultantResult.results || [];
  }

  return c.json({ admission, summary: parsedSummary ?? null, consultants });
});

// ─── PUT /api/discharge/:admissionId — create or update ──────────────────────

discharge.put('/:admissionId', requireRole('hospital_admin', 'doctor', 'md'), zValidator('json', upsertSummarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const safeUserId = requireUserId(c);
  const admissionId = parseInt(c.req.param('admissionId'));
  const data = c.req.valid('json');

  // Verify admission belongs to tenant
  const admission = await db.$client.prepare(
    `SELECT id, patient_id, status FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(admissionId, tenantId).first<{ id: number; patient_id: number; status: string }>();

  if (!admission) {
    throw new HTTPException(404, { message: 'Admission not found' });
  }

  if (data.status === 'final' && admission.status !== 'discharged') {
    throw new HTTPException(409, { message: 'Patient must be discharged before finalising discharge summary' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM discharge_summaries WHERE admission_id = ? AND tenant_id = ?`
  ).bind(admissionId, tenantId).first<{ id: number }>();

  const proceduresJson = data.procedures_performed !== undefined
    ? JSON.stringify(data.procedures_performed)
    : undefined;

  const medicinesJson = data.medicines_on_discharge !== undefined
    ? JSON.stringify(data.medicines_on_discharge)
    : undefined;
  const labTestsJson = data.lab_tests !== undefined
    ? JSON.stringify(data.lab_tests)
    : undefined;
  const imagingItemsJson = data.imaging_items !== undefined
    ? JSON.stringify(data.imaging_items)
    : undefined;

  const finalizedAt = data.status === 'final' ? new Date().toISOString() : null;

  if (!existing) {
    // INSERT
    await db.$client.prepare(`
      INSERT INTO discharge_summaries
        (tenant_id, admission_id, patient_id,
         template_id,
         admission_diagnosis, final_diagnosis, provisional_diagnosis, treatment_summary,
         procedures_performed, medicines_on_discharge,
         follow_up_date, follow_up_instructions, doctor_notes,
         chief_complaint, presenting_illness, hospital_course, clinical_findings,
         past_history, pending_reports, operative_procedure, operative_findings,
         histology_report, special_notes, allergies, activities, diet, rest_days,
         lab_results, imaging_results, lab_tests, imaging_items, discharge_condition, discharge_type,
         status, finalized_at, finalized_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, admissionId, admission.patient_id,
      data.template_id ?? null,
      data.admission_diagnosis ?? null,
      data.final_diagnosis ?? null,
      data.provisional_diagnosis ?? null,
      data.treatment_summary ?? null,
      proceduresJson ?? null,
      medicinesJson ?? null,
      data.follow_up_date ?? null,
      data.follow_up_instructions ?? null,
      data.doctor_notes ?? null,
      data.chief_complaint ?? null,
      data.presenting_illness ?? null,
      data.hospital_course ?? null,
      data.clinical_findings ?? null,
      data.past_history ?? null,
      data.pending_reports ?? null,
      data.operative_procedure ?? null,
      data.operative_findings ?? null,
      data.histology_report ?? null,
      data.special_notes ?? null,
      data.allergies ?? null,
      data.activities ?? null,
      data.diet ?? null,
      data.rest_days ?? null,
      data.lab_results ?? null,
      data.imaging_results ?? null,
      labTestsJson ?? null,
      imagingItemsJson ?? null,
      data.discharge_condition ?? null,
      data.discharge_type ?? null,
      data.status ?? 'draft',
      finalizedAt,
      finalizedAt ? safeUserId : null,
    ).run();
  } else {
    // UPDATE — only set fields that were provided
    const sets: string[] = ["updated_at = datetime('now', '+6 hours')"];
    const vals: (string | number | null)[] = [];

    if (data.template_id !== undefined)             { sets.push('template_id = ?');             vals.push(data.template_id); }
    if (data.admission_diagnosis !== undefined)    { sets.push('admission_diagnosis = ?');    vals.push(data.admission_diagnosis); }
    if (data.final_diagnosis !== undefined)        { sets.push('final_diagnosis = ?');        vals.push(data.final_diagnosis); }
    if (data.provisional_diagnosis !== undefined)  { sets.push('provisional_diagnosis = ?');  vals.push(data.provisional_diagnosis); }
    if (data.treatment_summary !== undefined)      { sets.push('treatment_summary = ?');      vals.push(data.treatment_summary); }
    if (proceduresJson !== undefined)              { sets.push('procedures_performed = ?');   vals.push(proceduresJson); }
    if (medicinesJson !== undefined)               { sets.push('medicines_on_discharge = ?'); vals.push(medicinesJson); }
    if (data.follow_up_date !== undefined)         { sets.push('follow_up_date = ?');         vals.push(data.follow_up_date); }
    if (data.follow_up_instructions !== undefined) { sets.push('follow_up_instructions = ?'); vals.push(data.follow_up_instructions); }
    if (data.doctor_notes !== undefined)           { sets.push('doctor_notes = ?');           vals.push(data.doctor_notes); }
    if (data.chief_complaint !== undefined)        { sets.push('chief_complaint = ?');        vals.push(data.chief_complaint); }
    if (data.presenting_illness !== undefined)     { sets.push('presenting_illness = ?');     vals.push(data.presenting_illness); }
    if (data.hospital_course !== undefined)        { sets.push('hospital_course = ?');        vals.push(data.hospital_course); }
    if (data.clinical_findings !== undefined)      { sets.push('clinical_findings = ?');      vals.push(data.clinical_findings); }
    if (data.past_history !== undefined)           { sets.push('past_history = ?');           vals.push(data.past_history); }
    if (data.pending_reports !== undefined)        { sets.push('pending_reports = ?');        vals.push(data.pending_reports); }
    if (data.operative_procedure !== undefined)    { sets.push('operative_procedure = ?');    vals.push(data.operative_procedure); }
    if (data.operative_findings !== undefined)     { sets.push('operative_findings = ?');     vals.push(data.operative_findings); }
    if (data.histology_report !== undefined)       { sets.push('histology_report = ?');       vals.push(data.histology_report); }
    if (data.special_notes !== undefined)          { sets.push('special_notes = ?');          vals.push(data.special_notes); }
    if (data.allergies !== undefined)              { sets.push('allergies = ?');              vals.push(data.allergies); }
    if (data.activities !== undefined)             { sets.push('activities = ?');             vals.push(data.activities); }
    if (data.diet !== undefined)                   { sets.push('diet = ?');                   vals.push(data.diet); }
    if (data.rest_days !== undefined)              { sets.push('rest_days = ?');              vals.push(data.rest_days); }
    if (data.lab_results !== undefined)            { sets.push('lab_results = ?');            vals.push(data.lab_results); }
    if (data.imaging_results !== undefined)        { sets.push('imaging_results = ?');        vals.push(data.imaging_results); }
    if (labTestsJson !== undefined)                 { sets.push('lab_tests = ?');              vals.push(labTestsJson); }
    if (imagingItemsJson !== undefined)             { sets.push('imaging_items = ?');          vals.push(imagingItemsJson); }
    if (data.discharge_condition !== undefined)    { sets.push('discharge_condition = ?');    vals.push(data.discharge_condition); }
    if (data.discharge_type !== undefined)         { sets.push('discharge_type = ?');         vals.push(data.discharge_type); }
    if (data.status !== undefined) {
      sets.push('status = ?');
      vals.push(data.status);
      if (data.status === 'final') {
        sets.push('finalized_at = ?', 'finalized_by = ?');
        vals.push(new Date().toISOString(), safeUserId);
      }
    }

    await db.$client.prepare(
      `UPDATE discharge_summaries SET ${sets.join(', ')} WHERE admission_id = ? AND tenant_id = ?`
    ).bind(...vals, admissionId, tenantId).run();
  }

  // Audit log
  await db.$client.prepare(`
    INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, details)
    VALUES (?, ?, 'upsert', 'discharge_summary', ?, ?)
  `).bind(tenantId, safeUserId, admissionId, `status=${data.status ?? 'draft'}`).run();

  return c.json({ success: true });
});

// POST /api/discharge/:admissionId/consultants — add consultant
discharge.post('/:admissionId/consultants', requireRole('hospital_admin', 'doctor', 'md'), zValidator('json', consultantSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));
  const data = c.req.valid('json');
  const summary = await db.$client.prepare(
    `SELECT id FROM discharge_summaries WHERE admission_id = ? AND tenant_id = ?`
  ).bind(admissionId, tenantId).first<{ id: number }>();
  if (!summary) throw new HTTPException(404, { message: 'Discharge summary not found' });

  await db.$client.prepare(`
    INSERT OR IGNORE INTO discharge_summary_consultants
      (tenant_id, discharge_summary_id, consultant_id, role)
    VALUES (?, ?, ?, ?)
  `).bind(String(tenantId), summary.id, data.consultant_id, data.role).run();
  return c.json({ success: true }, 201);
});

discharge.delete('/:admissionId/consultants/:consultantId', requireRole('hospital_admin', 'doctor', 'md'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));
  const consultantId = parseInt(c.req.param('consultantId'));
  const summary = await db.$client.prepare(
    `SELECT id FROM discharge_summaries WHERE admission_id = ? AND tenant_id = ?`
  ).bind(admissionId, tenantId).first<{ id: number }>();
  if (!summary) throw new HTTPException(404, { message: 'Discharge summary not found' });
  await db.$client.prepare(`
    DELETE FROM discharge_summary_consultants
    WHERE tenant_id = ? AND discharge_summary_id = ? AND consultant_id = ?
  `).bind(String(tenantId), summary.id, consultantId).run();
  return c.json({ success: true });
});

// GET /api/discharge/:admissionId/slip — printable discharge slip data
discharge.get('/:admissionId/slip', requireRole('hospital_admin', 'doctor', 'md', 'nurse', 'reception'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));

  const slip = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code, p.gender, p.date_of_birth, p.mobile, p.address, p.blood_group,
           b.ward_name, b.bed_number, b.bed_type,
           COALESCE(s.name, d.name) AS doctor_name,
           ds.admission_diagnosis, ds.final_diagnosis, ds.provisional_diagnosis AS summary_provisional_diagnosis,
           ds.treatment_summary, ds.procedures_performed, ds.medicines_on_discharge,
           ds.follow_up_date, ds.follow_up_instructions, ds.doctor_notes,
           ds.discharge_condition, ds.discharge_type AS summary_discharge_type,
           dct.name AS discharge_condition_name
    FROM admissions a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    LEFT JOIN staff s ON s.id = a.doctor_id AND s.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN discharge_summaries ds ON ds.admission_id = a.id AND ds.tenant_id = a.tenant_id
    LEFT JOIN discharge_condition_types dct ON dct.id = a.discharge_condition_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(admissionId, tenantId).first<Record<string, unknown>>();

  if (!slip) throw new HTTPException(404, { message: 'Admission not found' });
  try {
    if (slip.procedures_performed) slip.procedures_performed = JSON.parse(String(slip.procedures_performed));
    if (slip.medicines_on_discharge) slip.medicines_on_discharge = JSON.parse(String(slip.medicines_on_discharge));
  } catch {
    // Keep raw JSON if parsing fails.
  }

  return c.json({ slip });
});

export default discharge;

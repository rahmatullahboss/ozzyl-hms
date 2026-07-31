import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createClinicalInfoSchema, updateClinicalInfoSchema,
  createPreferenceSchema, checkInSchema, checkOutSchema,
  exchangeDoctorSchema, freeReferralSchema, opdReferSchema, finalDiagnosisSchema,
  opdVisitsQuerySchema, clinicalInfoQuerySchema, favoritesQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const opdRoutes = new Hono<NursingEnv>();

// ─── GET /visits — List OPD visits for date range ─────────────────────────────
opdRoutes.get('/visits', zValidator('query', opdVisitsQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from_date, to_date, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  const { results } = await db.$client.prepare(`
    SELECT v.*, p.name AS patient_name, p.patient_code, p.gender, p.mobile,
           d.name AS doctor_name
    FROM visits v
    JOIN patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
    LEFT JOIN doctors d ON d.id = v.doctor_id
    WHERE v.tenant_id = ? AND v.visit_type = 'opd'
      AND DATE(v.visit_date) BETWEEN ? AND ?
    ORDER BY v.visit_date DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from_date, to_date, limit, offset).all();

  const count = await db.$client.prepare(`
    SELECT COUNT(*) as total FROM visits
    WHERE tenant_id = ? AND visit_type = 'opd'
      AND DATE(visit_date) BETWEEN ? AND ?
  `).bind(tenantId, from_date, to_date).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// ─── Clinical Info (Triage) ───────────────────────────────────────────────────
opdRoutes.get('/clinical-info', zValidator('query', clinicalInfoQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { visit_id } = c.req.valid('query');
  const { results } = await db.$client.prepare(
    'SELECT * FROM cln_patient_clinical_info WHERE tenant_id = ? AND visit_id = ? AND is_active = 1 ORDER BY id'
  ).bind(tenantId, visit_id).all();
  return c.json({ Results: results });
});

opdRoutes.post('/clinical-info', zValidator('json', createClinicalInfoSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO cln_patient_clinical_info (tenant_id, patient_id, visit_id, key_name, value, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.patient_id, data.visit_id, data.key_name, data.value, userId).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

opdRoutes.put('/clinical-info/:id', zValidator('json', updateClinicalInfoSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM cln_patient_clinical_info WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.value !== undefined) { fields.push('value = ?'); values.push(data.value); }
  if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active); }
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, id, tenantId);
    await db.$client.prepare(`UPDATE cln_patient_clinical_info SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }
  return c.json({ Results: true });
});

// ─── Employee Preferences (Nurse Favorites) ──────────────────────────────────
opdRoutes.get('/favorites', zValidator('query', favoritesQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { employee_id } = c.req.valid('query');
  const result = await db.$client.prepare(
    'SELECT * FROM emp_employee_preferences WHERE tenant_id = ? AND employee_id = ? AND is_active = 1'
  ).bind(tenantId, employee_id).first();
  return c.json({ Results: result || null });
});

opdRoutes.post('/favorites', zValidator('json', createPreferenceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const employeeId = data.employee_id;

  // Upsert: check if preference exists
  const existing = await db.$client.prepare(
    'SELECT id FROM emp_employee_preferences WHERE tenant_id = ? AND employee_id = ? AND preference_name = ? AND is_active = 1'
  ).bind(tenantId, employeeId, 'NursingPatientPreferences').first<{ id: number }>();

  if (existing) {
    await db.$client.prepare(
      "UPDATE emp_employee_preferences SET preference_value = ?, updated_by = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
    ).bind(data.preference_value, userId, existing.id, tenantId).run();
    return c.json({ Results: { id: existing.id, updated: true } });
  }

  const result = await db.$client.prepare(`
    INSERT INTO emp_employee_preferences (tenant_id, employee_id, preference_name, preference_value, created_by)
    VALUES (?, ?, 'NursingPatientPreferences', ?, ?)
  `).bind(tenantId, employeeId, data.preference_value, userId).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Check-in ─────────────────────────────────────────────────────────────────
opdRoutes.put('/check-in', zValidator('json', checkInSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { visit_id, chief_complaint } = c.req.valid('json');
  const existing = await db.$client.prepare('SELECT 1 FROM visits WHERE id = ? AND tenant_id = ?').bind(visit_id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Visit not found' });
  const now = new Date().toISOString();
  if (chief_complaint) {
    await db.$client.prepare(
      "UPDATE visits SET status = 'checked-in', chief_complaint = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
    ).bind(chief_complaint, now, visit_id, tenantId).run();
  } else {
    await db.$client.prepare(
      "UPDATE visits SET status = 'checked-in', updated_at = ? WHERE id = ? AND tenant_id = ?"
    ).bind(now, visit_id, tenantId).run();
  }
  return c.json({ Results: true });
});

// ─── Check-out ────────────────────────────────────────────────────────────────
opdRoutes.put('/check-out', zValidator('json', checkOutSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { visit_id, visit_status } = c.req.valid('json');
  const existing = await db.$client.prepare('SELECT 1 FROM visits WHERE id = ? AND tenant_id = ?').bind(visit_id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Visit not found' });
  const now = new Date().toISOString();
  await db.$client.prepare(
    'UPDATE visits SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
  ).bind(visit_status ?? 'concluded', now, visit_id, tenantId).run();
  return c.json({ Results: true });
});

// ─── Exchange Doctor ──────────────────────────────────────────────────────────
opdRoutes.put('/exchange-doctor', zValidator('json', exchangeDoctorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { visit_id, performer_id, performer_name } = c.req.valid('json');
  const existing = await db.$client.prepare('SELECT 1 FROM visits WHERE id = ? AND tenant_id = ?').bind(visit_id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Visit not found' });
  const now = new Date().toISOString();
  await db.$client.prepare(
    'UPDATE visits SET doctor_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
  ).bind(performer_id, now, visit_id, tenantId).run();
  return c.json({ Results: true, performer_name });
});

// ─── Final Diagnosis by Nurse ────────────────────────────────────────────────
opdRoutes.post('/final-diagnosis', zValidator('json', finalDiagnosisSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const visit = await db.$client.prepare(
    'SELECT patient_id FROM visits WHERE id = ? AND tenant_id = ?'
  ).bind(data.visit_id, tenantId).first<{ patient_id: number }>();
  if (!visit) throw new HTTPException(404, { message: 'Visit not found' });
  if (visit.patient_id !== data.patient_id) throw new HTTPException(400, { message: 'Patient does not match visit' });

  await db.$client.prepare(`
    INSERT INTO nursing_final_diagnoses
      (tenant_id, visit_id, patient_id, final_diagnosis, icd10_code, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, visit_id) DO UPDATE SET
      final_diagnosis = excluded.final_diagnosis,
      icd10_code = excluded.icd10_code,
      recorded_by = excluded.recorded_by,
      updated_at = datetime('now', '+6 hours')
  `).bind(String(tenantId), data.visit_id, data.patient_id, data.final_diagnosis, data.icd10_code ?? null, userId ?? 'system').run();

  await db.$client.prepare(`
    UPDATE visits SET notes = COALESCE(notes || char(10), '') || ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(`Final diagnosis: ${data.final_diagnosis}`, new Date().toISOString(), data.visit_id, tenantId).run();

  return c.json({ Results: true }, 201);
});

// ─── OPD Referral / Exchange Department ──────────────────────────────────────
opdRoutes.post('/refer', zValidator('json', opdReferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const visit = await db.$client.prepare(
    'SELECT patient_id, doctor_id FROM visits WHERE id = ? AND tenant_id = ?'
  ).bind(data.visit_id, tenantId).first<{ patient_id: number; doctor_id: number | null }>();
  if (!visit) throw new HTTPException(404, { message: 'Visit not found' });

  const result = await db.$client.prepare(`
    INSERT INTO nursing_opd_referrals
      (tenant_id, visit_id, patient_id, from_doctor_id, to_doctor_id, to_department_id, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    String(tenantId), data.visit_id, visit.patient_id, visit.doctor_id ?? null,
    data.to_doctor_id ?? null, data.to_department_id ?? null, data.reason ?? null, userId ?? 'system',
  ).run();

  if (data.to_doctor_id) {
    await db.$client.prepare(
      'UPDATE visits SET doctor_id = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    ).bind(data.to_doctor_id, 'referred', new Date().toISOString(), data.visit_id, tenantId).run();
  } else {
    await db.$client.prepare(
      'UPDATE visits SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    ).bind('referred', new Date().toISOString(), data.visit_id, tenantId).run();
  }

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Free Referral ────────────────────────────────────────────────────────────
opdRoutes.post('/referral', zValidator('json', freeReferralSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO visits (tenant_id, patient_id, visit_date, visit_type, status, doctor_id, created_at)
    VALUES (?, ?, ?, 'opd', 'initiated', ?, ?)
  `).bind(tenantId, data.patient_id, now.split('T')[0], data.referred_by_id, now).run();

  return c.json({ Results: { visit_id: result.meta.last_row_id } }, 201);
});

// ─── Billing / Lab Info helpers ───────────────────────────────────────────────
opdRoutes.get('/billing-info/:visitId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const visitId = parseInt(c.req.param('visitId'));
  if (isNaN(visitId)) throw new HTTPException(400, { message: 'Invalid visit ID' });
  const { results } = await db.$client.prepare(
    'SELECT * FROM billing WHERE tenant_id = ? AND visit_id = ? ORDER BY created_at DESC'
  ).bind(tenantId, visitId).all();
  return c.json({ Results: results });
});

opdRoutes.get('/lab-info/:visitId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const visitId = parseInt(c.req.param('visitId'));
  if (isNaN(visitId)) throw new HTTPException(400, { message: 'Invalid visit ID' });
  const { results } = await db.$client.prepare(
    'SELECT * FROM test_results WHERE tenant_id = ? AND visit_id = ? ORDER BY created_at DESC'
  ).bind(tenantId, visitId).all();
  return c.json({ Results: results });
});

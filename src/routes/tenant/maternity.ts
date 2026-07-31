import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type MaternityEnv = { Bindings: Env; Variables: Variables };

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

const maternityPatientSchema = z.object({
  patient_id: z.number().int().positive(),
  husband_name: z.string().max(200).optional(),
  height_cm: z.number().positive().optional(),
  weight_kg: z.number().positive().optional(),
  last_menstrual_period: z.string().optional(),
  expected_delivery_date: z.string().optional(),
  gravida: z.number().int().min(0).optional(),
  para: z.number().int().min(0).optional(),
  abortions: z.number().int().min(0).optional(),
  living_children: z.number().int().min(0).optional(),
  place_of_delivery: z.string().optional(),
  presentation: z.string().optional(),
  complications: z.string().optional(),
  delivery_date: z.string().optional(),
  delivery_type: z.string().optional(),
  delivery_outcome_mother: z.string().optional(),
  delivery_outcome_baby: z.string().optional(),
  obs_history: z.string().optional(),
  blood_group: z.string().optional(),
  rh_factor: z.string().optional(),
  hiv_status: z.string().optional(),
  syphilis_status: z.string().optional(),
  hepatitis_b_status: z.string().optional(),
});

const ancSchema = z.object({
  maternity_patient_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  visit_number: z.number().int().positive(),
  visit_date: z.string(),
  visit_place: z.string().optional(),
  pregnancy_weeks: z.number().int().min(1).max(45).optional(),
  weight_kg: z.number().positive().optional(),
  blood_pressure: z.string().optional(),
  pulse: z.number().int().min(1).optional(),
  fundal_height_cm: z.number().positive().optional(),
  fetal_heart_rate: z.number().int().min(1).optional(),
  fetal_movement: z.number().int().min(0).optional(),
  hemoglobin: z.number().positive().optional(),
  urine_albumin: z.string().optional(),
  urine_sugar: z.string().optional(),
  condition_notes: z.string().optional(),
  risk_factors: z.string().optional(),
  medications_given: z.string().optional(),
  tt_injection_given: z.number().int().min(0).max(1).optional(),
  tt_injection_dose: z.string().optional(),
  iron_folate_given: z.number().int().min(0).max(1).optional(),
  next_visit_date: z.string().optional(),
});

const deliverySchema = z.object({
  maternity_patient_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  admission_id: z.number().int().positive().optional(),
  delivery_date: z.string(),
  delivery_time: z.string().optional(),
  delivery_type: z.string(),
  delivery_place: z.string().optional(),
  conducted_by: z.string().optional(),
  delivery_complications: z.string().optional(),
  anesthesia_used: z.string().optional(),
  episiotomy_given: z.number().int().min(0).max(1).optional(),
  placenta_complete: z.number().int().min(0).max(1).optional(),
  blood_loss_ml: z.number().int().min(0).optional(),
  postpartum_condition: z.string().optional(),
  mother_outcome: z.string().optional(),
  mother_disposition: z.string().optional(),
  discharge_date: z.string().optional(),
});

const newbornSchema = z.object({
  maternity_patient_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  delivery_id: z.number().int().positive(),
  baby_number: z.number().int().positive().optional(),
  birth_weight_g: z.number().int().positive().optional(),
  birth_length_cm: z.number().positive().optional(),
  head_circumference_cm: z.number().positive().optional(),
  chest_circumference_cm: z.number().positive().optional(),
  apgar_score_1min: z.number().int().min(0).max(10).optional(),
  apgar_score_5min: z.number().int().min(0).max(10).optional(),
  apgar_score_10min: z.number().int().min(0).max(10).optional(),
  sex: z.string().optional(),
  baby_condition: z.string().optional(),
  resuscitation_needed: z.number().int().min(0).max(1).optional(),
  resuscitation_method: z.string().optional(),
  breastfed_within_hour: z.number().int().min(0).max(1).optional(),
  vitamin_k_given: z.number().int().min(0).max(1).optional(),
  bcg_given: z.number().int().min(0).max(1).optional(),
  opv_given: z.number().int().min(0).max(1).optional(),
  hep_b_given: z.number().int().min(0).max(1).optional(),
  congenital_abnormalities: z.string().optional(),
  baby_outcome: z.string().optional(),
  baby_discharge_date: z.string().optional(),
});

const pncSchema = z.object({
  maternity_patient_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  delivery_id: z.number().int().positive().optional(),
  visit_day: z.number().int().positive(),
  visit_date: z.string(),
  mother_condition: z.string().optional(),
  mother_bp: z.string().optional(),
  mother_temperature: z.number().positive().optional(),
  mother_pallor: z.string().optional(),
  breast_condition: z.string().optional(),
  uterus_involution: z.string().optional(),
  lochia: z.string().optional(),
  perineum_condition: z.string().optional(),
  family_planning_counselled: z.number().int().min(0).max(1).optional(),
  family_planning_method: z.string().optional(),
  baby_condition: z.string().optional(),
  baby_weight_g: z.number().int().positive().optional(),
  baby_feeding_method: z.string().optional(),
  baby_jaundice: z.number().int().min(0).max(1).optional(),
  baby_infection_signs: z.number().int().min(0).max(1).optional(),
  baby_immunization_status: z.string().optional(),
  complications: z.string().optional(),
  referred: z.number().int().min(0).max(1).optional(),
  referred_to: z.string().optional(),
  next_visit_date: z.string().optional(),
});

const maternityRoutes = new Hono<MaternityEnv>();

// ═══════════════════════════════════════════════════════════════════════════════
// MATERNITY PATIENTS
// ═══════════════════════════════════════════════════════════════════════════════

maternityRoutes.get('/patients', zValidator('query', querySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, search, status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let sql = `
    SELECT mp.*, p.name as patient_name, p.patient_code, p.date_of_birth, p.mobile, p.gender
    FROM maternity_patients mp
    JOIN patients p ON p.id = mp.patient_id AND p.tenant_id = mp.tenant_id
    WHERE mp.tenant_id = ? AND mp.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (search) {
    sql += ` AND (p.name LIKE ? OR p.patient_code LIKE ? OR mp.husband_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status === 'active') {
    sql += ` AND mp.is_concluded = 0`;
  } else if (status === 'concluded') {
    sql += ` AND mp.is_concluded = 1`;
  }

  sql += ` ORDER BY mp.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  let countSql = `SELECT COUNT(*) as total FROM maternity_patients mp JOIN patients p ON p.id = mp.patient_id AND p.tenant_id = mp.tenant_id WHERE mp.tenant_id = ? AND mp.is_active = 1`;
  const countParams: (string | number)[] = [tenantId];
  if (search) {
    countSql += ` AND (p.name LIKE ? OR p.patient_code LIKE ? OR mp.husband_name LIKE ?)`;
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status === 'active') countSql += ` AND mp.is_concluded = 0`;
  if (status === 'concluded') countSql += ` AND mp.is_concluded = 1`;

  const countResult = await db.$client.prepare(countSql).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: countResult?.total || 0 } });
});

maternityRoutes.get('/patients/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT mp.*, p.name as patient_name, p.patient_code, p.date_of_birth, p.mobile, p.gender
    FROM maternity_patients mp
    JOIN patients p ON p.id = mp.patient_id AND p.tenant_id = mp.tenant_id
    WHERE mp.id = ? AND mp.tenant_id = ? AND mp.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Maternity patient not found' });
  return c.json({ Results: result });
});

maternityRoutes.post('/patients', zValidator('json', maternityPatientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO maternity_patients
      (tenant_id, patient_id, husband_name, height_cm, weight_kg, last_menstrual_period, expected_delivery_date,
       gravida, para, abortions, living_children, place_of_delivery, presentation, complications,
       delivery_date, delivery_type, delivery_outcome_mother, delivery_outcome_baby, obs_history,
       blood_group, rh_factor, hiv_status, syphilis_status, hepatitis_b_status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.husband_name ?? null, data.height_cm ?? null, data.weight_kg ?? null,
    data.last_menstrual_period ?? null, data.expected_delivery_date ?? null,
    data.gravida ?? 0, data.para ?? 0, data.abortions ?? 0, data.living_children ?? 0,
    data.place_of_delivery ?? null, data.presentation ?? null, data.complications ?? null,
    data.delivery_date ?? null, data.delivery_type ?? null, data.delivery_outcome_mother ?? null,
    data.delivery_outcome_baby ?? null, data.obs_history ?? null,
    data.blood_group ?? null, data.rh_factor ?? null, data.hiv_status ?? null,
    data.syphilis_status ?? null, data.hepatitis_b_status ?? null, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

maternityRoutes.put('/patients/:id', zValidator('json', maternityPatientSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare('SELECT 1 FROM maternity_patients WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  const data = c.req.valid('json');
  const allowedFields = [
    'husband_name', 'height_cm', 'weight_kg', 'last_menstrual_period', 'expected_delivery_date',
    'gravida', 'para', 'abortions', 'living_children', 'place_of_delivery', 'presentation',
    'complications', 'delivery_date', 'delivery_type', 'delivery_outcome_mother',
    'delivery_outcome_baby', 'obs_history', 'blood_group', 'rh_factor', 'hiv_status',
    'syphilis_status', 'hepatitis_b_status', 'is_concluded', 'concluded_on', 'concluded_by',
  ];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, id, tenantId);
    await db.$client.prepare(`UPDATE maternity_patients SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ Results: true });
});

maternityRoutes.delete('/patients/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare("UPDATE maternity_patients SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANC VISITS
// ═══════════════════════════════════════════════════════════════════════════════

maternityRoutes.get('/patients/:id/anc', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const { results } = await db.$client.prepare(`
    SELECT * FROM maternity_anc_visits
    WHERE maternity_patient_id = ? AND tenant_id = ? AND is_active = 1
    ORDER BY visit_date DESC
  `).bind(id, tenantId).all();

  return c.json({ Results: results });
});

maternityRoutes.post('/anc', zValidator('json', ancSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO maternity_anc_visits
      (tenant_id, maternity_patient_id, patient_id, visit_number, visit_date, visit_place, pregnancy_weeks,
       weight_kg, blood_pressure, pulse, fundal_height_cm, fetal_heart_rate, fetal_movement, hemoglobin,
       urine_albumin, urine_sugar, condition_notes, risk_factors, medications_given, tt_injection_given,
       tt_injection_dose, iron_folate_given, next_visit_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.maternity_patient_id, data.patient_id, data.visit_number, data.visit_date,
    data.visit_place ?? null, data.pregnancy_weeks ?? null, data.weight_kg ?? null,
    data.blood_pressure ?? null, data.pulse ?? null, data.fundal_height_cm ?? null,
    data.fetal_heart_rate ?? null, data.fetal_movement ?? null, data.hemoglobin ?? null,
    data.urine_albumin ?? null, data.urine_sugar ?? null, data.condition_notes ?? null,
    data.risk_factors ?? null, data.medications_given ?? null, data.tt_injection_given ?? 0,
    data.tt_injection_dose ?? null, data.iron_folate_given ?? 0, data.next_visit_date ?? null, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

maternityRoutes.put('/anc/:ancId', zValidator('json', ancSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const ancId = parseInt(c.req.param('ancId'));
  if (isNaN(ancId)) throw new HTTPException(400, { message: 'Invalid ID' });

  const data = c.req.valid('json');
  const allowedFields = [
    'visit_number', 'visit_date', 'visit_place', 'pregnancy_weeks', 'weight_kg', 'blood_pressure',
    'pulse', 'fundal_height_cm', 'fetal_heart_rate', 'fetal_movement', 'hemoglobin',
    'urine_albumin', 'urine_sugar', 'condition_notes', 'risk_factors', 'medications_given',
    'tt_injection_given', 'tt_injection_dose', 'iron_folate_given', 'next_visit_date',
  ];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, ancId, tenantId);
    await db.$client.prepare(`UPDATE maternity_anc_visits SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ Results: true });
});

maternityRoutes.delete('/anc/:ancId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const ancId = parseInt(c.req.param('ancId'));
  if (isNaN(ancId)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare("UPDATE maternity_anc_visits SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(ancId, tenantId).run();
  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

maternityRoutes.get('/patients/:id/delivery', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const { results } = await db.$client.prepare(`
    SELECT * FROM maternity_delivery
    WHERE maternity_patient_id = ? AND tenant_id = ? AND is_active = 1
    ORDER BY delivery_date DESC
  `).bind(id, tenantId).all();

  return c.json({ Results: results });
});

maternityRoutes.post('/delivery', zValidator('json', deliverySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO maternity_delivery
      (tenant_id, maternity_patient_id, patient_id, admission_id, delivery_date, delivery_time, delivery_type,
       delivery_place, conducted_by, delivery_complications, anesthesia_used, episiotomy_given,
       placenta_complete, blood_loss_ml, postpartum_condition, mother_outcome, mother_disposition,
       discharge_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.maternity_patient_id, data.patient_id, data.admission_id ?? null,
    data.delivery_date, data.delivery_time ?? null, data.delivery_type,
    data.delivery_place ?? null, data.conducted_by ?? null, data.delivery_complications ?? null,
    data.anesthesia_used ?? null, data.episiotomy_given ?? 0, data.placenta_complete ?? 1,
    data.blood_loss_ml ?? null, data.postpartum_condition ?? null, data.mother_outcome ?? null,
    data.mother_disposition ?? null, data.discharge_date ?? null, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

maternityRoutes.put('/delivery/:deliveryId', zValidator('json', deliverySchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const deliveryId = parseInt(c.req.param('deliveryId'));
  if (isNaN(deliveryId)) throw new HTTPException(400, { message: 'Invalid ID' });

  const data = c.req.valid('json');
  const allowedFields = [
    'delivery_date', 'delivery_time', 'delivery_type', 'delivery_place', 'conducted_by',
    'delivery_complications', 'anesthesia_used', 'episiotomy_given', 'placenta_complete',
    'blood_loss_ml', 'postpartum_condition', 'mother_outcome', 'mother_disposition', 'discharge_date',
  ];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, deliveryId, tenantId);
    await db.$client.prepare(`UPDATE maternity_delivery SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ Results: true });
});

maternityRoutes.delete('/delivery/:deliveryId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const deliveryId = parseInt(c.req.param('deliveryId'));
  if (isNaN(deliveryId)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare("UPDATE maternity_delivery SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(deliveryId, tenantId).run();
  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEWBORN RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

maternityRoutes.get('/delivery/:deliveryId/newborns', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const deliveryId = parseInt(c.req.param('deliveryId'));
  if (isNaN(deliveryId)) throw new HTTPException(400, { message: 'Invalid ID' });

  const { results } = await db.$client.prepare(`
    SELECT * FROM maternity_newborns
    WHERE delivery_id = ? AND tenant_id = ? AND is_active = 1
    ORDER BY baby_number ASC
  `).bind(deliveryId, tenantId).all();

  return c.json({ Results: results });
});

maternityRoutes.post('/newborns', zValidator('json', newbornSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO maternity_newborns
      (tenant_id, maternity_patient_id, patient_id, delivery_id, baby_number, birth_weight_g, birth_length_cm,
       head_circumference_cm, chest_circumference_cm, apgar_score_1min, apgar_score_5min, apgar_score_10min,
       sex, baby_condition, resuscitation_needed, resuscitation_method, breastfed_within_hour, vitamin_k_given,
       bcg_given, opv_given, hep_b_given, congenital_abnormalities, baby_outcome, baby_discharge_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.maternity_patient_id, data.patient_id, data.delivery_id,
    data.baby_number ?? 1, data.birth_weight_g ?? null, data.birth_length_cm ?? null,
    data.head_circumference_cm ?? null, data.chest_circumference_cm ?? null,
    data.apgar_score_1min ?? null, data.apgar_score_5min ?? null, data.apgar_score_10min ?? null,
    data.sex ?? null, data.baby_condition ?? null, data.resuscitation_needed ?? 0,
    data.resuscitation_method ?? null, data.breastfed_within_hour ?? 0, data.vitamin_k_given ?? 0,
    data.bcg_given ?? 0, data.opv_given ?? 0, data.hep_b_given ?? 0,
    data.congenital_abnormalities ?? null, data.baby_outcome ?? null, data.baby_discharge_date ?? null, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

maternityRoutes.put('/newborns/:id', zValidator('json', newbornSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const data = c.req.valid('json');
  const allowedFields = [
    'baby_number', 'birth_weight_g', 'birth_length_cm', 'head_circumference_cm', 'chest_circumference_cm',
    'apgar_score_1min', 'apgar_score_5min', 'apgar_score_10min', 'sex', 'baby_condition',
    'resuscitation_needed', 'resuscitation_method', 'breastfed_within_hour', 'vitamin_k_given',
    'bcg_given', 'opv_given', 'hep_b_given', 'congenital_abnormalities', 'baby_outcome', 'baby_discharge_date',
  ];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, id, tenantId);
    await db.$client.prepare(`UPDATE maternity_newborns SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ Results: true });
});

maternityRoutes.delete('/newborns/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare("UPDATE maternity_newborns SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PNC VISITS
// ═══════════════════════════════════════════════════════════════════════════════

maternityRoutes.get('/patients/:id/pnc', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const { results } = await db.$client.prepare(`
    SELECT * FROM maternity_pnc_visits
    WHERE maternity_patient_id = ? AND tenant_id = ? AND is_active = 1
    ORDER BY visit_date DESC
  `).bind(id, tenantId).all();

  return c.json({ Results: results });
});

maternityRoutes.post('/pnc', zValidator('json', pncSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO maternity_pnc_visits
      (tenant_id, maternity_patient_id, patient_id, delivery_id, visit_day, visit_date, mother_condition,
       mother_bp, mother_temperature, mother_pallor, breast_condition, uterus_involution, lochia,
       perineum_condition, family_planning_counselled, family_planning_method, baby_condition,
       baby_weight_g, baby_feeding_method, baby_jaundice, baby_infection_signs, baby_immunization_status,
       complications, referred, referred_to, next_visit_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.maternity_patient_id, data.patient_id, data.delivery_id ?? null,
    data.visit_day, data.visit_date, data.mother_condition ?? null, data.mother_bp ?? null,
    data.mother_temperature ?? null, data.mother_pallor ?? null, data.breast_condition ?? null,
    data.uterus_involution ?? null, data.lochia ?? null, data.perineum_condition ?? null,
    data.family_planning_counselled ?? 0, data.family_planning_method ?? null,
    data.baby_condition ?? null, data.baby_weight_g ?? null, data.baby_feeding_method ?? null,
    data.baby_jaundice ?? 0, data.baby_infection_signs ?? 0, data.baby_immunization_status ?? null,
    data.complications ?? null, data.referred ?? 0, data.referred_to ?? null,
    data.next_visit_date ?? null, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

maternityRoutes.put('/pnc/:pncId', zValidator('json', pncSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const pncId = parseInt(c.req.param('pncId'));
  if (isNaN(pncId)) throw new HTTPException(400, { message: 'Invalid ID' });

  const data = c.req.valid('json');
  const allowedFields = [
    'visit_day', 'visit_date', 'mother_condition', 'mother_bp', 'mother_temperature', 'mother_pallor',
    'breast_condition', 'uterus_involution', 'lochia', 'perineum_condition', 'family_planning_counselled',
    'family_planning_method', 'baby_condition', 'baby_weight_g', 'baby_feeding_method', 'baby_jaundice',
    'baby_infection_signs', 'baby_immunization_status', 'complications', 'referred', 'referred_to', 'next_visit_date',
  ];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, pncId, tenantId);
    await db.$client.prepare(`UPDATE maternity_pnc_visits SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ Results: true });
});

maternityRoutes.delete('/pnc/:pncId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const pncId = parseInt(c.req.param('pncId'));
  if (isNaN(pncId)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare("UPDATE maternity_pnc_visits SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(pncId, tenantId).run();
  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════════════════════

maternityRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.slice(0, 7);

  const totalActive = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM maternity_patients WHERE tenant_id = ? AND is_active = 1 AND is_concluded = 0
  `).bind(tenantId).first<{ count: number }>();

  const totalRegistered = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM maternity_patients WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).first<{ count: number }>();

  const deliveriesThisMonth = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM maternity_delivery WHERE tenant_id = ? AND is_active = 1 AND delivery_date LIKE ?
  `).bind(tenantId, `${thisMonth}%`).first<{ count: number }>();

  const ancVisitsThisMonth = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM maternity_anc_visits WHERE tenant_id = ? AND is_active = 1 AND visit_date LIKE ?
  `).bind(tenantId, `${thisMonth}%`).first<{ count: number }>();

  const pncVisitsThisMonth = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM maternity_pnc_visits WHERE tenant_id = ? AND is_active = 1 AND visit_date LIKE ?
  `).bind(tenantId, `${thisMonth}%`).first<{ count: number }>();

  const dueThisWeek = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM maternity_patients
    WHERE tenant_id = ? AND is_active = 1 AND is_concluded = 0
      AND expected_delivery_date >= ? AND expected_delivery_date <= datetime(?, '+7 days')
  `).bind(tenantId, today, today).first<{ count: number }>();

  return c.json({
    Results: {
      total_active: totalActive?.count ?? 0,
      total_registered: totalRegistered?.count ?? 0,
      deliveries_this_month: deliveriesThisMonth?.count ?? 0,
      anc_visits_this_month: ancVisitsThisMonth?.count ?? 0,
      pnc_visits_this_month: pncVisitsThisMonth?.count ?? 0,
      due_this_week: dueThisWeek?.count ?? 0,
    },
  });
});

export default maternityRoutes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createDietTypeSchema, updateDietTypeSchema, createPatientDietSchema, dietSheetQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const dietSheetRoutes = new Hono<NursingEnv>();

// ─── Diet Types (Master) ─────────────────────────────────────────────────────

dietSheetRoutes.get('/types', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT id, tenant_id, diet_code, diet_name, display_order, created_at FROM nur_diet_types WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1 ORDER BY display_order, diet_name'
  ).bind(tenantId).all();
  return c.json({ Results: results });
});

dietSheetRoutes.post('/types', zValidator('json', createDietTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE tenant_id = ? AND diet_code = ? AND is_active = 1'
  ).bind(tenantId, data.diet_code).first();
  if (existing) throw new HTTPException(409, { message: 'Diet code already exists' });

  const result = await db.$client.prepare(`
    INSERT INTO nur_diet_types (tenant_id, diet_code, diet_name, display_order, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.diet_code, data.diet_name, data.display_order ?? 0, userId ?? 'system').run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

dietSheetRoutes.put('/types/:id', zValidator('json', updateDietTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.diet_code !== undefined) { fields.push('diet_code = ?'); values.push(data.diet_code); }
  if (data.diet_name !== undefined) { fields.push('diet_name = ?'); values.push(data.diet_name); }
  if (data.display_order !== undefined) { fields.push('display_order = ?'); values.push(data.display_order); }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')");
    values.push(id, tenantId);
    await db.$client.prepare(
      `UPDATE nur_diet_types SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();
  }

  return c.json({ Results: true });
});

dietSheetRoutes.delete('/types/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_diet_types SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Patient Diet Assignments ────────────────────────────────────────────────

dietSheetRoutes.get('/', zValidator('query', dietSheetQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, ward_id, patient_id, visit_id } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT pd.id, pd.tenant_id, pd.patient_id, pd.visit_id, pd.diet_type_id,
           pd.extra_diet, pd.ward_id, pd.remarks, pd.recorded_on, pd.created_at,
           dt.diet_code, dt.diet_name,
           p.name AS patient_name, p.patient_code,
           a.admission_date, a.status AS admission_status
    FROM nur_patient_diets pd
    JOIN nur_diet_types dt ON dt.id = pd.diet_type_id
    JOIN patients p ON p.id = pd.patient_id AND p.tenant_id = pd.tenant_id
    LEFT JOIN admissions a ON a.id = pd.visit_id AND a.tenant_id = pd.tenant_id
    WHERE pd.tenant_id = ? AND pd.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (ward_id) { query += ' AND pd.ward_id = ?'; params.push(ward_id); }
  if (patient_id) { query += ' AND pd.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND pd.visit_id = ?'; params.push(visit_id); }

  query += ' ORDER BY pd.recorded_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_patient_diets pd WHERE pd.tenant_id = ? AND pd.is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (ward_id) { countQuery += ' AND pd.ward_id = ?'; countParams.push(ward_id); }
  if (patient_id) { countQuery += ' AND pd.patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND pd.visit_id = ?'; countParams.push(visit_id); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

dietSheetRoutes.get('/history/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const { results } = await db.$client.prepare(`
    SELECT pd.id, pd.tenant_id, pd.patient_id, pd.visit_id, pd.diet_type_id,
           pd.extra_diet, pd.ward_id, pd.remarks, pd.recorded_on, pd.created_at,
           dt.diet_code, dt.diet_name
    FROM nur_patient_diets pd
    JOIN nur_diet_types dt ON dt.id = pd.diet_type_id
    WHERE pd.tenant_id = ? AND pd.patient_id = ? AND pd.is_active = 1
    ORDER BY pd.recorded_on DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

dietSheetRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT pd.id, pd.tenant_id, pd.patient_id, pd.visit_id, pd.diet_type_id,
           pd.extra_diet, pd.ward_id, pd.remarks, pd.recorded_on, pd.created_at,
           dt.diet_code, dt.diet_name,
           p.name AS patient_name, p.patient_code
    FROM nur_patient_diets pd
    JOIN nur_diet_types dt ON dt.id = pd.diet_type_id
    JOIN patients p ON p.id = pd.patient_id AND p.tenant_id = pd.tenant_id
    WHERE pd.id = ? AND pd.tenant_id = ? AND pd.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

dietSheetRoutes.post('/', zValidator('json', createPatientDietSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const dietType = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE id = ? AND (tenant_id = ? OR tenant_id = 0) AND is_active = 1'
  ).bind(data.diet_type_id, tenantId).first();
  if (!dietType) throw new HTTPException(404, { message: 'Diet type not found' });

  const result = await db.$client.prepare(`
    INSERT INTO nur_patient_diets
      (tenant_id, patient_id, visit_id, diet_type_id, extra_diet, ward_id, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.diet_type_id,
    data.extra_diet ?? null, data.ward_id ?? null, data.remarks ?? null, userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

dietSheetRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_patient_diets WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_patient_diets SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();

  return c.json({ Results: true });
});

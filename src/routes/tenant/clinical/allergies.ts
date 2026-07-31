import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createAllergySchema, updateAllergySchema } from '../../../schemas/clinicalAllergies';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const allergyRoutes = new Hono<ClinicalEnv>();

// ─── List allergies for a patient ──────────────────────────────────────────

allergyRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const type = c.req.query('type');

  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId query param is required' });

  let query = 'SELECT * FROM patient_allergies WHERE tenant_id = ? AND patient_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (type) {
    query += ' AND allergy_type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Get single allergy ────────────────────────────────────────────────────

allergyRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const row = await db.$client
    .prepare('SELECT * FROM patient_allergies WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Allergy not found' });
  return c.json({ Results: row });
});

// ─── Create allergy ────────────────────────────────────────────────────────

allergyRoutes.post('/', zValidator('json', createAllergySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');

  const existing = await db.$client
    .prepare(
      'SELECT id FROM patient_allergies WHERE tenant_id = ? AND patient_id = ? AND allergen = ? AND allergy_type = ? AND is_active = 1',
    )
    .bind(tenantId, d.patientId, d.allergen, d.allergyType).first();

  if (existing)
    throw new HTTPException(409, { message: 'This allergy already exists for the patient' });

  const result = await db.$client.prepare(`
    INSERT INTO patient_allergies (
      tenant_id, patient_id, allergy_type, allergen, severity,
      reaction, onset_date, notes, is_active, created_by, source,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'clinician', datetime('now', '+6 hours'))
  `).bind(
    tenantId, d.patientId, d.allergyType, d.allergen, d.severity ?? 'mild',
    d.reaction ?? null, d.onsetDate ?? null, d.notes ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Update allergy ────────────────────────────────────────────────────────

allergyRoutes.put('/:id', zValidator('json', updateAllergySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM patient_allergies WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Allergy not found' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    allergyType: 'allergy_type', allergen: 'allergen', severity: 'severity',
    reaction: 'reaction', onsetDate: 'onset_date', notes: 'notes',
  };

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && colMap[key]) {
      sets.push(`${colMap[key]} = ?`);
      vals.push(val as string | number);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    await db.$client
      .prepare(`UPDATE patient_allergies SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ Results: true });
});

// ─── Verify allergy (clinician verification) ───────────────────────────────

allergyRoutes.put('/:id/verify', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM patient_allergies WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Allergy not found' });

  await db.$client
    .prepare("UPDATE patient_allergies SET verified_by = ?, verified_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(userId, id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Soft delete allergy ───────────────────────────────────────────────────

allergyRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM patient_allergies WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Allergy not found' });

  await db.$client
    .prepare("UPDATE patient_allergies SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ Results: true });
});

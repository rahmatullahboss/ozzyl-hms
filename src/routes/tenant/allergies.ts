import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { markCardsStale } from '../../lib/health-card-utils';
import { clinicalReviewSchema } from '../../schemas/clinical-review';


const allergies = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createAllergySchema = z.object({
  patient_id: z.number().int().positive(),
  allergy_type: z.enum(['drug', 'food', 'environmental', 'other']),
  allergen: z.string().min(1),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).default('mild'),
  reaction: z.string().optional(),
  onset_date: z.string().optional(),
  notes: z.string().optional(),
  source: z.enum(['clinician', 'patient_reported', 'imported']).optional(),
});

const updateAllergySchema = z.object({
  allergy_type: z.enum(['drug', 'food', 'environmental', 'other']).optional(),
  allergen: z.string().min(1).optional(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).optional(),
  reaction: z.string().optional(),
  onset_date: z.string().optional(),
  notes: z.string().optional(),
  source: z.enum(['clinician', 'patient_reported', 'imported']).optional(),
  is_active: z.boolean().optional(),
});

// ─── GET / — list allergies for a patient ────────────────────────────────────

allergies.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');

  if (!patientId) throw new HTTPException(400, { message: 'patient_id required' });

  const { results } = await db.$client.prepare(`
    SELECT a.*, s.name as verified_by_name
    FROM patient_allergies a
    LEFT JOIN staff s ON a.verified_by = s.id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.patient_id = ? AND a.is_active = 1
    ORDER BY
      CASE a.severity WHEN 'life_threatening' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 WHEN 'mild' THEN 4 END,
      a.allergen
  `).bind(tenantId, patientId).all();

  return c.json({
    allergies: results,
    total: results.length,
    has_drug_allergies: results.some((a: any) => a.allergy_type === 'drug'),
    has_severe_allergies: results.some((a: any) => ['severe', 'life_threatening'].includes(a.severity)),
  });
});

// ─── GET /check/:patientId — quick allergy check (for prescription safety) ──

allergies.get('/check/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT allergen, allergy_type, severity
    FROM patient_allergies
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND allergy_type = 'drug'
    ORDER BY CASE severity WHEN 'life_threatening' THEN 1 WHEN 'severe' THEN 2 ELSE 3 END
  `).bind(tenantId, patientId).all();

  return c.json({
    drug_allergies: results,
    count: results.length,
    alert: results.length > 0,
  });
});

// ─── POST / — add allergy ───────────────────────────────────────────────────

allergies.post('/', zValidator('json', createAllergySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // P2#9: Validate patient belongs to tenant
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // P2#8: Case-insensitive duplicate check + normalize allergen
  const normalizedAllergen = data.allergen.trim();
  const existing = await db.$client.prepare(`
    SELECT id FROM patient_allergies
    WHERE tenant_id = ? AND patient_id = ? AND allergen = ? COLLATE NOCASE AND allergy_type = ? AND is_active = 1
  `).bind(tenantId, data.patient_id, normalizedAllergen, data.allergy_type).first();

  if (existing) throw new HTTPException(400, { message: 'This allergy is already recorded' });

  const result = await db.$client.prepare(`
    INSERT INTO patient_allergies (tenant_id, patient_id, allergy_type, allergen, severity, reaction, onset_date, notes, created_by, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.allergy_type, normalizedAllergen,
    data.severity, data.reaction || null, data.onset_date || null,
    data.notes || null, userId, data.source ?? 'clinician'
  ).run();

  // Mark health cards stale when allergies change (safety-critical data)
  markCardsStale(c.env.DB, tenantId, data.patient_id).catch((err) => {
    console.error('markCardsStale failed:', err);
  });

  return c.json({ id: result.meta.last_row_id, message: 'Allergy recorded' }, 201);
});

// ─── PUT /:id — update allergy ───────────────────────────────────────────────

allergies.put('/:id', zValidator('json', updateAllergySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, patient_id, allergen, allergy_type FROM patient_allergies WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Allergy not found' });

  // P2#10: If allergen or type is being changed, re-check for duplicates
  const newAllergen = data.allergen ? data.allergen.trim() : existing.allergen;
  const newType = data.allergy_type || existing.allergy_type;
  if (data.allergen !== undefined || data.allergy_type !== undefined) {
    const duplicate = await db.$client.prepare(`
      SELECT id FROM patient_allergies
      WHERE tenant_id = ? AND patient_id = ? AND allergen = ? COLLATE NOCASE AND allergy_type = ? AND is_active = 1 AND id != ?
    `).bind(tenantId, existing.patient_id, newAllergen, newType, id).first();
    if (duplicate) throw new HTTPException(400, { message: 'An allergy with this allergen and type already exists' });
  }

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (data.allergy_type !== undefined) { sets.push('allergy_type = ?'); vals.push(data.allergy_type); }
  if (data.allergen !== undefined) { sets.push('allergen = ?'); vals.push(data.allergen.trim()); }
  if (data.severity !== undefined) { sets.push('severity = ?'); vals.push(data.severity); }
  if (data.reaction !== undefined) { sets.push('reaction = ?'); vals.push(data.reaction); }
  if (data.onset_date !== undefined) { sets.push('onset_date = ?'); vals.push(data.onset_date); }
  if (data.notes !== undefined) { sets.push('notes = ?'); vals.push(data.notes); }
  if (data.source !== undefined) { sets.push('source = ?'); vals.push(data.source); }
  if (data.is_active !== undefined) { sets.push('is_active = ?'); vals.push(data.is_active ? 1 : 0); }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE patient_allergies SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  // Mark health cards stale when allergies change
  markCardsStale(c.env.DB, tenantId, existing.patient_id).catch((err) => {
    console.error('markCardsStale failed:', err);
  });

  return c.json({ success: true, message: 'Allergy updated' });
});

// ─── PUT /:id/verify — verify allergy (clinician confirmation) ───────────────

allergies.put('/:id/verify', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT id, patient_id FROM patient_allergies WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Allergy not found' });

  await db.$client.prepare(
    "UPDATE patient_allergies SET review_status = 'verified', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = COALESCE(review_notes, ?), verified_by = ?, verified_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(userId, 'Verified by clinician', userId, id, tenantId).run();

  markCardsStale(c.env.DB, tenantId, existing.patient_id).catch((err) => {
    console.error('markCardsStale failed:', err);
  });

  return c.json({ success: true, message: 'Allergy verified' });
});

allergies.put('/:id/review', zValidator('json', clinicalReviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, patient_id FROM patient_allergies WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Allergy not found' });

  if (data.status === 'verified') {
    await db.$client.prepare(
      "UPDATE patient_allergies SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?, verified_by = ?, verified_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
    ).bind(data.status, userId, data.notes ?? null, userId, id, tenantId).run();
  } else {
    await db.$client.prepare(
      "UPDATE patient_allergies SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?, verified_by = NULL, verified_at = NULL, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
    ).bind(data.status, userId, data.notes ?? null, id, tenantId).run();
  }

  markCardsStale(c.env.DB, tenantId, existing.patient_id).catch((err) => {
    console.error('markCardsStale failed:', err);
  });

  return c.json({ success: true, status: data.status, message: `Allergy ${data.status}` });
});

// ─── DELETE /:id — soft delete ───────────────────────────────────────────────

allergies.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT id, patient_id FROM patient_allergies WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Allergy not found' });

  // P3#14: Record who deleted and when for audit trail
  await db.$client.prepare(
    "UPDATE patient_allergies SET is_active = 0, updated_at = datetime('now', '+6 hours'), notes = COALESCE(notes, '') || ' [Removed by user ' || ? || ' at ' || datetime('now', '+6 hours') || ']' WHERE id = ? AND tenant_id = ?"
  ).bind(userId, id, tenantId).run();

  // Mark health cards stale when allergies removed
  markCardsStale(c.env.DB, tenantId, existing.patient_id).catch((err) => {
    console.error('markCardsStale failed:', err);
  });

  return c.json({ success: true, message: 'Allergy removed' });
});

export default allergies;

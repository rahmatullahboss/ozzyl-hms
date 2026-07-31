import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createNoteSchema, updateNoteSchema } from '../../../schemas/clinicalNotes';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const noteRoutes = new Hono<ClinicalEnv>();

// ─── List notes for a patient ──────────────────────────────────────────────

noteRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const visitId = c.req.query('visitId');
  const noteType = c.req.query('noteType');
  const page = Math.max(Number(c.req.query('page')) || 1, 1);
  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId query param is required' });

  let query = 'SELECT * FROM clinical_notes WHERE tenant_id = ? AND patient_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (visitId && !isNaN(Number(visitId))) {
    query += ' AND visit_id = ?';
    params.push(Number(visitId));
  }
  if (noteType) {
    query += ' AND note_type = ?';
    params.push(noteType);
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countResult = await db.$client.prepare(countQuery).bind(...params).first<{ total: number }>();

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({
    Results: results,
    pagination: { page, limit, total: countResult?.total || 0 },
  });
});

// ─── Get single note ───────────────────────────────────────────────────────

noteRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const row = await db.$client
    .prepare('SELECT * FROM clinical_notes WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Note not found' });
  return c.json({ Results: row });
});

// ─── Create note ───────────────────────────────────────────────────────────

noteRoutes.post('/', zValidator('json', createNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO clinical_notes (
      tenant_id, patient_id, visit_id, note_type, title, content,
      chief_complaint, subjective, objective, assessment, plan,
      follow_up, follow_up_unit, template_id, performer_id,
      is_active, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, d.patientId, d.visitId ?? null,
    d.noteType ?? 'progress', d.title ?? null, d.content,
    d.chiefComplaint ?? null, d.subjective ?? null,
    d.objective ?? null, d.assessment ?? null, d.plan ?? null,
    d.followUp ?? null, d.followUpUnit ?? null,
    d.templateId ?? null, d.performerId ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Update note ───────────────────────────────────────────────────────────

noteRoutes.put('/:id', zValidator('json', updateNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT is_signed FROM clinical_notes WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<{ is_signed: number }>();
  if (!ex) throw new HTTPException(404, { message: 'Note not found' });
  if (ex.is_signed === 1) throw new HTTPException(403, { message: 'Cannot edit a signed note' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    noteType: 'note_type', title: 'title', content: 'content',
    chiefComplaint: 'chief_complaint', subjective: 'subjective',
    objective: 'objective', assessment: 'assessment', plan: 'plan',
    followUp: 'follow_up', followUpUnit: 'follow_up_unit',
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
      .prepare(`UPDATE clinical_notes SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ Results: true });
});

// ─── Sign note (lock it from further edits) ───────────────────────────────

noteRoutes.put('/:id/sign', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT is_signed FROM clinical_notes WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<{ is_signed: number }>();
  if (!ex) throw new HTTPException(404, { message: 'Note not found' });
  if (ex.is_signed === 1) throw new HTTPException(409, { message: 'Note is already signed' });

  await db.$client
    .prepare("UPDATE clinical_notes SET is_signed = 1, signed_by = ?, signed_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(userId, id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Soft delete note ──────────────────────────────────────────────────────

noteRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT is_signed FROM clinical_notes WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<{ is_signed: number }>();
  if (!ex) throw new HTTPException(404, { message: 'Note not found' });
  if (ex.is_signed === 1) throw new HTTPException(403, { message: 'Cannot delete a signed note' });

  await db.$client
    .prepare("UPDATE clinical_notes SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ Results: true });
});

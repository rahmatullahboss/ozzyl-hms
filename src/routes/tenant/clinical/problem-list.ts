import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createProblemSchema, updateProblemSchema } from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

export const problemListRoutes = new Hono<ClinicalEnv>();

// ─── List problems (with status filter) ────────────────────────────────────

problemListRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const status = c.req.query('status') || 'active';

  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  let query = 'SELECT * FROM CLN_ProblemList WHERE tenant_id = ? AND PatientId = ?';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (status !== 'all') {
    query += ' AND Status = ?';
    params.push(status);
  }

  query += ' ORDER BY CreatedAt DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Get single problem ────────────────────────────────────────────────────

problemListRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ProblemId' });

  const result = await db.$client
    .prepare('SELECT * FROM CLN_ProblemList WHERE ProblemId = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();

  if (!result) throw new HTTPException(404, { message: 'Problem not found' });
  return c.json({ Results: result });
});

// ─── Create problem ───────────────────────────────────────────────────────

problemListRoutes.post('/', zValidator('json', createProblemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_ProblemList (
        tenant_id, PatientId, EncounterId, ICD10Code, Description,
        Subtype, BegDate, EndDate, Severity, Comments, Status, CreatedBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.ICD10Code ?? null, data.Description,
      data.Subtype ?? null, data.BegDate ?? null, data.EndDate ?? null,
      data.Severity, data.Comments ?? null, data.Status, userId,
    )
    .run();

  // Link to encounter if provided
  if (data.EncounterId && result.meta.last_row_id) {
    await db.$client
      .prepare('INSERT INTO ProblemEncounterLink (ProblemId, PatientId, EncounterId, CreatedBy) VALUES (?, ?, ?, ?)')
      .bind(result.meta.last_row_id, data.PatientId, data.EncounterId, userId)
      .run();
  }

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Update problem ──────────────────────────────────────────────────────

const ALLOWED_PROBLEM_FIELDS = [
  'ICD10Code', 'Description', 'Subtype', 'BegDate', 'EndDate',
  'Severity', 'Comments', 'Status',
];

problemListRoutes.put('/:id', zValidator('json', updateProblemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ProblemId' });

  const existing = await db.$client
    .prepare('SELECT ProblemId FROM CLN_ProblemList WHERE ProblemId = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Problem not found' });

  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (ALLOWED_PROBLEM_FIELDS.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("ModifiedAt = datetime('now', '+6 hours')", 'ModifiedBy = ?');
    values.push(userId, id, tenantId);
    await db.$client
      .prepare(`UPDATE CLN_ProblemList SET ${fields.join(', ')} WHERE ProblemId = ? AND tenant_id = ?`)
      .bind(...values)
      .run();
  }

  return c.json({ Results: true });
});

// ─── Resolve problem ────────────────────────────────────────────────────────

problemListRoutes.put('/:id/resolve', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ProblemId' });

  const existing = await db.$client
    .prepare("SELECT ProblemId FROM CLN_ProblemList WHERE ProblemId = ? AND tenant_id = ? AND Status = 'active'")
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Active problem not found' });

  await db.$client
    .prepare("UPDATE CLN_ProblemList SET Status = 'resolved', EndDate = date('now', '+6 hours'), ModifiedAt = datetime('now', '+6 hours'), ModifiedBy = ? WHERE ProblemId = ? AND tenant_id = ?")
    .bind(userId, id, tenantId)
    .run();

  return c.json({ Results: true });
});

// ─── Soft-delete problem ────────────────────────────────────────────────────

problemListRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ProblemId' });

  const existing = await db.$client
    .prepare('SELECT ProblemId FROM CLN_ProblemList WHERE ProblemId = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Problem not found' });

  await db.$client
    .prepare("UPDATE CLN_ProblemList SET Status = 'deleted', Activity = 0, ModifiedAt = datetime('now', '+6 hours'), ModifiedBy = ? WHERE ProblemId = ? AND tenant_id = ?")
    .bind(userId, id, tenantId)
    .run();

  return c.json({ Results: true });
});

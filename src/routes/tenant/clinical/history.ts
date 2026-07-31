import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import {
  createFamilyHistorySchema,
  createBasicSocialHistorySchema,
  createSurgicalHistorySchema,
} from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

export const historyRoutes = new Hono<ClinicalEnv>();

// ═══════════════════════════════════════════════════════════════════════════════
// Family History
// ═══════════════════════════════════════════════════════════════════════════════

historyRoutes.get('/family', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM CLN_FamilyHistory WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1 ORDER BY CreatedOn DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

historyRoutes.post('/family', zValidator('json', createFamilyHistorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_FamilyHistory (tenant_id, PatientId, ICD10Code, ICD10Description, Relationship, Note, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(tenantId, data.PatientId, data.ICD10Code ?? null, data.ICD10Description ?? null, data.Relationship ?? null, data.Note ?? null, userId)
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

historyRoutes.delete('/family/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client
    .prepare('SELECT FamilyProblemId FROM CLN_FamilyHistory WHERE FamilyProblemId = ? AND tenant_id = ? AND IsActive = 1')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client
    .prepare("UPDATE CLN_FamilyHistory SET IsActive = 0, ModifiedOn = datetime('now', '+6 hours') WHERE FamilyProblemId = ? AND tenant_id = ?")
    .bind(id, tenantId)
    .run();

  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Social History (Basic)
// ═══════════════════════════════════════════════════════════════════════════════

historyRoutes.get('/social', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM CLN_SocialHistory WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1 ORDER BY CreatedOn DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

historyRoutes.post('/social', zValidator('json', createBasicSocialHistorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_SocialHistory (tenant_id, PatientId, SmokingHistory, AlcoholHistory, DrugHistory, Occupation, FamilySupport, Note, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId,
      data.SmokingHistory ?? null, data.AlcoholHistory ?? null,
      data.DrugHistory ?? null, data.Occupation ?? null,
      data.FamilySupport ?? null, data.Note ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

historyRoutes.delete('/social/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client
    .prepare('SELECT SocialHistoryId FROM CLN_SocialHistory WHERE SocialHistoryId = ? AND tenant_id = ? AND IsActive = 1')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client
    .prepare("UPDATE CLN_SocialHistory SET IsActive = 0, ModifiedOn = datetime('now', '+6 hours') WHERE SocialHistoryId = ? AND tenant_id = ?")
    .bind(id, tenantId)
    .run();

  return c.json({ Results: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Surgical History
// ═══════════════════════════════════════════════════════════════════════════════

historyRoutes.get('/surgical', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM CLN_SurgicalHistory WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1 ORDER BY CreatedOn DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

historyRoutes.post('/surgical', zValidator('json', createSurgicalHistorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_SurgicalHistory (tenant_id, PatientId, ICD10Code, ICD10Description, SurgeryType, Note, SurgeryDate, CreatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId,
      data.ICD10Code ?? null, data.ICD10Description ?? null,
      data.SurgeryType ?? null, data.Note ?? null,
      data.SurgeryDate ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

historyRoutes.delete('/surgical/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client
    .prepare('SELECT SurgicalHistoryId FROM CLN_SurgicalHistory WHERE SurgicalHistoryId = ? AND tenant_id = ? AND IsActive = 1')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client
    .prepare("UPDATE CLN_SurgicalHistory SET IsActive = 0, ModifiedOn = datetime('now', '+6 hours') WHERE SurgicalHistoryId = ? AND tenant_id = ?")
    .bind(id, tenantId)
    .run();

  return c.json({ Results: true });
});

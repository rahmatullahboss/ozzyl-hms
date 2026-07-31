import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type CamosEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createCategorySchema = z.object({
  CategoryName: z.string().min(1).max(200),
  Description: z.string().max(1000).optional(),
  CategoryType: z.enum(['clinical', 'administrative', 'screening', 'custom']).default('clinical'),
  DisplayOrder: z.number().int().default(0),
  Icon: z.string().max(50).optional(),
  Color: z.string().max(20).optional(),
});

const createSubcategorySchema = z.object({
  CategoryId: z.number().int().positive(),
  SubcategoryName: z.string().min(1).max(200),
  Description: z.string().max(1000).optional(),
  DisplayOrder: z.number().int().default(0),
});

const createItemSchema = z.object({
  SubcategoryId: z.number().int().positive(),
  ItemName: z.string().min(1).max(200),
  ItemCode: z.string().max(50).optional(),
  ItemContent: z.string(),
  ItemTemplate: z.string().optional(),
  DefaultContent: z.string().optional(),
  ItemType: z.enum(['text', 'number', 'select', 'checkbox', 'textarea', 'date']).default('text'),
  ScoreWeight: z.number().default(0),
  ScoreMapping: z.string().optional(),
  DisplayOrder: z.number().int().default(0),
  IsLocked: z.boolean().default(false),
});

const createAssessmentSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  AssessmentTitle: z.string().max(300).optional(),
  AssessmentType: z.enum(['standard', 'screening', 'intake', 'followup']).default('standard'),
  TemplateId: z.number().int().positive().optional(),
  ProviderId: z.number().int().positive().optional(),
  DepartmentId: z.number().int().positive().optional(),
  Responses: z.array(z.object({
    CategoryId: z.number().int().positive().optional(),
    SubcategoryId: z.number().int().positive().optional(),
    ItemId: z.number().int().positive().optional(),
    CategoryName: z.string().optional(),
    SubcategoryName: z.string().optional(),
    ItemName: z.string().optional(),
    ItemCode: z.string().optional(),
    ResponseValue: z.string(),
    ResponseText: z.string().optional(),
    ItemScore: z.number().default(0),
  })),
  ClinicalNotes: z.string().max(5000).optional(),
  FollowupRequired: z.boolean().default(false),
  FollowupNotes: z.string().optional(),
  FollowupDate: z.string().optional(),
  BillingCodes: z.array(z.string()).optional(),
  DiagnosisCodes: z.array(z.string()).optional(),
});

const createTemplateSchema = z.object({
  TemplateName: z.string().min(1).max(200),
  TemplateType: z.enum(['standard', 'screening', 'intake', 'followup']).default('standard'),
  Specialty: z.string().max(100).optional(),
  Description: z.string().max(1000).optional(),
  TemplateContent: z.string(),
  DisplayOrder: z.number().int().default(0),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const camosRoutes = new Hono<CamosEnv>();

// ═══════════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════════

camosRoutes.get('/categories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { type } = c.req.query();

  let query = 'SELECT * FROM CamosCategory WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];
  if (type) { query += ' AND CategoryType = ?'; params.push(type); }
  query += ' ORDER BY DisplayOrder, CategoryName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

camosRoutes.post('/categories', zValidator('json', createCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO CamosCategory (tenant_id, CategoryName, Description, CategoryType, DisplayOrder, Icon, Color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.CategoryName, data.Description ?? null,
    data.CategoryType, data.DisplayOrder, data.Icon ?? null, data.Color ?? null,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

camosRoutes.delete('/categories/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    "UPDATE CamosCategory SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND CategoryId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Subcategories
// ═══════════════════════════════════════════════════════════════════

camosRoutes.get('/categories/:categoryId/subcategories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const categoryId = Number(c.req.param('categoryId'));

  const { results } = await db.$client.prepare(
    'SELECT * FROM CamosSubcategory WHERE tenant_id = ? AND CategoryId = ? AND IsActive = 1 ORDER BY DisplayOrder, SubcategoryName'
  ).bind(tenantId, categoryId).all();

  return c.json({ Results: results });
});

camosRoutes.post('/subcategories', zValidator('json', createSubcategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO CamosSubcategory (tenant_id, CategoryId, SubcategoryName, Description, DisplayOrder)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.CategoryId, data.SubcategoryName, data.Description ?? null, data.DisplayOrder).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Items
// ═══════════════════════════════════════════════════════════════════

camosRoutes.get('/subcategories/:subcategoryId/items', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const subcategoryId = Number(c.req.param('subcategoryId'));

  const { results } = await db.$client.prepare(
    'SELECT * FROM CamosItem WHERE tenant_id = ? AND SubcategoryId = ? AND IsActive = 1 ORDER BY DisplayOrder, ItemName'
  ).bind(tenantId, subcategoryId).all();

  return c.json({ Results: results });
});

camosRoutes.post('/items', zValidator('json', createItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO CamosItem (
      tenant_id, SubcategoryId, ItemName, ItemCode, ItemContent, ItemTemplate,
      DefaultContent, ItemType, ScoreWeight, ScoreMapping, DisplayOrder, IsLocked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.SubcategoryId, data.ItemName, data.ItemCode ?? null,
    data.ItemContent, data.ItemTemplate ?? null,
    data.DefaultContent ?? null, data.ItemType, data.ScoreWeight,
    data.ScoreMapping ?? null, data.DisplayOrder, data.IsLocked ? 1 : 0,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

camosRoutes.delete('/items/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    "UPDATE CamosItem SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND ItemId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Assessments
// ═══════════════════════════════════════════════════════════════════

camosRoutes.get('/assessments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status, type, limit: lim } = c.req.query();

  let query = 'SELECT * FROM CamosAssessment WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND PatientId = ?'; params.push(Number(patientId)); }
  if (status) { query += ' AND Status = ?'; params.push(status); }
  if (type) { query += ' AND AssessmentType = ?'; params.push(type); }
  query += ' ORDER BY AssessmentDate DESC';
  if (lim) { query += ' LIMIT ?'; params.push(parseInt(lim)); }

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

camosRoutes.get('/assessments/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const assessment = await db.$client.prepare(
    'SELECT * FROM CamosAssessment WHERE tenant_id = ? AND AssessmentId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!assessment) throw new HTTPException(404, { message: 'Assessment not found' });

  const { results: responses } = await db.$client.prepare(
    'SELECT * FROM CamosAssessmentResponse WHERE tenant_id = ? AND AssessmentId = ? ORDER BY ResponseOrder'
  ).bind(tenantId, id).all();

  return c.json({ Results: { ...assessment, responses } });
});

camosRoutes.post('/assessments', zValidator('json', createAssessmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Calculate scores
  const totalScore = data.Responses.reduce((sum, r) => sum + (r.ItemScore || 0), 0);
  const maxPossibleScore = data.Responses.length * 4; // Assume max 4 per item
  const scorePercentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

  let riskLevel = 'low';
  if (scorePercentage >= 75) riskLevel = 'high';
  else if (scorePercentage >= 50) riskLevel = 'moderate';

  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO CamosAssessment (
      tenant_id, PatientId, EncounterId, AssessmentTitle, AssessmentType,
      AssessmentDate, TemplateId, ProviderId, DepartmentId,
      Status, CompletionDate,
      TotalScore, MaxPossibleScore, ScorePercentage, RiskLevel,
      ClinicalNotes, FollowupRequired, FollowupNotes, FollowupDate,
      BillingCodes, DiagnosisCodes, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.AssessmentTitle ?? null, data.AssessmentType,
    now, data.TemplateId ?? null, data.ProviderId ?? null, data.DepartmentId ?? null,
    now, totalScore, maxPossibleScore, scorePercentage, riskLevel,
    data.ClinicalNotes ?? null, data.FollowupRequired ? 1 : 0,
    data.FollowupNotes ?? null, data.FollowupDate ?? null,
    data.BillingCodes ? JSON.stringify(data.BillingCodes) : null,
    data.DiagnosisCodes ? JSON.stringify(data.DiagnosisCodes) : null,
    userId,
  ).run();

  const assessmentId = result.meta.last_row_id;

  // Insert responses
  for (let i = 0; i < data.Responses.length; i++) {
    const r = data.Responses[i];
    await db.$client.prepare(`
      INSERT INTO CamosAssessmentResponse (
        tenant_id, AssessmentId, CategoryId, SubcategoryId, ItemId,
        CategoryName, SubcategoryName, ItemName, ItemCode,
        ResponseValue, ResponseText, ItemScore, ResponseOrder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, assessmentId,
      r.CategoryId ?? null, r.SubcategoryId ?? null, r.ItemId ?? null,
      r.CategoryName ?? null, r.SubcategoryName ?? null, r.ItemName ?? null, r.ItemCode ?? null,
      r.ResponseValue, r.ResponseText ?? null, r.ItemScore, i,
    ).run();
  }

  return c.json({
    Results: {
      id: assessmentId, totalScore, maxPossibleScore,
      scorePercentage: Math.round(scorePercentage), riskLevel,
    },
  }, 201);
});

camosRoutes.delete('/assessments/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT AssessmentId FROM CamosAssessment WHERE tenant_id = ? AND AssessmentId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Assessment not found' });

  await db.$client.prepare(
    "UPDATE CamosAssessment SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND AssessmentId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════

camosRoutes.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { type, specialty } = c.req.query();

  let query = 'SELECT * FROM CamosTemplate WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (type) { query += ' AND TemplateType = ?'; params.push(type); }
  if (specialty) { query += ' AND Specialty = ?'; params.push(specialty); }
  query += ' ORDER BY DisplayOrder, TemplateName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

camosRoutes.post('/templates', zValidator('json', createTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO CamosTemplate (tenant_id, TemplateName, TemplateType, Specialty, Description, TemplateContent, DisplayOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.TemplateName, data.TemplateType,
    data.Specialty ?? null, data.Description ?? null,
    data.TemplateContent, data.DisplayOrder,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Browse hierarchy: categories → subcategories → items
// ═══════════════════════════════════════════════════════════════════

camosRoutes.get('/browse', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const [categories, subcategories, items] = await Promise.all([
    db.$client.prepare(
      'SELECT * FROM CamosCategory WHERE tenant_id = ? AND IsActive = 1 ORDER BY DisplayOrder, CategoryName'
    ).bind(tenantId).all(),
    db.$client.prepare(
      'SELECT * FROM CamosSubcategory WHERE tenant_id = ? AND IsActive = 1 ORDER BY DisplayOrder, SubcategoryName'
    ).bind(tenantId).all(),
    db.$client.prepare(
      'SELECT * FROM CamosItem WHERE tenant_id = ? AND IsActive = 1 ORDER BY DisplayOrder, ItemName'
    ).bind(tenantId).all(),
  ]);

  return c.json({
    Results: {
      categories: categories.results,
      subcategories: subcategories.results,
      items: items.results,
    },
  });
});

export default camosRoutes;

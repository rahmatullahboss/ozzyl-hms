import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type PEEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  TemplateName: z.string().min(1).max(200),
  Description: z.string().max(1000).optional(),
  Specialty: z.string().max(100).optional(),
  ExamLines: z.array(z.string()).optional(),
  IsDefault: z.boolean().default(false),
});

const createExamSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  TemplateId: z.number().int().positive().optional(),
  ExamDate: z.string(),
  Findings: z.array(z.object({
    lineCode: z.string(),
    status: z.enum(['wnl', 'abn']),
    notes: z.string().optional(),
  })),
  GeneralNotes: z.string().max(5000).optional(),
});

const createLineSchema = z.object({
  LineCode: z.string().min(1).max(20),
  Category: z.string().min(1).max(100),
  Title: z.string().min(1).max(200),
  WnlText: z.string().max(500).default('Normal'),
  AbnText: z.string().max(500).default(''),
  DisplayOrder: z.number().int().default(0),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const physicalExamRoutes = new Hono<PEEnv>();

// GET /templates — list exam templates
physicalExamRoutes.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { specialty } = c.req.query();

  let query = 'SELECT * FROM PhysicalExamTemplate WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (specialty) { query += ' AND Specialty = ?'; params.push(specialty); }
  query += ' ORDER BY IsDefault DESC, TemplateName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST /templates — create exam template
physicalExamRoutes.post('/templates', zValidator('json', createTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO PhysicalExamTemplate (tenant_id, TemplateName, Description, Specialty, ExamLines, IsDefault, CreatedById)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.TemplateName, data.Description ?? null,
    data.Specialty ?? null,
    data.ExamLines ? JSON.stringify(data.ExamLines) : null,
    data.IsDefault ? 1 : 0, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// GET /lines — list exam lines
physicalExamRoutes.get('/lines', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { category } = c.req.query();

  let query = 'SELECT * FROM PhysicalExamLine WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (category) { query += ' AND Category = ?'; params.push(category); }
  query += ' ORDER BY Category, DisplayOrder';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST /lines — create exam line
physicalExamRoutes.post('/lines', zValidator('json', createLineSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT LineCode FROM PhysicalExamLine WHERE tenant_id = ? AND LineCode = ?'
  ).bind(tenantId, data.LineCode).first();
  if (existing) throw new HTTPException(400, { message: 'Line code already exists' });

  await db.$client.prepare(`
    INSERT INTO PhysicalExamLine (LineCode, tenant_id, Category, Title, WnlText, AbnText, DisplayOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(data.LineCode, tenantId, data.Category, data.Title, data.WnlText, data.AbnText, data.DisplayOrder).run();

  return c.json({ Results: { LineCode: data.LineCode } }, 201);
});

// GET /patient/:patientId — list patient's exams
physicalExamRoutes.get('/patient/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const { limit: lim } = c.req.query();

  const pageSize = parseInt(lim || '20');

  const { results } = await db.$client.prepare(`
    SELECT * FROM FormPhysicalExam
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY ExamDate DESC LIMIT ?
  `).bind(tenantId, patientId, pageSize).all();

  return c.json({ Results: results });
});

// GET /:id — single exam
physicalExamRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const exam = await db.$client.prepare(
    'SELECT * FROM FormPhysicalExam WHERE tenant_id = ? AND ExamId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();

  if (!exam) throw new HTTPException(404, { message: 'Exam not found' });

  const { results: comments } = await db.$client.prepare(
    'SELECT * FROM PhysicalExamComments WHERE tenant_id = ? AND ExamId = ? ORDER BY CreatedAt'
  ).bind(tenantId, id).all();

  return c.json({ Results: { ...exam, comments } });
});

// POST / — create physical exam
physicalExamRoutes.post('/', zValidator('json', createExamSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const abnCount = data.Findings.filter(f => f.status === 'abn').length;
  const overallStatus = abnCount === 0 ? 'normal' : 'abnormal';

  const result = await db.$client.prepare(`
    INSERT INTO FormPhysicalExam (
      tenant_id, PatientId, EncounterId, TemplateId, ExamDate,
      Findings, OverallStatus, GeneralNotes, PerformedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.TemplateId ?? null, data.ExamDate,
    JSON.stringify(data.Findings), overallStatus,
    data.GeneralNotes ?? null, userId,
  ).run();

  const examId = result.meta.last_row_id;

  // Insert individual line comments
  for (const finding of data.Findings) {
    await db.$client.prepare(`
      INSERT INTO PhysicalExamComments (tenant_id, ExamId, LineCode, Status, Notes)
      VALUES (?, ?, ?, ?, ?)
    `).bind(tenantId, examId, finding.lineCode, finding.status, finding.notes ?? null).run();
  }

  return c.json({ Results: { id: examId, overallStatus } }, 201);
});

// DELETE /:id — soft delete exam
physicalExamRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT ExamId FROM FormPhysicalExam WHERE tenant_id = ? AND ExamId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Exam not found' });

  await db.$client.prepare(
    'UPDATE FormPhysicalExam SET IsActive = 0 WHERE tenant_id = ? AND ExamId = ?'
  ).bind(tenantId, id).run();

  return c.json({ Results: { success: true } });
});

export default physicalExamRoutes;

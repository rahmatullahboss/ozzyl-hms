import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type LbfEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createFormSchema = z.object({
  FormName: z.string().min(3).max(100).regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric with underscores'),
  FormTitle: z.string().min(3).max(200),
  FormDescription: z.string().max(1000).optional(),
  FormSchema: z.object({}).passthrough(),
  LayoutConfig: z.object({}).passthrough().optional(),
  ValidationRules: z.object({}).passthrough().optional(),
  Category: z.enum(['clinical', 'administrative', 'screening', 'consent', 'custom']).optional(),
  Specialty: z.string().max(100).optional(),
  SubCategory: z.string().max(100).optional(),
  IsEncounterForm: z.boolean().default(true),
  IsPatientPortal: z.boolean().default(false),
  AllowMultipleSubmissions: z.boolean().default(false),
  MaxSubmissionsPerEncounter: z.number().int().positive().optional(),
  AllowedRoles: z.array(z.string()).optional(),
  AllowedProviders: z.array(z.number().int().positive()).optional(),
  IsTemplate: z.boolean().default(false),
  TemplateId: z.number().int().positive().optional(),
});

const submitFormSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive(),
  ProviderId: z.number().int().positive().optional(),
  FormData: z.object({}).passthrough(),
  SubmissionMode: z.enum(['paper', 'electronic', 'portal', 'interview']).default('electronic'),
  DiagnosisCodes: z.array(z.string()).optional(),
  ServiceCodes: z.array(z.string()).optional(),
  ClinicalNotes: z.string().max(5000).optional(),
});

const createFieldSchema = z.object({
  FieldName: z.string().min(1).max(100),
  FieldLabel: z.string().min(1).max(200),
  FieldCode: z.string().max(50).optional(),
  FieldType: z.enum(['text', 'textarea', 'number', 'date', 'datetime', 'select', 'radio', 'checkbox', 'multiselect', 'signature', 'file', 'section', 'instructions']),
  DataType: z.enum(['string', 'number', 'boolean', 'array', 'date', 'datetime', 'file']),
  FieldConfig: z.object({}).passthrough().optional(),
  ValidationRules: z.object({}).passthrough().optional(),
  ConditionalLogic: z.object({}).passthrough().optional(),
  OptionList: z.array(z.string()).optional(),
  OptionListId: z.string().max(100).optional(),
  SectionId: z.string().max(100).optional(),
  DisplayOrder: z.number().int().default(0),
  Placeholder: z.string().max(200).optional(),
  HelpText: z.string().max(500).optional(),
  DefaultValue: z.string().optional(),
  IsRequired: z.boolean().default(false),
  IsReadOnly: z.boolean().default(false),
  IsHidden: z.boolean().default(false),
  MinValue: z.number().optional(),
  MaxValue: z.number().optional(),
  MinLength: z.number().int().optional(),
  MaxLength: z.number().int().optional(),
  Pattern: z.string().optional(),
  IsGraphable: z.boolean().default(false),
  IsHistorical: z.boolean().default(false),
});

// ─── Helper: Calculate Form Score ───────────────────────────────────────────

function calculateFormScore(formData: Record<string, unknown>, formSchema: Record<string, unknown>): { score: number; interpretation: string } {
  let score = 0;
  const scoring = formSchema?.scoring as { fields?: string[]; interpretations?: { minScore: number; maxScore: number; label: string }[] } | undefined;
  const scoringFields = scoring?.fields || [];

  for (const fieldName of scoringFields) {
    const value = formData[fieldName];
    if (typeof value === 'number') {
      score += value;
    } else if (typeof value === 'string') {
      const scoreMap: Record<string, number> = {
        'Not at all': 0, 'Several days': 1, 'More than half the days': 2, 'Nearly every day': 3,
        'Never': 0, 'Rarely': 1, 'Sometimes': 2, 'Often': 3, 'Always': 4,
      };
      score += scoreMap[value] || 0;
    }
  }

  let interpretation = 'normal';
  const interpretations = scoring?.interpretations || [];
  for (const interp of interpretations) {
    if (score >= interp.minScore && score <= interp.maxScore) {
      interpretation = interp.label;
      break;
    }
  }

  return { score, interpretation };
}

// ─── Router ─────────────────────────────────────────────────────────────────

const lbfFormRoutes = new Hono<LbfEnv>();

// GET / — list all custom forms
lbfFormRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { category, specialty, isTemplate } = c.req.query();

  let query = `
    SELECT f.*,
      (SELECT COUNT(*) FROM LbfFormSubmission fs WHERE fs.FormId = f.FormId AND fs.tenant_id = f.tenant_id AND fs.IsActive = 1) as SubmissionCount,
      (SELECT COUNT(*) FROM LbfFormField ff WHERE ff.FormId = f.FormId AND ff.tenant_id = f.tenant_id AND ff.IsActive = 1) as FieldCount
    FROM LbfForm f
    WHERE f.tenant_id = ? AND f.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (category) { query += ' AND f.Category = ?'; params.push(category); }
  if (specialty) { query += ' AND f.Specialty = ?'; params.push(specialty); }
  if (isTemplate !== undefined) { query += ' AND f.IsTemplate = ?'; params.push(isTemplate === 'true' ? 1 : 0); }
  query += ' ORDER BY f.FormTitle';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /templates — list form templates
lbfFormRoutes.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { category, specialty } = c.req.query();

  let query = 'SELECT * FROM LbfFormTemplate WHERE tenant_id = ?';
  const params: (string | number)[] = [tenantId];

  if (category) { query += ' AND Category = ?'; params.push(category); }
  if (specialty) { query += ' AND Specialty = ?'; params.push(specialty); }
  query += ' ORDER BY UsageCount DESC, TemplateTitle';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /submissions/:id — single submission
lbfFormRoutes.get('/submissions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const submission = await db.$client.prepare(`
    SELECT fs.*, f.FormName, f.FormTitle
    FROM LbfFormSubmission fs
    LEFT JOIN LbfForm f ON fs.FormId = f.FormId AND f.tenant_id = fs.tenant_id
    WHERE fs.tenant_id = ? AND fs.SubmissionId = ?
  `).bind(tenantId, id).first();

  if (!submission) throw new HTTPException(404, { message: 'Submission not found' });

  const { results: fieldValues } = await db.$client.prepare(`
    SELECT fv.*, ff.FieldName, ff.FieldLabel, ff.FieldType
    FROM LbfFieldValue fv
    LEFT JOIN LbfFormField ff ON fv.FieldId = ff.FieldId AND ff.tenant_id = fv.tenant_id
    WHERE fv.tenant_id = ? AND fv.SubmissionId = ?
  `).bind(tenantId, id).all();

  return c.json({ Results: { ...submission, fieldValues } });
});

// GET /:id — form definition with fields and sections
lbfFormRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const form = await db.$client.prepare(
    'SELECT * FROM LbfForm WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();

  if (!form) throw new HTTPException(404, { message: 'Form not found' });

  const [fields, sections] = await Promise.all([
    db.$client.prepare('SELECT * FROM LbfFormField WHERE tenant_id = ? AND FormId = ? AND IsActive = 1 ORDER BY DisplayOrder, FieldId').bind(tenantId, id).all(),
    db.$client.prepare('SELECT * FROM LbfFormSection WHERE tenant_id = ? AND FormId = ? ORDER BY DisplayOrder').bind(tenantId, id).all(),
  ]);

  return c.json({ Results: { ...form, fields: fields.results, sections: sections.results } });
});

// POST / — create custom form
lbfFormRoutes.post('/', zValidator('json', createFormSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT FormId FROM LbfForm WHERE tenant_id = ? AND FormName = ?'
  ).bind(tenantId, data.FormName).first();
  if (existing) throw new HTTPException(400, { message: 'Form name already exists' });

  let formSchema = data.FormSchema;
  if (data.TemplateId) {
    const template = await db.$client.prepare(
      'SELECT FormSchema FROM LbfFormTemplate WHERE tenant_id = ? AND TemplateId = ?'
    ).bind(tenantId, data.TemplateId).first<{ FormSchema: string }>();
    if (template) formSchema = JSON.parse(template.FormSchema);
  }

  const result = await db.$client.prepare(`
    INSERT INTO LbfForm (
      tenant_id, FormName, FormTitle, FormDescription, FormSchema, LayoutConfig, ValidationRules,
      Category, Specialty, SubCategory, IsEncounterForm, IsPatientPortal,
      AllowMultipleSubmissions, MaxSubmissionsPerEncounter,
      AllowedRoles, AllowedProviders,
      IsTemplate, TemplateId, Version, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.FormName, data.FormTitle, data.FormDescription ?? null,
    JSON.stringify(formSchema),
    data.LayoutConfig ? JSON.stringify(data.LayoutConfig) : null,
    data.ValidationRules ? JSON.stringify(data.ValidationRules) : null,
    data.Category ?? null, data.Specialty ?? null, data.SubCategory ?? null,
    data.IsEncounterForm ? 1 : 0, data.IsPatientPortal ? 1 : 0,
    data.AllowMultipleSubmissions ? 1 : 0, data.MaxSubmissionsPerEncounter ?? null,
    data.AllowedRoles ? JSON.stringify(data.AllowedRoles) : null,
    data.AllowedProviders ? JSON.stringify(data.AllowedProviders) : null,
    data.IsTemplate ? 1 : 0, data.TemplateId ?? null,
    '1.0.0', userId,
  ).run();

  const formId = result.meta.last_row_id;

  // Auto-create fields + sections from schema
  const schemaObj = formSchema as Record<string, unknown>;
  const schemaSections = schemaObj?.sections as Array<{ id?: string; title?: string; subtitle?: string; fields?: Array<{ name: string; label: string; type?: string; dataType?: string; required?: boolean; options?: string[] }> }> | undefined;

  if (schemaSections && Array.isArray(schemaSections)) {
    let displayOrder = 0;
    for (const section of schemaSections) {
      if (section.title) {
        await db.$client.prepare(`
          INSERT INTO LbfFormSection (tenant_id, FormId, SectionName, SectionTitle, SectionSubtitle, DisplayOrder)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(tenantId, formId, section.id ?? `section_${displayOrder}`, section.title, section.subtitle ?? null, displayOrder).run();
      }

      if (section.fields) {
        for (const field of section.fields) {
          await db.$client.prepare(`
            INSERT INTO LbfFormField (
              tenant_id, FormId, FieldName, FieldLabel, FieldType, DataType,
              SectionId, DisplayOrder, IsRequired, OptionList
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            tenantId, formId, field.name, field.label,
            field.type ?? 'text', field.dataType ?? 'string',
            section.id ?? null, displayOrder++,
            field.required ? 1 : 0,
            field.options ? JSON.stringify(field.options) : null,
          ).run();
        }
      }
    }
  }

  return c.json({ Results: { id: formId } }, 201);
});

// PUT /:id — update form definition
lbfFormRoutes.put('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const existing = await db.$client.prepare(
    'SELECT FormId FROM LbfForm WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Form not found' });

  const allowedFields = ['FormTitle', 'FormDescription', 'FormSchema', 'LayoutConfig', 'ValidationRules', 'Category', 'Specialty', 'AllowedRoles', 'AllowedProviders'];
  const jsonFields = ['FormSchema', 'LayoutConfig', 'ValidationRules', 'AllowedRoles', 'AllowedProviders'];

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  for (const key of allowedFields) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(jsonFields.includes(key) ? JSON.stringify(body[key]) : (body[key] as string | number | null));
    }
  }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  updates.push('UpdatedAt = CURRENT_TIMESTAMP', 'UpdatedById = ?');
  params.push(userId, tenantId, id);

  await db.$client.prepare(`UPDATE LbfForm SET ${updates.join(', ')} WHERE tenant_id = ? AND FormId = ?`).bind(...params).run();
  return c.json({ Results: { success: true } });
});

// DELETE /:id — soft delete form
lbfFormRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT FormId FROM LbfForm WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Form not found' });

  const submissions = await db.$client.prepare(
    'SELECT COUNT(*) as count FROM LbfFormSubmission WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, id).first<{ count: number }>();

  if (submissions && submissions.count > 0) {
    throw new HTTPException(400, { message: `Cannot delete form with ${submissions.count} existing submissions. Deactivate instead.` });
  }

  await db.$client.prepare(
    'UPDATE LbfForm SET IsActive = 0, UpdatedAt = CURRENT_TIMESTAMP, UpdatedById = ? WHERE tenant_id = ? AND FormId = ?'
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Submissions ────────────────────────────────────────────────────────────

// POST /:id/submit — submit form data
lbfFormRoutes.post('/:id/submit', zValidator('json', submitFormSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const formId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const form = await db.$client.prepare(
    'SELECT * FROM LbfForm WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, formId).first<Record<string, unknown>>();

  if (!form) throw new HTTPException(404, { message: 'Form not found or inactive' });

  if (!form.AllowMultipleSubmissions) {
    const existingSub = await db.$client.prepare(
      'SELECT COUNT(*) as count FROM LbfFormSubmission WHERE tenant_id = ? AND FormId = ? AND EncounterId = ? AND IsActive = 1'
    ).bind(tenantId, formId, data.EncounterId).first<{ count: number }>();

    if (existingSub && existingSub.count > 0) {
      throw new HTTPException(400, { message: 'This form already has a submission for this encounter' });
    }
  }

  const formSchema = form.FormSchema ? JSON.parse(form.FormSchema as string) as Record<string, unknown> : null;
  const scoreResult = formSchema?.scoring ? calculateFormScore(data.FormData as Record<string, unknown>, formSchema) : null;

  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO LbfFormSubmission (
      tenant_id, FormId, PatientId, EncounterId, ProviderId, SubmissionDate, SubmissionStatus,
      SubmissionMode, FormData, DiagnosisCodes, ServiceCodes, ClinicalNotes, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, formId, data.PatientId, data.EncounterId,
    data.ProviderId ?? userId, now, data.SubmissionMode,
    JSON.stringify(data.FormData),
    data.DiagnosisCodes ? JSON.stringify(data.DiagnosisCodes) : null,
    data.ServiceCodes ? JSON.stringify(data.ServiceCodes) : null,
    data.ClinicalNotes ?? null, userId,
  ).run();

  const submissionId = result.meta.last_row_id;

  // Create individual field values for reporting
  const { results: fields } = await db.$client.prepare(
    'SELECT FieldId, FieldName, FieldType FROM LbfFormField WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, formId).all<{ FieldId: number; FieldName: string; FieldType: string }>();

  for (const field of fields || []) {
    const value = (data.FormData as Record<string, unknown>)[field.FieldName];
    if (value !== undefined && value !== null) {
      let fieldValue = value;
      let valueNormalized: string | null = null;

      if (field.FieldType === 'number' && typeof value === 'string') {
        valueNormalized = String(parseFloat(value));
      } else if (Array.isArray(value)) {
        fieldValue = JSON.stringify(value);
      }

      await db.$client.prepare(`
        INSERT INTO LbfFieldValue (tenant_id, SubmissionId, FieldId, FieldValue, ValueNormalized)
        VALUES (?, ?, ?, ?, ?)
      `).bind(tenantId, submissionId, field.FieldId, String(fieldValue), valueNormalized).run();
    }
  }

  return c.json({
    Results: {
      id: submissionId,
      score: scoreResult?.score,
      interpretation: scoreResult?.interpretation,
    },
  }, 201);
});

// GET /:id/submissions — list submissions for a form
lbfFormRoutes.get('/:id/submissions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = Number(c.req.param('id'));
  const { patientId, encounterId, status, startDate, endDate, page = '1', limit = '50' } = c.req.query();

  let query = `
    SELECT fs.*
    FROM LbfFormSubmission fs
    WHERE fs.tenant_id = ? AND fs.FormId = ? AND fs.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId, formId];

  if (patientId) { query += ' AND fs.PatientId = ?'; params.push(parseInt(patientId)); }
  if (encounterId) { query += ' AND fs.EncounterId = ?'; params.push(parseInt(encounterId)); }
  if (status) { query += ' AND fs.SubmissionStatus = ?'; params.push(status); }
  if (startDate) { query += ' AND fs.SubmissionDate >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND fs.SubmissionDate <= ?'; params.push(endDate); }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  query += ' ORDER BY fs.SubmissionDate DESC LIMIT ? OFFSET ?';
  params.push(limitNum, (pageNum - 1) * limitNum);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM LbfFormSubmission WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, formId).first<{ total: number }>();

  return c.json({
    Results: results,
    Pagination: { page: pageNum, limit: limitNum, total: countResult?.total || 0, totalPages: Math.ceil((countResult?.total || 0) / limitNum) },
  });
});

// PUT /submissions/:id — update submission
lbfFormRoutes.put('/submissions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const existing = await db.$client.prepare(
    'SELECT SubmissionId FROM LbfFormSubmission WHERE tenant_id = ? AND SubmissionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Submission not found' });

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.ClinicalNotes !== undefined) { updates.push('ClinicalNotes = ?'); params.push(body.ClinicalNotes as string | null); }
  if (body.DiagnosisCodes !== undefined) { updates.push('DiagnosisCodes = ?'); params.push(JSON.stringify(body.DiagnosisCodes)); }
  if (body.ServiceCodes !== undefined) { updates.push('ServiceCodes = ?'); params.push(JSON.stringify(body.ServiceCodes)); }
  if (body.SubmissionStatus !== undefined) {
    updates.push('SubmissionStatus = ?'); params.push(body.SubmissionStatus as string);
    if (body.SubmissionStatus === 'signed') {
      updates.push('SignedById = ?', 'SignedAt = ?');
      params.push(userId, new Date().toISOString());
    }
  }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  updates.push('UpdatedAt = CURRENT_TIMESTAMP', 'UpdatedById = ?');
  params.push(userId, tenantId, id);

  await db.$client.prepare(`UPDATE LbfFormSubmission SET ${updates.join(', ')} WHERE tenant_id = ? AND SubmissionId = ?`).bind(...params).run();
  return c.json({ Results: { success: true } });
});

// DELETE /submissions/:id — soft delete submission
lbfFormRoutes.delete('/submissions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT SubmissionId FROM LbfFormSubmission WHERE tenant_id = ? AND SubmissionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Submission not found' });

  await db.$client.prepare(
    "UPDATE LbfFormSubmission SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND SubmissionId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Report & Export ────────────────────────────────────────────────────────

// GET /:id/report — form report (JSON or CSV)
lbfFormRoutes.get('/:id/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = Number(c.req.param('id'));
  const { startDate, endDate, providerId, status, format = 'json' } = c.req.query();

  const form = await db.$client.prepare(
    'SELECT FormId, FormName, FormTitle, Category FROM LbfForm WHERE tenant_id = ? AND FormId = ?'
  ).bind(tenantId, formId).first<Record<string, unknown>>();
  if (!form) throw new HTTPException(404, { message: 'Form not found' });

  let query = `
    SELECT fs.*, p.name as PatientName, p.date_of_birth
    FROM LbfFormSubmission fs
    LEFT JOIN patients p ON fs.PatientId = p.id AND p.tenant_id = fs.tenant_id
    WHERE fs.tenant_id = ? AND fs.FormId = ? AND fs.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId, formId];

  if (startDate) { query += ' AND fs.SubmissionDate >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND fs.SubmissionDate <= ?'; params.push(endDate); }
  if (providerId) { query += ' AND fs.ProviderId = ?'; params.push(parseInt(providerId)); }
  if (status) { query += ' AND fs.SubmissionStatus = ?'; params.push(status); }
  query += ' ORDER BY fs.SubmissionDate DESC';

  const { results: submissions } = await db.$client.prepare(query).bind(...params).all();

  const { results: fields } = await db.$client.prepare(
    'SELECT FieldId, FieldName, FieldLabel FROM LbfFormField WHERE tenant_id = ? AND FormId = ? AND IsActive = 1 ORDER BY DisplayOrder'
  ).bind(tenantId, formId).all<{ FieldId: number; FieldName: string; FieldLabel: string }>();

  if (format === 'csv') {
    const headers = ['Submission ID', 'Date', 'Patient ID', 'Patient Name', 'Status', ...(fields || []).map(f => f.FieldLabel)];
    const rows = (submissions || []).map((s: Record<string, unknown>) => {
      const formData = s.FormData ? JSON.parse(s.FormData as string) as Record<string, unknown> : {};
      return [
        s.SubmissionId, s.SubmissionDate, s.PatientId, s.PatientName ?? '', s.SubmissionStatus,
        ...(fields || []).map(f => formData[f.FieldName] ?? ''),
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return c.body(csvContent, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${form.FormName}_report.csv"`,
    });
  }

  return c.json({
    Results: {
      form, generatedAt: new Date().toISOString(),
      summary: { totalSubmissions: (submissions || []).length },
      submissions, fields,
    },
  });
});

// ─── Field Management ───────────────────────────────────────────────────────

// POST /:id/fields — add field to form
lbfFormRoutes.post('/:id/fields', zValidator('json', createFieldSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const form = await db.$client.prepare(
    'SELECT FormId FROM LbfForm WHERE tenant_id = ? AND FormId = ? AND IsActive = 1'
  ).bind(tenantId, formId).first();
  if (!form) throw new HTTPException(404, { message: 'Form not found' });

  const existingField = await db.$client.prepare(
    'SELECT FieldId FROM LbfFormField WHERE tenant_id = ? AND FormId = ? AND FieldName = ?'
  ).bind(tenantId, formId, data.FieldName).first();
  if (existingField) throw new HTTPException(400, { message: 'Field name already exists in this form' });

  const result = await db.$client.prepare(`
    INSERT INTO LbfFormField (
      tenant_id, FormId, FieldName, FieldLabel, FieldCode, FieldType, DataType,
      FieldConfig, ValidationRules, ConditionalLogic, OptionList, OptionListId,
      SectionId, DisplayOrder, Placeholder, HelpText, DefaultValue,
      IsRequired, IsReadOnly, IsHidden,
      MinValue, MaxValue, MinLength, MaxLength, Pattern,
      IsGraphable, IsHistorical
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, formId, data.FieldName, data.FieldLabel, data.FieldCode ?? null,
    data.FieldType, data.DataType,
    data.FieldConfig ? JSON.stringify(data.FieldConfig) : null,
    data.ValidationRules ? JSON.stringify(data.ValidationRules) : null,
    data.ConditionalLogic ? JSON.stringify(data.ConditionalLogic) : null,
    data.OptionList ? JSON.stringify(data.OptionList) : null,
    data.OptionListId ?? null, data.SectionId ?? null, data.DisplayOrder,
    data.Placeholder ?? null, data.HelpText ?? null, data.DefaultValue ?? null,
    data.IsRequired ? 1 : 0, data.IsReadOnly ? 1 : 0, data.IsHidden ? 1 : 0,
    data.MinValue ?? null, data.MaxValue ?? null,
    data.MinLength ?? null, data.MaxLength ?? null, data.Pattern ?? null,
    data.IsGraphable ? 1 : 0, data.IsHistorical ? 1 : 0,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /:id/fields/:fieldId — update field
lbfFormRoutes.put('/:id/fields/:fieldId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = Number(c.req.param('id'));
  const fieldId = Number(c.req.param('fieldId'));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const existing = await db.$client.prepare(
    'SELECT FieldId FROM LbfFormField WHERE tenant_id = ? AND FieldId = ? AND FormId = ?'
  ).bind(tenantId, fieldId, formId).first();
  if (!existing) throw new HTTPException(404, { message: 'Field not found' });

  const allowedUpdates = ['FieldLabel', 'DisplayOrder', 'IsRequired', 'FieldConfig', 'ValidationRules', 'ConditionalLogic', 'Placeholder', 'HelpText', 'DefaultValue'];
  const jsonUpdates = ['FieldConfig', 'ValidationRules', 'ConditionalLogic'];

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  for (const key of allowedUpdates) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      if (key === 'IsRequired') { params.push(body[key] ? 1 : 0); }
      else if (jsonUpdates.includes(key)) { params.push(JSON.stringify(body[key])); }
      else { params.push(body[key] as string | number | null); }
    }
  }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  params.push(tenantId, fieldId);
  await db.$client.prepare(`UPDATE LbfFormField SET ${updates.join(', ')} WHERE tenant_id = ? AND FieldId = ?`).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// DELETE /:id/fields/:fieldId — soft delete field
lbfFormRoutes.delete('/:id/fields/:fieldId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = Number(c.req.param('id'));
  const fieldId = Number(c.req.param('fieldId'));

  const existing = await db.$client.prepare(
    'SELECT FieldId FROM LbfFormField WHERE tenant_id = ? AND FieldId = ? AND FormId = ?'
  ).bind(tenantId, fieldId, formId).first();
  if (!existing) throw new HTTPException(404, { message: 'Field not found' });

  const valueCount = await db.$client.prepare(
    'SELECT COUNT(*) as count FROM LbfFieldValue WHERE tenant_id = ? AND FieldId = ?'
  ).bind(tenantId, fieldId).first<{ count: number }>();

  if (valueCount && valueCount.count > 0) {
    throw new HTTPException(400, { message: `Cannot delete field with ${valueCount.count} existing values. Deactivate instead.` });
  }

  await db.$client.prepare(
    'UPDATE LbfFormField SET IsActive = 0 WHERE tenant_id = ? AND FieldId = ? AND FormId = ?'
  ).bind(tenantId, fieldId, formId).run();

  return c.json({ Results: { success: true } });
});

export default lbfFormRoutes;

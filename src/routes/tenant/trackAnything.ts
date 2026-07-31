import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type TrkEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createCategorySchema = z.object({
  CategoryName: z.string().min(1).max(200),
  Description: z.string().max(1000).optional(),
  ParentCategoryId: z.number().int().positive().optional(),
  DisplayOrder: z.number().int().default(0),
});

const updateCategorySchema = createCategorySchema.partial();

const createConfigSchema = z.object({
  CategoryId: z.number().int().positive().optional(),
  PatientId: z.number().int().positive().optional(),
  TrackName: z.string().min(1).max(200),
  TrackDescription: z.string().max(1000).optional(),
  DataType: z.enum(['number', 'text', 'date', 'boolean']).default('number'),
  Units: z.string().max(50).optional(),
  NormalRangeMin: z.number().optional(),
  NormalRangeMax: z.number().optional(),
  CriticalLow: z.number().optional(),
  CriticalHigh: z.number().optional(),
  TargetValue: z.number().optional(),
  DisplayOrder: z.number().int().default(0),
  AllowDecimals: z.number().int().default(1),
  ShowTrend: z.number().int().default(1),
});

const updateConfigSchema = createConfigSchema.partial();

const createDataSchema = z.object({
  ConfigurationId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  PatientVisitId: z.number().int().positive().optional(),
  TrackValue: z.string().min(1),
  TrackDate: z.string().optional(),
  Notes: z.string().max(2000).optional(),
  Source: z.string().max(200).optional(),
});

const updateDataSchema = z.object({
  TrackValue: z.string().optional(),
  TrackDate: z.string().optional(),
  Notes: z.string().max(2000).optional(),
  Source: z.string().max(200).optional(),
});

const createTemplateSchema = z.object({
  TemplateName: z.string().min(1).max(200),
  TemplateDescription: z.string().max(1000).optional(),
  TemplateType: z.enum(['general', 'vitals', 'labs', 'chronic', 'mental-health']).default('general'),
  Items: z.array(z.object({
    TrackName: z.string(),
    TrackDescription: z.string().optional(),
    DataType: z.string().default('number'),
    Units: z.string().optional(),
    NormalRangeMin: z.number().optional(),
    NormalRangeMax: z.number().optional(),
    DisplayOrder: z.number().int().default(0),
  })).optional(),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  categoryId: z.coerce.number().int().positive().optional(),
  configurationId: z.coerce.number().int().positive().optional(),
  isActive: z.coerce.number().int().optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const trendQuerySchema = z.object({
  configurationIds: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const trackAnythingRoutes = new Hono<TrkEnv>();

// GET /stats — tracking statistics
trackAnythingRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const [categoryCount, configCount, dataPointStats] = await Promise.all([
    db.$client.prepare('SELECT COUNT(*) as count FROM TRK_Category WHERE tenant_id = ? AND IsActive = 1').bind(tenantId).first<{ count: number }>(),
    db.$client.prepare('SELECT COUNT(*) as count FROM TRK_Configuration WHERE tenant_id = ? AND IsActive = 1').bind(tenantId).first<{ count: number }>(),
    db.$client.prepare(`
      SELECT COUNT(*) as total, COUNT(DISTINCT PatientId) as uniquePatients
      FROM TRK_Data WHERE tenant_id = ? AND IsActive = 1
    `).bind(tenantId).first<{ total: number; uniquePatients: number }>(),
  ]);

  return c.json({
    Results: {
      categories: categoryCount?.count || 0,
      configurations: configCount?.count || 0,
      dataPoints: { total: dataPointStats?.total || 0, uniquePatients: dataPointStats?.uniquePatients || 0 },
    },
  });
});

// ─── Categories ─────────────────────────────────────────────────────────────

trackAnythingRoutes.get('/categories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT c.*, p.CategoryName as ParentCategoryName
    FROM TRK_Category c
    LEFT JOIN TRK_Category p ON c.ParentCategoryId = p.CategoryId AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.IsActive = 1
    ORDER BY c.DisplayOrder, c.CategoryName
  `).bind(tenantId).all();

  return c.json({ Results: results });
});

trackAnythingRoutes.post('/categories', zValidator('json', createCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO TRK_Category (tenant_id, CategoryName, Description, ParentCategoryId, DisplayOrder, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.CategoryName, data.Description ?? null, data.ParentCategoryId ?? null, data.DisplayOrder, userId).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

trackAnythingRoutes.put('/categories/:id', zValidator('json', updateCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { success: true } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client.prepare(
    `UPDATE TRK_Category SET ${sets}, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND CategoryId = ?`
  ).bind(...vals, userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

trackAnythingRoutes.delete('/categories/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    "UPDATE TRK_Category SET IsActive = 0, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND CategoryId = ?"
  ).bind(tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Configurations ─────────────────────────────────────────────────────────

trackAnythingRoutes.get('/configs', zValidator('query', querySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, categoryId, isActive, search } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT c.*, cat.CategoryName
    FROM TRK_Configuration c
    LEFT JOIN TRK_Category cat ON c.CategoryId = cat.CategoryId AND cat.tenant_id = c.tenant_id
    WHERE c.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (categoryId) { query += ' AND c.CategoryId = ?'; params.push(categoryId); }
  if (isActive !== undefined) { query += ' AND c.IsActive = ?'; params.push(isActive); }
  else { query += ' AND c.IsActive = 1'; }
  if (search) { query += ' AND (c.TrackName LIKE ? OR c.TrackDescription LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY c.DisplayOrder, c.TrackName LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // total count
  let countQuery = 'SELECT COUNT(*) as total FROM TRK_Configuration WHERE tenant_id = ?';
  const countParams: (string | number)[] = [tenantId];
  if (categoryId) { countQuery += ' AND CategoryId = ?'; countParams.push(categoryId); }
  if (isActive !== undefined) { countQuery += ' AND IsActive = ?'; countParams.push(isActive); }
  else { countQuery += ' AND IsActive = 1'; }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({
    Results: results,
    Pagination: { total: countResult?.total ?? 0, page, limit, totalPages: Math.ceil((countResult?.total ?? 0) / limit) },
  });
});

trackAnythingRoutes.get('/configs/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await db.$client.prepare(`
    SELECT c.*, cat.CategoryName
    FROM TRK_Configuration c
    LEFT JOIN TRK_Category cat ON c.CategoryId = cat.CategoryId AND cat.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.ConfigurationId = ?
  `).bind(tenantId, id).first();

  if (!result) throw new HTTPException(404, { message: 'Configuration not found' });
  return c.json({ Results: result });
});

trackAnythingRoutes.post('/configs', zValidator('json', createConfigSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO TRK_Configuration (
      tenant_id, CategoryId, PatientId, TrackName, TrackDescription, DataType, Units,
      NormalRangeMin, NormalRangeMax, CriticalLow, CriticalHigh, TargetValue,
      DisplayOrder, AllowDecimals, ShowTrend, CreatedBy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.CategoryId ?? null, data.PatientId ?? null,
    data.TrackName, data.TrackDescription ?? null, data.DataType, data.Units ?? null,
    data.NormalRangeMin ?? null, data.NormalRangeMax ?? null,
    data.CriticalLow ?? null, data.CriticalHigh ?? null, data.TargetValue ?? null,
    data.DisplayOrder, data.AllowDecimals, data.ShowTrend, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

trackAnythingRoutes.put('/configs/:id', zValidator('json', updateConfigSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { success: true } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v ?? null);

  await db.$client.prepare(
    `UPDATE TRK_Configuration SET ${sets}, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND ConfigurationId = ?`
  ).bind(...vals, userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

trackAnythingRoutes.delete('/configs/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    "UPDATE TRK_Configuration SET IsActive = 0, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND ConfigurationId = ?"
  ).bind(tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Data ───────────────────────────────────────────────────────────────────

trackAnythingRoutes.get('/patient/:id/data', zValidator('query', querySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('id'));
  const { page, limit, configurationId, startDate, endDate } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT d.*, cfg.TrackName, cfg.Units, cfg.DataType
    FROM TRK_Data d
    INNER JOIN TRK_Configuration cfg ON d.ConfigurationId = cfg.ConfigurationId AND cfg.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.PatientId = ? AND d.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId, patientId];

  if (configurationId) { query += ' AND d.ConfigurationId = ?'; params.push(configurationId); }
  if (startDate) { query += ' AND d.TrackDate >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND d.TrackDate <= ?'; params.push(endDate); }

  query += ' ORDER BY d.TrackDate DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM TRK_Data WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1';
  const countParams: (string | number)[] = [tenantId, patientId];
  if (configurationId) { countQuery += ' AND ConfigurationId = ?'; countParams.push(configurationId); }
  if (startDate) { countQuery += ' AND TrackDate >= ?'; countParams.push(startDate); }
  if (endDate) { countQuery += ' AND TrackDate <= ?'; countParams.push(endDate); }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({
    Results: results,
    Pagination: { total: countResult?.total ?? 0, page, limit, totalPages: Math.ceil((countResult?.total ?? 0) / limit) },
  });
});

trackAnythingRoutes.post('/data', zValidator('json', createDataSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const config = await db.$client.prepare(
    'SELECT DataType FROM TRK_Configuration WHERE tenant_id = ? AND ConfigurationId = ?'
  ).bind(tenantId, data.ConfigurationId).first<{ DataType: string }>();

  if (!config) throw new HTTPException(404, { message: 'Configuration not found' });

  let numericValue: number | null = null;
  if (config.DataType === 'number') {
    numericValue = parseFloat(data.TrackValue);
    if (isNaN(numericValue)) throw new HTTPException(400, { message: 'Invalid numeric value' });
  }

  const result = await db.$client.prepare(`
    INSERT INTO TRK_Data (tenant_id, ConfigurationId, PatientId, PatientVisitId, TrackValue, NumericValue, TrackDate, Notes, Source, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.ConfigurationId, data.PatientId, data.PatientVisitId ?? null,
    data.TrackValue, numericValue, data.TrackDate ?? new Date().toISOString(),
    data.Notes ?? null, data.Source ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

trackAnythingRoutes.put('/data/:id', zValidator('json', updateDataSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { success: true } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v ?? null);

  await db.$client.prepare(
    `UPDATE TRK_Data SET ${sets}, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND DataId = ?`
  ).bind(...vals, userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

trackAnythingRoutes.delete('/data/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    "UPDATE TRK_Data SET IsActive = 0, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND DataId = ?"
  ).bind(tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Trends ─────────────────────────────────────────────────────────────────

trackAnythingRoutes.get('/patient/:id/trends', zValidator('query', trendQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('id'));
  const { configurationIds, startDate, endDate, limit } = c.req.valid('query');

  const configIdList = configurationIds ? configurationIds.split(',').map(id => parseInt(id.trim())).filter(n => !isNaN(n)) : [];

  let query = `
    SELECT d.*, cfg.TrackName, cfg.Units, cfg.DataType, cfg.NormalRangeMin, cfg.NormalRangeMax
    FROM TRK_Data d
    INNER JOIN TRK_Configuration cfg ON d.ConfigurationId = cfg.ConfigurationId AND cfg.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.PatientId = ? AND d.IsActive = 1 AND cfg.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId, patientId];

  if (configIdList.length > 0) {
    query += ` AND d.ConfigurationId IN (${configIdList.map(() => '?').join(',')})`;
    params.push(...configIdList);
  }
  if (startDate) { query += ' AND d.TrackDate >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND d.TrackDate <= ?'; params.push(endDate); }

  query += ' ORDER BY d.ConfigurationId, d.TrackDate ASC LIMIT ?';
  params.push(limit);

  const results = await db.$client.prepare(query).bind(...params).all<Record<string, unknown>>();

  const trends: Record<number, { DataId: unknown; TrackValue: unknown; NumericValue: unknown; TrackDate: unknown; Notes: unknown }[]> = {};
  const configs: Record<number, { TrackName: unknown; Units: unknown; DataType: unknown; NormalRangeMin: unknown; NormalRangeMax: unknown }> = {};

  (results.results || []).forEach((row) => {
    const configId = row.ConfigurationId as number;
    if (!trends[configId]) {
      trends[configId] = [];
      configs[configId] = {
        TrackName: row.TrackName, Units: row.Units, DataType: row.DataType,
        NormalRangeMin: row.NormalRangeMin, NormalRangeMax: row.NormalRangeMax,
      };
    }
    trends[configId].push({
      DataId: row.DataId, TrackValue: row.TrackValue,
      NumericValue: row.NumericValue, TrackDate: row.TrackDate, Notes: row.Notes,
    });
  });

  const statistics: Record<number, { count: number; average: number; min: number; max: number; latest: number }> = {};
  Object.entries(trends).forEach(([configId, data]) => {
    const numericValues = data.filter(d => d.NumericValue !== null).map(d => d.NumericValue as number);
    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      statistics[parseInt(configId)] = {
        count: numericValues.length,
        average: parseFloat((sum / numericValues.length).toFixed(2)),
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        latest: numericValues[numericValues.length - 1],
      };
    }
  });

  return c.json({ Results: { patientId, trends, configurations: configs, statistics } });
});

// ─── Templates ──────────────────────────────────────────────────────────────

trackAnythingRoutes.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results: templates } = await db.$client.prepare(
    'SELECT * FROM TRK_Template WHERE tenant_id = ? AND IsActive = 1 ORDER BY TemplateName'
  ).bind(tenantId).all();

  const templatesWithItems = await Promise.all(
    (templates || []).map(async (template: Record<string, unknown>) => {
      const { results: items } = await db.$client.prepare(
        'SELECT * FROM TRK_TemplateItem WHERE tenant_id = ? AND TemplateId = ? ORDER BY DisplayOrder'
      ).bind(tenantId, template.TemplateId).all();
      return { ...template, Items: items || [] };
    }),
  );

  return c.json({ Results: templatesWithItems });
});

trackAnythingRoutes.post('/templates', zValidator('json', createTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO TRK_Template (tenant_id, TemplateName, TemplateDescription, TemplateType, CreatedBy)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.TemplateName, data.TemplateDescription ?? null, data.TemplateType, userId).run();

  const templateId = result.meta.last_row_id;

  if (data.Items?.length) {
    for (const item of data.Items) {
      await db.$client.prepare(`
        INSERT INTO TRK_TemplateItem (tenant_id, TemplateId, TrackName, TrackDescription, DataType, Units, NormalRangeMin, NormalRangeMax, DisplayOrder)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(tenantId, templateId, item.TrackName, item.TrackDescription ?? null, item.DataType, item.Units ?? null, item.NormalRangeMin ?? null, item.NormalRangeMax ?? null, item.DisplayOrder).run();
    }
  }

  return c.json({ Results: { id: templateId } }, 201);
});

trackAnythingRoutes.post('/templates/:id/apply', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const templateId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as { categoryId?: number; patientId?: number };

  const { results: items } = await db.$client.prepare(
    'SELECT * FROM TRK_TemplateItem WHERE tenant_id = ? AND TemplateId = ? ORDER BY DisplayOrder'
  ).bind(tenantId, templateId).all();

  const createdConfigs: number[] = [];

  for (const item of (items || []) as Record<string, unknown>[]) {
    const result = await db.$client.prepare(`
      INSERT INTO TRK_Configuration (
        tenant_id, CategoryId, PatientId, TrackName, TrackDescription, DataType, Units,
        NormalRangeMin, NormalRangeMax, DisplayOrder, CreatedBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, body.categoryId ?? null, body.patientId ?? null,
      item.TrackName, item.TrackDescription ?? null, item.DataType,
      item.Units ?? null, item.NormalRangeMin ?? null, item.NormalRangeMax ?? null,
      item.DisplayOrder ?? 0, userId,
    ).run();
    createdConfigs.push(result.meta.last_row_id);
  }

  return c.json({ Results: { templateId, createdConfigurations: createdConfigs, count: createdConfigs.length } });
});

// ─── Export ─────────────────────────────────────────────────────────────────

trackAnythingRoutes.get('/export/patient/:id/csv', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('id'));
  const { configurationId, startDate, endDate } = c.req.query();

  let query = `
    SELECT d.TrackDate, cfg.TrackName, d.TrackValue, cfg.Units, d.Notes
    FROM TRK_Data d
    INNER JOIN TRK_Configuration cfg ON d.ConfigurationId = cfg.ConfigurationId AND cfg.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.PatientId = ? AND d.IsActive = 1 AND cfg.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId, patientId];

  if (configurationId) { query += ' AND d.ConfigurationId = ?'; params.push(parseInt(configurationId)); }
  if (startDate) { query += ' AND d.TrackDate >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND d.TrackDate <= ?'; params.push(endDate); }
  query += ' ORDER BY d.TrackDate DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all<Record<string, unknown>>();

  const rows = [['Date', 'Parameter', 'Value', 'Units', 'Notes']];
  (results || []).forEach((row) => {
    rows.push([
      String(row.TrackDate ?? ''), String(row.TrackName ?? ''),
      String(row.TrackValue ?? ''), String(row.Units ?? ''), String(row.Notes ?? ''),
    ]);
  });

  const csvContent = rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');

  return c.body(csvContent, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="track_anything_patient_${patientId}.csv"`,
  });
});

export default trackAnythingRoutes;

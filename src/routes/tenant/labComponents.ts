import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const labComponents = new Hono<{ Bindings: Env; Variables: Variables }>();

labComponents.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LAB TEST COMPONENTS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

const componentSchema = z.object({
  lab_test_id: z.number().int().positive(),
  component_code: z.string().min(1).optional(),
  component_name: z.string().min(1),
  group_name: z.string().optional(),
  indentation_count: z.number().int().min(0).default(0),
  display_sequence: z.number().int().min(0).default(0),
  unit: z.string().optional(),
  value_type: z.enum(['numeric', 'text', 'coded', 'calculated']).default('numeric'),
  normal_range: z.string().optional(),
  critical_low: z.number().optional(),
  critical_high: z.number().optional(),
  is_auto_calculate: z.boolean().default(false),
  calculation_formula: z.string().optional(),
  formula_description: z.string().optional(),
  is_mandatory: z.boolean().default(true),
  show_in_report: z.boolean().default(true),
});

labComponents.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const testId = c.req.query('test_id');

  let where = 'WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (testId) { where += ' AND lab_test_id = ?'; params.push(Number(testId)); }

  const rows = await db.$client.prepare(`
    SELECT c.*, t.name as test_name, t.code as test_code
    FROM lab_test_components c
    JOIN lab_test_catalog t ON c.lab_test_id = t.id
    ${where}
    ORDER BY c.display_sequence
  `).bind(...params).all();

  return c.json({ data: rows.results });
});

labComponents.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const row = await db.$client.prepare(`
    SELECT c.*, t.name as test_name
    FROM lab_test_components c
    JOIN lab_test_catalog t ON c.lab_test_id = t.id
    WHERE c.id = ? AND c.tenant_id = ? AND c.is_active = 1
  `).bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Component not found' });
  return c.json(row);
});

labComponents.post('/', zValidator('json', componentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Validate formula if auto-calculate
  if (data.is_auto_calculate && data.calculation_formula) {
    const placeholderCount = (data.calculation_formula.match(/\{[^}]+\}/g) || []).length;
    if (placeholderCount === 0) {
      throw new HTTPException(400, { message: 'Auto-calculate formula must contain at least one {component_code} placeholder' });
    }
  }

  const result = await db.$client.prepare(`
    INSERT INTO lab_test_components
      (lab_test_id, component_code, component_name, group_name, indentation_count, display_sequence, unit, value_type, normal_range, critical_low, critical_high, is_auto_calculate, calculation_formula, formula_description, is_mandatory, show_in_report, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.lab_test_id, data.component_code ?? null, data.component_name, data.group_name ?? null,
    data.indentation_count, data.display_sequence, data.unit ?? null, data.value_type,
    data.normal_range ?? null, data.critical_low ?? null, data.critical_high ?? null,
    data.is_auto_calculate ? 1 : 0, data.calculation_formula ?? null, data.formula_description ?? null,
    data.is_mandatory ? 1 : 0, data.show_in_report ? 1 : 0, tenantId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Component created' }, 201);
});

labComponents.put('/:id', zValidator('json', componentSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare('SELECT id FROM lab_test_components WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Component not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const fields: Array<[string, unknown]> = [
    ['component_code', data.component_code],
    ['component_name', data.component_name],
    ['group_name', data.group_name],
    ['indentation_count', data.indentation_count],
    ['display_sequence', data.display_sequence],
    ['unit', data.unit],
    ['value_type', data.value_type],
    ['normal_range', data.normal_range],
    ['critical_low', data.critical_low],
    ['critical_high', data.critical_high],
    ['is_auto_calculate', data.is_auto_calculate !== undefined ? (data.is_auto_calculate ? 1 : 0) : undefined],
    ['calculation_formula', data.calculation_formula],
    ['formula_description', data.formula_description],
    ['is_mandatory', data.is_mandatory !== undefined ? (data.is_mandatory ? 1 : 0) : undefined],
    ['show_in_report', data.show_in_report !== undefined ? (data.show_in_report ? 1 : 0) : undefined],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) { sets.push(`${col} = ?`); vals.push(val as string | number | null); }
  }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  vals.push(id, tenantId);
  await db.$client.prepare(`UPDATE lab_test_components SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  return c.json({ message: 'Component updated' });
});

labComponents.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  await db.$client.prepare('UPDATE lab_test_components SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'Component deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. REFERENCE RANGES CRUD
// ═══════════════════════════════════════════════════════════════════════════════

const rangeSchema = z.object({
  lab_test_id: z.number().int().positive().optional(),
  test_name: z.string().optional(), // for frontend: look up test by name
  component_id: z.number().int().positive().optional(),
  gender: z.enum(['male', 'female', 'both', 'all']).default('both'),
  age_min_months: z.number().int().min(0).optional(),
  age_max_months: z.number().int().optional(),
  // Frontend field names
  age_from: z.union([z.string(), z.number()]).optional(),
  age_to: z.union([z.string(), z.number()]).optional(),
  range_low: z.number().optional(),
  range_high: z.number().optional(),
  // Frontend field names
  min_value: z.union([z.string(), z.number()]).optional(),
  max_value: z.union([z.string(), z.number()]).optional(),
  range_text: z.string().optional(),
  unit: z.string().optional(),
  is_critical: z.boolean().default(false),
  notes: z.string().optional(),
});

labComponents.get('/reference-ranges', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const testId = c.req.query('test_id');

  let where = 'WHERE r.tenant_id = ? AND r.is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (testId) { where += ' AND r.lab_test_id = ?'; params.push(Number(testId)); }

  const rows = await db.$client.prepare(`
    SELECT r.*, t.name as test_name, t.code as test_code, c.component_name
    FROM lab_reference_ranges r
    JOIN lab_test_catalog t ON r.lab_test_id = t.id
    LEFT JOIN lab_test_components c ON r.component_id = c.id
    ${where}
    ORDER BY r.lab_test_id, r.gender, r.age_min_months
  `).bind(...params).all();

  // Transform camelCase to snake_case for frontend compatibility
  const data = (rows.results || []).map((r: any) => ({
    id: r.id,
    lab_test_id: r.labTestId,
    test_name: r.testName,
    test_code: r.testCode,
    component_id: r.componentId,
    component_name: r.componentName,
    gender: r.gender,
    age_from: r.ageMinMonths != null ? Math.floor(r.ageMinMonths / 12) : null,
    age_to: r.ageMaxMonths != null ? Math.floor(r.ageMaxMonths / 12) : null,
    age_min_months: r.ageMinMonths,
    age_max_months: r.ageMaxMonths,
    min_value: r.rangeLow,
    max_value: r.rangeHigh,
    range_low: r.rangeLow,
    range_high: r.rangeHigh,
    range_text: r.rangeText,
    unit: r.unit,
    is_critical: r.isCritical,
    notes: r.notes,
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));

  return c.json({ data });
});

labComponents.post('/reference-ranges', zValidator('json', rangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  // Normalize gender: frontend uses 'all', backend uses 'both'
  const gender = data.gender === 'all' ? 'both' : data.gender;

  // Convert frontend field names to backend names
  const ageMinMonths = data.age_min_months ?? (data.age_from ? Number(data.age_from) * 12 : undefined);
  const ageMaxMonths = data.age_max_months ?? (data.age_to ? Number(data.age_to) * 12 : undefined);
  const rangeLow = data.range_low ?? (data.min_value !== undefined && data.min_value !== '' ? Number(data.min_value) : undefined);
  const rangeHigh = data.range_high ?? (data.max_value !== undefined && data.max_value !== '' ? Number(data.max_value) : undefined);

  // Resolve lab_test_id: use directly if number, otherwise look up by test_name
  let labTestId = data.lab_test_id;
  if (!labTestId && data.test_name) {
    const test = await db.$client.prepare(
      'SELECT id FROM lab_test_catalog WHERE name = ? AND tenant_id = ? AND is_active = 1 LIMIT 1'
    ).bind(data.test_name, tenantId).first<{ id: number }>();
    if (test) {
      labTestId = test.id;
    } else {
      throw new HTTPException(400, { message: `Test not found: ${data.test_name}` });
    }
  }

  if (!labTestId) {
    throw new HTTPException(400, { message: 'lab_test_id or test_name is required' });
  }

  const result = await db.$client.prepare(`
    INSERT INTO lab_reference_ranges
      (lab_test_id, component_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, is_critical, notes, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    labTestId, data.component_id ?? null, gender ?? 'both', ageMinMonths ?? 0,
    ageMaxMonths ?? null, rangeLow ?? null, rangeHigh ?? null,
    data.range_text ?? data.unit ?? null, data.is_critical ? 1 : 0, data.notes ?? null, tenantId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Reference range created' }, 201);
});

labComponents.put('/reference-ranges/:id', zValidator('json', rangeSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const fields: Array<[string, unknown]> = [
    ['gender', data.gender],
    ['age_min_months', data.age_min_months],
    ['age_max_months', data.age_max_months],
    ['range_low', data.range_low],
    ['range_high', data.range_high],
    ['range_text', data.range_text],
    ['is_critical', data.is_critical !== undefined ? (data.is_critical ? 1 : 0) : undefined],
    ['notes', data.notes],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) { sets.push(`${col} = ?`); vals.push(val as string | number | null); }
  }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  vals.push(id, tenantId);
  await db.$client.prepare(`UPDATE lab_reference_ranges SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  return c.json({ message: 'Reference range updated' });
});

labComponents.delete('/reference-ranges/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  await db.$client.prepare('UPDATE lab_reference_ranges SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'Reference range deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET MATCHING REFERENCE RANGE FOR PATIENT
// ═══════════════════════════════════════════════════════════════════════════════

labComponents.get('/reference-ranges/match', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const testId = c.req.query('test_id');
  const componentId = c.req.query('component_id');
  const gender = c.req.query('gender'); // 'M' or 'F'
  const ageMonths = c.req.query('age_months');

  if (!testId || !gender || !ageMonths) {
    throw new HTTPException(400, { message: 'test_id, gender, and age_months required' });
  }

  const ageM = parseInt(ageMonths, 10);
  const genderFilter = gender.toLowerCase().startsWith('m') ? 'male' : 'female';

  const row = await db.$client.prepare(`
    SELECT * FROM lab_reference_ranges
    WHERE tenant_id = ? AND lab_test_id = ? AND is_active = 1
      AND (component_id = ? OR (component_id IS NULL AND ? IS NULL))
      AND (gender = ? OR gender = 'both')
      AND age_min_months <= ?
      AND (age_max_months IS NULL OR age_max_months >= ?)
    ORDER BY 
      CASE WHEN gender = ? THEN 0 ELSE 1 END,
      age_max_months ASC NULLS LAST
    LIMIT 1
  `).bind(tenantId, Number(testId), componentId ? Number(componentId) : null, componentId ? Number(componentId) : null, genderFilter, ageM, ageM, genderFilter).first();

  return c.json({ matched: !!row, range: row });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REJECTION REASONS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

labComponents.get('/rejection-reasons', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT * FROM lab_rejection_reasons
    WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1
    ORDER BY category, reason_text
  `).bind(tenantId).all();

  return c.json({ data: rows.results });
});

labComponents.post('/rejection-reasons', zValidator('json', z.object({
  // Frontend field names
  reason: z.string().min(1).optional(),
  code: z.string().optional(),
  category: z.string().default('others'),
  is_active: z.boolean().optional(),
  // Backend field names (alternate)
  reason_code: z.string().min(1).optional(),
  reason_text: z.string().min(1).optional(),
  reason_text_bn: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  // Normalize field names from frontend to backend
  const reasonText = data.reason_text ?? data.reason ?? 'Unknown';
  const reasonCode = data.reason_code ?? data.code ?? null;
  const reasonTextBn = data.reason_text_bn ?? null;

  // Normalize category: frontend uses 'pre_analytical', 'analytical', 'post_analytical'
  // Backend schema uses: hemolysis, clotted, insufficient, wrong_container, label_error, broken, others
  const categoryMap: Record<string, string> = {
    pre_analytical: 'others',
    analytical: 'others',
    post_analytical: 'others',
  };
  const category = categoryMap[data.category] ?? data.category ?? 'others';

  const result = await db.$client.prepare(`
    INSERT INTO lab_rejection_reasons (reason_code, reason_text, reason_text_bn, category, tenant_id)
    VALUES (?, ?, ?, ?, ?)
  `).bind(reasonCode, reasonText, reasonTextBn, category, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Rejection reason created' }, 201);
});

labComponents.delete('/rejection-reasons/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  await db.$client.prepare('UPDATE lab_rejection_reasons SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'Rejection reason deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GOVERNMENT REPORT ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

labComponents.get('/gov-report-items', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT * FROM lab_gov_report_items
    WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1
    ORDER BY serial_number
  `).bind(tenantId).all();

  return c.json({ data: rows.results });
});

labComponents.get('/gov-report-mappings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT m.*, g.item_name, g.item_name_bn, t.name as test_name, t.code as test_code, c.component_name
    FROM lab_gov_report_mappings m
    JOIN lab_gov_report_items g ON m.gov_item_id = g.id
    LEFT JOIN lab_test_catalog t ON m.lab_test_id = t.id
    LEFT JOIN lab_test_components c ON m.component_id = c.id
    WHERE m.tenant_id = ? AND m.is_active = 1
    ORDER BY g.serial_number
  `).bind(tenantId).all();

  return c.json({ data: rows.results });
});

labComponents.post('/gov-report-mappings', zValidator('json', z.object({
  gov_item_id: z.number().int().positive(),
  lab_test_id: z.number().int().positive().optional(),
  component_id: z.number().int().positive().optional(),
  is_component_based: z.boolean().default(false),
  count_method: z.enum(['all','positive','negative','abnormal']).default('all'),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_gov_report_mappings (gov_item_id, lab_test_id, component_id, is_component_based, count_method, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(data.gov_item_id, data.lab_test_id ?? null, data.component_id ?? null, data.is_component_based ? 1 : 0, data.count_method, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Government report mapping created' }, 201);
});

labComponents.delete('/gov-report-mappings/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  await db.$client.prepare('UPDATE lab_gov_report_mappings SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'Mapping deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GENERATE GOVERNMENT REPORT
// ═══════════════════════════════════════════════════════════════════════════════

labComponents.get('/gov-reports/generate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const fromDate = c.req.query('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const toDate = c.req.query('to') || new Date().toISOString().split('T')[0];

  // Get all mapped items
  const mappings = await db.$client.prepare(`
    SELECT m.*, g.item_name, g.item_name_bn, g.serial_number
    FROM lab_gov_report_mappings m
    JOIN lab_gov_report_items g ON m.gov_item_id = g.id
    WHERE m.tenant_id = ? AND m.is_active = 1
    ORDER BY g.serial_number
  `).bind(tenantId).all<{ gov_item_id: number; item_name: string; item_name_bn: string; serial_number: number; lab_test_id: number | null; component_id: number | null; count_method: string }>();

  const results: Array<{ serial_number: number; item_name: string; item_name_bn: string; count: number; count_method: string }> = [];

  for (const map of (mappings.results ?? [])) {
    let count = 0;

    if (map.lab_test_id) {
      const countQuery = map.count_method === 'all'
        ? `SELECT COUNT(*) as cnt FROM lab_order_items loi
           JOIN lab_orders lo ON loi.lab_order_id = lo.id
           WHERE loi.lab_test_id = ? AND lo.tenant_id = ? AND lo.order_date BETWEEN ? AND ? AND loi.status = 'completed'`
        : map.count_method === 'positive'
        ? `SELECT COUNT(*) as cnt FROM lab_results lr
           JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
           JOIN lab_orders lo ON lrp.lab_order_id = lo.id
           WHERE lr.lab_test_id = ? AND lo.tenant_id = ? AND lo.order_date BETWEEN ? AND ? AND lr.abnormal_flag = 'high'`
        : map.count_method === 'abnormal'
        ? `SELECT COUNT(*) as cnt FROM lab_results lr
           JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
           JOIN lab_orders lo ON lrp.lab_order_id = lo.id
           WHERE lr.lab_test_id = ? AND lo.tenant_id = ? AND lo.order_date BETWEEN ? AND ? AND lr.abnormal_flag IN ('high','low','critical')`
        : `SELECT COUNT(*) as cnt FROM lab_order_items loi
           JOIN lab_orders lo ON loi.lab_order_id = lo.id
           WHERE loi.lab_test_id = ? AND lo.tenant_id = ? AND lo.order_date BETWEEN ? AND ? AND loi.status = 'completed'`;

      const countResult = await db.$client.prepare(countQuery).bind(map.lab_test_id, tenantId, fromDate, toDate).first<{ cnt: number }>();
      count = countResult?.cnt ?? 0;
    }

    results.push({
      serial_number: map.serial_number,
      item_name: map.item_name,
      item_name_bn: map.item_name_bn,
      count,
      count_method: map.count_method,
    });
  }

  return c.json({ from: fromDate, to: toDate, data: results });
});

export default labComponents;

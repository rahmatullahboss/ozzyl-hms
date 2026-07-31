import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  createLabCategorySchema, updateLabCategorySchema,
  createLabTemplateSchema, updateLabTemplateSchema,
  createLabVendorSchema, updateLabVendorSchema,
  createRunNumberSettingsSchema,
} from '../../schemas/labSettings';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const labSettings = new Hono<{ Bindings: Env; Variables: Variables }>();

labSettings.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director', 'md'));

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

// ═══════════════════════════════════════════════════════════════════
// LAB TEST CATEGORIES
// ═══════════════════════════════════════════════════════════════════

labSettings.get('/categories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    `SELECT id, category_name, NULL as category_code, description, is_active, tenant_id, created_at, updated_at
     FROM lab_test_categories
     WHERE tenant_id = ? AND is_active = 1
     UNION
     SELECT
       category as id,
       category as category_name,
       NULL as category_code,
       'Catalog category' as description,
       1 as is_active,
       tenant_id,
       MIN(created_at) as created_at,
       NULL as updated_at
     FROM lab_test_catalog
     WHERE tenant_id = ?
       AND COALESCE(is_active, 1) = 1
       AND category IS NOT NULL
       AND TRIM(category) != ''
       AND NOT EXISTS (
         SELECT 1
         FROM lab_test_categories c
         WHERE c.tenant_id = lab_test_catalog.tenant_id
           AND c.is_active = 1
           AND LOWER(c.category_name) = LOWER(lab_test_catalog.category)
       )
     GROUP BY tenant_id, category
     ORDER BY category_name`
  ).bind(tenantId, tenantId).all();
  return c.json({ data: results });
});

labSettings.post('/categories', zValidator('json', createLabCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_test_categories (category_name, description, tenant_id, created_by)
    VALUES (?, ?, ?, ?)
  `).bind(data.category_name, data.description ?? null, tenantId, userId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Category created' }, 201);
});

labSettings.put('/categories/:id', zValidator('json', updateLabCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.category_name !== undefined) { updates.push('category_name = ?'); values.push(data.category_name); }
  if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE lab_test_categories SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...values).run();
  return c.json({ message: 'Category updated' });
});

labSettings.delete('/categories/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const result = await db.$client.prepare(
    'UPDATE lab_test_categories SET is_active = 0 WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Category not found' });
  return c.json({ message: 'Category deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// LAB REPORT TEMPLATES
// ═══════════════════════════════════════════════════════════════════

labSettings.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM lab_report_templates WHERE tenant_id = ? AND is_active = 1 ORDER BY display_order, template_name'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

labSettings.post('/templates', zValidator('json', createLabTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_report_templates (template_name, template_short_name, template_type, template_html,
      header_text, footer_text, display_order, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.template_name, data.template_short_name ?? null, data.template_type,
    data.template_html ?? null, data.header_text ?? null, data.footer_text ?? null,
    data.display_order, tenantId, userId
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Template created' }, 201);
});

labSettings.put('/templates/:id', zValidator('json', updateLabTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.template_name !== undefined) { updates.push('template_name = ?'); values.push(data.template_name); }
  if (data.template_short_name !== undefined) { updates.push('template_short_name = ?'); values.push(data.template_short_name); }
  if (data.template_type !== undefined) { updates.push('template_type = ?'); values.push(data.template_type); }
  if (data.template_html !== undefined) { updates.push('template_html = ?'); values.push(data.template_html); }
  if (data.header_text !== undefined) { updates.push('header_text = ?'); values.push(data.header_text); }
  if (data.footer_text !== undefined) { updates.push('footer_text = ?'); values.push(data.footer_text); }
  if (data.display_order !== undefined) { updates.push('display_order = ?'); values.push(data.display_order); }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE lab_report_templates SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...values).run();
  return c.json({ message: 'Template updated' });
});

labSettings.delete('/templates/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const result = await db.$client.prepare(
    'UPDATE lab_report_templates SET is_active = 0 WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Template not found' });
  return c.json({ message: 'Template deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// LAB VENDORS
// ═══════════════════════════════════════════════════════════════════

labSettings.get('/vendors', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM lab_vendors WHERE tenant_id = ? AND is_active = 1 ORDER BY vendor_name'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

labSettings.post('/vendors', zValidator('json', createLabVendorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_vendors (vendor_code, vendor_name, is_external, contact_address, contact_no, email, remarks, is_default, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.vendor_code ?? null, data.vendor_name, data.is_external ? 1 : 0,
    data.contact_address ?? null, data.contact_no ?? null, data.email ?? null,
    data.remarks ?? null, data.is_default ? 1 : 0, tenantId, userId
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Vendor created' }, 201);
});

labSettings.put('/vendors/:id', zValidator('json', updateLabVendorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM lab_vendors WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Vendor not found' });

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.vendor_name !== undefined) { updates.push('vendor_name = ?'); values.push(data.vendor_name); }
  if (data.vendor_code !== undefined) { updates.push('vendor_code = ?'); values.push(data.vendor_code); }
  if (data.is_external !== undefined) { updates.push('is_external = ?'); values.push(data.is_external ? 1 : 0); }
  if (data.contact_address !== undefined) { updates.push('contact_address = ?'); values.push(data.contact_address); }
  if (data.contact_no !== undefined) { updates.push('contact_no = ?'); values.push(data.contact_no); }
  if (data.email !== undefined) { updates.push('email = ?'); values.push(data.email); }
  if (data.remarks !== undefined) { updates.push('remarks = ?'); values.push(data.remarks); }
  if (data.is_default !== undefined) { updates.push('is_default = ?'); values.push(data.is_default ? 1 : 0); }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE lab_vendors SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...values).run();
  return c.json({ message: 'Vendor updated' });
});

labSettings.delete('/vendors/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const result = await db.$client.prepare(
    'UPDATE lab_vendors SET is_active = 0 WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Vendor not found' });
  return c.json({ message: 'Vendor deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// RUN NUMBER SETTINGS
// ═══════════════════════════════════════════════════════════════════

labSettings.get('/run-number-settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM lab_run_number_settings WHERE tenant_id = ? AND is_active = 1 ORDER BY format_name'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

labSettings.post('/run-number-settings', zValidator('json', createRunNumberSettingsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_run_number_settings
      (format_name, grouping_index, visit_type, run_number_type, reset_daily, reset_monthly, reset_yearly,
       starting_letter, format_initial_part, format_separator, format_last_part, under_insurance, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.format_name, data.grouping_index ?? null, data.visit_type ?? null,
    data.run_number_type ?? null, data.reset_daily ? 1 : 0,
    data.reset_monthly ? 1 : 0, data.reset_yearly ? 1 : 0,
    data.starting_letter ?? null, data.format_initial_part ?? null,
    data.format_separator, data.format_last_part ?? null,
    data.under_insurance ? 1 : 0, tenantId
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Run number settings created' }, 201);
});

export default labSettings;

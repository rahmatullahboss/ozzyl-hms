import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId, parseId } from '../../../lib/context-helpers';
import { requireRole } from '../../../middleware/rbac';
import {
  createImagingTypeSchema,
  updateImagingTypeSchema,
  createImagingItemSchema,
  updateImagingItemSchema,
  createReportTemplateSchema,
  updateReportTemplateSchema,
  createFilmTypeSchema,
  updateFilmTypeSchema,
} from '../../../schemas/radiology';
import { upsertDiagnosticBillingServiceItem } from '../../../lib/diagnostic-catalog';
import { RIS_CATALOG_MANAGE_ROLES, RIS_READ_ROLES } from '../lab/_permissions';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// P0-15: doctors must NOT be allowed to mutate the RIS catalog. Use the
// tighter RIS_CATALOG_MANAGE_ROLES set (radiologist/ris_admin/admin/director/md).
const RAD_READ  = RIS_READ_ROLES;
const RAD_WRITE = RIS_CATALOG_MANAGE_ROLES;

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER DATA (seed clone helper)  F-09: in-process cache
// ═══════════════════════════════════════════════════════════════════════════════

// F-02: In-memory cache for seed clone status. This is a performance-only optimization;
// correctness is guaranteed by the DB check in ensureSeedCloned(). Cache may be cleared
// on Worker eviction (Cloudflare isolate restart), which is harmless — just re-checks DB.
const seedClonedTenants = new Set<string>();

async function ensureSeedCloned(
  d1: D1Database,
  tenantId: string,
): Promise<void> {
  if (seedClonedTenants.has(tenantId)) return;

  const existing = await d1
    .prepare('SELECT COUNT(*) as cnt FROM radiology_imaging_types WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ cnt: number }>();
  if ((existing?.cnt ?? 0) > 0) {
    seedClonedTenants.add(tenantId);
    return;
  }

  await d1
    .prepare(`INSERT OR IGNORE INTO radiology_imaging_types (tenant_id, name, code, description, is_active)
              SELECT ?, name, code, description, is_active FROM radiology_imaging_types WHERE tenant_id = '__seed__'`)
    .bind(tenantId)
    .run();

  // Clone imaging items with FK remapping
  await d1
    .prepare(`
      INSERT OR IGNORE INTO radiology_imaging_items
        (tenant_id, imaging_type_id, name, procedure_code, is_valid_reporting, is_active)
      SELECT ?, it2.id, si.name, si.procedure_code, si.is_valid_reporting, si.is_active
      FROM radiology_imaging_items si
      INNER JOIN radiology_imaging_types st ON st.id = si.imaging_type_id
      INNER JOIN radiology_imaging_types it2 ON it2.tenant_id = ? AND it2.name = st.name
      WHERE si.tenant_id = '__seed__'`)
    .bind(tenantId, tenantId)
    .run();

  seedClonedTenants.add(tenantId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGING TYPES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/imaging-types', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  await ensureSeedCloned(c.env.DB, tenantId);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM radiology_imaging_types WHERE tenant_id = ? AND is_active = 1 ORDER BY name`,
  ).bind(tenantId).all();
  return c.json({ imaging_types: results });
});

app.post('/imaging-types', requireRole(...RAD_WRITE), zValidator('json', createImagingTypeSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const r = await c.env.DB.prepare(
    `INSERT INTO radiology_imaging_types (tenant_id, name, code, description, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(tenantId, data.name, data.code ?? null, data.description ?? null, userId).run();

  return c.json({ id: r.meta.last_row_id, message: 'Imaging type created' }, 201);
});

app.put('/imaging-types/:id', requireRole(...RAD_WRITE), zValidator('json', updateImagingTypeSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Imaging Type ID');
  const data = c.req.valid('json');

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.code !== undefined) { sets.push('code = ?'); vals.push(data.code); }
  if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description); }
  if (!sets.length) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(tenantId, id);

  await c.env.DB.prepare(
    `UPDATE radiology_imaging_types SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`,
  ).bind(...vals).run();

  return c.json({ success: true });
});

app.delete('/imaging-types/:id', requireRole(...RAD_WRITE), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Imaging Type ID');

  const r = await c.env.DB.prepare(
    `UPDATE radiology_imaging_types SET is_active = 0 WHERE tenant_id = ? AND id = ?`,
  ).bind(tenantId, id).run();

  if (!r.meta.changes) throw new HTTPException(404, { message: 'Imaging type not found' });
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGING ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/imaging-items', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const typeId = c.req.query('type_id');

  let q = `SELECT i.*,
                  t.name as type_name,
                  CAST(ROUND(COALESCE(linked_si.price, code_si.price, COALESCE(i.price_paisa, 0) / 100.0, 0) * 100) AS INTEGER) as price_paisa,
                  COALESCE(linked_si.id, code_si.id, i.billing_service_item_id) as billing_service_item_id,
                  CASE
                    WHEN linked_si.id IS NOT NULL OR code_si.id IS NOT NULL THEN 'synced'
                    ELSE 'missing_billing_item'
                  END as billing_sync_status
           FROM radiology_imaging_items i
           LEFT JOIN radiology_imaging_types t ON t.id = i.imaging_type_id
           LEFT JOIN billing_service_items linked_si
             ON linked_si.id = i.billing_service_item_id
            AND linked_si.tenant_id = i.tenant_id
            AND COALESCE(linked_si.is_active, 1) = 1
           LEFT JOIN billing_service_departments rad_sd
             ON rad_sd.tenant_id = i.tenant_id
            AND rad_sd.department_code = 'RAD'
            AND COALESCE(rad_sd.is_active, 1) = 1
           LEFT JOIN billing_service_items code_si
             ON code_si.tenant_id = i.tenant_id
            AND code_si.service_department_id = rad_sd.id
            AND code_si.item_code = i.procedure_code
            AND COALESCE(code_si.is_active, 1) = 1
           WHERE i.tenant_id = ? AND i.is_active = 1`;
  const binds: unknown[] = [tenantId];
  if (typeId) { q += ' AND i.imaging_type_id = ?'; binds.push(Number(typeId)); }
  q += ' ORDER BY i.name';

  const { results } = await c.env.DB.prepare(q).bind(...binds).all();
  return c.json({ imaging_items: results });
});

app.post('/imaging-items', requireRole(...RAD_WRITE), zValidator('json', createImagingItemSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Validate imaging type belongs to tenant
  const type = await c.env.DB.prepare(
    'SELECT id, name FROM radiology_imaging_types WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(data.imaging_type_id, tenantId).first<{ id: number; name: string }>();
  if (!type) throw new HTTPException(400, { message: 'Invalid imaging type' });

  const price = Math.round(Number(data.price_paisa ?? 0)) / 100;
  const serviceItemId = await upsertDiagnosticBillingServiceItem(c.env.DB, {
    kind: 'radiology',
    tenantId,
    userId,
    code: data.procedure_code ?? data.name,
    name: data.name,
    category: type.name,
    price,
    isActive: 1,
  });

  const r = await c.env.DB.prepare(
    `INSERT INTO radiology_imaging_items
     (tenant_id, imaging_type_id, name, procedure_code, template_id, price_paisa, is_valid_reporting, billing_service_item_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    tenantId,
    data.imaging_type_id,
    data.name,
    data.procedure_code ?? null,
    data.template_id ?? null,
    data.price_paisa ?? 0,
    data.is_valid_reporting !== false ? 1 : 0,
    serviceItemId,
    userId,
  ).run();

  return c.json({ id: r.meta.last_row_id, message: 'Imaging item created' }, 201);
});

app.put('/imaging-items/:id', requireRole(...RAD_WRITE), zValidator('json', updateImagingItemSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Imaging Item ID');
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(`
    SELECT i.*, t.name as type_name
    FROM radiology_imaging_items i
    LEFT JOIN radiology_imaging_types t ON t.id = i.imaging_type_id AND t.tenant_id = i.tenant_id
    WHERE i.tenant_id = ? AND i.id = ?
    LIMIT 1
  `).bind(tenantId, id).first<{
    id: number;
    name: string;
    procedure_code: string | null;
    price_paisa: number | null;
    billing_service_item_id: number | null;
    type_name: string | null;
  }>();
  if (!existing) throw new HTTPException(404, { message: 'Imaging item not found' });

  const serviceItemId = await upsertDiagnosticBillingServiceItem(c.env.DB, {
    kind: 'radiology',
    tenantId,
    userId: requireUserId(c),
    serviceItemId: existing.billing_service_item_id,
    oldCode: existing.procedure_code,
    code: data.procedure_code ?? existing.procedure_code ?? data.name ?? existing.name,
    name: data.name ?? existing.name,
    category: existing.type_name,
    price: Math.round(Number(data.price_paisa ?? existing.price_paisa ?? 0)) / 100,
    isActive: 1,
  });

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.procedure_code !== undefined) { sets.push('procedure_code = ?'); vals.push(data.procedure_code); }
  if (data.price_paisa !== undefined) { sets.push('price_paisa = ?'); vals.push(data.price_paisa); }
  if (data.is_valid_reporting !== undefined) { sets.push('is_valid_reporting = ?'); vals.push(data.is_valid_reporting ? 1 : 0); }
  if (!sets.length) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push('billing_service_item_id = ?');
  vals.push(serviceItemId);
  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(tenantId, id);

  await c.env.DB.prepare(
    `UPDATE radiology_imaging_items SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`,
  ).bind(...vals).run();

  return c.json({ success: true });
});

app.delete('/imaging-items/:id', requireRole(...RAD_WRITE), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'), 'Imaging Item ID');
  const existing = await c.env.DB.prepare(`
    SELECT i.*, t.name as type_name
    FROM radiology_imaging_items i
    LEFT JOIN radiology_imaging_types t ON t.id = i.imaging_type_id AND t.tenant_id = i.tenant_id
    WHERE i.tenant_id = ? AND i.id = ?
    LIMIT 1
  `).bind(tenantId, id).first<{
    name: string;
    procedure_code: string | null;
    price_paisa: number | null;
    billing_service_item_id: number | null;
    type_name: string | null;
  }>();
  if (!existing) throw new HTTPException(404, { message: 'Imaging item not found' });
  const r = await c.env.DB.prepare(
    `UPDATE radiology_imaging_items SET is_active = 0 WHERE tenant_id = ? AND id = ?`,
  ).bind(tenantId, id).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Imaging item not found' });
  await upsertDiagnosticBillingServiceItem(c.env.DB, {
    kind: 'radiology',
    tenantId,
    userId,
    serviceItemId: existing.billing_service_item_id,
    oldCode: existing.procedure_code,
    code: existing.procedure_code ?? existing.name,
    name: existing.name,
    category: existing.type_name,
    price: Math.round(Number(existing.price_paisa ?? 0)) / 100,
    isActive: 0,
  });
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/templates', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, code, footer_note, created_at FROM radiology_report_templates WHERE tenant_id = ? AND is_active = 1 ORDER BY name`,
  ).bind(tenantId).all();
  return c.json({ templates: results });
});

app.get('/templates/:id', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Template ID');
  const t = await c.env.DB.prepare(
    `SELECT * FROM radiology_report_templates WHERE tenant_id = ? AND id = ?`,
  ).bind(tenantId, id).first();
  if (!t) throw new HTTPException(404, { message: 'Template not found' });
  return c.json({ template: t });
});

app.post('/templates', requireRole(...RAD_WRITE), zValidator('json', createReportTemplateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const r = await c.env.DB.prepare(
    `INSERT INTO radiology_report_templates (tenant_id, name, code, template_html, footer_note, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(tenantId, data.name, data.code ?? null, data.template_html ?? null, data.footer_note ?? null, userId).run();

  return c.json({ id: r.meta.last_row_id, message: 'Template created' }, 201);
});

app.put('/templates/:id', requireRole(...RAD_WRITE), zValidator('json', updateReportTemplateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Template ID');
  const data = c.req.valid('json');

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.code !== undefined) { sets.push('code = ?'); vals.push(data.code); }
  if (data.template_html !== undefined) { sets.push('template_html = ?'); vals.push(data.template_html); }
  if (data.footer_note !== undefined) { sets.push('footer_note = ?'); vals.push(data.footer_note); }
  if (!sets.length) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(tenantId, id);
  await c.env.DB.prepare(`UPDATE radiology_report_templates SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FILM TYPES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/film-types', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT f.*, t.name as type_name FROM radiology_film_types f
     LEFT JOIN radiology_imaging_types t ON t.id = f.imaging_type_id
     WHERE f.tenant_id = ? AND f.is_active = 1 ORDER BY f.film_type`,
  ).bind(tenantId).all();
  return c.json({ film_types: results });
});

app.post('/film-types', requireRole(...RAD_WRITE), zValidator('json', createFilmTypeSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const r = await c.env.DB.prepare(
    `INSERT INTO radiology_film_types (tenant_id, film_type, display_name, imaging_type_id, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(tenantId, data.film_type, data.display_name ?? null, data.imaging_type_id ?? null, userId).run();

  return c.json({ id: r.meta.last_row_id, message: 'Film type created' }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATS (must be before /:id-like routes)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/stats', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);

  // F-06 FIX: Single D1 batch instead of 5 parallel queries
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM radiology_requisitions WHERE tenant_id = ? AND order_status = 'pending' AND is_active = 1`).bind(tenantId),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM radiology_requisitions WHERE tenant_id = ? AND order_status = 'scanned' AND is_active = 1`).bind(tenantId),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM radiology_requisitions WHERE tenant_id = ? AND order_status = 'reported' AND is_active = 1`).bind(tenantId),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM radiology_requisitions WHERE tenant_id = ? AND order_status = 'cancelled' AND is_active = 1`).bind(tenantId),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM radiology_requisitions WHERE tenant_id = ? AND urgency = 'stat' AND order_status = 'pending' AND is_active = 1`).bind(tenantId),
  ]);

  const get = (i: number) => (results[i].results?.[0] as { cnt: number } | undefined)?.cnt ?? 0;

  return c.json({
    pending: get(0),
    scanned: get(1),
    reported: get(2),
    cancelled: get(3),
    stat_pending: get(4),
  });
});

export default app;

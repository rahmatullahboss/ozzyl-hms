import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { websiteConfigSchema, websiteServiceSchema, blogPostSchema, departmentSchema } from '../../schemas/website';
import { getDb } from '../../db';
import { resolveHospitalLogoDisplayUrl } from '../../lib/hospital-logo-url';


const websiteRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Shared helper to trigger non-blocking site re-render.
 * Resolves subdomain from DB using tenantId (not headers).
 */
async function triggerReRender(
  c: { env: Env; executionCtx: ExecutionContext },
  tenantId: string
): Promise<void> {
  const db = getDb(c.env.DB);
  try {
    const tenant = await db.$client.prepare(
      'SELECT subdomain FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ subdomain: string }>();
    if (!tenant?.subdomain) return;

    const { preRenderTenantSite } = await import('../public/prerender');
    c.executionCtx.waitUntil(
      preRenderTenantSite(c.env.DB, c.env.KV, Number(tenantId), tenant.subdomain, c.env)
    );
  } catch {
    // Pre-render failure is non-fatal
  }
}

// Whitelist of allowed column names for dynamic SQL (P0 SQL injection fix)
const ALLOWED_CONFIG_COLUMNS = new Set([
  'is_enabled', 'theme', 'tagline', 'tagline_bn', 'about_text', 'about_text_bn',
  'mission_text', 'mission_text_bn', 'founded_year', 'bed_count', 'operating_hours',
  'google_maps_embed', 'whatsapp_number', 'facebook_url', 'emergency_number',
  'ambulance_number', 'emergency_hours', 'seo_title', 'seo_description',
  'seo_keywords', 'primary_color', 'secondary_color',
]);

const ALLOWED_SERVICE_COLUMNS = new Set([
  'name', 'name_bn', 'description', 'icon', 'category', 'is_active', 'sort_order',
]);

// ─── GET /api/website/config ─────────────────────────────────────────
websiteRoutes.get('/config', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const [config, hospitalLogoRow] = await Promise.all([
    db.$client.prepare('SELECT * FROM website_config WHERE tenant_id = ?')
      .bind(tenantId).first(),
    db.$client.prepare("SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?")
      .bind(tenantId).first<{ value: string }>(),
  ]);

  if (!config) {
    return c.json({ data: null, message: 'No website config found' });
  }

  const data = {
    ...config,
    hospital_logo_url: hospitalLogoRow?.value
      ? await resolveHospitalLogoDisplayUrl(c.env.DB, tenantId)
      : null,
  };

  return c.json({ data });
});

// ─── PUT /api/website/config ─────────────────────────────────────────
websiteRoutes.put('/config', zValidator('json', websiteConfigSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  // Build SET clause dynamically — only whitelisted column names (P0 fix)
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_CONFIG_COLUMNS.has(k));
  if (fields.length === 0) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  fields.push(['updated_at', new Date().toISOString()] as any);

  const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([, v]) => v);

  // Upsert: try UPDATE, if 0 rows affected → INSERT
  const result = await db.$client.prepare(
    `UPDATE website_config SET ${setClauses} WHERE tenant_id = ?`
  ).bind(...values, tenantId).run();

  if (!result.meta.changes || result.meta.changes === 0) {
    // Insert new config
    const insertFields = ['tenant_id', ...fields.map(([k]) => k)];
    const insertPlaceholders = insertFields.map(() => '?').join(', ');
    await db.$client.prepare(
      `INSERT INTO website_config (${insertFields.join(', ')}) VALUES (${insertPlaceholders})`
    ).bind(tenantId, ...values).run();
  }

  // Auto re-render hospital site (non-blocking)
  triggerReRender(c, tenantId);

  return c.json({ success: true, message: 'Website config saved' });
});

// ─── GET /api/website/services ───────────────────────────────────────
websiteRoutes.get('/services', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM website_services WHERE tenant_id = ? ORDER BY sort_order'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── POST /api/website/services ──────────────────────────────────────
websiteRoutes.post('/services', zValidator('json', websiteServiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  await db.$client.prepare(
    `INSERT INTO website_services (tenant_id, name, name_bn, description, icon, category, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId, data.name, data.name_bn ?? null, data.description ?? null,
    data.icon ?? '🏥', data.category ?? 'general', data.is_active ?? 1, data.sort_order ?? 0
  ).run();

  // Auto re-render (non-blocking)
  triggerReRender(c, tenantId);

  return c.json({ success: true }, 201);
});

// ─── PUT /api/website/services/:id ───────────────────────────────────
websiteRoutes.put('/services/:id', zValidator('json', websiteServiceSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const serviceId = c.req.param('id');
  const data = c.req.valid('json');

  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_SERVICE_COLUMNS.has(k));
  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([, v]) => v);

  await db.$client.prepare(
    `UPDATE website_services SET ${setClauses} WHERE id = ? AND tenant_id = ?`
  ).bind(...values, serviceId, tenantId).run();

  // Auto re-render (non-blocking)
  triggerReRender(c, tenantId);

  return c.json({ success: true });
});

// ─── DELETE /api/website/services/:id ────────────────────────────────
websiteRoutes.delete('/services/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const serviceId = c.req.param('id');

  await db.$client.prepare(
    'DELETE FROM website_services WHERE id = ? AND tenant_id = ?'
  ).bind(serviceId, tenantId).run();

  // Auto re-render (non-blocking)
  triggerReRender(c, tenantId);

  return c.json({ success: true });
});

// ─── POST /api/website/upload-hero — Upload hero image to R2 ─────────
websiteRoutes.post('/upload-hero', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'No file provided' });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new HTTPException(400, { message: 'Only JPEG, PNG, and WebP images allowed' });
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'File too large (max 2MB)' });
  }

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const key = `${tenantId}/website/hero/${Date.now()}.${ext}`;

  // Delete old hero image if exists
  const oldConfig = await db.$client.prepare(
    'SELECT hero_image_key FROM website_config WHERE tenant_id = ?'
  ).bind(tenantId).first<{ hero_image_key: string | null }>();
  if (oldConfig?.hero_image_key) {
    try { await c.env.UPLOADS.delete(oldConfig.hero_image_key); } catch { /* non-fatal */ }
  }

  await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  await db.$client.prepare(
    `UPDATE website_config SET hero_image_key = ?, updated_at = datetime('now', '+6 hours') WHERE tenant_id = ?`
  ).bind(key, tenantId).run();

  triggerReRender(c, tenantId);

  return c.json({ success: true, key, url: `/api/uploads/${key}` });
});

// ─── DELETE /api/website/hero-image — Remove hero image ──────────────
websiteRoutes.delete('/hero-image', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const config = await db.$client.prepare(
    'SELECT hero_image_key FROM website_config WHERE tenant_id = ?'
  ).bind(tenantId).first<{ hero_image_key: string | null }>();

  if (config?.hero_image_key) {
    try { await c.env.UPLOADS.delete(config.hero_image_key); } catch { /* non-fatal */ }
    await db.$client.prepare(
      `UPDATE website_config SET hero_image_key = NULL, updated_at = datetime('now', '+6 hours') WHERE tenant_id = ?`
    ).bind(tenantId).run();
    triggerReRender(c, tenantId);
  }

  return c.json({ success: true });
});

// ─── GET /api/website/analytics ──────────────────────────────────────
websiteRoutes.get('/analytics', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '7'), 1), 90);
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Get subdomain for this tenant
  const tenant = await db.$client.prepare(
    'SELECT subdomain FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ subdomain: string }>();
  if (!tenant) throw new HTTPException(404, { message: 'Tenant not found' });

  // Total views in period
  const totalResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM website_pageviews
     WHERE (tenant_id = ? OR subdomain = ?) AND viewed_at >= ?`
  ).bind(tenantId, tenant.subdomain, sinceDate).first();

  // Views per page
  const { results: perPage } = await db.$client.prepare(
    `SELECT page, COUNT(*) as views FROM website_pageviews
     WHERE (tenant_id = ? OR subdomain = ?) AND viewed_at >= ?
     GROUP BY page ORDER BY views DESC`
  ).bind(tenantId, tenant.subdomain, sinceDate).all();

  // Daily chart data
  const { results: daily } = await db.$client.prepare(
    `SELECT DATE(viewed_at) as date, COUNT(*) as views FROM website_pageviews
     WHERE (tenant_id = ? OR subdomain = ?) AND viewed_at >= ?
     GROUP BY DATE(viewed_at) ORDER BY date`
  ).bind(tenantId, tenant.subdomain, sinceDate).all();

  return c.json({
    data: {
      totalViews: (totalResult as any)?.total ?? 0,
      period: `${days}d`,
      perPage: perPage || [],
      daily: daily || [],
    },
  });
});

// ─── GET /api/website/gallery — List gallery images ─────────────────
websiteRoutes.get('/gallery', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM website_gallery WHERE tenant_id = ? ORDER BY sort_order'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── POST /api/website/gallery — Upload gallery image ───────────────
websiteRoutes.post('/gallery', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'No file provided' });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new HTTPException(400, { message: 'Only JPEG, PNG, and WebP images allowed' });
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'File too large (max 5MB)' });
  }

  const caption = (formData.get('caption') as string) || null;
  const sortOrder = parseInt((formData.get('sort_order') as string) || '0', 10) || 0;

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const key = `${tenantId}/website/gallery/${Date.now()}.${ext}`;

  await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  await db.$client.prepare(
    `INSERT INTO website_gallery (tenant_id, image_key, caption, sort_order) VALUES (?, ?, ?, ?)`
  ).bind(tenantId, key, caption, sortOrder).run();

  triggerReRender(c, tenantId);

  return c.json({ success: true, key, url: `/api/uploads/${key}` }, 201);
});

// ─── PUT /api/website/gallery/:id — Update gallery image caption/order
websiteRoutes.put('/gallery/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const galleryId = c.req.param('id');
  const data = await c.req.json<{ caption?: string; sort_order?: number }>();

  const fields: [string, any][] = [];
  if (data.caption !== undefined) fields.push(['caption', data.caption]);
  if (data.sort_order !== undefined) fields.push(['sort_order', data.sort_order]);
  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([, v]) => v);

  await db.$client.prepare(
    `UPDATE website_gallery SET ${setClauses} WHERE id = ? AND tenant_id = ?`
  ).bind(...values, galleryId, tenantId).run();

  triggerReRender(c, tenantId);

  return c.json({ success: true });
});

// ─── DELETE /api/website/gallery/:id — Delete gallery image ─────────
websiteRoutes.delete('/gallery/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const galleryId = c.req.param('id');

  // Fetch the image key to delete from R2
  const row = await db.$client.prepare(
    'SELECT image_key FROM website_gallery WHERE id = ? AND tenant_id = ?'
  ).bind(galleryId, tenantId).first<{ image_key: string }>();

  if (row?.image_key) {
    try { await c.env.UPLOADS.delete(row.image_key); } catch { /* non-fatal */ }
  }

  await db.$client.prepare(
    'DELETE FROM website_gallery WHERE id = ? AND tenant_id = ?'
  ).bind(galleryId, tenantId).run();

  triggerReRender(c, tenantId);

  return c.json({ success: true });
});

// ─── POST /api/website/trigger-render ────────────────────────────────
// Manual re-render trigger (admin use) — triggers SSR pre-render of hospital site
websiteRoutes.post('/trigger-render', async (c) => {
  const tenantId = requireTenantId(c);

  // Resolve subdomain from DB (not header)
  triggerReRender(c, tenantId);
  return c.json({ success: true, message: 'Re-render triggered' });
});

// ═══════════════════════════════════════════════════════════════════════
// Intake Forms — Admin CRUD
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /api/website/intake-forms — List all intake forms ──────────
websiteRoutes.get('/intake-forms', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM appointment_intake_forms WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── GET /api/website/intake-forms/:id — Get single form ────────────
websiteRoutes.get('/intake-forms/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = c.req.param('id');
  const form = await db.$client.prepare(
    'SELECT * FROM appointment_intake_forms WHERE id = ? AND tenant_id = ?'
  ).bind(formId, tenantId).first();
  if (!form) throw new HTTPException(404, { message: 'Form not found' });
  return c.json({ data: form });
});

// ─── POST /api/website/intake-forms — Create intake form ────────────
websiteRoutes.post('/intake-forms', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{
    name: string;
    description?: string;
    form_fields: any[];
    is_active?: number;
  }>();

  if (!body.name?.trim()) throw new HTTPException(400, { message: 'Form name required' });
  if (!Array.isArray(body.form_fields) || body.form_fields.length === 0) {
    throw new HTTPException(400, { message: 'At least one form field required' });
  }

  const result = await db.$client.prepare(
    `INSERT INTO appointment_intake_forms (tenant_id, name, description, form_fields, is_active)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    tenantId,
    body.name.trim(),
    body.description?.trim() || null,
    JSON.stringify(body.form_fields),
    body.is_active ?? 1
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── PUT /api/website/intake-forms/:id — Update intake form ─────────
websiteRoutes.put('/intake-forms/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    form_fields?: any[];
    is_active?: number;
  }>();

  const fields: [string, any][] = [];
  if (body.name !== undefined) fields.push(['name', body.name.trim()]);
  if (body.description !== undefined) fields.push(['description', body.description?.trim() || null]);
  if (body.form_fields !== undefined) fields.push(['form_fields', JSON.stringify(body.form_fields)]);
  if (body.is_active !== undefined) fields.push(['is_active', body.is_active]);
  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  fields.push(['updated_at', new Date().toISOString()]);

  const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([, v]) => v);

  await db.$client.prepare(
    `UPDATE appointment_intake_forms SET ${setClauses} WHERE id = ? AND tenant_id = ?`
  ).bind(...values, formId, tenantId).run();

  return c.json({ success: true });
});

// ─── DELETE /api/website/intake-forms/:id — Delete intake form ──────
websiteRoutes.delete('/intake-forms/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = c.req.param('id');

  await db.$client.prepare(
    'DELETE FROM appointment_intake_forms WHERE id = ? AND tenant_id = ?'
  ).bind(formId, tenantId).run();

  return c.json({ success: true });
});

// ─── GET /api/website/intake-forms/:id/responses — List responses ───
websiteRoutes.get('/intake-forms/:id/responses', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const formId = c.req.param('id');

  const { results } = await db.$client.prepare(
    `SELECT r.*, p.name as patient_name, a.appointment_date
     FROM appointment_intake_responses r
     LEFT JOIN patients p ON p.id = r.patient_id
     LEFT JOIN appointments a ON a.id = r.appointment_id
     WHERE r.form_id = ? AND r.tenant_id = ?
     ORDER BY r.submitted_at DESC`
  ).bind(formId, tenantId).all();

  return c.json({ data: results });
});

// ═══════════════════════════════════════════════════════════════════════
// Blog Posts — Admin CRUD
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_BLOG_COLUMNS = new Set([
  'title', 'title_bn', 'slug', 'content', 'content_bn', 'excerpt', 'excerpt_bn',
  'featured_image_key', 'author_name', 'is_published', 'published_at',
]);

// ─── GET /api/website/blog-posts ────────────────────────────────────
websiteRoutes.get('/blog-posts', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM website_blog_posts WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── GET /api/website/blog-posts/:id ────────────────────────────────
websiteRoutes.get('/blog-posts/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const postId = c.req.param('id');
  const post = await db.$client.prepare(
    'SELECT * FROM website_blog_posts WHERE id = ? AND tenant_id = ?'
  ).bind(postId, tenantId).first();
  if (!post) throw new HTTPException(404, { message: 'Post not found' });
  return c.json({ data: post });
});

// ─── POST /api/website/blog-posts ───────────────────────────────────
websiteRoutes.post('/blog-posts', zValidator('json', blogPostSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  // Auto-set published_at when publishing
  const publishedAt = data.is_published ? (data.published_at || new Date().toISOString()) : null;

  const result = await db.$client.prepare(
    `INSERT INTO website_blog_posts (tenant_id, title, title_bn, slug, content, content_bn, excerpt, excerpt_bn, featured_image_key, author_name, is_published, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId, data.title, data.title_bn ?? null, data.slug, data.content,
    data.content_bn ?? null, data.excerpt ?? null, data.excerpt_bn ?? null,
    data.featured_image_key ?? null, data.author_name ?? null,
    data.is_published ?? 0, publishedAt
  ).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── PUT /api/website/blog-posts/:id ────────────────────────────────
websiteRoutes.put('/blog-posts/:id', zValidator('json', blogPostSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const postId = c.req.param('id');
  const data = c.req.valid('json');

  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_BLOG_COLUMNS.has(k));
  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  // Auto-set published_at if publishing for the first time
  if (data.is_published === 1 && !data.published_at) {
    fields.push(['published_at', new Date().toISOString()]);
  }
  fields.push(['updated_at', new Date().toISOString()]);

  const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([, v]) => v);

  await db.$client.prepare(
    `UPDATE website_blog_posts SET ${setClauses} WHERE id = ? AND tenant_id = ?`
  ).bind(...values, postId, tenantId).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true });
});

// ─── DELETE /api/website/blog-posts/:id ─────────────────────────────
websiteRoutes.delete('/blog-posts/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const postId = c.req.param('id');

  // Delete featured image from R2 if exists
  const post = await db.$client.prepare(
    'SELECT featured_image_key FROM website_blog_posts WHERE id = ? AND tenant_id = ?'
  ).bind(postId, tenantId).first<{ featured_image_key: string | null }>();
  if (post?.featured_image_key) {
    try { await c.env.UPLOADS.delete(post.featured_image_key); } catch { /* non-fatal */ }
  }

  await db.$client.prepare(
    'DELETE FROM website_blog_posts WHERE id = ? AND tenant_id = ?'
  ).bind(postId, tenantId).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true });
});

// ─── POST /api/website/upload-blog-image — Upload blog featured image
websiteRoutes.post('/upload-blog-image', async (c) => {
  const tenantId = requireTenantId(c);
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'No file provided' });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new HTTPException(400, { message: 'Only JPEG, PNG, and WebP images allowed' });
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'File too large (max 5MB)' });
  }

  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const key = `${tenantId}/website/blog/${Date.now()}.${ext}`;

  await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ success: true, key, url: `/api/uploads/${key}` });
});

// ═══════════════════════════════════════════════════════════════════════
// Reviews — Admin Moderation
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /api/website/reviews ───────────────────────────────────────
websiteRoutes.get('/reviews', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM website_reviews WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── PUT /api/website/reviews/:id/approve ───────────────────────────
websiteRoutes.put('/reviews/:id/approve', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const reviewId = c.req.param('id');
  const body = await c.req.json<{ is_approved: number }>();

  await db.$client.prepare(
    'UPDATE website_reviews SET is_approved = ? WHERE id = ? AND tenant_id = ?'
  ).bind(body.is_approved ? 1 : 0, reviewId, tenantId).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true });
});

// ─── DELETE /api/website/reviews/:id ────────────────────────────────
websiteRoutes.delete('/reviews/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const reviewId = c.req.param('id');

  await db.$client.prepare(
    'DELETE FROM website_reviews WHERE id = ? AND tenant_id = ?'
  ).bind(reviewId, tenantId).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
// Departments — Admin CRUD
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_DEPT_COLUMNS = new Set([
  'name', 'name_bn', 'slug', 'description', 'description_bn', 'icon', 'image_key', 'is_active', 'sort_order',
]);

// ─── GET /api/website/departments ───────────────────────────────────
websiteRoutes.get('/departments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM website_departments WHERE tenant_id = ? ORDER BY sort_order'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// ─── POST /api/website/departments ──────────────────────────────────
websiteRoutes.post('/departments', zValidator('json', departmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  await db.$client.prepare(
    `INSERT INTO website_departments (tenant_id, name, name_bn, slug, description, description_bn, icon, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId, data.name, data.name_bn ?? null, data.slug,
    data.description ?? null, data.description_bn ?? null,
    data.icon ?? '🏥', data.is_active ?? 1, data.sort_order ?? 0
  ).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true }, 201);
});

// ─── PUT /api/website/departments/:id ───────────────────────────────
websiteRoutes.put('/departments/:id', zValidator('json', departmentSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const deptId = c.req.param('id');
  const data = c.req.valid('json');

  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_DEPT_COLUMNS.has(k));
  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([, v]) => v);

  await db.$client.prepare(
    `UPDATE website_departments SET ${setClauses} WHERE id = ? AND tenant_id = ?`
  ).bind(...values, deptId, tenantId).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true });
});

// ─── DELETE /api/website/departments/:id ────────────────────────────
websiteRoutes.delete('/departments/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const deptId = c.req.param('id');

  await db.$client.prepare(
    'DELETE FROM website_departments WHERE id = ? AND tenant_id = ?'
  ).bind(deptId, tenantId).run();

  triggerReRender(c, tenantId);
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
// Custom Domain Management
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /api/website/domain — Get current domain config ────────────
websiteRoutes.get('/domain', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const tenant = await db.$client.prepare(
    'SELECT subdomain, custom_domain, custom_domain_verified, domain_verification_token FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  return c.json({ data: tenant });
});

// ─── PUT /api/website/domain — Set custom domain ────────────────────
websiteRoutes.put('/domain', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{ custom_domain: string | null }>();

  if (body.custom_domain) {
    // Validate domain format
    const domain = body.custom_domain.toLowerCase().trim();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
      throw new HTTPException(400, { message: 'Invalid domain format' });
    }

    // Check if domain is already taken by another tenant
    const existing = await db.$client.prepare(
      'SELECT id FROM tenants WHERE custom_domain = ? AND id != ?'
    ).bind(domain, tenantId).first();
    if (existing) {
      throw new HTTPException(409, { message: 'Domain is already in use' });
    }

    // Generate verification token
    const token = crypto.randomUUID();

    await db.$client.prepare(
      'UPDATE tenants SET custom_domain = ?, custom_domain_verified = 0, domain_verification_token = ? WHERE id = ?'
    ).bind(domain, token, tenantId).run();

    return c.json({
      success: true,
      domain,
      verification_token: token,
      instructions: {
        cname: { type: 'CNAME', name: domain, value: 'hms.ozzyl.com' },
        txt: { type: 'TXT', name: `_hms-verify.${domain}`, value: token },
      },
    });
  } else {
    // Remove custom domain
    await db.$client.prepare(
      'UPDATE tenants SET custom_domain = NULL, custom_domain_verified = 0, domain_verification_token = NULL WHERE id = ?'
    ).bind(tenantId).run();
    return c.json({ success: true, message: 'Custom domain removed' });
  }
});

// ─── POST /api/website/domain/verify — Verify domain ownership ─────
websiteRoutes.post('/domain/verify', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const tenant = await db.$client.prepare(
    'SELECT custom_domain, domain_verification_token FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ custom_domain: string | null; domain_verification_token: string | null }>();

  if (!tenant?.custom_domain || !tenant?.domain_verification_token) {
    throw new HTTPException(400, { message: 'No custom domain configured' });
  }

  // Verify DNS TXT record
  try {
    const resp = await fetch(`https://dns.google/resolve?name=_hms-verify.${tenant.custom_domain}&type=TXT`);
    const dns = await resp.json() as { Answer?: { data: string }[] };
    const txtRecords = (dns.Answer || []).map((a: { data: string }) => a.data.replace(/"/g, ''));
    const verified = txtRecords.includes(tenant.domain_verification_token);

    if (verified) {
      await db.$client.prepare(
        'UPDATE tenants SET custom_domain_verified = 1 WHERE id = ?'
      ).bind(tenantId).run();
      return c.json({ success: true, verified: true, message: 'Domain verified!' });
    } else {
      return c.json({
        success: false,
        verified: false,
        message: 'TXT record not found. Please add the DNS record and try again.',
        expected_record: `_hms-verify.${tenant.custom_domain} TXT ${tenant.domain_verification_token}`,
      });
    }
  } catch {
    return c.json({ success: false, verified: false, message: 'DNS lookup failed. Try again later.' });
  }
});

export default websiteRoutes;

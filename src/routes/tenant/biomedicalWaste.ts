import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const bmw = new Hono<{ Bindings: Env; Variables: Variables }>();

const COLL_STATUS = ['collected','in_transit','disposed','reported'] as const;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

async function nextCollNum(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM bmw_collections WHERE tenant_id = ? AND collection_number LIKE ?").bind(tenantId, `BMW-${today}%`).first<{ cnt: number }>();
  return `BMW-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

// ─── Categories ──────────────────────────────────────────────────────────────

bmw.get('/categories', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare('SELECT * FROM bmw_categories WHERE tenant_id = ? AND is_active = 1 ORDER BY category_code').bind(tenantId).all();
  return c.json({ data: results ?? [] });
});

bmw.post('/categories', zValidator('json', z.object({
  category_code: z.string().min(1), category_name: z.string().min(1),
  color: z.string().min(1), description: z.string().optional(),
  disposal_method: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const r = await getDb(c.env.DB).$client.prepare(
    'INSERT INTO bmw_categories (tenant_id, category_code, category_name, color, description, disposal_method) VALUES (?,?,?,?,?,?)'
  ).bind(tenantId, d.category_code, d.category_name, d.color, d.description ?? null, d.disposal_method ?? null).run();
  return c.json({ message: 'Category created', id: r.meta.last_row_id }, 201);
});

bmw.post('/categories/seed', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const existing = await db.$client.prepare('SELECT COUNT(*) as cnt FROM bmw_categories WHERE tenant_id = ?').bind(tenantId).first<{ cnt: number }>();
  if (existing && existing.cnt > 0) return c.json({ message: 'Already seeded' });

  const defaults = [
    { code: 'Yellow', name: 'Human Anatomical / Infectious', color: 'yellow', disposal: 'Incineration' },
    { code: 'Red', name: 'Contaminated Recyclable', color: 'red', disposal: 'Autoclave + Shredding' },
    { code: 'White', name: 'Sharps (Needles, Blades)', color: 'white', disposal: 'Autoclave + Shredding + Encapsulation' },
    { code: 'Blue', name: 'Glassware / Metallic Implants', color: 'blue', disposal: 'Autoclave + Shredding' },
  ];

  const stmts = defaults.map(d => db.$client.prepare(
    'INSERT INTO bmw_categories (tenant_id, category_code, category_name, color, disposal_method) VALUES (?,?,?,?,?)'
  ).bind(tenantId, d.code, d.name, d.color, d.disposal));
  await db.$client.batch(stmts);

  return c.json({ message: 'Default categories seeded', count: defaults.length }, 201);
});

bmw.delete('/categories/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare('UPDATE bmw_categories SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Removed' });
});

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

bmw.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const todayStats = await db.$client.prepare(`
    SELECT COUNT(*) as collections, COALESCE(SUM(weight_kg), 0) as total_weight_kg, COALESCE(SUM(bag_count), 0) as total_bags
    FROM bmw_collections WHERE tenant_id = ? AND collection_date = ?
  `).bind(tenantId, today).first();

  const pendingDisposal = await db.$client.prepare("SELECT COUNT(*) as cnt FROM bmw_collections WHERE tenant_id = ? AND status IN ('collected','in_transit')").bind(tenantId).first<{ cnt: number }>();

  const monthWeight = await db.$client.prepare(`
    SELECT COALESCE(SUM(weight_kg), 0) as kg FROM bmw_collections WHERE tenant_id = ? AND collection_date >= date('now', '-30 days')
  `).bind(tenantId).first<{ kg: number }>();

  return c.json({ today: todayStats ?? {}, pending_disposal: pendingDisposal?.cnt ?? 0, month_weight_kg: monthWeight?.kg ?? 0 });
});

// ─── Collections ─────────────────────────────────────────────────────────────

bmw.get('/collections', zValidator('query', z.object({
  date: z.string().optional(), department: z.string().optional(),
  category_id: z.coerce.number().optional(), status: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { date, department, category_id, status, from, to, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['c.tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (date) { conds.push('c.collection_date = ?'); params.push(date); }
  if (department) { conds.push('c.department = ?'); params.push(department); }
  if (category_id) { conds.push('c.category_id = ?'); params.push(category_id); }
  if (status) { conds.push('c.status = ?'); params.push(status); }
  if (from) { conds.push('c.collection_date >= ?'); params.push(from); }
  if (to) { conds.push('c.collection_date <= ?'); params.push(to); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM bmw_collections c WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`
    SELECT c.*, cat.color as category_color FROM bmw_collections c
    LEFT JOIN bmw_categories cat ON c.category_id = cat.id
    WHERE ${where} ORDER BY c.collection_date DESC, c.id DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results ?? [], pagination: { page, limit, total: total?.cnt ?? 0 } });
});

bmw.post('/collections', zValidator('json', z.object({
  collection_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  department: z.string().min(1),
  category_id: z.number().int().positive(),
  category_name: z.string().optional(),
  weight_kg: z.number().positive(),
  bag_count: z.number().int().min(1).default(1),
  collected_by: z.string().optional(),
  handover_to: z.string().optional(),
  vehicle_number: z.string().optional(),
  manifest_number: z.string().optional(),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const collNum = await nextCollNum(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO bmw_collections (tenant_id, collection_number, collection_date, department, category_id, category_name, weight_kg, bag_count, collected_by, handover_to, vehicle_number, manifest_number, remarks, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, collNum, d.collection_date, d.department, d.category_id, d.category_name ?? null, d.weight_kg, d.bag_count, d.collected_by ?? null, d.handover_to ?? null, d.vehicle_number ?? null, d.manifest_number ?? null, d.remarks ?? null, userId).run();

  return c.json({ message: 'Waste collection recorded', id: r.meta.last_row_id, collection_number: collNum }, 201);
});

bmw.put('/collections/:id/status', zValidator('json', z.object({
  status: z.enum(COLL_STATUS),
  disposal_method: z.string().optional(),
  disposal_certificate: z.string().optional(),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const updates: string[] = ['status = ?']; const params: (string | number | null)[] = [body.status];
  if (body.status === 'disposed') { updates.push("disposed_at = datetime('now', '+6 hours')"); }
  if (body.disposal_method) { updates.push('disposal_method = ?'); params.push(body.disposal_method); }
  if (body.disposal_certificate) { updates.push('disposal_certificate = ?'); params.push(body.disposal_certificate); }
  if (body.remarks) { updates.push('remarks = ?'); params.push(body.remarks); }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE bmw_collections SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: `Status → ${body.status}` });
});

// ─── Department-wise summary ─────────────────────────────────────────────────

bmw.get('/summary', async (c) => {
  const tenantId = requireTenantId(c);
  const from = c.req.query('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const to = c.req.query('to') || new Date().toISOString().split('T')[0];
  const db = getDb(c.env.DB);

  const { results } = await db.$client.prepare(`
    SELECT department, category_name, COUNT(*) as collections, SUM(weight_kg) as total_kg, SUM(bag_count) as total_bags
    FROM bmw_collections WHERE tenant_id = ? AND collection_date BETWEEN ? AND ?
    GROUP BY department, category_name ORDER BY department, total_kg DESC
  `).bind(tenantId, from, to).all();

  return c.json({ data: results ?? [], from, to });
});

export default bmw;

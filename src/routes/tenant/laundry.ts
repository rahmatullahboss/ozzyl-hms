import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const laundry = new Hono<{ Bindings: Env; Variables: Variables }>();

const COLLECTION_STATUS = ['collected','washing','drying','ironing','ready','delivered'] as const;

async function nextCollectionNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM laundry_collections WHERE tenant_id = ? AND collection_number LIKE ?").bind(tenantId, `LDR-${today}%`).first<{ cnt: number }>();
  return `LDR-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

// ─── Linen Types ─────────────────────────────────────────────────────────────

laundry.get('/linen-types', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare('SELECT * FROM laundry_linen_types WHERE tenant_id = ? AND is_active = 1 ORDER BY linen_name').bind(tenantId).all();
  return c.json({ data: results });
});

laundry.post('/linen-types', zValidator('json', z.object({
  linen_name: z.string().min(1), category: z.enum(['general','ot','icu','pediatric','maternity']).default('general'),
  par_level: z.number().int().min(0).default(0),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const r = await getDb(c.env.DB).$client.prepare('INSERT INTO laundry_linen_types (tenant_id, linen_name, category, par_level) VALUES (?,?,?,?)').bind(tenantId, d.linen_name, d.category, d.par_level).run();
  return c.json({ message: 'Linen type added', id: r.meta.last_row_id }, 201);
});

laundry.delete('/linen-types/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare('UPDATE laundry_linen_types SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Removed' });
});

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

laundry.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const todayCollections = await db.$client.prepare("SELECT COUNT(*) as cnt FROM laundry_collections WHERE tenant_id = ? AND collection_date = ?").bind(tenantId, today).first<{ cnt: number }>();
  const inProcess = await db.$client.prepare("SELECT COUNT(*) as cnt FROM laundry_collections WHERE tenant_id = ? AND status IN ('collected','washing','drying','ironing')").bind(tenantId).first<{ cnt: number }>();
  const readyForDelivery = await db.$client.prepare("SELECT COUNT(*) as cnt FROM laundry_collections WHERE tenant_id = ? AND status = 'ready'").bind(tenantId).first<{ cnt: number }>();
  const todayItems = await db.$client.prepare(`SELECT COALESCE(SUM(ci.quantity_dirty), 0) as total FROM laundry_collection_items ci JOIN laundry_collections c ON ci.collection_id = c.id WHERE c.tenant_id = ? AND c.collection_date = ?`).bind(tenantId, today).first<{ total: number }>();

  return c.json({ today_collections: todayCollections?.cnt ?? 0, in_process: inProcess?.cnt ?? 0, ready_for_delivery: readyForDelivery?.cnt ?? 0, today_items: todayItems?.total ?? 0 });
});

// ─── Collections ─────────────────────────────────────────────────────────────

laundry.get('/collections', zValidator('query', z.object({
  date: z.string().optional(), status: z.string().optional(), ward: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { date, status, ward, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (date) { conds.push('collection_date = ?'); params.push(date); }
  if (status) { conds.push('status = ?'); params.push(status); }
  if (ward) { conds.push('collected_from = ?'); params.push(ward); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM laundry_collections WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`SELECT * FROM laundry_collections WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

laundry.get('/collections/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);

  const collection = await db.$client.prepare('SELECT * FROM laundry_collections WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!collection) throw new HTTPException(404, { message: 'Collection not found' });

  const { results: items } = await db.$client.prepare(`
    SELECT ci.*, lt.linen_name, lt.category FROM laundry_collection_items ci
    JOIN laundry_linen_types lt ON ci.linen_type_id = lt.id
    WHERE ci.collection_id = ? AND ci.tenant_id = ?
  `).bind(id, tenantId).all();

  return c.json({ ...collection, items: items ?? [] });
});

laundry.post('/collections', zValidator('json', z.object({
  collected_from: z.string().min(1),
  collection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  items: z.array(z.object({
    linen_type_id: z.number().int().positive(),
    quantity_dirty: z.number().int().min(1),
    remarks: z.string().optional(),
  })).min(1),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const collNum = await nextCollectionNumber(db, tenantId);
  const totalItems = d.items.reduce((s, i) => s + i.quantity_dirty, 0);

  const r = await db.$client.prepare(`
    INSERT INTO laundry_collections (tenant_id, collection_number, collected_from, collection_date, total_items, collected_by, remarks)
    VALUES (?,?,?,?,?,?,?)
  `).bind(tenantId, collNum, d.collected_from, d.collection_date, totalItems, userId, d.remarks ?? null).run();

  const collId = r.meta.last_row_id;
  const stmts = d.items.map(item =>
    db.$client.prepare('INSERT INTO laundry_collection_items (tenant_id, collection_id, linen_type_id, quantity_dirty, remarks) VALUES (?,?,?,?,?)').bind(tenantId, collId, item.linen_type_id, item.quantity_dirty, item.remarks ?? null)
  );
  if (stmts.length > 0) await db.$client.batch(stmts);

  return c.json({ message: 'Collection recorded', id: collId, collection_number: collNum }, 201);
});

// Update collection status
laundry.put('/collections/:id/status', zValidator('json', z.object({
  status: z.enum(COLLECTION_STATUS),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const { status } = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const updates: string[] = ['status = ?'];
  const params: (string | number)[] = [status];
  if (status === 'delivered') {
    updates.push('delivered_at = ?', 'delivered_by = ?');
    params.push(now, userId);
  }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE laundry_collections SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: `Status → ${status}` });
});

// Update clean/damaged counts (items must belong to this collection)
laundry.put('/collections/:id/items', zValidator('json', z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    quantity_clean: z.number().int().min(0),
    quantity_damaged: z.number().int().min(0).default(0),
  })).min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const collectionId = Number(c.req.param('id'));
  const { items } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const stmts = items.map(item =>
    db.$client.prepare('UPDATE laundry_collection_items SET quantity_clean = ?, quantity_damaged = ? WHERE id = ? AND collection_id = ? AND tenant_id = ?').bind(item.quantity_clean, item.quantity_damaged, item.id, collectionId, tenantId)
  );
  await db.$client.batch(stmts);

  return c.json({ message: 'Item counts updated' });
});

export default laundry;

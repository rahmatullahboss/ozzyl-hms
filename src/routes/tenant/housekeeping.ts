import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole, NURSING_ROLES } from '../../middleware/rbac';

const hk = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── RBAC: Restrict housekeeping endpoints to nursing/admin staff ────────────
hk.use('/*', requireRole(...NURSING_ROLES));

const TASK_TYPES = ['routine','deep_clean','sanitization','spill','post_discharge','pest_control','waste_disposal','other'] as const;
const TASK_STATUS = ['pending','in_progress','completed','verified','cancelled'] as const;
const PRIORITIES = ['low','normal','high','urgent'] as const;
const AREA_TYPES = ['ward','ot','icu','lobby','corridor','toilet','office','canteen','other'] as const;
const COMPLAINT_TYPES = ['cleanliness','pest','odor','waste','damaged','other'] as const;
const COMPLAINT_STATUS = ['open','assigned','in_progress','resolved','closed'] as const;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

async function nextTaskNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM housekeeping_tasks WHERE tenant_id = ? AND task_number LIKE ?").bind(tenantId, `HK-${today}%`).first<{ cnt: number }>();
  return `HK-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

async function nextComplaintNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM housekeeping_complaints WHERE tenant_id = ? AND complaint_number LIKE ?").bind(tenantId, `HC-${today}%`).first<{ cnt: number }>();
  return `HC-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

// ─── Areas ───────────────────────────────────────────────────────────────────

hk.get('/areas', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare('SELECT * FROM housekeeping_areas WHERE tenant_id = ? AND is_active = 1 ORDER BY area_name').bind(tenantId).all();
  return c.json({ data: results });
});

hk.post('/areas', zValidator('json', z.object({
  area_name: z.string().min(1), area_type: z.enum(AREA_TYPES).default('ward'),
  floor: z.string().optional(), building: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const r = await getDb(c.env.DB).$client.prepare('INSERT INTO housekeeping_areas (tenant_id, area_name, area_type, floor, building) VALUES (?,?,?,?,?)').bind(tenantId, d.area_name, d.area_type, d.floor ?? null, d.building ?? null).run();
  return c.json({ message: 'Area added', id: r.meta.last_row_id }, 201);
});

hk.delete('/areas/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare('UPDATE housekeeping_areas SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Area removed' });
});

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

hk.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const tasks = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified
    FROM housekeeping_tasks WHERE tenant_id = ? AND scheduled_date = ?
  `).bind(tenantId, today).first();

  const openComplaints = await db.$client.prepare("SELECT COUNT(*) as cnt FROM housekeeping_complaints WHERE tenant_id = ? AND status IN ('open','assigned','in_progress')").bind(tenantId).first<{ cnt: number }>();

  return c.json({ tasks: tasks ?? {}, open_complaints: openComplaints?.cnt ?? 0 });
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

hk.get('/tasks', zValidator('query', z.object({
  date: z.string().optional(), status: z.string().optional(), area_id: z.coerce.number().optional(),
  task_type: z.string().optional(), priority: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { date, status, area_id, task_type, priority, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (date) { conds.push('scheduled_date = ?'); params.push(date); }
  if (status) { conds.push('status = ?'); params.push(status); }
  if (area_id) { conds.push('area_id = ?'); params.push(area_id); }
  if (task_type) { conds.push('task_type = ?'); params.push(task_type); }
  if (priority) { conds.push('priority = ?'); params.push(priority); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM housekeeping_tasks WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`SELECT * FROM housekeeping_tasks WHERE ${where} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, scheduled_date DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

hk.post('/tasks', zValidator('json', z.object({
  area_id: z.number().int().positive().optional(),
  area_name: z.string().optional(),
  task_type: z.enum(TASK_TYPES),
  priority: z.enum(PRIORITIES).default('normal'),
  description: z.string().optional(),
  scheduled_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  scheduled_time: z.string().optional(),
  assigned_to: z.string().optional(),
  assigned_to_id: z.number().int().positive().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const taskNum = await nextTaskNumber(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO housekeeping_tasks (tenant_id, task_number, area_id, area_name, task_type, priority, description, scheduled_date, scheduled_time, assigned_to, assigned_to_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, taskNum, d.area_id ?? null, d.area_name ?? null, d.task_type, d.priority, d.description ?? null, d.scheduled_date, d.scheduled_time ?? null, d.assigned_to ?? null, d.assigned_to_id ?? null, userId).run();

  return c.json({ message: 'Task created', id: r.meta.last_row_id, task_number: taskNum }, 201);
});

hk.put('/tasks/:id/status', zValidator('json', z.object({
  status: z.enum(TASK_STATUS),
  quality_rating: z.number().int().min(1).max(5).optional(),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: (string | number | null)[] = [body.status, now];

  if (body.status === 'in_progress') { updates.push('started_at = ?'); params.push(now); }
  if (body.status === 'completed') { updates.push('completed_at = ?'); params.push(now); }
  if (body.status === 'verified') { updates.push('verified_by = ?', 'verified_at = ?'); params.push(userId, now); }
  if (body.quality_rating) { updates.push('quality_rating = ?'); params.push(body.quality_rating); }
  if (body.remarks) { updates.push('remarks = ?'); params.push(body.remarks); }

  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE housekeeping_tasks SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: `Task ${body.status}` });
});

// ─── Complaints ──────────────────────────────────────────────────────────────

hk.get('/complaints', zValidator('query', z.object({
  status: z.string().optional(), priority: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { status, priority, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (status) { conds.push('status = ?'); params.push(status); }
  if (priority) { conds.push('priority = ?'); params.push(priority); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM housekeeping_complaints WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`SELECT * FROM housekeeping_complaints WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

hk.post('/complaints', zValidator('json', z.object({
  area_id: z.number().int().positive().optional(),
  area_name: z.string().optional(),
  reported_by: z.string().min(1),
  reported_by_role: z.string().optional(),
  complaint_type: z.enum(COMPLAINT_TYPES).default('cleanliness'),
  description: z.string().min(1),
  priority: z.enum(PRIORITIES).default('normal'),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const compNum = await nextComplaintNumber(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO housekeeping_complaints (tenant_id, complaint_number, area_id, area_name, reported_by, reported_by_role, complaint_type, description, priority)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, compNum, d.area_id ?? null, d.area_name ?? null, d.reported_by, d.reported_by_role ?? null, d.complaint_type, d.description, d.priority).run();

  return c.json({ message: 'Complaint registered', id: r.meta.last_row_id, complaint_number: compNum }, 201);
});

hk.put('/complaints/:id/status', zValidator('json', z.object({
  status: z.enum(COMPLAINT_STATUS),
  assigned_to: z.string().optional(),
  resolution_notes: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const updates: string[] = ['status = ?'];
  const params: (string | number | null)[] = [body.status];
  if (body.assigned_to) { updates.push('assigned_to = ?'); params.push(body.assigned_to); }
  if (body.status === 'resolved' || body.status === 'closed') { updates.push('resolved_at = ?'); params.push(now); }
  if (body.resolution_notes) { updates.push('resolution_notes = ?'); params.push(body.resolution_notes); }

  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE housekeeping_complaints SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: `Complaint ${body.status}` });
});

export default hk;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const kitchen = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Diet Types ──────────────────────────────────────────────────────────────

kitchen.get('/diet-types', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(
    'SELECT * FROM kitchen_diet_types WHERE tenant_id = ? AND is_active = 1 ORDER BY diet_name'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

kitchen.post('/diet-types', zValidator('json', z.object({
  diet_name: z.string().min(1), description: z.string().optional(),
  calories_range: z.string().optional(), restrictions: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const r = await getDb(c.env.DB).$client.prepare(
    'INSERT INTO kitchen_diet_types (tenant_id, diet_name, description, calories_range, restrictions) VALUES (?,?,?,?,?)'
  ).bind(tenantId, d.diet_name, d.description ?? null, d.calories_range ?? null, d.restrictions ?? null).run();
  return c.json({ message: 'Diet type created', id: r.meta.last_row_id }, 201);
});

kitchen.delete('/diet-types/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare(
    'UPDATE kitchen_diet_types SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Deleted' });
});

// ─── Meal Schedules ──────────────────────────────────────────────────────────

kitchen.get('/meal-schedules', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare(
    'SELECT * FROM kitchen_meal_schedules WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order'
  ).bind(tenantId).all();
  return c.json({ data: results });
});

kitchen.post('/meal-schedules', zValidator('json', z.object({
  meal_name: z.string().min(1), start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/), sort_order: z.number().int().default(0),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const r = await getDb(c.env.DB).$client.prepare(
    'INSERT INTO kitchen_meal_schedules (tenant_id, meal_name, start_time, end_time, sort_order) VALUES (?,?,?,?,?)'
  ).bind(tenantId, d.meal_name, d.start_time, d.end_time, d.sort_order).run();
  return c.json({ message: 'Schedule created', id: r.meta.last_row_id }, 201);
});

// ─── Meal Orders ─────────────────────────────────────────────────────────────

kitchen.get('/orders', zValidator('query', z.object({
  date: z.string().optional(), ward: z.string().optional(),
  meal: z.string().optional(), status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { date, ward, meal, status, page, limit } = c.req.valid('query');
  const db = getDb(c.env.DB);
  const offset = (page - 1) * limit;
  const orderDate = date || new Date().toISOString().split('T')[0];

  const conds: string[] = ['o.tenant_id = ?', 'o.order_date = ?'];
  const params: (string | number)[] = [tenantId, orderDate];
  if (ward) { conds.push('o.ward_name = ?'); params.push(ward); }
  if (meal) { conds.push('o.meal_name = ?'); params.push(meal); }
  if (status) { conds.push('o.status = ?'); params.push(status); }

  const where = conds.join(' AND ');

  const countRow = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM kitchen_meal_orders o WHERE ${where}`
  ).bind(...params).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT o.*, p.name as patient_name, p.patient_code
    FROM kitchen_meal_orders o
    LEFT JOIN patients p ON o.patient_id = p.id
    WHERE ${where}
    ORDER BY o.meal_name, o.ward_name, p.name
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: countRow?.total ?? 0 } });
});

kitchen.post('/orders', zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  admission_id: z.number().int().positive().optional(),
  ward_name: z.string().optional(), bed_number: z.string().optional(),
  diet_type_id: z.number().int().positive().optional(),
  diet_type_name: z.string().optional(),
  meal_name: z.string().min(1), order_date: z.string().min(1),
  special_instructions: z.string().optional(), quantity: z.number().int().default(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const r = await db.$client.prepare(`
    INSERT INTO kitchen_meal_orders
      (tenant_id, patient_id, admission_id, ward_name, bed_number, diet_type_id, diet_type_name,
       meal_name, order_date, special_instructions, quantity, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId, d.patient_id, d.admission_id ?? null, d.ward_name ?? null,
    d.bed_number ?? null, d.diet_type_id ?? null, d.diet_type_name ?? null,
    d.meal_name, d.order_date, d.special_instructions ?? null, d.quantity, userId,
  ).run();

  return c.json({ message: 'Meal order created', id: r.meta.last_row_id }, 201);
});

// Bulk create orders for all admitted patients
kitchen.post('/orders/generate', zValidator('json', z.object({
  order_date: z.string().min(1),
  meal_name: z.string().min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { order_date, meal_name } = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Get all admitted patients with their diet info
  const { results: admitted } = await db.$client.prepare(`
    SELECT a.id as admission_id, a.patient_id, b.ward_name, b.bed_number,
           d.DietTypeName, d.DietTypeId
    FROM admissions a
    LEFT JOIN beds b ON a.bed_id = b.id
    LEFT JOIN CLN_PatientDiet d ON a.patient_id = d.PatientId AND d.tenant_id = a.tenant_id AND d.IsActive = 1
    WHERE a.tenant_id = ? AND a.status = 'admitted'
  `).bind(tenantId).all();

  if (!admitted || admitted.length === 0) {
    return c.json({ message: 'No admitted patients found', generated: 0 });
  }

  const stmts = admitted.map((a: Record<string, unknown>) =>
    db.$client.prepare(`
      INSERT OR IGNORE INTO kitchen_meal_orders
        (tenant_id, patient_id, admission_id, ward_name, bed_number, diet_type_name, meal_name, order_date, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      tenantId, a.patient_id, a.admission_id, a.ward ?? null, a.bed_number ?? null,
      a.DietTypeName ?? 'Normal', meal_name, order_date, userId,
    )
  );

  const batchSize = 100;
  for (let i = 0; i < stmts.length; i += batchSize) {
    await db.$client.batch(stmts.slice(i, i + batchSize));
  }

  return c.json({ message: `Generated ${stmts.length} meal orders`, generated: stmts.length }, 201);
});

// Update order status
kitchen.put('/orders/:id/status', zValidator('json', z.object({
  status: z.enum(['pending', 'preparing', 'ready', 'delivered', 'cancelled', 'returned']),
  delivered_by: z.string().optional(),
  cancelled_reason: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const { status, delivered_by, cancelled_reason } = c.req.valid('json');
  const now = new Date().toISOString();
  const db = getDb(c.env.DB);

  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: (string | number | null)[] = [status, now];

  if (status === 'preparing') { updates.push('prepared_at = ?'); params.push(now); }
  if (status === 'delivered') { updates.push('delivered_at = ?'); params.push(now); if (delivered_by) { updates.push('delivered_by = ?'); params.push(delivered_by); } }
  if (status === 'cancelled' && cancelled_reason) { updates.push('cancelled_reason = ?'); params.push(cancelled_reason); }

  params.push(id, tenantId);
  await db.$client.prepare(
    `UPDATE kitchen_meal_orders SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();

  return c.json({ message: `Order ${status}` });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

kitchen.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const db = getDb(c.env.DB);

  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END) as preparing,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM kitchen_meal_orders
    WHERE tenant_id = ? AND order_date = ?
  `).bind(tenantId, date).first();

  // Per-meal breakdown
  const { results: mealBreakdown } = await db.$client.prepare(`
    SELECT meal_name,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM kitchen_meal_orders
    WHERE tenant_id = ? AND order_date = ?
    GROUP BY meal_name ORDER BY meal_name
  `).bind(tenantId, date).all();

  // Per-diet breakdown
  const { results: dietBreakdown } = await db.$client.prepare(`
    SELECT COALESCE(diet_type_name, 'Normal') as diet_type,
      COUNT(*) as total
    FROM kitchen_meal_orders
    WHERE tenant_id = ? AND order_date = ?
    GROUP BY diet_type_name ORDER BY total DESC
  `).bind(tenantId, date).all();

  return c.json({ stats, mealBreakdown, dietBreakdown, date });
});

// ─── Ward-wise summary ──────────────────────────────────────────────────────

kitchen.get('/ward-summary', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const meal = c.req.query('meal');
  const db = getDb(c.env.DB);

  let query = `
    SELECT ward_name, meal_name,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM kitchen_meal_orders
    WHERE tenant_id = ? AND order_date = ?
  `;
  const params: (string | number)[] = [tenantId, date];
  if (meal) { query += ' AND meal_name = ?'; params.push(meal); }
  query += ' GROUP BY ward_name, meal_name ORDER BY ward_name, meal_name';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

export default kitchen;

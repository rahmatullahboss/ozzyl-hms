import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createNursingOrderSchema,
  updateNursingOrderStatusSchema,
  nursingOrderQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const nursingOrderRoutes = new Hono<NursingEnv>();

nursingOrderRoutes.get('/', zValidator('query', nursingOrderQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id, status, order_type } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT o.*, d.name AS ordered_by_name
    FROM nur_orders o
    LEFT JOIN doctors d ON d.id = o.ordered_by
    WHERE o.tenant_id = ? AND o.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND o.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND o.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND o.status = ?'; params.push(status); }
  if (order_type) { query += ' AND o.order_type = ?'; params.push(order_type); }

  query += ` ORDER BY CASE o.priority WHEN 'stat' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END, o.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_orders WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
  if (order_type) { countQuery += ' AND order_type = ?'; countParams.push(order_type); }
  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

nursingOrderRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT o.*, d.name AS ordered_by_name
    FROM nur_orders o
    LEFT JOIN doctors d ON d.id = o.ordered_by
    WHERE o.id = ? AND o.tenant_id = ? AND o.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Order not found' });
  return c.json({ Results: result });
});

nursingOrderRoutes.post('/', zValidator('json', createNursingOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_orders
      (tenant_id, patient_id, visit_id, order_type, item_name, item_id,
       service_department_id, quantity, priority, instructions, ordered_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.order_type,
    data.item_name, data.item_id ?? null, data.service_department_id ?? null,
    data.quantity, data.priority, data.instructions ?? null,
    data.ordered_by, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

nursingOrderRoutes.put('/:id/status', zValidator('json', updateNursingOrderStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT 1 FROM nur_orders WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Order not found' });

  const data = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE nur_orders SET status = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.status, id, tenantId).run();

  return c.json({ Results: { id, status: data.status } });
});

nursingOrderRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT 1 FROM nur_orders WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Order not found' });

  await db.$client.prepare(
    "UPDATE nur_orders SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();

  return c.json({ Results: true });
});

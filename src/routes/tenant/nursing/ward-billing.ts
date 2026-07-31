import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createWardBillingRequestSchema, wardBillingQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const wardBillingRoutes = new Hono<NursingEnv>();

wardBillingRoutes.get('/', zValidator('query', wardBillingQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, visit_id, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT wb.*, p.name AS patient_name, p.patient_code
    FROM nur_ward_billing_requests wb
    JOIN patients p ON p.id = wb.patient_id AND p.tenant_id = wb.tenant_id
    WHERE wb.tenant_id = ? AND wb.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND wb.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND wb.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND wb.status = ?'; params.push(status); }

  query += ' ORDER BY wb.requested_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_ward_billing_requests wb WHERE wb.tenant_id = ? AND wb.is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND wb.patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND wb.visit_id = ?'; countParams.push(visit_id); }
  if (status) { countQuery += ' AND wb.status = ?'; countParams.push(status); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

wardBillingRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT wb.*, p.name AS patient_name, p.patient_code
    FROM nur_ward_billing_requests wb
    JOIN patients p ON p.id = wb.patient_id AND p.tenant_id = wb.tenant_id
    WHERE wb.id = ? AND wb.tenant_id = ? AND wb.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

wardBillingRoutes.post('/', zValidator('json', createWardBillingRequestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_ward_billing_requests
      (tenant_id, patient_id, visit_id, item_name, item_id, service_department_id,
       quantity, price, total_amount, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.item_name,
    data.item_id ?? null, data.service_department_id ?? null,
    data.quantity, data.price ?? null, data.total_amount ?? null,
    userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

wardBillingRoutes.put('/:id/approve', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_ward_billing_requests WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status !== 'pending') return c.json({ error: 'Already processed' }, 400);

  await db.$client.prepare(`
    UPDATE nur_ward_billing_requests
    SET status = 'approved', approved_by = ?, approved_on = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, id, tenantId).run();

  return c.json({ Results: true });
});

wardBillingRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id FROM nur_ward_billing_requests WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(`
    UPDATE nur_ward_billing_requests
    SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(id, tenantId).run();

  return c.json({ Results: true });
});

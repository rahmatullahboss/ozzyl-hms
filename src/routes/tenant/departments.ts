import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const departments = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / — list all departments
departments.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    `SELECT id, department_name, department_code, is_active,
            created_at, updated_at
     FROM billing_service_departments
     WHERE tenant_id = ?
     ORDER BY department_name`
  ).bind(tenantId).all();

  const departmentsList = (results || []).map((r: any) => ({
    id: r.id,
    name: r.department_name,
    code: r.department_code,
    opd: false,
    ipd: false,
    status: r.is_active === 1 ? 'active' : 'inactive',
  }));

  return c.json({ departments: departmentsList });
});

// POST / — create department
departments.post('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{ name: string; code: string }>();

  if (!body.name || !body.code) {
    throw new HTTPException(400, { message: 'Name and code are required' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM billing_service_departments
     WHERE department_code = ? AND tenant_id = ?`
  ).bind(body.code, tenantId).first();

  if (existing) {
    throw new HTTPException(409, { message: 'Department code already exists' });
  }

  const result = await db.$client.prepare(
    `INSERT INTO billing_service_departments (department_name, department_code, is_active, tenant_id)
     VALUES (?, ?, 1, ?)`
  ).bind(body.name, body.code, tenantId).run();

  return c.json({
    message: 'Department created',
    id: result.meta.last_row_id,
  }, 201);
});

// PUT / — update department
departments.put('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{ id: number; name?: string; code?: string }>();

  if (!body.id) {
    throw new HTTPException(400, { message: 'Department ID is required' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM billing_service_departments WHERE id = ? AND tenant_id = ?`
  ).bind(body.id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: 'Department not found' });
  }

  if (body.code) {
    const duplicate = await db.$client.prepare(
      `SELECT id FROM billing_service_departments
       WHERE department_code = ? AND tenant_id = ? AND id != ?`
    ).bind(body.code, tenantId, body.id).first();

    if (duplicate) {
      throw new HTTPException(409, { message: 'Department code already exists' });
    }
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (body.name) {
    updates.push('department_name = ?');
    params.push(body.name);
  }
  if (body.code) {
    updates.push('department_code = ?');
    params.push(body.code);
  }

  if (updates.length === 0) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  updates.push("updated_at = datetime('now', '+6 hours')");
  params.push(body.id, tenantId);

  await db.$client.prepare(
    `UPDATE billing_service_departments SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();

  return c.json({ message: 'Department updated' });
});

// PUT /status — toggle department status
departments.put('/status', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{ id: number; status: string }>();

  if (!body.id || !body.status) {
    throw new HTTPException(400, { message: 'ID and status are required' });
  }

  const isActive = body.status === 'active' ? 1 : 0;

  const result = await db.$client.prepare(
    `UPDATE billing_service_departments
     SET is_active = ?, updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`
  ).bind(isActive, body.id, tenantId).run();

  if (result.meta.changes === 0) {
    throw new HTTPException(404, { message: 'Department not found' });
  }

  return c.json({ message: 'Department status updated' });
});

export default departments;

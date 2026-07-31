import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const costCenterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createCostCenterSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  description: z.string().max(500).optional(),
});

const updateCostCenterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(20).optional(),
  description: z.string().max(500).optional(),
});

// GET /api/cost-centers
costCenterRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const includeInactive = c.req.query('includeInactive') === 'true';

  const query = includeInactive
    ? 'SELECT * FROM cost_centers WHERE tenant_id = ? ORDER BY code'
    : 'SELECT * FROM cost_centers WHERE tenant_id = ? AND is_active = 1 ORDER BY code';

  const result = await db.$client.prepare(query).bind(tenantId).all();
  return c.json({ costCenters: result.results });
});

// GET /api/cost-centers/:id
costCenterRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const result = await db.$client.prepare(
    'SELECT * FROM cost_centers WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!result) {
    throw new HTTPException(404, { message: 'Cost center not found' });
  }

  return c.json({ costCenter: result });
});

// POST /api/cost-centers
costCenterRoutes.post('/', zValidator('json', createCostCenterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireUserId(c);
  const role = c.get('role');
  const data = c.req.valid('json');

  if (role !== 'director' && role !== 'hospital_admin') {
    throw new HTTPException(403, { message: 'Unauthorized: director or hospital_admin role required' });
  }

  try {
    const result = await db.$client.prepare(
      'INSERT INTO cost_centers (tenant_id, name, code, description) VALUES (?, ?, ?, ?)'
    ).bind(tenantId, data.name, data.code.toUpperCase(), data.description || null).run();

    return c.json({ id: result.meta.last_row_id, message: 'Cost center created' }, 201);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      throw new HTTPException(400, { message: 'Cost center code already exists' });
    }
    throw new HTTPException(500, { message: 'Failed to create cost center' });
  }
});

// PUT /api/cost-centers/:id
costCenterRoutes.put('/:id', zValidator('json', updateCostCenterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireUserId(c);
  const role = c.get('role');
  const id = c.req.param('id');
  const data = c.req.valid('json');

  if (role !== 'director' && role !== 'hospital_admin') {
    throw new HTTPException(403, { message: 'Unauthorized: director or hospital_admin role required' });
  }

  const existing = await db.$client.prepare(
    'SELECT * FROM cost_centers WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: 'Cost center not found' });
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.code !== undefined) {
    updates.push('code = ?');
    values.push(data.code.toUpperCase());
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }

  if (updates.length === 0) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  values.push(id, tenantId);

  try {
    await db.$client.prepare(
      `UPDATE cost_centers SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();

    return c.json({ message: 'Cost center updated' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      throw new HTTPException(400, { message: 'Cost center code already exists' });
    }
    throw new HTTPException(500, { message: 'Failed to update cost center' });
  }
});

// DELETE /api/cost-centers/:id (soft delete)
costCenterRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireUserId(c);
  const role = c.get('role');
  const id = c.req.param('id');

  if (role !== 'director') {
    throw new HTTPException(403, { message: 'Unauthorized: director role required' });
  }

  const existing = await db.$client.prepare(
    'SELECT * FROM cost_centers WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: 'Cost center not found or already inactive' });
  }

  await db.$client.prepare(
    'UPDATE cost_centers SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();

  return c.json({ message: 'Cost center deactivated' });
});

export default costCenterRoutes;
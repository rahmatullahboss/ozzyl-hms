import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requirePermission } from '../../middleware/rbac';

const referralHospitalsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  shortCode: z.string().trim().max(50).optional(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

referralHospitalsRoutes.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const url = new URL(c.req.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const activeParam = url.searchParams.get('active');

  const conditions: string[] = ['tenant_id = ?'];
  const params: (string | number)[] = [tenantId];

  if (activeParam === 'true') conditions.push('is_active = 1');
  else if (activeParam === 'false') conditions.push('is_active = 0');

  if (search) {
    conditions.push('(name LIKE ? OR short_code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const result = await c.env.DB.prepare(`
    SELECT id, tenant_id, name, short_code, is_active, created_at, updated_at
    FROM referral_hospitals
    WHERE ${conditions.join(' AND ')}
    ORDER BY is_active DESC, name ASC
    LIMIT 200
  `).bind(...params).all();

  return c.json({ hospitals: result.results });
});

referralHospitalsRoutes.post('/', requirePermission('billing:write'), zValidator('json', createSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO referral_hospitals (tenant_id, name, short_code, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(tenantId, data.name, data.shortCode ?? null, userId).run();

  const id = Number(result.meta.last_row_id ?? 0);
  return c.json({ id, name: data.name, shortCode: data.shortCode ?? null, isActive: 1 }, 201);
});

referralHospitalsRoutes.put('/:id', requirePermission('billing:write'), zValidator('json', updateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(`
    SELECT id FROM referral_hospitals WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Hospital not found' });

  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.shortCode !== undefined) { sets.push('short_code = ?'); params.push(data.shortCode); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
  sets.push("updated_at = datetime('now', '+6 hours')");

  if (sets.length === 1) {
    return c.json({ message: 'No changes' });
  }

  params.push(Number(id), tenantId);
  await c.env.DB.prepare(`
    UPDATE referral_hospitals SET ${sets.join(', ')}
    WHERE id = ? AND tenant_id = ?
  `).bind(...params).run();

  return c.json({ message: 'Updated' });
});

referralHospitalsRoutes.delete('/:id', requirePermission('billing:write'), async (c) => {
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(`
    SELECT id FROM referral_hospitals WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Hospital not found' });

  await c.env.DB.prepare(`
    UPDATE referral_hospitals
    SET is_active = 0, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ message: 'Disabled' });
});

export default referralHospitalsRoutes;

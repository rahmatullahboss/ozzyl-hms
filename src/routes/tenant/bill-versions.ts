import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireRole } from '../../middleware/rbac';
import { billVersionQuerySchema } from '../../schemas/bill-version';

const billVersions = new Hono<{ Bindings: Env; Variables: Variables }>();

billVersions.use('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));

billVersions.get('/:billId', async (c) => {
  const billId = Number(c.req.param('billId'));
  if (isNaN(billId) || billId <= 0) {
    return c.json({ error: 'Invalid bill ID' }, 400);
  }

  const tenantId = c.get('tenantId');
  const db = c.env.DB;
  const query = billVersionQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const { page, limit } = query.data;
  const offset = (page - 1) * limit;

  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM bill_versions WHERE tenant_id = ? AND bill_id = ?`)
    .bind(tenantId, billId)
    .first();

  const total = (countResult as any)?.total ?? (countResult as any)?.count ?? 0;

  const { results } = await db
    .prepare(
      `SELECT * FROM bill_versions WHERE tenant_id = ? AND bill_id = ? ORDER BY version_number DESC LIMIT ? OFFSET ?`
    )
    .bind(tenantId, billId, limit, offset)
    .all();

  return c.json({
    data: results.map((item: any) => ({
      ...item,
      items_snapshot: typeof item.items_snapshot === 'string' ? JSON.parse(item.items_snapshot) : item.items_snapshot,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

billVersions.get('/:billId/latest', async (c) => {
  const billId = Number(c.req.param('billId'));
  if (isNaN(billId) || billId <= 0) {
    return c.json({ error: 'Invalid bill ID' }, 400);
  }

  const tenantId = c.get('tenantId');
  const db = c.env.DB;

  const latest = await db
    .prepare(
      `SELECT * FROM bill_versions WHERE tenant_id = ? AND bill_id = ? ORDER BY version_number DESC LIMIT 1`
    )
    .bind(tenantId, billId)
    .first();

  if (!latest) {
    return c.json({ error: 'No versions found for this bill' }, 404);
  }

  return c.json({
    data: {
      ...latest,
      items_snapshot: typeof (latest as any).items_snapshot === 'string'
        ? JSON.parse((latest as any).items_snapshot)
        : (latest as any).items_snapshot,
    },
  });
});

export default billVersions;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createBranchSchema, updateBranchSchema } from '../../schemas/branch';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';


const branchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/branches — list all branches for this tenant
branchRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const branches = await db.$client.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM users    WHERE branch_id = b.id AND tenant_id = ?) as staff_count,
        (SELECT COUNT(*) FROM patients WHERE branch_id = b.id AND tenant_id = ?) as patient_count
      FROM branches b
      WHERE b.tenant_id = ?
      ORDER BY b.name ASC
    `).bind(tenantId, tenantId, tenantId).all();
    return c.json({ branches: branches.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch branches' });
  }
});

// GET /api/branches/analytics — aggregate stats per branch for multi-branch dashboard
branchRoutes.get('/analytics', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);

    const branches = await db.$client.prepare(`
      SELECT b.id, b.name, b.address, b.is_active,
        (SELECT COUNT(*) FROM patients WHERE branch_id = b.id AND tenant_id = ?) as patients,
        (SELECT COUNT(*) FROM users WHERE branch_id = b.id AND tenant_id = ?) as staff,
        (SELECT COUNT(*) FROM beds WHERE tenant_id = ?) as beds_total,
        (SELECT COUNT(*) FROM beds WHERE tenant_id = ? AND status = 'occupied') as beds_occupied,
        (SELECT COALESCE(SUM(amount), 0) FROM income WHERE branch_id = b.id AND tenant_id = ? AND strftime('%Y-%m', date) = ?) as revenue,
        (SELECT COALESCE(SUM(amount), 0) FROM income WHERE branch_id = b.id AND tenant_id = ? AND strftime('%Y-%m', date) = ?) as last_month_revenue
      FROM branches b
      WHERE b.tenant_id = ? AND b.is_active = 1
      ORDER BY b.name ASC
    `).bind(tenantId, tenantId, tenantId, tenantId, tenantId, thisMonth, tenantId, lastMonth, tenantId).all();

    const analytics = (branches.results || []).map((b: Record<string, unknown>) => {
      const revenue = Number(b.revenue) || 0;
      const lastMonthRev = Number(b.last_month_revenue) || 0;
      const bedsTotal = Number(b.beds_total) || 0;
      const bedsOccupied = Number(b.beds_occupied) || 0;
      const trend = lastMonthRev > 0
        ? Math.round(((revenue - lastMonthRev) / lastMonthRev) * 100)
        : 0;

      return {
        id: b.id,
        name: b.name,
        location: b.address ?? '',
        status: b.is_active ? 'active' : 'inactive',
        stats: {
          patients: Number(b.patients) || 0,
          revenue,
          beds_total: bedsTotal,
          beds_occupied: bedsOccupied,
          staff: Number(b.staff) || 0,
          occupancy_pct: bedsTotal > 0 ? Math.round((bedsOccupied / bedsTotal) * 100) : 0,
        },
        trend,
      };
    });

    return c.json({ branches: analytics });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch branch analytics' });
  }
});

// GET /api/branches/:id — single branch with summary stats
branchRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const branch = await db.$client.prepare(
      'SELECT * FROM branches WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first();
    if (!branch) throw new HTTPException(404, { message: 'Branch not found' });

    // Get aggregated financials for this branch (last 30 days)
    const [income, expenses, patients] = await db.$client.batch([
      db.$client.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE branch_id = ? AND tenant_id = ? AND date >= date('now', '-30 days')`
      ).bind(id, tenantId),
      db.$client.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE branch_id = ? AND tenant_id = ? AND date >= date('now', '-30 days')`
      ).bind(id, tenantId),
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM patients WHERE branch_id = ? AND tenant_id = ?`
      ).bind(id, tenantId),
    ]);

    return c.json({
      branch,
      stats: {
        incomeThisMonth:   (income.results[0] as { total: number })?.total ?? 0,
        expensesThisMonth: (expenses.results[0] as { total: number })?.total ?? 0,
        totalPatients:     (patients.results[0] as { count: number })?.count ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch branch' });
  }
});

// GET /api/branches/:id/report — detailed monthly income/expense breakdown
branchRoutes.get('/:id/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role     = c.get('role');
  const id = c.req.param('id');
  if (role !== 'hospital_admin') throw new HTTPException(403, { message: 'Only admins can view financial reports' });
  const { from, to } = c.req.query();

  const dateFrom = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo   = to   ?? new Date().toISOString().slice(0, 10);

  try {
    const branch = await db.$client.prepare(
      'SELECT id, name FROM branches WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<{ id: number; name: string }>();
    if (!branch) throw new HTTPException(404, { message: 'Branch not found' });

    const [income, expenses, bills] = await db.$client.batch([
      db.$client.prepare(`
        SELECT date, SUM(amount) as amount, source
        FROM income
        WHERE branch_id = ? AND tenant_id = ? AND date BETWEEN ? AND ?
        GROUP BY date, source
        ORDER BY date ASC
      `).bind(id, tenantId, dateFrom, dateTo),
      db.$client.prepare(`
        SELECT date, SUM(amount) as amount, category
        FROM expenses
        WHERE branch_id = ? AND tenant_id = ? AND date BETWEEN ? AND ?
        GROUP BY date, category
        ORDER BY date ASC
      `).bind(id, tenantId, dateFrom, dateTo),
      db.$client.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(total),0) as total, COALESCE(SUM(paid),0) as paid
        FROM bills
        WHERE branch_id = ? AND tenant_id = ? AND date(created_at) BETWEEN ? AND ?
      `).bind(id, tenantId, dateFrom, dateTo),
    ]);

    return c.json({
      branch: { id: branch.id, name: branch.name },
      period: { from: dateFrom, to: dateTo },
      income:   income.results,
      expenses: expenses.results,
      billing:  bills.results[0],
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to generate branch report' });
  }
});

// POST /api/branches — create new branch (hospital_admin only)
branchRoutes.post('/', zValidator('json', createBranchSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role     = c.get('role');
  if (role !== 'hospital_admin') throw new HTTPException(403, { message: 'Only admins can create branches' });

  const data = c.req.valid('json');

  try {
    const result = await db.$client.prepare(`
      INSERT INTO branches (name, address, phone, email, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(data.name, data.address ?? null, data.phone ?? null, data.email ?? null, tenantId).run();
    return c.json({ message: 'Branch created', id: result.meta.last_row_id }, 201);
  } catch {
    throw new HTTPException(500, { message: 'Failed to create branch' });
  }
});

// PUT /api/branches/:id — update branch info (hospital_admin only)
branchRoutes.put('/:id', zValidator('json', updateBranchSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role     = c.get('role');
  const id       = c.req.param('id');
  if (role !== 'hospital_admin') throw new HTTPException(403, { message: 'Only admins can update branches' });

  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM branches WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Branch not found' });

    await db.$client.prepare(`
      UPDATE branches
      SET name = ?, address = ?, phone = ?, email = ?, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      data.name    ?? existing['name'],
      data.address ?? existing['address'],
      data.phone   ?? existing['phone'],
      data.email   ?? existing['email'],
      id, tenantId,
    ).run();
    return c.json({ message: 'Branch updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update branch' });
  }
});

// DELETE /api/branches/:id — soft-delete (sets is_active=0, hospital_admin only)
branchRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role     = c.get('role');
  const id       = c.req.param('id');
  if (role !== 'hospital_admin') throw new HTTPException(403, { message: 'Only admins can delete branches' });

  try {
    const branch = await db.$client.prepare(
      'SELECT id FROM branches WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first();
    if (!branch) throw new HTTPException(404, { message: 'Branch not found' });

    await db.$client.prepare(
      `UPDATE branches SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).run();
    return c.json({ message: 'Branch deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to deactivate branch' });
  }
});

export default branchRoutes;

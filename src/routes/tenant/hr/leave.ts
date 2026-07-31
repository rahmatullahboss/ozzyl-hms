import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import {
  createLeaveCategorySchema,
  updateLeaveCategorySchema,
  createLeaveRequestSchema,
  approveLeaveSchema,
  initLeaveBalanceSchema,
  createLeaveRuleSchema,
  updateLeaveRuleSchema,
  carryForwardLeaveSchema,
} from '../../../schemas/hr';
import {
  createD1LeaveRepository,
  createD1WorkCalendarRepository,
  createD1WorkforceDirectoryRepository,
  createLeaveService,
  createWorkCalendarService,
  createWorkforceTransaction,
  WorkforceError,
} from '../../../modules/workforce-management';

const leaveRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const OPTIONAL_HOLIDAY_LEAVE_POLICY = 'count_as_working_day' as const;

function createLeaveApplication(db: D1Database) {
  return createLeaveService({
    workforceMembers: createD1WorkforceDirectoryRepository(db),
    leave: createD1LeaveRepository(db),
    calendar: createWorkCalendarService({
      calendar: createD1WorkCalendarRepository(db),
    }),
    transaction: createWorkforceTransaction(db),
    clock: { nowUtc: () => new Date().toISOString() },
    publicIds: { next: (prefix: string) => `${prefix}_${crypto.randomUUID()}` },
    optionalHolidayPolicy: OPTIONAL_HOLIDAY_LEAVE_POLICY,
  });
}

function rethrowWorkforceError(error: unknown): never {
  if (error instanceof WorkforceError) {
    throw new HTTPException(error.httpStatus, { message: error.message });
  }
  throw error;
}

// ─── Leave Categories ──────────────────────────────────────────────────────────

// GET /api/hr/leave/categories
leaveRoutes.get('/categories', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const results = await db.$client
    .prepare('SELECT * FROM hr_leave_categories WHERE tenant_id = ? AND is_active = 1 ORDER BY leave_name')
    .bind(tenantId)
    .all();

  return c.json({ data: results.results });
});

// POST /api/hr/leave/categories
leaveRoutes.post('/categories', zValidator('json', createLeaveCategorySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_leave_categories (tenant_id, leave_name, description, max_days_per_year)
    VALUES (?, ?, ?, ?)
  `).bind(tenantId, data.leaveName, data.description ?? null, data.maxDaysPerYear).run();

  return c.json({ message: 'Leave category created', id: result.meta.last_row_id }, 201);
});

// PUT /api/hr/leave/categories/:id
leaveRoutes.put('/categories/:id', zValidator('json', updateLeaveCategorySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM hr_leave_categories WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Leave category not found' });

  await c.env.DB.prepare(`
    UPDATE hr_leave_categories
    SET leave_name = ?, description = ?, max_days_per_year = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.leaveName ?? existing.leave_name,
    data.description ?? existing.description,
    data.maxDaysPerYear ?? existing.max_days_per_year,
    id,
    tenantId,
  ).run();

  return c.json({ message: 'Leave category updated' });
});

// DELETE /api/hr/leave/categories/:id (soft delete)
leaveRoutes.delete('/categories/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await c.env.DB.prepare(
    'UPDATE hr_leave_categories SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();

  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Leave category not found' });

  return c.json({ message: 'Leave category deactivated' });
});

// ─── Leave Rules (Danphe-style yearly entitlement + pay percent) ──────────────

// GET /api/hr/leave/rules?year=&leaveCategoryId=
leaveRoutes.get('/rules', async (c) => {
  const tenantId = requireTenantId(c);
  const year = c.req.query('year');
  const leaveCategoryId = c.req.query('leaveCategoryId');

  const conditions = ['r.tenant_id = ?', 'r.is_active = 1'];
  const params: (string | number)[] = [tenantId];
  if (year) {
    conditions.push('r.year = ?');
    params.push(Number(year));
  }
  if (leaveCategoryId) {
    conditions.push('r.leave_category_id = ?');
    params.push(Number(leaveCategoryId));
  }

  const { results } = await c.env.DB.prepare(`
    SELECT r.*, lc.leave_name
    FROM hr_leave_rules r
    JOIN hr_leave_categories lc ON r.leave_category_id = lc.id AND lc.tenant_id = r.tenant_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.year DESC, lc.leave_name
  `).bind(...params).all();

  return c.json({ data: results });
});

// POST /api/hr/leave/rules
leaveRoutes.post('/rules', zValidator('json', createLeaveRuleSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const category = await c.env.DB.prepare(
    'SELECT id FROM hr_leave_categories WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(data.leaveCategoryId, tenantId).first();
  if (!category) throw new HTTPException(400, { message: 'Leave category not found' });

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_leave_rules (
      tenant_id, leave_category_id, year, days, pay_percent, is_approved,
      approved_by, approved_on, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
    ON CONFLICT(tenant_id, leave_category_id, year) DO UPDATE SET
      days = excluded.days,
      pay_percent = excluded.pay_percent,
      is_approved = excluded.is_approved,
      approved_by = excluded.approved_by,
      approved_on = excluded.approved_on,
      updated_at = datetime('now', '+6 hours')
  `).bind(
    tenantId,
    data.leaveCategoryId,
    data.year,
    data.days,
    data.payPercent,
    data.isApproved ? 1 : 0,
    data.isApproved ? userId : null,
    data.isApproved ? new Date().toISOString() : null,
    userId,
  ).run();

  return c.json({ message: 'Leave rule saved', id: result.meta.last_row_id }, 201);
});

// PUT /api/hr/leave/rules/:id
leaveRoutes.put('/rules/:id', zValidator('json', updateLeaveRuleSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM hr_leave_rules WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Leave rule not found' });

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const fields: Record<string, unknown> = {
    leave_category_id: data.leaveCategoryId,
    year: data.year,
    days: data.days,
    pay_percent: data.payPercent,
    is_active: data.isActive === undefined ? undefined : (data.isActive ? 1 : 0),
    is_approved: data.isApproved === undefined ? undefined : (data.isApproved ? 1 : 0),
  };
  for (const [column, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value as string | number | null);
    }
  }
  if (data.isApproved === true) {
    sets.push('approved_by = ?', 'approved_on = ?');
    params.push(userId, new Date().toISOString());
  }
  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  params.push(id, tenantId);
  await c.env.DB.prepare(`UPDATE hr_leave_rules SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  return c.json({ message: 'Leave rule updated' });
});

// ─── Leave Balance ─────────────────────────────────────────────────────────────

// POST /api/hr/leave/init-balance — Initialize leave balances for a staff member for a year
leaveRoutes.post('/init-balance', zValidator('json', initLeaveBalanceSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { staffId, year } = c.req.valid('json');

  // Fetch all active leave categories
  const { results: categories } = await c.env.DB.prepare(
    'SELECT id, max_days_per_year FROM hr_leave_categories WHERE tenant_id = ? AND is_active = 1'
  ).bind(tenantId).all();

  if (!categories || categories.length === 0) {
    throw new HTTPException(400, { message: 'No leave categories found. Create leave categories first.' });
  }

  // Insert balance for each category (ignore if already exists)
  const stmts = (categories as { id: number; max_days_per_year: number }[]).map((cat) =>
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO hr_employee_leave_balances
        (tenant_id, staff_id, leave_category_id, year, total_allowed, balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(tenantId, staffId, cat.id, year, cat.max_days_per_year, cat.max_days_per_year)
  );

  await c.env.DB.batch(stmts);

  return c.json({ message: `Leave balance initialized for ${categories.length} categories` });
});

// GET /api/hr/leave/balances?year=
leaveRoutes.get('/balances', async (c) => {
  const tenantId = requireTenantId(c);
  const year = c.req.query('year') || new Date().getFullYear().toString();

  const balances = await c.env.DB.prepare(
    `SELECT eb.*, s.name as staff_name, lc.leave_name
     FROM hr_employee_leave_balances eb
     JOIN staff s ON s.id = eb.staff_id
     JOIN hr_leave_categories lc ON lc.id = eb.leave_category_id
     WHERE eb.tenant_id = ? AND eb.year = ?
     ORDER BY s.name, lc.leave_name`
  ).bind(tenantId, year).all();

  return c.json({ data: balances.results });
});

// GET /api/hr/leave/balance/:staffId?year=
leaveRoutes.get('/balance/:staffId', async (c) => {
  const tenantId = requireTenantId(c);
  const staffId = Number(c.req.param('staffId'));
  const year = Number(c.req.query('year') || new Date().getFullYear());

  const { results } = await c.env.DB.prepare(`
    SELECT lb.*, lc.leave_name, lc.max_days_per_year
    FROM hr_employee_leave_balances lb
    JOIN hr_leave_categories lc ON lb.leave_category_id = lc.id
    WHERE lb.tenant_id = ? AND lb.staff_id = ? AND lb.year = ?
  `).bind(tenantId, staffId, year).all();

  return c.json({ data: results });
});

// ─── Leave Requests ────────────────────────────────────────────────────────────

// POST /api/hr/leave/request
leaveRoutes.post('/request', zValidator('json', createLeaveRequestSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  try {
    const result = await createLeaveApplication(c.env.DB).requestLeave({
      tenantId,
      staffId: data.staffId,
      leaveCategoryId: data.leaveCategoryId,
      startDate: data.startDate,
      endDate: data.endDate,
      reason: data.reason ?? null,
      requestedTo: data.requestedTo ?? null,
    });
    return c.json({
      message: 'Leave request submitted',
      id: result.leaveRequestId,
      data: result,
    }, 201);
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

// GET /api/hr/leave/requests?status=pending&staffId=
leaveRoutes.get('/requests', async (c) => {
  const tenantId = requireTenantId(c);
  const status = c.req.query('status');
  const staffId = c.req.query('staffId');

  let query = `
    SELECT lr.*, s.name as staff_name, s.position, lc.leave_name
    FROM hr_leave_requests lr
    JOIN staff s ON lr.staff_id = s.id
    JOIN hr_leave_categories lc ON lr.leave_category_id = lc.id
    WHERE lr.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (status) {
    query += ' AND lr.status = ?';
    params.push(status);
  }
  if (staffId) {
    query += ' AND lr.staff_id = ?';
    params.push(Number(staffId));
  }

  query += ' ORDER BY lr.created_at DESC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  return c.json({ data: results });
});

// PATCH /api/hr/leave/requests/:id/approve
leaveRoutes.patch('/requests/:id/approve', zValidator('json', approveLeaveSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const leaveRequestId = Number(c.req.param('id'));
  const actorUserId = requireUserId(c);
  const { status, rejectionReason } = c.req.valid('json');

  if (!Number.isInteger(leaveRequestId) || leaveRequestId <= 0) {
    throw new HTTPException(404, { message: 'Leave request not found' });
  }

  try {
    const result = await createLeaveApplication(c.env.DB).reviewLeave({
      tenantId,
      actorUserId,
      leaveRequestId,
      status,
      rejectionReason: rejectionReason ?? null,
    });
    return c.json({
      message: status === 'approved' ? 'Leave approved' : `Leave request ${status}`,
      daysDeducted: status === 'approved' ? result.workingDays : 0,
      data: result,
    });
  } catch (error) {
    rethrowWorkforceError(error);
  }
});

leaveRoutes.post('/carry-forward', zValidator('json', carryForwardLeaveSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { staffId, fromYear, toYear } = c.req.valid('json');
  const { results: balances } = await c.env.DB.prepare(`SELECT lb.*, lc.max_days_per_year FROM hr_employee_leave_balances lb JOIN hr_leave_categories lc ON lb.leave_category_id = lc.id AND lc.tenant_id = lb.tenant_id WHERE lb.tenant_id = ? AND lb.staff_id = ? AND lb.year = ? AND lb.balance > 0`).bind(tenantId, staffId, fromYear).all();
  if (balances.length === 0) return c.json({ message: 'No leave balance to carry forward', count: 0 });
  const MAX_CF = 10;
  const stmts = [];
  let totalCarried = 0;
  for (const bal of balances as { leave_category_id: number; balance: number; max_days_per_year: number }[]) {
    const carryDays = Math.min(bal.balance, MAX_CF);
    if (carryDays <= 0) continue;
    const existing = await c.env.DB.prepare(`SELECT id, total_allowed, carry_forward, used FROM hr_employee_leave_balances WHERE tenant_id = ? AND staff_id = ? AND leave_category_id = ? AND year = ?`).bind(tenantId, staffId, bal.leave_category_id, toYear).first<{ id: number; total_allowed: number; carry_forward: number; used: number }>();
    if (existing) {
      const baseQuota = existing.total_allowed - existing.carry_forward;
      const used = Number(existing.used || 0);
      stmts.push(c.env.DB.prepare(`UPDATE hr_employee_leave_balances SET total_allowed = ?, balance = ?, carry_forward = ? WHERE id = ?`).bind(baseQuota + carryDays, baseQuota + carryDays - used, carryDays, existing.id));
    } else {
      const baseQuota = bal.max_days_per_year;
      stmts.push(c.env.DB.prepare(`INSERT INTO hr_employee_leave_balances (tenant_id, staff_id, leave_category_id, year, total_allowed, balance, carry_forward) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(tenantId, staffId, bal.leave_category_id, toYear, baseQuota + carryDays, baseQuota + carryDays, carryDays));
    }
    totalCarried += carryDays;
  }
  if (stmts.length === 0) return c.json({ message: 'No leave balance to carry forward', count: 0 });
  await c.env.DB.batch(stmts);
  return c.json({ message: `Carried forward ${totalCarried} day(s) from ${fromYear} to ${toYear}`, categoriesCount: stmts.length, totalDaysCarried: totalCarried });
});

export default leaveRoutes;

import { Hono } from 'hono';
import { requireRole } from '../../middleware/rbac';
import { createShiftClosingSchema, approveShiftClosingSchema } from '../../schemas/shift-closing';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';

const shiftClosing = new Hono<{ Bindings: Env; Variables: Variables }>();

shiftClosing.post('/', requireRole('reception', 'accountant', 'hospital_admin', 'md', 'director'));
shiftClosing.get('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));
shiftClosing.put('/*', requireRole('hospital_admin', 'md', 'director', 'manager'));

shiftClosing.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createShiftClosingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const userId = requireUserId(c);
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const data = parsed.data;

  const payments = await db
    .prepare(`
      SELECT COALESCE(payment_method, 'cash') AS method, COALESCE(SUM(amount), 0) AS total
      FROM payments
      WHERE tenant_id = ? AND date(date) = date(?)
      GROUP BY COALESCE(payment_method, 'cash')
    `)
    .bind(tenantId, data.shiftDate)
    .all();

  const expected: Record<string, number> = { cash: 0, bkash: 0, nagad: 0, card: 0, bank: 0 };
  for (const row of payments.results as any[]) {
    const method = (row.method || 'cash').toLowerCase();
    if (method in expected) expected[method] = row.total;
  }

  const cashShortExcess = data.submittedCash - expected.cash;

  const result = await db
    .prepare(
      `INSERT INTO shift_closings (tenant_id, user_id, counter_id, shift_date, start_time, end_time,
       expected_cash, expected_bkash, expected_nagad, expected_card, expected_bank,
       submitted_cash, submitted_bkash, submitted_nagad, submitted_card, submitted_bank,
       cash_short_excess, status, notes)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+6 hours'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(
      tenantId, userId, data.counterId || null, data.shiftDate, data.startTime || null,
      expected.cash, expected.bkash, expected.nagad, expected.card, expected.bank,
      data.submittedCash, data.submittedBkash || 0, data.submittedNagad || 0, data.submittedCard || 0, data.submittedBank || 0,
      cashShortExcess, data.notes || null
    )
    .run();

  const createdId = Number(result.meta.last_row_id);
  void createAuditLog(c.env, tenantId, String(userId), 'CREATE', 'shift_closings', createdId, null, { shiftDate: data.shiftDate, cashShortExcess, status: 'pending' });

  return c.json({
    data: {
      id: createdId,
      expectedCash: expected.cash,
      submittedCash: data.submittedCash,
      cashShortExcess,
      status: 'pending',
    },
  }, 201);
});

shiftClosing.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const status = c.req.query('status');

  let sql = `SELECT * FROM shift_closings WHERE tenant_id = ?`;
  const params: unknown[] = [tenantId];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC`;

  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

shiftClosing.put('/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid ID' }, 400);
  }

  const body = await c.req.json();
  const parsed = approveShiftClosingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { action, notes } = parsed.data;
  const userId = requireUserId(c);
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  const closing = await db
    .prepare(`SELECT * FROM shift_closings WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId)
    .first();

  if (!closing) return c.json({ error: 'Not found' }, 404);
  if ((closing as any).status !== 'pending') return c.json({ error: 'Already reviewed' }, 409);

  if (String((closing as any).user_id) === String(userId)) {
    return c.json({ error: 'Cannot approve your own shift closing' }, 403);
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  await db
    .prepare(`UPDATE shift_closings SET status = ?, approved_by = ?, approved_at = datetime('now', '+6 hours'), notes = ? WHERE id = ?`)
    .bind(newStatus, userId, notes || null, id)
    .run();

  const auditAction = action === 'approve' ? 'APPROVE' : 'REJECT';
  void createAuditLog(c.env, tenantId, String(userId), auditAction, 'shift_closings', id, closing, { status: newStatus, notes });

  return c.json({ data: { id, status: newStatus } });
});

export default shiftClosing;

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getTodayGMT6 } from '../../lib/date-utils';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { isRoleAllowed } from '../../lib/authz';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';


const handover = new Hono<{ Bindings: Env; Variables: Variables }>();
const HANDOVER_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;
const HANDOVER_VERIFY_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const HANDOVER_SUPERVISOR_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

const cashHandoverNetExpression = `
  CASE
    WHEN COALESCE(payment_method, 'cash') = 'cash'
      AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN amount
    WHEN COALESCE(payment_method, 'cash') = 'cash'
      AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN -amount
    ELSE 0
  END
`;

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post billing handover accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function parsePositiveId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: `Invalid ${label}` });
  }
  return id;
}

function isHandoverSupervisor(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
  return isRoleAllowed(c.get('role'), HANDOVER_SUPERVISOR_ROLES);
}

function assertStaffScope(c: Context<{ Bindings: Env; Variables: Variables }>, staffId: number): void {
  if (isHandoverSupervisor(c)) return;
  const userId = Number(requireUserId(c));
  if (staffId !== userId) {
    throw new HTTPException(403, { message: 'Cannot access another staff member handovers' });
  }
}

async function recordCashHandoverEvent(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tenantId: string,
  sourceId: string | number,
  createdBy: string,
  amount: number,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;

  await recordAccountingPostingEvent(c.env.DB, {
    tenantId,
    sourceType: 'billing_handover',
    sourceId,
    eventType: ACCOUNTING_EVENT_TYPES.cashHandover,
    eventDate: getTodayGMT6(),
    createdBy,
    payload: {
      ...payload,
      amount,
    },
  });
  queueAccountingPosting(c, tenantId);
}

// ─── GET / — list handovers ─────────────────────────────────────────────────

handover.get('/', requireRole(...HANDOVER_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const { status, staff_id } = c.req.query();

  let sql = `
    SELECT h.*,
      s1.name as handover_by_name, s2.name as handover_to_name, s3.name as received_by_name
    FROM billing_handovers h
    LEFT JOIN staff s1 ON h.handover_by = s1.id
    LEFT JOIN staff s2 ON h.handover_to = s2.id
    LEFT JOIN staff s3 ON h.received_by = s3.id
    WHERE h.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];
  if (status) { sql += ' AND h.status = ?'; params.push(status); }
  if (staff_id) {
    const staffId = parsePositiveId(staff_id, 'staff_id');
    assertStaffScope(c, staffId);
    sql += ' AND (h.handover_by = ? OR h.handover_to = ?)';
    params.push(staffId, staffId);
  } else if (!isHandoverSupervisor(c)) {
    sql += ' AND (h.handover_by = ? OR h.handover_to = ?)';
    params.push(userId, userId);
  }
  sql += ' ORDER BY h.created_at DESC LIMIT 100';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ handovers: results });
});

// ─── GET /pending — pending handovers for me ────────────────────────────────

handover.get('/pending/:staffId', requireRole(...HANDOVER_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const staffId = parsePositiveId(c.req.param('staffId'), 'staffId');
  assertStaffScope(c, staffId);

  const { results } = await db.$client.prepare(`
    SELECT h.*, s.name as handover_by_name
    FROM billing_handovers h LEFT JOIN staff s ON h.handover_by = s.id
    WHERE h.tenant_id = ? AND h.handover_to = ? AND h.status = 'pending'
    ORDER BY h.created_at DESC
  `).bind(tenantId, staffId).all();
  return c.json({ pending: results });
});

// ─── POST / — create handover ───────────────────────────────────────────────

const createHandoverSchema = z.object({
  handover_to: z.number().int().positive().nullable().optional(),
  handover_amount: z.number().positive(),
  due_amount: z.number().min(0).default(0),
  handover_type: z.enum(['user', 'account']).default('user'),
  bank_name: z.string().optional(),
  voucher_number: z.string().optional(),
  voucher_date: z.string().optional(),
  denomination_details: z.string().optional(),
  remarks: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.handover_type === 'user' && !data.handover_to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['handover_to'],
      message: 'handover_to is required for user handover type',
    });
  }
  if (data.due_amount > data.handover_amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['due_amount'],
      message: 'Due amount cannot exceed handover amount',
    });
  }
});

handover.post('/', requireRole(...HANDOVER_ROLES), zValidator('json', createHandoverSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Prevent self-handover (only applies to user type)
  if (data.handover_type === 'user' && data.handover_to === Number(userId)) {
    throw new HTTPException(400, { message: 'Cannot create handover to yourself' });
  }

  const handoverTo = data.handover_type === 'account' ? null : data.handover_to;
  const status = data.handover_type === 'account' ? 'received' : (data.due_amount > 0 ? 'partial' : 'pending');
  const result = await db.$client.prepare(`
    INSERT INTO billing_handovers (tenant_id, handover_type, handover_by, handover_to, handover_amount, due_amount, status, remarks, bank_name, voucher_number, voucher_date, denomination_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.handover_type,
    userId,
    handoverTo,
    data.handover_amount,
    data.due_amount,
    status,
    data.remarks || null,
    data.bank_name || null,
    data.voucher_number || null,
    data.voucher_date || null,
    data.denomination_details || null,
  ).run();

  const handoverId = Number(result.meta.last_row_id);
  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'billing_handovers', handoverId, null, {
    handoverTo,
    handoverAmount: data.handover_amount,
    dueAmount: data.due_amount,
    handoverType: data.handover_type,
    bankName: data.bank_name || null,
    voucherNumber: data.voucher_number || null,
    voucherDate: data.voucher_date || null,
    denominationDetails: data.denomination_details || null,
    status,
  });

  return c.json({ id: handoverId, message: 'Handover created', status }, 201);
});

// ─── PUT /:id/receive — confirm receipt ──────────────────────────────────────

handover.put('/:id/receive', requireRole(...HANDOVER_ROLES), zValidator('json', z.object({ remarks: z.string().optional() })), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parsePositiveId(c.req.param('id'), 'handover ID');
  const { remarks } = c.req.valid('json');

  const existing = await db.$client.prepare(`
    SELECT id, handover_by, handover_to, handover_amount, due_amount, status
    FROM billing_handovers
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first<{
    id: number;
    handover_by: number;
    handover_to: number | null;
    handover_amount: number;
    due_amount: number | null;
    status: string;
  }>();

  if (!existing) throw new HTTPException(404, { message: 'Handover not found' });
  if (!['pending', 'partial'].includes(existing.status)) {
    throw new HTTPException(400, { message: `Handover already ${existing.status}` });
  }
  if (!isHandoverSupervisor(c) && Number(existing.handover_to) !== Number(userId)) {
    throw new HTTPException(403, { message: 'Only the handover recipient can receive this cash handover' });
  }

  const result = await db.$client.prepare(`
    UPDATE billing_handovers SET status = 'received', received_by = ?, received_at = datetime('now', '+6 hours'), received_remarks = ?
    WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'partial')
  `).bind(userId, remarks || null, id, tenantId).run();

  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Pending handover not found' });
  const actualReceived = Math.max(0, Number(existing.handover_amount ?? 0) - Number(existing.due_amount ?? 0));
  await recordCashHandoverEvent(c, tenantId, `receive-${id}`, userId, actualReceived, {
    handoverId: id,
    handoverBy: existing.handover_by,
    handoverTo: existing.handover_to,
    dueAmount: Number(existing.due_amount ?? 0),
    remarks: remarks ?? null,
  });
  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', id, {
    status: existing.status,
    dueAmount: Number(existing.due_amount ?? 0),
  }, {
    status: 'received',
    receivedBy: userId,
    receivedAmount: actualReceived,
  });
  return c.json({ message: 'Handover received' });
});

// ─── PUT /:id/verify — admin verify ──────────────────────────────────────────

handover.put('/:id/verify', requireRole(...HANDOVER_VERIFY_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parsePositiveId(c.req.param('id'), 'handover ID');

  const existing = await db.$client.prepare(`
    SELECT id, status
    FROM billing_handovers
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Handover not found' });
  if (existing.status === 'verified') throw new HTTPException(400, { message: 'Handover already verified' });

  const result = await db.$client.prepare("UPDATE billing_handovers SET status = 'verified' WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Handover not found' });
  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', id, {
    status: existing.status,
  }, {
    status: 'verified',
    verifiedBy: userId,
  });
  return c.json({ message: 'Handover verified' });
});

// ─── GET /report/daily — daily collection vs handover report ─────────────────

handover.get('/report/daily', requireRole(...HANDOVER_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const staffId = c.req.query('staff_id');
  if (!staffId) throw new HTTPException(400, { message: 'staff_id required' });
  const staffIdNumber = parsePositiveId(staffId, 'staff_id');
  assertStaffScope(c, staffIdNumber);

  const collections = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN COALESCE(payment_method, 'cash') = 'cash'
         AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
        THEN amount ELSE 0 END), 0) as total_in,
      COALESCE(SUM(CASE
        WHEN COALESCE(payment_method, 'cash') = 'cash'
         AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
        THEN amount ELSE 0 END), 0) as total_out,
      COALESCE(SUM(${cashHandoverNetExpression}), 0) as total_collection
    FROM emp_cash_transactions
    WHERE tenant_id = ? AND date(transaction_date) = ? AND employee_id = ?
  `).bind(tenantId, date, staffIdNumber).first<{ total_in: number; total_out: number; total_collection: number }>();

  const handovers = await db.$client.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN status = 'partial' THEN handover_amount - COALESCE(due_amount, 0)
        ELSE handover_amount
      END
    ), 0) as total_handover
    FROM billing_handovers WHERE tenant_id = ? AND date(created_at) = ? AND handover_by = ?
  `).bind(tenantId, date, staffIdNumber).first<{ total_handover: number }>();

  const totalC = collections?.total_collection || 0;
  const totalH = handovers?.total_handover || 0;

  return c.json({
    date, staff_id: staffId,
    total_in: collections?.total_in || 0,
    total_out: collections?.total_out || 0,
    total_collection: totalC,
    total_handover: totalH,
    difference: totalC - totalH,
  });
});

export default handover;

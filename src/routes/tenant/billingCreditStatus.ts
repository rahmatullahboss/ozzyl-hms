import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { getPagination, paginationMeta } from '../../lib/pagination';

const creditStatusRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const CREDIT_STATUS_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

const createCreditStatusSchema = z.object({
  bill_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  fiscal_year_id: z.number().int().positive().optional(),
  invoice_no: z.string().optional(),
  credit_organization_id: z.number().int().positive().optional(),
  liable_party: z.enum(['SELF', 'Organization']).default('SELF'),
  sales_total_bill_amount: z.number().min(0).default(0),
  return_total_bill_amount: z.number().min(0).default(0),
  co_pay_received_amount: z.number().min(0).default(0),
  co_pay_return_amount: z.number().min(0).default(0),
  non_claimable_amount: z.number().min(0).default(0),
  is_claimable: z.number().int().min(0).max(1).default(1),
  claim_code: z.string().optional(),
});

// ─── GET / — list all credit bill statuses (paginated, filterable) ─────────

creditStatusRoutes.get('/', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const settlementStatus = c.req.query('settlement_status');
  const { page, limit, offset } = getPagination(c);

  try {
    let whereClause = 'WHERE cs.tenant_id = ? AND cs.is_active = 1';
    const params: (string | number)[] = [tenantId];

    if (patientId) {
      whereClause += ' AND cs.patient_id = ?';
      params.push(Number(patientId));
    }
    if (settlementStatus) {
      whereClause += ' AND cs.settlement_status = ?';
      params.push(settlementStatus);
    }

    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM billing_credit_bill_status cs ${whereClause}`
    ).bind(...params).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const { results } = await db.$client.prepare(`
      SELECT cs.*, p.name as patient_name, p.patient_code
      FROM billing_credit_bill_status cs
      JOIN patients p ON cs.patient_id = p.id AND p.tenant_id = cs.tenant_id
      ${whereClause}
      ORDER BY cs.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({
      credit_bill_statuses: results,
      meta: paginationMeta(page, limit, total),
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch credit bill statuses' });
  }
});

// ─── GET /pending — list only pending credit bills ─────────────────────────

creditStatusRoutes.get('/pending', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');

  try {
    let whereClause = "WHERE cs.tenant_id = ? AND cs.is_active = 1 AND cs.settlement_status = 'Pending'";
    const params: (string | number)[] = [tenantId];

    if (patientId) {
      whereClause += ' AND cs.patient_id = ?';
      params.push(Number(patientId));
    }

    const { results } = await db.$client.prepare(`
      SELECT cs.*, p.name as patient_name, p.patient_code
      FROM billing_credit_bill_status cs
      JOIN patients p ON cs.patient_id = p.id AND p.tenant_id = cs.tenant_id
      ${whereClause}
      ORDER BY cs.created_at ASC
    `).bind(...params).all();

    return c.json({ pending_credit_bills: results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch pending credit bills' });
  }
});

// ─── GET /by-bill/:billId — get credit status for a specific bill ──────────

creditStatusRoutes.get('/by-bill/:billId', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const billId = Number(c.req.param('billId'));

  if (!Number.isFinite(billId) || billId <= 0) {
    throw new HTTPException(400, { message: 'Invalid bill ID' });
  }

  try {
    const record = await db.$client.prepare(`
      SELECT cs.*, p.name as patient_name, p.patient_code
      FROM billing_credit_bill_status cs
      JOIN patients p ON cs.patient_id = p.id AND p.tenant_id = cs.tenant_id
      WHERE cs.bill_id = ? AND cs.tenant_id = ? AND cs.is_active = 1
      LIMIT 1
    `).bind(billId, tenantId).first();

    if (!record) throw new HTTPException(404, { message: 'Credit bill status not found' });

    return c.json({ credit_bill_status: record });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch credit bill status' });
  }
});

// ─── POST / — create a new credit bill status record ───────────────────────

creditStatusRoutes.post('/', requireRole(...CREDIT_STATUS_ROLES), zValidator('json', createCreditStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const netReceivable = data.sales_total_bill_amount
      - data.return_total_bill_amount
      - data.co_pay_received_amount
      - data.non_claimable_amount
      + data.co_pay_return_amount;

    const result = await db.$client.prepare(`
      INSERT INTO billing_credit_bill_status (
        tenant_id, bill_id, fiscal_year_id, invoice_no, patient_id,
        credit_organization_id, liable_party, sales_total_bill_amount,
        return_total_bill_amount, co_pay_received_amount, co_pay_return_amount,
        net_receivable_amount, non_claimable_amount, is_claimable, claim_code,
        settlement_status, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 1, ?)
    `).bind(
      tenantId,
      data.bill_id,
      data.fiscal_year_id ?? null,
      data.invoice_no ?? null,
      data.patient_id,
      data.credit_organization_id ?? null,
      data.liable_party,
      data.sales_total_bill_amount,
      data.return_total_bill_amount,
      data.co_pay_received_amount,
      data.co_pay_return_amount,
      Math.round(netReceivable * 100) / 100,
      data.non_claimable_amount,
      data.is_claimable,
      data.claim_code ?? null,
      userId,
    ).run();

    const id = Number(result.meta?.last_row_id ?? 0);

    return c.json({ message: 'Credit bill status created', id }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create credit bill status' });
  }
});

// ─── PUT /:id/settle — mark a credit bill as settled ───────────────────────

creditStatusRoutes.put('/:id/settle', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  if (!Number.isFinite(id) || id <= 0) {
    throw new HTTPException(400, { message: 'Invalid credit bill status ID' });
  }

  try {
    const existing = await db.$client.prepare(
      'SELECT id, settlement_status FROM billing_credit_bill_status WHERE id = ? AND tenant_id = ? AND is_active = 1'
    ).bind(id, tenantId).first<{ id: number; settlement_status: string }>();

    if (!existing) throw new HTTPException(404, { message: 'Credit bill status not found' });
    if (existing.settlement_status === 'Completed') {
      throw new HTTPException(400, { message: 'Credit bill is already settled' });
    }

    await db.$client.prepare(`
      UPDATE billing_credit_bill_status
      SET settlement_status = 'Completed', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    return c.json({ message: 'Credit bill settled', id });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to settle credit bill' });
  }
});

export default creditStatusRoutes;

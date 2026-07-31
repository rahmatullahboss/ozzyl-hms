import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createIncomeSchema, reverseIncomeSchema, updateIncomeSchema } from '../../schemas/accounting';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { requireRole } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';
import {
  hasDirectIncomeAccountingEvent,
  queueDirectFinancePosting,
  recordAndQueueDirectIncomeAccountingEvent,
} from '../../lib/direct-finance-accounting';
import {
  ACCOUNTING_EVENT_TYPES,
  getPaymentAssetMappingKey,
  recordAccountingPostingEvent,
  resolveAccountMappings,
} from '../../lib/accounting-posting';
import { getTodayGMT6 } from '../../lib/date-utils';


const incomeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const INCOME_READ_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;
const INCOME_WRITE_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

incomeRoutes.get('/', requireRole(...INCOME_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, source } = c.req.query();

  let query = 'SELECT * FROM income WHERE tenant_id = ?';
  const params: any[] = [tenantId];

  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }
  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }

  query += ' ORDER BY date DESC, id DESC';

  try {
    const result = await db.$client.prepare(query).bind(...params).all();
    return c.json({ income: result.results });
  } catch (error) {
    console.error('Error fetching income:', error);
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

incomeRoutes.post('/', requireRole(...INCOME_WRITE_ROLES), zValidator('json', createIncomeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { date, source, amount, description, bill_id } = c.req.valid('json');

  try {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Income creation');

    const result = await db.$client.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(date, source, amount, description || null, bill_id || null, tenantId, userId).run();

    const incomeId = result.meta.last_row_id;

    await recordAndQueueDirectIncomeAccountingEvent(c, {
      tenantId,
      userId,
      incomeId,
      date,
      source,
      amount,
      paymentMethod: 'cash',
      description: description ?? null,
    });

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'income',
      incomeId,
      null,
      { date, source, amount, description }
    );

    return c.json({ 
      success: true, 
      id: incomeId,
      message: 'Income created successfully' 
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error creating income:', error);
    return c.json({ error: 'Failed to create income' }, 500);
  }
});

incomeRoutes.post('/:id/reverse', requireRole(...INCOME_WRITE_ROLES), zValidator('json', reverseIncomeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(`
      SELECT * FROM income WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first<any>();

    if (!existing) {
      return c.json({ error: 'Income not found' }, 404);
    }

    const originalEvent = await c.env.DB.prepare(`
      SELECT id, payload_json
      FROM accounting_posting_events
      WHERE tenant_id = ? AND source_type = 'direct_income' AND source_id = ?
        AND event_type = ? AND status IN ('pending', 'posted')
      ORDER BY id DESC
      LIMIT 1
    `).bind(tenantId, String(id), ACCOUNTING_EVENT_TYPES.directIncomeReceived).first<{ id: number; payload_json: string | null }>();

    if (!originalEvent) {
      throw new HTTPException(409, { message: 'Income has not been posted yet. Update or delete the unposted income record instead.' });
    }

    const existingReversal = await c.env.DB.prepare(`
      SELECT id
      FROM accounting_posting_events
      WHERE tenant_id = ? AND source_type = 'direct_income_reversal' AND source_id = ?
        AND event_type = ? AND status IN ('pending', 'posted')
      LIMIT 1
    `).bind(tenantId, String(id), ACCOUNTING_EVENT_TYPES.manualJournal).first<{ id: number }>();

    if (existingReversal) {
      throw new HTTPException(409, { message: 'Income reversal journal already exists for this income record.' });
    }

    const reversalDate = data.date ?? getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, reversalDate, 'Income reversal');

    let originalPayload: Record<string, unknown> = {};
    try {
      originalPayload = JSON.parse(originalEvent.payload_json || '{}') as Record<string, unknown>;
    } catch {
      originalPayload = {};
    }

    const amount = Number(existing.amount ?? originalPayload.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HTTPException(400, { message: 'Income amount is not reversible.' });
    }

    const paymentMethod = data.paymentMethod ?? String(originalPayload.paymentMethod ?? 'cash');
    const paymentAssetKey = getPaymentAssetMappingKey(paymentMethod);
    const mappings = await resolveAccountMappings(c.env.DB, tenantId, ['other_revenue', paymentAssetKey]);
    const revenueAccountId = mappings.other_revenue;
    const paymentAccountId = mappings[paymentAssetKey];
    if (!revenueAccountId || !paymentAccountId) {
      throw new Error('Missing accounting account mapping for income reversal.');
    }

    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'direct_income_reversal',
      sourceId: id,
      eventType: ACCOUNTING_EVENT_TYPES.manualJournal,
      eventDate: reversalDate,
      createdBy: userId,
      payload: {
        incomeId: id,
        reversalOf: 'direct_income',
        originalPostingEventId: originalEvent.id,
        reason: data.reason ?? null,
        lines: [
          {
            accountId: revenueAccountId,
            debit: amount,
            credit: 0,
            memo: `Reverse direct income ${id}`,
          },
          {
            accountId: paymentAccountId,
            debit: 0,
            credit: amount,
            memo: `Reverse ${paymentMethod} direct income receipt`,
          },
        ],
      },
    });

    queueDirectFinancePosting(c, tenantId, 'Failed to post income reversal accounting event:');

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPDATE',
      'income',
      parseInt(id, 10),
      existing,
      { action: 'reverse_income', reversalDate, amount, reason: data.reason ?? null, paymentMethod },
    );

    return c.json({
      success: true,
      message: 'Income reversal journal queued',
      incomeId: Number(id),
      amount,
      reversalDate,
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error reversing income:', error);
    return c.json({ error: 'Failed to reverse income' }, 500);
  }
});

incomeRoutes.get('/:id', requireRole(...INCOME_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const result = await db.$client.prepare(`
      SELECT * FROM income WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: 'Income not found' }, 404);
    }

    return c.json({ income: result });
  } catch (error) {
    console.error('Error fetching income:', error);
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

incomeRoutes.put('/:id', requireRole(...INCOME_WRITE_ROLES), zValidator('json', updateIncomeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const { date, source, amount, description } = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(`
      SELECT * FROM income WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!existing) {
      return c.json({ error: 'Income not found' }, 404);
    }

    if (await hasDirectIncomeAccountingEvent(c.env.DB, tenantId, id)) {
      throw new HTTPException(409, { message: 'Posted income cannot be edited. Create a reversal journal instead.' });
    }

    const existingDate = String((existing as any).date);
    const targetDate = date || existingDate;
    await assertAccountingPeriodOpen(c.env.DB, tenantId, existingDate, 'Income update');
    if (targetDate !== existingDate) {
      await assertAccountingPeriodOpen(c.env.DB, tenantId, targetDate, 'Income update');
    }

    await db.$client.prepare(`
      UPDATE income SET date = ?, source = ?, amount = ?, description = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      targetDate,
      source || (existing as any).source,
      amount || (existing as any).amount,
      description !== undefined ? description : (existing as any).description,
      id,
      tenantId
    ).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPDATE',
      'income',
      parseInt(id),
      existing,
      { date, source, amount, description }
    );


    return c.json({ success: true, message: 'Income updated successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error updating income:', error);
    return c.json({ error: 'Failed to update income' }, 500);
  }
});

incomeRoutes.delete('/:id', requireRole(...INCOME_WRITE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(`
      SELECT * FROM income WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!existing) {
      return c.json({ error: 'Income not found' }, 404);
    }

    if (await hasDirectIncomeAccountingEvent(c.env.DB, tenantId, id)) {
      throw new HTTPException(409, { message: 'Posted income cannot be deleted. Create a reversal journal instead.' });
    }

    await assertAccountingPeriodOpen(c.env.DB, tenantId, String((existing as any).date), 'Income deletion');

    await db.$client.prepare(`
      DELETE FROM income WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'DELETE',
      'income',
      parseInt(id),
      existing,
      null
    );

    return c.json({ success: true, message: 'Income deleted successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error deleting income:', error);
    return c.json({ error: 'Failed to delete income' }, 500);
  }
});

export default incomeRoutes;

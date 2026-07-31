import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const subLedgerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createSubLedgerSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  type: z.enum(['consultant', 'vendor', 'customer', 'employee', 'other']),
  contact_info: z.string().max(500).optional(),
});

const updateSubLedgerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(20).optional(),
  type: z.enum(['consultant', 'vendor', 'customer', 'employee', 'other']).optional(),
  contact_info: z.string().max(500).optional(),
});

const subLedgerTypes = ['consultant', 'vendor', 'customer', 'employee', 'other'] as const;

// GET /api/sub-ledgers
subLedgerRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const type = c.req.query('type');
  const includeInactive = c.req.query('includeInactive') === 'true';

  let query = 'SELECT * FROM sub_ledgers WHERE tenant_id = ?';
  const params: any[] = [tenantId];

  if (!includeInactive) {
    query += ' AND is_active = 1';
  }
  if (type && subLedgerTypes.includes(type as any)) {
    query += ' AND type = ?';
    params.push(type);
  }

  query += ' ORDER BY code';

  const result = await db.$client.prepare(query).bind(...params).all();
  return c.json({ subLedgers: result.results });
});

// GET /api/sub-ledgers/:id
subLedgerRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const result = await db.$client.prepare(
    'SELECT * FROM sub_ledgers WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!result) {
    throw new HTTPException(404, { message: 'Sub-ledger not found' });
  }

  return c.json({ subLedger: result });
});

// GET /api/sub-ledgers/:id/ledger - Sub-ledger account statement
subLedgerRoutes.get('/:id/ledger', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const subLedger = await db.$client.prepare(
    'SELECT * FROM sub_ledgers WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!subLedger) {
    throw new HTTPException(404, { message: 'Sub-ledger not found' });
  }

  const dateConditions: string[] = [];
  const params: unknown[] = [tenantId, id];
  if (startDate) {
    dateConditions.push('AND COALESCE(j.entry_date, v.entry_date) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    dateConditions.push('AND COALESCE(j.entry_date, v.entry_date) <= ?');
    params.push(endDate);
  }

  const transactions = await db.$client.prepare(`
    SELECT
      slt.id,
      COALESCE(j.entry_date, v.entry_date) as entry_date,
      COALESCE(j.voucher_number, v.voucher_number) as voucher_number,
      COALESCE(j.description, v.description) as description,
      slt.dr_amount as debit,
      slt.cr_amount as credit,
      slt.sub_ledger_id
    FROM sub_ledger_transactions slt
    LEFT JOIN journal_entries j ON j.id = slt.journal_entry_id
    LEFT JOIN accounting_vouchers v ON v.id = slt.voucher_id
    WHERE slt.tenant_id = ? AND slt.sub_ledger_id = ?
      ${dateConditions.join(' ')}
    ORDER BY entry_date DESC, slt.id DESC
  `).bind(...params).all();

  let balance = 0;
  const withBalance = (transactions.results as any[]).map((t) => {
    balance += (t.debit || 0) - (t.credit || 0);
    return { ...t, balance };
  });

  const totals = (transactions.results as any[]).reduce(
    (acc, t) => ({
      totalDebit: acc.totalDebit + (t.debit || 0),
      totalCredit: acc.totalCredit + (t.credit || 0),
    }),
    { totalDebit: 0, totalCredit: 0 }
  );

  return c.json({
    subLedger,
    transactions: withBalance,
    summary: {
      totalDebit: totals.totalDebit,
      totalCredit: totals.totalCredit,
      currentBalance: balance,
    },
  });
});

// POST /api/sub-ledgers
subLedgerRoutes.post('/', zValidator('json', createSubLedgerSchema), async (c) => {
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
      'INSERT INTO sub_ledgers (tenant_id, name, code, type, contact_info) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      tenantId,
      data.name,
      data.code.toUpperCase(),
      data.type,
      data.contact_info || null
    ).run();

    return c.json({ id: result.meta.last_row_id, message: 'Sub-ledger created' }, 201);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      throw new HTTPException(400, { message: 'Sub-ledger code and type combination already exists' });
    }
    throw new HTTPException(500, { message: 'Failed to create sub-ledger' });
  }
});

// PUT /api/sub-ledgers/:id
subLedgerRoutes.put('/:id', zValidator('json', updateSubLedgerSchema), async (c) => {
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
    'SELECT * FROM sub_ledgers WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: 'Sub-ledger not found' });
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
  if (data.type !== undefined) {
    updates.push('type = ?');
    values.push(data.type);
  }
  if (data.contact_info !== undefined) {
    updates.push('contact_info = ?');
    values.push(data.contact_info);
  }

  if (updates.length === 0) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  values.push(id, tenantId);

  try {
    await db.$client.prepare(
      `UPDATE sub_ledgers SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();

    return c.json({ message: 'Sub-ledger updated' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      throw new HTTPException(400, { message: 'Sub-ledger code and type combination already exists' });
    }
    throw new HTTPException(500, { message: 'Failed to update sub-ledger' });
  }
});

// DELETE /api/sub-ledgers/:id (soft delete)
subLedgerRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireUserId(c);
  const role = c.get('role');
  const id = c.req.param('id');

  if (role !== 'director') {
    throw new HTTPException(403, { message: 'Unauthorized: director role required' });
  }

  const existing = await db.$client.prepare(
    'SELECT * FROM sub_ledgers WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: 'Sub-ledger not found or already inactive' });
  }

  await db.$client.prepare(
    'UPDATE sub_ledgers SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();

  return c.json({ message: 'Sub-ledger deactivated' });
});

export default subLedgerRoutes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createRecurringExpenseSchema, updateRecurringExpenseSchema } from '../../schemas/accounting';
import { getDb } from '../../db';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import { recordAndQueueDirectExpenseAccountingEvent } from '../../lib/direct-finance-accounting';
import type { Env, Variables } from '../../types';


const recurringRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

recurringRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { isActive } = c.req.query();

  let query = `
    SELECT r.*, ec.name as category_name, ec.code as category_code, u.name as created_by_name
    FROM recurring_expenses r
    LEFT JOIN expense_categories ec ON r.category_id = ec.id
    LEFT JOIN users u ON r.created_by = u.id
    WHERE r.tenant_id = ?
  `;
  const params: any[] = [tenantId];

  if (isActive !== undefined) {
    query += ' AND r.is_active = ?';
    params.push(isActive === 'true' ? 1 : 0);
  }

  query += ' ORDER BY r.next_run_date';

  try {
    const result = await db.$client.prepare(query).bind(...params).all();
    return c.json({ recurringExpenses: result.results });
  } catch (error) {
    console.error('Error fetching recurring expenses:', error);
    return c.json({ error: 'Failed to fetch recurring expenses' }, 500);
  }
});

recurringRoutes.post('/', zValidator('json', createRecurringExpenseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { category_id, amount, description, frequency, next_run_date, end_date } = c.req.valid('json');

  try {
    const category = await db.$client.prepare(`
      SELECT id, is_recurring_eligible FROM expense_categories WHERE id = ? AND tenant_id = ?
    `).bind(category_id, tenantId).first();

    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }

    if (!category.is_recurring_eligible) {
      return c.json({ error: 'This category is not eligible for recurring expenses' }, 400);
    }

    const result = await db.$client.prepare(`
      INSERT INTO recurring_expenses (category_id, amount, description, frequency, next_run_date, end_date, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(category_id, amount, description || null, frequency, next_run_date, end_date || null, tenantId, userId).run();

    const recurringId = result.meta.last_row_id;

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'recurring_expenses',
      recurringId,
      null,
      { category_id, amount, description, frequency, next_run_date, end_date }
    );

    return c.json({ success: true, id: recurringId, message: 'Recurring expense created successfully' }, 201);
  } catch (error) {
    console.error('Error creating recurring expense:', error);
    return c.json({ error: 'Failed to create recurring expense' }, 500);
  }
});

recurringRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const result = await db.$client.prepare(`
      SELECT r.*, ec.name as category_name, ec.code as category_code, u.name as created_by_name
      FROM recurring_expenses r
      LEFT JOIN expense_categories ec ON r.category_id = ec.id
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.id = ? AND r.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: 'Recurring expense not found' }, 404);
    }

    return c.json({ recurringExpense: result });
  } catch (error) {
    console.error('Error fetching recurring expense:', error);
    return c.json({ error: 'Failed to fetch recurring expense' }, 500);
  }
});

recurringRoutes.put('/:id', zValidator('json', updateRecurringExpenseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const { category_id, amount, description, frequency, next_run_date, end_date, is_active } = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(`
      SELECT * FROM recurring_expenses WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!existing) {
      return c.json({ error: 'Recurring expense not found' }, 404);
    }

    await db.$client.prepare(`
      UPDATE recurring_expenses 
      SET category_id = ?, amount = ?, description = ?, frequency = ?, next_run_date = ?, end_date = ?, is_active = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      category_id || (existing as any).category_id,
      amount || (existing as any).amount,
      description !== undefined ? description : (existing as any).description,
      frequency || (existing as any).frequency,
      next_run_date || (existing as any).next_run_date,
      end_date !== undefined ? end_date : (existing as any).end_date,
      is_active !== undefined ? is_active : (existing as any).is_active,
      id,
      tenantId
    ).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPDATE',
      'recurring_expenses',
      parseInt(id),
      existing,
      { category_id, amount, description, frequency, next_run_date, end_date, is_active }
    );

    return c.json({ success: true, message: 'Recurring expense updated successfully' });
  } catch (error) {
    console.error('Error updating recurring expense:', error);
    return c.json({ error: 'Failed to update recurring expense' }, 500);
  }
});

recurringRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(`
      SELECT * FROM recurring_expenses WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!existing) {
      return c.json({ error: 'Recurring expense not found' }, 404);
    }

    await db.$client.prepare(`
      UPDATE recurring_expenses SET is_active = 0 WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPDATE',
      'recurring_expenses',
      parseInt(id),
      existing,
      { is_active: 0 }
    );

    return c.json({ success: true, message: 'Recurring expense deactivated' });
  } catch (error) {
    console.error('Error deactivating recurring expense:', error);
    return c.json({ error: 'Failed to deactivate recurring expense' }, 500);
  }
});

recurringRoutes.post('/:id/run', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  try {
    const recurring = await db.$client.prepare(`
      SELECT r.*, ec.name as category_name
      FROM recurring_expenses r
      LEFT JOIN expense_categories ec ON ec.id = r.category_id AND ec.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ? AND r.is_active = 1
    `).bind(id, tenantId).first();

    if (!recurring) {
      return c.json({ error: 'Recurring expense not found or inactive' }, 404);
    }

    const today = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Recurring expense run');

    const expenseResult = await db.$client.prepare(`
      INSERT INTO expenses (date, category, amount, description, status, tenant_id, created_by, approved_by, approved_at)
      SELECT ?, ec.name, ?, ?, 'approved', ?, ?, ?, ?
      FROM expense_categories ec
      WHERE ec.id = ? AND ec.tenant_id = ?
    `).bind(
      today,
      (recurring as any).amount,
      (recurring as any).description || `Recurring expense - ${(recurring as any).id}`,
      tenantId,
      userId,
      userId,
      getFullTimestampGMT6(),
      (recurring as any).category_id,
      tenantId
    ).run();

    const expenseId = expenseResult.meta.last_row_id;
    if ((expenseResult.meta.changes ?? 0) < 1 || !expenseId) {
      throw new HTTPException(404, { message: 'Recurring expense category not found' });
    }

    await recordAndQueueDirectExpenseAccountingEvent(c, {
      tenantId,
      userId,
      expenseId,
      date: today,
      category: String((recurring as any).category_name || 'Recurring'),
      amount: Number((recurring as any).amount ?? 0),
      paymentMethod: 'cash',
      description: (recurring as any).description || `Recurring expense - ${(recurring as any).id}`,
    });

    let nextRunDate = new Date((recurring as any).next_run_date);
    if ((recurring as any).frequency === 'daily') {
      nextRunDate.setDate(nextRunDate.getDate() + 1);
    } else if ((recurring as any).frequency === 'weekly') {
      nextRunDate.setDate(nextRunDate.getDate() + 7);
    } else if ((recurring as any).frequency === 'monthly') {
      nextRunDate.setMonth(nextRunDate.getMonth() + 1);
    }

    await db.$client.prepare(`
      UPDATE recurring_expenses SET next_run_date = ? WHERE id = ? AND tenant_id = ?
    `).bind(nextRunDate.toISOString().split('T')[0], id, tenantId).run();


    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'expenses',
      expenseId,
      null,
      { source: 'recurring', recurring_id: id, amount: (recurring as any).amount }
    );

    return c.json({ 
      success: true, 
      expenseId,
      nextRunDate: nextRunDate.toISOString().split('T')[0],
      message: 'Recurring expense executed successfully' 
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error running recurring expense:', error);
    return c.json({ error: 'Failed to run recurring expense' }, 500);
  }
});

export default recurringRoutes;

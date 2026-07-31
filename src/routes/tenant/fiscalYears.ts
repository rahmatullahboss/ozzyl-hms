import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { createFiscalYearSchema, updateFiscalYearSchema, reopenFiscalYearSchema } from '../../schemas/fiscalYear';
import { buildCloseFiscalYearPeriodStatements, listFiscalYearPeriodNames } from '../../lib/accounting-periods';

const fiscalYearRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/fiscal-years
 * List all fiscal years for the current tenant (active and inactive).
 */
fiscalYearRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(
    `SELECT id, fiscal_year_name, start_date, end_date, prefix,
            insurance_prefix, pharmacy_prefix, is_active, is_closed, created_at, updated_at
     FROM fiscal_years WHERE tenant_id = ? ORDER BY start_date DESC`,
  ).bind(tenantId).all();

  return c.json({ fiscalYears: rows.results });
});

/**
 * GET /api/fiscal-years/active
 * Get the currently active fiscal year.
 */
fiscalYearRoutes.get('/active', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const row = await db.$client.prepare(
    `SELECT id, fiscal_year_name, start_date, end_date, prefix,
            insurance_prefix, pharmacy_prefix, is_active, is_closed, created_at
     FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1`,
  ).bind(tenantId).first();

  if (!row) {
    throw new HTTPException(404, { message: 'No active fiscal year found' });
  }

  return c.json({ fiscalYear: row });
});

/**
 * GET /api/fiscal-years/:id
 * Get a single fiscal year by ID.
 */
fiscalYearRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const row = await db.$client.prepare(
    `SELECT id, fiscal_year_name, start_date, end_date, prefix,
            insurance_prefix, pharmacy_prefix, is_active, is_closed, created_at, updated_at
     FROM fiscal_years WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).first();

  if (!row) {
    throw new HTTPException(404, { message: 'Fiscal year not found' });
  }

  return c.json({ fiscalYear: row });
});

/**
 * POST /api/fiscal-years
 * Create a new fiscal year for the tenant.
 */
fiscalYearRoutes.post(
  '/',
  zValidator('json', createFiscalYearSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json');

    // Validate date range
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (end <= start) {
      throw new HTTPException(400, { message: 'End date must be after start date' });
    }

    // Check for overlapping fiscal years (only open ones block new creation)
    const overlap = await db.$client.prepare(
      `SELECT id, fiscal_year_name FROM fiscal_years
       WHERE tenant_id = ? AND is_closed = 0
       AND ((start_date <= ? AND end_date >= ?) OR (start_date <= ? AND end_date >= ?))`,
    ).bind(tenantId, data.startDate, data.startDate, data.endDate, data.endDate).first();

    if (overlap) {
      throw new HTTPException(400, {
        message: `Fiscal year overlaps with existing: ${overlap.fiscal_year_name}`,
      });
    }

    const result = await db.$client
      .prepare(
        `INSERT INTO fiscal_years (tenant_id, fiscal_year_name, start_date, end_date, prefix, insurance_prefix, pharmacy_prefix, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        tenantId,
        data.fiscalYearName,
        data.startDate,
        data.endDate,
        data.prefix ?? 'FY',
        data.insurancePrefix ?? 'INS',
        data.pharmacyPrefix ?? 'PHR',
        userId,
      )
      .run();

    return c.json({ message: 'Fiscal year created', id: result.meta.last_row_id }, 201);
  },
);

/**
 * PUT /api/fiscal-years/:id
 * Update a fiscal year (name, dates, prefixes).
 */
fiscalYearRoutes.put(
  '/:id',
  zValidator('json', updateFiscalYearSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const id = c.req.param('id');
    const data = c.req.valid('json');

    const existing = await db.$client
      .prepare(`SELECT id, is_closed FROM fiscal_years WHERE id = ? AND tenant_id = ?`)
      .bind(id, tenantId).first();

    if (!existing) throw new HTTPException(404, { message: 'Fiscal year not found' });

    // Cannot update closed fiscal years
    if (existing.is_closed) {
      throw new HTTPException(400, { message: 'Cannot update a closed fiscal year' });
    }

    const updates: string[] = [];
    const binds: (string | number)[] = [];

    if (data.fiscalYearName !== undefined) {
      updates.push('fiscal_year_name = ?');
      binds.push(data.fiscalYearName);
    }
    if (data.startDate !== undefined) {
      updates.push('start_date = ?');
      binds.push(data.startDate);
    }
    if (data.endDate !== undefined) {
      updates.push('end_date = ?');
      binds.push(data.endDate);
    }
    if (data.prefix !== undefined) {
      updates.push('prefix = ?');
      binds.push(data.prefix);
    }
    if (data.insurancePrefix !== undefined) {
      updates.push('insurance_prefix = ?');
      binds.push(data.insurancePrefix);
    }
    if (data.pharmacyPrefix !== undefined) {
      updates.push('pharmacy_prefix = ?');
      binds.push(data.pharmacyPrefix);
    }

    if (updates.length === 0) {
      return c.json({ message: 'No changes to update' });
    }

    updates.push("updated_at = datetime('now', '+6 hours')");
    binds.push(id, tenantId);

    await db.$client
      .prepare(`UPDATE fiscal_years SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...binds)
      .run();

    return c.json({ message: 'Fiscal year updated' });
  },
);

/**
 * PUT /api/fiscal-years/:id/activate
 * Activate a fiscal year (deactivates all others for this tenant).
 */
fiscalYearRoutes.put('/:id/activate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const userId = requireUserId(c);

  const existing = await db.$client
    .prepare(`SELECT id, is_closed FROM fiscal_years WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Fiscal year not found' });
  if (existing.is_closed) {
    throw new HTTPException(400, { message: 'Cannot activate a closed fiscal year. Reopen it first.' });
  }

  // Deactivate all other fiscal years for this tenant
  await db.$client
    .prepare(`UPDATE fiscal_years SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE tenant_id = ? AND id != ?`)
    .bind(tenantId, id)
    .run();

  // Activate this one
  await db.$client
    .prepare(`UPDATE fiscal_years SET is_active = 1, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId)
    .run();

  return c.json({ message: 'Fiscal year activated' });
});

/**
 * PUT /api/fiscal-years/:id/close
 * Close a fiscal year (sets is_closed = 1, is_active = 0).
 */
fiscalYearRoutes.put('/:id/close', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  const existing = await db.$client
    .prepare(`SELECT id, fiscal_year_name, start_date, end_date, is_closed FROM fiscal_years WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId).first<{
      id: number;
      fiscal_year_name: string;
      start_date: string;
      end_date: string;
      is_closed: number | null;
    }>();

  if (!existing) throw new HTTPException(404, { message: 'Fiscal year not found' });

  const periods = listFiscalYearPeriodNames(existing.start_date, existing.end_date);
  const statements = [
    c.env.DB.prepare(
      `UPDATE fiscal_years SET is_closed = 1, is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
    )
      .bind(id, tenantId),
    ...buildCloseFiscalYearPeriodStatements(c.env.DB, {
      tenantId,
      fiscalYearId: existing.id,
      fiscalYearName: existing.fiscal_year_name,
      startDate: existing.start_date,
      endDate: existing.end_date,
      userId,
    }),
    c.env.DB.prepare(`
      INSERT INTO accounting_audit_logs
        (tenant_id, entity_type, entity_id, action, old_value, new_value, performed_by)
      VALUES (?, 'period', ?, 'close', ?, ?, ?)
    `).bind(
      tenantId,
      String(existing.id),
      JSON.stringify({ isClosed: !!existing.is_closed }),
      JSON.stringify({
        isClosed: true,
        fiscalYearName: existing.fiscal_year_name,
        startDate: existing.start_date,
        endDate: existing.end_date,
        periods,
      }),
      String(userId),
    ),
  ];

  await c.env.DB.batch(statements);

  return c.json({
    message: existing.is_closed ? 'Fiscal year period locks synchronized' : 'Fiscal year closed',
    periodsClosed: periods,
  });
});

/**
 * PUT /api/fiscal-years/:id/reopen
 * Reopen a closed fiscal year (requires remark).
 */
fiscalYearRoutes.put(
  '/:id/reopen',
  zValidator('json', reopenFiscalYearSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = c.req.param('id');
    const data = c.req.valid('json');

    const existing = await db.$client
      .prepare(`SELECT id, fiscal_year_name, start_date, end_date, is_closed FROM fiscal_years WHERE id = ? AND tenant_id = ?`)
      .bind(id, tenantId).first<{
        id: number;
        fiscal_year_name: string;
        start_date: string;
        end_date: string;
        is_closed: number | null;
      }>();

    if (!existing) throw new HTTPException(404, { message: 'Fiscal year not found' });
    if (!existing.is_closed) {
      throw new HTTPException(400, { message: 'Only closed fiscal years can be reopened' });
    }

    const audited = await db.$client.prepare(`
      SELECT period_name
      FROM accounting_period_closes
      WHERE tenant_id = ?
        AND fiscal_year_id = ?
        AND status = 'audited'
      ORDER BY period_name
      LIMIT 1
    `).bind(tenantId, existing.id).first<{ period_name: string }>();

    if (audited) {
      throw new HTTPException(409, {
        message: `Fiscal year contains audited accounting period ${audited.period_name}; audited periods cannot be reopened.`,
      });
    }

    const periods = listFiscalYearPeriodNames(existing.start_date, existing.end_date);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE fiscal_years
         SET is_closed = 0, is_active = 1, updated_at = datetime('now', '+6 hours')
         WHERE id = ? AND tenant_id = ?`,
      )
        .bind(id, tenantId),
      c.env.DB.prepare(`
        UPDATE accounting_period_closes
        SET status = 'open'
        WHERE tenant_id = ?
          AND fiscal_year_id = ?
          AND status = 'closed'
      `).bind(tenantId, existing.id),
      c.env.DB.prepare(`
        INSERT INTO accounting_audit_logs
          (tenant_id, entity_type, entity_id, action, old_value, new_value, performed_by)
        VALUES (?, 'period', ?, 'update', ?, ?, ?)
      `).bind(
        tenantId,
        String(existing.id),
        JSON.stringify({ isClosed: true, status: 'closed' }),
        JSON.stringify({
          isClosed: false,
          status: 'open',
          fiscalYearName: existing.fiscal_year_name,
          remark: data.remark,
          periods,
        }),
        String(userId),
      ),
    ]);

    return c.json({ message: 'Fiscal year reopened', periodsReopened: periods });
  },
);

/**
 * GET /api/fiscal-years/:id/validate-date/:date
 * Validate whether a given date falls within the fiscal year.
 */
fiscalYearRoutes.get('/:id/validate-date/:date', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const date = c.req.param('date');

  const fy = await db.$client
    .prepare(`SELECT id, fiscal_year_name, start_date, end_date, is_closed FROM fiscal_years WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId).first<{
      id: number;
      fiscal_year_name: string;
      start_date: string;
      end_date: string;
      is_closed: number;
    }>();

  if (!fy) throw new HTTPException(404, { message: 'Fiscal year not found' });

  const dateObj = new Date(date);
  const start = new Date(fy.start_date);
  const end = new Date(fy.end_date);

  const isValid = dateObj >= start && dateObj <= end;
  const isClosed = !!fy.is_closed;

  return c.json({
    valid: isValid && !isClosed,
    fiscalYearId: fy.id,
    fiscalYearName: fy.fiscal_year_name,
    startDate: fy.start_date,
    endDate: fy.end_date,
    isClosed,
    dateChecked: date,
    message: isClosed
      ? 'Fiscal year is closed'
      : !isValid
      ? `Date must be between ${fy.start_date} and ${fy.end_date}`
      : 'Date is valid',
  });
});

export default fiscalYearRoutes;

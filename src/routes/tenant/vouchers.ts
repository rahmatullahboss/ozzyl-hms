import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId, requireSpecificRole } from '../../lib/context-helpers';
import { getDb } from '../../db';

const voucherRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createVoucherTypeSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(100),
  allowVerification: z.boolean().default(true),
});

async function generateVoucherNumber(
  db: D1Database,
  tenantId: string,
  voucherTypeCode: string,
  fiscalYearId: number
): Promise<string> {
  const vt = await db.prepare(
    'SELECT id FROM voucher_types WHERE tenant_id = ? AND code = ?'
  ).bind(tenantId, voucherTypeCode).first<{ id: number }>();

  if (!vt) {
    throw new Error('Voucher type not found');
  }

  const fy = await db.prepare(
    'SELECT fiscal_year_name FROM fiscal_years WHERE id = ? AND tenant_id = ?'
  ).bind(fiscalYearId, tenantId).first<{ fiscal_year_name: string }>();

  const fyName = fy?.fiscal_year_name || 'FY';

  let numbering = await db.prepare(
    'SELECT last_number FROM voucher_numbering WHERE tenant_id = ? AND voucher_type_id = ? AND fiscal_year_id = ?'
  ).bind(tenantId, vt.id, fiscalYearId).first<{ last_number: number }>();

  if (!numbering) {
    await db.prepare(
      'INSERT INTO voucher_numbering (tenant_id, voucher_type_id, fiscal_year_id, last_number) VALUES (?, ?, ?, 0)'
    ).bind(tenantId, vt.id, fiscalYearId).run();
    numbering = { last_number: 0 };
  }

  const nextNumber = numbering.last_number + 1;
  await db.prepare(
    'UPDATE voucher_numbering SET last_number = ? WHERE tenant_id = ? AND voucher_type_id = ? AND fiscal_year_id = ?'
  ).bind(nextNumber, tenantId, vt.id, fiscalYearId).run();

  return `${voucherTypeCode}-${fyName}-${String(nextNumber).padStart(3, '0')}`;
}

async function previewVoucherNumber(
  db: D1Database,
  tenantId: string,
  voucherTypeCode: string,
  fiscalYearId: number,
): Promise<string> {
  const vt = await db.prepare(
    'SELECT id FROM voucher_types WHERE tenant_id = ? AND code = ?'
  ).bind(tenantId, voucherTypeCode).first<{ id: number }>();

  if (!vt) {
    throw new Error('Voucher type not found');
  }

  const fy = await db.prepare(
    'SELECT fiscal_year_name FROM fiscal_years WHERE id = ? AND tenant_id = ?'
  ).bind(fiscalYearId, tenantId).first<{ fiscal_year_name: string }>();

  const fyName = fy?.fiscal_year_name || 'FY';
  const numbering = await db.prepare(
    'SELECT last_number FROM voucher_numbering WHERE tenant_id = ? AND voucher_type_id = ? AND fiscal_year_id = ?'
  ).bind(tenantId, vt.id, fiscalYearId).first<{ last_number: number }>();
  const nextNumber = Number(numbering?.last_number || 0) + 1;

  return `${voucherTypeCode}-${fyName}-${String(nextNumber).padStart(3, '0')}`;
}

voucherRoutes.get('/types', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const rows = await db.$client.prepare(
      `SELECT id, code, name, is_active, allow_verification, created_at
       FROM voucher_types WHERE tenant_id = ? ORDER BY code`
    ).bind(tenantId).all();

    return c.json({ voucherTypes: rows.results });
  } catch (error) {
    console.error('Error fetching voucher types:', error);
    return c.json({ error: 'Failed to fetch voucher types' }, 500);
  }
});

voucherRoutes.post('/types', zValidator('json', createVoucherTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireSpecificRole(c, 'director');

  const { code, name, allowVerification } = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      'SELECT id FROM voucher_types WHERE tenant_id = ? AND code = ?'
    ).bind(tenantId, code).first();

    if (existing) {
      return c.json({ error: 'Voucher type with this code already exists' }, 400);
    }

    const result = await db.$client.prepare(
      `INSERT INTO voucher_types (tenant_id, code, name, allow_verification)
       VALUES (?, ?, ?, ?)`
    ).bind(tenantId, code.toUpperCase(), name, allowVerification ? 1 : 0).run();

    return c.json({
      id: result.meta.last_row_id,
      message: 'Voucher type created successfully'
    }, 201);
  } catch (error) {
    console.error('Error creating voucher type:', error);
    return c.json({ error: 'Failed to create voucher type' }, 500);
  }
});

voucherRoutes.get('/next-number', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const voucherTypeCode = c.req.query('voucherTypeCode');
  const fiscalYearIdStr = c.req.query('fiscalYearId');

  if (!voucherTypeCode || !fiscalYearIdStr) {
    return c.json({ error: 'voucherTypeCode and fiscalYearId are required' }, 400);
  }

  const fiscalYearId = parseInt(fiscalYearIdStr, 10);
  if (isNaN(fiscalYearId) || fiscalYearId <= 0) {
    return c.json({ error: 'Invalid fiscalYearId' }, 400);
  }

  try {
    const voucherNumber = await previewVoucherNumber(db.$client, tenantId, voucherTypeCode.toUpperCase(), fiscalYearId);
    return c.json({ voucherNumber });
  } catch (error) {
    console.error('Error generating voucher number:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate voucher number';
    return c.json({ error: message }, 500);
  }
});

export { generateVoucherNumber, previewVoucherNumber };
export default voucherRoutes;

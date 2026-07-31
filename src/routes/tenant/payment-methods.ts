import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import receptionDoctorPayoutRoutes from './receptionDoctorPayouts';
import receptionDrawerCustodyRoutes from './receptionDrawerCustody';

const paymentMethods = new Hono<{ Bindings: Env; Variables: Variables }>();

paymentMethods.route('/doctor-payouts', receptionDoctorPayoutRoutes);
paymentMethods.route('/drawer-custody', receptionDrawerCustodyRoutes);

// GET / — list all payment methods
paymentMethods.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    `SELECT id, name, code, active, transaction_id_required, charge_applicable
     FROM payment_methods
     WHERE tenant_id = ?
     ORDER BY name`
  ).bind(tenantId).all();

  const methods = (results || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    active: r.active === 1,
    transaction_id_required: r.transaction_id_required === 1,
    charge_applicable: r.charge_applicable === 1,
  }));

  return c.json({ methods });
});

// POST / — create payment method
paymentMethods.post('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{
    name: string;
    code: string;
    active?: boolean;
    transaction_id_required?: boolean;
    charge_applicable?: boolean;
  }>();

  if (!body.name || !body.code) {
    throw new HTTPException(400, { message: 'Name and code are required' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM payment_methods WHERE code = ? AND tenant_id = ?`
  ).bind(body.code, tenantId).first();

  if (existing) {
    throw new HTTPException(409, { message: 'Payment method code already exists' });
  }

  const result = await db.$client.prepare(
    `INSERT INTO payment_methods (name, code, active, transaction_id_required, charge_applicable, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.name,
    body.code,
    body.active !== false ? 1 : 0,
    body.transaction_id_required ? 1 : 0,
    body.charge_applicable ? 1 : 0,
    tenantId
  ).run();

  return c.json({
    message: 'Payment method created',
    id: result.meta.last_row_id,
  }, 201);
});

// PUT / — update payment method
paymentMethods.put('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{
    id: number;
    name?: string;
    code?: string;
    active?: boolean;
    transaction_id_required?: boolean;
    charge_applicable?: boolean;
  }>();

  if (!body.id) {
    throw new HTTPException(400, { message: 'Payment method ID is required' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM payment_methods WHERE id = ? AND tenant_id = ?`
  ).bind(body.id, tenantId).first();

  if (!existing) {
    throw new HTTPException(404, { message: 'Payment method not found' });
  }

  if (body.code) {
    const duplicate = await db.$client.prepare(
      `SELECT id FROM payment_methods WHERE code = ? AND tenant_id = ? AND id != ?`
    ).bind(body.code, tenantId, body.id).first();

    if (duplicate) {
      throw new HTTPException(409, { message: 'Payment method code already exists' });
    }
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
  if (body.code !== undefined) { updates.push('code = ?'); params.push(body.code); }
  if (body.active !== undefined) { updates.push('active = ?'); params.push(body.active ? 1 : 0); }
  if (body.transaction_id_required !== undefined) { updates.push('transaction_id_required = ?'); params.push(body.transaction_id_required ? 1 : 0); }
  if (body.charge_applicable !== undefined) { updates.push('charge_applicable = ?'); params.push(body.charge_applicable ? 1 : 0); }

  if (updates.length === 0) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  updates.push("updated_at = datetime('now', '+6 hours')");
  params.push(body.id, tenantId);

  await db.$client.prepare(
    `UPDATE payment_methods SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();

  return c.json({ message: 'Payment method updated' });
});

// PUT /status — toggle payment method status
paymentMethods.put('/status', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json<{ id: number; active: boolean }>();

  if (!body.id || body.active === undefined) {
    throw new HTTPException(400, { message: 'ID and active status are required' });
  }

  const result = await db.$client.prepare(
    `UPDATE payment_methods
     SET active = ?, updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`
  ).bind(body.active ? 1 : 0, body.id, tenantId).run();

  if (result.meta.changes === 0) {
    throw new HTTPException(404, { message: 'Payment method not found' });
  }

  return c.json({ message: 'Payment method status updated' });
});

export default paymentMethods;

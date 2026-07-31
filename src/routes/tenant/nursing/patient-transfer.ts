import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createTransferSchema, receiveTransferSchema, transferQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const patientTransferRoutes = new Hono<NursingEnv>();

// GET / — list transfers with patient info, filters: visit_id, to_ward_id, status
patientTransferRoutes.get('/', zValidator('query', transferQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, visit_id, to_ward_id, status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT t.*, p.name AS patient_name, p.patient_code
    FROM nur_patient_transfers t
    JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
    WHERE t.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (visit_id) {
    query += ' AND t.visit_id = ?';
    params.push(visit_id);
  }
  if (to_ward_id) {
    query += ' AND t.to_ward_id = ?';
    params.push(to_ward_id);
  }
  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }

  query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = `
    SELECT COUNT(*) as total FROM nur_patient_transfers t WHERE t.tenant_id = ?
  `;
  const countParams: (string | number)[] = [tenantId];

  if (visit_id) {
    countQuery += ' AND t.visit_id = ?';
    countParams.push(visit_id);
  }
  if (to_ward_id) {
    countQuery += ' AND t.to_ward_id = ?';
    countParams.push(to_ward_id);
  }
  if (status) {
    countQuery += ' AND t.status = ?';
    countParams.push(status);
  }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// GET /pending — pending transfers for a ward
patientTransferRoutes.get('/pending', zValidator('query', transferQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { to_ward_id } = c.req.valid('query');

  let query = `
    SELECT t.*, p.name AS patient_name, p.patient_code
    FROM nur_patient_transfers t
    JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
    WHERE t.tenant_id = ? AND t.status = 'pending'
  `;
  const params: (string | number)[] = [tenantId];

  if (to_ward_id) {
    query += ' AND t.to_ward_id = ?';
    params.push(to_ward_id);
  }

  query += ' ORDER BY t.created_at DESC';
  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST / — initiate transfer
patientTransferRoutes.post('/', zValidator('json', createTransferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_patient_transfers (
      tenant_id, patient_id, visit_id, from_ward_id, from_bed_id,
      to_ward_id, to_bed_id, transfer_reason, transferred_by, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    data.patient_id,
    data.visit_id,
    data.from_ward_id,
    data.from_bed_id ?? null,
    data.to_ward_id,
    data.to_bed_id ?? null,
    data.transfer_reason ?? null,
    userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /:id/receive — receive transferred patient
patientTransferRoutes.put('/:id/receive', zValidator('json', receiveTransferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid transfer ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_patient_transfers WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Transfer not found' });
  if (existing.status !== 'pending') {
    throw new HTTPException(400, { message: 'Only pending transfers can be received' });
  }

  const data = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE nur_patient_transfers
    SET status = 'received', received_by = ?, received_on = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.received_by, id, tenantId).run();

  return c.json({ Results: true });
});

// PUT /:id/cancel — cancel transfer
patientTransferRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid transfer ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_patient_transfers WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Transfer not found' });
  if (existing.status !== 'pending') {
    throw new HTTPException(400, { message: 'Only pending transfers can be cancelled' });
  }

  await db.$client.prepare(`
    UPDATE nur_patient_transfers
    SET status = 'cancelled'
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ Results: true });
});

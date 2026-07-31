import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createDrugRequisitionSchema, drugRequisitionQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const drugRequisitionRoutes = new Hono<NursingEnv>();

// ─── GET / — list requisitions ─────────────────────────────────────────────
drugRequisitionRoutes.get('/', zValidator('query', drugRequisitionQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, ward_id, visit_id, status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT r.*, p.name AS patient_name, p.patient_code
    FROM nur_drug_requisitions r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (ward_id) { query += ' AND r.ward_id = ?'; params.push(ward_id); }
  if (visit_id) { query += ' AND r.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND r.status = ?'; params.push(status); }

  query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = `
    SELECT COUNT(*) as total
    FROM nur_drug_requisitions r
    WHERE r.tenant_id = ? AND r.is_active = 1
  `;
  const countParams: (string | number)[] = [tenantId];
  if (ward_id) { countQuery += ' AND r.ward_id = ?'; countParams.push(ward_id); }
  if (visit_id) { countQuery += ' AND r.visit_id = ?'; countParams.push(visit_id); }
  if (status) { countQuery += ' AND r.status = ?'; countParams.push(status); }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: countResult?.total || 0 } });
});

// ─── GET /:id — single requisition with items ─────────────────────────────
drugRequisitionRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const req = await db.$client.prepare(`
    SELECT r.*, p.name AS patient_name, p.patient_code
    FROM nur_drug_requisitions r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ? AND r.is_active = 1
  `).bind(id, tenantId).first();

  if (!req) throw new HTTPException(404, { message: 'Requisition not found' });

  const { results: items } = await db.$client.prepare(`
    SELECT * FROM nur_drug_requisition_items
    WHERE requisition_id = ? AND tenant_id = ? AND is_active = 1
  `).bind(id, tenantId).all();

  return c.json({ Results: { ...req, items } });
});

// ─── POST / — create requisition with items ────────────────────────────────
drugRequisitionRoutes.post('/', zValidator('json', createDrugRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_drug_requisitions
      (tenant_id, patient_id, visit_id, ward_id, remarks, requested_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.patient_id ?? null,
    data.visit_id ?? null,
    data.ward_id ?? null,
    data.remarks ?? null,
    userId
  ).run();

  const requisitionId = result.meta.last_row_id;

  for (const item of data.items) {
    await db.$client.prepare(`
      INSERT INTO nur_drug_requisition_items
        (tenant_id, requisition_id, drug_name, generic_name, quantity, unit, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      requisitionId,
      item.drug_name,
      item.generic_name ?? null,
      item.quantity,
      item.unit,
      item.remarks ?? null
    ).run();
  }

  return c.json({ Results: { id: requisitionId } }, 201);
});

// ─── PUT /:id/dispense — mark as dispensed ────────────────────────────────
drugRequisitionRoutes.put('/:id/dispense', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_drug_requisitions WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });
  if (existing.status !== 'pending') {
    throw new HTTPException(400, { message: 'Only pending requisitions can be dispensed' });
  }

  await db.$client.prepare(`
    UPDATE nur_drug_requisitions
    SET status = 'dispensed', dispensed_by = ?, dispensed_on = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, id, tenantId).run();

  return c.json({ Results: { id, status: 'dispensed' } });
});

// ─── PUT /:id/cancel — cancel requisition ─────────────────────────────────
drugRequisitionRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id FROM nur_drug_requisitions WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });

  await db.$client.prepare(`
    UPDATE nur_drug_requisitions
    SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ Results: { id, status: 'cancelled' } });
});

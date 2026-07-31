import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createConsultationRequestSchema,
  respondConsultationSchema,
  consultationQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const consultationRequestRoutes = new Hono<NursingEnv>();

// ─── GET / — list consultation requests with doctor name JOINs ─────────────
consultationRequestRoutes.get('/', zValidator('query', consultationQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id, consulting_doctor_id, status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT
      cr.*,
      rd.name AS requesting_doctor_name,
      cd.name AS consulting_doctor_name
    FROM nur_consultation_requests cr
    LEFT JOIN doctors rd ON rd.id = cr.requesting_doctor_id
    LEFT JOIN doctors cd ON cd.id = cr.consulting_doctor_id
    WHERE cr.tenant_id = ? AND cr.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND cr.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND cr.visit_id = ?'; params.push(visit_id); }
  if (consulting_doctor_id) { query += ' AND cr.consulting_doctor_id = ?'; params.push(consulting_doctor_id); }
  if (status) { query += ' AND cr.status = ?'; params.push(status); }

  query += ' ORDER BY cr.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_consultation_requests WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  if (consulting_doctor_id) { countQuery += ' AND consulting_doctor_id = ?'; countParams.push(consulting_doctor_id); }
  if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: countResult?.total || 0 } });
});

// ─── GET /:id — single consultation request with doctor names ──────────────
consultationRequestRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT
      cr.*,
      rd.name AS requesting_doctor_name,
      cd.name AS consulting_doctor_name
    FROM nur_consultation_requests cr
    LEFT JOIN doctors rd ON rd.id = cr.requesting_doctor_id
    LEFT JOIN doctors cd ON cd.id = cr.consulting_doctor_id
    WHERE cr.id = ? AND cr.tenant_id = ? AND cr.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Consultation request not found' });
  return c.json({ Results: result });
});

// ─── POST / — create consultation request ───────────────────────────────────
consultationRequestRoutes.post('/', zValidator('json', createConsultationRequestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_consultation_requests
      (tenant_id, patient_id, visit_id, ward_id, bed_id,
       requesting_doctor_id, requesting_department_id,
       purpose, consulting_doctor_id, consulting_department_id,
       status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.ward_id ?? null, data.bed_id ?? null,
    data.requesting_doctor_id, data.requesting_department_id ?? null,
    data.purpose, data.consulting_doctor_id, data.consulting_department_id ?? null,
    userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── PUT /:id/respond — respond to consultation request ────────────────────
consultationRequestRoutes.put('/:id/respond', zValidator('json', respondConsultationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id, status FROM nur_consultation_requests WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Consultation request not found' });

  if (existing.status === 'responded' || existing.status === 'cancelled') {
    throw new HTTPException(400, { message: `Cannot respond to a consultation request with status '${existing.status}'` });
  }

  const data = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE nur_consultation_requests
    SET consultant_response = ?, consulted_on = datetime('now', '+6 hours'),
        status = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.consultant_response, data.status, id, tenantId).run();

  return c.json({ Results: { id, status: data.status } });
});

// ─── PUT /:id/cancel — cancel consultation request ─────────────────────────
consultationRequestRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id, status FROM nur_consultation_requests WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first<{ id: number; status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Consultation request not found' });

  if (existing.status === 'responded') {
    throw new HTTPException(400, { message: 'Cannot cancel a consultation request that has already been responded to' });
  }

  await db.$client.prepare(`
    UPDATE nur_consultation_requests
    SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ Results: { id, status: 'cancelled' } });
});

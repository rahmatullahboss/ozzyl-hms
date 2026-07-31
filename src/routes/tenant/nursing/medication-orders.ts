import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createMedicationOrderSchema,
  updateOrderStatusSchema,
  medicationOrderQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';
import { clnMedicationOrders } from '../../../db/schema/clinicalMar';
import { createAuditLog } from '../../../lib/accounting-helpers';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const medicationOrderRoutes = new Hono<NursingEnv>();

const orderDecisionReasonSchema = z.object({
  status_reason: z.string().trim().min(3).max(500),
});

type MedicationOrderInput = z.infer<typeof createMedicationOrderSchema>;

type ExistingMedicationOrder = {
  id: number;
  patient_id: number;
  visit_id: number;
  formulary_item_id: number | null;
  medication_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  dose: string;
  route: string;
  frequency: string;
  duration: string | null;
  instructions: string | null;
  priority: string;
  start_datetime: string;
  end_datetime: string | null;
  status: string;
  idempotency_key: string | null;
};

function createOrderIdempotencyKey(): string {
  const runtimeCrypto = (globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  }).crypto;
  const suffix = runtimeCrypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `doctor-order:${suffix}`;
}

function normalizedOptional(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isExactOrderReplay(existing: ExistingMedicationOrder, data: MedicationOrderInput, startDt: string): boolean {
  return existing.patient_id === data.patient_id
    && existing.visit_id === data.visit_id
    && (existing.formulary_item_id ?? null) === (data.formulary_item_id ?? null)
    && existing.medication_name === data.medication_name
    && (existing.generic_name ?? null) === normalizedOptional(data.generic_name)
    && (existing.strength ?? null) === normalizedOptional(data.strength)
    && (existing.dosage_form ?? null) === normalizedOptional(data.dosage_form)
    && existing.dose === data.dose
    && existing.route === data.route
    && existing.frequency === data.frequency
    && (existing.duration ?? null) === normalizedOptional(data.duration)
    && (existing.instructions ?? null) === normalizedOptional(data.instructions)
    && existing.priority === data.priority
    && existing.start_datetime === startDt
    && (existing.end_datetime ?? null) === (data.end_datetime ?? null);
}

// ─── GET /medication-orders — list orders with formulary JOIN ────────────────
medicationOrderRoutes.get('/', zValidator('query', medicationOrderQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id, status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT
      o.*,
      f.name AS formulary_name,
      f.generic_name AS formulary_generic_name,
      f.strength AS formulary_strength,
      f.dosage_form AS formulary_dosage_form,
      f.is_antibiotic,
      f.is_controlled
    FROM cln_medication_orders o
    LEFT JOIN formulary_items f ON f.id = o.formulary_item_id
    WHERE o.tenant_id = ? AND o.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND o.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND o.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND o.status = ?'; params.push(status); }

  query += ` ORDER BY CASE o.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 WHEN 'routine' THEN 2 WHEN 'prn' THEN 3 END ASC, o.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Count
  let countQuery = 'SELECT COUNT(*) as total FROM cln_medication_orders WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: countResult?.total || 0 } });
});

// ─── GET /medication-orders/:id — single order with administration history ──
medicationOrderRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const order = await db.$client.prepare(`
    SELECT
      o.*,
      f.name AS formulary_name,
      f.generic_name,
      f.strength,
      f.dosage_form,
      f.common_dosages,
      f.max_daily_dose_mg,
      f.is_antibiotic,
      f.is_controlled
    FROM cln_medication_orders o
    LEFT JOIN formulary_items f ON f.id = o.formulary_item_id
    WHERE o.id = ? AND o.tenant_id = ? AND o.is_active = 1
  `).bind(id, tenantId).first();

  if (!order) throw new HTTPException(404, { message: 'Order not found' });

  // Get administration history for this order
  const administrations = await db.$client.prepare(`
    SELECT * FROM nur_medication_admin
    WHERE order_id = ? AND tenant_id = ? AND is_active = 1
    ORDER BY COALESCE(actual_time, scheduled_time) DESC
  `).bind(id, tenantId).all();

  return c.json({ Results: { ...order, administrations: administrations.results } });
});

// ─── POST /medication-orders — create a new medication order ────────────────
medicationOrderRoutes.post('/', zValidator('json', createMedicationOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const startDt = data.start_datetime ?? new Date().toISOString();
  const idempotencyKey = data.idempotency_key ?? createOrderIdempotencyKey();

  const visit = await db.$client.prepare(`
    SELECT v.id, v.patient_id, a.id AS admission_id
    FROM visits v
    JOIN admissions a
      ON a.tenant_id = v.tenant_id
     AND a.patient_id = v.patient_id
     AND a.status IN ('admitted', 'critical')
     AND (
       (v.admission_no IS NOT NULL AND v.admission_no = a.admission_no)
       OR (
         COALESCE(v.admission_flag, 0) = 1
         AND COALESCE(v.created_at, v.visit_date) >= a.admission_date
       )
     )
    WHERE v.id = ? AND v.tenant_id = ? AND v.patient_id = ?
    LIMIT 1
  `).bind(data.visit_id, tenantId, data.patient_id).first<{
    id: number;
    patient_id: number;
    admission_id: number;
  }>();
  if (!visit) {
    throw new HTTPException(409, { message: 'An active IPD visit is required for this medication order' });
  }

  if (data.formulary_item_id != null) {
    const formulary = await db.$client.prepare(`
      SELECT id
      FROM formulary_items
      WHERE id = ? AND tenant_id = ? AND is_active = 1
      LIMIT 1
    `).bind(data.formulary_item_id, tenantId).first<{ id: number }>();
    if (!formulary) {
      throw new HTTPException(409, { message: 'Active formulary item not found for this tenant' });
    }
  }

  const findByIdempotency = () => db.$client.prepare(`
    SELECT id, patient_id, visit_id, formulary_item_id, medication_name, generic_name,
           strength, dosage_form, dose, route, frequency, duration, instructions,
           priority, start_datetime, end_datetime, status, idempotency_key
    FROM cln_medication_orders
    WHERE tenant_id = ? AND idempotency_key = ? AND is_active = 1
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<ExistingMedicationOrder>();

  const existing = await findByIdempotency();
  if (existing) {
    const replayStartDt = data.start_datetime ?? existing.start_datetime;
    if (!isExactOrderReplay(existing, data, replayStartDt)) {
      throw new HTTPException(409, { message: 'Idempotency key was already used for a different medication order' });
    }
    return c.json({ Results: { id: existing.id, status: existing.status, replayed: true } });
  }

  const orderStmt = db.$client.prepare(`
    INSERT OR IGNORE INTO cln_medication_orders
      (tenant_id, patient_id, visit_id, formulary_item_id, medication_name, generic_name,
       strength, dosage_form, dose, route, frequency, duration, instructions,
       priority, start_datetime, end_datetime, status, idempotency_key, ordered_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.formulary_item_id ?? null,
    data.medication_name, normalizedOptional(data.generic_name),
    normalizedOptional(data.strength), normalizedOptional(data.dosage_form),
    data.dose, data.route, data.frequency,
    normalizedOptional(data.duration), normalizedOptional(data.instructions),
    data.priority, startDt, data.end_datetime ?? null,
    idempotencyKey, userId, userId,
  );

  const marStmt = db.$client.prepare(`
    INSERT INTO nur_medication_admin
      (tenant_id, patient_id, visit_id, medication_name, dose, route, frequency,
       order_id, formulary_item_id, generic_name, strength, scheduled_time, created_by)
    SELECT o.tenant_id, o.patient_id, o.visit_id, o.medication_name, o.dose, o.route, o.frequency,
           o.id, o.formulary_item_id, o.generic_name, o.strength, o.start_datetime, o.created_by
    FROM cln_medication_orders o
    WHERE o.tenant_id = ? AND o.idempotency_key = ? AND o.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM nur_medication_admin mar
        WHERE mar.tenant_id = o.tenant_id
          AND mar.order_id = o.id
          AND mar.scheduled_time = o.start_datetime
          AND mar.is_active = 1
      )
  `).bind(tenantId, idempotencyKey);

  try {
    await db.$client.batch([orderStmt, marStmt]);
  } catch (error) {
    console.error('Atomic medication order and MAR creation failed', error);
    throw new HTTPException(500, { message: 'Failed to create medication order and MAR schedule' });
  }

  const created = await findByIdempotency();
  if (!created) {
    throw new HTTPException(500, { message: 'Medication order creation could not be confirmed' });
  }
  const confirmedStartDt = data.start_datetime ?? created.start_datetime;
  if (!isExactOrderReplay(created, data, confirmedStartDt)) {
    throw new HTTPException(409, { message: 'Idempotency key was concurrently used for a different medication order' });
  }

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'cln_medication_orders', created.id, null, {
    patientId: data.patient_id,
    visitId: data.visit_id,
    admissionId: Number(visit.admission_id),
    priority: data.priority,
    hasFormularyLink: data.formulary_item_id != null,
    marScheduleCreated: true,
  });

  return c.json({ Results: { id: created.id, status: created.status, replayed: false } }, 201);
});

// ─── PUT /medication-orders/:id/status — update order status ────────────────
medicationOrderRoutes.put('/:id/status', zValidator('json', updateOrderStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.select({
    id: clnMedicationOrders.id,
    status: clnMedicationOrders.status,
    patientId: clnMedicationOrders.patientId,
    visitId: clnMedicationOrders.visitId,
  })
    .from(clnMedicationOrders)
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId),
        eq(clnMedicationOrders.isActive, 1)
      )
    )
    .limit(1);

  if (existing.length === 0) throw new HTTPException(404, { message: 'Order not found' });

  const data = c.req.valid('json');
  const currentStatus = existing[0].status;
  const allowedTransitions: Record<string, string[]> = {
    active: ['on_hold', 'completed', 'discontinued', 'cancelled'],
    on_hold: ['active', 'discontinued', 'cancelled'],
    completed: [],
    discontinued: [],
    cancelled: [],
  };
  if (data.status !== currentStatus && !(allowedTransitions[currentStatus] ?? []).includes(data.status)) {
    throw new HTTPException(409, {
      message: `Medication order cannot transition from '${currentStatus}' to '${data.status}'`,
    });
  }

  await db.update(clnMedicationOrders)
    .set({
      status: data.status,
      statusReason: data.status_reason ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: parseInt(userId) || null,
    })
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId)
      )
    );

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'cln_medication_orders', id, {
    status: existing[0].status,
  }, {
    status: data.status,
    patientId: existing[0].patientId,
    visitId: existing[0].visitId,
    hasStatusReason: Boolean(data.status_reason?.trim()),
  });

  return c.json({ Results: { id, status: data.status } });
});

// ─── PUT /medication-orders/:id/discontinue — discontinue order ─────────────
medicationOrderRoutes.put('/:id/discontinue', zValidator('json', orderDecisionReasonSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.select({
    id: clnMedicationOrders.id,
    status: clnMedicationOrders.status,
    patientId: clnMedicationOrders.patientId,
    visitId: clnMedicationOrders.visitId,
  })
    .from(clnMedicationOrders)
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId),
        eq(clnMedicationOrders.isActive, 1)
      )
    )
    .limit(1);

  if (existing.length === 0) throw new HTTPException(404, { message: 'Order not found' });
  if (existing[0].status === 'discontinued') {
    throw new HTTPException(400, { message: 'Order is already discontinued' });
  }

  const data = c.req.valid('json');

  await db.update(clnMedicationOrders)
    .set({
      status: 'discontinued',
      statusReason: data.status_reason,
      endDatetime: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: parseInt(userId) || null,
    })
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId)
      )
    );

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'cln_medication_orders', id, {
    status: existing[0].status,
  }, {
    status: 'discontinued',
    patientId: existing[0].patientId,
    visitId: existing[0].visitId,
    hasStatusReason: true,
  });

  return c.json({ Results: { id, status: 'discontinued' } });
});

// ─── PUT /medication-orders/:id/hold — hold/resume an order ─────────────────
medicationOrderRoutes.put('/:id/hold', zValidator('json', orderDecisionReasonSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.select({
    id: clnMedicationOrders.id,
    status: clnMedicationOrders.status,
    patientId: clnMedicationOrders.patientId,
    visitId: clnMedicationOrders.visitId,
  })
    .from(clnMedicationOrders)
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId),
        eq(clnMedicationOrders.isActive, 1)
      )
    )
    .limit(1);

  if (existing.length === 0) throw new HTTPException(404, { message: 'Order not found' });

  // Only allow toggle between active ↔ on_hold
  const currentStatus = existing[0].status;
  if (currentStatus !== 'active' && currentStatus !== 'on_hold') {
    throw new HTTPException(400, {
      message: `Cannot hold/resume order with status '${currentStatus}'. Only active or on_hold orders can be toggled.`,
    });
  }
  const data = c.req.valid('json');
  const newStatus = currentStatus === 'on_hold' ? 'active' : 'on_hold';

  await db.update(clnMedicationOrders)
    .set({
      status: newStatus,
      statusReason: data.status_reason,
      updatedAt: new Date().toISOString(),
      updatedBy: parseInt(userId) || null,
    })
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId)
      )
    );

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'cln_medication_orders', id, {
    status: currentStatus,
  }, {
    status: newStatus,
    patientId: existing[0].patientId,
    visitId: existing[0].visitId,
    hasStatusReason: true,
  });

  return c.json({ Results: { id, status: newStatus } });
});

// ─── DELETE /medication-orders/:id — clinical orders are immutable ──────────
medicationOrderRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.select({
    id: clnMedicationOrders.id,
    status: clnMedicationOrders.status,
    patientId: clnMedicationOrders.patientId,
    visitId: clnMedicationOrders.visitId,
  })
    .from(clnMedicationOrders)
    .where(
      and(
        eq(clnMedicationOrders.id, id),
        eq(clnMedicationOrders.tenantId, tenantId),
        eq(clnMedicationOrders.isActive, 1)
      )
    )
    .limit(1);

  if (existing.length === 0) throw new HTTPException(404, { message: 'Order not found' });

  await createAuditLog(c.env, tenantId, userId, 'BLOCKED_DELETE', 'cln_medication_orders', id, {
    status: existing[0].status,
  }, {
    patientId: existing[0].patientId,
    visitId: existing[0].visitId,
    outcome: 'blocked_clinical_record_delete',
  });

  throw new HTTPException(409, {
    message: 'Medication orders are immutable clinical records. Use discontinue or cancel with a reason.',
  });
});

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireRole, requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  cancelIpdDoctorRound,
  createDoctorClinicalRound,
  createIpdDoctorRound,
  resolveDoctorIdForUser,
  type DoctorClinicalRoundResult,
} from '../../lib/ipd-doctor-rounds';
import type { Env, Variables } from '../../types';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createSchema = z.object({
  admissionId: z.number().int().positive(),
  patientId: z.number().int().positive(),
  doctorId: z.number().int().positive(),
  roundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roundTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  entrySource: z.enum(['nurse_station', 'ipd_billing']),
  idempotencyKey: z.string().trim().min(16).max(128),
});

const clinicalSchema = z.object({
  admissionId: z.number().int().positive(),
  patientId: z.number().int().positive(),
  roundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roundTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  patientCondition: z.enum(['improving', 'stable', 'deteriorating', 'critical']),
  title: z.string().trim().max(500).optional(),
  subjective: z.string().max(10000).optional(),
  objective: z.string().max(10000).optional(),
  assessment: z.string().max(10000).optional(),
  plan: z.string().max(10000).optional(),
  roundSummary: z.string().max(2000).optional(),
  createBillingRound: z.boolean().optional().default(false),
  idempotencyKey: z.string().trim().min(16).max(128),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });

const createRoles = ['nurse', 'reception', 'hospital_admin', 'md', 'director', 'accountant'];
const billingRoles = ['reception', 'hospital_admin', 'md', 'director', 'accountant'];

routes.post('/', zValidator('json', createSchema), async (c) => {
  const role = requireRole(c);
  if (!createRoles.includes(role)) throw new HTTPException(403, { message: 'Forbidden' });
  const data = c.req.valid('json');
  if (role === 'nurse' && data.entrySource !== 'nurse_station') {
    throw new HTTPException(403, { message: 'Nurses must use the nurse station round source' });
  }
  if (role !== 'nurse' && (!billingRoles.includes(role) || data.entrySource !== 'ipd_billing')) {
    throw new HTTPException(403, { message: 'Billing roles must use the IP billing round source' });
  }

  const result = await createIpdDoctorRound(
    c.env,
    requireTenantId(c),
    requireUserId(c),
    data,
  );
  return c.json(result, result.created ? 201 : 200);
});

// Doctor-driven clinical round note endpoint.
routes.post('/clinical', zValidator('json', clinicalSchema), async (c) => {
  if (requireRole(c) !== 'doctor') {
    throw new HTTPException(403, { message: 'Only doctors can sign clinical round notes' });
  }
  const data = c.req.valid('json');
  const result: DoctorClinicalRoundResult = await createDoctorClinicalRound(
    c.env,
    requireTenantId(c),
    requireUserId(c),
    data,
  );
  return c.json(result, result.createdNote ? 201 : 200);
});

routes.get('/', async (c) => {
  const role = requireRole(c);
  if (!createRoles.includes(role) && role !== 'doctor') {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const admissionId = Number(c.req.query('admission_id'));
  if (!Number.isInteger(admissionId) || admissionId <= 0) {
    throw new HTTPException(400, { message: 'Valid admission_id is required' });
  }

  // Doctor access control: a doctor may only view rounds for an admission
  // assigned to them. Other roles are unrestricted within their tenant.
  if (role === 'doctor') {
    const doctorId = await resolveDoctorIdForUser(c.env.DB, tenantId, userId);
    if (!doctorId) throw new HTTPException(403, { message: 'Doctor profile not linked to this user' });
    const admission = await c.env.DB.prepare(
      `SELECT doctor_id FROM admissions WHERE id = ? AND tenant_id = ?`,
    ).bind(admissionId, tenantId).first<{ doctor_id: number | null }>();
    if (!admission || Number(admission.doctor_id ?? 0) !== doctorId) {
      throw new HTTPException(403, { message: 'You are not assigned to this admission' });
    }
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      r.id, r.tenant_id, r.admission_id, r.patient_id, r.doctor_id,
      r.rounded_at, r.doctor_name_snapshot, r.round_fee_snapshot,
      r.entry_source, r.entered_by, r.idempotency_key, r.provisional_item_id,
      r.status, r.cancel_reason, r.cancelled_by, r.cancelled_at,
      r.clinical_note_id, r.clinical_status, r.signed_by, r.signed_at,
      r.round_summary, r.patient_condition,
      r.created_at, r.updated_at,
      u.name AS entered_by_name,
      pi.bill_status,
      cn.title AS clinical_note_title,
      cn.note_type AS clinical_note_type,
      cn.is_signed AS clinical_note_signed,
      cn.created_at AS clinical_note_created_at
    FROM ipd_doctor_rounds r
    LEFT JOIN users u ON u.id = r.entered_by AND u.tenant_id = r.tenant_id
    LEFT JOIN billing_provisional_items pi
      ON pi.id = r.provisional_item_id AND pi.tenant_id = r.tenant_id
    LEFT JOIN clinical_notes cn
      ON cn.id = r.clinical_note_id AND cn.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.admission_id = ?
    ORDER BY r.rounded_at DESC, r.id DESC
  `).bind(tenantId, admissionId).all();
  return c.json({ rounds: results });
});

routes.post('/:id/cancel', zValidator('json', cancelSchema), async (c) => {
  const role = requireRole(c);
  if (!['hospital_admin', 'md', 'director'].includes(role)) {
    throw new HTTPException(403, { message: 'Only authorized management can cancel a doctor round' });
  }
  const roundId = Number(c.req.param('id'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    throw new HTTPException(400, { message: 'Invalid doctor round id' });
  }
  const result = await cancelIpdDoctorRound(
    c.env,
    requireTenantId(c),
    requireUserId(c),
    roundId,
    c.req.valid('json').reason,
  );
  return c.json(result);
});

export default routes;

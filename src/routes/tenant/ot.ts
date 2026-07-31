import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { buildProgrammaticOverview } from '../../lib/ot-programmatic-overview';
import { calculateCommissions, type BillItemForCommission, type CommissionRule } from '../../lib/ot-commission-calc';
import { hasPermission } from '../../lib/ipd-ot-rbac';
import { shouldTriggerOtConsumptionOnStatus, triggerOtCompletionConsumption } from '../../lib/inventory-consumption-clinical-hook';


const ot = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createBookingSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  booked_for_date: z.string().min(1),
  is_emergency: z.union([z.boolean(), z.number().int().min(0).max(1)]).transform(value => value ? 1 : 0).optional(),
  surgery_type: z.string().optional(),
  diagnosis: z.string().optional(),
  procedure_type: z.string().optional(),
  anesthesia_type: z.string().optional(),
  remarks: z.string().optional(),
  consent_form_path: z.string().optional(),
  pac_form_path: z.string().optional(),
  team: z.array(z.object({
    staff_id: z.number().int().positive(),
    role_type: z.enum(['surgeon', 'anesthetist', 'anesthetist_assistant', 'scrub_nurse', 'ot_assistant']),
  })).optional(),
});

const updateBookingSchema = z.object({
  booked_for_date: z.string().optional(),
  surgery_type: z.string().optional(),
  diagnosis: z.string().optional(),
  procedure_type: z.string().optional(),
  anesthesia_type: z.string().optional(),
  remarks: z.string().optional(),
  consent_form_path: z.string().optional(),
  pac_form_path: z.string().optional(),
  team: z.array(z.object({
    staff_id: z.number().int().positive(),
    role_type: z.enum(['surgeon', 'anesthetist', 'anesthetist_assistant', 'scrub_nurse', 'ot_assistant']),
  })).optional(),
});

const cancelBookingSchema = z.object({
  cancellation_remarks: z.string().optional(),
});

const createTeamMemberSchema = z.object({
  booking_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  staff_id: z.number().int().positive(),
  role_type: z.enum(['surgeon', 'anesthetist', 'anesthetist_assistant', 'scrub_nurse', 'ot_assistant']),
});

const createChecklistSchema = z.object({
  booking_id: z.number().int().positive(),
  item_name: z.string().min(1),
  item_value: z.boolean().default(false),
  item_details: z.string().optional(),
});

const updateChecklistSchema = z.object({
  item_name: z.string().optional(),
  item_value: z.boolean().optional(),
  item_details: z.string().optional(),
});

const bulkChecklistSchema = z.object({
  items: z.array(z.object({
    item_name: z.string().min(1),
    item_value: z.boolean().default(false),
    item_details: z.string().optional(),
  })),
});

const createSummarySchema = z.object({
  booking_id: z.number().int().positive(),
  team_member_id: z.number().int().positive().optional(),
  pre_op_diagnosis: z.string().optional(),
  post_op_diagnosis: z.string().optional(),
  anesthesia: z.string().optional(),
  ot_charge: z.number().default(0),
  ot_description: z.string().optional(),
  category: z.string().optional(),
  nurse_signature: z.string().optional(),
});

const updateSummarySchema = z.object({
  team_member_id: z.number().int().positive().optional(),
  pre_op_diagnosis: z.string().optional(),
  post_op_diagnosis: z.string().optional(),
  anesthesia: z.string().optional(),
  ot_charge: z.number().optional(),
  ot_description: z.string().optional(),
  category: z.string().optional(),
  nurse_signature: z.string().optional(),
});

const operationStatusSchema = z.object({
  status: z.enum(['scheduled', 'pre_op', 'in_progress', 'completed', 'cancelled']),
  remarks: z.string().max(1000).optional(),
});

const surgeryNoteSchema = z.object({
  operative_procedure: z.string().min(1),
  operative_findings: z.string().max(4000).optional(),
  complications: z.string().max(2000).optional(),
  implants_or_specimens: z.string().max(2000).optional(),
  blood_loss_ml: z.number().min(0).optional(),
  incision_start_time: z.string().optional(),
  closure_time: z.string().optional(),
  surgeon_staff_id: z.number().int().positive().optional(),
  note_status: z.enum(['draft', 'final', 'amended']).default('draft'),
});

const updateSurgeryNoteSchema = surgeryNoteSchema.partial();

const anesthesiaRecordSchema = z.object({
  anesthetist_staff_id: z.number().int().positive().optional(),
  anesthesia_type: z.string().max(100).optional(),
  asa_class: z.string().max(10).optional(),
  airway_plan: z.string().max(1000).optional(),
  pre_anesthesia_assessment: z.string().max(4000).optional(),
  intraoperative_vitals: z.array(z.record(z.string(), z.unknown())).optional(),
  medications: z.array(z.record(z.string(), z.unknown())).optional(),
  fluids: z.array(z.record(z.string(), z.unknown())).optional(),
  complications: z.string().max(2000).optional(),
  recovery_notes: z.string().max(2000).optional(),
  record_status: z.enum(['draft', 'final', 'amended']).default('draft'),
});

const updateAnesthesiaRecordSchema = anesthesiaRecordSchema.partial();

async function getActiveBooking(db: ReturnType<typeof getDb>, tenantId: string, bookingId: number) {
  const booking = await db.$client.prepare(
    'SELECT id, patient_id, visit_id, operation_status FROM ot_bookings WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(bookingId, tenantId).first<{ id: number; patient_id: number; visit_id: number | null; operation_status?: string | null }>();

  if (!booking) throw new HTTPException(404, { message: 'OT booking not found' });
  return booking;
}

type OtBillingBooking = {
  id: number;
  patient_id: number;
  visit_id: number | null;
};

type OtSummaryBillingContext = {
  id: number;
  booking_id: number;
  patient_id: number;
  visit_id: number | null;
  ot_charge: number | null;
  ot_description: string | null;
  category: string | null;
};

type OtLinkedVisitService = {
  id: number;
  reference_id: number;
  status: string;
  bill_id: number | null;
  total_amount: number | null;
};

function toPositiveAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100) / 100;
}

function buildOtChargeDescription(summary: Pick<OtSummaryBillingContext, 'ot_description' | 'category'>, fallback = 'Operation theatre charge'): string {
  const description = String(summary.ot_description ?? '').trim();
  if (description) return description;
  const category = String(summary.category ?? '').trim();
  return category ? `Operation theatre charge - ${category}` : fallback;
}

function hasPostedOtService(service: OtLinkedVisitService): boolean {
  return service.status === 'billed' || service.status === 'refunded' || service.bill_id != null;
}

async function loadOtSummaryBillingContext(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  summaryId: number,
): Promise<OtSummaryBillingContext> {
  const summary = await db.$client.prepare(`
    SELECT
      s.id,
      s.booking_id,
      s.ot_charge,
      s.ot_description,
      s.category,
      b.patient_id,
      b.visit_id
    FROM ot_summaries s
    JOIN ot_bookings b ON b.id = s.booking_id AND b.tenant_id = s.tenant_id
    WHERE s.id = ? AND s.tenant_id = ?
    LIMIT 1
  `).bind(summaryId, tenantId).first<OtSummaryBillingContext>();

  if (!summary) throw new HTTPException(404, { message: 'OT summary not found' });
  return summary;
}

async function loadOtLinkedVisitServices(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  summaryIds: number[],
): Promise<OtLinkedVisitService[]> {
  if (summaryIds.length === 0) return [];
  const placeholders = summaryIds.map(() => '?').join(', ');
  const { results } = await db.$client.prepare(`
    SELECT id, reference_id, status, bill_id, total_amount
    FROM visit_services
    WHERE tenant_id = ?
      AND reference_type = 'ot_summary'
      AND reference_id IN (${placeholders})
      AND status IN ('pending', 'billed', 'refunded')
  `).bind(tenantId, ...summaryIds).all<OtLinkedVisitService>();
  return results;
}

async function syncOtSummaryPendingBilling(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  userId: string,
  summary: OtSummaryBillingContext,
): Promise<void> {
  const charge = toPositiveAmount(summary.ot_charge);
  const linkedServices = await loadOtLinkedVisitServices(db, tenantId, [summary.id]);
  const postedService = linkedServices.find(hasPostedOtService);
  const pendingService = linkedServices.find((service) => service.status === 'pending');

  if (postedService) {
    const postedAmount = toPositiveAmount(postedService.total_amount);
    if (Math.abs(postedAmount - charge) > 0.001) {
      throw new HTTPException(409, {
        message: 'This OT charge is already billed. Use credit note/refund and reversal workflow instead of editing the posted charge.',
      });
    }
    return;
  }

  if (charge <= 0) {
    if (pendingService) {
      await db.$client.prepare(`
        UPDATE visit_services
        SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND status = 'pending'
      `).bind(pendingService.id, tenantId).run();
    }
    return;
  }

  if (!summary.visit_id) {
    throw new HTTPException(400, { message: 'A visit is required before adding an OT billing charge.' });
  }

  const description = buildOtChargeDescription(summary);
  if (pendingService) {
    await db.$client.prepare(`
      UPDATE visit_services
      SET visit_id = ?, patient_id = ?, service_type = ?, description = ?,
          service_item_id = NULL, amount = ?, discount_amount = 0,
          quantity = 1, total_amount = ?, status = 'pending',
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(
      summary.visit_id,
      summary.patient_id,
      'procedure',
      description,
      charge,
      charge,
      pendingService.id,
      tenantId,
    ).run();
    return;
  }

  await db.$client.prepare(`
    INSERT INTO visit_services
      (tenant_id, visit_id, patient_id, service_type, description, service_item_id,
       amount, discount_amount, quantity, total_amount, reference_type, reference_id,
       status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 1, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    summary.visit_id,
    summary.patient_id,
    'procedure',
    description,
    charge,
    charge,
    'ot_summary',
    summary.id,
    'pending',
    userId,
  ).run();
}

async function assertOtSummaryChargeCanChange(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  summaryId: number,
  nextCharge: number,
): Promise<void> {
  const linkedServices = await loadOtLinkedVisitServices(db, tenantId, [summaryId]);
  const postedService = linkedServices.find(hasPostedOtService);
  if (!postedService) return;

  const postedAmount = toPositiveAmount(postedService.total_amount);
  if (Math.abs(postedAmount - nextCharge) > 0.001) {
    throw new HTTPException(409, {
      message: 'This OT charge is already billed. Use credit note/refund and reversal workflow instead of editing the posted charge.',
    });
  }
}

async function applyOtBookingCancellationBillingGuard(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  bookingId: number,
): Promise<void> {
  const { results: summaries } = await db.$client.prepare(`
    SELECT id
    FROM ot_summaries
    WHERE booking_id = ? AND tenant_id = ?
  `).bind(bookingId, tenantId).all<{ id: number }>();

  const summaryIds = summaries.map((summary) => Number(summary.id)).filter((id) => Number.isFinite(id));
  const linkedServices = await loadOtLinkedVisitServices(db, tenantId, summaryIds);
  const postedService = linkedServices.find(hasPostedOtService);
  if (postedService) {
    throw new HTTPException(409, {
      message: 'This OT booking has a billed charge. Use credit note/refund and reversal workflow before cancellation.',
    });
  }

  const pendingServices = linkedServices.filter((service) => service.status === 'pending');
  if (pendingServices.length === 0) return;

  await db.$client.batch(pendingServices.map((service) =>
    db.$client.prepare(`
      UPDATE visit_services
      SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(service.id, tenantId),
  ));
}

// ─── Programmatic Overview (read-only, no LLM) ───────────────────────────────

// GET /overview/:patient_id — deterministic clinical overview
// Replaces any LLM-driven "AI summary". All signals are derived from
// rule-based SQL aggregations; see src/lib/ot-programmatic-overview.ts.
const overviewPatientParams = z.object({
  patient_id: z.coerce.number().int().positive(),
});
const overviewQueryParams = z.object({
  visit_id: z.coerce.number().int().positive().optional(),
  case_id: z.coerce.number().int().positive().optional(),
});
ot.get(
  '/overview/:patient_id',
  zValidator('param', overviewPatientParams),
  zValidator('query', overviewQueryParams),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { patient_id } = c.req.valid('param') as z.infer<typeof overviewPatientParams>;
    const { visit_id, case_id } = c.req.valid('query') as z.infer<typeof overviewQueryParams>;
    const overview = await buildProgrammaticOverview(db.$client, tenantId, {
      patient_id,
      visit_id,
      case_id,
    });
    if (!overview) {
      return c.json({ error: 'Patient not found' }, 404);
    }
    return c.json(overview);
  },
);

// ─── OT Rooms CRUD ───────────────────────────────────────────────────────────

const roomTypeEnum = z.enum(['general', 'cardiac', 'neuro', 'ortho', 'ophthalmic', 'emergency', 'laparoscopic', 'minor']);
const roomStatusEnum = z.enum(['available', 'occupied', 'cleaning', 'sterilization', 'maintenance', 'blocked']);

const createRoomSchema = z.object({
  name: z.string().min(1).max(80),
  room_code: z.string().max(40).optional(),
  floor: z.string().max(40).optional(),
  room_type: roomTypeEnum.default('general'),
  cleaning_duration_minutes: z.number().int().nonnegative().max(480).default(30),
  sterilization_duration_minutes: z.number().int().nonnegative().max(480).default(45),
});

const updateRoomSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  room_code: z.string().max(40).optional(),
  floor: z.string().max(40).optional(),
  room_type: roomTypeEnum.optional(),
  status: roomStatusEnum.optional(),
  cleaning_duration_minutes: z.number().int().nonnegative().max(480).optional(),
  sterilization_duration_minutes: z.number().int().nonnegative().max(480).optional(),
});

const roomIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /rooms — list active rooms for the tenant
ot.get('/rooms', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    `SELECT id, tenant_id, name, room_code, floor, room_type, status,
            cleaning_duration_minutes, sterilization_duration_minutes,
            available_from, available_to, is_active, created_at, updated_at
       FROM ot_rooms
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY name ASC`
  ).bind(tenantId).all();
  return c.json({ rooms: results });
});

// GET /rooms/:id — fetch one room
ot.get(
  '/rooms/:id',
  zValidator('param', roomIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof roomIdParam>;
    const room = await db.$client.prepare(
      `SELECT id, tenant_id, name, room_code, floor, room_type, status,
              cleaning_duration_minutes, sterilization_duration_minutes,
              available_from, available_to, is_active, created_at, updated_at
         FROM ot_rooms
        WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, id).first();
    if (!room) return c.json({ error: 'Room not found' }, 404);
    return c.json({ room });
  },
);

// POST /rooms — create a room
ot.post(
  '/rooms',
  zValidator('json', createRoomSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json') as z.infer<typeof createRoomSchema>;
    const result = await db.$client.prepare(
      `INSERT INTO ot_rooms
        (tenant_id, name, room_code, floor, room_type,
         cleaning_duration_minutes, sterilization_duration_minutes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId,
      data.name,
      data.room_code ?? null,
      data.floor ?? null,
      data.room_type,
      data.cleaning_duration_minutes,
      data.sterilization_duration_minutes,
      userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /rooms/:id — partial update of a room
ot.put(
  '/rooms/:id',
  zValidator('param', roomIdParam),
  zValidator('json', updateRoomSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof roomIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateRoomSchema>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateRoomSchema>, string> = {
      name: 'name',
      room_code: 'room_code',
      floor: 'floor',
      room_type: 'room_type',
      status: 'status',
      cleaning_duration_minutes: 'cleaning_duration_minutes',
      sterilization_duration_minutes: 'sterilization_duration_minutes',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_rooms SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? AND is_active = 1`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Room not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /rooms/:id — soft delete (is_active=0)
ot.delete(
  '/rooms/:id',
  zValidator('param', roomIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof roomIdParam>;
    const result = await db.$client.prepare(
      `UPDATE ot_rooms SET is_active = 0, updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND is_active = 1`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Room not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Consent Management ────────────────────────────────────────────────────

const consentTypeEnum = z.enum([
  'general_surgery', 'anesthesia', 'high_risk', 'blood_transfusion',
  'c_section', 'minor_guardian', 'laparoscopic', 'icu', 'other',
]);
const consentStatusEnum = z.enum(['not_required', 'pending', 'uploaded', 'signed', 'verified', 'rejected']);

const createConsentSchema = z.object({
  consent_type: consentTypeEnum,
  guardian_name: z.string().max(120).optional(),
  guardian_relation: z.string().max(60).optional(),
  guardian_phone: z.string().max(20).optional(),
  witness_name: z.string().max(120).optional(),
  doctor_id: z.number().int().positive().optional(),
  file_url: z.string().max(500).optional(),
  file_key: z.string().max(500).optional(),
  remarks: z.string().max(500).optional(),
});

const updateConsentSchema = z.object({
  status: consentStatusEnum.optional(),
  guardian_name: z.string().max(120).optional(),
  guardian_relation: z.string().max(60).optional(),
  guardian_phone: z.string().max(20).optional(),
  witness_name: z.string().max(120).optional(),
  file_url: z.string().max(500).optional(),
  file_key: z.string().max(500).optional(),
  remarks: z.string().max(500).optional(),
});

const consentBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const consentIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/consents — list all consents for a booking
ot.get(
  '/bookings/:booking_id/consents',
  zValidator('param', consentBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof consentBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, consent_type,
              guardian_name, guardian_relation, guardian_phone,
              witness_name, doctor_id, status, file_url, file_key,
              signed_at, verified_by, verified_at, remarks,
              created_by, created_at, updated_at
         FROM ot_consents
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY consent_type ASC`
    ).bind(tenantId, booking_id).all();
    return c.json({ consents: results });
  },
);

// POST /bookings/:booking_id/consents — create a consent
ot.post(
  '/bookings/:booking_id/consents',
  zValidator('param', consentBookingParam),
  zValidator('json', createConsentSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof consentBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createConsentSchema>;

    const booking = await db.$client.prepare(
      `SELECT id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO ot_consents
         (tenant_id, booking_id, consent_type,
          guardian_name, guardian_relation, guardian_phone,
          witness_name, doctor_id, file_url, file_key, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, data.consent_type,
      data.guardian_name ?? null, data.guardian_relation ?? null, data.guardian_phone ?? null,
      data.witness_name ?? null, data.doctor_id ?? null,
      data.file_url ?? null, data.file_key ?? null, data.remarks ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /consents/:id — update a consent (status, verify, reject, upload file)
ot.put(
  '/consents/:id',
  zValidator('param', consentIdParam),
  zValidator('json', updateConsentSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id } = c.req.valid('param') as z.infer<typeof consentIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateConsentSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateConsentSchema>, string> = {
      status: 'status',
      guardian_name: 'guardian_name',
      guardian_relation: 'guardian_relation',
      guardian_phone: 'guardian_phone',
      witness_name: 'witness_name',
      file_url: 'file_url',
      file_key: 'file_key',
      remarks: 'remarks',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    // Auto-stamp signed_at when moving to signed
    if (data.status === 'signed') {
      sets.push("signed_at = datetime('now', '+6 hours')");
    }
    // Auto-stamp verified_by/verified_at when moving to verified
    if (data.status === 'verified' || data.status === 'rejected') {
      sets.push('verified_by = ?');
      vals.push(userId);
      sets.push("verified_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_consents SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Consent not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /consents/:id — remove a consent
ot.delete(
  '/consents/:id',
  zValidator('param', consentIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof consentIdParam>;
    const result = await db.$client.prepare(
      `DELETE FROM ot_consents WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Consent not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── Intra-OT Vitals Timeline ────────────────────────────────────────────────

const vitalsBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });

const createVitalsSchema = z.object({
  temperature: z.number().min(80).max(115).optional(),
  pulse: z.number().int().min(20).max(300).optional(),
  blood_pressure_systolic: z.number().int().min(30).max(350).optional(),
  blood_pressure_diastolic: z.number().int().min(20).max(200).optional(),
  respiratory_rate: z.number().int().min(5).max(80).optional(),
  spo2: z.number().min(50).max(100).optional(),
  weight: z.number().min(0.5).max(500).optional(),
  height: z.number().min(20).max(300).optional(),
  pain_scale: z.number().int().min(0).max(10).optional(),
  blood_sugar: z.number().min(20).max(800).optional(),
  notes: z.string().max(500).optional(),
}).refine(
  (d) => d.temperature !== undefined || d.pulse !== undefined ||
         d.blood_pressure_systolic !== undefined || d.blood_pressure_diastolic !== undefined ||
         d.respiratory_rate !== undefined || d.spo2 !== undefined ||
         d.weight !== undefined || d.height !== undefined ||
         d.pain_scale !== undefined || d.blood_sugar !== undefined,
  { message: 'At least one vital sign is required' },
);

// GET /bookings/:booking_id/vitals — list vitals for the booking patient
ot.get(
  '/bookings/:booking_id/vitals',
  zValidator('param', vitalsBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof vitalsBookingParam>;

    const booking = await db.$client.prepare(
      `SELECT id, patient_id, visit_id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first<{ id: number; patient_id: number; visit_id: number }>();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, patient_id, visit_id,
              temperature, pulse, blood_pressure_systolic, blood_pressure_diastolic,
              respiratory_rate, spo2, weight, height, bmi, pain_scale,
              blood_sugar, notes, taken_by, taken_at, is_active, created_at, updated_at
         FROM clinical_vitals
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY taken_at DESC`
    ).bind(tenantId, booking.patient_id).all();
    return c.json({ vitals: results });
  },
);

// POST /bookings/:booking_id/vitals — record intra-op vitals
ot.post(
  '/bookings/:booking_id/vitals',
  zValidator('param', vitalsBookingParam),
  zValidator('json', createVitalsSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof vitalsBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createVitalsSchema>;

    const booking = await db.$client.prepare(
      `SELECT id, patient_id, visit_id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first<{ id: number; patient_id: number; visit_id: number }>();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO clinical_vitals
         (tenant_id, patient_id, visit_id,
          temperature, pulse, blood_pressure_systolic, blood_pressure_diastolic,
          respiratory_rate, spo2, weight, height, pain_scale, blood_sugar,
          notes, taken_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking.patient_id, booking.visit_id ?? null,
      data.temperature ?? null, data.pulse ?? null,
      data.blood_pressure_systolic ?? null, data.blood_pressure_diastolic ?? null,
      data.respiratory_rate ?? null, data.spo2 ?? null,
      data.weight ?? null, data.height ?? null,
      data.pain_scale ?? null, data.blood_sugar ?? null,
      data.notes ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// ─── OT Inventory Consumption ─────────────────────────────────────────────────

const inventorySourceEnum = z.enum([
  'ot_sub_store', 'central_pharmacy', 'central_store', 'cssd',
  'emergency_cart', 'department_stock', 'patient_brought',
]);
const inventoryStatusEnum = z.enum(['issued', 'used', 'returned', 'wasted', 'billed', 'cancelled']);

const createInventorySchema = z.object({
  item_id: z.number().int().positive(),
  batch_id: z.number().int().positive().optional(),
  qty_issued: z.number().nonnegative().max(10000).default(1),
  qty_used: z.number().nonnegative().max(10000).optional(),
  qty_returned: z.number().nonnegative().max(10000).optional(),
  qty_wasted: z.number().nonnegative().max(10000).optional(),
  unit_price: z.number().nonnegative().max(1000000).default(0),
  source: inventorySourceEnum.default('ot_sub_store'),
  is_billable: z.number().int().min(0).max(1).default(1),
  remarks: z.string().max(500).optional(),
});

const updateInventorySchema = z.object({
  status: inventoryStatusEnum.optional(),
  qty_used: z.number().nonnegative().max(10000).optional(),
  qty_returned: z.number().nonnegative().max(10000).optional(),
  qty_wasted: z.number().nonnegative().max(10000).optional(),
  remarks: z.string().max(500).optional(),
});

const inventoryBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const inventoryIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/inventory — list consumptions
ot.get(
  '/bookings/:booking_id/inventory',
  zValidator('param', inventoryBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof inventoryBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, item_id, batch_id,
              qty_issued, qty_used, qty_returned, qty_wasted,
              unit_price, source, is_billable, status,
              issued_by, used_by, returned_by,
              issued_at, used_at, returned_at,
              bill_id, visit_service_id, remarks,
              created_by, created_at, updated_at
         FROM ot_inventory_consumptions
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY created_at ASC`
    ).bind(tenantId, booking_id).all();
    return c.json({ consumptions: results });
  },
);

// POST /bookings/:booking_id/inventory — create a consumption record
ot.post(
  '/bookings/:booking_id/inventory',
  zValidator('param', inventoryBookingParam),
  zValidator('json', createInventorySchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof inventoryBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createInventorySchema>;

    const booking = await db.$client.prepare(
      `SELECT id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO ot_inventory_consumptions
         (tenant_id, booking_id, item_id, batch_id,
          qty_issued, qty_used, qty_returned, qty_wasted,
          unit_price, source, is_billable, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, data.item_id, data.batch_id ?? null,
      data.qty_issued, data.qty_used ?? 0, data.qty_returned ?? 0, data.qty_wasted ?? 0,
      data.unit_price, data.source, data.is_billable, data.remarks ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /inventory/:id — update a consumption record (mark used/returned/wasted)
ot.put(
  '/inventory/:id',
  zValidator('param', inventoryIdParam),
  zValidator('json', updateInventorySchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id } = c.req.valid('param') as z.infer<typeof inventoryIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateInventorySchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateInventorySchema>, string> = {
      status: 'status',
      qty_used: 'qty_used',
      qty_returned: 'qty_returned',
      qty_wasted: 'qty_wasted',
      remarks: 'remarks',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    // Auto-stamp timestamps by status
    if (data.status === 'used') {
      sets.push('used_by = ?');
      vals.push(userId);
      sets.push("used_at = datetime('now', '+6 hours')");
    }
    if (data.status === 'returned') {
      sets.push('returned_by = ?');
      vals.push(userId);
      sets.push("returned_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_inventory_consumptions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Consumption record not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /inventory/:id — remove a consumption record
ot.delete(
  '/inventory/:id',
  zValidator('param', inventoryIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof inventoryIdParam>;
    const result = await db.$client.prepare(
      `DELETE FROM ot_inventory_consumptions WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Consumption record not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Billing ──────────────────────────────────────────────────────────────

const billStatusEnum = z.enum(['draft', 'pending_review', 'posted', 'locked', 'cancelled']);

const updateBillSchema = z.object({
  status: billStatusEnum.optional(),
  discount_amount: z.number().nonnegative().optional(),
  review_notes: z.string().max(1000).optional(),
  unlock_reason: z.string().max(500).optional(),
});

const chargeHeadEnum = z.enum([
  'ot_room', 'surgery', 'surgeon_fee', 'assistant_surgeon_fee',
  'anesthesia', 'anesthetist_fee', 'ot_nurse_service', 'equipment',
  'consumables', 'medicines', 'implant', 'cssd', 'recovery',
  'emergency_surcharge', 'misc',
]);

const createBillItemSchema = z.object({
  charge_head: chargeHeadEnum,
  item_id: z.number().int().positive().optional(),
  inventory_consumption_id: z.number().int().positive().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(10000).default(1),
  unit_price: z.number().nonnegative().max(1000000).default(0),
  doctor_id: z.number().int().positive().optional(),
  is_commissionable: z.number().int().min(0).max(1).default(1),
  is_billable: z.number().int().min(0).max(1).default(1),
});

const billBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const billIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/bill — get bill with items
ot.get(
  '/bookings/:booking_id/bill',
  zValidator('param', billBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof billBookingParam>;

    const booking = await db.$client.prepare(
      `SELECT id, patient_id, visit_id, admission_id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first<{ id: number; patient_id: number }>();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const bill = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, patient_id, visit_id, admission_id,
              gross_amount, discount_amount, net_amount, status,
              posted_to_ipd_bill_id, posted_by, posted_at,
              locked_by, locked_at, unlock_reason, review_notes,
              created_by, created_at, updated_at
         FROM ot_bills WHERE tenant_id = ? AND booking_id = ?`
    ).bind(tenantId, booking_id).first();
    if (!bill) return c.json({ error: 'No bill found for this booking' }, 404);

    const { results: items } = await db.$client.prepare(
      `SELECT id, tenant_id, ot_bill_id, charge_head, item_id,
              inventory_consumption_id, description, quantity,
              unit_price, total, doctor_id, is_commissionable,
              is_billable, created_by, created_at
         FROM ot_bill_items WHERE tenant_id = ? AND ot_bill_id = ?
        ORDER BY charge_head ASC, id ASC`
    ).bind(tenantId, (bill as { id: number }).id).all();
    return c.json({ bill, items });
  },
);

// POST /bookings/:booking_id/bill — create a bill for a booking
ot.post(
  '/bookings/:booking_id/bill',
  zValidator('param', billBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof billBookingParam>;

    const booking = await db.$client.prepare(
      `SELECT id, patient_id, visit_id, admission_id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first<{ id: number; patient_id: number; visit_id: number; admission_id: number }>();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO ot_bills
         (tenant_id, booking_id, patient_id, visit_id, admission_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, booking.patient_id,
      booking.visit_id ?? null, booking.admission_id ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /bills/:id — update bill (post, lock, unlock, discount)
ot.put(
  '/bills/:id',
  zValidator('param', billIdParam),
  zValidator('json', updateBillSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id } = c.req.valid('param') as z.infer<typeof billIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateBillSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateBillSchema>, string> = {
      status: 'status',
      discount_amount: 'discount_amount',
      review_notes: 'review_notes',
      unlock_reason: 'unlock_reason',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    // Auto-stamp by status transition
    if (data.status === 'posted') {
      sets.push('posted_by = ?');
      vals.push(userId);
      sets.push("posted_at = datetime('now', '+6 hours')");
    }
    if (data.status === 'locked') {
      sets.push('locked_by = ?');
      vals.push(userId);
      sets.push("locked_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_bills SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Bill not found' }, 404);

    // Auto-calculate commissions when bill is posted
    if (data.status === 'posted') {
      const bill = await db.$client.prepare(
        `SELECT id, booking_id FROM ot_bills WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).first<{ id: number; booking_id: number }>();

      if (bill) {
        const { results: billItems } = await db.$client.prepare(
          `SELECT id, charge_head, doctor_id, total, is_commissionable
             FROM ot_bill_items WHERE tenant_id = ? AND ot_bill_id = ?`
        ).bind(tenantId, bill.id).all<BillItemForCommission>();

        const { results: rules } = await db.$client.prepare(
          `SELECT id, role, rule_type, amount, percent, procedure_id,
                  department_id, doctor_id, include_emergency_surcharge, priority
             FROM ot_commission_rules WHERE tenant_id = ? AND is_active = 1`
        ).bind(tenantId).all<CommissionRule>();

        const entries = calculateCommissions(billItems, rules, bill.booking_id, bill.id, Number(userId));

        for (const entry of entries) {
          await db.$client.prepare(
            `INSERT INTO ot_commissions
               (tenant_id, booking_id, ot_bill_id, doctor_id, role,
                gross_amount, commission_rule, commission_percent,
                commission_amount, deduction, net_payable, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            tenantId, entry.booking_id, entry.ot_bill_id, entry.doctor_id, entry.role,
            entry.gross_amount, entry.commission_rule, entry.commission_percent,
            entry.commission_amount, entry.deduction, entry.net_payable, entry.created_by,
          ).run();
        }
      }
    }

    return c.json({ success: true });
  },
);

// POST /bills/:id/items — add a line item
ot.post(
  '/bills/:id/items',
  zValidator('param', billIdParam),
  zValidator('json', createBillItemSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id: bill_id } = c.req.valid('param') as z.infer<typeof billIdParam>;
    const data = c.req.valid('json') as z.infer<typeof createBillItemSchema>;

    const result = await db.$client.prepare(
      `INSERT INTO ot_bill_items
         (tenant_id, ot_bill_id, charge_head, item_id, inventory_consumption_id,
          description, quantity, unit_price, total,
          doctor_id, is_commissionable, is_billable, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, bill_id, data.charge_head,
      data.item_id ?? null, data.inventory_consumption_id ?? null,
      data.description, data.quantity, data.unit_price,
      data.quantity * data.unit_price,
      data.doctor_id ?? null, data.is_commissionable, data.is_billable, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// ─── OT Recovery Handover ─────────────────────────────────────────────────────

const shiftedToEnum = z.enum(['recovery', 'ward', 'icu', 'pacu', 'home', 'discharged']);

const createRecoverySchema = z.object({
  shifted_to: shiftedToEnum,
  shift_time: z.string().min(1),
  consciousness_level: z.string().max(60).optional(),
  bp: z.string().max(20).optional(),
  pulse: z.number().int().min(20).max(300).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  pain_score: z.number().int().min(0).max(10).optional(),
  drain_status: z.string().max(200).optional(),
  catheter_status: z.string().max(200).optional(),
  oxygen_support: z.string().max(200).optional(),
  post_op_medicine: z.string().max(2000).optional(),
  post_op_instruction: z.string().max(2000).optional(),
  received_by: z.number().int().positive().optional(),
  remarks: z.string().max(500).optional(),
});

const updateRecoverySchema = z.object({
  shifted_to: shiftedToEnum.optional(),
  consciousness_level: z.string().max(60).optional(),
  bp: z.string().max(20).optional(),
  pulse: z.number().int().min(20).max(300).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  pain_score: z.number().int().min(0).max(10).optional(),
  drain_status: z.string().max(200).optional(),
  catheter_status: z.string().max(200).optional(),
  oxygen_support: z.string().max(200).optional(),
  post_op_medicine: z.string().max(2000).optional(),
  post_op_instruction: z.string().max(2000).optional(),
  received_by: z.number().int().positive().optional(),
  remarks: z.string().max(500).optional(),
});

const recoveryBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const recoveryIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/recovery — get handover for a booking
ot.get(
  '/bookings/:booking_id/recovery',
  zValidator('param', recoveryBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof recoveryBookingParam>;

    const booking = await db.$client.prepare(
      `SELECT id, patient_id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const handover = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, patient_id, shifted_to, shift_time,
              consciousness_level, bp, pulse, spo2, pain_score,
              drain_status, catheter_status, oxygen_support,
              post_op_medicine, post_op_instruction,
              handover_by, received_by, received_at, remarks,
              created_by, created_at, updated_at
         FROM ot_recovery_handovers WHERE tenant_id = ? AND booking_id = ?`
    ).bind(tenantId, booking_id).first();
    if (!handover) return c.json({ error: 'No recovery handover found' }, 404);
    return c.json({ handover });
  },
);

// POST /bookings/:booking_id/recovery — create a handover
ot.post(
  '/bookings/:booking_id/recovery',
  zValidator('param', recoveryBookingParam),
  zValidator('json', createRecoverySchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof recoveryBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createRecoverySchema>;

    const booking = await db.$client.prepare(
      `SELECT id, patient_id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first<{ id: number; patient_id: number }>();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO ot_recovery_handovers
         (tenant_id, booking_id, patient_id, shifted_to, shift_time,
          consciousness_level, bp, pulse, spo2, pain_score,
          drain_status, catheter_status, oxygen_support,
          post_op_medicine, post_op_instruction,
          handover_by, received_by, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, booking.patient_id, data.shifted_to, data.shift_time,
      data.consciousness_level ?? null, data.bp ?? null, data.pulse ?? null,
      data.spo2 ?? null, data.pain_score ?? null,
      data.drain_status ?? null, data.catheter_status ?? null, data.oxygen_support ?? null,
      data.post_op_medicine ?? null, data.post_op_instruction ?? null,
      userId, data.received_by ?? null, data.remarks ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /recovery/:id — update a handover
ot.put(
  '/recovery/:id',
  zValidator('param', recoveryIdParam),
  zValidator('json', updateRecoverySchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof recoveryIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateRecoverySchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateRecoverySchema>, string> = {
      shifted_to: 'shifted_to',
      consciousness_level: 'consciousness_level',
      bp: 'bp',
      pulse: 'pulse',
      spo2: 'spo2',
      pain_score: 'pain_score',
      drain_status: 'drain_status',
      catheter_status: 'catheter_status',
      oxygen_support: 'oxygen_support',
      post_op_medicine: 'post_op_medicine',
      post_op_instruction: 'post_op_instruction',
      received_by: 'received_by',
      remarks: 'remarks',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    if (data.received_by !== undefined) {
      sets.push("received_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_recovery_handovers SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Recovery handover not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Audit Log ─────────────────────────────────────────────────────────────

const createAuditSchema = z.object({
  action: z.string().min(1).max(100),
  entity_type: z.string().max(80).optional(),
  entity_id: z.number().int().positive().optional(),
  old_value: z.string().max(5000).optional(),
  new_value: z.string().max(5000).optional(),
  reason: z.string().max(500).optional(),
  device_info: z.string().max(200).optional(),
});

const auditBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/audit — list audit logs for a booking
ot.get(
  '/bookings/:booking_id/audit',
  zValidator('param', auditBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof auditBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, user_id, user_role, action,
              entity_type, entity_id, old_value, new_value,
              reason, ip_address, device_info, created_at
         FROM ot_audit_logs
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY created_at DESC`
    ).bind(tenantId, booking_id).all();
    return c.json({ logs: results });
  },
);

// POST /bookings/:booking_id/audit — create an audit log entry
ot.post(
  '/bookings/:booking_id/audit',
  zValidator('param', auditBookingParam),
  zValidator('json', createAuditSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const role = c.get('role') as string | undefined;
    const { booking_id } = c.req.valid('param') as z.infer<typeof auditBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createAuditSchema>;

    const booking = await db.$client.prepare(
      `SELECT id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;

    const result = await db.$client.prepare(
      `INSERT INTO ot_audit_logs
         (tenant_id, booking_id, user_id, user_role, action,
          entity_type, entity_id, old_value, new_value,
          reason, ip_address, device_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, userId, role ?? null, data.action,
      data.entity_type ?? null, data.entity_id ?? null,
      data.old_value ?? null, data.new_value ?? null,
      data.reason ?? null, ip, data.device_info ?? null,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// ─── OT Safety Checklist ──────────────────────────────────────────────────────

const safetySectionEnum = z.enum(['sign_in', 'time_out', 'sign_out', 'pre_ot', 'handover']);

const createSafetyItemSchema = z.object({
  section: safetySectionEnum,
  item_name: z.string().min(1).max(200),
  item_value: z.number().int().min(0).max(1).default(0),
  item_details: z.string().max(500).optional(),
  is_required: z.number().int().min(0).max(1).default(1),
});

const updateSafetyItemSchema = z.object({
  item_value: z.number().int().min(0).max(1).optional(),
  item_details: z.string().max(500).optional(),
  is_required: z.number().int().min(0).max(1).optional(),
});

const safetyBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const safetyIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/safety-checklist — list all items
ot.get(
  '/bookings/:booking_id/safety-checklist',
  zValidator('param', safetyBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof safetyBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, section, item_name,
              item_value, item_details, is_required,
              checked_by, checked_at, created_by, created_at, updated_at
         FROM ot_safety_checklists
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY section ASC, item_name ASC`
    ).bind(tenantId, booking_id).all();
    return c.json({ items: results });
  },
);

// POST /bookings/:booking_id/safety-checklist — create an item
ot.post(
  '/bookings/:booking_id/safety-checklist',
  zValidator('param', safetyBookingParam),
  zValidator('json', createSafetyItemSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof safetyBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createSafetyItemSchema>;

    const result = await db.$client.prepare(
      `INSERT INTO ot_safety_checklists
         (tenant_id, booking_id, section, item_name, item_value, item_details, is_required, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, data.section, data.item_name,
      data.item_value, data.item_details ?? null, data.is_required, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /safety-checklist/:id — check/uncheck an item
ot.put(
  '/safety-checklist/:id',
  zValidator('param', safetyIdParam),
  zValidator('json', updateSafetyItemSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id } = c.req.valid('param') as z.infer<typeof safetyIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateSafetyItemSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateSafetyItemSchema>, string> = {
      item_value: 'item_value',
      item_details: 'item_details',
      is_required: 'is_required',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    // Auto-stamp when checking
    if (data.item_value === 1) {
      sets.push('checked_by = ?');
      vals.push(userId);
      sets.push("checked_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_safety_checklists SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Checklist item not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /safety-checklist/:id — remove an item
ot.delete(
  '/safety-checklist/:id',
  zValidator('param', safetyIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof safetyIdParam>;
    const result = await db.$client.prepare(
      `DELETE FROM ot_safety_checklists WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Checklist item not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Anesthesia Logs ──────────────────────────────────────────────────────

const anesthesiaTypeEnum = z.enum([
  'general', 'regional', 'local', 'sedation', 'spinal',
  'epidural', 'nerve_block', 'combined', 'other',
]);

const createAnesthesiaSchema = z.object({
  anesthesia_type: anesthesiaTypeEnum,
  anesthetist_id: z.number().int().positive().optional(),
  start_time: z.string().max(30).optional(),
  end_time: z.string().max(30).optional(),
  airway_method: z.string().max(60).optional(),
  drugs: z.string().max(2000).optional(),
  complications: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

const updateAnesthesiaSchema = z.object({
  anesthesia_type: anesthesiaTypeEnum.optional(),
  anesthetist_id: z.number().int().positive().optional(),
  start_time: z.string().max(30).optional(),
  end_time: z.string().max(30).optional(),
  airway_method: z.string().max(60).optional(),
  drugs: z.string().max(2000).optional(),
  complications: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

const anesthesiaBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const anesthesiaIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/anesthesia — list anesthesia logs
ot.get(
  '/bookings/:booking_id/anesthesia',
  zValidator('param', anesthesiaBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof anesthesiaBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, anesthesia_type, anesthetist_id,
              start_time, end_time, airway_method, drugs, complications,
              notes, created_by, created_at, updated_at
         FROM ot_anesthesia_logs
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY created_at ASC`
    ).bind(tenantId, booking_id).all();
    return c.json({ logs: results });
  },
);

// POST /bookings/:booking_id/anesthesia — create an anesthesia log
ot.post(
  '/bookings/:booking_id/anesthesia',
  zValidator('param', anesthesiaBookingParam),
  zValidator('json', createAnesthesiaSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof anesthesiaBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createAnesthesiaSchema>;

    const booking = await db.$client.prepare(
      `SELECT id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO ot_anesthesia_logs
         (tenant_id, booking_id, anesthesia_type, anesthetist_id,
          start_time, end_time, airway_method, drugs, complications, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, data.anesthesia_type, data.anesthetist_id ?? null,
      data.start_time ?? null, data.end_time ?? null, data.airway_method ?? null,
      data.drugs ?? null, data.complications ?? null, data.notes ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /anesthesia/:id — update an anesthesia log
ot.put(
  '/anesthesia/:id',
  zValidator('param', anesthesiaIdParam),
  zValidator('json', updateAnesthesiaSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof anesthesiaIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateAnesthesiaSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateAnesthesiaSchema>, string> = {
      anesthesia_type: 'anesthesia_type',
      anesthetist_id: 'anesthetist_id',
      start_time: 'start_time',
      end_time: 'end_time',
      airway_method: 'airway_method',
      drugs: 'drugs',
      complications: 'complications',
      notes: 'notes',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_anesthesia_logs SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Anesthesia log not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /anesthesia/:id — remove an anesthesia log
ot.delete(
  '/anesthesia/:id',
  zValidator('param', anesthesiaIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof anesthesiaIdParam>;
    const result = await db.$client.prepare(
      `DELETE FROM ot_anesthesia_logs WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Anesthesia log not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Commission Rules ─────────────────────────────────────────────────────

const commissionRuleTypeEnum = z.enum([
  'fixed_amount', 'percentage_of_surgery', 'percentage_after_discount',
  'package_based', 'department_based', 'doctor_based',
]);

const createCommissionSchema = z.object({
  role: z.string().min(1).max(60),
  rule_type: commissionRuleTypeEnum,
  amount: z.number().nonnegative().max(1000000).default(0),
  percent: z.number().min(0).max(100).default(0),
  procedure_id: z.number().int().positive().optional(),
  department_id: z.number().int().positive().optional(),
  doctor_id: z.number().int().positive().optional(),
  include_emergency_surcharge: z.number().int().min(0).max(1).default(0),
  priority: z.number().int().min(0).max(100).default(0),
});

const updateCommissionSchema = z.object({
  role: z.string().min(1).max(60).optional(),
  rule_type: commissionRuleTypeEnum.optional(),
  amount: z.number().nonnegative().max(1000000).optional(),
  percent: z.number().min(0).max(100).optional(),
  procedure_id: z.number().int().positive().optional(),
  department_id: z.number().int().positive().optional(),
  doctor_id: z.number().int().positive().optional(),
  include_emergency_surcharge: z.number().int().min(0).max(1).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

const commissionIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /commission-rules — list all active rules
ot.get('/commission-rules', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    `SELECT id, tenant_id, role, rule_type, amount, percent,
            procedure_id, department_id, doctor_id,
            include_emergency_surcharge, is_active, priority,
            created_by, created_at, updated_at
       FROM ot_commission_rules
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY priority DESC, role ASC`
  ).bind(tenantId).all();
  return c.json({ rules: results });
});

// POST /commission-rules — create a rule
ot.post(
  '/commission-rules',
  zValidator('json', createCommissionSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json') as z.infer<typeof createCommissionSchema>;

    const result = await db.$client.prepare(
      `INSERT INTO ot_commission_rules
         (tenant_id, role, rule_type, amount, percent,
          procedure_id, department_id, doctor_id,
          include_emergency_surcharge, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, data.role, data.rule_type, data.amount, data.percent,
      data.procedure_id ?? null, data.department_id ?? null, data.doctor_id ?? null,
      data.include_emergency_surcharge, data.priority, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /commission-rules/:id — update a rule
ot.put(
  '/commission-rules/:id',
  zValidator('param', commissionIdParam),
  zValidator('json', updateCommissionSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof commissionIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateCommissionSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateCommissionSchema>, string> = {
      role: 'role',
      rule_type: 'rule_type',
      amount: 'amount',
      percent: 'percent',
      procedure_id: 'procedure_id',
      department_id: 'department_id',
      doctor_id: 'doctor_id',
      include_emergency_surcharge: 'include_emergency_surcharge',
      priority: 'priority',
      is_active: 'is_active',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_commission_rules SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Commission rule not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /commission-rules/:id — soft-delete
ot.delete(
  '/commission-rules/:id',
  zValidator('param', commissionIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof commissionIdParam>;
    const result = await db.$client.prepare(
      `UPDATE ot_commission_rules SET is_active = 0, updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND is_active = 1`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Commission rule not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Settings ─────────────────────────────────────────────────────────────

const updateSettingsSchema = z.object({
  default_cleaning_minutes: z.number().int().min(0).max(480).optional(),
  default_sterilization_minutes: z.number().int().min(0).max(480).optional(),
  vitals_reminder_minutes: z.number().int().min(1).max(60).optional(),
  emergency_override_allowed: z.number().int().min(0).max(1).optional(),
  hard_block_on_consent: z.number().int().min(0).max(1).optional(),
  hard_block_on_anesthesia_fitness: z.number().int().min(0).max(1).optional(),
  hard_block_on_payment: z.number().int().min(0).max(1).optional(),
  hard_block_on_blood: z.number().int().min(0).max(1).optional(),
  bill_post_requires_review: z.number().int().min(0).max(1).optional(),
  commission_calculation_enabled: z.number().int().min(0).max(1).optional(),
  auto_deduct_stock_on_post: z.number().int().min(0).max(1).optional(),
  offline_draft_enabled: z.number().int().min(0).max(1).optional(),
});

// GET /settings — fetch OT settings (returns defaults if none exist)
ot.get('/settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const settings = await db.$client.prepare(
    `SELECT id, tenant_id, default_cleaning_minutes, default_sterilization_minutes,
            vitals_reminder_minutes, emergency_override_allowed,
            hard_block_on_consent, hard_block_on_anesthesia_fitness,
            hard_block_on_payment, hard_block_on_blood,
            bill_post_requires_review, commission_calculation_enabled,
            auto_deduct_stock_on_post, offline_draft_enabled,
            created_by, created_at, updated_at
       FROM ot_settings WHERE tenant_id = ?`
  ).bind(tenantId).first();
  if (!settings) {
    return c.json({
      settings: {
        default_cleaning_minutes: 30,
        default_sterilization_minutes: 45,
        vitals_reminder_minutes: 5,
        emergency_override_allowed: 1,
        hard_block_on_consent: 1,
        hard_block_on_anesthesia_fitness: 1,
        hard_block_on_payment: 0,
        hard_block_on_blood: 0,
        bill_post_requires_review: 1,
        commission_calculation_enabled: 1,
        auto_deduct_stock_on_post: 1,
        offline_draft_enabled: 0,
      },
    });
  }
  return c.json({ settings });
});

// PUT /settings — upsert OT settings
ot.put(
  '/settings',
  zValidator('json', updateSettingsSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json') as z.infer<typeof updateSettingsSchema>;

    const cols: string[] = ['tenant_id'];
    const vals: unknown[] = [tenantId];
    const map: Record<keyof z.infer<typeof updateSettingsSchema>, string> = {
      default_cleaning_minutes: 'default_cleaning_minutes',
      default_sterilization_minutes: 'default_sterilization_minutes',
      vitals_reminder_minutes: 'vitals_reminder_minutes',
      emergency_override_allowed: 'emergency_override_allowed',
      hard_block_on_consent: 'hard_block_on_consent',
      hard_block_on_anesthesia_fitness: 'hard_block_on_anesthesia_fitness',
      hard_block_on_payment: 'hard_block_on_payment',
      hard_block_on_blood: 'hard_block_on_blood',
      bill_post_requires_review: 'bill_post_requires_review',
      commission_calculation_enabled: 'commission_calculation_enabled',
      auto_deduct_stock_on_post: 'auto_deduct_stock_on_post',
      offline_draft_enabled: 'offline_draft_enabled',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        cols.push(map[k]);
        vals.push(data[k]);
      }
    }
    cols.push('created_by');
    vals.push(userId);

    const placeholders = cols.map(() => '?').join(', ');
    const updateSets = cols
      .filter(c => c !== 'tenant_id' && c !== 'created_by')
      .map(c => `${c} = excluded.${c}`)
      .join(', ');

    await db.$client.prepare(
      `INSERT INTO ot_settings (${cols.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(tenant_id) DO UPDATE SET ${updateSets}, updated_at = datetime('now', '+6 hours')`
    ).bind(...vals).run();
    return c.json({ success: true });
  },
);

// ─── OT Commission Ledger ─────────────────────────────────────────────────────

const commissionRoleEnum = z.enum(['chief_surgeon', 'assistant_surgeon', 'anesthetist', 'anesthetist_assistant']);
const commissionStatusEnum = z.enum(['pending', 'approved', 'paid', 'rejected']);

const createCommissionLedgerSchema = z.object({
  doctor_id: z.number().int().positive(),
  role: commissionRoleEnum,
  gross_amount: z.number().nonnegative(),
  commission_rule: z.string().max(200).optional(),
  commission_percent: z.number().min(0).max(100).default(0),
  commission_amount: z.number().nonnegative().default(0),
  deduction: z.number().nonnegative().default(0),
  net_payable: z.number().nonnegative().optional(),
  ot_bill_id: z.number().int().positive().optional(),
  remarks: z.string().max(500).optional(),
});

const updateCommissionLedgerSchema = z.object({
  status: commissionStatusEnum.optional(),
  deduction: z.number().nonnegative().optional(),
  net_payable: z.number().nonnegative().optional(),
  remarks: z.string().max(500).optional(),
});

const commissionBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const commissionLedgerIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/commissions — list commissions for a booking
ot.get(
  '/bookings/:booking_id/commissions',
  zValidator('param', commissionBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof commissionBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, ot_bill_id, doctor_id, role,
              gross_amount, commission_rule, commission_percent,
              commission_amount, deduction, net_payable, status,
              approved_by, approved_at, paid_at, remarks,
              created_by, created_at, updated_at
         FROM ot_commissions
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY role ASC, doctor_id ASC`
    ).bind(tenantId, booking_id).all();
    return c.json({ commissions: results });
  },
);

// POST /bookings/:booking_id/commissions — create a commission entry
ot.post(
  '/bookings/:booking_id/commissions',
  zValidator('param', commissionBookingParam),
  zValidator('json', createCommissionLedgerSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof commissionBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createCommissionLedgerSchema>;

    const netPayable = data.net_payable ?? (data.commission_amount - data.deduction);

    const result = await db.$client.prepare(
      `INSERT INTO ot_commissions
         (tenant_id, booking_id, ot_bill_id, doctor_id, role,
          gross_amount, commission_rule, commission_percent,
          commission_amount, deduction, net_payable, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, data.ot_bill_id ?? null, data.doctor_id, data.role,
      data.gross_amount, data.commission_rule ?? null, data.commission_percent,
      data.commission_amount, data.deduction, netPayable,
      data.remarks ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /commissions/:id — update status (approve, pay, reject)
ot.put(
  '/commissions/:id',
  zValidator('param', commissionLedgerIdParam),
  zValidator('json', updateCommissionLedgerSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id } = c.req.valid('param') as z.infer<typeof commissionLedgerIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateCommissionLedgerSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      status: 'status',
      deduction: 'deduction',
      net_payable: 'net_payable',
      remarks: 'remarks',
    };
    for (const k of Object.keys(map)) {
      if ((data as Record<string, unknown>)[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push((data as Record<string, unknown>)[k]);
      }
    }
    if (data.status === 'approved') {
      sets.push('approved_by = ?');
      vals.push(userId);
      sets.push("approved_at = datetime('now', '+6 hours')");
    }
    if (data.status === 'paid') {
      sets.push("paid_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_commissions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Commission entry not found' }, 404);
    return c.json({ success: true });
  },
);

// ─── OT Reports ──────────────────────────────────────────────────────────────

import { generateDailyReport, generateFinancialReport, generateInventoryReport, generateUtilizationReport } from '../../lib/ot-reports';

// GET /reports/daily?date=YYYY-MM-DD
ot.get('/reports/daily', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date');
  if (!date) return c.json({ error: 'date query parameter required' }, 400);
  const report = await generateDailyReport(db.$client, tenantId, date);
  return c.json({ report });
});

// GET /reports/financial?from=YYYY-MM-DD&to=YYYY-MM-DD
ot.get('/reports/financial', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ error: 'from and to query parameters required' }, 400);
  const report = await generateFinancialReport(db.$client, tenantId, from, to);
  return c.json({ report });
});

// GET /reports/inventory?from=YYYY-MM-DD&to=YYYY-MM-DD
ot.get('/reports/inventory', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ error: 'from and to query parameters required' }, 400);
  const report = await generateInventoryReport(db.$client, tenantId, from, to);
  return c.json({ report });
});

// GET /reports/utilization?from=YYYY-MM-DD&to=YYYY-MM-DD
ot.get('/reports/utilization', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ error: 'from and to query parameters required' }, 400);
  const report = await generateUtilizationReport(db.$client, tenantId, from, to);
  return c.json({ report });
});

// ─── OT Booking Endpoints ────────────────────────────────────────────────────

// ─── Pre-OT Clearance ────────────────────────────────────────────────────────

const clearanceCheckTypeEnum = z.enum([
  'surgery_consent', 'anesthesia_consent', 'anesthesia_fitness',
  'payment_clearance', 'blood_arrangement', 'lab_reports', 'imaging',
  'npo_fasting', 'allergy_check', 'site_marking', 'ot_pack_ready',
  'icu_bed_reserved',
]);
const clearanceStatusEnum = z.enum(['pending', 'done', 'rejected', 'waived', 'not_required']);

const createClearanceSchema = z.object({
  check_type: clearanceCheckTypeEnum,
  is_required: z.number().int().min(0).max(1).default(1),
  remarks: z.string().max(500).optional(),
  attachment_url: z.string().max(1000).optional(),
});

const updateClearanceSchema = z.object({
  status: clearanceStatusEnum.optional(),
  is_required: z.number().int().min(0).max(1).optional(),
  remarks: z.string().max(500).optional(),
  attachment_url: z.string().max(1000).optional(),
});

const clearanceBookingParam = z.object({ booking_id: z.coerce.number().int().positive() });
const clearanceIdParam = z.object({ id: z.coerce.number().int().positive() });

// GET /bookings/:booking_id/clearance — list all checks for a booking
ot.get(
  '/bookings/:booking_id/clearance',
  zValidator('param', clearanceBookingParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof clearanceBookingParam>;
    const { results } = await db.$client.prepare(
      `SELECT id, tenant_id, booking_id, check_type, is_required, status,
              verified_by, verified_at, remarks, attachment_url,
              created_by, created_at, updated_at
         FROM ot_clearance_checks
        WHERE tenant_id = ? AND booking_id = ?
        ORDER BY check_type ASC`
    ).bind(tenantId, booking_id).all();
    return c.json({ checks: results });
  },
);

// POST /bookings/:booking_id/clearance — create one check
ot.post(
  '/bookings/:booking_id/clearance',
  zValidator('param', clearanceBookingParam),
  zValidator('json', createClearanceSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { booking_id } = c.req.valid('param') as z.infer<typeof clearanceBookingParam>;
    const data = c.req.valid('json') as z.infer<typeof createClearanceSchema>;

    // Booking must exist for this tenant
    const booking = await db.$client.prepare(
      `SELECT id FROM ot_bookings WHERE tenant_id = ? AND id = ? AND is_active = 1`
    ).bind(tenantId, booking_id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const result = await db.$client.prepare(
      `INSERT INTO ot_clearance_checks
         (tenant_id, booking_id, check_type, is_required, remarks, attachment_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, booking_id, data.check_type, data.is_required,
      data.remarks ?? null, data.attachment_url ?? null, userId,
    ).first<{ id: number }>();
    return c.json({ success: true, id: result?.id }, 201);
  },
);

// PUT /clearance/:id — update a check (verify, reject, waive, remark)
ot.put(
  '/clearance/:id',
  zValidator('param', clearanceIdParam),
  zValidator('json', updateClearanceSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { id } = c.req.valid('param') as z.infer<typeof clearanceIdParam>;
    const data = c.req.valid('json') as z.infer<typeof updateClearanceSchema>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof z.infer<typeof updateClearanceSchema>, string> = {
      status: 'status',
      is_required: 'is_required',
      remarks: 'remarks',
      attachment_url: 'attachment_url',
    };
    for (const k of Object.keys(map) as (keyof typeof map)[]) {
      if (data[k] !== undefined) {
        sets.push(`${map[k]} = ?`);
        vals.push(data[k]);
      }
    }
    // status changes auto-stamp verified_by/verified_at when moving to done/rejected/waived
    if (data.status !== undefined && (data.status === 'done' || data.status === 'rejected' || data.status === 'waived')) {
      sets.push('verified_by = ?');
      vals.push(userId);
      sets.push("verified_at = datetime('now', '+6 hours')");
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    const result = await db.$client.prepare(
      `UPDATE ot_clearance_checks SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...vals).first<{ id: number }>();
    if (!result) return c.json({ error: 'Clearance check not found' }, 404);
    return c.json({ success: true });
  },
);

// DELETE /clearance/:id — remove a check
ot.delete(
  '/clearance/:id',
  zValidator('param', clearanceIdParam),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { id } = c.req.valid('param') as z.infer<typeof clearanceIdParam>;
    const result = await db.$client.prepare(
      `DELETE FROM ot_clearance_checks WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ id: number }>();
    if (!result) return c.json({ error: 'Clearance check not found' }, 404);
    return c.json({ success: true });
  },
);

// GET /bookings — list OT bookings with team members (N+1 optimized)
ot.get('/bookings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const dateFilter = c.req.query('date') || new Date().toISOString().split('T')[0];
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM ot_bookings WHERE tenant_id = ? AND is_active = 1 AND booked_for_date >= ?'
  ).bind(tenantId, dateFilter).first<{ total: number }>();

  const { results: bookings } = await db.$client.prepare(`
    SELECT b.*, p.name as patient_name, p.patient_code, p.gender, p.date_of_birth, p.mobile
    FROM ot_bookings b
    LEFT JOIN patients p ON b.patient_id = p.id AND b.tenant_id = p.tenant_id
    WHERE b.tenant_id = ? AND b.is_active = 1 AND b.booked_for_date >= ?
    ORDER BY b.booked_for_date DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, dateFilter, limit, offset).all();

  // Fetch all team members in one query (avoid N+1)
  if (bookings.length > 0) {
    const bookingIds = bookings.map((b: any) => b.id);
    const placeholders = bookingIds.map(() => '?').join(', ');

    const { results: allTeam } = await db.$client.prepare(`
      SELECT t.*, s.name as staff_name, s.position as designation
      FROM ot_team_members t
      LEFT JOIN staff s ON t.staff_id = s.id AND t.tenant_id = s.tenant_id
      WHERE t.tenant_id = ? AND t.booking_id IN (${placeholders})
    `).bind(tenantId, ...bookingIds).all();

    // Group team by booking
    const teamByBooking = new Map<number, any[]>();
    (allTeam as any[]).forEach(m => {
      if (!teamByBooking.has(m.booking_id)) teamByBooking.set(m.booking_id, []);
      teamByBooking.get(m.booking_id)!.push(m);
    });

    // Attach to bookings
    const enriched = bookings.map((b: any) => {
      const members = teamByBooking.get(b.id) || [];
      return {
        ...b,
        surgeons: members.filter((m: any) => m.role_type === 'surgeon'),
        anesthetist: members.find((m: any) => m.role_type === 'anesthetist') || null,
        anesthetist_assistant: members.find((m: any) => m.role_type === 'anesthetist_assistant') || null,
        scrub_nurse: members.find((m: any) => m.role_type === 'scrub_nurse') || null,
        ot_assistants: members.filter((m: any) => m.role_type === 'ot_assistant'),
      };
    });

    return c.json({ bookings: enriched, total: countResult?.total || 0, limit, offset });
  }

  return c.json({ bookings: [], total: 0, limit, offset });
});

// GET /stats — OT dashboard KPIs
ot.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = new Date().toISOString().split('T')[0];

  // Replaced Promise.all() with db.$client.batch() for OT stats.
  // Why: Promise.all() sends 4 separate HTTP network requests to Cloudflare D1.
  const batchResults = await db.$client.batch([
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM ot_bookings WHERE tenant_id = ? AND is_active = 1 AND booked_for_date = ?`)
      .bind(tenantId, today),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM ot_bookings WHERE tenant_id = ? AND is_active = 1 AND booked_for_date >= ? AND booked_for_date <= ?`)
      .bind(tenantId, today, new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM ot_bookings WHERE tenant_id = ? AND is_active = 1 AND booked_for_date >= ?`)
      .bind(tenantId, today),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM ot_bookings WHERE tenant_id = ? AND is_active = 0`)
      .bind(tenantId),
  ]);

  const todayCount = batchResults[0]?.results?.[0] as { cnt: number } | undefined;
  const weekCount = batchResults[1]?.results?.[0] as { cnt: number } | undefined;
  const totalActive = batchResults[2]?.results?.[0] as { cnt: number } | undefined;
  const cancelled = batchResults[3]?.results?.[0] as { cnt: number } | undefined;

  return c.json({
    today_bookings: todayCount?.cnt ?? 0,
    this_week: weekCount?.cnt ?? 0,
    total_upcoming: totalActive?.cnt ?? 0,
    cancelled: cancelled?.cnt ?? 0,
  });
});

// GET /bookings/:id — single booking with team, checklist, summary
ot.get('/bookings/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));

  const booking = await db.$client.prepare(`
    SELECT b.*, p.name as patient_name, p.patient_code, p.gender, p.date_of_birth, p.mobile
    FROM ot_bookings b
    LEFT JOIN patients p ON b.patient_id = p.id AND b.tenant_id = p.tenant_id
    WHERE b.id = ? AND b.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!booking) throw new HTTPException(404, { message: 'OT booking not found' });

  // Replaced Promise.all() with db.$client.batch() for OT booking details.
  // Why: Promise.all() sends 6 separate HTTP network requests to Cloudflare D1.
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT t.*, s.name as staff_name, s.position as designation
      FROM ot_team_members t
      LEFT JOIN staff s ON t.staff_id = s.id AND t.tenant_id = s.tenant_id
      WHERE t.booking_id = ? AND t.tenant_id = ?
      ORDER BY CASE t.role_type
        WHEN 'surgeon' THEN 1 WHEN 'anesthetist' THEN 2
        WHEN 'anesthetist_assistant' THEN 3 WHEN 'scrub_nurse' THEN 4
        WHEN 'ot_assistant' THEN 5 END
    `).bind(id, tenantId),
    db.$client.prepare('SELECT * FROM ot_checklist_items WHERE booking_id = ? AND tenant_id = ? ORDER BY id')
      .bind(id, tenantId),
    db.$client.prepare('SELECT * FROM ot_summaries WHERE booking_id = ? AND tenant_id = ?')
      .bind(id, tenantId),
    db.$client.prepare('SELECT * FROM ot_surgery_notes WHERE booking_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1')
      .bind(id, tenantId),
    db.$client.prepare('SELECT * FROM ot_anesthesia_records WHERE booking_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1')
      .bind(id, tenantId),
    db.$client.prepare('SELECT * FROM ot_status_events WHERE booking_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 25')
      .bind(id, tenantId),
  ]);

  const teamResult = batchResults[0]?.results || [];
  const checklistResult = batchResults[1]?.results || [];
  const summary = batchResults[2]?.results?.[0] as any | undefined;
  const surgeryNote = batchResults[3]?.results?.[0] as any | undefined;
  const anesthesiaRecord = batchResults[4]?.results?.[0] as any | undefined;
  const statusEvents = batchResults[5]?.results || [];

  return c.json({
    booking: {
      ...booking,
      team: teamResult,
      checklist: checklistResult,
      summary: summary || null,
      surgery_note: surgeryNote || null,
      anesthesia_record: anesthesiaRecord || null,
      status_events: statusEvents,
    },
  });
});

// POST /bookings — create OT booking with team (atomic with compensation)
ot.post('/bookings', zValidator('json', createBookingSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') as string | undefined;
  // P0-26: gate OT booking creation on the local permission catalog.
  if (!hasPermission(role, 'ot.booking.create')) {
    throw new HTTPException(403, { message: 'Not authorized to create OT bookings' });
  }
  const data = c.req.valid('json');

  // Verify patient exists
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(400, { message: 'Patient not found' });

  // Create booking
  const bookingResult = await db.$client.prepare(`
    INSERT INTO ot_bookings (
      tenant_id, patient_id, visit_id, booked_for_date,
      is_emergency, surgery_type, diagnosis, procedure_type, anesthesia_type,
      remarks, consent_form_path, pac_form_path, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id || null,
    data.booked_for_date, data.is_emergency ?? 0, data.surgery_type || null,
    data.diagnosis || null, data.procedure_type || null,
    data.anesthesia_type || null, data.remarks || null,
    data.consent_form_path || null, data.pac_form_path || null,
    userId
  ).run();

  const bookingId = bookingResult.meta.last_row_id as number;

  // Add team members if provided (batch for performance)
  if (data.team && data.team.length > 0) {
    try {
      const stmts = data.team.map(m =>
        db.$client.prepare(`
          INSERT INTO ot_team_members (tenant_id, booking_id, patient_id, visit_id, staff_id, role_type, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(tenantId, bookingId, data.patient_id, data.visit_id || null, m.staff_id, m.role_type, userId)
      );
      await db.$client.batch(stmts);
    } catch {
      // Compensate: delete the booking
      await db.$client.prepare('DELETE FROM ot_bookings WHERE id = ? AND tenant_id = ?').bind(bookingId, tenantId).run();
      throw new HTTPException(500, { message: 'Failed to add team members' });
    }
  }

  return c.json({ id: bookingId, message: 'OT booking created' }, 201);
});

// PUT /bookings/:id — update booking + team
ot.put('/bookings/:id', zValidator('json', updateBookingSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, patient_id, visit_id FROM ot_bookings WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; patient_id: number; visit_id: number | null }>();
  if (!existing) throw new HTTPException(404, { message: 'OT booking not found' });

  const batchOps: D1PreparedStatement[] = [];

  // Build update sets
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const fields: Record<string, keyof typeof data> = {
    booked_for_date: 'booked_for_date', surgery_type: 'surgery_type',
    diagnosis: 'diagnosis', procedure_type: 'procedure_type',
    anesthesia_type: 'anesthesia_type', remarks: 'remarks',
    consent_form_path: 'consent_form_path', pac_form_path: 'pac_form_path',
  };

  for (const [col, key] of Object.entries(fields)) {
    if (data[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(data[key] as string | null);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    batchOps.push(
      db.$client.prepare(`UPDATE ot_bookings SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals)
    );
  }

  // Update team if provided (delete + re-insert)
  if (data.team && data.team.length > 0) {
    batchOps.push(
      db.$client.prepare('DELETE FROM ot_team_members WHERE booking_id = ? AND tenant_id = ?').bind(id, tenantId)
    );
    data.team.forEach(m => {
      batchOps.push(
        db.$client.prepare(`
          INSERT INTO ot_team_members (tenant_id, booking_id, patient_id, visit_id, staff_id, role_type, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(tenantId, id, existing.patient_id, existing.visit_id || null, m.staff_id, m.role_type, userId)
      );
    });
  }

  if (batchOps.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  await db.$client.batch(batchOps);
  return c.json({ success: true, message: 'OT booking updated' });
});

// PUT /bookings/:id/cancel — cancel booking
ot.put('/bookings/:id/cancel', zValidator('json', cancelBookingSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') as string | undefined;
  // P0-26: gate OT booking cancellation on the local permission catalog.
  if (!hasPermission(role, 'ot.booking.cancel')) {
    throw new HTTPException(403, { message: 'Not authorized to cancel OT bookings' });
  }
  const id = parseInt(c.req.param('id'));
  const { cancellation_remarks } = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, is_active FROM ot_bookings WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; is_active: number }>();

  if (!existing) throw new HTTPException(404, { message: 'OT booking not found' });
  if (existing.is_active === 0) throw new HTTPException(400, { message: 'Booking already cancelled' });

  await applyOtBookingCancellationBillingGuard(db, tenantId, id);

  await db.$client.prepare(`
    UPDATE ot_bookings SET
      is_active = 0, cancelled_by = ?, cancelled_on = datetime('now', '+6 hours'),
      cancellation_remarks = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, cancellation_remarks || null, id, tenantId).run();

  return c.json({ success: true, message: 'OT booking cancelled' });
});

// PUT /bookings/:id/status — update OT workflow status and append event
ot.put('/bookings/:id/status', zValidator('json', operationStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const { status, remarks } = c.req.valid('json');

  const existing = await getActiveBooking(db, tenantId, id);
  const fromStatus = existing.operation_status || 'scheduled';
  const now = new Date().toISOString();
  if (status === 'cancelled') {
    await applyOtBookingCancellationBillingGuard(db, tenantId, id);
  }

  const sets = ['operation_status = ?', 'updated_at = ?'];
  const params: (string | number | null)[] = [status, now];
  if (status === 'in_progress') {
    sets.push('operation_started_at = COALESCE(operation_started_at, ?)');
    params.push(now);
  }
  if (status === 'completed') {
    sets.push('operation_completed_at = COALESCE(operation_completed_at, ?)');
    params.push(now);
  }
  if (status === 'cancelled') {
    sets.push('is_active = 0', 'cancelled_by = ?', 'cancelled_on = ?', 'cancellation_remarks = COALESCE(?, cancellation_remarks)');
    params.push(userId, now, remarks || null);
  }
  params.push(id, tenantId);

  await db.$client.batch([
    db.$client.prepare(`UPDATE ot_bookings SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params),
    db.$client.prepare(`
      INSERT INTO ot_status_events (tenant_id, booking_id, from_status, to_status, remarks, performed_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, id, fromStatus, status, remarks || null, userId, now),
  ]);

  if (shouldTriggerOtConsumptionOnStatus(fromStatus, status)) {
    void triggerOtCompletionConsumption(c.env.DB, {
      tenantId,
      userId,
      booking: existing,
      remarks: remarks || 'OT case completed',
    }).catch((error) => {
      console.error('OT consumption trigger failed', { tenantId, bookingId: id, error });
    });
  }

  return c.json({ success: true, message: 'OT status updated', from_status: fromStatus, to_status: status });
});

// GET /bookings/:bookingId/surgery-note
ot.get('/bookings/:bookingId/surgery-note', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  await getActiveBooking(db, tenantId, bookingId);

  const note = await db.$client.prepare(
    'SELECT * FROM ot_surgery_notes WHERE booking_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(bookingId, tenantId).first();

  if (!note) throw new HTTPException(404, { message: 'Surgery note not found' });
  return c.json({ surgery_note: note });
});

// POST /bookings/:bookingId/surgery-note — create structured surgery note
ot.post('/bookings/:bookingId/surgery-note', zValidator('json', surgeryNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  const data = c.req.valid('json');
  const booking = await getActiveBooking(db, tenantId, bookingId);
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO ot_surgery_notes (
      tenant_id, booking_id, patient_id, visit_id, operative_procedure, operative_findings,
      complications, implants_or_specimens, blood_loss_ml, incision_start_time, closure_time,
      surgeon_staff_id, note_status, finalized_by, finalized_on, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    bookingId,
    booking.patient_id,
    booking.visit_id || null,
    data.operative_procedure,
    data.operative_findings || null,
    data.complications || null,
    data.implants_or_specimens || null,
    data.blood_loss_ml ?? null,
    data.incision_start_time || null,
    data.closure_time || null,
    data.surgeon_staff_id || null,
    data.note_status,
    data.note_status === 'final' ? userId : null,
    data.note_status === 'final' ? now : null,
    userId,
    now,
    now,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Surgery note created' }, 201);
});

// PUT /bookings/:bookingId/surgery-note — update latest structured surgery note
ot.put('/bookings/:bookingId/surgery-note', zValidator('json', updateSurgeryNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  const data = c.req.valid('json');
  await getActiveBooking(db, tenantId, bookingId);

  const existing = await db.$client.prepare(
    'SELECT id FROM ot_surgery_notes WHERE booking_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(bookingId, tenantId).first<{ id: number }>();
  if (!existing) throw new HTTPException(404, { message: 'Surgery note not found' });

  const fields: Record<string, unknown> = {
    operative_procedure: data.operative_procedure,
    operative_findings: data.operative_findings,
    complications: data.complications,
    implants_or_specimens: data.implants_or_specimens,
    blood_loss_ml: data.blood_loss_ml,
    incision_start_time: data.incision_start_time,
    closure_time: data.closure_time,
    surgeon_staff_id: data.surgeon_staff_id,
    note_status: data.note_status,
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      params.push(value as string | number | null);
    }
  }
  if (data.note_status === 'final') {
    sets.push('finalized_by = ?', 'finalized_on = ?');
    params.push(userId, new Date().toISOString());
  }
  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), existing.id, tenantId);
  await db.$client.prepare(`UPDATE ot_surgery_notes SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Surgery note updated' });
});

// GET /bookings/:bookingId/anesthesia-record
ot.get('/bookings/:bookingId/anesthesia-record', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  await getActiveBooking(db, tenantId, bookingId);

  const record = await db.$client.prepare(
    'SELECT * FROM ot_anesthesia_records WHERE booking_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(bookingId, tenantId).first();

  if (!record) throw new HTTPException(404, { message: 'Anesthesia record not found' });
  return c.json({ anesthesia_record: record });
});

// POST /bookings/:bookingId/anesthesia-record — create structured anesthesia record
ot.post('/bookings/:bookingId/anesthesia-record', zValidator('json', anesthesiaRecordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  const data = c.req.valid('json');
  const booking = await getActiveBooking(db, tenantId, bookingId);
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO ot_anesthesia_records (
      tenant_id, booking_id, patient_id, visit_id, anesthetist_staff_id, anesthesia_type,
      asa_class, airway_plan, pre_anesthesia_assessment, intraoperative_vitals_json,
      medications_json, fluids_json, complications, recovery_notes, record_status,
      finalized_by, finalized_on, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    bookingId,
    booking.patient_id,
    booking.visit_id || null,
    data.anesthetist_staff_id || null,
    data.anesthesia_type || null,
    data.asa_class || null,
    data.airway_plan || null,
    data.pre_anesthesia_assessment || null,
    data.intraoperative_vitals ? JSON.stringify(data.intraoperative_vitals) : null,
    data.medications ? JSON.stringify(data.medications) : null,
    data.fluids ? JSON.stringify(data.fluids) : null,
    data.complications || null,
    data.recovery_notes || null,
    data.record_status,
    data.record_status === 'final' ? userId : null,
    data.record_status === 'final' ? now : null,
    userId,
    now,
    now,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Anesthesia record created' }, 201);
});

// PUT /bookings/:bookingId/anesthesia-record — update latest anesthesia record
ot.put('/bookings/:bookingId/anesthesia-record', zValidator('json', updateAnesthesiaRecordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  const data = c.req.valid('json');
  await getActiveBooking(db, tenantId, bookingId);

  const existing = await db.$client.prepare(
    'SELECT id FROM ot_anesthesia_records WHERE booking_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(bookingId, tenantId).first<{ id: number }>();
  if (!existing) throw new HTTPException(404, { message: 'Anesthesia record not found' });

  const fields: Record<string, unknown> = {
    anesthetist_staff_id: data.anesthetist_staff_id,
    anesthesia_type: data.anesthesia_type,
    asa_class: data.asa_class,
    airway_plan: data.airway_plan,
    pre_anesthesia_assessment: data.pre_anesthesia_assessment,
    intraoperative_vitals_json: data.intraoperative_vitals ? JSON.stringify(data.intraoperative_vitals) : undefined,
    medications_json: data.medications ? JSON.stringify(data.medications) : undefined,
    fluids_json: data.fluids ? JSON.stringify(data.fluids) : undefined,
    complications: data.complications,
    recovery_notes: data.recovery_notes,
    record_status: data.record_status,
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      params.push(value as string | number | null);
    }
  }
  if (data.record_status === 'final') {
    sets.push('finalized_by = ?', 'finalized_on = ?');
    params.push(userId, new Date().toISOString());
  }
  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), existing.id, tenantId);
  await db.$client.prepare(`UPDATE ot_anesthesia_records SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Anesthesia record updated' });
});

// ─── Team Endpoints ──────────────────────────────────────────────────────────

// GET /bookings/:bookingId/team
ot.get('/bookings/:bookingId/team', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bookingId = parseInt(c.req.param('bookingId'));

  const { results } = await db.$client.prepare(`
    SELECT t.*, s.name as staff_name, s.position as designation
    FROM ot_team_members t
    LEFT JOIN staff s ON t.staff_id = s.id AND t.tenant_id = s.tenant_id
    WHERE t.booking_id = ? AND t.tenant_id = ?
    ORDER BY CASE t.role_type
      WHEN 'surgeon' THEN 1 WHEN 'anesthetist' THEN 2
      WHEN 'anesthetist_assistant' THEN 3 WHEN 'scrub_nurse' THEN 4
      WHEN 'ot_assistant' THEN 5 END
  `).bind(bookingId, tenantId).all();

  return c.json({ team: results, total: results.length });
});

// POST /team — add team member
ot.post('/team', zValidator('json', createTeamMemberSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const booking = await db.$client.prepare(
    'SELECT id FROM ot_bookings WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(data.booking_id, tenantId).first();
  if (!booking) throw new HTTPException(400, { message: 'OT booking not found' });

  const staff = await db.$client.prepare(
    'SELECT id FROM staff WHERE id = ? AND tenant_id = ?'
  ).bind(data.staff_id, tenantId).first();
  if (!staff) throw new HTTPException(400, { message: 'Staff member not found' });

  const result = await db.$client.prepare(`
    INSERT INTO ot_team_members (tenant_id, booking_id, patient_id, visit_id, staff_id, role_type, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.booking_id, data.patient_id, data.visit_id || null, data.staff_id, data.role_type, userId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Team member added' }, 201);
});

// DELETE /team/:id — remove team member
ot.delete('/team/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT id FROM ot_team_members WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Team member not found' });

  await db.$client.prepare('DELETE FROM ot_team_members WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ success: true, message: 'Team member removed' });
});

// ─── Checklist Endpoints ─────────────────────────────────────────────────────

// GET /bookings/:bookingId/checklist
ot.get('/bookings/:bookingId/checklist', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bookingId = parseInt(c.req.param('bookingId'));

  const { results } = await db.$client.prepare(
    'SELECT * FROM ot_checklist_items WHERE booking_id = ? AND tenant_id = ? ORDER BY id'
  ).bind(bookingId, tenantId).all();

  return c.json({ checklist: results, total: results.length });
});

// POST /checklist — add checklist item
ot.post('/checklist', zValidator('json', createChecklistSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const booking = await db.$client.prepare(
    'SELECT id FROM ot_bookings WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(data.booking_id, tenantId).first();
  if (!booking) throw new HTTPException(400, { message: 'OT booking not found' });

  const result = await db.$client.prepare(`
    INSERT INTO ot_checklist_items (tenant_id, booking_id, item_name, item_value, item_details, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.booking_id, data.item_name, data.item_value ? 1 : 0, data.item_details || null, userId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Checklist item added' }, 201);
});

// PUT /checklist/:id — update checklist item
ot.put('/checklist/:id', zValidator('json', updateChecklistSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM ot_checklist_items WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Checklist item not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (data.item_name !== undefined) { sets.push('item_name = ?'); vals.push(data.item_name); }
  if (data.item_value !== undefined) { sets.push('item_value = ?'); vals.push(data.item_value ? 1 : 0); }
  if (data.item_details !== undefined) { sets.push('item_details = ?'); vals.push(data.item_details); }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE ot_checklist_items SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ success: true, message: 'Checklist item updated' });
});

// PUT /bookings/:bookingId/checklist/bulk — bulk update
ot.put('/bookings/:bookingId/checklist/bulk', zValidator('json', bulkChecklistSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const bookingId = parseInt(c.req.param('bookingId'));
  const { items } = c.req.valid('json');

  const booking = await db.$client.prepare(
    'SELECT id FROM ot_bookings WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(bookingId, tenantId).first();
  if (!booking) throw new HTTPException(400, { message: 'OT booking not found' });

  const stmts: D1PreparedStatement[] = [
    db.$client.prepare('DELETE FROM ot_checklist_items WHERE booking_id = ? AND tenant_id = ?').bind(bookingId, tenantId),
  ];

  items.forEach(item => {
    stmts.push(
      db.$client.prepare(`
        INSERT INTO ot_checklist_items (tenant_id, booking_id, item_name, item_value, item_details, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(tenantId, bookingId, item.item_name, item.item_value ? 1 : 0, item.item_details || null, userId)
    );
  });

  await db.$client.batch(stmts);
  return c.json({ success: true, message: 'Checklist updated' });
});

// ─── Summary Endpoints ───────────────────────────────────────────────────────

// GET /bookings/:bookingId/summary
ot.get('/bookings/:bookingId/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bookingId = parseInt(c.req.param('bookingId'));

  const summary = await db.$client.prepare(
    'SELECT * FROM ot_summaries WHERE booking_id = ? AND tenant_id = ?'
  ).bind(bookingId, tenantId).first();

  if (!summary) throw new HTTPException(404, { message: 'OT summary not found' });
  return c.json({ summary });
});

// POST /summary — create OT summary
ot.post('/summary', zValidator('json', createSummarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const booking = await db.$client.prepare(
    'SELECT id, patient_id, visit_id FROM ot_bookings WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(data.booking_id, tenantId).first<OtBillingBooking>();
  if (!booking) throw new HTTPException(400, { message: 'OT booking not found' });

  const existingSummary = await db.$client.prepare(
    'SELECT id FROM ot_summaries WHERE booking_id = ? AND tenant_id = ?'
  ).bind(data.booking_id, tenantId).first();
  if (existingSummary) throw new HTTPException(400, { message: 'Summary already exists for this booking' });

  const charge = toPositiveAmount(data.ot_charge);
  if (charge > 0) {
    if (!booking.visit_id) {
      throw new HTTPException(400, { message: 'A visit is required before adding an OT billing charge.' });
    }
    await assertAccountingPeriodOpen(c.env.DB, tenantId, getTodayGMT6(), 'OT summary billing charge creation');
  }

  const result = await db.$client.prepare(`
    INSERT INTO ot_summaries (
      tenant_id, booking_id, team_member_id, pre_op_diagnosis, post_op_diagnosis,
      anesthesia, ot_charge, ot_description, category, nurse_signature, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.booking_id, data.team_member_id || null,
    data.pre_op_diagnosis || null, data.post_op_diagnosis || null,
    data.anesthesia || null, data.ot_charge,
    data.ot_description || null, data.category || null,
    data.nurse_signature || null, userId
  ).run();

  const summaryId = result.meta.last_row_id as number;
  if (charge > 0) {
    await syncOtSummaryPendingBilling(db, tenantId, userId, {
      id: summaryId,
      booking_id: data.booking_id,
      patient_id: booking.patient_id,
      visit_id: booking.visit_id,
      ot_charge: charge,
      ot_description: data.ot_description || null,
      category: data.category || null,
    });
  }

  return c.json({ id: summaryId, message: 'OT summary created' }, 201);
});

// PUT /summary/:id — update OT summary
ot.put('/summary/:id', zValidator('json', updateSummarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await loadOtSummaryBillingContext(db, tenantId, id);

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const fields: Record<string, keyof typeof data> = {
    team_member_id: 'team_member_id', pre_op_diagnosis: 'pre_op_diagnosis',
    post_op_diagnosis: 'post_op_diagnosis', anesthesia: 'anesthesia',
    ot_charge: 'ot_charge', ot_description: 'ot_description',
    category: 'category', nurse_signature: 'nurse_signature',
  };

  for (const [col, key] of Object.entries(fields)) {
    if (data[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(data[key] as string | number | null);
    }
  }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  const nextSummary: OtSummaryBillingContext = {
    ...existing,
    ot_charge: data.ot_charge !== undefined ? data.ot_charge : existing.ot_charge,
    ot_description: data.ot_description !== undefined ? data.ot_description || null : existing.ot_description,
    category: data.category !== undefined ? data.category || null : existing.category,
  };
  const chargeTouched = data.ot_charge !== undefined || data.ot_description !== undefined || data.category !== undefined;
  if (chargeTouched) {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, getTodayGMT6(), 'OT summary billing charge update');
    await assertOtSummaryChargeCanChange(db, tenantId, id, toPositiveAmount(nextSummary.ot_charge));
  }

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE ot_summaries SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  if (chargeTouched) {
    await syncOtSummaryPendingBilling(db, tenantId, userId, nextSummary);
  }

  return c.json({ success: true, message: 'OT summary updated' });
});

export default ot;

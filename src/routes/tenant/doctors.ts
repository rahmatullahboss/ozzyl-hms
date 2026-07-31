import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { createDoctorSchema, updateDoctorSchema } from '../../schemas/doctor';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId, requireSpecificRole } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { normalizeConsultationFee } from '../../lib/doctor-fees';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getNextSequence } from '../../lib/sequence';
import { enforcePrescriptionDrugSafety } from '../../lib/prescription-safety';
import { buildPrescriptionUsageStatsStatements } from '../../lib/prescription-usage-stats';
import { ensurePendingPrescriptionLabOrder } from '../../lib/prescription-lab-orders';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import { sha256Hex, stableClinicalJson } from '../../lib/clinical-signatures';
import {
  acquireConsultationCompletionClaim,
  markConsultationCompletionCompleted,
  markConsultationCompletionFailed,
  reconcileSignedConsultationCompletionClaim,
  updateConsultationCompletionClaim,
  type OwnedConsultationCompletionClaim,
} from '../../lib/consultation-completion-claims';
import { calculateVisitValidity, getValiditySettings, upsertValiditySetting } from '../../lib/follow-up-validity';
import {
  appointmentStatusForDoctorAction,
  deriveDoctorDashboardStatus,
  doctorQueueSortRank,
  formatAppointmentTypeLabel,
  formatBillingStatusLabel,
  isAllowedDoctorDashboardAction,
  queueStatusForDoctorAction,
  resolveDoctorDashboardDate,
  summarizeDoctorQueue,
} from '../../lib/doctor-dashboard';
import { fetchDoctorLabInboxSummary } from '../../lib/doctor-lab-inbox';
import { getUploadObjectForResponse } from '../../lib/upload-objects';
import { sendEmail, EmailTemplates } from '../../lib/email';
import { buildInvitePath, buildAbsoluteInviteUrl } from '../../lib/staff-invite';
import { requirePermission } from '../../middleware/rbac';
import {
  buildPractitionerRouteContext,
  createRoutePractitioner,
  practitionerIdentityChanged,
  runPractitionerProjectionCompatibility,
  updateRoutePractitioner,
  type LegacyDoctorPractitionerSnapshot,
} from '../../lib/canonical/practitioner-route-integration';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';
import {
  buildAppointmentRouteContext,
  fulfilRouteAppointment,
  rescheduleRouteAppointment,
  resolveAppointmentRouteEncounter,
  resolveAppointmentRoutePractitioner,
  transitionRouteAppointment,
} from '../../lib/canonical/appointment-route-integration';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import {
  prepareRouteEncounterCompletionBatch,
  resolveEncounterRouteContext,
} from '../../lib/canonical/encounter-route-integration';


type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const doctorRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DOCTOR_STATS_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;

function doctorPractitionerSnapshot(input: {
  name: unknown;
  specialty: unknown;
  department: unknown;
  bmdcRegNo: unknown;
  userId: unknown;
  isActive: unknown;
}): LegacyDoctorPractitionerSnapshot {
  return {
    name: String(input.name ?? '').trim(),
    specialty: typeof input.specialty === 'string' && input.specialty.trim() ? input.specialty.trim() : null,
    department: typeof input.department === 'string' && input.department.trim() ? input.department.trim() : null,
    bmdcRegNo: typeof input.bmdcRegNo === 'string' && input.bmdcRegNo.trim() ? input.bmdcRegNo.trim() : null,
    userId: input.userId == null ? null : Number(input.userId),
    isActive: Number(input.isActive ?? 0) === 1 || input.isActive === true,
  };
}

function routeIdempotencyKey(request: { header(name: string): string | undefined }): string | null {
  const value = request.header('Idempotency-Key')?.trim();
  return value || null;
}

async function createDoctorSourceKey(tenantId: string, suppliedKey: string | null): Promise<string> {
  if (suppliedKey) {
    return createDeterministicSourceId('docsrc', tenantId, 'doctor_route', suppliedKey);
  }
  return `docsrc_${crypto.randomUUID().replace(/-/g, '')}`;
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonthStart(date: string, offset: number): string {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const dashboardStatusSchema = z.object({
  status: z.enum(['waiting', 'in_progress', 'completed', 'no_show']),
});

const dashboardReassignSchema = z.object({
  doctorId: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

const completeConsultationRxItemSchema = z.object({
  medicine_name: z.string().trim().min(1),
  dosage: z.string().trim().optional(),
  frequency: z.string().trim().optional(),
  duration: z.string().trim().optional(),
  instructions: z.string().trim().optional(),
  sort_order: z.number().int().min(0).optional(),
  quantity: z.number().int().positive().optional(),
  medicineId: z.number().int().positive().optional(),
});

const codedDiagnosisSchema = z.discriminatedUnion('system', [
  z.object({
    system: z.literal('ICD-10'),
    code: z.string().trim().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Invalid ICD-10 code'),
    description: z.string().trim().min(1).max(500),
  }),
  z.object({
    system: z.literal('ICD-11'),
    code: z.string().trim().min(2).max(20),
    description: z.string().trim().min(1).max(500),
  }),
]);

const completeConsultationSchema = z.object({
  soap: z.object({
    chiefComplaint: z.string().trim().optional(),
    subjective: z.string().trim().optional(),
    objective: z.string().trim().optional(),
    assessment: z.string().trim().optional(),
    plan: z.string().trim().optional(),
  }).optional(),
  prescription: z.object({
    id: z.number().int().positive().optional(),
    status: z.enum(['draft', 'final']).default('final'),
    chiefComplaint: z.string().trim().optional(),
    diagnosis: z.string().trim().optional(),
    examinationNotes: z.string().trim().optional(),
    advice: z.string().trim().optional(),
    labTests: z.array(z.string().trim().min(1)).optional(),
    followUpDate: z.string().trim().optional(),
    safetyCheckId: z.number().int().positive().optional(),
    safetyOverrideReason: z.string().trim().max(500).optional(),
    items: z.array(completeConsultationRxItemSchema).optional(),
  }).optional(),
  codedDiagnosis: codedDiagnosisSchema.optional(),
  orderSummary: z.object({ count: z.number().int().nonnegative().optional() }).optional(),
  completionIdempotencyKey: z.string().trim().min(12).max(200).regex(/^[A-Za-z0-9:._-]+$/).optional(),
  completeVisit: z.boolean().default(true),
});

type CompleteConsultationInput = z.infer<typeof completeConsultationSchema>;
type CompleteConsultationPrescription = NonNullable<CompleteConsultationInput['prescription']>;

function isSchemaDrift(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (table|column)|has no column named/i.test(message);
}

async function safeAll<T = Record<string, unknown>>(
  statement: D1PreparedStatement,
): Promise<T[]> {
  try {
    const { results } = await statement.all<T>();
    return results ?? [];
  } catch (error) {
    if (isSchemaDrift(error)) {
      console.warn('[schema-drift] safeAll:', error instanceof Error ? error.message : error);
      return [];
    }
    throw error;
  }
}

async function safeFirst<T = Record<string, unknown>>(
  statement: D1PreparedStatement,
): Promise<T | null> {
  try {
    return await statement.first<T>();
  } catch (error) {
    if (isSchemaDrift(error)) {
      console.warn('[schema-drift] safeFirst:', error instanceof Error ? error.message : error);
      return null;
    }
    throw error;
  }
}

async function safeRun(statement: D1PreparedStatement): Promise<void> {
  try {
    await statement.run();
  } catch (error) {
    if (!isSchemaDrift(error)) throw error;
    console.warn('[schema-drift] safeRun:', error instanceof Error ? error.message : error);
  }
}

function shiftIsoDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hasAnyText(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(String(value ?? '').trim()));
}

function hasSoapContent(soap?: CompleteConsultationInput['soap']): boolean {
  if (!soap) return false;
  return hasAnyText([soap.chiefComplaint, soap.subjective, soap.objective, soap.assessment, soap.plan]);
}

function normalizeRxItems(items?: CompleteConsultationPrescription['items']) {
  return (items ?? [])
    .filter((item) => item.medicine_name.trim())
    .map((item, index) => ({
      medicine_name: item.medicine_name.trim(),
      dosage: item.dosage || undefined,
      frequency: item.frequency || undefined,
      duration: item.duration || undefined,
      instructions: item.instructions || undefined,
      sort_order: item.sort_order ?? index,
      quantity: item.quantity,
      medicineId: item.medicineId,
    }));
}

function hasPrescriptionContent(prescription?: CompleteConsultationInput['prescription']): prescription is CompleteConsultationPrescription {
  if (!prescription) return false;
  return normalizeRxItems(prescription.items).length > 0 || hasAnyText([
    prescription.chiefComplaint,
    prescription.diagnosis,
    prescription.examinationNotes,
    prescription.advice,
    prescription.followUpDate,
    ...(prescription.labTests ?? []),
  ]);
}

/**
 * Trigger hospital site re-render when doctors change.
 * Non-blocking — runs in background via waitUntil.
 */
async function triggerSiteReRender(
  c: { env: Env; executionCtx: ExecutionContext },
  tenantId: string
): Promise<void> {
  const db = getDb(c.env.DB);
  try {
    // Only re-render if the tenant has a website enabled
    const config = await db.$client.prepare(
      `SELECT wc.is_enabled, t.subdomain FROM website_config wc
       JOIN tenants t ON wc.tenant_id = t.id
       WHERE wc.tenant_id = ? AND wc.is_enabled = 1`
    ).bind(tenantId).first<{ is_enabled: number; subdomain: string }>();
    if (!config?.subdomain) return;

    const { preRenderTenantSite } = await import('../public/prerender');
    c.executionCtx.waitUntil(
      preRenderTenantSite(c.env.DB, c.env.KV, Number(tenantId), config.subdomain, c.env)
    );
  } catch {
    // Non-fatal
  }
}

// GET /api/doctors/photo/:key — proxy doctor photo from R2
doctorRoutes.get('/photo/:key', async (c) => {
  const tenantId = requireTenantId(c);
  const key = decodeURIComponent(c.req.param('key'));

  if (!key.startsWith(`doctors/${tenantId}/`)) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }

  try {
    const obj = await getUploadObjectForResponse(c.env, key);
    if (!obj) throw new HTTPException(404, { message: 'Photo not found' });

    const headers = new Headers();
    headers.set('Content-Type', obj.contentType ?? 'image/webp');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(obj.body, { headers });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch photo' });
  }
});

// POST /api/doctors/upload-photo — upload doctor photo to R2
doctorRoutes.post('/upload-photo', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireSpecificRole(c, 'hospital_admin', 'doctor');

  const formData = await c.req.formData();
  const file = formData.get('photo');

  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'No photo file provided' });
  }

  const photoFile = file as unknown as File;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(photoFile.type)) {
    throw new HTTPException(400, { message: 'Invalid file type. Allowed: JPG, PNG, WebP' });
  }

  // Max 5MB
  if (photoFile.size > 5 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'File too large. Maximum 5MB.' });
  }

  const key = `doctors/${tenantId}/${crypto.randomUUID()}.webp`;

  try {
    await c.env.UPLOADS.put(key, photoFile.stream(), {
      httpMetadata: { contentType: photoFile.type },
      customMetadata: { tenantId, uploadedBy: String(userId) },
    });

    return c.json({
      message: 'Photo uploaded',
      photoKey: key,
      photoUrl: `/api/doctors/photo/${encodeURIComponent(key)}`
    });
  } catch (error) {
    console.error('Photo upload failed:', error);
    throw new HTTPException(500, { message: 'Failed to upload photo' });
  }
});

// GET /api/doctors — list all active doctors
doctorRoutes.get('/', async (c) => {
  requireSpecificRole(c, 'hospital_admin', 'doctor', 'reception', 'nurse', 'md');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search');
  const specialty = c.req.query('specialty');
  const department = c.req.query('department');
  const isActive = c.req.query('is_active');
  const serviceType = c.req.query('service_type');
  const incentiveType = c.req.query('incentive_type');

  try {
    let query = `SELECT id, name, specialty, mobile_number, consultation_fee, ipd_round_fee, is_active, department, email, bmdc_reg_no, user_id, created_at
                 FROM doctors WHERE tenant_id = ?`;
    const params: (string | number)[] = [tenantId!];

    if (isActive !== 'all') {
      query += ` AND is_active = 1`;
    }
    if (specialty) {
      query += ` AND specialty = ?`;
      params.push(specialty);
    }
    if (department) {
      query += ` AND department = ?`;
      params.push(department);
    }
    if (search) {
      query += ` AND (name LIKE ? OR mobile_number LIKE ? OR bmdc_reg_no LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (serviceType || incentiveType) {
      query += ` AND EXISTS (
        SELECT 1
        FROM doctor_commission_rules r
        WHERE r.tenant_id = doctors.tenant_id
          AND r.doctor_id = doctors.id
          AND r.is_active = 1`;
      if (serviceType) {
        query += ` AND r.service_type = ?`;
        params.push(serviceType);
      }
      if (incentiveType) {
        query += ` AND r.incentive_type = ?`;
        params.push(incentiveType);
      }
      query += `)`;
    }
    query += ` ORDER BY display_order ASC, name ASC`;

    const doctors = await db.$client.prepare(query).bind(...params).all();
    return c.json({ doctors: doctors.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch doctors' });
  }
});

// GET /api/doctors/dashboard — doctor's own dashboard data
doctorRoutes.get('/dashboard', async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId || !userId) throw new HTTPException(401, { message: 'Auth required' });

  try {
    const doctor = await resolveDoctorForDashboard(c, tenantId, userId);
    if (!doctor) return c.json({ error: 'No doctor profile linked' }, 404);

    return await buildDashboard(c, doctor, tenantId);
  } catch (error) {
    console.error('Doctor dashboard error:', error);
    throw new HTTPException(500, { message: 'Failed to load doctor dashboard' });
  }
});

// GET /api/doctors/dashboard/ipd-rounds — today's ward-round view for the signed-in doctor.
// Returns every active admission assigned to this doctor with last/today round status.
doctorRoutes.get('/dashboard/ipd-rounds', async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId || !userId) throw new HTTPException(401, { message: 'Auth required' });

  const doctor = await resolveDoctorForDashboard(c, tenantId, userId);
  if (!doctor) return c.json({ error: 'No doctor profile linked' }, 404);

  const today = resolveDoctorDashboardDate(c.req.query('date'));
  const doctorId = Number(doctor.id);

  const rows = await safeAll<Record<string, unknown>>(db.$client.prepare(`
    SELECT
      a.id AS id,
      a.id AS admission_id,
      a.patient_id,
      p.name AS patient_name,
      p.patient_code,
      a.admission_no,
      a.status,
      a.diagnosis,
      a.provisional_diagnosis,
      a.admission_date,
      b.ward_name AS ward,
      b.bed_number,
      (SELECT MAX(r2.rounded_at) FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active') AS last_round_at,
      (SELECT r2.clinical_status FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS last_round_clinical_status,
      (SELECT r2.patient_condition FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS last_patient_condition,
      (SELECT r2.id FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
           AND substr(r2.rounded_at, 1, 10) = ?
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS today_round_id,
      (SELECT r2.clinical_status FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
           AND substr(r2.rounded_at, 1, 10) = ?
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS today_round_clinical_status,
      (SELECT r2.provisional_item_id FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
           AND substr(r2.rounded_at, 1, 10) = ?
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS today_round_provisional_id,
      (SELECT TRIM(
          COALESCE(CAST(vt.blood_pressure_systolic AS TEXT) || '/' || CAST(vt.blood_pressure_diastolic AS TEXT), '') ||
          CASE WHEN vt.spo2 IS NOT NULL THEN ' · SpO2 ' || vt.spo2 ELSE '' END ||
          CASE WHEN vt.temperature IS NOT NULL THEN ' · T ' || vt.temperature ELSE '' END
        ) FROM clinical_vitals vt
        WHERE vt.patient_id = a.patient_id AND vt.tenant_id = a.tenant_id AND COALESCE(vt.is_active, 1) = 1
        ORDER BY COALESCE(vt.taken_at, vt.created_at) DESC, vt.id DESC LIMIT 1) AS latest_vitals_summary,
      (SELECT COUNT(*) FROM lab_orders lo
         WHERE lo.patient_id = a.patient_id AND lo.tenant_id = a.tenant_id
           AND COALESCE(lo.status, 'pending') NOT IN ('completed', 'cancelled')) AS pending_lab_count,
      (SELECT COUNT(*) FROM radiology_requisitions rr
         WHERE rr.patient_id = a.patient_id AND rr.tenant_id = a.tenant_id
           AND COALESCE(rr.order_status, 'pending') NOT IN ('reported', 'cancelled')) AS pending_imaging_count
    FROM admissions a
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.doctor_id = ? AND a.status NOT IN ('discharged', 'cancelled')
    ORDER BY a.admission_date DESC, a.id DESC
  `).bind(today, today, today, tenantId, doctorId));

  const summary = {
    total_inpatients: rows.length,
    not_rounded_today: rows.filter((r) => r.today_round_id == null).length,
    pending_clinical_note: rows.filter((r) => {
      const cs = r.today_round_clinical_status as string | null;
      return r.today_round_id != null && (cs == null || cs === 'billing_only');
    }).length,
    deteriorating: rows.filter((r) => (r.last_patient_condition as string | null) === 'deteriorating').length,
    critical: rows.filter((r) => (r.last_patient_condition as string | null) === 'critical').length,
  };

  return c.json({ date: today, summary, inpatients: rows });
});

async function resolveDoctorForDashboard(
  c: AppContext,
  tenantId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const db = getDb(c.env.DB);
  const direct = await safeFirst(db.$client.prepare(
    `SELECT id, name, specialty, department, qualifications, consultation_fee
     FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`
  ).bind(userId, tenantId));
  if (direct) return direct;

  const viaStaff = await safeFirst(db.$client.prepare(`
    SELECT d.id, d.name, d.specialty, d.department, d.qualifications, d.consultation_fee
    FROM staff s
    JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
    WHERE s.user_id = ? AND s.tenant_id = ? AND d.is_active = 1
    LIMIT 1
  `).bind(userId, tenantId));
  return viaStaff ?? null;
}

// Helper to build dashboard response
async function buildDashboard(c: AppContext, doctor: Record<string, unknown>, tenantId: string) {
  const db = getDb(c.env.DB);
  const doctorId = doctor.id as number;
  const today = resolveDoctorDashboardDate(c.req.query('date'));

  const enhancedQueue = await safeAll<Record<string, unknown>>(db.$client.prepare(`
    SELECT
      a.id,
      a.id AS appointment_id,
      a.patient_id,
      a.token_no,
      a.appt_time,
      a.visit_type,
      a.appointment_type,
      a.status AS appointment_status,
      qe.status AS queue_status,
      qe.priority AS queue_priority,
      qe.called_at AS queue_called_at,
      a.billing_status,
      a.final_fee,
      a.discount_amount,
      a.created_by,
      creator.name AS created_by_name,
      a.chief_complaint,
      a.notes,
      p.name AS patient_name,
      p.patient_code,
      p.mobile AS patient_mobile,
      p.age AS patient_age,
      p.date_of_birth,
      p.gender,
      v.id AS visit_id,
      v.status AS visit_status,
      qe.id AS queue_entry_id,
      (SELECT COUNT(*) FROM patient_allergies pa WHERE pa.patient_id = a.patient_id AND pa.tenant_id = a.tenant_id) AS allergy_count,
      (SELECT GROUP_CONCAT(pa.allergen, ', ') FROM patient_allergies pa WHERE pa.patient_id = a.patient_id AND pa.tenant_id = a.tenant_id AND COALESCE(pa.is_active, 1) = 1 ORDER BY CASE pa.severity WHEN 'life_threatening' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END LIMIT 4) AS allergy_summary,
      (SELECT COUNT(*) FROM clinical_vitals vt WHERE vt.patient_id = a.patient_id AND vt.tenant_id = a.tenant_id AND COALESCE(vt.is_active, 1) = 1) AS vitals_count,
      (SELECT
          TRIM(
            COALESCE(CAST(vt.blood_pressure_systolic AS TEXT) || '/' || CAST(vt.blood_pressure_diastolic AS TEXT), '') ||
            CASE WHEN vt.pulse IS NOT NULL THEN ' · P ' || vt.pulse ELSE '' END ||
            CASE WHEN vt.temperature IS NOT NULL THEN ' · T ' || vt.temperature ELSE '' END ||
            CASE WHEN vt.spo2 IS NOT NULL THEN ' · SpO2 ' || vt.spo2 ELSE '' END ||
            CASE WHEN vt.weight IS NOT NULL THEN ' · Wt ' || vt.weight || 'kg' ELSE '' END
          )
        FROM clinical_vitals vt
        WHERE vt.patient_id = a.patient_id AND vt.tenant_id = a.tenant_id AND COALESCE(vt.is_active, 1) = 1
        ORDER BY COALESCE(vt.taken_at, vt.created_at) DESC, vt.id DESC LIMIT 1) AS latest_vitals_summary,
      (SELECT COUNT(*) FROM prescriptions pr WHERE pr.patient_id = a.patient_id AND pr.tenant_id = a.tenant_id AND COALESCE(pr.status, '') NOT IN ('cancelled', 'stopped')) AS active_rx_count,
      (SELECT GROUP_CONCAT(pam.medication_name, ', ') FROM patient_active_medications pam WHERE pam.patient_id = a.patient_id AND pam.tenant_id = a.tenant_id AND pam.status = 'active' AND COALESCE(pam.is_active, 1) = 1 ORDER BY COALESCE(pam.start_date, pam.created_at) DESC LIMIT 4) AS current_medicine_summary,
      (SELECT COUNT(*) FROM lab_orders lo WHERE lo.patient_id = a.patient_id AND lo.tenant_id = a.tenant_id) AS lab_count,
      (SELECT COUNT(*) FROM lab_orders lo WHERE lo.patient_id = a.patient_id AND lo.tenant_id = a.tenant_id AND COALESCE(lo.status, 'pending') NOT IN ('completed', 'cancelled')) AS pending_lab_count,
      (SELECT COUNT(*) FROM radiology_requisitions rr WHERE rr.patient_id = a.patient_id AND rr.tenant_id = a.tenant_id AND COALESCE(rr.order_status, 'pending') NOT IN ('reported', 'cancelled')) AS pending_imaging_count,
      (SELECT COUNT(*) FROM FormSOAP fs WHERE fs.PatientId = a.patient_id AND fs.tenant_id = a.tenant_id) AS soap_count,
      (SELECT MAX(COALESCE(v2.visit_date, date(v2.created_at))) FROM visits v2 WHERE v2.patient_id = a.patient_id AND v2.tenant_id = a.tenant_id) AS last_visit_at,
      (SELECT COALESCE(NULLIF(pr2.diagnosis, ''), NULLIF(pr2.chief_complaint, '')) FROM prescriptions pr2 WHERE pr2.patient_id = a.patient_id AND pr2.tenant_id = a.tenant_id ORDER BY pr2.created_at DESC, pr2.id DESC LIMIT 1) AS last_diagnosis,
      (SELECT ltc.name || CASE WHEN loi.result IS NOT NULL AND loi.result != '' THEN ': ' || loi.result ELSE '' END || CASE WHEN ltc.unit IS NOT NULL AND ltc.unit != '' THEN ' ' || ltc.unit ELSE '' END
       FROM lab_order_items loi
       JOIN lab_orders lo2 ON lo2.id = loi.lab_order_id AND lo2.tenant_id = loi.tenant_id
       LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
       WHERE lo2.patient_id = a.patient_id AND lo2.tenant_id = a.tenant_id
         AND COALESCE(loi.abnormal_flag, '') NOT IN ('', 'normal', 'N')
       ORDER BY COALESCE(loi.completed_at, lo2.created_at, lo2.order_date) DESC, loi.id DESC LIMIT 1) AS latest_abnormal_lab_summary
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN visits v ON v.appointment_id = a.id AND v.tenant_id = a.tenant_id
    LEFT JOIN queue_entries qe ON qe.appointment_id = a.id AND qe.tenant_id = a.tenant_id
    LEFT JOIN users creator ON creator.id = a.created_by AND creator.tenant_id = a.tenant_id
    WHERE a.doctor_id = ? AND a.tenant_id = ? AND a.appt_date = ?
      AND COALESCE(a.billing_status, 'no_charge') IN ('paid', 'due_approved', 'no_charge')
      AND a.status NOT IN ('cancelled')
    ORDER BY
      CASE
        WHEN qe.status IN ('serving', 'called') THEN 0
        WHEN a.visit_type = 'emergency' THEN 1
        WHEN qe.priority = 'urgent' THEN 2
        ELSE 3
      END,
      a.token_no ASC, a.appt_time ASC, a.id ASC
  `).bind(doctorId, tenantId, today));

  const baseQueue = enhancedQueue.length > 0 ? enhancedQueue : await safeAll<Record<string, unknown>>(db.$client.prepare(`
    SELECT a.id, a.id AS appointment_id, a.patient_id, a.token_no, a.appt_time, a.visit_type, a.status AS appointment_status,
           a.status AS queue_status, a.billing_status, a.chief_complaint, a.notes,
           a.appointment_type, a.final_fee, a.discount_amount, a.created_by,
           p.name AS patient_name, p.patient_code, p.mobile AS patient_mobile, p.age AS patient_age, p.date_of_birth, p.gender
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    WHERE a.doctor_id = ? AND a.tenant_id = ? AND a.appt_date = ?
      AND COALESCE(a.billing_status, 'no_charge') IN ('paid', 'due_approved', 'no_charge')
      AND a.status NOT IN ('cancelled')
    ORDER BY a.token_no ASC, a.appt_time ASC, a.id ASC
  `).bind(doctorId, tenantId, today));

  const settings = await getValiditySettings(c.env.DB, tenantId);

  const queue = (baseQueue as Array<Record<string, unknown>>).map((item): Record<string, unknown> & { status: ReturnType<typeof deriveDoctorDashboardStatus> } => {
    const priorVisitDate = typeof item.last_visit_at === 'string' && item.last_visit_at
      ? item.last_visit_at.slice(0, 10)
      : ((item.appt_date as string) ?? today);
    const validity = calculateVisitValidity(
      (item.appointment_type ?? item.visit_type) as string | null,
      priorVisitDate,
      today,
      settings.follow_up_valid_days,
      settings.report_show_valid_days,
    );
    return {
      ...item,
      status: deriveDoctorDashboardStatus(
        item.appointment_status as string | null,
        item.queue_status as string | null,
      ),
      appointment_type_label: formatAppointmentTypeLabel((item.appointment_type ?? item.visit_type) as string | null),
      billing_status_label: formatBillingStatusLabel(item.billing_status as string | null),
      validity_badge: validity.badge,
      days_elapsed: validity.days_elapsed,
    };
  }).sort((a, b) => {
    const rankDiff = doctorQueueSortRank({
      status: a.status,
      visit_type: a.visit_type as string | null,
      queue_priority: a.queue_priority as string | null,
    }) - doctorQueueSortRank({
      status: b.status,
      visit_type: b.visit_type as string | null,
      queue_priority: b.queue_priority as string | null,
    });
    if (rankDiff !== 0) return rankDiff;
    const tokenDiff = Number(a['token_no'] ?? 0) - Number(b['token_no'] ?? 0);
    if (tokenDiff !== 0) return tokenDiff;
    return Number(a['id'] ?? 0) - Number(b['id'] ?? 0);
  });

  const kpiBase = summarizeDoctorQueue(queue);

  const yesterday = shiftIsoDate(today, -1);
  const yesterdayRow = await safeFirst<{ cnt: number }>(db.$client.prepare(
    `SELECT COUNT(*) AS cnt FROM appointments WHERE doctor_id = ? AND tenant_id = ? AND appt_date = ?`
  ).bind(doctorId, tenantId, yesterday));

  // Visit types breakdown
  const visitTypes = await safeAll(db.$client.prepare(`
    SELECT visit_type, COUNT(*) AS count FROM appointments
    WHERE doctor_id = ? AND tenant_id = ? AND appt_date = ?
    GROUP BY visit_type
  `).bind(doctorId, tenantId, today));

  // Recent prescriptions
  const recentRx = await safeAll(db.$client.prepare(`
    SELECT p.id, p.rx_no, p.created_at, p.status,
           pt.name AS patient_name, pt.patient_code
    FROM prescriptions p
    LEFT JOIN patients pt ON p.patient_id = pt.id AND pt.tenant_id = p.tenant_id
    WHERE p.doctor_id = ? AND p.tenant_id = ?
    ORDER BY p.created_at DESC LIMIT 5
  `).bind(doctorId, tenantId));

  // Upcoming follow-ups (next 7 days)
  const weekLater = shiftIsoDate(today, 7);
  const followUps = await safeAll(db.$client.prepare(`
    SELECT p.id AS rx_id, p.follow_up_date,
           pt.name AS patient_name, pt.patient_code, pt.mobile AS mobile
    FROM prescriptions p
    LEFT JOIN patients pt ON p.patient_id = pt.id AND pt.tenant_id = p.tenant_id
    WHERE p.doctor_id = ? AND p.tenant_id = ?
      AND p.follow_up_date >= ? AND p.follow_up_date <= ?
    ORDER BY p.follow_up_date ASC LIMIT 10
  `).bind(doctorId, tenantId, today, weekLater));

  const availableDoctors = await safeAll(db.$client.prepare(`
    SELECT id, name, specialty, department
    FROM doctors
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY display_order ASC, name ASC
  `).bind(tenantId));

  const pendingLabOrders = await safeAll(db.$client.prepare(`
    SELECT lo.id, 'lab' AS type, lo.order_no, lo.order_date AS ordered_at,
           p.name AS patient_name, p.patient_code, COALESCE(lo.status, 'pending') AS status,
           lo.billing_status, lo.bill_id, b.invoice_no
    FROM lab_orders lo
    LEFT JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
    LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = lo.tenant_id
    WHERE lo.tenant_id = ? AND lo.ordered_by = ? AND COALESCE(lo.status, 'pending') NOT IN ('completed', 'cancelled')
    ORDER BY lo.order_date DESC, lo.id DESC
    LIMIT 8
  `).bind(tenantId, requireUserId(c)));

  const pendingImagingOrders = await safeAll(db.$client.prepare(`
    SELECT rr.id, 'imaging' AS type, COALESCE(rr.accession_no, CAST(rr.id AS TEXT)) AS order_no,
           COALESCE(rr.imaging_date, rr.created_at) AS ordered_at,
           p.name AS patient_name, p.patient_code, COALESCE(rr.order_status, 'pending') AS status,
           rr.billing_status, rr.bill_id, b.invoice_no
    FROM radiology_requisitions rr
    LEFT JOIN patients p ON p.id = rr.patient_id AND p.tenant_id = rr.tenant_id
    LEFT JOIN bills b ON b.id = rr.bill_id AND b.tenant_id = rr.tenant_id
    WHERE rr.tenant_id = ? AND CAST(rr.created_by AS TEXT) = ? AND COALESCE(rr.order_status, 'pending') NOT IN ('reported', 'cancelled')
    ORDER BY COALESCE(rr.imaging_date, rr.created_at) DESC, rr.id DESC
    LIMIT 8
  `).bind(tenantId, String(requireUserId(c))));

  const inpatients = await safeAll(db.$client.prepare(`
    SELECT
      a.id, a.patient_id, p.name AS patient_name, p.patient_code, a.admission_no,
      b.ward_name AS ward, b.bed_number, a.admission_date, a.diagnosis, a.status,
      (SELECT MAX(r2.rounded_at) FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active') AS last_round_at,
      (SELECT r2.clinical_status FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS last_round_status,
      (SELECT r2.id FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
           AND substr(r2.rounded_at, 1, 10) = ?
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS today_round_id,
      (SELECT r2.clinical_status FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
           AND substr(r2.rounded_at, 1, 10) = ?
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS today_round_clinical_status,
      (SELECT r2.patient_condition FROM ipd_doctor_rounds r2
         WHERE r2.tenant_id = a.tenant_id AND r2.admission_id = a.id AND r2.status = 'active'
         ORDER BY r2.rounded_at DESC, r2.id DESC LIMIT 1) AS last_patient_condition,
      (SELECT COUNT(*) FROM lab_orders lo
         WHERE lo.patient_id = a.patient_id AND lo.tenant_id = a.tenant_id
           AND COALESCE(lo.status, 'pending') NOT IN ('completed', 'cancelled')) AS pending_lab_count,
      (SELECT COUNT(*) FROM radiology_requisitions rr
         WHERE rr.patient_id = a.patient_id AND rr.tenant_id = a.tenant_id
           AND COALESCE(rr.order_status, 'pending') NOT IN ('reported', 'cancelled')) AS pending_imaging_count,
      (SELECT COUNT(*) FROM patient_allergies pa
         WHERE pa.patient_id = a.patient_id AND pa.tenant_id = a.tenant_id
           AND COALESCE(pa.is_active, 1) = 1) AS allergy_count,
      (SELECT TRIM(
          COALESCE(CAST(vt.blood_pressure_systolic AS TEXT) || '/' || CAST(vt.blood_pressure_diastolic AS TEXT), '') ||
          CASE WHEN vt.spo2 IS NOT NULL THEN ' · SpO2 ' || vt.spo2 ELSE '' END ||
          CASE WHEN vt.temperature IS NOT NULL THEN ' · T ' || vt.temperature ELSE '' END
        ) FROM clinical_vitals vt
        WHERE vt.patient_id = a.patient_id AND vt.tenant_id = a.tenant_id AND COALESCE(vt.is_active, 1) = 1
        ORDER BY COALESCE(vt.taken_at, vt.created_at) DESC, vt.id DESC LIMIT 1) AS latest_vitals_summary
    FROM admissions a
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.doctor_id = ? AND a.status NOT IN ('discharged', 'cancelled')
    ORDER BY a.admission_date DESC, a.id DESC
    LIMIT 8
  `).bind(today, today, tenantId, doctorId));

  const decoratedInpatients = (inpatients as Array<Record<string, unknown>>).map((row) => {
    const today_round_id = row.today_round_id as number | null;
    const today_round_clinical_status = (row.today_round_clinical_status as string | null) ?? null;
    const last_round_at = (row.last_round_at as string | null) ?? null;
    return {
      ...row,
      today_round_id,
      today_round_clinical_status,
      not_rounded_today: today_round_id == null,
      needs_round_note:
        today_round_id == null
        || today_round_clinical_status === 'billing_only',
      last_round_at,
      last_round_status: (row.last_round_status as string | null) ?? null,
    };
  });

  const labInbox = await fetchDoctorLabInboxSummary(
    c.env.DB,
    tenantId,
    doctorId,
    String(requireUserId(c)),
  ).catch(() => ({
    total_reports: 0,
    pending: 0,
    abnormal: 0,
    critical: 0,
    needs_review: 0,
  }));

  return c.json({
    doctor,
    today,
    kpi: { ...kpiBase, yesterday: yesterdayRow?.cnt ?? 0 },
    queue,
    visitTypes,
    recentRx,
    followUps,
    availableDoctors,
    pendingOrders: [...pendingLabOrders, ...pendingImagingOrders].slice(0, 10),
    inpatients: decoratedInpatients,
    labInbox,
  });
}

async function saveConsultationSoap(
  c: AppContext,
  tenantId: string,
  userId: string,
  patientId: number,
  visitId: number | null,
  soap?: CompleteConsultationInput['soap'],
  completionClaimId?: number,
  resumeCompletionClaim = false,
) {
  if (!hasSoapContent(soap)) return null;
  const db = getDb(c.env.DB);

  if (completionClaimId && resumeCompletionClaim) {
    const existing = await db.$client.prepare(`
      SELECT SOAPId
      FROM FormSOAP
      WHERE tenant_id = ? AND completion_claim_id = ?
      LIMIT 1
    `).bind(tenantId, completionClaimId).first<{ SOAPId: number }>();
    if (existing?.SOAPId) {
      await db.$client.prepare(`
        UPDATE FormSOAP
        SET PatientId = ?, EncounterId = ?, ChiefComplaint = ?, Subjective = ?,
            Objective = ?, Assessment = ?, Plan = ?, CreatedById = ?
        WHERE SOAPId = ? AND tenant_id = ? AND completion_claim_id = ?
      `).bind(
        patientId,
        visitId,
        soap?.chiefComplaint ?? null,
        soap?.subjective ?? null,
        soap?.objective ?? null,
        soap?.assessment ?? null,
        soap?.plan ?? null,
        userId,
        existing.SOAPId,
        tenantId,
        completionClaimId,
      ).run();
      return { id: existing.SOAPId, replayed: true };
    }
  }

  const result = await db.$client.prepare(`
    INSERT INTO FormSOAP (
      tenant_id, PatientId, EncounterId,
      ChiefComplaint, Subjective, Objective, Assessment, Plan,
      CreatedById, completion_claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    patientId,
    visitId ?? null,
    soap?.chiefComplaint ?? null,
    soap?.subjective ?? null,
    soap?.objective ?? null,
    soap?.assessment ?? null,
    soap?.plan ?? null,
    userId,
    completionClaimId ?? null,
  ).run();

  let soapId = Number(result.meta.last_row_id ?? 0);
  if (completionClaimId) {
    const confirmed = await db.$client.prepare(`
      SELECT SOAPId
      FROM FormSOAP
      WHERE tenant_id = ? AND completion_claim_id = ?
      LIMIT 1
    `).bind(tenantId, completionClaimId).first<{ SOAPId: number }>();
    soapId = Number(confirmed?.SOAPId ?? soapId);
  }
  if (!soapId) throw new HTTPException(500, { message: 'SOAP note creation could not be confirmed' });

  return { id: soapId, replayed: false };
}

async function saveConsultationCodedDiagnosis(
  c: AppContext,
  tenantId: string,
  userId: string,
  patientId: number,
  visitId: number | null,
  codedDiagnosis?: CompleteConsultationInput['codedDiagnosis'],
  completionClaimId?: number,
  resumeCompletionClaim = false,
) {
  if (!codedDiagnosis) return null;
  const db = getDb(c.env.DB);
  if (!visitId) {
    throw new HTTPException(409, { message: 'A patient visit is required before attaching a coded diagnosis' });
  }
  const visit = await db.$client.prepare(`
    SELECT id
    FROM visits
    WHERE id = ? AND tenant_id = ? AND patient_id = ?
    LIMIT 1
  `).bind(visitId, tenantId, patientId).first<{ id: number }>();
  if (!visit) {
    throw new HTTPException(409, { message: 'The appointment visit does not belong to this patient' });
  }

  let canonical: {
    system: 'ICD-10' | 'ICD-11';
    catalogId: number | null;
    code: string;
    description: string;
  };

  if (codedDiagnosis.system === 'ICD-10') {
    const catalog = await db.$client.prepare(`
      SELECT ICD10ID, ICD10Code, DiseaseName
      FROM ICD10Diseases
      WHERE ICD10Code = ? AND IsActive = 1
      LIMIT 1
    `).bind(codedDiagnosis.code).first<{
      ICD10ID: number;
      ICD10Code: string;
      DiseaseName: string;
    }>();
    if (!catalog) {
      throw new HTTPException(400, { message: 'Unknown or inactive ICD-10 code' });
    }
    canonical = {
      system: 'ICD-10',
      catalogId: Number(catalog.ICD10ID),
      code: String(catalog.ICD10Code),
      description: String(catalog.DiseaseName),
    };
  } else {
    const catalog = await db.$client.prepare(`
      SELECT id, code, title
      FROM catalog_icd11_mms
      WHERE code = ? AND is_active = 1
      LIMIT 1
    `).bind(codedDiagnosis.code).first<{
      id: number;
      code: string;
      title: string;
    }>();
    if (!catalog) {
      throw new HTTPException(400, { message: 'Unknown or inactive ICD-11 code' });
    }
    canonical = {
      system: 'ICD-11',
      catalogId: Number(catalog.id),
      code: String(catalog.code),
      description: String(catalog.title),
    };
  }

  if (completionClaimId && resumeCompletionClaim) {
    const existing = await db.$client.prepare(`
      SELECT ClinicalDiagnosisId AS id,
             COALESCE(ICD10Code, icd11_code) AS code,
             DiagnosisType AS diagnosis_type
      FROM ClinicalDiagnosis
      WHERE tenant_id = ? AND completion_claim_id = ? AND IsActive = 1
      LIMIT 1
    `).bind(tenantId, completionClaimId).first<{ id: number; code: string; diagnosis_type: string }>();
    if (existing?.id) {
      if (String(existing.code) !== canonical.code) {
        const updateStatements: D1PreparedStatement[] = [
          db.$client.prepare(`
            UPDATE ClinicalDiagnosis
            SET ICD10ID = ?, ICD10Code = ?, ICD10Description = ?,
                icd11_code = ?, icd11_title = ?, reviewed_by = ?,
                reviewed_at = datetime('now', '+6 hours')
            WHERE ClinicalDiagnosisId = ? AND tenant_id = ? AND completion_claim_id = ?
          `).bind(
            canonical.system === 'ICD-10' ? canonical.catalogId : null,
            canonical.system === 'ICD-10' ? canonical.code : null,
            canonical.system === 'ICD-10' ? canonical.description : null,
            canonical.system === 'ICD-11' ? canonical.code : null,
            canonical.system === 'ICD-11' ? canonical.description : null,
            userId,
            existing.id,
            tenantId,
            completionClaimId,
          ),
        ];
        if (existing.diagnosis_type === 'primary') {
          updateStatements.push(db.$client.prepare(`
            UPDATE visits
            SET icd10_code = ?, icd10_description = ?,
                icd11_code = ?, icd11_description = ?,
                updated_at = datetime('now', '+6 hours')
            WHERE id = ? AND tenant_id = ? AND patient_id = ?
          `).bind(
            canonical.system === 'ICD-10' ? canonical.code : null,
            canonical.system === 'ICD-10' ? canonical.description : null,
            canonical.system === 'ICD-11' ? canonical.code : null,
            canonical.system === 'ICD-11' ? canonical.description : null,
            visitId,
            tenantId,
            patientId,
          ));
        }
        await db.$client.batch(updateStatements);
      }
      return {
        id: Number(existing.id),
        system: canonical.system,
        code: canonical.code,
        description: canonical.description,
        replayed: true,
      };
    }
  }

  const statements: D1PreparedStatement[] = [];
  if (visitId) {
    statements.push(
      canonical.system === 'ICD-10'
        ? db.$client.prepare(`
            UPDATE visits
            SET icd10_code = ?, icd10_description = ?, updated_at = datetime('now', '+6 hours')
            WHERE id = ? AND tenant_id = ? AND patient_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM ClinicalDiagnosis
                WHERE tenant_id = ? AND PatientId = ? AND PatientVisitId = ?
                  AND DiagnosisType = 'primary' AND IsActive = 1
                  AND COALESCE(ICD10Code, icd11_code) <> ?
              )
          `).bind(
            canonical.code, canonical.description, visitId, tenantId, patientId,
            tenantId, patientId, visitId, canonical.code,
          )
        : db.$client.prepare(`
            UPDATE visits
            SET icd11_code = ?, icd11_description = ?, updated_at = datetime('now', '+6 hours')
            WHERE id = ? AND tenant_id = ? AND patient_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM ClinicalDiagnosis
                WHERE tenant_id = ? AND PatientId = ? AND PatientVisitId = ?
                  AND DiagnosisType = 'primary' AND IsActive = 1
                  AND COALESCE(ICD10Code, icd11_code) <> ?
              )
          `).bind(
            canonical.code, canonical.description, visitId, tenantId, patientId,
            tenantId, patientId, visitId, canonical.code,
          ),
    );
  }

  if (completionClaimId) {
    statements.push(db.$client.prepare(`
      UPDATE ClinicalDiagnosis
      SET completion_claim_id = ?
      WHERE ClinicalDiagnosisId = (
        SELECT ClinicalDiagnosisId
        FROM ClinicalDiagnosis
        WHERE tenant_id = ? AND PatientId = ? AND PatientVisitId = ? AND IsActive = 1
          AND COALESCE(ICD10Code, icd11_code) = ?
          AND completion_claim_id IS NULL
        ORDER BY ClinicalDiagnosisId DESC
        LIMIT 1
      )
        AND tenant_id = ? AND completion_claim_id IS NULL
    `).bind(
      completionClaimId,
      tenantId,
      patientId,
      visitId,
      canonical.code,
      tenantId,
    ));
  }

  statements.push(db.$client.prepare(`
    INSERT INTO ClinicalDiagnosis (
      tenant_id, PatientId, PatientVisitId, ICD10ID, ICD10Code,
      ICD10Description, icd11_code, icd11_title, DiagnosisType, Notes,
      CreatedBy, completion_claim_id, source, review_status, reviewed_by, reviewed_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN EXISTS (
        SELECT 1 FROM ClinicalDiagnosis
        WHERE tenant_id = ? AND PatientId = ? AND PatientVisitId = ?
          AND DiagnosisType = 'primary' AND IsActive = 1
      ) THEN 'secondary' ELSE 'primary' END,
      NULL, ?, ?, 'clinician', 'verified', ?, datetime('now', '+6 hours')
    WHERE NOT EXISTS (
      SELECT 1
      FROM ClinicalDiagnosis
      WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
        AND ((? IS NULL AND PatientVisitId IS NULL) OR PatientVisitId = ?)
        AND COALESCE(ICD10Code, icd11_code) = ?
    )
  `).bind(
    tenantId,
    patientId,
    visitId,
    canonical.system === 'ICD-10' ? canonical.catalogId : null,
    canonical.system === 'ICD-10' ? canonical.code : null,
    canonical.system === 'ICD-10' ? canonical.description : null,
    canonical.system === 'ICD-11' ? canonical.code : null,
    canonical.system === 'ICD-11' ? canonical.description : null,
    tenantId,
    patientId,
    visitId,
    userId,
    completionClaimId ?? null,
    userId,
    tenantId,
    patientId,
    visitId,
    visitId,
    canonical.code,
  ));

  await db.$client.batch(statements);
  const persisted = completionClaimId
    ? await db.$client.prepare(`
        SELECT ClinicalDiagnosisId AS id
        FROM ClinicalDiagnosis
        WHERE tenant_id = ? AND completion_claim_id = ? AND IsActive = 1
        LIMIT 1
      `).bind(tenantId, completionClaimId).first<{ id: number }>()
    : await db.$client.prepare(`
        SELECT ClinicalDiagnosisId AS id
        FROM ClinicalDiagnosis
        WHERE tenant_id = ? AND PatientId = ? AND PatientVisitId = ? AND IsActive = 1
          AND COALESCE(ICD10Code, icd11_code) = ?
        ORDER BY ClinicalDiagnosisId DESC
        LIMIT 1
      `).bind(tenantId, patientId, visitId, canonical.code).first<{ id: number }>();
  if (!persisted?.id) {
    throw new HTTPException(500, { message: 'Coded diagnosis creation could not be confirmed' });
  }

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'ClinicalDiagnosis', Number(persisted.id), null, {
    action: 'coded_diagnosis_attached',
    codingSystem: canonical.system,
    visitScoped: Boolean(visitId),
    completionClaimId: completionClaimId ?? null,
  });

  return {
    id: Number(persisted.id),
    system: canonical.system,
    code: canonical.code,
    description: canonical.description,
    replayed: false,
  };
}

async function finalizeConsultationPrescription(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  prescriptionId: number,
  userId: string,
  patientId: number,
  visitId: number | null,
  doctorId: number,
  prescription: CompleteConsultationPrescription,
  items: ReturnType<typeof normalizeRxItems>,
) {
  const statements: D1PreparedStatement[] = [
    db.$client.prepare(`
      UPDATE prescriptions
      SET status = 'final', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'draft'
    `).bind(prescriptionId, tenantId),
    db.$client.prepare(`
      INSERT INTO prescription_versions (prescription_id, version_number, snapshot, edited_by, edit_reason, tenant_id)
      SELECT ?, COALESCE(MAX(version_number), 0) + 1, ?, ?, 'Initial finalization', ?
      FROM prescription_versions WHERE prescription_id = ?
    `).bind(
      prescriptionId,
      JSON.stringify({ ...prescription, items }),
      userId,
      tenantId,
      prescriptionId,
    ),
    ...items.map((item) =>
      db.$client.prepare(`
        INSERT OR IGNORE INTO patient_active_medications
          (patient_id, medication_name, dosage, frequency, source, prescribed_by, status, tenant_id)
        VALUES (?, ?, ?, ?, 'prescribed', ?, 'active', ?)
      `).bind(patientId, item.medicine_name, item.dosage ?? null, item.frequency ?? null, doctorId, tenantId)
    ),
    ...buildPrescriptionUsageStatsStatements(db.$client, tenantId, doctorId, items, prescription.labTests ?? []),
  ];
  await db.$client.batch(statements);

  await ensurePendingPrescriptionLabOrder(db.$client, tenantId, {
    prescriptionId,
    patientId,
    visitId,
    orderedBy: userId,
    orderingClinicianDoctorId: doctorId,
    labTests: prescription.labTests ?? [],
  });
}

async function replacePrescriptionItems(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  prescriptionId: number,
  items: ReturnType<typeof normalizeRxItems>,
) {
  try {
    await db.$client.prepare(
      "UPDATE prescription_items SET status = 'replaced', updated_at = datetime('now', '+6 hours') WHERE prescription_id = ? AND prescription_id IN (SELECT id FROM prescriptions WHERE tenant_id = ?)"
    ).bind(prescriptionId, tenantId).run();
  } catch (error) {
    if (!isSchemaDrift(error)) throw error;
    await db.$client.prepare(
      'DELETE FROM prescription_items WHERE prescription_id = ? AND prescription_id IN (SELECT id FROM prescriptions WHERE tenant_id = ?)'
    ).bind(prescriptionId, tenantId).run();
  }

  if (items.length === 0) return;
  const statements = items.map((item) =>
    db.$client.prepare(`
      INSERT INTO prescription_items
        (prescription_id, medicine_name, dosage, frequency, duration, instructions, sort_order, quantity, medicine_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      prescriptionId,
      item.medicine_name,
      item.dosage ?? null,
      item.frequency ?? null,
      item.duration ?? null,
      item.instructions ?? null,
      item.sort_order,
      item.quantity ?? 0,
      item.medicineId ?? null,
    )
  );
  await db.$client.batch(statements);
}

async function saveConsultationPrescription(
  c: AppContext,
  tenantId: string,
  userId: string,
  patientId: number,
  visitId: number | null,
  doctorId: number,
  appointmentId: number,
  prescription: CompleteConsultationPrescription,
  completionClaimId?: number,
  resumeCompletionClaim = false,
) {
  const db = getDb(c.env.DB);
  const items = normalizeRxItems(prescription.items);
  const status = prescription.status ?? 'final';
  const labTests = prescription.labTests?.length ? JSON.stringify(prescription.labTests) : null;

  if (items.length > 0) {
    await enforcePrescriptionDrugSafety(db, tenantId, patientId, items, {
      safetyCheckId: prescription.safetyCheckId,
      safetyOverrideReason: prescription.safetyOverrideReason,
    });
  }

  const claimedPrescription = completionClaimId && resumeCompletionClaim
    ? await db.$client.prepare(`
        SELECT id, rx_no, status, patient_id, doctor_id, appointment_id, completion_claim_id
        FROM prescriptions
        WHERE tenant_id = ? AND completion_claim_id = ?
        LIMIT 1
      `).bind(tenantId, completionClaimId).first<{
        id: number;
        rx_no: string;
        status: string;
        patient_id: number;
        doctor_id: number | null;
        appointment_id: number | null;
        completion_claim_id: number | null;
      }>()
    : null;
  if (prescription.id && claimedPrescription && Number(prescription.id) !== Number(claimedPrescription.id)) {
    throw new HTTPException(409, { message: 'Completion claim is already linked to another prescription' });
  }
  const targetPrescriptionId = prescription.id ?? claimedPrescription?.id;

  if (targetPrescriptionId) {
    const existing = await db.$client.prepare(`
      SELECT id, rx_no, status, patient_id, doctor_id, appointment_id, completion_claim_id
      FROM prescriptions
      WHERE id = ? AND tenant_id = ? AND patient_id = ?
      LIMIT 1
    `).bind(targetPrescriptionId, tenantId, patientId).first<{
      id: number;
      rx_no: string;
      status: string;
      patient_id: number;
      doctor_id: number | null;
      appointment_id: number | null;
      completion_claim_id: number | null;
    }>();
    if (!existing) throw new HTTPException(404, { message: 'Prescription not found for this patient' });
    if (existing.doctor_id && Number(existing.doctor_id) !== doctorId) {
      throw new HTTPException(403, { message: 'Prescription belongs to another doctor' });
    }
    if (existing.appointment_id && Number(existing.appointment_id) !== appointmentId) {
      throw new HTTPException(409, { message: 'Prescription belongs to another appointment' });
    }
    if (existing.completion_claim_id && completionClaimId && Number(existing.completion_claim_id) !== completionClaimId) {
      throw new HTTPException(409, { message: 'Prescription belongs to another completion claim' });
    }
    if (completionClaimId && !existing.completion_claim_id) {
      const linked = await db.$client.prepare(`
        UPDATE prescriptions
        SET completion_claim_id = ?, updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND completion_claim_id IS NULL
        RETURNING id
      `).bind(completionClaimId, existing.id, tenantId).first<{ id: number }>();
      if (!linked?.id) {
        throw new HTTPException(409, { message: 'Prescription could not be linked to this completion claim' });
      }
    }
    if (existing.status !== 'draft') {
      if (status === 'final') {
        await ensurePendingPrescriptionLabOrder(db.$client, tenantId, {
          prescriptionId: existing.id,
          patientId,
          visitId,
          orderedBy: userId,
          orderingClinicianDoctorId: doctorId,
          labTests: prescription.labTests ?? [],
        });
      }
      return { id: existing.id, rxNo: existing.rx_no, status: existing.status, unchanged: true };
    }

    await db.$client.prepare(`
      UPDATE prescriptions
      SET chief_complaint = ?,
          diagnosis = ?,
          examination_notes = ?,
          advice = ?,
          lab_tests = ?,
          follow_up_date = ?,
          status = ?,
          appointment_id = COALESCE(appointment_id, ?),
          doctor_id = COALESCE(doctor_id, ?),
          completion_claim_id = COALESCE(completion_claim_id, ?),
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      prescription.chiefComplaint ?? null,
      prescription.diagnosis ?? null,
      prescription.examinationNotes ?? null,
      prescription.advice ?? null,
      labTests,
      prescription.followUpDate ?? null,
      status === 'final' ? 'draft' : status,
      appointmentId,
      doctorId,
      completionClaimId ?? null,
      targetPrescriptionId,
      tenantId,
    ).run();

    await replacePrescriptionItems(db, tenantId, targetPrescriptionId, items);
    if (status === 'final') {
      await finalizeConsultationPrescription(db, tenantId, targetPrescriptionId, userId, patientId, visitId, doctorId, prescription, items);
    }
    return { id: existing.id, rxNo: existing.rx_no, status };
  }

  const rxNo = await getNextSequence(c.env.DB, tenantId, 'prescription', 'RX');
  const result = await db.$client.prepare(`
    INSERT INTO prescriptions (
      rx_no, patient_id, doctor_id, appointment_id,
      chief_complaint, diagnosis, examination_notes, advice,
      lab_tests, follow_up_date, status, created_by, tenant_id,
      completion_claim_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    rxNo,
    patientId,
    doctorId,
    appointmentId,
    prescription.chiefComplaint ?? null,
    prescription.diagnosis ?? null,
    prescription.examinationNotes ?? null,
    prescription.advice ?? null,
    labTests,
    prescription.followUpDate ?? null,
    status === 'final' ? 'draft' : status,
    Number(userId) || 0,
    tenantId,
    completionClaimId ?? null,
  ).run();

  let prescriptionId = Number(result.meta.last_row_id ?? 0);
  if (completionClaimId) {
    const confirmed = await db.$client.prepare(`
      SELECT id, rx_no
      FROM prescriptions
      WHERE tenant_id = ? AND completion_claim_id = ?
      LIMIT 1
    `).bind(tenantId, completionClaimId).first<{ id: number; rx_no: string }>();
    prescriptionId = Number(confirmed?.id ?? prescriptionId);
  }
  if (!prescriptionId) {
    throw new HTTPException(500, { message: 'Prescription creation could not be confirmed' });
  }
  await replacePrescriptionItems(db, tenantId, prescriptionId, items);
  if (status === 'final') {
    await finalizeConsultationPrescription(db, tenantId, prescriptionId, userId, patientId, visitId, doctorId, prescription, items);
  }

  return { id: prescriptionId, rxNo, status };
}


async function countVerifiedClinicalOrdersForAppointment(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  appointmentDate: string,
  userId: string,
): Promise<number> {
  const [labRow, radiologyRow] = await Promise.all([
    db.$client.prepare(`
      SELECT COUNT(*) AS count
      FROM lab_orders
      WHERE tenant_id = ?
        AND patient_id = ?
        AND order_date = ?
        AND CAST(ordered_by AS TEXT) = ?
    `).bind(tenantId, patientId, appointmentDate, userId).first<{ count: number | null }>(),
    db.$client.prepare(`
      SELECT COUNT(*) AS count
      FROM radiology_requisitions
      WHERE tenant_id = ?
        AND patient_id = ?
        AND imaging_date = ?
        AND CAST(created_by AS TEXT) = ?
    `).bind(tenantId, patientId, appointmentDate, userId).first<{ count: number | null }>(),
  ]);

  return Number(labRow?.count ?? 0) + Number(radiologyRow?.count ?? 0);
}

type ConsultationOrderReference = {
  type: 'lab' | 'imaging';
  id: number;
  orderNo: string | null;
  status: string;
};

type SignedConsultationEncounterInput = {
  patientId: number;
  visitId: number;
  appointmentId: number;
  doctorId: number;
  formSoapId: number | null;
  prescriptionId: number | null;
  chiefComplaint: string | null;
  orderRefs: ConsultationOrderReference[];
  signedSnapshot: string;
  snapshotHash: string;
  signedAtUtc: string;
  signedAtLegacy: string;
};

async function listVerifiedClinicalOrderRefsForAppointment(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  appointmentDate: string,
  userId: string,
): Promise<ConsultationOrderReference[]> {
  const [labOrders, imagingOrders] = await Promise.all([
    safeAll(db.$client.prepare(`
      SELECT id, order_no, COALESCE(status, 'pending') AS status
      FROM lab_orders
      WHERE tenant_id = ? AND patient_id = ? AND order_date = ? AND CAST(ordered_by AS TEXT) = ?
      ORDER BY id ASC
    `).bind(tenantId, patientId, appointmentDate, userId)),
    safeAll(db.$client.prepare(`
      SELECT id, COALESCE(accession_no, CAST(id AS TEXT)) AS order_no,
             COALESCE(order_status, 'pending') AS status
      FROM radiology_requisitions
      WHERE tenant_id = ? AND patient_id = ? AND imaging_date = ?
        AND CAST(created_by AS TEXT) = ? AND COALESCE(is_active, 1) = 1
      ORDER BY id ASC
    `).bind(tenantId, patientId, appointmentDate, userId)),
  ]);

  return [
    ...labOrders.map((row) => ({
      type: 'lab' as const,
      id: Number((row as Record<string, unknown>).id),
      orderNo: ((row as Record<string, unknown>).order_no as string | null) ?? null,
      status: String((row as Record<string, unknown>).status ?? 'pending'),
    })),
    ...imagingOrders.map((row) => ({
      type: 'imaging' as const,
      id: Number((row as Record<string, unknown>).id),
      orderNo: ((row as Record<string, unknown>).order_no as string | null) ?? null,
      status: String((row as Record<string, unknown>).status ?? 'pending'),
    })),
  ].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
}

async function getSignedEncounterByAppointment(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  appointmentId: number,
  doctorId: number,
) {
  return db.$client.prepare(`
    SELECT id, patient_id, visit_id, appointment_id, form_soap_id, prescription_id,
           order_refs_json, snapshot_hash, signed_by, signed_at, signature_version,
           addendum_count, status
    FROM encounters
    WHERE tenant_id = ? AND appointment_id = ? AND provider_id = ?
      AND signed_at IS NOT NULL AND is_active = 1
    LIMIT 1
  `).bind(tenantId, appointmentId, doctorId).first<Record<string, unknown>>();
}

async function completeDoctorAppointment(
  c: AppContext,
  tenantId: string,
  userId: string,
  doctorId: number,
  appointmentId: number,
  appointment: Record<string, unknown>,
  signedEncounter?: SignedConsultationEncounterInput,
) {
  const db = getDb(c.env.DB);
  const currentStatus = String(appointment.status ?? '');
  if (['cancelled', 'no_show'].includes(currentStatus)) {
    throw new HTTPException(409, { message: 'This appointment is already closed' });
  }
  if (currentStatus === 'completed') {
    const encounter = await getSignedEncounterByAppointment(db, tenantId, appointmentId, doctorId);
    return {
      appointmentStatus: 'completed',
      queueStatus: 'completed',
      alreadyCompleted: true,
      signedEncounter: encounter,
    };
  }
  if (!signedEncounter) {
    throw new HTTPException(500, { message: 'Signed encounter payload is required to complete the appointment' });
  }

  const status = 'completed' as const;
  const appointmentStatus = appointmentStatusForDoctorAction(status);
  const queueStatus = queueStatusForDoctorAction(status);

  const routeContext = await buildAppointmentRouteContext(c.env.DB, {
    tenantId,
    legacyAppointmentId: appointmentId,
  });
  const encounterPublicId = await resolveAppointmentRouteEncounter(c.env.DB, tenantId, [
    { sourceType: 'legacy_visit', sourcePublicId: String(signedEncounter.visitId) },
    { sourceType: 'legacy_appointment', sourcePublicId: String(appointmentId) },
  ]);
  const legacyVisit = await db.$client.prepare(`
    SELECT id,patient_id,doctor_id,visit_type,visit_date,status,appointment_id,canonical_source_key
    FROM visits
    WHERE id=? AND tenant_id=? AND appointment_id=?
    LIMIT 1
  `).bind(signedEncounter.visitId, tenantId, appointmentId).first<{
    id: number;
    patient_id: number;
    doctor_id: number | null;
    visit_type: string;
    visit_date: string | null;
    status: string | null;
    appointment_id: number | null;
    canonical_source_key: string | null;
  }>();
  if (!legacyVisit || Number(legacyVisit.patient_id) !== signedEncounter.patientId) {
    throw new HTTPException(409, { message: 'Signed encounter visit evidence is unavailable' });
  }
  const encounterContext = await resolveEncounterRouteContext(c.env.DB, {
    tenantId,
    visit: {
      visitId: Number(legacyVisit.id),
      patientId: Number(legacyVisit.patient_id),
      doctorId: legacyVisit.doctor_id == null ? null : Number(legacyVisit.doctor_id),
      visitType: String(legacyVisit.visit_type),
      visitDate: String(legacyVisit.visit_date ?? getTodayGMT6()),
      status: String(legacyVisit.status ?? 'initiated'),
      appointmentId: legacyVisit.appointment_id == null ? null : Number(legacyVisit.appointment_id),
      canonicalSourceKey: legacyVisit.canonical_source_key?.trim() || null,
    },
  });
  if (encounterContext.encounterPublicId !== encounterPublicId) {
    throw new HTTPException(409, { message: 'Appointment and visit encounter mappings do not agree' });
  }
  const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
  const encounterCompletion = await prepareRouteEncounterCompletionBatch(c.env.DB, encounterContext, {
    completedAtUtc: signedEncounter.signedAtUtc,
    signedSnapshotSha256: signedEncounter.snapshotHash,
    signedAtUtc: signedEncounter.signedAtUtc,
    sourceEvidence: {
      boundary: 'doctor_signed_consultation',
      appointmentId,
      visitId: signedEncounter.visitId,
      encounterPublicId,
      snapshotHash: signedEncounter.snapshotHash,
    },
    idempotencyKey: suppliedIdempotencyKey
      ? `route:doctor-encounter-complete:${suppliedIdempotencyKey}`
      : `route:doctor-encounter-complete:${appointmentId}:${signedEncounter.snapshotHash}`,
    businessDate: getTodayGMT6(),
  });
  const authoritativeStatements = [
    ...encounterCompletion.statements,
    db.$client.prepare(`
      INSERT OR IGNORE INTO encounters (
        tenant_id, patient_id, visit_id, appointment_id, encounter_type, status,
        start_time, end_time, provider_id, chief_complaint,
        form_soap_id, prescription_id, order_refs_json,
        signed_snapshot, snapshot_hash, signed_by, signed_at,
        signature_version, addendum_count, is_active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'outpatient', 'signed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?, ?)
    `).bind(
      tenantId,
      signedEncounter.patientId,
      signedEncounter.visitId,
      signedEncounter.appointmentId,
      signedEncounter.signedAtLegacy,
      signedEncounter.signedAtLegacy,
      signedEncounter.doctorId,
      signedEncounter.chiefComplaint,
      signedEncounter.formSoapId,
      signedEncounter.prescriptionId,
      JSON.stringify(signedEncounter.orderRefs),
      signedEncounter.signedSnapshot,
      signedEncounter.snapshotHash,
      userId,
      signedEncounter.signedAtLegacy,
      userId,
      signedEncounter.signedAtLegacy,
      signedEncounter.signedAtLegacy,
    ),
    db.$client.prepare(`
      UPDATE appointments
      SET status = ?, canonical_source_key = COALESCE(canonical_source_key, ?),
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND doctor_id = ?
    `).bind(appointmentStatus, routeContext.sourcePublicId, appointmentId, tenantId, doctorId),
    db.$client.prepare(`
      UPDATE visits
      SET status = 'completed',
          updated_at = datetime('now', '+6 hours')
      WHERE appointment_id = ? AND tenant_id = ?
    `).bind(appointmentId, tenantId),
    db.$client.prepare(`
      UPDATE queue_entries
      SET status = 'completed',
          completed_at = COALESCE(completed_at, datetime('now', '+6 hours')),
          updated_at = datetime('now', '+6 hours')
      WHERE appointment_id = ? AND tenant_id = ?
    `).bind(appointmentId, tenantId),
    prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'appointments',
      recordId: appointmentId,
      oldValue: appointment,
      newValue: {
        source: 'doctor_consultation_complete',
        appointmentStatus,
        queueStatus,
        encounterPublicId,
        canonicalSourceKey: routeContext.sourcePublicId,
      },
      ...auditRequestMetadata(c),
    }),
  ];
  await fulfilRouteAppointment(c.env.DB, routeContext, {
    encounterPublicId,
    authoritativeStatements,
    actorSystemKey: 'canonical.appointment.doctor-consultation',
    actorUserPublicId: String(userId),
    occurredAtUtc: signedEncounter.signedAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: suppliedIdempotencyKey
      ? `route:doctor-appointment-complete:${suppliedIdempotencyKey}`
      : `route:doctor-appointment-complete:${appointmentId}:${signedEncounter.snapshotHash}`,
    reasonCode: 'doctor_signed_encounter',
  });

  const encounter = await getSignedEncounterByAppointment(db, tenantId, appointmentId, doctorId);
  if (!encounter) {
    throw new HTTPException(500, { message: 'Signed encounter could not be confirmed after consultation completion' });
  }

  return { appointmentStatus, queueStatus, alreadyCompleted: false, signedEncounter: encounter };
}

doctorRoutes.get('/dashboard/appointments/:id/clinical-orders', async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const appointmentId = Number(c.req.param('id'));
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid appointment id' });
  }

  const doctor = await resolveDoctorForDashboard(c, tenantId, userId);
  if (!doctor?.id) throw new HTTPException(403, { message: 'Doctor profile required' });
  const doctorId = Number(doctor.id);

  const appointment = await db.$client.prepare(`
    SELECT id, patient_id, doctor_id, appt_date
    FROM appointments
    WHERE id = ? AND tenant_id = ? AND doctor_id = ?
    LIMIT 1
  `).bind(appointmentId, tenantId, doctorId).first<{ id: number; patient_id: number; doctor_id: number; appt_date: string | null }>();
  if (!appointment) throw new HTTPException(404, { message: 'Appointment not found in your queue' });

  const patientId = Number(appointment.patient_id);
  const appointmentDate = String(appointment.appt_date ?? '');

  const labOrders = await safeAll(db.$client.prepare(`
    SELECT
      lo.id,
      'lab' AS type,
      COALESCE((
        SELECT GROUP_CONCAT(COALESCE(ltc.name, 'Lab test'), ', ')
        FROM lab_order_items loi
        LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
        WHERE loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
      ), lo.notes, 'Lab order') AS label,
      lo.order_no AS orderNo,
      b.invoice_no AS invoiceNo,
      lo.billing_status AS billingStatus,
      COALESCE(lo.status, 'pending') AS status,
      b.total AS total,
      lo.order_date AS orderedAt,
      CASE WHEN COALESCE(lo.status, 'pending') = 'completed' THEN 1 ELSE 0 END AS reportReady
    FROM lab_orders lo
    LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = lo.tenant_id
    WHERE lo.tenant_id = ?
      AND lo.patient_id = ?
      AND lo.order_date = ?
      AND CAST(lo.ordered_by AS TEXT) = ?
    ORDER BY lo.id DESC
    LIMIT 20
  `).bind(tenantId, patientId, appointmentDate, userId));

  const imagingOrders = await safeAll(db.$client.prepare(`
    SELECT
      rr.id,
      'imaging' AS type,
      COALESCE(rr.imaging_item_name, rr.imaging_type_name, 'Imaging order') AS label,
      COALESCE(rr.accession_no, CAST(rr.id AS TEXT)) AS orderNo,
      b.invoice_no AS invoiceNo,
      rr.billing_status AS billingStatus,
      COALESCE(rr.order_status, 'pending') AS status,
      b.total AS total,
      COALESCE(rr.imaging_date, rr.created_at) AS orderedAt,
      COALESCE(rr.is_report_saved, 0) AS reportReady
    FROM radiology_requisitions rr
    LEFT JOIN bills b ON b.id = rr.bill_id AND b.tenant_id = rr.tenant_id
    WHERE rr.tenant_id = ?
      AND rr.patient_id = ?
      AND rr.imaging_date = ?
      AND CAST(rr.created_by AS TEXT) = ?
      AND COALESCE(rr.is_active, 1) = 1
    ORDER BY rr.id DESC
    LIMIT 20
  `).bind(tenantId, patientId, appointmentDate, userId));

  const orders = [...labOrders, ...imagingOrders].map((order) => ({
    ...order,
    reportReady: Boolean(Number((order as Record<string, unknown>).reportReady ?? 0)),
  }));

  return c.json({ appointmentId, patientId, orders });
});

doctorRoutes.post('/dashboard/appointments/:id/complete-consultation', zValidator('json', completeConsultationSchema), async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const appointmentId = Number(c.req.param('id'));
  const body = c.req.valid('json');
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid appointment id' });
  }

  const doctor = await resolveDoctorForDashboard(c, tenantId, userId);
  if (!doctor?.id) throw new HTTPException(403, { message: 'Doctor profile required' });
  const doctorId = Number(doctor.id);

  const appointment = await db.$client.prepare(`
    SELECT a.id, a.patient_id, a.doctor_id, a.status, a.billing_status, a.appt_date,
           v.id AS visit_id
    FROM appointments a
    LEFT JOIN visits v ON v.appointment_id = a.id AND v.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ? AND a.doctor_id = ?
    LIMIT 1
  `).bind(appointmentId, tenantId, doctorId).first<Record<string, unknown>>();
  if (!appointment) throw new HTTPException(404, { message: 'Appointment not found in your queue' });

  const patientId = Number(appointment.patient_id);
  const currentAppointmentStatus = String(appointment.status ?? '');
  if (currentAppointmentStatus === 'completed') {
    const signedEncounter = await getSignedEncounterByAppointment(db, tenantId, appointmentId, doctorId);
    if (body.completeVisit && signedEncounter) {
      try {
        await reconcileSignedConsultationCompletionClaim(
          c.env.DB,
          tenantId,
          appointmentId,
          Number(signedEncounter.id),
        );
      } catch (claimReconcileError) {
        console.error('Signed encounter retry could not reconcile completion claim', claimReconcileError);
      }
      return c.json({
        message: 'Consultation already completed',
        appointmentId,
        patientId,
        soap: null,
        codedDiagnosis: null,
        prescription: null,
        lifecycle: {
          appointmentStatus: 'completed',
          queueStatus: 'completed',
          alreadyCompleted: true,
          signedEncounter,
        },
      });
    }
    throw new HTTPException(409, {
      message: 'This consultation is signed and locked. Record corrections as an encounter addendum.',
    });
  }

  // Clinical safety guard: when finalizing a visit (completeVisit=true),
  // require either a SOAP note, a prescription, or a verified clinical order.
  // Do not trust orderSummary alone; it is only a client hint for UX.
  if (body.completeVisit) {
    const hasSoap = hasSoapContent(body.soap);
    const hasRx = hasPrescriptionContent(body.prescription);
    const hasCodedDiagnosis = Boolean(body.codedDiagnosis);
    let hasVerifiedOrders = false;
    if (!hasSoap && !hasRx && !hasCodedDiagnosis && Number(body.orderSummary?.count ?? 0) > 0) {
      const verifiedOrderCount = await countVerifiedClinicalOrdersForAppointment(
        db,
        tenantId,
        patientId,
        String(appointment.appt_date ?? ''),
        userId,
      );
      hasVerifiedOrders = verifiedOrderCount > 0;
    }
    if (!hasSoap && !hasRx && !hasCodedDiagnosis && !hasVerifiedOrders) {
      throw new HTTPException(400, {
        message: 'Cannot complete a visit without a SOAP note, coded diagnosis, prescription, or verified clinical order. Save as draft or add clinical content first.',
      });
    }
  }

  const visitId = appointment.visit_id ? Number(appointment.visit_id) : null;
  if (body.completeVisit && !visitId) {
    throw new HTTPException(409, {
      message: 'A patient visit is required before signing and completing the consultation',
    });
  }
  let completionClaim: OwnedConsultationCompletionClaim | null = null;
  if (body.completeVisit && visitId) {
    const requestHash = await sha256Hex(stableClinicalJson({
      appointmentId,
      patientId,
      visitId,
      doctorId,
      soap: body.soap ?? null,
      codedDiagnosis: body.codedDiagnosis ?? null,
      prescription: body.prescription ?? null,
    }));
    completionClaim = await acquireConsultationCompletionClaim(c.env.DB, {
      tenantId,
      userId,
      appointmentId,
      patientId,
      visitId,
      doctorId,
      idempotencyKey: body.completionIdempotencyKey ?? `doctor-completion:${appointmentId}:${doctorId}`,
      requestHash,
    });
  }

  try {
    const soap = await saveConsultationSoap(
      c,
      tenantId,
      userId,
      patientId,
      visitId,
      body.soap,
      completionClaim?.id,
      completionClaim?.resumed ?? false,
    );
    if (completionClaim && soap?.id) {
      await updateConsultationCompletionClaim(c.env.DB, tenantId, completionClaim, {
        soapId: Number(soap.id),
      });
    }

    const codedDiagnosis = await saveConsultationCodedDiagnosis(
      c,
      tenantId,
      userId,
      patientId,
      visitId,
      body.codedDiagnosis,
      completionClaim?.id,
      completionClaim?.resumed ?? false,
    );
    if (completionClaim && codedDiagnosis?.id) {
      await updateConsultationCompletionClaim(c.env.DB, tenantId, completionClaim, {
        diagnosisId: Number(codedDiagnosis.id),
      });
    }

    const prescription = hasPrescriptionContent(body.prescription)
      ? await saveConsultationPrescription(
        c,
        tenantId,
        userId,
        patientId,
        visitId,
        doctorId,
        appointmentId,
        body.prescription,
        completionClaim?.id,
        completionClaim?.resumed ?? false,
      )
      : null;
    if (completionClaim && prescription?.id) {
      await updateConsultationCompletionClaim(c.env.DB, tenantId, completionClaim, {
        prescriptionId: Number(prescription.id),
      });
    }

    let signedEncounterInput: SignedConsultationEncounterInput | undefined;
    if (body.completeVisit && visitId) {
      const orderRefs = await listVerifiedClinicalOrderRefsForAppointment(
        db,
        tenantId,
        patientId,
        String(appointment.appt_date ?? ''),
        userId,
      );
      const signedAtUtc = new Date().toISOString();
      const signedAtLegacy = getFullTimestampGMT6();
      const snapshot = {
        signatureVersion: 1,
        signedAt: signedAtUtc,
        tenantId,
        appointmentId,
        patientId,
        visitId,
        doctorId,
        soap: soap ? { id: Number(soap.id), ...body.soap } : null,
        codedDiagnosis: codedDiagnosis
          ? {
            id: Number(codedDiagnosis.id),
            system: codedDiagnosis.system,
            code: codedDiagnosis.code,
            description: codedDiagnosis.description,
          }
          : null,
        prescription: prescription
          ? {
            id: Number(prescription.id),
            rxNo: prescription.rxNo ?? null,
            status: prescription.status,
            content: body.prescription ?? null,
          }
          : null,
        clinicalOrders: orderRefs,
      };
      const signedSnapshot = stableClinicalJson(snapshot);
      signedEncounterInput = {
        patientId,
        visitId,
        appointmentId,
        doctorId,
        formSoapId: soap?.id ? Number(soap.id) : null,
        prescriptionId: prescription?.id ? Number(prescription.id) : null,
        chiefComplaint: body.soap?.chiefComplaint ?? body.prescription?.chiefComplaint ?? null,
        orderRefs,
        signedSnapshot,
        snapshotHash: await sha256Hex(signedSnapshot),
        signedAtUtc,
        signedAtLegacy,
      };
    }

    const lifecycle = body.completeVisit
      ? await completeDoctorAppointment(
        c,
        tenantId,
        userId,
        doctorId,
        appointmentId,
        appointment,
        signedEncounterInput,
      )
      : null;

    if (completionClaim && lifecycle?.signedEncounter?.id) {
      try {
        await markConsultationCompletionCompleted(
          c.env.DB,
          tenantId,
          completionClaim,
          Number(lifecycle.signedEncounter.id),
        );
      } catch (claimFinalizeError) {
        console.error('Consultation completed but completion claim finalization failed', claimFinalizeError);
      }
    }

    return c.json({
      message: body.completeVisit ? 'Consultation completed' : 'Consultation saved',
      appointmentId,
      patientId,
      soap,
      codedDiagnosis,
      prescription,
      lifecycle,
    });
  } catch (error) {
    await markConsultationCompletionFailed(c.env.DB, tenantId, completionClaim, error);
    throw error;
  }
});

doctorRoutes.put('/dashboard/appointments/:id/status', zValidator('json', dashboardStatusSchema), async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const appointmentId = Number(c.req.param('id'));
  const { status } = c.req.valid('json');
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid appointment id' });
  }
  if (!isAllowedDoctorDashboardAction(status)) {
    throw new HTTPException(400, { message: 'Invalid status' });
  }
  if (status === 'completed') {
    throw new HTTPException(400, { message: 'Use Save & Complete so the visit cannot be closed without a SOAP note or prescription.' });
  }

  const doctor = await resolveDoctorForDashboard(c, tenantId, userId);
  if (!doctor?.id) {
    console.error(`[doctor-status] No doctor profile for user ${userId} tenant ${tenantId}`);
    throw new HTTPException(403, { message: 'Doctor profile required' });
  }

  const appointment = await db.$client.prepare(`
    SELECT id, patient_id, doctor_id, status, billing_status, appt_date
    FROM appointments
    WHERE id = ? AND tenant_id = ? AND doctor_id = ?
    LIMIT 1
  `).bind(appointmentId, tenantId, Number(doctor.id)).first<Record<string, unknown>>();
  if (!appointment) {
    console.error(`[doctor-status] Appointment ${appointmentId} not found for doctor ${doctor.id} tenant ${tenantId}`);
    throw new HTTPException(404, { message: 'Appointment not found in your queue' });
  }
  if (['cancelled', 'completed'].includes(String(appointment.status ?? ''))) {
    throw new HTTPException(409, { message: 'This appointment is already closed' });
  }

  const appointmentStatus = appointmentStatusForDoctorAction(status);
  const queueStatus = queueStatusForDoctorAction(status);
  const routeContext = await buildAppointmentRouteContext(c.env.DB, {
    tenantId,
    legacyAppointmentId: appointmentId,
  });
  const legacyStatements = [
    db.$client.prepare(`
      UPDATE appointments
      SET status = ?, canonical_source_key = COALESCE(canonical_source_key, ?),
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND doctor_id = ?
    `).bind(appointmentStatus, routeContext.sourcePublicId, appointmentId, tenantId, Number(doctor.id)),
    db.$client.prepare(`
      UPDATE visits
      SET status = CASE
        WHEN ? = 'completed' THEN 'completed'
        WHEN ? = 'no_show' THEN 'cancelled'
        ELSE 'checked_in'
      END,
      updated_at = datetime('now', '+6 hours')
      WHERE appointment_id = ? AND tenant_id = ?
    `).bind(status, status, appointmentId, tenantId),
    db.$client.prepare(`
      UPDATE queue_entries
      SET status = ?,
          called_at = CASE WHEN ? = 'serving' THEN COALESCE(called_at, datetime('now', '+6 hours')) ELSE called_at END,
          completed_at = CASE WHEN ? IN ('completed', 'no_show') THEN COALESCE(completed_at, datetime('now', '+6 hours')) ELSE completed_at END,
          updated_at = datetime('now', '+6 hours')
      WHERE appointment_id = ? AND tenant_id = ?
    `).bind(queueStatus, queueStatus, queueStatus, appointmentId, tenantId),
    prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'appointments',
      recordId: appointmentId,
      oldValue: appointment,
      newValue: {
        source: 'doctor_dashboard',
        status,
        appointmentStatus,
        queueStatus,
        canonicalSourceKey: routeContext.sourcePublicId,
      },
      ...auditRequestMetadata(c),
    }),
  ];
  const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
  await transitionRouteAppointment(c.env.DB, routeContext, {
    toStatus: appointmentStatus === 'completed' ? 'checked_in' : appointmentStatus,
    authoritativeStatements: legacyStatements,
    actorSystemKey: 'canonical.appointment.doctor-dashboard',
    actorUserPublicId: String(userId),
    occurredAtUtc: new Date().toISOString(),
    businessDate: getTodayGMT6(),
    idempotencyKey: suppliedIdempotencyKey
      ? `route:doctor-appointment-status:${suppliedIdempotencyKey}`
      : `route:doctor-appointment-status:${appointmentId}:${appointmentStatus}:${routeContext.sourceEvidenceSha256}`,
    reasonCode: `doctor_dashboard_${status}`,
  });

  return c.json({ message: 'Appointment status updated', id: appointmentId, status, appointmentStatus, queueStatus });
});

doctorRoutes.put('/dashboard/appointments/:id/reassign', zValidator('json', dashboardReassignSchema), async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const appointmentId = Number(c.req.param('id'));
  const { doctorId, reason } = c.req.valid('json');
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid appointment id' });
  }

  const currentDoctor = await resolveDoctorForDashboard(c, tenantId, userId);
  if (!currentDoctor?.id) throw new HTTPException(403, { message: 'Doctor profile required' });

  const appointment = await db.$client.prepare(`
    SELECT id, patient_id, doctor_id, status, appt_date, appt_time, notes
    FROM appointments
    WHERE id = ? AND tenant_id = ? AND doctor_id = ?
    LIMIT 1
  `).bind(appointmentId, tenantId, Number(currentDoctor.id)).first<Record<string, unknown>>();
  if (!appointment) throw new HTTPException(404, { message: 'Appointment not found in your queue' });
  if (['cancelled', 'completed'].includes(String(appointment.status ?? ''))) {
    throw new HTTPException(409, { message: 'Closed appointments cannot be reassigned' });
  }
  if (Number(appointment.doctor_id) === doctorId) {
    throw new HTTPException(409, { message: 'Appointment is already assigned to this doctor' });
  }

  const targetDoctor = await db.$client.prepare(
    'SELECT id, name FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1'
  ).bind(doctorId, tenantId).first<{ id: number; name: string }>();
  if (!targetDoctor) throw new HTTPException(404, { message: 'Target doctor not found' });

  const conflict = appointment.appt_time
    ? await db.$client.prepare(`
        SELECT id FROM appointments
        WHERE tenant_id = ? AND doctor_id = ? AND appt_date = ? AND appt_time = ?
          AND status NOT IN ('cancelled', 'no_show', 'completed')
        LIMIT 1
      `).bind(tenantId, doctorId, appointment.appt_date as string, appointment.appt_time as string).first<{ id: number }>()
    : null;
  if (conflict?.id) {
    throw new HTTPException(409, { message: 'Target doctor already has a serial at this time' });
  }

  const note = reason?.trim()
    ? `Reassigned from Dr. ${currentDoctor.name ?? currentDoctor.id} to Dr. ${targetDoctor.name}: ${reason.trim()}`
    : `Reassigned from Dr. ${currentDoctor.name ?? currentDoctor.id} to Dr. ${targetDoctor.name}`;

  const routeContext = await buildAppointmentRouteContext(c.env.DB, {
    tenantId,
    legacyAppointmentId: appointmentId,
  });
  const targetPractitionerPublicId = await resolveAppointmentRoutePractitioner(c.env.DB, tenantId, doctorId);
  if (!targetPractitionerPublicId) {
    throw new HTTPException(409, { message: 'Target doctor does not have an active Canonical practitioner identity' });
  }
  const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
  const reassignmentIdentity = suppliedIdempotencyKey
    ?? `${routeContext.sourcePublicId}:${doctorId}:${reason?.trim() ?? ''}`;
  const newSourcePublicId = await createDeterministicSourceId(
    'apptsrc',
    tenantId,
    'doctor_dashboard_reassign',
    reassignmentIdentity,
  );
  const authoritativeStatements = [
    db.$client.prepare(`
      UPDATE appointments
      SET doctor_id = ?,
          notes = TRIM(COALESCE(notes, '') || char(10) || ?),
          canonical_source_key = ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(doctorId, note, newSourcePublicId, appointmentId, tenantId),
    db.$client.prepare(`
      UPDATE visits
      SET doctor_id = ?, updated_at = datetime('now', '+6 hours')
      WHERE appointment_id = ? AND tenant_id = ?
    `).bind(doctorId, appointmentId, tenantId),
    db.$client.prepare(`
      UPDATE queue_entries
      SET doctor_id = ?, status = 'waiting', updated_at = datetime('now', '+6 hours')
      WHERE appointment_id = ? AND tenant_id = ?
    `).bind(doctorId, appointmentId, tenantId),
    prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'appointments',
      recordId: appointmentId,
      oldValue: appointment,
      newValue: {
        source: 'doctor_dashboard_reassign',
        fromDoctorId: Number(currentDoctor.id),
        toDoctorId: doctorId,
        reason: reason ?? null,
        canonicalSourceKey: newSourcePublicId,
        billing: 'consultation bill remains attached to the appointment; no posted finance row is edited',
      },
      ...auditRequestMetadata(c),
    }),
  ];
  await rescheduleRouteAppointment(c.env.DB, routeContext, {
    newSourcePublicId,
    requestedPractitionerPublicId: targetPractitionerPublicId,
    requestedStartUtc: routeContext.requestedStartUtc,
    requestedEndUtc: routeContext.requestedEndUtc,
    authoritativeStatements,
    actorSystemKey: 'canonical.appointment.doctor-dashboard',
    actorUserPublicId: String(userId),
    occurredAtUtc: new Date().toISOString(),
    businessDate: routeContext.businessDate,
    idempotencyKey: suppliedIdempotencyKey
      ? `route:doctor-appointment-reassign:${suppliedIdempotencyKey}`
      : `route:doctor-appointment-reassign:${appointmentId}:${newSourcePublicId}`,
    reasonCode: 'doctor_reassigned',
  });

  return c.json({ message: 'Appointment reassigned', id: appointmentId, doctorId, doctorName: targetDoctor.name });
});

// GET /api/doctors/daily-patient-count — end-of-day doctor patient count report
doctorRoutes.get('/daily-patient-count', async (c) => {
  requireSpecificRole(c, ...DOCTOR_STATS_ROLES);
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, doctorId } = c.req.query();

  const today = getTodayGMT6();
  const effectiveStartDate = startDate || today;
  const effectiveEndDate = endDate || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate)) {
    throw new HTTPException(400, { message: 'Invalid date format. Expected YYYY-MM-DD.' });
  }

  try {
    let query = `
      SELECT
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.specialty AS doctor_specialty,
        d.department AS doctor_department,
        a.appt_date AS report_date,
        COUNT(*) AS total_appointments,
        COUNT(DISTINCT a.patient_id) AS unique_patients,
        SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show,
        SUM(CASE WHEN a.status IN ('scheduled', 'checked_in') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN a.visit_type = 'emergency' THEN 1 ELSE 0 END) AS emergency_count,
        COALESCE(SUM(CASE WHEN a.billing_status = 'paid' THEN a.final_fee ELSE 0 END), 0) AS collected_revenue,
        COALESCE(SUM(CASE WHEN a.billing_status = 'due_approved' THEN a.final_fee ELSE 0 END), 0) AS due_revenue
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND a.appt_date >= ?
        AND a.appt_date <= ?
    `;
    const params: (string | number)[] = [tenantId, effectiveStartDate, effectiveEndDate];

    if (doctorId) {
      const doctorIdNum = Number(doctorId);
      if (!Number.isInteger(doctorIdNum) || doctorIdNum <= 0) {
        throw new HTTPException(400, { message: 'Invalid doctor_id' });
      }
      query += ' AND a.doctor_id = ?';
      params.push(doctorIdNum);
    }

    query += `
      GROUP BY d.id, d.name, d.specialty, d.department, a.appt_date
      ORDER BY a.appt_date DESC, d.name ASC
    `;

    const { results } = await db.$client.prepare(query).bind(...params).all();

    // Get true unique patient count across the entire date range (not sum of per-day counts)
    let uniquePatientsQuery = `
      SELECT COUNT(DISTINCT a.patient_id) as count
      FROM appointments a
      WHERE a.tenant_id = ? AND a.appt_date >= ? AND a.appt_date <= ? AND a.status != 'cancelled'
    `;
    const uniqueParams: (string | number)[] = [tenantId, effectiveStartDate, effectiveEndDate];
    if (doctorId) {
      uniquePatientsQuery += ' AND a.doctor_id = ?';
      uniqueParams.push(Number(doctorId));
    }
    const uniquePatientsResult = await db.$client.prepare(uniquePatientsQuery).bind(...uniqueParams).first<{ count: number }>();
    const totalUniquePatients = Number(uniquePatientsResult?.count ?? 0);

    const report = results.map((row: any) => ({
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      doctorSpecialty: row.doctor_specialty,
      doctorDepartment: row.doctor_department,
      reportDate: row.report_date,
      totalAppointments: Number(row.total_appointments ?? 0),
      uniquePatients: Number(row.unique_patients ?? 0),
      completed: Number(row.completed ?? 0),
      cancelled: Number(row.cancelled ?? 0),
      noShow: Number(row.no_show ?? 0),
      pending: Number(row.pending ?? 0),
      emergencyCount: Number(row.emergency_count ?? 0),
      collectedRevenue: Number(row.collected_revenue ?? 0),
      dueRevenue: Number(row.due_revenue ?? 0),
    }));

    const summary = {
      totalAppointments: report.reduce((sum, r) => sum + r.totalAppointments, 0),
      uniquePatients: totalUniquePatients,
      completed: report.reduce((sum, r) => sum + r.completed, 0),
      cancelled: report.reduce((sum, r) => sum + r.cancelled, 0),
      noShow: report.reduce((sum, r) => sum + r.noShow, 0),
      pending: report.reduce((sum, r) => sum + r.pending, 0),
      emergencyCount: report.reduce((sum, r) => sum + r.emergencyCount, 0),
      collectedRevenue: report.reduce((sum, r) => sum + r.collectedRevenue, 0),
      dueRevenue: report.reduce((sum, r) => sum + r.dueRevenue, 0),
      doctorCount: new Set(report.map((r) => r.doctorId)).size,
      dateRange: { startDate: effectiveStartDate, endDate: effectiveEndDate },
    };

    return c.json({ report, summary });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('[doctors] daily-patient-count error:', error);
    throw new HTTPException(500, { message: 'Failed to generate doctor patient count report' });
  }
});

// ─── GET /doctors/dashboard/validity-settings ──────────────────────────────
doctorRoutes.get('/dashboard/validity-settings', async (c) => {
  requireSpecificRole(c, ...DOCTOR_STATS_ROLES);
  const db = c.env.DB;
  const tenantId = requireTenantId(c);
  const settings = await getValiditySettings(db, tenantId);
  return c.json(settings);
});

// ─── PUT /doctors/dashboard/validity-settings ──────────────────────────────
const validitySettingSchema = z.object({
  follow_up_valid_days: z.number().int().min(1).max(90).optional(),
  report_show_valid_days: z.number().int().min(1).max(90).optional(),
});

doctorRoutes.put('/dashboard/validity-settings', zValidator('json', validitySettingSchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = c.env.DB;
  const tenantId = requireTenantId(c);
  const body = c.req.valid('json');

  if (body.follow_up_valid_days !== undefined) {
    await upsertValiditySetting(db, tenantId, 'follow_up_valid_days', body.follow_up_valid_days);
  }
  if (body.report_show_valid_days !== undefined) {
    await upsertValiditySetting(db, tenantId, 'report_show_valid_days', body.report_show_valid_days);
  }

  const settings = await getValiditySettings(db, tenantId);
  return c.json(settings);
});

// ─── GET /doctors/dashboard/report-show-patients ───────────────────────────
doctorRoutes.get('/dashboard/report-show-patients', async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const date = c.req.query('date') || getTodayGMT6();

  const doctor = await db.$client.prepare(
    `SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ?`
  ).bind(userId, tenantId).first<{ id: number }>();
  if (!doctor) return c.json({ patients: [] });

  const appointments = await db.$client.prepare(`
    SELECT a.id AS appointment_id, a.patient_id, a.appt_date, a.appt_time, a.appointment_type,
           p.name AS patient_name, p.patient_code, p.mobile AS patient_mobile, p.age AS patient_age, p.gender AS patient_gender
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.doctor_id = ? AND a.tenant_id = ? AND a.appt_date = ? AND a.appointment_type = 'report_show'
    ORDER BY a.appt_time ASC
  `).bind(doctor.id, tenantId, date).all<{
    appointment_id: number; patient_id: number; appt_date: string; appt_time: string; appointment_type: string;
    patient_name: string; patient_code: string; patient_mobile: string; patient_age: number; patient_gender: string;
  }>();

  const rows = appointments.results ?? [];
  if (rows.length === 0) return c.json({ patients: [] });

  const patientIds = rows.map(r => r.patient_id);
  const placeholders = patientIds.map(() => '?').join(',');

  const lastPrescriptions = await db.$client.prepare(`
    SELECT p.patient_id, p.id, p.rx_no, p.diagnosis, p.chief_complaint, p.advice, p.follow_up_date, p.created_at
    FROM prescriptions p
    WHERE p.tenant_id = ? AND p.patient_id IN (${placeholders}) AND p.status = 'final'
    AND p.id = (SELECT MAX(p2.id) FROM prescriptions p2 WHERE p2.patient_id = p.patient_id AND p2.tenant_id = ? AND p2.status = 'final')
  `).bind(tenantId, ...patientIds, tenantId).all<{
    patient_id: number; id: number; rx_no: string; diagnosis: string; chief_complaint: string; advice: string; follow_up_date: string; created_at: string;
  }>();

  const rxMap = new Map<number, typeof lastPrescriptions.results[0]>();
  for (const rx of lastPrescriptions.results ?? []) rxMap.set(rx.patient_id, rx);

  const rxIds = (lastPrescriptions.results ?? []).map(r => r.id);
  const rxPlaceholders = rxIds.length > 0 ? rxIds.map(() => '?').join(',') : 'NULL';

  type ReportShowPrescriptionItem = {
    prescription_id: number; medicine_name: string; dosage: string; frequency: string; duration: string; instructions: string;
  };
  const rxItems: { results?: ReportShowPrescriptionItem[] } = rxIds.length > 0 ? await db.$client.prepare(`
    SELECT prescription_id, medicine_name, dosage, frequency, duration, instructions
    FROM prescription_items WHERE prescription_id IN (${rxPlaceholders})
  `).bind(...rxIds).all<ReportShowPrescriptionItem>() : { results: [] };

  const itemsMap = new Map<number, ReportShowPrescriptionItem[]>();
  for (const item of rxItems.results ?? []) {
    if (!itemsMap.has(item.prescription_id)) itemsMap.set(item.prescription_id, []);
    itemsMap.get(item.prescription_id)!.push(item);
  }

  const orderedTests = await db.$client.prepare(`
    SELECT lo.patient_id, li.id AS item_id, li.test_name, li.status, li.result, li.unit, li.abnormal_flag, li.completed_at
    FROM lab_order_items li
    JOIN lab_orders lo ON li.lab_order_id = lo.id
    WHERE lo.tenant_id = ? AND lo.patient_id IN (${placeholders})
    ORDER BY li.completed_at DESC
  `).bind(tenantId, ...patientIds).all<{
    patient_id: number; item_id: number; test_name: string; status: string; result: string; unit: string; abnormal_flag: string; completed_at: string;
  }>();

  const testsByPatient = new Map<number, typeof orderedTests.results>();
  for (const t of orderedTests.results ?? []) {
    if (!testsByPatient.has(t.patient_id)) testsByPatient.set(t.patient_id, []);
    testsByPatient.get(t.patient_id)!.push(t);
  }

  const lastVisits = await db.$client.prepare(`
    SELECT v.patient_id, d.id AS doctor_id, d.name AS doctor_name
    FROM visits v
    JOIN doctors d ON v.doctor_id = d.id
    WHERE v.tenant_id = ? AND v.patient_id IN (${placeholders})
    AND v.id = (SELECT MAX(v2.id) FROM visits v2 WHERE v2.patient_id = v.patient_id AND v2.tenant_id = ?)
  `).bind(tenantId, ...patientIds, tenantId).all<{
    patient_id: number; doctor_id: number; doctor_name: string;
  }>();

  const doctorMap = new Map<number, { id: number; name: string }>();
  for (const v of lastVisits.results ?? []) doctorMap.set(v.patient_id, { id: v.doctor_id, name: v.doctor_name });

  const settings = await getValiditySettings(c.env.DB, tenantId);

  const patients = rows.map(row => {
    const rx = rxMap.get(row.patient_id);
    const tests = testsByPatient.get(row.patient_id) ?? [];
    const validity = rx
      ? calculateVisitValidity(row.appointment_type, rx.created_at.slice(0, 10), date, settings.follow_up_valid_days, settings.report_show_valid_days)
      : {
          badge: 'report_show_expired' as const,
          days_elapsed: settings.report_show_valid_days + 1,
          valid_days: settings.report_show_valid_days,
        };

    return {
      appointment_id: row.appointment_id,
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      patient_code: row.patient_code,
      patient_mobile: row.patient_mobile,
      patient_age: row.patient_age,
      patient_gender: row.patient_gender,
      appt_time: row.appt_time,
      validity_badge: validity.badge,
      days_elapsed: validity.days_elapsed,
      last_prescription: rx ? {
        id: rx.id, rx_no: rx.rx_no, diagnosis: rx.diagnosis, chief_complaint: rx.chief_complaint,
        advice: rx.advice, follow_up_date: rx.follow_up_date,
        items: (itemsMap.get(rx.id) ?? []).map(i => ({
          medicine_name: i.medicine_name, dosage: i.dosage, frequency: i.frequency, duration: i.duration, instructions: i.instructions,
        })),
      } : null,
      ordered_tests: tests.map(t => ({
        test_name: t.test_name, status: t.status, result: t.result, unit: t.unit, abnormal_flag: t.abnormal_flag, completed_at: t.completed_at,
      })),
      completed_reports: tests.filter(t => t.status === 'completed' && t.result).map(t => ({
        test_name: t.test_name, result: t.result, unit: t.unit, abnormal_flag: t.abnormal_flag, completed_at: t.completed_at,
      })),
      last_visit_doctor: doctorMap.get(row.patient_id) ?? null,
    };
  });

  return c.json({ patients });
});

// ─── POST /doctors/dashboard/report-show/:appointmentId/review ─────────────
doctorRoutes.post('/dashboard/report-show/:appointmentId/review', async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const appointmentId = Number(c.req.param('appointmentId'));

  const body = await c.req.json<{ notes?: string }>().catch((): { notes?: string } => ({}));
  const notes = body.notes?.substring(0, 1000) || '';

  const appt = await db.$client.prepare(
    `SELECT id, status, doctor_id, appointment_type FROM appointments WHERE id = ? AND tenant_id = ?`
  ).bind(appointmentId, tenantId).first<{ id: number; status: string; doctor_id: number; appointment_type: string }>();

  if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });
  if (appt.appointment_type !== 'report_show') {
    throw new HTTPException(409, { message: 'Only report-show appointments can be closed as reviewed' });
  }
  if (['completed', 'cancelled'].includes(appt.status)) {
    throw new HTTPException(409, { message: 'Appointment already closed' });
  }

  // Verify doctor ownership — only the assigned doctor can review
  const doctor = await db.$client.prepare(
    `SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ?`
  ).bind(userId, tenantId).first<{ id: number }>();
  if (!doctor || doctor.id !== appt.doctor_id) {
    throw new HTTPException(403, { message: 'Not your appointment' });
  }

  const reviewNote = `[Report reviewed]${notes ? ' ' + notes : ''}`;
  const routeContext = await buildAppointmentRouteContext(c.env.DB, {
    tenantId,
    legacyAppointmentId: appointmentId,
  });
  const latestVisit = await db.$client.prepare(`
    SELECT id FROM visits
    WHERE appointment_id=? AND tenant_id=?
    ORDER BY id DESC
    LIMIT 1
  `).bind(appointmentId, tenantId).first<{ id: number }>();
  const encounterPublicId = await resolveAppointmentRouteEncounter(c.env.DB, tenantId, [
    ...(latestVisit?.id ? [{ sourceType: 'legacy_visit', sourcePublicId: String(latestVisit.id) }] : []),
    { sourceType: 'legacy_appointment', sourcePublicId: String(appointmentId) },
  ]);
  const authoritativeStatements = [
    db.$client.prepare(
      `UPDATE appointments SET status = 'completed', notes = COALESCE(notes || char(10), '') || ?, canonical_source_key = COALESCE(canonical_source_key, ?), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(reviewNote, routeContext.sourcePublicId, appointmentId, tenantId),
    db.$client.prepare(
      `UPDATE queue_entries SET status = 'completed', updated_at = datetime('now', '+6 hours') WHERE appointment_id = ? AND tenant_id = ?`
    ).bind(appointmentId, tenantId),
    db.$client.prepare(
      `UPDATE visits SET status = 'completed', updated_at = datetime('now', '+6 hours') WHERE appointment_id = ? AND tenant_id = ?`
    ).bind(appointmentId, tenantId),
    prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'appointments',
      recordId: appointmentId,
      oldValue: appt,
      newValue: {
        source: 'doctor_report_show_review',
        status: 'completed',
        reviewRecorded: true,
        encounterPublicId,
        canonicalSourceKey: routeContext.sourcePublicId,
      },
      ...auditRequestMetadata(c),
    }),
  ];
  const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
  await fulfilRouteAppointment(c.env.DB, routeContext, {
    encounterPublicId,
    authoritativeStatements,
    actorSystemKey: 'canonical.appointment.report-review',
    actorUserPublicId: String(userId),
    occurredAtUtc: new Date().toISOString(),
    businessDate: getTodayGMT6(),
    idempotencyKey: suppliedIdempotencyKey
      ? `route:doctor-report-review:${suppliedIdempotencyKey}`
      : `route:doctor-report-review:${appointmentId}:${routeContext.sourceEvidenceSha256}`,
    reasonCode: 'doctor_report_review_completed',
  });

  return c.json({ success: true, message: 'Report reviewed' });
});

// GET /api/doctors/stats/:id — admin view of doctor stats
doctorRoutes.get('/stats/:id', async (c) => {
  requireSpecificRole(c, ...DOCTOR_STATS_ROLES);
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = Number(c.req.param('id'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    throw new HTTPException(400, { message: 'Invalid doctor id' });
  }

  const today = getTodayGMT6();
  const thisMonthStart = monthStart(today);
  const nextMonthStart = shiftMonthStart(today, 1);
  const lastMonthStart = shiftMonthStart(today, -1);

  const totalPatients = await safeFirst<{ count: number }>(db.$client.prepare(`
    SELECT COUNT(DISTINCT patient_id) as count FROM appointments
    WHERE doctor_id = ? AND tenant_id = ? AND status != 'cancelled'
  `).bind(doctorId, tenantId));

  const thisMonth = await safeFirst<{ count: number }>(db.$client.prepare(`
    SELECT COUNT(*) as count FROM appointments
    WHERE doctor_id = ? AND tenant_id = ? AND appt_date >= ? AND appt_date < ? AND status != 'cancelled'
  `).bind(doctorId, tenantId, thisMonthStart, nextMonthStart));

  const lastMonth = await safeFirst<{ count: number }>(db.$client.prepare(`
    SELECT COUNT(*) as count FROM appointments
    WHERE doctor_id = ? AND tenant_id = ? AND appt_date >= ? AND appt_date < ? AND status != 'cancelled'
  `).bind(doctorId, tenantId, lastMonthStart, thisMonthStart));

  const revenue = await safeFirst<{ total: number }>(db.$client.prepare(`
    SELECT SUM(a.final_fee) as total FROM appointments a
    WHERE a.doctor_id = ? AND a.tenant_id = ? AND a.appt_date >= ? AND a.appt_date < ?
      AND a.billing_status = 'paid'
  `).bind(doctorId, tenantId, thisMonthStart, nextMonthStart));

  return c.json({
    totalPatients: totalPatients?.count ?? 0,
    thisMonth: thisMonth?.count ?? 0,
    lastMonth: lastMonth?.count ?? 0,
    revenueThisMonth: revenue?.total ?? 0,
  });
});

// GET /api/doctors/:id
doctorRoutes.get('/:id', async (c) => {
  requireSpecificRole(c, 'hospital_admin', 'doctor', 'reception', 'nurse', 'md');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const doctor = await db.$client.prepare(
      'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

    // Fetch shifts
    const shifts = await db.$client.prepare(
      `SELECT * FROM doctor_shifts WHERE doctor_id = ? AND tenant_id = ? AND is_active = 1 ORDER BY day_of_week, start_time`
    ).bind(id, tenantId).all();

    // Fetch availability overrides for next 30 days
    const overrides = await db.$client.prepare(
      `SELECT * FROM doctor_availability WHERE doctor_id = ? AND tenant_id = ? AND date >= date('now', '+6 hours') AND date <= date('now', '+30 days') ORDER BY date`
    ).bind(id, tenantId).all();

    return c.json({
      doctor,
      shifts: shifts.results,
      availability: overrides.results,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch doctor' });
  }
});

// GET /api/doctors/:id/ipd-round-fee — quick fee lookup used by IPDWorkspace before
// signing a clinical round note. Returns configured flag + amount.
doctorRoutes.get('/:id/ipd-round-fee', async (c) => {
  requireSpecificRole(c, 'hospital_admin', 'doctor', 'md', 'director');
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const doctor = await getDb(c.env.DB).$client.prepare(
    `SELECT id, ipd_round_fee, is_active
     FROM doctors WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).first<{ id: number; ipd_round_fee: number; is_active: number }>();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });
  const fee = Number(doctor.ipd_round_fee ?? 0);
  return c.json({
    doctorId: doctor.id,
    fee,
    configured: fee > 0 && doctor.is_active === 1,
  });
});

// POST /api/doctors — create doctor
doctorRoutes.post('/', zValidator('json', createDoctorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireSpecificRole(c, 'hospital_admin');
  const data = c.req.valid('json');
  const consultationFee = normalizeConsultationFee(data.consultationFee);

  try {
    const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
    const sourcePublicId = await createDoctorSourceKey(tenantId, suppliedIdempotencyKey);
    const practitionerContext = await buildPractitionerRouteContext(c.env.DB, {
      tenantId,
      sourcePublicId,
      snapshot: doctorPractitionerSnapshot({
        name: data.name,
        specialty: data.specialty,
        department: data.department,
        bmdcRegNo: data.bmdcRegNo,
        userId: null,
        isActive: true,
      }),
    });
    const legacyInsert = c.env.DB.prepare(
      `INSERT INTO doctors (name, specialty, mobile_number, consultation_fee, ipd_round_fee, public_bio, languages, bmdc_reg_no, qualifications,
        email, department, bio, photo_key, is_available, display_order, visiting_hours, is_marketplace_visible, is_active, tenant_id, canonical_source_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      data.name,
      data.specialty ?? null,
      data.mobileNumber ?? null,
      consultationFee,
      data.ipdRoundFee ?? 0,
      data.publicBio ?? null,
      data.languages ? JSON.stringify(data.languages) : null,
      data.bmdcRegNo ?? null,
      data.qualifications ?? null,
      data.email ?? null,
      data.department ?? null,
      data.bio ?? null,
      data.photoKey ?? null,
      data.isAvailable ? 1 : 0,
      data.displayOrder ?? 0,
      data.visitingHours ?? null,
      data.publishToMarketplace ? 1 : 0,
      tenantId,
      sourcePublicId,
    );
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'CREATE',
      tableName: 'doctors',
      recordId: sourcePublicId,
      oldValue: null,
      newValue: { ...data, canonicalSourceKey: sourcePublicId },
      ...auditRequestMetadata(c),
    });
    await createRoutePractitioner(c.env.DB, practitionerContext, {
      authoritativeStatements: [legacyInsert, audit],
      occurredAtUtc: new Date().toISOString(),
      businessDate: getTodayGMT6(),
      idempotencyKey: `route:doctor:create:${suppliedIdempotencyKey ?? sourcePublicId}`,
    });
    const created = await c.env.DB.prepare(`
      SELECT id FROM doctors
      WHERE tenant_id=? AND canonical_source_key=?
      LIMIT 1
    `).bind(tenantId, sourcePublicId).first<{ id: number }>();
    if (!created?.id) throw new Error('Created doctor could not be resolved');
    const doctorId = Number(created.id);

    // Re-render hospital site (non-blocking)
    triggerSiteReRender(c, tenantId);

    return c.json({
      message: 'Doctor added',
      id: doctorId,
      marketplacePublished: data.publishToMarketplace ?? false,
    }, 201);
  } catch {
    throw new HTTPException(500, { message: 'Failed to add doctor' });
  }
});

// PUT /api/doctors/:id — update doctor
doctorRoutes.put('/:id', zValidator('json', updateDoctorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const callerRole = c.get('role');
  const id = c.req.param('id');
  const data = c.req.valid('json');

  // Resolve target doctor
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new HTTPException(400, { message: 'Invalid doctor id' });
  }
  const targetDoctor = await db.$client.prepare(
    'SELECT id, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(targetId, tenantId).first<{ id: number; user_id: number | null }>();
  if (!targetDoctor) throw new HTTPException(404, { message: 'Doctor not found' });

  if (callerRole === 'doctor') {
    // Self-edit: only allowed on own record
    if (targetDoctor.user_id !== Number(userId)) {
      throw new HTTPException(403, { message: 'You may only edit your own doctor profile' });
    }
  } else if (callerRole !== 'hospital_admin') {
    throw new HTTPException(403, { message: 'Insufficient permission' });
  }

  // Field allowlist: doctors can NOT change admin-controlled fields
  // (activation, marketplace visibility, display order, availability).
  // Admin-only: isActive, isMarketplaceVisible, displayOrder, isAvailable, publishToMarketplace.
  const forbiddenForDoctor: ReadonlyArray<string> = [
    'isActive',
    'isMarketplaceVisible',
    'displayOrder',
    'isAvailable',
    'publishToMarketplace',
    'ipdRoundFee',
  ];
  if (callerRole === 'doctor') {
    for (const field of forbiddenForDoctor) {
      if ((data as Record<string, unknown>)[field] !== undefined) {
        delete (data as Record<string, unknown>)[field];
      }
    }
  }

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Doctor not found' });
    const consultationFee = data.consultationFee !== undefined
      ? normalizeConsultationFee(data.consultationFee)
      : normalizeConsultationFee(existing['consultation_fee']);
    const ipdRoundFee = data.ipdRoundFee !== undefined
      ? data.ipdRoundFee
      : Number(existing['ipd_round_fee'] ?? 0);

    // Handle photo cleanup if it changed
    if (data.photoKey !== undefined && data.photoKey !== existing['photo_key']) {
      const oldKey = existing['photo_key'] as string;
      if (oldKey && oldKey.startsWith(`doctors/${tenantId}/`)) {
        c.executionCtx.waitUntil(c.env.UPLOADS.delete(oldKey).catch(() => {}));
      }
    }

    const sourcePublicId = String(existing['canonical_source_key'] ?? '').trim() || String(targetId);
    const currentSnapshot = doctorPractitionerSnapshot({
      name: existing['name'],
      specialty: existing['specialty'],
      department: existing['department'],
      bmdcRegNo: existing['bmdc_reg_no'],
      userId: existing['user_id'],
      isActive: existing['is_active'],
    });
    const nextSnapshot = doctorPractitionerSnapshot({
      name: data.name ?? existing['name'],
      specialty: data.specialty !== undefined ? data.specialty : existing['specialty'],
      department: data.department !== undefined ? data.department : existing['department'],
      bmdcRegNo: data.bmdcRegNo !== undefined ? data.bmdcRegNo : existing['bmdc_reg_no'],
      userId: existing['user_id'],
      isActive: existing['is_active'],
    });
    const legacyUpdate = c.env.DB.prepare(
      `UPDATE doctors SET name = ?, specialty = ?, mobile_number = ?, consultation_fee = ?, ipd_round_fee = ?,
        public_bio = ?, languages = ?, bmdc_reg_no = ?, qualifications = ?,
        email = ?, department = ?, bio = ?, photo_key = ?, is_available = ?, display_order = ?,
        visiting_hours = ?, is_marketplace_visible = ?, canonical_source_key = COALESCE(canonical_source_key, ?),
        updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`,
    ).bind(
      data.name              ?? existing['name'],
      data.specialty         !== undefined ? data.specialty        : existing['specialty'],
      data.mobileNumber      !== undefined ? data.mobileNumber     : existing['mobile_number'],
      consultationFee,
      ipdRoundFee,
      data.publicBio         !== undefined ? data.publicBio       : existing['public_bio'],
      data.languages         !== undefined ? JSON.stringify(data.languages) : existing['languages'],
      data.bmdcRegNo         !== undefined ? data.bmdcRegNo       : existing['bmdc_reg_no'],
      data.qualifications    !== undefined ? data.qualifications  : existing['qualifications'],
      data.email             !== undefined ? data.email           : existing['email'],
      data.department        !== undefined ? data.department      : existing['department'],
      data.bio               !== undefined ? data.bio             : existing['bio'],
      data.photoKey          !== undefined ? data.photoKey        : existing['photo_key'],
      data.isAvailable       !== undefined ? (data.isAvailable ? 1 : 0) : existing['is_available'],
      data.displayOrder      !== undefined ? data.displayOrder   : existing['display_order'],
      data.visitingHours     !== undefined ? data.visitingHours    : existing['visiting_hours'],
      data.isMarketplaceVisible !== undefined ? (data.isMarketplaceVisible ? 1 : 0) : existing['is_marketplace_visible'],
      sourcePublicId,
      id, tenantId,
    );
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'doctors',
      recordId: Number(id),
      oldValue: existing,
      newValue: { ...data, canonicalSourceKey: sourcePublicId },
      ...auditRequestMetadata(c),
    });
    if (practitionerIdentityChanged(currentSnapshot, nextSnapshot)) {
      const currentContext = await buildPractitionerRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        snapshot: currentSnapshot,
      });
      const nextContext = await buildPractitionerRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        snapshot: nextSnapshot,
      });
      const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
      await updateRoutePractitioner(c.env.DB, currentContext, nextContext, {
        authoritativeStatements: [legacyUpdate, audit],
        occurredAtUtc: new Date().toISOString(),
        businessDate: getTodayGMT6(),
        idempotencyKey: `route:doctor:update:${suppliedIdempotencyKey ?? `${sourcePublicId}:${nextContext.sourceEvidenceSha256}`}`,
      });
    } else {
      await runPractitionerProjectionCompatibility(c.env.DB, [legacyUpdate, audit]);
    }

    // Re-render hospital site (non-blocking)
    triggerSiteReRender(c, tenantId);

    return c.json({ message: 'Doctor updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update doctor' });
  }
});

// POST /api/doctors/:id/publish — publish doctor to marketplace
doctorRoutes.post('/:id/publish', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireSpecificRole(c, 'hospital_admin');
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first();
    if (!existing) throw new HTTPException(404, { message: 'Doctor not found' });

    const userId = requireUserId(c);

    const legacyUpdate = c.env.DB.prepare(
      `UPDATE doctors SET is_marketplace_visible = 1, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId);
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'doctors',
      recordId: Number(id),
      oldValue: existing,
      newValue: { is_marketplace_visible: 1 },
      ...auditRequestMetadata(c),
    });
    await runPractitionerProjectionCompatibility(c.env.DB, [legacyUpdate, audit]);

    // Re-render hospital site (non-blocking)
    triggerSiteReRender(c, tenantId);

    return c.json({ message: 'Doctor published to marketplace' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to publish doctor' });
  }
});

// PUT /api/doctors/:id/activate — reactivate doctor
doctorRoutes.put('/:id/activate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireSpecificRole(c, 'hospital_admin');
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first();
    if (!existing) throw new HTTPException(404, { message: 'Doctor not found' });

    const sourcePublicId = String(existing['canonical_source_key'] ?? '').trim() || String(Number(id));
    const currentSnapshot = doctorPractitionerSnapshot({
      name: existing['name'],
      specialty: existing['specialty'],
      department: existing['department'],
      bmdcRegNo: existing['bmdc_reg_no'],
      userId: existing['user_id'],
      isActive: existing['is_active'],
    });
    const nextSnapshot = { ...currentSnapshot, isActive: true };
    const legacyUpdate = c.env.DB.prepare(
      `UPDATE doctors SET is_active = 1, canonical_source_key = COALESCE(canonical_source_key, ?), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(sourcePublicId, id, tenantId);
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'doctors',
      recordId: Number(id),
      oldValue: existing,
      newValue: { is_active: 1, canonicalSourceKey: sourcePublicId },
      ...auditRequestMetadata(c),
    });
    if (practitionerIdentityChanged(currentSnapshot, nextSnapshot)) {
      const currentContext = await buildPractitionerRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        snapshot: currentSnapshot,
      });
      const nextContext = await buildPractitionerRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        snapshot: nextSnapshot,
      });
      const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
      await updateRoutePractitioner(c.env.DB, currentContext, nextContext, {
        authoritativeStatements: [legacyUpdate, audit],
        occurredAtUtc: new Date().toISOString(),
        businessDate: getTodayGMT6(),
        idempotencyKey: `route:doctor:activate:${suppliedIdempotencyKey ?? `${sourcePublicId}:${nextContext.sourceEvidenceSha256}`}`,
      });
    } else {
      await runPractitionerProjectionCompatibility(c.env.DB, [legacyUpdate, audit]);
    }
    triggerSiteReRender(c, tenantId);
    return c.json({ success: true });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to activate doctor' });
  }
});

// PUT /api/doctors/:id/deactivate — soft deactivate
doctorRoutes.put('/:id/deactivate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireSpecificRole(c, 'hospital_admin');
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first();
    if (!existing) throw new HTTPException(404, { message: 'Doctor not found' });

    const sourcePublicId = String(existing['canonical_source_key'] ?? '').trim() || String(Number(id));
    const currentSnapshot = doctorPractitionerSnapshot({
      name: existing['name'],
      specialty: existing['specialty'],
      department: existing['department'],
      bmdcRegNo: existing['bmdc_reg_no'],
      userId: existing['user_id'],
      isActive: existing['is_active'],
    });
    const nextSnapshot = { ...currentSnapshot, isActive: false };
    const legacyUpdate = c.env.DB.prepare(
      `UPDATE doctors SET is_active = 0, canonical_source_key = COALESCE(canonical_source_key, ?), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(sourcePublicId, id, tenantId);
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'doctors',
      recordId: Number(id),
      oldValue: existing,
      newValue: { is_active: 0, canonicalSourceKey: sourcePublicId },
      ...auditRequestMetadata(c),
    });
    if (practitionerIdentityChanged(currentSnapshot, nextSnapshot)) {
      const currentContext = await buildPractitionerRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        snapshot: currentSnapshot,
      });
      const nextContext = await buildPractitionerRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        snapshot: nextSnapshot,
      });
      const suppliedIdempotencyKey = routeIdempotencyKey(c.req);
      await updateRoutePractitioner(c.env.DB, currentContext, nextContext, {
        authoritativeStatements: [legacyUpdate, audit],
        occurredAtUtc: new Date().toISOString(),
        businessDate: getTodayGMT6(),
        idempotencyKey: `route:doctor:deactivate:${suppliedIdempotencyKey ?? `${sourcePublicId}:${nextContext.sourceEvidenceSha256}`}`,
      });
    } else {
      await runPractitionerProjectionCompatibility(c.env.DB, [legacyUpdate, audit]);
    }
    triggerSiteReRender(c, tenantId);
    return c.json({ success: true });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to deactivate doctor' });
  }
});

// GET /api/doctors/:id/invitations — list invitations for one doctor
doctorRoutes.get('/:id/invitations', async (c) => {
  const tenantId = requireTenantId(c);
  const callerRole = c.get('role');
  if (callerRole !== 'hospital_admin' && callerRole !== 'md' && callerRole !== 'director') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const db = getDb(c.env.DB);
  const doctorId = Number(c.req.param('id'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    return c.json({ error: 'Invalid doctor id' }, 400);
  }

  try {
    const doctor = await db.$client.prepare(
      'SELECT id, name, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
    ).bind(doctorId, tenantId).first<{ id: number; name: string; user_id: number | null }>();
    if (!doctor) return c.json({ error: 'Doctor not found' }, 404);

    const { results } = await db.$client.prepare(
      `SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at, token
       FROM invitations
       WHERE tenant_id = ? AND doctor_id = ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(tenantId, doctorId).all();

    const now = new Date();
    const invitations = (results as Array<Record<string, unknown>>).map((row) => {
      const status = row.accepted_at
        ? 'accepted'
        : row.revoked_at
          ? 'revoked'
          : new Date(row.expires_at as string) < now
            ? 'expired'
            : 'pending';
      return { ...row, status };
    });

    return c.json({ doctor, invitations });
  } catch (error) {
    console.error('Doctor invitations error:', error);
    return c.json({ error: 'Failed to fetch invitations' }, 500);
  }
});

// POST /api/doctors/:id/invite — send an invite to a specific doctor profile
doctorRoutes.post('/:id/invite', requirePermission('staff:write'), async (c) => {
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);

  const doctorId = Number(c.req.param('id'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    return c.json({ error: 'Invalid doctor id' }, 400);
  }
  const body = await c.req.json().catch(() => ({})) as { email?: string };
  const requestedEmail = (body.email ?? '').trim();
  if (requestedEmail) {
    const parsedEmail = z.string().email('Valid email required').safeParse(requestedEmail);
    if (!parsedEmail.success) {
      return c.json({ error: parsedEmail.error.issues[0]?.message ?? 'Invalid email' }, 400);
    }
  }

  const db = getDb(c.env.DB);
  const doctor = await db.$client.prepare(
    'SELECT id, name, email, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(doctorId, tenantId).first<{ id: number; name: string; email: string | null; user_id: number | null }>();
  if (!doctor) return c.json({ error: 'Doctor not found' }, 404);
  if (doctor.user_id) return c.json({ error: 'Doctor already linked to a user' }, 409);

  const email = requestedEmail || doctor.email?.trim() || null;

  if (email) {
    const existingUser = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
    ).bind(email, tenantId).first();
    if (existingUser) return c.json({ error: 'Email already registered' }, 409);

    const existingEmailInvite = await db.$client.prepare(
      'SELECT id FROM invitations WHERE email = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > datetime("now")'
    ).bind(email, tenantId).first();
    if (existingEmailInvite) return c.json({ error: 'Pending invitation already exists for this email' }, 409);
  }

  const existingDoctorInvite = await db.$client.prepare(
    'SELECT id FROM invitations WHERE doctor_id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > datetime("now")'
  ).bind(doctorId, tenantId).first();
  if (existingDoctorInvite) return c.json({ error: 'Pending invitation already exists for this doctor' }, 409);

  const cryptoRandom = (len: number) => {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const sha = async (s: string) => {
    const enc = new TextEncoder().encode(s);
    const d = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const newToken = cryptoRandom(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  let inviteId: number;
  try {
    const result = await db.$client.prepare(
      `INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, doctor_id)
       VALUES (?, ?, 'doctor', ?, ?, ?, ?)`
    ).bind(tenantId, email, await sha(newToken), callerId ?? 0, expiresAt, doctorId).run();
    inviteId = result.meta.last_row_id as number;

    await createAuditLog(c.env, tenantId, callerId ?? 0, 'CREATE', 'invitations',
      inviteId, null,
      { email, role: 'doctor', doctorId, doctorName: doctor.name },
      c.req.header('CF-Connecting-IP') ?? undefined,
      c.req.header('user-agent') ?? undefined,
    );
  } catch (error) {
    console.error('Doctor invite error:', error);
    return c.json({ error: 'Failed to create invitation' }, 500);
  }

  const tenant = await db.$client.prepare('SELECT subdomain, name FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ subdomain: string; name: string }>();
  const inviteLink = buildInvitePath(tenant?.subdomain, newToken);
  const inviteUrl = buildAbsoluteInviteUrl(c.env.HMS_APP_URL ?? new URL(c.req.url).origin, inviteLink);
  const inviter = await db.$client.prepare('SELECT name FROM users WHERE id = ? AND tenant_id = ?')
    .bind(callerId ?? 0, tenantId).first<{ name: string }>();
  const emailResult = email
    ? await sendEmail(c.env, {
      to: email,
      ...EmailTemplates.staffInvite({
        inviteeName: doctor.name,
        inviterName: inviter?.name ?? 'Hospital Admin',
        role: 'doctor',
        hospitalName: tenant?.name ?? 'HMS',
        inviteUrl,
      }),
    })
    : { success: false, error: 'Doctor email is missing' };

  return c.json({
    invite: {
      email,
      role: 'doctor',
      doctorId,
      doctorName: doctor.name,
      expiresAt,
      inviteLink,
      emailSent: emailResult.success,
      emailError: emailResult.success ? undefined : emailResult.error,
    },
  }, 201);
});

export default doctorRoutes;

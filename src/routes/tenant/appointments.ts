import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { eq, and, sql } from 'drizzle-orm';
import {
  appointmentFeePreviewSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  upsertDoctorAppointmentFeesSchema,
} from '../../schemas/appointment';
import { paymentMethodSchema } from '../../schemas/billing';
import { getNextSequence } from '../../lib/sequence';
import { getNextInvoiceNumber } from '../../lib/invoice-sequence';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import { normalizeConsultationFee } from '../../lib/doctor-fees';
import { formatDoctorName } from '../../lib/doctor-display';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { assertDiscountReferralNameForHighDiscount } from '../../lib/discount-policy';
import {
  appointmentTypeToVisitType,
  APPOINTMENT_TYPES,
  calculateAppointmentCharge,
  normalizeAppointmentType,
  type AppointmentCharge,
  type AppointmentType,
} from '../../lib/appointment-daily-flow';
import { postPendingAccountingEvents } from '../../lib/accounting-posting';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import { assertNoSameDoctorVisitToday } from '../../lib/visit-guards';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { issueInvoice } from '../../lib/canonical/commands/issue-invoice';
import { issueInvoiceWithFullPayment } from '../../lib/canonical/commands/issue-invoice-full-payment';
import {
  buildAppointmentFullPaymentProjection,
  buildAppointmentInvoiceProjection,
} from '../../lib/canonical/live-appointment-billing';
import { isFinancialBatchAssertionError } from '../../lib/canonical/financial-batch-assertion';
import { prepareAppointmentBillingLegacyStatements } from '../../lib/canonical/appointment-billing-finalization';
import { getDb } from '../../db';
import { appointments } from '../../db/schema';
import { requirePermission } from '../../middleware/rbac';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { evaluateBillingSchemeEligibility, recordBillingSchemeUsage } from '../../lib/billing-scheme-eligibility';


async function getNextAvailableToken(
  db: D1Database,
  tenantId: string,
  doctorId: number | null,
  apptDate: string,
): Promise<number> {
  const { results: ranges } = await db.prepare(`
    SELECT token_from, token_to FROM token_reservations
    WHERE tenant_id = ? AND is_active = 1
      AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
      AND ? BETWEEN reservation_date AND end_date
    ORDER BY token_from ASC
  `).bind(tenantId, doctorId ?? null, doctorId ?? null, apptDate).all();

  const tokenRow = await db.prepare(`
    SELECT COALESCE(MAX(token_no), 0) AS max_token
    FROM appointments
    WHERE tenant_id = ? AND appt_date = ? AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
  `).bind(tenantId, apptDate, doctorId ?? null, doctorId ?? null).first<{ max_token: number }>();

  const currentMax = tokenRow?.max_token ?? 0;
  let candidate = currentMax + 1;

  if (ranges.length === 0) return candidate;

  const reservedRanges = ranges as Array<{ token_from: number; token_to: number }>;

  while (true) {
    const isReserved = reservedRanges.some(r => candidate >= r.token_from && candidate <= r.token_to);
    if (!isReserved) return candidate;
    candidate++;
  }
}


function isCashPaymentMethod(value: unknown): boolean {
  const normalized = String(value ?? 'cash').trim().toLowerCase();
  return normalized === '' || normalized === 'cash' || normalized === 'cash payment';
}

async function shadowWriteAppointmentPaymentCollection(params: {
  db: D1Database;
  tenantId: string;
  billId: number;
  invoiceNo: string;
  receiptNo: string;
  appointmentId: number;
  patientId: number;
  doctorId?: number | null;
  amount: number;
  paymentMethod: string;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  externalTransactionId?: string | null;
}) {
  if (!isCashPaymentMethod(params.paymentMethod)) return;
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'appointment_payment',
    sourceId: params.receiptNo,
    sourceNo: params.receiptNo,
    eventType: 'APPOINTMENT_PAYMENT_RECEIVED',
    movementDirection: 'in',
    cashStatus: 'IN_DRAWER',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: params.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: params.patientId,
    toUserId: Number(params.userId),
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'drawer',
    currentLocationLabel: `Counter session #${params.counterSessionId}`,
    referenceType: 'appointment',
    referenceId: params.appointmentId,
    note: `Appointment payment ${params.receiptNo} for ${params.invoiceNo}`,
    metadata: {
      invoiceNo: params.invoiceNo,
      receiptNo: params.receiptNo,
      appointmentId: params.appointmentId,
      patientId: params.patientId,
      doctorId: params.doctorId ?? null,
      billId: params.billId,
      externalTransactionId: params.externalTransactionId ?? null,
      shadowSource: 'appointment_pay_now',
    },
    idempotencyKey: `cash-ledger:appointment-payment:${params.receiptNo}:received`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
  });
}

const appointmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
type AppointmentContext = Context<{ Bindings: Env; Variables: Variables }>;

const appointmentSchemeApplicationSchema = z.object({
  schemeId: z.number().int().positive().optional(),
  schemeCode: z.string().trim().max(80).optional(),
  memberCode: z.string().trim().max(80).optional(),
  memberId: z.number().int().positive().optional(),
  serviceCategory: z.string().trim().max(80).optional(),
  allocationType: z.string().trim().max(80).optional(),
  suggestedDiscount: z.number().min(0).optional(),
}).strict().refine((value) => Boolean(value.schemeId || value.schemeCode || value.memberCode || value.memberId), {
  message: 'Provide a scheme, member code, or member id',
});

const appointmentPayNowSchema = z.object({
  paymentMethod: paymentMethodSchema.default('cash'),
  externalTransactionId: z.string().trim().min(3).max(128).optional(),
  remarks: z.string().trim().max(500).optional(),
  discountByName: z.string().trim().max(200).optional(),
  schemeApplication: appointmentSchemeApplicationSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const appointmentCreditApprovalSchema = z.object({
  remarks: z.string().trim().max(500).optional(),
  discountByName: z.string().trim().max(200).optional(),
});

type AppointmentBillingRow = {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  appt_no: string;
  appt_date: string;
  appt_time: string | null;
  visit_type: string;
  status: string;
  fee: number | null;
  appointment_type: string | null;
  original_fee: number | null;
  discount_amount: number | null;
  final_fee: number | null;
  discount_reason: string | null;
  discount_by_name: string | null;
  billing_status: string | null;
  patient_name: string;
  patient_code: string | null;
  doctor_name: string | null;
  doctor_specialty: string | null;
  doctor_department: string | null;
  consultation_fee: number | null;
  visit_id: number | null;
};

type AppointmentProvisionalItem = {
  id: number;
  patient_id: number;
  visit_id: number | null;
  item_category: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  discount_amount: number | null;
  total_amount: number;
  doctor_id: number | null;
  reference_id: number | null;
};

type AppointmentEligibility = {
  eligible: boolean;
  appointmentType: AppointmentType;
  windowDays: number;
  cutoffDate: string;
  lastVisitDate: string | null;
  lastDoctorId: number | null;
  reason: string | null;
};

function queueAppointmentAccountingPosting(c: AppointmentContext, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post appointment billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function appointmentCanEnterDoctorQueue(status: string | null | undefined): boolean {
  return ['paid', 'due_approved', 'no_charge'].includes(status ?? '');
}

const APPOINTMENT_CHARGE_OVERRIDE_ROLES = new Set(['hospital_admin', 'md', 'director', 'accountant', 'reception']);
const APPOINTMENT_ELIGIBILITY_OVERRIDE_ROLES = new Set(['hospital_admin', 'md', 'director']);
const APPOINTMENT_PAY_NOW_MUTATION_TYPE = 'appointment_pay_now';

function assertAppointmentChargeOverrideAllowed(
  c: AppointmentContext,
  appointmentType: AppointmentType,
  discountAmount: number,
): void {
  if (appointmentType !== 'free_visit' && discountAmount <= 0) return;
  if (APPOINTMENT_CHARGE_OVERRIDE_ROLES.has(c.get('role') ?? '')) return;
  throw new HTTPException(403, { message: 'Not authorized to discount or free appointment fees' });
}

function assertDoctorFeeSetupAllowed(c: AppointmentContext): void {
  if (APPOINTMENT_CHARGE_OVERRIDE_ROLES.has(c.get('role') ?? '')) return;
  throw new HTTPException(403, { message: 'Not authorized to configure doctor appointment fees' });
}

async function loadDoctorForFeeSetup(
  d1: D1Database,
  tenantId: string,
  doctorId: number,
): Promise<{ id: number; name: string; consultation_fee: number | null } | null> {
  return d1.prepare(`
    SELECT id, name, consultation_fee
    FROM doctors
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(doctorId, tenantId).first<{ id: number; name: string; consultation_fee: number | null }>();
}

function dateMinusDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date.toISOString().slice(0, 10);
}

function defaultEligibilityDays(appointmentType: AppointmentType): number {
  if (appointmentType === 'report_show') return 7;
  if (appointmentType === 'old_patient') return 30;
  return 0;
}

function normalizeEligibilityDays(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

async function resolveAppointmentEligibilityDays(
  d1: D1Database,
  tenantId: string,
  doctorId: number | null | undefined,
  appointmentType: AppointmentType,
): Promise<number> {
  const fallback = defaultEligibilityDays(appointmentType);
  if (!fallback || !doctorId) return fallback;

  try {
    const feeSetup = await d1.prepare(`
      SELECT eligibility_days
      FROM doctor_appointment_fees
      WHERE tenant_id = ?
        AND doctor_id = ?
        AND appointment_type = ?
        AND COALESCE(is_active, 1) = 1
      ORDER BY id DESC
      LIMIT 1
    `).bind(tenantId, doctorId, appointmentType).first<{ eligibility_days: number | null }>();
    return normalizeEligibilityDays(feeSetup?.eligibility_days, fallback);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such (table|column): doctor_appointment_fees|no such column: eligibility_days/i.test(message)) {
      return fallback;
    }
    throw error;
  }
}

async function evaluateAppointmentEligibility(
  d1: D1Database,
  input: {
    tenantId: string;
    patientId: number;
    doctorId: number | null | undefined;
    appointmentType: AppointmentType;
    apptDate: string;
  },
): Promise<AppointmentEligibility> {
  const windowDays = await resolveAppointmentEligibilityDays(
    d1,
    input.tenantId,
    input.doctorId,
    input.appointmentType,
  );
  const cutoffDate = windowDays > 0 ? dateMinusDays(input.apptDate, windowDays) : input.apptDate;

  if (input.appointmentType !== 'report_show' && input.appointmentType !== 'old_patient') {
    return {
      eligible: true,
      appointmentType: input.appointmentType,
      windowDays,
      cutoffDate,
      lastVisitDate: null,
      lastDoctorId: null,
      reason: null,
    };
  }

  if (input.appointmentType === 'report_show' && !input.doctorId) {
    return {
      eligible: false,
      appointmentType: input.appointmentType,
      windowDays,
      cutoffDate,
      lastVisitDate: null,
      lastDoctorId: null,
      reason: 'Select the original doctor before creating a report-show serial',
    };
  }

  const lastVisit = input.appointmentType === 'report_show'
    ? await d1.prepare(`
        SELECT base.visit_date, base.doctor_id
        FROM (
          SELECT
            COALESCE(v.visit_date, date(v.created_at)) AS visit_date,
            v.doctor_id,
            COALESCE(a.appointment_type, '') AS appointment_type
          FROM visits v
          LEFT JOIN appointments a ON a.id = v.appointment_id AND a.tenant_id = v.tenant_id
          WHERE v.tenant_id = ?
            AND v.patient_id = ?
            AND COALESCE(v.visit_date, date(v.created_at)) BETWEEN ? AND ?
            AND COALESCE(v.status, '') IN ('completed', 'concluded', 'closed', 'discharged')
        ) base
        WHERE COALESCE(base.appointment_type, '') != 'report_show'
          AND base.doctor_id = ?
        ORDER BY base.visit_date DESC
        LIMIT 1
      `).bind(
        input.tenantId,
        input.patientId,
        cutoffDate,
        input.apptDate,
        Number(input.doctorId),
      ).first<{ visit_date: string | null; doctor_id: number | null }>()
    : await d1.prepare(`
        /* returning_patient_positive_payment */
        WITH paid_doctor_visits AS (
          SELECT DISTINCT
            COALESCE(a.appt_date, v.visit_date, date(b.created_at), date(p.date)) AS visit_date,
            COALESCE(a.doctor_id, v.doctor_id) AS doctor_id,
            COALESCE(a.appointment_type, '') AS appointment_type
          FROM bills b
          JOIN payments p
            ON p.bill_id = b.id
           AND p.tenant_id = b.tenant_id
           AND p.amount > 0
          LEFT JOIN billing_provisional_items bp
            ON bp.billed_bill_id = b.id
           AND bp.tenant_id = b.tenant_id
           AND bp.item_category = 'doctor_visit'
           AND COALESCE(bp.is_active, 1) = 1
           AND bp.cancelled_at IS NULL
           AND bp.bill_status = 'finalized'
          LEFT JOIN visits v
            ON v.id = b.visit_id
           AND v.tenant_id = b.tenant_id
          LEFT JOIN appointments a
            ON a.id = COALESCE(bp.appointment_id, v.appointment_id)
           AND a.tenant_id = b.tenant_id
           AND a.patient_id = b.patient_id
          WHERE b.tenant_id = ?
            AND b.patient_id = ?
            AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
            AND (
              COALESCE(b.doctor_visit_bill, 0) > 0
              OR bp.id IS NOT NULL
              OR EXISTS (
                SELECT 1
                FROM invoice_items ii
                WHERE ii.tenant_id = b.tenant_id
                  AND ii.bill_id = b.id
                  AND ii.item_category = 'doctor_visit'
                  AND COALESCE(ii.status, 'active') <> 'cancelled'
              )
            )
        )
        SELECT visit_date, doctor_id
        FROM paid_doctor_visits
        WHERE visit_date BETWEEN ? AND ?
          AND appointment_type <> 'report_show'
          AND doctor_id = ?
        ORDER BY visit_date DESC
        LIMIT 1
      `).bind(
        input.tenantId,
        input.patientId,
        cutoffDate,
        input.apptDate,
        Number(input.doctorId || 0),
      ).first<{ visit_date: string | null; doctor_id: number | null }>();

  if (lastVisit?.visit_date) {
    return {
      eligible: true,
      appointmentType: input.appointmentType,
      windowDays,
      cutoffDate,
      lastVisitDate: lastVisit.visit_date,
      lastDoctorId: lastVisit.doctor_id ?? null,
      reason: null,
    };
  }

  return {
    eligible: false,
    appointmentType: input.appointmentType,
    windowDays,
    cutoffDate,
    lastVisitDate: null,
    lastDoctorId: null,
    reason: input.appointmentType === 'report_show'
      ? `Report-show is allowed only after this doctor completed a visit within the last ${windowDays} day(s).`
      : `Returning-patient discount is allowed only if the patient made a positive payment for a doctor visit within the last ${windowDays} day(s).`,
  };
}

async function assertAppointmentEligibility(
  d1: D1Database,
  input: Parameters<typeof evaluateAppointmentEligibility>[1],
): Promise<AppointmentEligibility> {
  const eligibility = await evaluateAppointmentEligibility(d1, input);
  if (!eligibility.eligible) {
    throw new HTTPException(409, {
      message: eligibility.reason ?? 'Patient is not eligible for this appointment type',
    });
  }
  return eligibility;
}

function getAppointmentChargeFromRow(appt: AppointmentBillingRow): AppointmentCharge {
  const appointmentType = normalizeAppointmentType(appt.appointment_type ?? appt.visit_type);
  return calculateAppointmentCharge({
    baseFee: normalizeConsultationFee(appt.consultation_fee ?? appt.fee ?? 0),
    configuredFee: appt.original_fee ?? appt.fee ?? null,
    appointmentType,
    discountAmount: appt.discount_amount ?? 0,
  });
}

function normalizeBillingStatus(value: unknown, fallback = 'unpaid'): string {
  const status = String(value ?? '');
  return /^(unpaid|pending|paid|due_approved|partial_paid|no_charge|refunded|cancelled)$/.test(status)
    ? status
    : fallback;
}

async function getAppointmentBillingRow(
  d1: D1Database,
  tenantId: string,
  appointmentId: number,
): Promise<AppointmentBillingRow | null> {
  return d1.prepare(`
    SELECT
      a.id,
      a.patient_id,
      a.doctor_id,
      a.appt_no,
      a.appt_date,
      a.appt_time,
      a.visit_type,
      a.status,
      a.fee,
      a.appointment_type,
      a.original_fee,
      a.discount_amount,
      a.final_fee,
      a.discount_reason,
      a.discount_by_name,
      a.billing_status,
      p.name AS patient_name,
      p.patient_code,
      d.name AS doctor_name,
      d.specialty AS doctor_specialty,
      d.department AS doctor_department,
      d.consultation_fee,
      v.id AS visit_id
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN visits v ON v.appointment_id = a.id AND v.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
    LIMIT 1
  `).bind(appointmentId, tenantId).first<AppointmentBillingRow>();
}

async function ensureAppointmentConsultationProvisionalCharge(
  d1: D1Database,
  input: {
    tenantId: string;
    appointmentId: number;
    patientId: number;
    doctorId: number | null;
    doctorName: string | null;
    department: string | null;
    originalFee: number;
    discountAmount: number;
    finalFee: number;
    createdBy: string;
    visitId?: number | null;
  },
): Promise<number | null> {
  if (input.finalFee <= 0) return null;

  const existing = await d1.prepare(`
    SELECT id, visit_id
    FROM billing_provisional_items
    WHERE tenant_id = ?
      AND appointment_id = ?
      AND item_category = 'doctor_visit'
      AND bill_status = 'provisional'
      AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(input.tenantId, input.appointmentId).first<{ id: number; visit_id: number | null }>();

  if (existing?.id) {
    await d1.prepare(`
      UPDATE billing_provisional_items
      SET visit_id = COALESCE(?, visit_id),
          item_name = ?,
          department = ?,
          unit_price = ?,
          quantity = 1,
          discount_amount = ?,
          total_amount = ?,
          doctor_id = ?,
          doctor_name = ?,
          reference_id = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      input.visitId ?? null,
      `Consultation - ${formatDoctorName(input.doctorName)}`,
      input.department ?? 'Doctor',
      input.originalFee,
      input.discountAmount,
      input.finalFee,
      input.doctorId,
      input.doctorName,
      input.doctorId,
      existing.id,
      input.tenantId,
    ).run();
    return existing.id;
  }

  const result = await d1.prepare(`
    INSERT INTO billing_provisional_items
      (tenant_id, patient_id, visit_id, item_category, item_name, department, unit_price,
       quantity, discount_amount, total_amount, doctor_id, doctor_name, reference_id,
       appointment_id, bill_status, is_active, created_by, created_at)
    VALUES (?, ?, ?, 'doctor_visit', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'provisional', 1, ?, datetime('now', '+6 hours'))
  `).bind(
    input.tenantId,
    input.patientId,
    input.visitId ?? null,
    `Consultation - Dr. ${input.doctorName ?? 'Assigned Doctor'}`,
    input.department ?? 'Doctor',
    input.originalFee,
    input.discountAmount,
    input.finalFee,
    input.doctorId,
    input.doctorName,
    input.doctorId,
    input.appointmentId,
    Number(input.createdBy),
  ).run();

  return Number(result.meta.last_row_id);
}

async function getAppointmentProvisionalItems(
  d1: D1Database,
  tenantId: string,
  appointmentId: number,
): Promise<AppointmentProvisionalItem[]> {
  const { results } = await d1.prepare(`
    SELECT id, patient_id, visit_id, item_category, item_name, unit_price, quantity,
           discount_amount, total_amount, doctor_id, reference_id
    FROM billing_provisional_items
    WHERE tenant_id = ?
      AND appointment_id = ?
      AND bill_status = 'provisional'
      AND COALESCE(is_active, 1) = 1
    ORDER BY id
  `).bind(tenantId, appointmentId).all<AppointmentProvisionalItem>();
  return results;
}

async function ensureDoctorQueueEntryForAppointment(
  d1: D1Database,
  input: {
    tenantId: string;
    appointmentId: number;
    patientId: number;
    visitId: number;
    doctorId: number | null;
    queueDate: string;
  },
): Promise<{ id?: number; created: boolean; tokenNo?: string; tokenNumber?: number }> {
  const existingQueue = await d1.prepare(
    'SELECT id, token_no, token_number FROM queue_entries WHERE appointment_id = ? AND tenant_id = ? AND status NOT IN (?, ?)'
  ).bind(input.appointmentId, input.tenantId, 'completed', 'cancelled').first<{ id: number; token_no: string | null; token_number: number | null }>();

  if (existingQueue?.id) {
    return {
      id: existingQueue.id,
      created: false,
      tokenNo: existingQueue.token_no ?? undefined,
      tokenNumber: existingQueue.token_number ?? undefined,
    };
  }

  const deptKey = input.doctorId ?? 0;
  await d1.prepare(`
    INSERT INTO queue_token_counters (tenant_id, department_id, counter_date, last_token, prefix)
    VALUES (?, ?, ?, 0, 'T')
    ON CONFLICT(tenant_id, department_id, counter_date) DO NOTHING
  `).bind(input.tenantId, deptKey, input.queueDate).run();

  await d1.prepare(`
    UPDATE queue_token_counters SET last_token = last_token + 1
    WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
  `).bind(input.tenantId, deptKey, input.queueDate).run();

  const counter = await d1.prepare(`
    SELECT last_token, prefix FROM queue_token_counters
    WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
  `).bind(input.tenantId, deptKey, input.queueDate).first<{ last_token: number; prefix: string }>();

  const tokenNumber = counter?.last_token ?? 1;
  const tokenNo = `${counter?.prefix ?? 'T'}${String(tokenNumber).padStart(3, '0')}`;

  const insertResult = await d1.prepare(`
    INSERT INTO queue_entries (tenant_id, visit_id, patient_id, department_id, doctor_id, appointment_id, token_no, token_number, queue_date, priority, status, check_in_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 'waiting', datetime('now', '+6 hours'))
  `).bind(
    input.tenantId,
    input.visitId,
    input.patientId,
    input.doctorId,
    input.doctorId,
    input.appointmentId,
    tokenNo,
    tokenNumber,
    input.queueDate,
  ).run();

  return { id: Number(insertResult.meta.last_row_id ?? 0) || undefined, created: true, tokenNo, tokenNumber };
}

async function finalizeAppointmentConsultationInvoice(
  c: AppointmentContext,
  appointmentId: number,
  mode: 'paid' | 'credit',
  options: {
    paymentMethod?: string;
    externalTransactionId?: string;
    remarks?: string | null;
    discountByName?: string | null;
    schemeApplication?: z.infer<typeof appointmentSchemeApplicationSchema> | null;
  } = {},
) {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, tenantId, 'appointment.billing.finalize');
  const appt = await getAppointmentBillingRow(c.env.DB, tenantId, appointmentId);

  if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });
  if (appt.status === 'cancelled') throw new HTTPException(409, { message: 'Cancelled appointment cannot be billed' });
  if (appt.billing_status === 'paid') throw new HTTPException(409, { message: 'Appointment is already paid' });
  if (mode === 'credit' && appt.billing_status === 'due_approved') {
    throw new HTTPException(409, { message: 'Appointment due is already approved' });
  }

  let charge = getAppointmentChargeFromRow(appt);
  const requestedSchemeDiscount = options.schemeApplication ? Math.min(charge.originalFee, Math.max(0, Number(options.schemeApplication.suggestedDiscount ?? charge.discountAmount ?? 0))) : 0;
  const schemeEligibility = options.schemeApplication && requestedSchemeDiscount > 0 ? await evaluateBillingSchemeEligibility(c.env.DB, { tenantId, patientId: Number(appt.patient_id), schemeId: options.schemeApplication.schemeId ?? null, schemeCode: options.schemeApplication.schemeCode ?? null, memberCode: options.schemeApplication.memberCode ?? null, serviceCategory: options.schemeApplication.serviceCategory ?? 'appointment_payment', subtotal: charge.originalFee }) : null;
  if (schemeEligibility && !schemeEligibility.eligible) throw new HTTPException(400, { message: ['Scheme is not eligible', ...schemeEligibility.blockers].join(': ') });
  if (schemeEligibility && requestedSchemeDiscount - schemeEligibility.suggested_discount > 0.01) throw new HTTPException(400, { message: 'Scheme discount exceeds eligible scheme cap.' });
  if (schemeEligibility) {
    charge = calculateAppointmentCharge({ baseFee: normalizeConsultationFee(appt.consultation_fee ?? appt.fee ?? 0), configuredFee: charge.originalFee, appointmentType: normalizeAppointmentType(appt.appointment_type ?? appt.visit_type), discountAmount: requestedSchemeDiscount });
  }
  const consultationFee = charge.finalFee;
  const discountByName = options.discountByName?.trim() || appt.discount_by_name?.trim() || (schemeEligibility?.requires_reference ? (schemeEligibility.matched_member_name || schemeEligibility.matched_member_code || schemeEligibility.scheme_name) : null);
  assertDiscountReferralNameForHighDiscount(charge.originalFee, charge.discountAmount, discountByName);
  if (consultationFee <= 0) {
    await c.env.DB.prepare(`
      UPDATE appointments
      SET billing_status = 'no_charge', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(appointmentId, tenantId).run();
    return {
      message: 'Appointment has no consultation charge',
      appointmentId,
      billingStatus: 'no_charge',
      total: 0,
    };
  }

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before collecting appointment payment or approving credit.' });
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, mode === 'paid' ? 'Appointment consultation payment' : 'Appointment consultation credit invoice');

  await ensureAppointmentConsultationProvisionalCharge(c.env.DB, {
    tenantId,
    appointmentId,
    patientId: Number(appt.patient_id),
    doctorId: appt.doctor_id ? Number(appt.doctor_id) : null,
    doctorName: appt.doctor_name,
    department: appt.doctor_department ?? appt.doctor_specialty ?? 'Doctor',
    originalFee: charge.originalFee,
    discountAmount: charge.discountAmount,
    finalFee: charge.finalFee,
    createdBy: userId,
    visitId: appt.visit_id ?? null,
  });

  const items = await getAppointmentProvisionalItems(c.env.DB, tenantId, appointmentId);
  if (items.length === 0) throw new HTTPException(409, { message: 'No pending consultation charge found for this appointment' });
  if (items.some((item) => Number(item.patient_id) !== Number(appt.patient_id))) {
    throw new HTTPException(409, { message: 'Appointment billing items do not belong to the appointment patient' });
  }

  const subtotal = items.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0);
  const discount = items.reduce((sum, item) => sum + Number(item.discount_amount ?? 0), 0);
  const total = Math.max(0, Math.round(subtotal * 100) / 100);
  const paid = mode === 'paid' ? total : 0;
  const due = Math.max(0, total - paid);
  const billStatus = due > 0 ? 'open' : 'paid';
  const billingStatus = mode === 'paid' ? 'paid' : 'due_approved';
  const paymentMethod = mode === 'paid' ? (options.paymentMethod ?? 'cash') : 'credit';
  if (
    mode === 'paid'
    && !isCashPaymentMethod(paymentMethod)
    && !options.externalTransactionId?.trim()
  ) {
    throw new HTTPException(400, {
      message: 'Transaction/reference number is required for non-cash payments.',
    });
  }

  const invoiceNo = await getNextInvoiceNumber(c.env.DB, tenantId, 'appointment');
  const paymentReceiptNo = mode === 'paid' && paid > 0
    ? await getNextSequence(c.env.DB, tenantId, 'receipt', 'RCP')
    : null;
  const categoryTotals = calculateBillCategoryTotals(
    items.map((item) => ({
      category: item.item_category || 'doctor_visit',
      amount: Number(item.total_amount ?? 0),
    })),
  );
  const issuedAtUtc = new Date().toISOString();
  const projectionItems = items.map((item) => ({
    provisionalItemId: Number(item.id),
    category: item.item_category || 'doctor_visit',
    description: item.item_name,
    quantity: Number(item.quantity || 1),
    unitPrice: Number(item.unit_price || item.total_amount),
    discountAmount: Number(item.discount_amount ?? 0),
    totalAmount: Number(item.total_amount ?? 0),
    doctorId: item.doctor_id ?? null,
    referenceId: item.reference_id ?? null,
  }));
  const accountingExtraPayload = {
    doctorId: appt.doctor_id ? Number(appt.doctor_id) : null,
    schemeId: schemeEligibility?.scheme_id ?? null,
    schemeMemberId: schemeEligibility?.matched_member_id ?? null,
    schemeAllocationType: schemeEligibility?.allocation_type ?? null,
  };
  const legacyStatements = prepareAppointmentBillingLegacyStatements(c.env.DB, {
    tenantId,
    userId,
    appointmentId,
    expectedBillingStatus: normalizeBillingStatus(appt.billing_status, 'unpaid'),
    billingStatus,
    patientId: Number(appt.patient_id),
    visitId: appt.visit_id ?? items[0]?.visit_id ?? null,
    invoiceNo,
    categoryTotals,
    discount,
    discountByName,
    total,
    paid,
    due,
    billStatus,
    paymentMethod,
    remarks: options.remarks ?? null,
    counterId: Number(activeCounterSession.counter_id),
    counterSessionId: Number(activeCounterSession.id),
    paymentReceiptNo,
    externalTransactionId: options.externalTransactionId?.trim() || null,
    businessDate: today,
    occurredAtUtc: issuedAtUtc,
    items: items.map((item) => ({
      id: Number(item.id),
      itemCategory: item.item_category || 'doctor_visit',
      description: item.item_name,
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || item.total_amount),
      discountAmount: Number(item.discount_amount ?? 0),
      lineTotal: Number(item.total_amount ?? 0),
      referenceId: item.reference_id ?? item.doctor_id ?? null,
      doctorId: item.doctor_id ?? null,
      canonicalSourceKey: `appointment-service:${appointmentId}:${Number(item.id)}`,
    })),
    schemeDiscount: schemeEligibility ? {
      amount: requestedSchemeDiscount,
      finalFee: charge.finalFee,
      reason: schemeEligibility.scheme_name ?? 'Scheme benefit',
    } : null,
    schemeAllocation: schemeEligibility && charge.discountAmount > 0 ? {
      allocationType: schemeEligibility.allocation_type,
      amount: charge.discountAmount,
      referenceName: discountByName,
      note: `Scheme: ${schemeEligibility.scheme_name ?? 'Benefit'}`,
      metadataJson: JSON.stringify({
        source: 'appointment_payment',
        schemeId: schemeEligibility.scheme_id,
        schemeMemberId: schemeEligibility.matched_member_id ?? null,
      }),
    } : null,
    accountingExtraPayload,
  });

  try {
    await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId,
      boundary: 'appointment.billing.finalize',
      legacyStatements,
      canonical: async (execution) => {
        const projectionInput = {
          tenantId,
          appointmentId,
          patientId: Number(appt.patient_id),
          invoiceNo,
          issuedAtUtc,
          businessDate: today,
          items: projectionItems,
        };
        if (mode === 'paid') {
          if (!paymentReceiptNo) {
            throw new Error('Appointment payment receipt authority is missing');
          }
          const projection = await buildAppointmentFullPaymentProjection({
            ...projectionInput,
            receiptNo: paymentReceiptNo,
            paymentMethod,
            externalTransactionId: options.externalTransactionId?.trim() || null,
            collectorId: Number(userId),
            counterId: Number(activeCounterSession.counter_id),
            counterSessionId: Number(activeCounterSession.id),
            amount: paid,
          });
          return issueInvoiceWithFullPayment(c.env.DB, projection, execution);
        }
        const projection = await buildAppointmentInvoiceProjection(projectionInput);
        return issueInvoice(c.env.DB, projection, execution);
      },
    });
  } catch (error) {
    if (isFinancialBatchAssertionError(error)) {
      throw new HTTPException(409, {
        message: 'Appointment billing changed concurrently. Refresh and try again.',
      });
    }
    throw error;
  }

  const insertedBill = await c.env.DB.prepare(
    'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1',
  ).bind(tenantId, invoiceNo).first<{ id?: number | string | null }>();
  const billId = Number(insertedBill?.id);
  if (!Number.isFinite(billId) || billId <= 0) {
    throw new HTTPException(500, { message: 'Appointment invoice was not created' });
  }

  let queueEntry: { created: boolean; tokenNo?: string; tokenNumber?: number } | null = null;
  const linkedVisitId = appt.visit_id ?? items[0]?.visit_id ?? null;
  if (linkedVisitId) {
    try {
      queueEntry = await ensureDoctorQueueEntryForAppointment(c.env.DB, {
        tenantId,
        appointmentId,
        patientId: Number(appt.patient_id),
        doctorId: appt.doctor_id ? Number(appt.doctor_id) : null,
        visitId: Number(linkedVisitId),
        queueDate: today,
      });
    } catch (error) {
      console.error('Failed to create doctor queue entry after appointment payment:', error);
    }
  }

  const postCommitSideEffects: Promise<unknown>[] = [
    recordBillFinalizationSideEffects(c.env.DB, {
      tenantId,
      userId,
      patientId: Number(appt.patient_id),
      visitId: linkedVisitId,
      billId,
      invoiceNo,
      referringDoctorId: null,
      billDate: today,
      subtotal,
      discount,
      total,
      categoryTotals,
      counterId: Number(activeCounterSession.counter_id),
      counterSessionId: Number(activeCounterSession.id),
      skipBillAccountingEvent: true,
      extraPayload: {
        doctorId: appt.doctor_id ? Number(appt.doctor_id) : null,
        schemeId: schemeEligibility?.scheme_id ?? null,
        schemeMemberId: schemeEligibility?.matched_member_id ?? null,
        schemeAllocationType: schemeEligibility?.allocation_type ?? null,
      },
      items: items.map((item) => ({
        itemCategory: item.item_category || 'doctor_visit',
        description: item.item_name,
        lineTotal: Number(item.total_amount ?? 0),
        referenceId: item.reference_id ?? item.doctor_id ?? null,
      })),
    }),
    createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills', billId, null, {
      action: mode === 'paid' ? 'appointment_pay_now' : 'appointment_credit_invoice',
      appointmentId,
      invoiceNo,
      receiptNo: paymentReceiptNo,
      total,
      paid,
      due,
      billingStatus,
      counterId: activeCounterSession.counter_id,
      counterSessionId: activeCounterSession.id,
      queueEntry,
    }),
  ];

  if (schemeEligibility && charge.discountAmount > 0) {
    postCommitSideEffects.push(recordBillingSchemeUsage(c.env.DB, {
      tenantId,
      schemeId: schemeEligibility.scheme_id!,
      memberId: schemeEligibility.matched_member_id ?? null,
      patientId: Number(appt.patient_id),
      billId,
      serviceCategory: schemeEligibility.service_category ?? 'appointment_payment',
      subtotal: charge.originalFee,
      discountAmount: charge.discountAmount,
      allocationType: schemeEligibility.allocation_type,
      createdBy: userId,
    }));
  }

  if (paymentReceiptNo && paid > 0) {
    postCommitSideEffects.push(shadowWriteAppointmentPaymentCollection({
      db: c.env.DB,
      tenantId,
      billId,
      invoiceNo,
      receiptNo: paymentReceiptNo,
      appointmentId,
      patientId: Number(appt.patient_id),
      doctorId: appt.doctor_id ? Number(appt.doctor_id) : null,
      amount: paid,
      paymentMethod,
      userId,
      counterSessionId: Number(activeCounterSession.id),
      counterId: Number(activeCounterSession.counter_id),
      externalTransactionId: options.externalTransactionId ?? null,
    }));
  }

  const postCommitTask = Promise.allSettled(postCommitSideEffects).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Appointment payment post-commit side effect failed:', result.reason);
      }
    });
    queueAppointmentAccountingPosting(c, tenantId);
  });
  try {
    c.executionCtx.waitUntil(postCommitTask);
  } catch {
    await postCommitTask;
  }

  return {
    message: mode === 'paid' ? 'Appointment consultation payment posted' : 'Appointment consultation credit invoice posted',
    appointmentId,
    billId,
    invoiceNo,
    receiptNo: paymentReceiptNo,
    total,
    paid,
    due,
    status: billStatus,
    billingStatus,
    doctorQueueAllowed: true,
    queueEntry,
  };
}

async function checkAppointmentConflict(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  doctorId: number | null | undefined,
  apptDate: string,
  apptTime: string | null | undefined,
  excludeId?: number,
): Promise<{ conflictingAppointmentId: number | null }> {
  if (!doctorId || !apptTime) {
    return { conflictingAppointmentId: null };
  }

  // Build a 30-minute window: 15 min before and 15 min after
  const [hours, minutes] = apptTime.split(':').map(Number);
  const baseTime = new Date();
  baseTime.setHours(hours, minutes, 0, 0);

  const windowStart = new Date(baseTime.getTime() - 15 * 60 * 1000);
  const windowEnd = new Date(baseTime.getTime() + 15 * 60 * 1000);

  const startTimeStr = `${String(windowStart.getHours()).padStart(2, '0')}:${String(windowStart.getMinutes()).padStart(2, '0')}`;
  const endTimeStr = `${String(windowEnd.getHours()).padStart(2, '0')}:${String(windowEnd.getMinutes()).padStart(2, '0')}`;

  let sql = `
    SELECT COUNT(*) as cnt FROM appointments
    WHERE tenant_id = ?
      AND doctor_id = ?
      AND appt_date = ?
      AND appt_time BETWEEN ? AND ?
      AND status != 'cancelled'
  `;
  const params: (string | number)[] = [tenantId, doctorId, apptDate, startTimeStr, endTimeStr];

  if (excludeId !== undefined) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }

  const countRow = await db.$client.prepare(sql).bind(...params).first<{ cnt: number }>();
  if ((countRow?.cnt ?? 0) === 0) {
    return { conflictingAppointmentId: null };
  }

  let idSql = `
    SELECT id FROM appointments
    WHERE tenant_id = ?
      AND doctor_id = ?
      AND appt_date = ?
      AND appt_time BETWEEN ? AND ?
      AND status != 'cancelled'
  `;
  const idParams: (string | number)[] = [tenantId, doctorId, apptDate, startTimeStr, endTimeStr];
  if (excludeId !== undefined) {
    idSql += ' AND id != ?';
    idParams.push(excludeId);
  }
  idSql += ' LIMIT 1';

  const row = await db.$client.prepare(idSql).bind(...idParams).first<{ id: number }>();
  return { conflictingAppointmentId: row?.id ?? null };
}

async function checkPatientDoctorSameDayAppointment(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  doctorId: number | null | undefined,
  apptDate: string,
  excludeId?: number,
): Promise<{ conflictingAppointmentId: number | null }> {
  if (!doctorId) return { conflictingAppointmentId: null };

  let query = `
    SELECT id
    FROM appointments
    WHERE tenant_id = ?
      AND patient_id = ?
      AND doctor_id = ?
      AND appt_date = ?
      AND status != 'cancelled'
  `;
  const params: (string | number)[] = [tenantId, patientId, doctorId, apptDate];

  if (excludeId !== undefined) {
    query += ' AND id != ?';
    params.push(excludeId);
  }
  query += ' LIMIT 1';

  const row = await db.$client.prepare(query).bind(...params).first<{ id: number }>();
  return { conflictingAppointmentId: row?.id ?? null };
}

async function findActiveReportShowAppointment(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  doctorId: number | null | undefined,
  apptDate: string,
): Promise<{
  id: number;
  appt_no: string;
  token_no: number | null;
  status: string;
  billing_status: string | null;
  final_fee: number | null;
  fee: number | null;
} | null> {
  if (!doctorId) return null;

  return db.$client.prepare(`
    SELECT id, appt_no, token_no, status, billing_status, final_fee, fee
    FROM appointments
    WHERE tenant_id = ?
      AND patient_id = ?
      AND doctor_id = ?
      AND appt_date = ?
      AND appointment_type = 'report_show'
      AND status NOT IN ('cancelled', 'no_show', 'completed', 'concluded')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).bind(tenantId, patientId, doctorId, apptDate).first();
}

async function resolveDoctorAppointmentFee(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  doctorId: number | null | undefined,
  appointmentTypeInput: string | null | undefined = 'new_patient',
  discountAmount: number | null | undefined = 0,
): Promise<AppointmentCharge & { doctorName: string | null; department: string | null }> {
  const appointmentType = normalizeAppointmentType(appointmentTypeInput);
  if (!doctorId) {
    return {
      ...calculateAppointmentCharge({ baseFee: 0, appointmentType, discountAmount }),
      doctorName: null,
      department: null,
    };
  }

  const doctor = await db.$client.prepare(`
    SELECT id, name, specialty, department, consultation_fee
    FROM doctors
    WHERE id = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(doctorId, tenantId).first<{ id: number; name: string | null; specialty: string | null; department: string | null; consultation_fee: number | null }>();

  if (!doctor) {
    throw new HTTPException(400, { message: 'Selected doctor not found or inactive' });
  }

  let configuredFee: number | null = null;
  try {
    const feeSetup = await db.$client.prepare(`
      SELECT fee
      FROM doctor_appointment_fees
      WHERE tenant_id = ?
        AND doctor_id = ?
        AND appointment_type = ?
        AND COALESCE(is_active, 1) = 1
      ORDER BY id DESC
      LIMIT 1
    `).bind(tenantId, doctorId, appointmentType).first<{ fee: number | null }>();
    configuredFee = feeSetup?.fee ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table: doctor_appointment_fees/i.test(message)) throw error;
  }

  return {
    ...calculateAppointmentCharge({
      baseFee: normalizeConsultationFee(doctor.consultation_fee),
      configuredFee,
      appointmentType,
      discountAmount,
    }),
    doctorName: doctor.name ?? null,
    department: doctor.department ?? doctor.specialty ?? null,
  };
}

// ─── GET /api/appointments ───────────────────────────────────────────────────
// Params: date, doctorId, status, patientId, source
appointmentRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const { date, doctorId, status, patientId, source } = c.req.query();

  try {
    // Multi-table JOIN with dynamic filters → raw SQL (parameterized)
    let query = `
      SELECT a.*,
             p.name        AS patient_name,
             p.patient_code,
             p.mobile      AS patient_mobile,
             p.age         AS patient_age,
             p.date_of_birth AS patient_date_of_birth,
             d.name        AS doctor_name,
             d.specialty   AS doctor_specialty
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.tenant_id = ?`;
    const params: (string | number)[] = [tenantId!];

    if (date)      { query += ' AND a.appt_date = ?'; params.push(date); }
    if (doctorId)  { query += ' AND a.doctor_id = ?'; params.push(doctorId); }
    if (status)    { query += ' AND a.status = ?';    params.push(status); }
    if (patientId) { query += ' AND a.patient_id = ?'; params.push(patientId); }
    if (source)    { query += ' AND a.source = ?';    params.push(source); }

    query += ' ORDER BY a.appt_date DESC, a.token_no DESC, a.created_at DESC, a.id DESC LIMIT 200';
    const appts = await db.$client.prepare(query).bind(...params).all();
    return c.json({ appointments: appts.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch appointments' });
  }
});

// ─── GET /api/appointments/today ─────────────────────────────────────────────
appointmentRoutes.get('/today', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));

  let apptDate = c.req.query('date');
  if (apptDate && !/^\d{4}-\d{2}-\d{2}$/.test(apptDate)) {
    throw new HTTPException(400, { message: 'Invalid date format. Expected YYYY-MM-DD.' });
  }

  if (!apptDate) {
    // Use Bangladesh time (UTC+6) so "today" is correct for local users
    const now = new Date();
    const bstOffset = 6 * 60; // minutes
    const bst = new Date(now.getTime() + (bstOffset + now.getTimezoneOffset()) * 60000);
    apptDate = bst.toISOString().split('T')[0];
  }

  try {
    const appts = await db.$client.prepare(`
      SELECT a.*,
             p.name        AS patient_name,
             p.patient_code,
             p.mobile      AS patient_mobile,
             p.age         AS patient_age,
             p.date_of_birth AS patient_date_of_birth,
             d.name        AS doctor_name,
             lb.id         AS bill_id,
             lb.invoice_no AS invoice_no,
             lb.total      AS bill_total,
             lb.paid       AS bill_paid,
             lb.due        AS bill_due,
             lb.status     AS bill_status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN bills lb
        ON lb.id = (
          SELECT bpi.billed_bill_id
          FROM billing_provisional_items bpi
          WHERE bpi.tenant_id = a.tenant_id
            AND bpi.appointment_id = a.id
            AND bpi.billed_bill_id IS NOT NULL
            AND COALESCE(bpi.is_active, 1) = 1
            AND bpi.bill_status IN ('finalized', 'billed')
          ORDER BY bpi.id DESC
          LIMIT 1
        )
      WHERE a.tenant_id = ? AND a.appt_date = ?
      ORDER BY a.created_at DESC, a.id DESC, a.token_no DESC
    `).bind(tenantId, apptDate).all();
    return c.json({ appointments: appts.results, date: apptDate });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch today\'s appointments' });
  }
});

appointmentRoutes.get('/appointment-types', async (c) => c.json({
  appointmentTypes: [
    { value: 'new_patient', label: 'New patient' },
    { value: 'old_patient', label: 'Follow up' },
    { value: 'report_show', label: 'Report show' },
    { value: 'free_visit', label: 'Free visit' },
    { value: 'emergency', label: 'Emergency' },
  ],
}));

appointmentRoutes.get('/fee-preview', zValidator('query', appointmentFeePreviewSchema), async (c) => {
  const tenantId = String(requireTenantId(c));
  const data = c.req.valid('query');
  const appointmentType = normalizeAppointmentType(data.appointmentType);
  const charge = await resolveDoctorAppointmentFee(
    getDb(c.env.DB),
    tenantId,
    data.doctorId,
    appointmentType,
    data.discountAmount,
  );
  const eligibility = data.patientId
    ? await evaluateAppointmentEligibility(c.env.DB, {
        tenantId,
        patientId: data.patientId,
        doctorId: data.doctorId,
        appointmentType,
        apptDate: data.apptDate ?? getTodayGMT6(),
      })
    : {
        eligible: true,
        appointmentType,
        windowDays: await resolveAppointmentEligibilityDays(c.env.DB, tenantId, data.doctorId, appointmentType),
        cutoffDate: '',
        lastVisitDate: null,
        lastDoctorId: null,
        reason: null,
      };
  return c.json({ charge, eligibility });
});

appointmentRoutes.get('/fee-setup/:doctorId', async (c) => {
  assertDoctorFeeSetupAllowed(c);
  const tenantId = String(requireTenantId(c));
  const doctorId = Number(c.req.param('doctorId'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) throw new HTTPException(400, { message: 'Invalid doctor id' });

  const doctor = await loadDoctorForFeeSetup(c.env.DB, tenantId, doctorId);
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  const { results } = await c.env.DB.prepare(`
    SELECT id, appointment_type, fee, notes, is_active, eligibility_days
    FROM doctor_appointment_fees
    WHERE tenant_id = ? AND doctor_id = ?
    ORDER BY appointment_type ASC, id DESC
  `).bind(tenantId, doctorId).all();

  return c.json({
    doctor: {
      id: doctor.id,
      name: doctor.name,
      consultationFee: normalizeConsultationFee(doctor.consultation_fee),
    },
    fees: results ?? [],
  });
});

appointmentRoutes.put('/fee-setup/:doctorId', zValidator('json', upsertDoctorAppointmentFeesSchema), async (c) => {
  assertDoctorFeeSetupAllowed(c);

  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const doctorId = Number(c.req.param('doctorId'));
  const data = c.req.valid('json');
  if (!Number.isInteger(doctorId) || doctorId <= 0) throw new HTTPException(400, { message: 'Invalid doctor id' });

  const doctor = await loadDoctorForFeeSetup(c.env.DB, tenantId, doctorId);
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  const statements = data.fees.map((fee) => {
    const defaultDays = defaultEligibilityDays(fee.appointmentType);
    const eligibilityDays = defaultDays > 0
      ? normalizeEligibilityDays(fee.eligibilityDays, defaultDays)
      : null;
    return c.env.DB.prepare(`
      INSERT INTO doctor_appointment_fees
        (tenant_id, doctor_id, appointment_type, fee, notes, is_active, eligibility_days, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
      ON CONFLICT(tenant_id, doctor_id, appointment_type)
      DO UPDATE SET fee = excluded.fee,
                    notes = excluded.notes,
                    is_active = excluded.is_active,
                    eligibility_days = excluded.eligibility_days,
                    updated_at = datetime('now', '+6 hours')
    `).bind(
      tenantId,
      doctorId,
      fee.appointmentType,
      fee.fee,
      fee.notes ?? null,
      fee.isActive ? 1 : 0,
      eligibilityDays,
      userId,
    );
  });
  await c.env.DB.batch(statements);
  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctor_appointment_fees', doctorId, null, {
    doctorId,
    doctorName: doctor.name,
    fees: data.fees,
  });
  return c.json({ message: 'Doctor appointment fees saved', count: data.fees.length });
});

// ─── GET /api/appointments/:id ────────────────────────────────────────────────
appointmentRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const id = c.req.param('id');

  try {
    // Multi-table JOIN → raw SQL
    const appt = await db.$client.prepare(`
      SELECT a.*,
             p.name AS patient_name, p.patient_code, p.mobile AS patient_mobile,
             d.name AS doctor_name, d.specialty, d.consultation_fee
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ? AND a.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });
    return c.json({ appointment: appt });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch appointment' });
  }
});

// ─── POST /api/appointments ───────────────────────────────────────────────────
appointmentRoutes.post('/', requirePermission('appointments:write'), zValidator('json', createAppointmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const userId   = String(requireUserId(c));
  const data     = c.req.valid('json');
  const force    = c.req.query('force') === 'true';
  const mutationType = 'appointment_create';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, force, idempotencyKey: undefined })
    : null;
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different appointment request',
      conflictMessage: 'Appointment request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  const appointmentType = normalizeAppointmentType(data.appointmentType ?? data.visitType);
  if (!force && appointmentType === 'report_show') {
    const existingReportShow = await findActiveReportShowAppointment(
      db,
      tenantId,
      data.patientId,
      data.doctorId ?? null,
      data.apptDate,
    );
    if (existingReportShow) {
      return c.json({
        message: 'Report-show serial already exists',
        id: existingReportShow.id,
        apptNo: existingReportShow.appt_no,
        tokenNo: existingReportShow.token_no ?? undefined,
        appointmentType: 'report_show',
        consultationFee: Number(existingReportShow.final_fee ?? existingReportShow.fee ?? 0),
        billingStatus: existingReportShow.billing_status ?? 'no_charge',
        status: existingReportShow.status,
        reused: true,
      });
    }
  }
  const charge = await resolveDoctorAppointmentFee(
    db,
    tenantId,
    data.doctorId ?? null,
    appointmentType,
    data.discountAmount,
  );
  assertAppointmentChargeOverrideAllowed(c, appointmentType, charge.discountAmount);
  assertDiscountReferralNameForHighDiscount(charge.originalFee, charge.discountAmount, data.discountByName);
  if (
    !APPOINTMENT_ELIGIBILITY_OVERRIDE_ROLES.has(c.get('role') ?? '')
    && (appointmentType === 'report_show' || appointmentType === 'old_patient')
  ) {
    await assertAppointmentEligibility(c.env.DB, {
      tenantId,
      patientId: data.patientId,
      doctorId: data.doctorId ?? null,
      appointmentType,
      apptDate: data.apptDate,
    });
  }

  // Conflict detection
  if (!force) {
    const conflict = await checkAppointmentConflict(
      db, tenantId, data.doctorId, data.apptDate, data.apptTime ?? null,
    );
    if (conflict.conflictingAppointmentId) {
      return c.json({
        message: 'Doctor has another appointment at this time',
        conflictingAppointmentId: conflict.conflictingAppointmentId,
      }, 409);
    }

    const incomingAppointmentType = normalizeAppointmentType(data.appointmentType ?? null);
    if (incomingAppointmentType !== 'report_show') {
      const duplicate = await checkPatientDoctorSameDayAppointment(
        db,
        tenantId,
        data.patientId,
        data.doctorId ?? null,
        data.apptDate,
      );
      if (duplicate.conflictingAppointmentId) {
        return c.json({
          message: 'Patient already has appointment with this doctor on this date',
          conflictingAppointmentId: duplicate.conflictingAppointmentId,
        }, 409);
      }
    }
  }

  if (data.idempotencyKey && requestHash) {
    const replay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different appointment request',
      conflictMessage: 'Appointment request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      let tokenNo: number;
      let tokenAssignmentType: 'auto' | 'reserved' | 'manual';

      if (data.forceTokenNo !== undefined) {
        tokenNo = data.forceTokenNo;
        tokenAssignmentType = 'manual';
      } else if (data.requestedTokenNo) {
        const { results: ranges } = await c.env.DB.prepare(`
          SELECT token_from, token_to FROM token_reservations
          WHERE tenant_id = ? AND is_active = 1
            AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
            AND ? BETWEEN reservation_date AND end_date
            AND token_from <= ? AND token_to >= ?
        `).bind(tenantId, data.doctorId ?? null, data.doctorId ?? null, data.apptDate, data.requestedTokenNo, data.requestedTokenNo).all();

        if (ranges.length === 0) {
          throw new HTTPException(400, { message: `Token ${data.requestedTokenNo} is not in any reserved range` });
        }

        const taken = await c.env.DB.prepare(`
          SELECT id FROM appointments
          WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ? AND token_no = ?
            AND status NOT IN ('cancelled', 'no_show')
            AND COALESCE(token_assignment_type, 'auto') <> 'manual'
        `).bind(tenantId, data.apptDate, data.doctorId ?? null, data.requestedTokenNo).first();

        if (taken) {
          throw new HTTPException(409, { message: `Token ${data.requestedTokenNo} is already assigned` });
        }

        tokenNo = data.requestedTokenNo;
        tokenAssignmentType = 'reserved';
      } else {
        tokenNo = await getNextAvailableToken(c.env.DB, tenantId!, data.doctorId ?? null, data.apptDate);
        tokenAssignmentType = 'auto';
      }
      const apptNo  = await getNextSequence(c.env.DB, tenantId!, 'appointment', 'APT');

      // INSERT using Drizzle ORM with .returning()
      const [result] = await db.insert(appointments)
        .values({
          apptNo,
          tokenNo,
          tokenAssignmentType,
          patientId: data.patientId,
          doctorId: data.doctorId ?? null,
          apptDate: data.apptDate,
          apptTime: data.apptTime ?? null,
          visitType: data.visitType === 'emergency' ? 'emergency' : appointmentTypeToVisitType(appointmentType),
          status: 'scheduled',
          chiefComplaint: data.chiefComplaint ?? null,
          notes: data.notes ?? null,
          fee: charge.finalFee,
          appointmentType,
          originalFee: charge.originalFee,
          discountAmount: charge.discountAmount,
          finalFee: charge.finalFee,
          discountReason: data.discountReason ?? null,
          discountByName: data.discountByName ?? null,
          billingStatus: charge.billingStatus,
          source: data.source ?? 'scheduled',
          externalReferringDoctorId: data.externalReferringDoctorId ?? null,
          createdBy: Number(userId),
          tenantId: tenantId,
        })
        .returning({ id: appointments.id });

      if (charge.finalFee > 0) {
        try {
          await ensureAppointmentConsultationProvisionalCharge(c.env.DB, {
            tenantId,
            appointmentId: result.id,
            patientId: data.patientId,
            doctorId: data.doctorId ?? null,
            doctorName: charge.doctorName,
            department: charge.department,
            originalFee: charge.originalFee,
            discountAmount: charge.discountAmount,
            finalFee: charge.finalFee,
            createdBy: userId,
          });
        } catch (error) {
          await c.env.DB.prepare(
            'DELETE FROM appointments WHERE id = ? AND tenant_id = ?',
          ).bind(result.id, tenantId).run().catch((cleanupError) => {
            console.error('Failed to remove appointment after provisional billing failure:', cleanupError);
          });
          throw error;
        }
      }

      const responseBody = {
        message: 'Appointment booked',
        id: result.id,
        apptNo,
        tokenNo,
        appointmentType,
        originalFee: charge.originalFee,
        discountAmount: charge.discountAmount,
        consultationFee: charge.finalFee,
        billingStatus: charge.billingStatus,
        discountByName: data.discountByName ?? null,
      };
      if (data.idempotencyKey && idempotencyReserved) {
        await completeMutationIdempotencyKey(c.env.DB, {
          tenantId,
          mutationType,
          idempotencyKey: data.idempotencyKey,
          sourceId: result.id,
          responseBody,
        }).catch((error) => console.error('Failed to complete appointment idempotency key:', error));
      }

      void createAuditLog(c.env, tenantId!, userId!, 'CREATE', 'appointments', result.id, null, {
        apptNo,
        tokenNo,
        tokenAssignmentType,
        patientId: data.patientId,
        apptDate: data.apptDate,
        appointmentType,
        originalFee: charge.originalFee,
        discountAmount: charge.discountAmount,
        consultationFee: charge.finalFee,
        billingStatus: charge.billingStatus,
      });

      // ─── Send appointment SMS with portal link ─────────────────────────
      try {
        const patientRow = await db.$client.prepare(
          'SELECT name, mobile FROM patients WHERE id = ? AND tenant_id = ?'
        ).bind(data.patientId, tenantId).first<{ name: string; mobile: string }>();

        if (patientRow?.mobile) {
          const { createSmsProvider } = await import('../../lib/sms');
          const { OtpSmsTemplates } = await import('../../lib/otp');
          const sms = createSmsProvider(c.env);

          const hospitalRow = await db.$client.prepare(
            "SELECT value FROM settings WHERE key = 'hospital_info' AND tenant_id = ?"
          ).bind(tenantId).first<{ value: string }>();

          let hospitalName = 'Hospital';
          try {
            const info = JSON.parse(hospitalRow?.value || '{}');
            hospitalName = info.name || 'Hospital';
          } catch { /* use default */ }

          const portalUrl = c.env.PATIENT_PORTAL_URL || 'https://hms-saas.rahmatullahzisan.workers.dev/patient-portal';
          const dateTime = `${data.apptDate} ${data.apptTime || ''}`.trim();

          const msg = OtpSmsTemplates.appointmentWithPortal(
            patientRow.name,
            charge.doctorName || 'Doctor',
            dateTime,
            tokenNo ?? apptNo,
            hospitalName,
            portalUrl,
          );

          void sms.sendSMS(patientRow.mobile, msg).catch((err) => {
            console.error('[AppointmentSMS] Failed to send appointment SMS:', err);
          });
        }
      } catch {
        // SMS failure should not block appointment creation
      }

      return c.json(responseBody, 201);
    } catch (error) {
      // Retry on unique constraint violation (concurrent token assignment)
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('UNIQUE constraint') && attempt < maxRetries - 1) continue;
      if (data.idempotencyKey && idempotencyReserved) {
        await markMutationIdempotencyKeyFailed(c.env.DB, {
          tenantId,
          mutationType,
          idempotencyKey: data.idempotencyKey,
        }).catch((markError) => console.error('Failed to mark appointment idempotency key failed:', markError));
      }
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(500, { message: 'Failed to book appointment' });
    }
  }
  throw new HTTPException(500, { message: 'Failed to book appointment after retries' });
});

// ─── PUT /api/appointments/:id ────────────────────────────────────────────────
appointmentRoutes.put('/:id', requirePermission('appointments:write'), zValidator('json', updateAppointmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const userId   = String(requireUserId(c));
  const id       = Number(c.req.param('id'));
  const data     = c.req.valid('json');
  const force    = c.req.query('force') === 'true';

  try {
    // Check existence with Drizzle
    const [existing] = await db.select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'Appointment not found' });

    const doctorIdChanged = data.doctorId !== undefined && data.doctorId !== existing.doctorId;
    const apptTimeChanged = data.apptTime !== undefined && data.apptTime !== existing.apptTime;
    const apptDateChanged = data.apptDate !== undefined && data.apptDate !== existing.apptDate;
    if (data.status === 'cancelled' && ['paid', 'due_approved', 'partial_paid'].includes(existing.billingStatus ?? '')) {
      throw new HTTPException(409, { message: 'Cancel the posted bill or refund first before cancelling a paid/credit appointment' });
    }

    if (!force && (doctorIdChanged || apptTimeChanged || apptDateChanged)) {
      const conflict = await checkAppointmentConflict(
        db,
        tenantId,
        data.doctorId ?? existing.doctorId,
        data.apptDate ?? existing.apptDate,
        data.apptTime ?? existing.apptTime,
        id,
      );
      if (conflict.conflictingAppointmentId) {
        return c.json({
          message: 'Doctor has another appointment at this time',
          conflictingAppointmentId: conflict.conflictingAppointmentId,
        }, 409);
      }

      // Skip duplicate check for report_show — patient is returning with test results
      const nextAppointmentType = normalizeAppointmentType(data.appointmentType ?? existing.appointmentType ?? existing.visitType ?? null);
      if (nextAppointmentType !== 'report_show') {
        const duplicate = await checkPatientDoctorSameDayAppointment(
          db,
          tenantId,
          Number(existing.patientId),
          data.doctorId ?? existing.doctorId,
          data.apptDate ?? existing.apptDate,
          id,
        );
        if (duplicate.conflictingAppointmentId) {
          return c.json({
            message: 'Patient already has appointment with this doctor on this date',
            conflictingAppointmentId: duplicate.conflictingAppointmentId,
          }, 409);
        }
      }
    }

    // Dynamic SET → build update object, Drizzle ignores undefined
    const updateData: Record<string, unknown> = {
      updatedAt: sql`datetime('now', '+6 hours')`,
    };
    if (data.status         !== undefined) updateData.status = data.status;
    if (data.apptDate       !== undefined) updateData.apptDate = data.apptDate;
    if (data.apptTime       !== undefined) updateData.apptTime = data.apptTime;
    if (data.notes          !== undefined) updateData.notes = data.notes ?? null;
    if (data.chiefComplaint !== undefined) updateData.chiefComplaint = data.chiefComplaint ?? null;
    if (data.doctorId       !== undefined) updateData.doctorId = data.doctorId;
    if (data.status === 'cancelled') updateData.billingStatus = 'cancelled';
    let recalculatedFee: (AppointmentCharge & { doctorName: string | null; department: string | null }) | null = null;
    const rawExistingAppointmentType = (existing as any).appointmentType ?? (existing as any).appointment_type ?? null;
    const existingAppointmentType = APPOINTMENT_TYPES.includes(rawExistingAppointmentType)
      ? rawExistingAppointmentType
      : null;
    const nextAppointmentType = normalizeAppointmentType(data.appointmentType ?? existingAppointmentType ?? existing.visitType);
    const existingDiscountAmount = existingAppointmentType
      ? Number((existing as any).discountAmount ?? (existing as any).discount_amount ?? 0)
      : 0;
    const nextDiscountAmount = data.discountAmount ?? existingDiscountAmount;
    if ((data.appointmentType !== undefined || data.doctorId !== undefined || data.apptDate !== undefined)
      && (nextAppointmentType === 'report_show' || nextAppointmentType === 'old_patient')) {
      await assertAppointmentEligibility(c.env.DB, {
        tenantId,
        patientId: Number(existing.patientId),
        doctorId: data.doctorId ?? existing.doctorId ?? null,
        appointmentType: nextAppointmentType,
        apptDate: data.apptDate ?? existing.apptDate,
      });
    }
    if (data.doctorId !== undefined || data.fee !== undefined || data.appointmentType !== undefined || data.discountAmount !== undefined) {
      recalculatedFee = await resolveDoctorAppointmentFee(
        db,
        tenantId,
        data.doctorId ?? existing.doctorId ?? null,
        nextAppointmentType,
        nextDiscountAmount,
      );
      if (data.appointmentType === 'free_visit' || Number(data.discountAmount ?? 0) > 0) {
        assertAppointmentChargeOverrideAllowed(c, nextAppointmentType, Number(data.discountAmount ?? 0));
      }
      updateData.fee = recalculatedFee.finalFee;
      updateData.appointmentType = nextAppointmentType;
      updateData.originalFee = recalculatedFee.originalFee;
      updateData.discountAmount = recalculatedFee.discountAmount;
      updateData.finalFee = recalculatedFee.finalFee;
      updateData.discountReason = data.discountReason ?? (existing as any).discountReason ?? null;
      updateData.discountByName = data.discountByName ?? (existing as any).discountByName ?? null;
      if (existing.billingStatus !== 'paid' && existing.billingStatus !== 'due_approved') {
        updateData.billingStatus = recalculatedFee.billingStatus;
      }
    }

    await db.update(appointments)
      .set(updateData)
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)));

    if (data.status === 'cancelled') {
      await c.env.DB.prepare(`
        UPDATE billing_provisional_items
        SET bill_status = 'cancelled',
            is_active = 0,
            cancelled_by = ?,
            cancelled_at = datetime('now', '+6 hours'),
            cancel_reason = 'Appointment cancelled'
        WHERE appointment_id = ?
          AND tenant_id = ?
          AND bill_status = 'provisional'
          AND COALESCE(is_active, 1) = 1
      `).bind(userId, id, tenantId).run();
    } else if (recalculatedFee && existing.billingStatus !== 'paid' && existing.billingStatus !== 'due_approved') {
      if (recalculatedFee.finalFee > 0) {
        await ensureAppointmentConsultationProvisionalCharge(c.env.DB, {
          tenantId,
          appointmentId: id,
          patientId: Number(existing.patientId),
          doctorId: data.doctorId ?? existing.doctorId ?? null,
          doctorName: recalculatedFee.doctorName,
          department: recalculatedFee.department,
          originalFee: recalculatedFee.originalFee,
          discountAmount: recalculatedFee.discountAmount,
          finalFee: recalculatedFee.finalFee,
          createdBy: userId,
        });
      } else {
        await c.env.DB.prepare(`
          UPDATE billing_provisional_items
          SET bill_status = 'cancelled',
              is_active = 0,
              cancelled_by = ?,
              cancelled_at = datetime('now', '+6 hours'),
              cancel_reason = 'Appointment fee removed'
          WHERE appointment_id = ?
            AND tenant_id = ?
            AND bill_status = 'provisional'
            AND COALESCE(is_active, 1) = 1
        `).bind(userId, id, tenantId).run();
      }
    }

    void createAuditLog(c.env, tenantId!, userId!, 'UPDATE', 'appointments', id, existing, data);
    return c.json({ message: 'Appointment updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update appointment' });
  }
});

// ─── POST /api/appointments/:id/check-in — bridge to visit + billing ─────────
appointmentRoutes.post('/:id/check-in', requirePermission('appointments:write'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const userId   = String(requireUserId(c));
  const id       = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as { sendToRoom?: boolean };

  try {
    const [appt] = await db.select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)))
      .limit(1);
    if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });

    const apptRow = appt as any;
    const appointmentMeta = await db.$client.prepare(`
      SELECT appointment_type, billing_status, final_fee, original_fee, fee
      FROM appointments
      WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first<{
      appointment_type: string | null;
      billing_status: string | null;
      final_fee: number | null;
      original_fee: number | null;
      fee: number | null;
    }>();
    const appointmentTypeAtCheckIn = normalizeAppointmentType(
      apptRow.appointmentType
      ?? apptRow.appointment_type
      ?? appointmentMeta?.appointment_type
      ?? apptRow.visitType
      ?? apptRow.visit_type,
    );
    const patientId = Number(apptRow.patientId ?? apptRow.patient_id);
    const doctorId = apptRow.doctorId ?? apptRow.doctor_id ?? null;
    const visitType = apptRow.visitType ?? apptRow.visit_type ?? 'opd';
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new HTTPException(409, { message: 'Appointment patient is invalid for check-in' });
    }

    let doctorName: string | null = null;
    let doctorDepartment: string | null = null;
    let baseFee = 0;
    if (doctorId) {
      const doc = await db.$client.prepare(
        'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?'
      ).bind(doctorId, tenantId).first<{ name: string; specialty: string | null; department: string | null; consultation_fee: number }>();
      if (doc) {
        const doctorRow = doc as any;
        doctorName = doctorRow.name;
        doctorDepartment = doctorRow.department ?? doctorRow.specialty ?? 'Doctor';
        baseFee = normalizeConsultationFee(doctorRow.consultation_fee ?? doctorRow.consultationFee);
      }
    }
    if (baseFee <= 0) {
      baseFee = normalizeConsultationFee(
        apptRow.finalFee
        ?? apptRow.final_fee
        ?? appointmentMeta?.final_fee
        ?? apptRow.originalFee
        ?? apptRow.original_fee
        ?? appointmentMeta?.original_fee
        ?? apptRow.fee
        ?? appointmentMeta?.fee
        ?? appt.fee
        ?? 0,
      );
    }
    const configuredFee = normalizeConsultationFee(
      apptRow.originalFee ?? apptRow.original_fee ?? appointmentMeta?.original_fee ?? apptRow.fee ?? appointmentMeta?.fee ?? appt.fee ?? 0,
    );
    const charge = calculateAppointmentCharge({
      baseFee,
      configuredFee: configuredFee > 0 ? configuredFee : null,
      appointmentType: appointmentTypeAtCheckIn,
      discountAmount: apptRow.discountAmount ?? apptRow.discount_amount ?? 0,
    });
    let billingStatusAtCheckIn = normalizeBillingStatus(appt.billingStatus, normalizeBillingStatus(apptRow.billing_status ?? appointmentMeta?.billing_status, 'unpaid'));
    const consultationFee = billingStatusAtCheckIn === 'no_charge' ? 0 : charge.finalFee;
    if (consultationFee <= 0 && !['paid', 'due_approved', 'refunded', 'cancelled'].includes(billingStatusAtCheckIn ?? '')) {
      billingStatusAtCheckIn = 'no_charge';
      await c.env.DB.prepare(`
        UPDATE appointments
        SET billing_status = 'no_charge', updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(id, tenantId).run();
    }

    const today = getTodayGMT6();
    await assertNoSameDoctorVisitToday(c.env.DB, {
      tenantId,
      patientId,
      doctorId,
      visitDate: today,
      excludeAppointmentId: id,
      allowedExistingStatuses: appointmentTypeAtCheckIn === 'report_show'
        ? ['concluded', 'completed']
        : undefined,
    });

    if (consultationFee > 0) {
      await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Appointment check-in consultation fee creation');
    }

    if (appt.status !== 'scheduled') {
      const existingVisit = await db.$client.prepare(`
        SELECT id, visit_no, status
        FROM visits
        WHERE appointment_id = ? AND tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).bind(id, tenantId).first<{ id: number; visit_no: string | null; status: string | null }>();

      if (appt.status === 'checked_in' && existingVisit?.id) {
        let queueEntry: Awaited<ReturnType<typeof ensureDoctorQueueEntryForAppointment>> | null = null;
        const doctorQueueAllowed = appointmentCanEnterDoctorQueue(billingStatusAtCheckIn);
        if (doctorQueueAllowed) {
          queueEntry = await ensureDoctorQueueEntryForAppointment(c.env.DB, {
            tenantId,
            appointmentId: id,
            patientId,
            doctorId,
            visitId: Number(existingVisit.id),
            queueDate: today,
          });
        }

        if (body.sendToRoom && doctorQueueAllowed && queueEntry?.id) {
          const now = getFullTimestampGMT6();
          await db.$client.batch([
            db.$client.prepare(`
              UPDATE queue_entries
              SET status = 'serving', serve_start_time = COALESCE(serve_start_time, ?), updated_at = ?
              WHERE id = ? AND tenant_id = ?
            `).bind(now, now, queueEntry.id, tenantId),
            db.$client.prepare(`
              UPDATE visits SET status = 'engaged', updated_at = ?
              WHERE id = ? AND tenant_id = ?
            `).bind(now, Number(existingVisit.id), tenantId),
          ]);
        }

        return c.json({
          message: body.sendToRoom && doctorQueueAllowed ? 'Patient already checked in and sent to room' : 'Patient already checked in',
          visitId: Number(existingVisit.id),
          visitNo: existingVisit.visit_no,
          consultationFee,
          billingStatus: billingStatusAtCheckIn,
          doctorQueueAllowed,
          queueEntry,
          sentToRoom: Boolean(body.sendToRoom && doctorQueueAllowed && queueEntry?.id),
          reused: true,
        });
      }

      throw new HTTPException(400, { message: `Cannot check in: appointment is ${appt.status}` });
    }

    const visitNo = await getNextSequence(c.env.DB, tenantId, 'visit', 'V');

    const appointmentClaim = await db.$client.prepare(
      `UPDATE appointments SET status = 'checked_in', checked_in_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND status = 'scheduled'`
    ).bind(id, tenantId).run();

    if (!appointmentClaim.meta?.changes) {
      const existingVisit = await db.$client.prepare(`
        SELECT id, visit_no
        FROM visits
        WHERE appointment_id = ? AND tenant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).bind(id, tenantId).first<{ id: number; visit_no: string | null }>();
      if (existingVisit?.id) {
        return c.json({
          message: 'Patient already checked in',
          visitId: Number(existingVisit.id),
          visitNo: existingVisit.visit_no,
          consultationFee,
          billingStatus: billingStatusAtCheckIn,
          doctorQueueAllowed: appointmentCanEnterDoctorQueue(billingStatusAtCheckIn),
          reused: true,
        });
      }
      throw new HTTPException(409, { message: 'Appointment check-in is already in progress' });
    }

    const visitResult = await db.$client.prepare(
      `INSERT INTO visits (patient_id, visit_no, doctor_id, visit_type, visit_date, appointment_id, status, tenant_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'initiated', ?, ?, datetime('now', '+6 hours'))`
    ).bind(patientId, visitNo, doctorId, visitType === 'opd' || visitType === 'ipd' || visitType === 'emergency' ? visitType : 'opd', today, id, tenantId, Number(userId)).run();

    const visitMeta = visitResult.meta;
    const visitId = visitMeta?.last_row_id;

    if (!visitId) {
      throw new Error("Failed to create visit - no ID returned");
    }

    // Step 2: Only paid, due-approved, or no-charge patients enter the doctor queue.
    const doctorQueueAllowed = appointmentCanEnterDoctorQueue(billingStatusAtCheckIn);
    const queueEntry = doctorQueueAllowed
      ? await ensureDoctorQueueEntryForAppointment(c.env.DB, {
          tenantId,
          appointmentId: id,
          patientId,
          doctorId,
          visitId: Number(visitId),
          queueDate: today,
        })
      : null;

    if (body.sendToRoom && doctorQueueAllowed && queueEntry?.id) {
      const now = getFullTimestampGMT6();
      await db.$client.batch([
        db.$client.prepare(`
          UPDATE queue_entries
          SET status = 'serving', serve_start_time = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).bind(now, now, queueEntry.id, tenantId),
        db.$client.prepare(`
          UPDATE visits SET status = 'engaged', updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).bind(now, Number(visitId), tenantId),
      ]);
    }

    if (consultationFee > 0 && visitId) {
      await ensureAppointmentConsultationProvisionalCharge(c.env.DB, {
        tenantId,
        appointmentId: id,
        patientId,
        doctorId,
        doctorName,
        department: doctorDepartment ?? 'Doctor',
        originalFee: charge.originalFee,
        discountAmount: charge.discountAmount,
        finalFee: charge.finalFee,
        createdBy: userId,
        visitId: Number(visitId),
      });
    }

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'appointments', id, null, {
      action: 'check_in',
      visitId,
      visitNo,
      consultationFee,
      billingStatus: billingStatusAtCheckIn,
      doctorQueueAllowed,
      queueEntry,
      sentToRoom: Boolean(body.sendToRoom && doctorQueueAllowed && queueEntry?.id),
    });

    return c.json({
      message: body.sendToRoom && doctorQueueAllowed ? 'Patient checked in and sent to room' : doctorQueueAllowed ? 'Patient checked in' : 'Patient checked in; payment pending before doctor queue',
      visitId,
      visitNo,
      consultationFee,
      billingStatus: billingStatusAtCheckIn,
      doctorQueueAllowed,
      queueEntry,
      sentToRoom: Boolean(body.sendToRoom && doctorQueueAllowed && queueEntry?.id),
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('[appointments] check-in error:', error);
    throw new HTTPException(500, { message: 'Failed to check in patient' });
  }
});

// ─── DELETE /api/appointments/:id — cancel ────────────────────────────────────
appointmentRoutes.delete('/:id', requirePermission('appointments:write'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const userId   = String(requireUserId(c));
  const id       = Number(c.req.param('id'));

  try {
    // Check existence with Drizzle
    const [existing] = await db.select({ id: appointments.id, billingStatus: appointments.billingStatus })
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: 'Appointment not found' });
    if (['paid', 'due_approved', 'partial_paid'].includes(existing.billingStatus ?? '')) {
      throw new HTTPException(409, { message: 'Cancel the posted bill or refund first before cancelling a paid/credit appointment' });
    }

    // Soft cancel with Drizzle
    await db.update(appointments)
      .set({
        status: 'cancelled',
        billingStatus: 'cancelled',
        updatedAt: sql`datetime('now', '+6 hours')`,
      })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)));

    await c.env.DB.prepare(`
      UPDATE billing_provisional_items
      SET bill_status = 'cancelled',
          is_active = 0,
          cancelled_by = ?,
          cancelled_at = datetime('now', '+6 hours'),
          cancel_reason = 'Appointment cancelled'
      WHERE appointment_id = ?
        AND tenant_id = ?
        AND bill_status = 'provisional'
        AND COALESCE(is_active, 1) = 1
    `).bind(userId, id, tenantId).run();

    void createAuditLog(c.env, tenantId!, userId!, 'CANCEL', 'appointments', id, null, { status: 'cancelled' });
    return c.json({ message: 'Appointment cancelled' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to cancel appointment' });
  }
});

// ─── POST /api/appointments/:id/pay-now — finalize consultation invoice + payment
appointmentRoutes.post('/:id/pay-now', requirePermission('billing:write'), zValidator('json', appointmentPayNowSchema), async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const appointmentId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ appointmentId, ...data, idempotencyKey: undefined })
    : null;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType: APPOINTMENT_PAY_NOW_MUTATION_TYPE,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different appointment payment request',
      conflictMessage: 'Appointment payment request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  let idempotencyReserved = false;
  try {
    if (data.idempotencyKey && requestHash) {
      const replay = await reserveMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType: APPOINTMENT_PAY_NOW_MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
        requestHash,
        createdBy: userId,
        mismatchMessage: 'Idempotency key was already used for a different appointment payment request',
        conflictMessage: 'Appointment payment request is already being processed. Please retry shortly.',
      });
      if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
      idempotencyReserved = true;
    }

    const response = await finalizeAppointmentConsultationInvoice(c, appointmentId, 'paid', {
      paymentMethod: data.paymentMethod,
      externalTransactionId: data.externalTransactionId,
      remarks: data.remarks,
      discountByName: data.discountByName,
      schemeApplication: data.schemeApplication ?? null,
    });

    if (data.idempotencyKey && requestHash) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType: APPOINTMENT_PAY_NOW_MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
        sourceId: response.receiptNo ?? response.invoiceNo ?? appointmentId,
        responseBody: response,
      });
    }

    return c.json(response, 201);
  } catch (error) {
    if (idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType: APPOINTMENT_PAY_NOW_MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark appointment Pay Now idempotency key failed:', markError);
      });
    }
    throw error;
  }
});

// ─── POST /api/appointments/:id/due-approval — finalize consultation as credit invoice
appointmentRoutes.post('/:id/due-approval', zValidator('json', appointmentCreditApprovalSchema), async (c) => {
  const role = c.get('role');
  if (!['hospital_admin', 'md', 'accountant', 'director'].includes(role ?? '')) {
    throw new HTTPException(403, { message: 'Not authorized for appointment credit approval' });
  }

  const appointmentId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const response = await finalizeAppointmentConsultationInvoice(c, appointmentId, 'credit', {
    remarks: data.remarks,
    discountByName: data.discountByName,
  });
  return c.json(response, 201);
});

// ─── POST /api/appointments/:id/send-to-counter — make pending charge visible to cashier
appointmentRoutes.post('/:id/send-to-counter', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const appointmentId = Number(c.req.param('id'));
  const appt = await getAppointmentBillingRow(c.env.DB, tenantId, appointmentId);
  if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });
  if (['paid', 'due_approved', 'refunded', 'cancelled'].includes(appt.billing_status ?? '')) {
    throw new HTTPException(409, { message: `Appointment billing is already ${appt.billing_status}` });
  }

  const charge = getAppointmentChargeFromRow(appt);
  const consultationFee = charge.finalFee;
  if (consultationFee <= 0) {
    await c.env.DB.prepare(`
      UPDATE appointments SET billing_status = 'no_charge', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(appointmentId, tenantId).run();
    return c.json({ message: 'Appointment has no charge', billingStatus: 'no_charge' });
  }

  await ensureAppointmentConsultationProvisionalCharge(c.env.DB, {
    tenantId,
    appointmentId,
    patientId: Number(appt.patient_id),
    doctorId: appt.doctor_id ? Number(appt.doctor_id) : null,
    doctorName: appt.doctor_name,
    department: appt.doctor_department ?? appt.doctor_specialty ?? 'Doctor',
    originalFee: charge.originalFee,
    discountAmount: charge.discountAmount,
    finalFee: charge.finalFee,
    createdBy: userId,
    visitId: appt.visit_id ?? null,
  });

  await c.env.DB.prepare(`
    UPDATE appointments
    SET billing_status = 'pending', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(appointmentId, tenantId).run();

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'appointments', appointmentId, null, {
    action: 'send_to_billing_counter',
    billingStatus: 'pending',
    consultationFee,
  });

  return c.json({ message: 'Sent to billing counter', billingStatus: 'pending', consultationFee });
});

export default appointmentRoutes;
